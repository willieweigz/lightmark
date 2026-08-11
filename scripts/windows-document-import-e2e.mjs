import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { resolve } from "node:path";

const port = 14324;
const origin = `http://127.0.0.1:${port}`;
const sourcePath = "C:\\轻阅 导入验收\\中文 课程资料.docx";
const outputPath = "C:\\轻阅 导入验收\\中文 课程资料.md";
const convertedMarkdown = "# 中文课程\n\n| 课程 | 课时 |\n| --- | ---: |\n| 历史 | 10 |\n";

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
  const page = await browser.newPage({ viewport: { width: 1600, height: 940 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(({ source, output, markdown }) => {
    let callbackId = 0;
    let savedMarkdown = "";
    window.__importAcceptance = { openOptions: null, saveOptions: null, importCalls: [], saveCalls: [], sourceWrites: 0 };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: () => ++callbackId,
      invoke: async (command, args = {}) => {
        if (command === "startup_paths") return [];
        if (command === "plugin:dialog|open") {
          window.__importAcceptance.openOptions = args.options;
          return source;
        }
        if (command === "plugin:dialog|save") {
          window.__importAcceptance.saveOptions = args.options;
          return output;
        }
        if (command === "plugin:dialog|message") return null;
        if (command === "import_document") {
          window.__importAcceptance.importCalls.push(args.path);
          return {
            sourceName: "中文 课程资料.docx",
            sourcePath: source,
            directory: "C:\\轻阅 导入验收",
            suggestedName: "中文 课程资料.md",
            suggestedPath: output,
            contents: markdown,
            formatLabel: "Word",
            assetCount: 2,
            skippedAssetCount: 0,
          };
        }
        if (command === "save_imported_document") {
          window.__importAcceptance.saveCalls.push(args);
          savedMarkdown = `${args.contents.trimEnd()}\n\n---\n\n## 导入的图片\n\n![导入图片 1](中文%20课程资料.assets/image-001.png)\n`;
          return {
            documentPath: output,
            assetDirectory: "C:\\轻阅 导入验收\\中文 课程资料.assets",
            extractedAssetCount: 2,
            skippedAssetCount: 0,
          };
        }
        if (command === "write_document") {
          if (args.path === source) window.__importAcceptance.sourceWrites += 1;
          return null;
        }
        if (command === "read_document") return {
          path: output,
          directory: "C:\\轻阅 导入验收",
          name: "中文 课程资料.md",
          contents: savedMarkdown,
        };
        if (command === "read_relative_image") return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
        if (command === "list_markdown_files") return savedMarkdown ? [{ path: output, name: "中文 课程资料.md" }] : [];
        if (command === "list_image_files") return [];
        if (command === "plugin:window|is_fullscreen") return false;
        if (command === "plugin:event|listen") return ++callbackId;
        if (command.startsWith("plugin:")) return null;
        throw new Error(`未模拟的 Tauri 命令：${command}`);
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  }, { source: sourcePath, output: outputPath, markdown: convertedMarkdown });

  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await page.locator("#document-title", { hasText: "中文 课程资料.md" }).waitFor();
  assert(await page.locator("#import-badge").textContent() === "离线导入 · 2 张图", "没有显示离线导入与图片数量");
  assert(await page.locator("#save-status").textContent() === "离线导入预览 · Ctrl+S 保存为 Markdown", "没有提示先预览再保存");
  const preview = page.frameLocator("#preview");
  await preview.getByRole("heading", { name: "中文课程" }).waitFor();
  assert(await preview.locator("table").count() === 1, "导入后的 Markdown 表格没有正常预览");

  await page.keyboard.press("Control+s");
  await page.locator("#document-title", { hasText: "中文 课程资料.md" }).waitFor();
  await page.waitForFunction(() => document.querySelector("#save-status")?.textContent === "已保存");

  const acceptance = await page.evaluate(() => window.__importAcceptance);
  assert(acceptance.importCalls.length === 1 && acceptance.importCalls[0] === sourcePath, "没有转换所选源文档");
  assert(acceptance.saveCalls.length === 1, "Ctrl+S 没有调用导入专用保存流程");
  assert(acceptance.saveCalls[0].sourcePath === sourcePath, "保存时丢失了源文档路径");
  assert(acceptance.saveCalls[0].path === outputPath, "没有保存到用户选择的 Markdown 路径");
  assert(acceptance.saveCalls[0].contents === convertedMarkdown, "保存时没有保留预览中的 Markdown 内容");
  assert(acceptance.sourceWrites === 0, "错误改写了源 Word 文档");
  assert(acceptance.saveOptions.defaultPath === outputPath, "保存对话框没有使用源文件旁的建议文件名");
  assert(acceptance.openOptions.filters[0].extensions.includes("docx"), "导入对话框没有 Word 格式");
  assert(acceptance.openOptions.filters[0].extensions.includes("pdf"), "导入对话框没有 PDF 格式");
  assert(await page.locator("#import-badge").isHidden(), "保存后仍错误显示导入预览标记");
  assert(pageErrors.length === 0, `页面运行错误：${pageErrors.join(" | ")}`);

  console.log(JSON.stringify({
    source: sourcePath,
    output: outputPath,
    offlinePreview: true,
    headingAndTableRendered: true,
    extractedImages: 2,
    sourcePreserved: true,
    ctrlSReadback: true,
  }, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
