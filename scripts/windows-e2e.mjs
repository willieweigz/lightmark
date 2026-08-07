import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";

const endpoint = process.env.LIGHTMARK_CDP_URL || "http://127.0.0.1:9222";
const savedDocumentPath = process.env.LIGHTMARK_E2E_DOCUMENT;
const appPath = process.env.LIGHTMARK_E2E_APP;
const secondaryDocumentPath = process.env.LIGHTMARK_E2E_SECONDARY_DOCUMENT;
const screenshotPath = resolve("work", "lightmark-windows-acceptance.png");
const syntaxScreenshotPath = resolve("work", "lightmark-callout-guide.png");
const formattingScreenshotPath = resolve("work", "lightmark-formatting-tools.png");
const fullscreenScreenshotPath = resolve("work", "lightmark-long-document-fullscreen.png");

if (!savedDocumentPath) {
  throw new Error("LIGHTMARK_E2E_DOCUMENT is required");
}

function assert(condition, message) {
  if (!condition) throw new Error(`验收失败：${message}`);
}

async function text(locator) {
  return (await locator.textContent())?.trim() || "";
}

console.log(`连接 WebView2：${endpoint}`);
const browser = await chromium.connectOverCDP(endpoint, { timeout: 10_000 });
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((candidate) => /tauri|localhost/i.test(candidate.url())) || pages[0];
assert(page, "没有找到轻阅 Markdown 的 WebView2 页面");
page.setDefaultTimeout(10_000);
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

await page.waitForLoadState("domcontentloaded");
await page.evaluate(() => {
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
});
await page.getByRole("button", { name: "阅读", exact: true }).click();
await page.locator(".document-item").first().waitFor({ state: "visible", timeout: 15_000 });
await page.locator(".document-item").first().click();
await page.locator("#page-indicator").filter({ hasText: "1 / 3" }).waitFor();

const results = [];
const record = (name, details = "通过") => {
  results.push({ name, details });
  console.log(`✓ ${name}`);
};

const names = await page.locator(".document-name").allTextContents();
assert(JSON.stringify(names) === JSON.stringify(["01-第一页.md", "02-第二页.md", "10-第十页.md"]), `自然排序错误：${names.join(" → ")}`);
assert(await text(page.locator("#page-indicator")) === "1 / 3", "首次打开页码不是 1 / 3");
assert(await page.locator("#previous-document").isDisabled(), "首篇的上一篇按钮未禁用");
assert(await page.locator("#next-document").isEnabled(), "首篇的下一篇按钮不可用");
assert(await page.locator(".document-item.active .document-name").textContent() === "01-第一页.md", "首篇没有高亮");
const displayedPath = await text(page.locator("#document-path"));
assert(displayedPath.includes(" ") && /[\u3400-\u9fff]/u.test(displayedPath) && !displayedPath.startsWith("\\\\?\\"), `Windows 路径显示不友好：${displayedPath}`);
record("自然排序、中文空格路径、首篇高亮、页码与按钮状态", names.join(" → "));

await page.locator("#next-document").click();
await page.locator("#page-indicator").filter({ hasText: "2 / 3" }).waitFor();
assert(await page.locator(".document-item.active .document-name").textContent() === "02-第二页.md", "顶部下一篇按钮未切到第二篇或高亮错误");
record("顶部上一篇/下一篇按钮与列表高亮");

const preview = page.frameLocator("#preview");
await preview.locator("h1", { hasText: "第二页" }).waitFor({ timeout: 10_000 });
assert(await preview.locator("table").count() === 1, "表格未渲染");
assert(await preview.locator("pre code").count() >= 1, "代码块未渲染");
assert(await preview.locator(".callout").count() >= 3, "Callout 未渲染");
assert(await preview.locator(".frontmatter").count() === 1, "Frontmatter 未渲染");
await preview.locator(".wikilink").first().waitFor();
assert(await preview.locator(".wikilink").count() === 1, "Wiki Link 未渲染");
const imageSource = await preview.locator("img[alt='轻阅 Markdown 离线图片']").getAttribute("src");
assert(imageSource?.startsWith("data:image/svg+xml;base64,"), "相对路径图片未通过 Rust 从磁盘离线加载");
record("GFM、表格、代码块、Callout、Frontmatter、Wiki Link、相对图片");

