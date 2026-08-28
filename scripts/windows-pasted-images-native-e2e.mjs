import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const port = 9231;
const endpoint = `http://127.0.0.1:${port}`;
const appPath = resolve("src-tauri", "target", "release", "lightmark.exe");
const remoteImage = "https://raw.githubusercontent.com/github/explore/main/topics/rust/rust.png";

function assert(condition, message) {
  if (!condition) throw new Error(`原生粘贴图片验收失败：${message}`);
}

async function waitForEndpoint() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error("原生 WebView2 调试端口没有按时启动");
}

async function waitForSavedMarkdown(path) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const contents = await readFile(path, "utf8");
    if (contents.includes("assets/paste-") && !contents.includes("lightmark-paste-image://")) return contents;
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error("Markdown 没有在限定时间内写回 assets 相对路径");
}

const testRoot = await mkdtemp(join(tmpdir(), "lightmark-native-paste-"));
const documentPath = join(testRoot, "中文 网页摘录.md");
await writeFile(documentPath, "# 原生验收\n\n", "utf8");

let browser;
const app = spawn(appPath, [documentPath], {
  stdio: "ignore",
  windowsHide: true,
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  },
});

try {
  await waitForEndpoint();
  browser = await chromium.connectOverCDP(endpoint, { timeout: 10_000 });
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages.find((candidate) => /tauri|localhost/i.test(candidate.url())) || pages[0];
  assert(page, "没有找到轻阅 Markdown WebView2 页面");
  page.setDefaultTimeout(15_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.waitForLoadState("domcontentloaded");
  await page.locator("#document-title", { hasText: basename(documentPath) }).waitFor();
  await page.locator("[data-mode='editing']").click();
  const editor = page.locator("#editor");
  await editor.focus();
  await editor.evaluate((element, source) => {
    element.setSelectionRange(element.value.length, element.value.length);
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "Rust 图片");
    transfer.setData("text/html", `<h2>网页资料</h2><p><strong>真实下载</strong></p><img src="${source}" alt="Rust 图片">`);
    element.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    }));
  }, remoteImage);
  await page.locator("#save-status", { hasText: "1 张粘贴图片待保存" }).waitFor();
  await page.keyboard.press("Control+s");
  await page.locator("#save-status", { hasText: "1 张图片已存入 assets" }).waitFor();

  const markdown = await waitForSavedMarkdown(documentPath);
  const relativeImage = markdown.match(/!\[Rust 图片\]\((assets\/paste-[a-f0-9]{12}\.png)\)/)?.[1];
  assert(relativeImage, "磁盘 Markdown 中没有生成预期的图片相对路径");
  const imagePath = join(dirname(documentPath), ...relativeImage.split("/"));
  const imageBytes = await readFile(imagePath);
  assert(imageBytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "磁盘文件不是 PNG");
  assert((await stat(imagePath)).size > 1_000, "下载图片大小异常");
  assert(pageErrors.length === 0, `页面运行错误：${pageErrors.join(" | ")}`);

  console.log(JSON.stringify({
    documentPath,
    remoteImage,
    relativeImage,
    downloadedBytes: imageBytes.length,
    markdownReadBack: true,
    pageErrors,
  }, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (app.exitCode === null) app.kill();
  await rm(testRoot, { recursive: true, force: true });
}
