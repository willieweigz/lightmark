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

if (!savedDocumentPath) {
  throw new Error("LIGHTMARK_E2E_DOCUMENT is required");
}

function assert(condition, message) {
  if (!condition) throw new Error(`验收失败：${message}`);
}

async function text(locator) {
  return (await locator.textContent())?.trim() || "";
}

const browser = await chromium.connectOverCDP(endpoint);
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((candidate) => /tauri|localhost/i.test(candidate.url())) || pages[0];
assert(page, "没有找到轻阅 Markdown 的 WebView2 页面");

await page.waitForLoadState("domcontentloaded");
await page.locator(".document-item").first().waitFor({ state: "visible", timeout: 15_000 });
await page.locator(".document-item").first().click();
await page.locator("#page-indicator").filter({ hasText: "1 / 3" }).waitFor();

const results = [];
const record = (name, details = "通过") => results.push({ name, details });

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
assert(await preview.locator(".wikilink").count() === 1, "Wiki Link 未渲染");
const imageSource = await preview.locator("img[alt='轻阅 Markdown 离线图片']").getAttribute("src");
assert(imageSource?.startsWith("data:image/svg+xml;base64,"), "相对路径图片未通过 Rust 从磁盘离线加载");
record("GFM、表格、代码块、Callout、Frontmatter、Wiki Link、相对图片");

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

  await editor.press("Control+Home");
  await page.waitForFunction(() => {
    const frame = document.querySelector("#preview")?.contentWindow;
    const scroller = frame?.document.scrollingElement;
    return !scroller || frame.scrollY / Math.max(1, scroller.scrollHeight - frame.innerHeight) < 0.12;
  });
  await editor.press("Control+End");
  await page.waitForFunction(() => {
    const frame = document.querySelector("#preview")?.contentWindow;
    const scroller = frame?.document.scrollingElement;
    return frame && scroller && frame.scrollY / Math.max(1, scroller.scrollHeight - frame.innerHeight) > 0.82;
  });
  record("分栏编辑滚动时预览自动同步跟随");

  await editor.press("Control+End");
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
  assert(await page.locator("#syntax-grid article").count() === 15, "语法速查条目不完整");
await page.locator("#syntax-search").fill("Callout");
assert(await page.locator("#syntax-grid article:visible").count() === 1, "语法速查筛选不正确");
const calloutGuide = await text(page.locator("#syntax-grid article:visible"));
assert(calloutGuide.includes("Callout"), "语法速查缺少 Callout");
assert(["note", "abstract", "info", "todo", "tip", "success", "question", "warning", "failure", "danger", "bug", "example", "quote"].every((type) => calloutGuide.includes(type)), "语法速查缺少官方 Callout 类型");
assert(["summary", "tldr", "hint", "important", "check", "done", "help", "faq", "caution", "attention", "fail", "missing", "error", "cite"].every((alias) => calloutGuide.includes(alias)), "语法速查缺少 Callout 别名");
  assert(calloutGuide.includes("默认收起") && calloutGuide.includes("默认展开") && calloutGuide.includes("多层嵌套"), "语法速查缺少 Callout 折叠或嵌套示例");
  await page.screenshot({ path: syntaxScreenshotPath });
  await page.locator("#syntax-search").fill("段首");
  assert(await page.locator("#syntax-grid article:visible").count() === 1, "段落与缩进语法筛选不正确");
  const paragraphGuide = await text(page.locator("#syntax-grid article:visible"));
  assert(paragraphGuide.includes("空一整行") || paragraphGuide.includes("第一段文字"), "语法速查缺少空行分段示例");
  assert(paragraphGuide.includes("4 个半角空格") && paragraphGuide.includes("全角空格"), "语法速查缺少中文段首缩进提醒");
  await page.locator("#syntax-dialog .dialog-header button").click();
  record("Markdown 语法速查、搜索、空行分段与中文段首说明");

await page.locator("#theme-toggle").click();
assert(await page.locator("html").getAttribute("data-theme") === "light", "未切换到浅色主题");
await page.locator("#theme-toggle").click();
assert(await page.locator("html").getAttribute("data-theme") === "dark", "未切换到深色主题");
await page.locator("#theme-toggle").click();
assert(await page.locator("html").getAttribute("data-theme") === null, "未恢复跟随系统主题");
  record("浅色、深色与跟随 Windows 系统主题");

  await page.locator("#sidebar-resizer").focus();
  await page.locator("#sidebar-resizer").press("Home");
  await page.waitForFunction(() => document.querySelector("#sidebar")?.getBoundingClientRect().width < 200);
  const sidebarWidthBeforeDrag = (await page.locator("#sidebar").boundingBox())?.width || 0;
  const sidebarDivider = await page.locator("#sidebar-resizer").boundingBox();
  assert(sidebarDivider, "没有找到文档列表分隔条");
  await page.mouse.move(sidebarDivider.x + sidebarDivider.width / 2, sidebarDivider.y + 120);
  await page.mouse.down();
  await page.mouse.move(sidebarDivider.x + sidebarDivider.width / 2 + 48, sidebarDivider.y + 120, { steps: 6 });
  await page.mouse.up();
  const sidebarWidthAfterDrag = (await page.locator("#sidebar").boundingBox())?.width || 0;
  assert(sidebarWidthAfterDrag > sidebarWidthBeforeDrag + 25, "文档列表分隔条拖动后宽度没有变化");
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

console.log(JSON.stringify({
  appUrl: page.url(),
  savedDocumentPath,
  screenshotPath,
  syntaxScreenshotPath,
  formattingScreenshotPath,
  results,
}, null, 2));

await browser.close();