await page.keyboard.press("Control+f");
await page.locator("#document-find").waitFor({ state: "visible" });
assert(!await page.locator("#syntax-dialog").isVisible(), "Ctrl+F 仍然打开了语法速查");
await page.locator("#find-input").fill("Callout");
await page.locator("#find-count").filter({ hasText: /1 \/ [1-9]/ }).waitFor();
await page.locator("#find-next").click();
await page.locator("#find-close").click();
assert(await page.locator("#document-find").isHidden(), "文内查找无法关闭");
record("Ctrl+F 文内查找、结果计数与前后跳转");

await page.locator("#copy-menu-toggle").click();
assert(await page.locator("#copy-menu [data-copy-mode]").count() === 3, "文档复制菜单不是三种格式");
await page.locator("#copy-menu [data-copy-mode='markdown']").click();
await page.locator("#save-status").filter({ hasText: "Markdown 原文已复制" }).waitFor();
await page.locator("#copy-menu-toggle").click();
await page.locator("#copy-menu [data-copy-mode='plain']").click();
await page.locator("#save-status").filter({ hasText: "纯文本已复制" }).waitFor();
await page.locator("#copy-menu-toggle").click();
await page.locator("#copy-menu [data-copy-mode='rich']").click();
await page.locator("#save-status").filter({ hasText: "富文本已复制" }).waitFor();
record("Markdown 原文、纯文本与富文本三种复制入口");

await page.locator("#outline-tab").click();
const initialOutline = await page.locator("#outline-list .outline-item").allTextContents();
assert(JSON.stringify(initialOutline) === JSON.stringify(["第二页", "GFM 排版"]), `本文目录提取错误：${initialOutline.join(" → ")}`);
await page.locator("#outline-list .outline-item").filter({ hasText: "GFM 排版" }).click();
await page.waitForFunction(() => {
  const frameDocument = document.querySelector("#preview")?.contentDocument;
  const heading = [...(frameDocument?.querySelectorAll("h1,h2,h3,h4,h5,h6") || [])].find((item) => item.textContent.includes("GFM 排版"));
  return heading && Math.abs(heading.getBoundingClientRect().top) < 80;
});
await page.locator("#documents-tab").click();
record("本文标题目录提取、层级展示与阅读模式点击跳转", initialOutline.join(" → "));

await page.keyboard.press("ArrowRight");
await page.locator("#page-indicator").filter({ hasText: "3 / 3" }).waitFor();
assert(await page.locator("#next-document").isDisabled(), "末篇的下一篇按钮未禁用");
assert(await page.locator("#previous-document").isEnabled(), "末篇的上一篇按钮不可用");
await page.keyboard.press("ArrowLeft");
await page.locator("#page-indicator").filter({ hasText: "2 / 3" }).waitFor();
record("阅读模式左右方向键与首尾禁用状态");

await page.getByRole("button", { name: "编辑" }).click();
const editor = page.locator("#editor");
await editor.focus();
await editor.press("Control+End");
const cursorBefore = await editor.evaluate((element) => element.selectionStart);
await editor.press("ArrowLeft");
const cursorAfter = await editor.evaluate((element) => element.selectionStart);
assert(cursorAfter === cursorBefore - 1, "编辑模式左方向键没有移动光标");
assert(await text(page.locator("#page-indicator")) === "2 / 3", "编辑模式方向键误翻页");
record("编辑模式方向键只移动光标");

await editor.press("Control+End");
await editor.type("\n\n黄色高光测试 红色文字测试", { delay: 1 });
await editor.evaluate((element) => {
  const start = element.value.indexOf("黄色高光测试");
  element.setSelectionRange(start, start + "黄色高光测试".length);
});
await page.locator("#highlight-tool").click();
assert((await editor.inputValue()).includes("<mark>黄色高光测试</mark>"), "黄色高光按钮没有自动添加 mark 代码");

