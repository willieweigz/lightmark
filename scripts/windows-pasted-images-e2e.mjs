import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { resolve } from "node:path";

const port = 14327;
const origin = `http://127.0.0.1:${port}`;
const directory = "G:\\轻阅 验收\\网页粘贴";
const documentPath = `${directory}\\资料.md`;

function assert(condition, message) {
  if (!condition) throw new Error(`验收失败：${message}`);
}

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error("Vite 验收服务没有按时启动");
}

const viteEntry = resolve("node_modules", "vite", "bin", "vite.js");
const server = spawn(process.execPath, [viteEntry, "--host", "127.0.0.1", "--port", String(port)], {
  cwd: resolve("."),
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let browser;

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(({ directoryPath, startPath }) => {
    let callbackId = 0;
    let documentContents = "# 原文\n\n";
    window.__pasteAcceptance = { saves: [], ordinaryPastePrevented: null };
    const entry = { path: startPath, name: "资料.md" };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: () => ++callbackId,
      invoke: async (command, args = {}) => {
        if (command === "startup_paths") return [startPath];
        if (command === "list_markdown_files") return [entry];
        if (command === "list_image_files") return [];
        if (command === "read_document") return {
          ...entry,
          directory: directoryPath,
          contents: documentContents,
        };
        if (command === "save_document_with_pasted_images") {
          window.__pasteAcceptance.saves.push(structuredClone(args));
          const placeholder = `lightmark-paste-image://${args.images[0].id}`;
          documentContents = args.contents.replace(placeholder, "assets/paste-demo.png");
          return {
            contents: documentContents,
            savedImageCount: 1,
            reusedImageCount: 0,
            assetDirectory: `${directoryPath}\\assets`,
          };
        }
        if (command === "write_document") throw new Error("带图片的保存错误地绕过了图片保存命令");
        if (command === "read_relative_image") {
          return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
        }
        if (command === "plugin:window|is_fullscreen") return false;
        if (command === "plugin:event|listen") return ++callbackId;
        if (command.startsWith("plugin:")) return null;
        throw new Error(`未模拟的 Tauri 命令：${command}`);
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  }, { directoryPath: directory, startPath: documentPath });

  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.locator("#document-title", { hasText: "资料.md" }).waitFor();
  await page.locator("[data-mode='editing']").click();
  const editor = page.locator("#editor");
  await editor.focus();
  await editor.evaluate((element) => {
    element.setSelectionRange(element.value.length, element.value.length);
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "网页标题 第一段 重点 来源 网页图片");
    transfer.setData("text/html", [
      "<h2>网页标题</h2>",
      "<p>第一段 <strong>重点</strong> <a href='https://example.com/source'>来源</a></p>",
      "<img src='https://images.example.com/中文%20photo.png' alt='胃部示意图'>",
      "<ul><li>条目一</li><li>条目二</li></ul>",
    ].join(""));
    element.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    }));
  });

  const pasted = await editor.inputValue();
  assert(pasted.includes("## 网页标题"), "网页二级标题没有转成 Markdown");
  assert(pasted.includes("**重点**"), "网页粗体没有转成 Markdown");
  assert(pasted.includes("[来源](https://example.com/source)"), "网页链接没有转成 Markdown");
  assert(pasted.includes("![胃部示意图](lightmark-paste-image://"), "图片没有生成待保存标记");
  assert(pasted.includes("- 条目一"), "网页列表没有转成 Markdown");
  assert((await page.locator("#save-status").textContent()).includes("1 张粘贴图片待保存"), "界面没有提示待保存图片");

  const ordinaryPasteNotPrevented = await editor.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "普通文本");
    transfer.setData("text/html", "<p>普通文本，没有图片</p>");
    return element.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    }));
  });
  assert(ordinaryPasteNotPrevented, "不含图片的普通粘贴被错误拦截");

  await page.keyboard.press("Control+s");
  await page.waitForFunction(() => window.__pasteAcceptance.saves.length === 1);
  await page.waitForFunction(() => document.querySelector("#editor").value.includes("assets/paste-demo.png"));
  const acceptance = await page.evaluate(() => window.__pasteAcceptance);
  assert(acceptance.saves[0].path === documentPath, "图片没有保存到当前 Markdown 所在路径");
  assert(acceptance.saves[0].images.length === 1, "图片保存命令收到的图片数量错误");
  assert(
    acceptance.saves[0].images[0].source === "https://images.example.com/中文%20photo.png",
    "图片原始网址被错误改写",
  );
  assert((await editor.inputValue()).includes("![胃部示意图](assets/paste-demo.png)"), "保存后 Markdown 没有改为 assets 相对路径");
  assert((await page.locator("#save-status").textContent()).includes("1 张图片已存入 assets"), "保存完成提示不正确");
  assert(pageErrors.length === 0, `页面运行错误：${pageErrors.join(" | ")}`);

  console.log(JSON.stringify({
    source: acceptance.saves[0].images[0].source,
    target: "assets/paste-demo.png",
    richTextConverted: ["标题", "粗体", "链接", "列表", "图片"],
    ordinaryPasteUnaffected: true,
    savedWithCtrlS: true,
    pageErrors,
  }, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
