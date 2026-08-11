import { chromium } from "playwright-core";

const endpoint = process.env.LIGHTMARK_CDP_URL || "http://127.0.0.1:9224";

function assert(condition, message) {
  if (!condition) throw new Error(`图片验收失败：${message}`);
}

async function text(locator) {
  return (await locator.textContent())?.trim() || "";
}

console.log(`连接图片阅读器 WebView2：${endpoint}`);
const browser = await chromium.connectOverCDP(endpoint, { timeout: 10_000 });
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((candidate) => /tauri|localhost/i.test(candidate.url())) || pages[0];
assert(page, "没有找到轻阅的 WebView2 页面");
page.setDefaultTimeout(12_000);
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

await page.waitForLoadState("domcontentloaded");
await page.locator("#image-viewer").waitFor({ state: "visible" });
await page.locator("#image-loading").waitFor({ state: "hidden" });

const expectedNames = ["01-轻阅 图标.PNG", "02-Windows 风景.JPG", "10-第十张.png"];
const names = await page.locator("#image-list .document-name").allTextContents();
assert(JSON.stringify(names) === JSON.stringify(expectedNames), `图片自然排序错误：${names.join(" → ")}`);
const tabLabels = await page.locator(".sidebar-tabs .sidebar-tab").allTextContents();
assert(JSON.stringify(tabLabels) === JSON.stringify(["图片", "文档", "本文目录"]), `侧栏标签顺序错误：${tabLabels.join(" → ")}`);
if (await text(page.locator("#document-title")) !== expectedNames[1]) {
  await page.locator("#image-list .document-item").nth(1).click();
  await page.locator("#document-title").filter({ hasText: expectedNames[1] }).waitFor();
}
assert(await text(page.locator("#document-title")) === expectedNames[1], "无法打开指定 JPG");
assert(await text(page.locator("#page-indicator")) === "2 / 3", "指定 JPG 页码不是 2 / 3");
assert(await page.locator("#image-content").getAttribute("src").then((value) => value?.startsWith("data:image/jpeg;base64,")), "JPG 没有从 Rust 离线读取");
const jpgDetails = await text(page.locator("#image-details"));
assert(/\d+ × \d+ · .* · JPG/.test(jpgDetails), "没有显示 JPG 尺寸、大小和格式");
assert(await page.locator("#mode-switcher").isHidden(), "图片模式仍显示 Markdown 阅读/编辑/分栏按钮");
assert(await page.locator("#save-file").isDisabled(), "图片只读模式仍允许保存");
assert(await page.locator("#copy-menu-toggle").isDisabled(), "图片模式仍允许复制 Markdown");
assert(await page.locator("#ai-toggle").isDisabled(), "图片模式错误开放了 Codex 看图");
assert(await page.locator("#outline-tab").isDisabled(), "图片模式仍允许打开本文目录");

if (process.env.LIGHTMARK_IMAGE_SCREENSHOT) {
  await page.screenshot({ path: process.env.LIGHTMARK_IMAGE_SCREENSHOT });
}

await page.locator("#image-actual").click();
assert(await text(page.locator("#image-zoom-label")) === "100%", "原始大小不是 100%");
assert(await page.evaluate(() => localStorage.getItem("lightmark-image-zoom-mode")) === "actual", "没有记住原始大小选项");
await page.keyboard.press("ArrowRight");
await page.locator("#document-title").filter({ hasText: expectedNames[2] }).waitFor();
await page.waitForFunction(() => document.querySelector("#image-zoom-label")?.textContent?.trim() === "100%");
await page.keyboard.press("ArrowLeft");
await page.locator("#document-title").filter({ hasText: expectedNames[1] }).waitFor();
await page.waitForFunction(() => document.querySelector("#image-zoom-label")?.textContent?.trim() === "100%");
await page.waitForFunction(() => document.querySelector("#image-stage")?.scrollTop === 0);
const originalMetrics = await page.locator("#image-stage").evaluate((stage) => ({
  clientWidth: stage.clientWidth,
  clientHeight: stage.clientHeight,
  scrollWidth: stage.scrollWidth,
  scrollHeight: stage.scrollHeight,
  left: stage.scrollLeft,
  top: stage.scrollTop,
}));
assert(originalMetrics.scrollWidth > originalMetrics.clientWidth, "大尺寸 JPG 在原始大小下不能横向拖动");
assert(originalMetrics.scrollHeight > originalMetrics.clientHeight, "大尺寸 JPG 在原始大小下不能纵向拖动");