await editor.evaluate((element) => {
  const end = element.value.length;
  element.setSelectionRange(end, end);
});
await page.locator("#red-text-tool").click();
assert(await page.locator("#red-text-tool").getAttribute("aria-pressed") === "true", "红色笔没有进入开启状态");
await editor.evaluate((element) => {
  const start = element.value.indexOf("红色文字测试");
  element.setSelectionRange(start, start + "红色文字测试".length);
  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
});
await page.waitForFunction(() => document.querySelector("#editor").value.includes('<span class="text-red">红色文字测试</span>'));
await page.locator("#red-text-tool").click();
assert(await page.locator("#red-text-tool").getAttribute("aria-pressed") === "false", "红色笔没有正常退出");
  await page.getByRole("button", { name: "分栏" }).click();
  await preview.locator("mark", { hasText: "黄色高光测试" }).waitFor();
  await preview.locator(".text-red", { hasText: "红色文字测试" }).waitFor();
  if (await page.locator("#editor-pane").evaluate((element) => getComputedStyle(element).gridColumnStart) !== "1") {
    await page.locator("#pane-swap").click();
  }
  assert(await page.locator("#editor-pane").evaluate((element) => getComputedStyle(element).gridColumnStart) === "1", "编辑区无法恢复到左侧");
  assert(await page.locator("#preview-pane").evaluate((element) => getComputedStyle(element).gridColumnStart) === "3", "默认预览区不在右侧");
  await page.locator("#pane-swap").click();
  assert(await page.locator("#editor-pane").evaluate((element) => getComputedStyle(element).gridColumnStart) === "3", "换边后编辑区没有移到右侧");
  assert(await page.locator("#preview-pane").evaluate((element) => getComputedStyle(element).gridColumnStart) === "1", "换边后预览区没有移到左侧");
  assert(await page.evaluate(() => localStorage.getItem("lightmark-editor-side")) === "right", "编辑区位置没有记忆");
  await page.locator("#pane-swap").click();
  let splitDivider = await page.locator("#split-resizer").boundingBox();
  assert(splitDivider, "没有找到编辑/预览分隔条");
  const panesBox = await page.locator("#content-panes").boundingBox();
  assert(panesBox, "没有找到分栏内容区域");
  await page.mouse.move(splitDivider.x + splitDivider.width / 2, splitDivider.y + 80);
  await page.mouse.down();
  await page.mouse.move(panesBox.x + panesBox.width / 2, splitDivider.y + 80, { steps: 6 });
  await page.mouse.up();
  splitDivider = await page.locator("#split-resizer").boundingBox();
  const editorWidthBeforeDrag = (await page.locator("#editor-pane").boundingBox())?.width || 0;
  await page.mouse.move(splitDivider.x + splitDivider.width / 2, splitDivider.y + 80);
  await page.mouse.down();
  await page.mouse.move(splitDivider.x + splitDivider.width / 2 + 90, splitDivider.y + 80, { steps: 8 });
  await page.mouse.up();
  const editorWidthAfterDrag = (await page.locator("#editor-pane").boundingBox())?.width || 0;
  assert(editorWidthAfterDrag > editorWidthBeforeDrag + 50, "中间分隔条拖动后编辑区宽度没有变化");
  assert(Number(await page.evaluate(() => localStorage.getItem("lightmark-editor-split-ratio"))) > 0.5, "中间分隔比例没有记忆");
  record("编辑/预览一键换边、中间分隔条拖动与位置记忆");
  await page.locator("#outline-tab").click();
  await page.locator("#outline-list .outline-item").filter({ hasText: "GFM 排版" }).click();
  assert(await editor.evaluate((element) => element.value.slice(element.selectionStart).startsWith("## GFM 排版")), "分栏编辑时点击目录没有把光标带到对应标题");
  await page.locator("#documents-tab").click();
  record("分栏编辑时目录点击同步定位光标与预览");
