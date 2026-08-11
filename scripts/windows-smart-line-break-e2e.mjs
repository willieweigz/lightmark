import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { resolve } from "node:path";

const port = 14323;
const origin = `http://127.0.0.1:${port}`;
const documentPath = "C:\\轻阅 换行验收\\自然换行.md";
const markdown = "第一行\n第二行";

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
  await page.addInitScript(({ fixturePath, fixtureMarkdown }) => {
    let callbackId = 0;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: () => ++callbackId,
      invoke: async (command) => {
        if (command === "startup_paths") return [fixturePath];
        if (command === "read_document") return {
          path: fixturePath,
          directory: "C:\\轻阅 换行验收",
          name: "自然换行.md",
          contents: fixtureMarkdown,
        };
        if (command === "list_markdown_files") return [{ path: fixturePath, name: "自然换行.md" }];
        if (command === "list_image_files") return [];
        if (command === "plugin:window|is_fullscreen") return false;
        if (command === "plugin:event|listen") return ++callbackId;
        if (command.startsWith("plugin:")) return null;
        throw new Error(`未模拟的 Tauri 命令：${command}`);
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  }, { fixturePath: documentPath, fixtureMarkdown: markdown });

  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.locator("#document-title", { hasText: "自然换行.md" }).waitFor();
  let preview = page.frameLocator("#preview");
  await preview.locator("p", { hasText: "第一行" }).waitFor();
  assert(await page.locator("#line-break-toggle").textContent() === "换行：标准", "首次打开没有使用标准换行");
  assert(await preview.locator("#page > p br").count() === 0, "标准换行错误插入了换行元素");

  await page.locator("#line-break-toggle").click();
  await preview.locator("#page > p br").waitFor({ state: "attached" });
  assert(await page.locator("#line-break-toggle").textContent() === "换行：自然", "没有切换到自然换行");
  assert(await page.locator("#editor").inputValue() === markdown, "自然换行改写了 Markdown 原文");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#document-title", { hasText: "自然换行.md" }).waitFor();
  preview = page.frameLocator("#preview");
  await preview.locator("#page > p br").waitFor({ state: "attached" });
  assert(await page.locator("#line-break-toggle").textContent() === "换行：自然", "重新打开后没有记住自然换行");

  await page.locator("#line-break-toggle").click();
  await page.waitForFunction(() => document.querySelector("#line-break-toggle")?.textContent === "换行：标准");
  assert(await preview.locator("#page > p br").count() === 0, "切回标准换行后仍然保留换行元素");
  assert(pageErrors.length === 0, `页面运行错误：${pageErrors.join(" | ")}`);

  console.log(JSON.stringify({
    defaultMode: "标准换行",
    naturalBreakCount: 1,
    sourcePreserved: true,
    preferenceRemembered: true,
    switchedBackToStandard: true,
  }, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
