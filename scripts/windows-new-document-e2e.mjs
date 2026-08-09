import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { resolve } from "node:path";

const port = 14322;
const origin = `http://127.0.0.1:${port}`;
const firstPath = "C:\\轻阅 验收\\第一篇.md";
const secondPath = "C:\\轻阅 验收\\第二篇.markdown";

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
  await page.addInitScript(({ paths }) => {
    let callbackId = 0;
    let saveIndex = 0;
    const documents = new Map();
    window.__newDocumentAcceptance = { saveOptions: [], writes: [] };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: () => ++callbackId,
      invoke: async (command, args = {}) => {
        if (command === "startup_paths") return [];
        if (command === "plugin:dialog|save") {
          window.__newDocumentAcceptance.saveOptions.push(args.options);
          return paths[saveIndex++];
        }
        if (command === "write_document") {
          documents.set(args.path, args.contents);
          window.__newDocumentAcceptance.writes.push({ path: args.path, contents: args.contents });
          return null;
        }
        if (command === "read_document") {
          return {
            path: args.path,
            directory: "C:\\轻阅 验收",
            name: args.path.split("\\").at(-1),
            contents: documents.get(args.path) ?? "",
          };
        }
        if (command === "list_markdown_files") {
          return [...documents.keys()].map((path) => ({ path, name: path.split("\\").at(-1) }));
        }
        if (command === "list_image_files") return [];
        if (command === "plugin:window|is_fullscreen") return false;
        if (command === "plugin:event|listen") return ++callbackId;
        if (command.startsWith("plugin:")) return null;
        throw new Error(`未模拟的 Tauri 命令：${command}`);
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  }, { paths: [firstPath, secondPath] });

  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.locator("#document-title", { hasText: "第一篇.md" }).waitFor();
  assert(await page.locator("[data-mode='editing']").getAttribute("aria-pressed") === "true", "新文档没有直接进入编辑模式");
  assert(await page.locator("#editor").evaluate((editor) => document.activeElement === editor), "新文档编辑框没有获得焦点");
  assert(await page.locator("#document-list .document-item").count() === 1, "新文档没有加入当前文件夹列表");

  await page.locator("#editor").fill("尚未保存的修改");
  await page.keyboard.press("Control+n");
  await page.locator("#unsaved-dialog").waitFor({ state: "visible" });
  const beforeDiscard = await page.evaluate(() => window.__newDocumentAcceptance);
  assert(beforeDiscard.writes.length === 1, "未保存保护弹出前已经错误创建了第二个文件");
  await page.locator("#discard-pending").click();
  await page.locator("#document-title", { hasText: "第二篇.markdown" }).waitFor();
  assert(await page.locator("#document-list .document-item").count() === 2, "Ctrl+N 新建的第二篇没有加入列表");

  const acceptance = await page.evaluate(() => window.__newDocumentAcceptance);
  assert(acceptance.writes.length === 2, "按钮与 Ctrl+N 没有各自写入一个文件");
  assert(acceptance.writes.every((write) => write.contents === ""), "新建文件不是空白 Markdown");
  assert(acceptance.saveOptions[0].defaultPath === "新建文档.md", "首次新建没有使用清楚的默认文件名");
  assert(acceptance.saveOptions[1].defaultPath === "C:\\轻阅 验收\\新建文档.md", "再次新建没有从当前文档文件夹开始");
  assert(pageErrors.length === 0, `页面运行错误：${pageErrors.join(" | ")}`);

  console.log(JSON.stringify({
    buttonNew: firstPath,
    shortcutNew: secondPath,
    blankWrites: acceptance.writes.length,
    currentFolderSuggestion: acceptance.saveOptions[1].defaultPath,
    editingMode: true,
    unsavedProtection: true,
  }, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