const highlightStyle = await preview.locator("mark", { hasText: "黄色高光测试" }).evaluate((element) => {
  const style = getComputedStyle(element);
  return { background: style.backgroundColor, color: style.color };
});
assert(highlightStyle.background !== "rgba(0, 0, 0, 0)", "黄色高光没有浅黄色背景");
assert(highlightStyle.color === "rgb(33, 29, 18)", `黄色高光文字不是黑色：${highlightStyle.color}`);
const redColor = await preview.locator(".text-red", { hasText: "红色文字测试" }).evaluate((element) => getComputedStyle(element).color);
assert(redColor !== highlightStyle.color, "红色文字没有显示为红色");
  await page.screenshot({ path: formattingScreenshotPath });
  record("黄色高光与红色笔：按钮应用、画笔拖选、代码写入和实时预览");

  await editor.evaluate((element) => {
    element.value += "\n\n<";
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#html-completion").waitFor({ state: "visible" });
  assert(await page.locator("#html-completion button").count() === 4, "输入 < 后没有显示四个安全格式候选");
  await editor.press("ArrowDown");
  await editor.press("Enter");
  assert((await editor.inputValue()).endsWith("<br><br>"), "方向键与 Enter 没有插入选中的空白行格式");
  await editor.evaluate((element) => {
    element.value += "\n<ma";
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert(await page.locator("#html-completion button").count() === 1, "输入 <ma 后没有筛选到高光格式");
  await editor.press("Enter");
  assert(await editor.evaluate((element) => element.value.slice(element.selectionStart, element.selectionEnd)) === "高光文字", "插入高光格式后没有选中可替换文字");
  record("尖括号安全候选：筛选、方向键、Enter 插入与自动选中示例文字");

  const syncOriginal = await editor.inputValue();
  await editor.evaluate((element) => {
    element.value += Array.from({ length: 70 }, (_, index) => `\n\n## 长文同步验收 ${index + 1}\n${"这是用于验证不同字体、行高和标题位置下滚动同步的长段落。\n\n".repeat(3)}`).join("");
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await preview.getByText("长文同步验收 70", { exact: true }).waitFor();
  await page.waitForFunction(() => [...(document.querySelector("#preview")?.contentDocument?.images || [])].every((image) => image.complete));
  await page.locator("#sync-mode").selectOption("auto");
  await editor.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  await page.waitForFunction(() => {
    const frame = document.querySelector("#preview")?.contentWindow;
    const scroller = frame?.document.scrollingElement;
    return !scroller || frame.scrollY / Math.max(1, scroller.scrollHeight - frame.innerHeight) < 0.12;
  });
  await editor.evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  await page.waitForFunction(() => {
    const frame = document.querySelector("#preview")?.contentWindow;
    const scroller = frame?.document.scrollingElement;
    return frame && scroller && frame.scrollY / Math.max(1, scroller.scrollHeight - frame.innerHeight) > 0.82;
  });
  record("分栏编辑滚动时预览自动同步跟随");

  await editor.evaluate((element) => {
    element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.35;
    element.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(240);
  const automaticPreviewY = await preview.locator("body").evaluate(() => window.scrollY);
  const previewRangeForAlignment = await preview.locator("body").evaluate(() => Math.max(0, document.scrollingElement.scrollHeight - innerHeight));
  assert(previewRangeForAlignment > automaticPreviewY + 100, "测试文档预览空间不足，无法验证手动对齐偏移");
  await page.locator("#sync-mode").selectOption("manual");
  await preview.locator("body").evaluate((_, target) => window.scrollTo(0, target), automaticPreviewY + 80);
  await page.waitForTimeout(240);
  const manuallyAlignedY = await preview.locator("body").evaluate(() => window.scrollY);
  const storedAlignment = Number(await page.locator("#reset-sync").getAttribute("data-offset"));
  assert(await page.locator("#reset-sync").isEnabled(), "手动校准后重新对齐按钮没有启用");
  await editor.evaluate((element) => {
    element.scrollTop += Math.min(80, (element.scrollHeight - element.clientHeight) * 0.05);
    element.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(240);
  const previewAfterEditorMove = await preview.locator("body").evaluate(() => window.scrollY);
  await page.locator("#reset-sync").click();
  await page.waitForTimeout(240);
  const previewAfterReset = await preview.locator("body").evaluate(() => window.scrollY);
  assert(Math.abs((previewAfterEditorMove - previewAfterReset) - storedAlignment) < 4, `手动校准没有持续保留：保存 ${storedAlignment}，实际 ${previewAfterEditorMove - previewAfterReset}`);

  await page.locator("#sync-mode").selectOption("off");
  await preview.locator("body").evaluate(() => window.scrollTo(0, 30));
  await editor.evaluate((element) => {
    element.scrollTop = Math.max(0, element.scrollTop - 40);
    element.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(220);
  assert(Math.abs(await preview.locator("body").evaluate(() => window.scrollY) - 30) < 3, "关闭同步后预览仍被编辑区带动");
  await page.locator("#sync-mode").selectOption("auto");
  await editor.evaluate((element, value) => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, syncOriginal);
  record("长文自动锚点、手动校准持续保留、重新对齐与关闭同步");

  await editor.evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight;
    element.dispatchEvent(new Event("scroll"));
  });
await editor.type("\n\n## Ctrl+S 验收\n已从磁盘真实回读。\n\n<script>window.__lightmarkPwned = true</script>\n<img src=\"missing.png\" onerror=\"window.__lightmarkPwned=true\">", { delay: 1 });
await page.getByRole("button", { name: "分栏" }).click();
await preview.getByText("Ctrl+S 验收", { exact: true }).waitFor();
const scriptCount = await preview.locator("#page script").count();
const unsafeHandlerCount = await preview.locator("[onerror]").count();
const pwned = await preview.locator("body").evaluate(() => window.__lightmarkPwned);
assert(scriptCount === 0 && unsafeHandlerCount === 0 && pwned === undefined, "DOMPurify 未完全阻止不受信任脚本或事件处理器");
await page.keyboard.press("Control+s");
await page.locator("#save-status").filter({ hasText: "已保存" }).waitFor();
const diskText = await readFile(savedDocumentPath, "utf8");
assert(diskText.includes("已从磁盘真实回读。"), "Ctrl+S 后磁盘文件没有真实写入修改");
record("实时分栏预览、DOMPurify 脚本阻止、Ctrl+S 磁盘回读");

await editor.press("Control+End");
await editor.type("\n\n## 本地链接验收\n![[images/lightmark-sample.svg|240]]\n\n[[10-第十页|Wiki 跳转第十页]]\n[Markdown 跳转第十页](10-第十页.md)", { delay: 1 });
await page.keyboard.press("Control+s");
const obsidianImage = preview.locator("img.obsidian-image");
await obsidianImage.waitFor();
await page.waitForFunction(() => document.querySelector("#preview")?.contentDocument?.querySelector("img.obsidian-image")?.getAttribute("src")?.startsWith("data:image/svg+xml;base64,"));
assert((await obsidianImage.getAttribute("src"))?.startsWith("data:image/svg+xml;base64,"), "Obsidian 图片没有从相对路径离线加载");
assert(await obsidianImage.getAttribute("width") === "240", "Obsidian 图片宽度参数没有保留");
await preview.getByText("Markdown 跳转第十页", { exact: true }).click();
await page.locator("#page-indicator").filter({ hasText: "3 / 3" }).waitFor();
await page.locator(".document-item").filter({ hasText: "02-第二页.md" }).click();
await preview.getByText("Wiki 跳转第十页", { exact: true }).click();
await page.locator("#page-indicator").filter({ hasText: "3 / 3" }).waitFor();
await page.locator(".document-item").filter({ hasText: "02-第二页.md" }).click();
await page.locator("#page-indicator").filter({ hasText: "2 / 3" }).waitFor();
record("Obsidian 图片显示、相对 Markdown 链接与 Wiki Link 点击跳转");

await editor.press("Control+End");
await editor.type("\n未保存保护验收");
await page.locator("#next-document").click();
await page.locator("#unsaved-dialog").waitFor({ state: "visible" });
assert(await text(page.locator("#page-indicator")) === "2 / 3", "未保存确认前已经切换文档");
await page.locator("#cancel-pending").click();
assert(await text(page.locator("#page-indicator")) === "2 / 3", "取消未保存保护后仍切换了文档");
await page.locator("#next-document").click();
await page.locator("#unsaved-dialog").waitFor({ state: "visible" });
await page.locator("#discard-pending").click();
await page.locator("#page-indicator").filter({ hasText: "3 / 3" }).waitFor();
record("未保存修改保护：取消与不保存继续");

await page.locator(".document-item").filter({ hasText: "02-第二页.md" }).click();
await page.locator("#page-indicator").filter({ hasText: "2 / 3" }).waitFor();
await page.getByRole("button", { name: "阅读" }).click();
await page.locator("#syntax-help").click();
await page.locator("#syntax-dialog").waitFor({ state: "visible" });
  assert(await page.locator("#syntax-grid article").count() === 18, "语法速查条目不完整");
  assert(await page.locator("#syntax-search").count() === 0, "语法速查仍保留了不需要的搜索框");
  assert(await page.locator(".syntax-copy-button").count() === 33, "语法复制模板数量不完整");
const calloutGuide = await text(page.locator("#syntax-grid article[data-syntax='callout']"));
assert(calloutGuide.includes("Callout"), "语法速查缺少 Callout");
assert(["note", "abstract", "info", "todo", "tip", "success", "question", "warning", "failure", "danger", "bug", "example", "quote"].every((type) => calloutGuide.includes(type)), "语法速查缺少官方 Callout 类型");
assert(["summary", "tldr", "hint", "important", "check", "done", "help", "faq", "caution", "attention", "fail", "missing", "error", "cite"].every((alias) => calloutGuide.includes(alias)), "语法速查缺少 Callout 别名");
  assert(calloutGuide.includes("默认收起") && calloutGuide.includes("默认展开") && calloutGuide.includes("多层嵌套"), "语法速查缺少 Callout 折叠或嵌套示例");
  await page.locator("#syntax-grid article[data-syntax='callout'] .syntax-copy-button").filter({ hasText: "基础 Callout" }).click();
  await page.locator("#syntax-grid article[data-syntax='callout'] .syntax-copy-button.copied").waitFor();
  await page.screenshot({ path: syntaxScreenshotPath });
  const paragraphGuide = await text(page.locator("#syntax-grid article[data-syntax='paragraph']"));
  assert(["&emsp;&emsp;", "<br>", "<br><br>", "两个真正的全角空格"].every((label) => paragraphGuide.includes(label)), "段落速查缺少原样显示的缩进或换行符号");
  const paragraphCopyValues = await page.locator("#syntax-grid article[data-syntax='paragraph'] .syntax-copy-button").evaluateAll((buttons) => buttons.map((button) => button.dataset.copyText));
  assert(JSON.stringify(paragraphCopyValues) === JSON.stringify(["&emsp;&emsp;", "　　", "<br>", "<br><br>"]), "段落按钮夹带了示例文字或复制值错误");
  assert(await page.locator("#syntax-grid article[data-syntax='inline-code']").count() === 1, "语法速查缺少行内代码");
  assert(await page.locator("#syntax-grid article[data-syntax='divider']").count() === 1, "语法速查缺少分隔线与转义");
  assert(await page.locator("#syntax-grid article[data-syntax='obsidian-image']").count() === 1, "语法速查缺少 Obsidian 图片");
  await page.locator("#syntax-dialog .dialog-header button").click();
  record("完整语法速查、Callout/段落模板一键复制与常用扩展");

await page.locator("#theme-toggle").click();
assert(await page.locator("html").getAttribute("data-theme") === "light", "未切换到浅色主题");
await page.locator("#theme-toggle").click();
assert(await page.locator("html").getAttribute("data-theme") === "dark", "未切换到深色主题");
await page.locator("#theme-toggle").click();
assert(await page.locator("html").getAttribute("data-theme") === null, "未恢复跟随系统主题");
  record("浅色、深色与跟随 Windows 系统主题");

await page.getByRole("button", { name: "分栏", exact: true }).click();
const fullscreenOriginal = await editor.inputValue();
await editor.evaluate((element) => {
  const sections = Array.from({ length: 90 }, (_, index) => `\n\n## 长文全屏验收 ${index + 1}\n${"这是一段用于验证 Windows 最大窗口与全屏内容区高度的长文字。\n\n".repeat(3)}`).join("");
  element.value += sections;
  element.dispatchEvent(new Event("input", { bubbles: true }));
});
await preview.getByText("长文全屏验收 90", { exact: true }).waitFor();
const normalLayout = await page.evaluate(() => ({
  viewport: innerHeight,
  panes: document.querySelector("#content-panes").getBoundingClientRect().height,
  status: document.querySelector(".statusbar").getBoundingClientRect().height,
}));
assert(normalLayout.panes > normalLayout.viewport - 180, `普通窗口内容区没有占满高度：${JSON.stringify(normalLayout)}`);
assert(Math.abs(normalLayout.status - 30) < 1, `普通窗口状态栏高度错误：${normalLayout.status}`);
await page.locator("#fullscreen-toggle").click();
await page.locator("#fullscreen-toggle").filter({ hasText: "退出全屏" }).waitFor();
await page.waitForTimeout(500);
const fullscreenLayout = await page.evaluate(() => ({
  viewport: innerHeight,
  panes: document.querySelector("#content-panes").getBoundingClientRect().height,
  status: document.querySelector(".statusbar").getBoundingClientRect().height,
}));
assert(fullscreenLayout.panes > fullscreenLayout.viewport - 180, `长文全屏内容区没有占满高度：${JSON.stringify(fullscreenLayout)}`);
assert(fullscreenLayout.panes > normalLayout.panes + 200, "进入全屏后内容区没有随窗口增高");
assert(Math.abs(fullscreenLayout.status - 30) < 1, `全屏状态栏高度错误：${fullscreenLayout.status}`);
await page.screenshot({ path: fullscreenScreenshotPath });
await page.keyboard.press("F11");
await page.locator("#fullscreen-toggle").filter({ hasText: /^全屏$/ }).waitFor();
await editor.evaluate((element, value) => {
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
}, fullscreenOriginal);
await page.getByRole("button", { name: "阅读", exact: true }).click();
record("46 KB 级长文布局回归、全屏按钮与 F11 进入/退出全屏幕", `${Math.round(normalLayout.panes)}px → ${Math.round(fullscreenLayout.panes)}px`);

// 清理仅用于布局验收的临时输入，避免它干扰后面的单实例打开文档测试。
// 若内容恰好恢复到磁盘版本，产品会直接切换；否则主动选择“不保存”。
await page.locator("#next-document").click();
await Promise.race([
  page.locator("#unsaved-dialog").waitFor({ state: "visible" }),
  page.locator("#page-indicator").filter({ hasText: "3 / 3" }).waitFor(),
]);
if (await page.locator("#unsaved-dialog").isVisible()) {
  await page.locator("#discard-pending").click();
}
await page.locator("#page-indicator").filter({ hasText: "3 / 3" }).waitFor();
await page.locator(".document-item").filter({ hasText: "02-第二页.md" }).click();
await page.locator("#page-indicator").filter({ hasText: "2 / 3" }).waitFor();

  await page.locator("#sidebar-resizer").focus();
  await page.locator("#sidebar-resizer").press("Home");
  await page.waitForFunction(() => document.querySelector("#sidebar")?.getBoundingClientRect().width < 200);
  await page.waitForTimeout(220);
  const sidebarWidthBeforeDrag = (await page.locator("#sidebar").boundingBox())?.width || 0;
  const sidebarDivider = await page.locator("#sidebar-resizer").boundingBox();
  assert(sidebarDivider, "没有找到文档列表分隔条");
  await page.mouse.move(sidebarDivider.x + sidebarDivider.width / 2, sidebarDivider.y + 120);
  await page.mouse.down();
  await page.mouse.move(sidebarDivider.x + sidebarDivider.width / 2 + 48, sidebarDivider.y + 120, { steps: 6 });
  await page.mouse.up();
  const sidebarWidthAfterDrag = (await page.locator("#sidebar").boundingBox())?.width || 0;
  assert(sidebarWidthAfterDrag > sidebarWidthBeforeDrag + 25, `文档列表分隔条拖动后宽度没有变化：${sidebarWidthBeforeDrag} → ${sidebarWidthAfterDrag}`);
  assert(Number(await page.evaluate(() => localStorage.getItem("lightmark-sidebar-width"))) > sidebarWidthBeforeDrag, "文档列表宽度没有记忆");
  await page.locator("#collapse-sidebar").click();
assert(await page.locator("#sidebar").evaluate((element) => element.classList.contains("collapsed")), "侧栏未收起");
await page.locator("#expand-sidebar").click();
assert(!await page.locator("#sidebar").evaluate((element) => element.classList.contains("collapsed")), "侧栏未展开");
  record("文档列表宽度拖动、记忆、收起与展开");

if (appPath && secondaryDocumentPath) {
  const secondary = spawn(appPath, [secondaryDocumentPath], { stdio: "ignore", windowsHide: true });
  const secondaryExit = new Promise((resolveExit) => secondary.once("exit", (code) => resolveExit(code)));
  await page.locator("#document-title").filter({ hasText: basename(secondaryDocumentPath) }).waitFor({ timeout: 10_000 });
  const exitCode = await Promise.race([
    secondaryExit,
    new Promise((resolveExit) => setTimeout(() => resolveExit("timeout"), 5_000)),
  ]);
  assert(exitCode !== "timeout", "第二次启动没有被单实例插件及时结束");
  assert(await text(page.locator("#page-indicator")) === "3 / 3", "第二次启动的文档没有交给已有窗口");
  record("单实例：重复启动聚焦已有窗口并打开新文档");
}

await mkdir(resolve("work"), { recursive: true });
await page.screenshot({ path: screenshotPath });
assert(pageErrors.length === 0, `页面运行错误：${pageErrors.join(" | ")}`);

console.log(JSON.stringify({
  appUrl: page.url(),
  savedDocumentPath,
  screenshotPath,
  syntaxScreenshotPath,
  formattingScreenshotPath,
  fullscreenScreenshotPath,
  results,
}, null, 2));

await browser.close();