const stageBox = await page.locator("#image-stage").boundingBox();
assert(stageBox, "找不到图片舞台位置");
await page.mouse.move(stageBox.x + stageBox.width * 0.55, stageBox.y + stageBox.height * 0.55);
await page.mouse.down();
await page.mouse.move(stageBox.x + stageBox.width * 0.38, stageBox.y + stageBox.height * 0.36, { steps: 6 });
await page.mouse.up();
const draggedMetrics = await page.locator("#image-stage").evaluate((stage) => ({ left: stage.scrollLeft, top: stage.scrollTop }));
assert(draggedMetrics.left > originalMetrics.left, "拖动图片没有改变横向位置");
assert(draggedMetrics.top > originalMetrics.top, "拖动图片没有改变纵向位置");

await page.locator("#image-fit").click();
assert((await text(page.locator("#image-zoom-label"))).startsWith("适合 "), "适合窗口没有恢复自适应缩放");
const fitPercent = await text(page.locator("#image-zoom-label"));
await page.locator("#image-stage").hover();
await page.mouse.wheel(0, -120);
const customPercent = await text(page.locator("#image-zoom-label"));
assert(customPercent !== fitPercent, "鼠标滚轮没有缩放图片");
assert(await page.evaluate(() => localStorage.getItem("lightmark-image-zoom-mode")) === "custom", "没有记住自定义缩放方式");

await page.locator("#image-stage").focus();
await page.keyboard.press("ArrowRight");
await page.locator("#document-title").filter({ hasText: expectedNames[2] }).waitFor();
await page.waitForFunction((expected) => document.querySelector("#image-zoom-label")?.textContent?.trim() === expected, customPercent);
assert(await text(page.locator("#page-indicator")) === "3 / 3", "右方向键没有切到下一张");
assert(await page.locator("#next-document").isDisabled(), "末张图片的下一张按钮未禁用");
await page.keyboard.press("ArrowLeft");
await page.locator("#document-title").filter({ hasText: expectedNames[1] }).waitFor();
await page.waitForFunction((expected) => document.querySelector("#image-zoom-label")?.textContent?.trim() === expected, customPercent);
await page.waitForFunction(() => document.querySelector("#image-stage")?.scrollTop === 0);

await page.locator("#image-list .document-item").first().click();
await page.locator("#document-title").filter({ hasText: expectedNames[0] }).waitFor();
assert(await text(page.locator("#page-indicator")) === "1 / 3", "列表点击 PNG 后页码错误");
assert(await page.locator("#previous-document").isDisabled(), "首张图片的上一张按钮未禁用");
assert(await page.locator("#image-content").getAttribute("src").then((value) => value?.startsWith("data:image/png;base64,")), "大写扩展名 PNG 没有离线读取");
assert(await page.locator("#image-list .document-item.active .document-name").textContent() === expectedNames[0], "当前 PNG 没有在列表高亮");

await page.locator("#theme-toggle").click();
assert(await page.locator("html").getAttribute("data-theme") === "light", "图片模式没有切换到浅色主题");
await page.locator("#theme-toggle").click();
assert(await page.locator("html").getAttribute("data-theme") === "dark", "图片模式没有切换到深色主题");
await page.locator("#theme-toggle").click();
assert(await page.locator("html").getAttribute("data-theme") === null, "图片模式没有恢复系统主题");

assert(Number(await page.evaluate(() => localStorage.getItem("lightmark-image-zoom-scale"))) > 0, "没有保存图片缩放百分比");
await page.reload();
await page.locator("#image-viewer").waitFor({ state: "visible" });
await page.locator("#image-loading").waitFor({ state: "hidden" });
await page.waitForFunction((expected) => document.querySelector("#image-zoom-label")?.textContent?.trim() === expected, customPercent);
assert(await page.evaluate(() => localStorage.getItem("lightmark-image-zoom-mode")) === "custom", "重新打开后没有恢复缩放方式");

assert(pageErrors.length === 0, `页面运行错误：${pageErrors.join(" | ")}`);
console.log(JSON.stringify({
  imageNames: names,
  tabLabels,
  jpgDetails,
  rememberedZoom: customPercent,
  originalMetrics,
  draggedMetrics,
  result: "图片打开、自然排序、标签顺序、缩放记忆、新图从顶部开始、列表/按键切换、拖动、状态限制和主题均通过",
}, null, 2));

await browser.close();
