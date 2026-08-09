import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { resolve } from "node:path";

const port = 14321;
const origin = `http://127.0.0.1:${port}`;
const documentPath = "C:\\标题折叠验收\\长 文档.md";
const repeated = Array.from({ length: 18 }, (_, index) => `四级长文第 ${index + 1} 段。`).join("\n\n");
const markdown = [
  "# 一级总标题",
  "一级正文",
  "",
  "## 二级标题",
  "二级正文",
  "",
  "### 三级甲",
  "三级正文",
  "",
  "#### 四级甲",
  repeated,
  "",
  "##### 五级甲",
  "五级正文",
  "",
  "###### 六级甲",
  "六级正文",
  "",
  "##### 五级乙",
  "五级同级正文",
  "",
  "#### 四级乙",
  "四级同级正文",
  "",
  "### 三级乙",
  "三级同级正文",
].join("\n");

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
  const page = await browser.newPage({ viewport: { width: 1500, height: 920 } });
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
          directory: "C:\\标题折叠验收",
          name: "长 文档.md",
          contents: fixtureMarkdown,
        };
        if (command === "list_markdown_files") return [{ path: fixturePath, name: "长 文档.md" }];
        if (command === "list_image_files") return [];
        if (command === "plugin:window|is_fullscreen") return false;
        if (command === "plugin:event|listen") return ++callbackId;
        if (command.startsWith("plugin:")) return null;
        if (command === "write_document") return null;
        throw new Error(`未模拟的 Tauri 命令：${command}`);
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  }, { fixturePath: documentPath, fixtureMarkdown: markdown });

  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.locator("#document-title", { hasText: "长 文档.md" }).waitFor();
  const preview = page.frameLocator("#preview");
  await preview.locator("h6", { hasText: "六级甲" }).waitFor();

  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.locator("#editor");
  await editor.press("Control+End");
  const beforeBreak = await editor.inputValue();
  await page.locator("#line-break-insert").click();
  assert((await editor.inputValue()).endsWith("<br>"), "工具栏没有插入单个 <br>");
  await editor.press("Control+z");
  assert(await editor.inputValue() === beforeBreak, "单个 <br> 无法用 Ctrl+Z 撤销");
  await editor.press("Alt+Digit3");
  assert((await editor.inputValue()).endsWith("<br>"), "Alt+3 没有插入单个 <br>");
  await editor.press("Control+z");
  await page.getByRole("button", { name: "阅读", exact: true }).click();

  await page.locator("#outline-tab").click();
  const outlineArrows = page.locator("#outline-list .outline-fold-toggle");
  const previewArrows = preview.locator(".heading-fold-toggle");
  assert(await outlineArrows.count() === 9, "目录没有为一至六级的每个标题显示箭头");
  assert(await previewArrows.count() === 9, "正文没有为一至六级的每个标题显示箭头");

  const fourAlphaRow = page.locator("#outline-list .outline-row").filter({ hasText: "四级甲" });
  const fourBetaRow = page.locator("#outline-list .outline-row").filter({ hasText: "四级乙" });
  const fiveAlphaRow = page.locator("#outline-list .outline-row").filter({ hasText: "五级甲" });
  await fourAlphaRow.locator(".outline-fold-toggle").click();
  assert(await fiveAlphaRow.isHidden(), "目录收起四级后仍显示五级标题");
  assert(await fourBetaRow.isVisible(), "收起四级错误隐藏了下一个同级四级标题");
  assert(await preview.locator("h5", { hasText: "五级甲" }).isHidden(), "目录收起没有同步到正文");
  assert(await preview.getByText("四级长文第 18 段。", { exact: true }).isHidden(), "长正文没有随四级标题收起");

  await preview.locator("h4", { hasText: "四级甲" }).locator(".heading-fold-toggle").click();
  assert(await fiveAlphaRow.isVisible(), "正文展开没有同步恢复目录子标题");
  await preview.locator("h6", { hasText: "六级甲" }).locator(".heading-fold-toggle").click();
  assert(await preview.getByText("六级正文", { exact: true }).isHidden(), "六级标题不能收起自己的正文");
  assert(await page.locator("#outline-list .outline-row").filter({ hasText: "五级乙" }).isVisible(), "六级收起错误隐藏了后续更高层级标题");

  await preview.locator("h3", { hasText: "三级甲" }).locator(".heading-fold-toggle").click();
  assert(await fourAlphaRow.isHidden() && await fourBetaRow.isHidden(), "三级标题没有收起其下全部四至六级标题");
  const threeAlphaRow = page.locator("#outline-list .outline-row").filter({ hasText: "三级甲" });
  assert(await threeAlphaRow.locator(".outline-fold-toggle").getAttribute("aria-expanded") === "false", "正文收起没有同步改变目录箭头");
  await threeAlphaRow.locator(".outline-fold-toggle").click();
  assert(await preview.locator("h4", { hasText: "四级甲" }).isVisible(), "目录展开没有同步恢复正文");
  assert(pageErrors.length === 0, `页面运行错误：${pageErrors.join(" | ")}`);

  console.log(JSON.stringify({
    singleBreak: "按钮与 Alt+3 通过",
    outlineArrowCount: await outlineArrows.count(),
    previewArrowCount: await previewArrows.count(),
    nestedFold: "一至六级层级边界与双向同步通过",
    longDocumentParagraphs: 18,
  }, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
