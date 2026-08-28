import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { resolve } from "node:path";

const port = 14326;
const origin = `http://127.0.0.1:${port}`;
const directory = "G:\\轻阅 验收\\中文 资料";
const originalPath = `${directory}\\02-第二篇.md`;
const renamedPath = `${directory}\\02-中文 新名称.md`;
const replacementPath = `${directory}\\10-第十篇.markdown`;

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
    const documents = new Map([
      [`${directoryPath}\\01-第一篇.md`, "# 第一篇"],
      [startPath, "# 第二篇\n\n待修改内容"],
      [`${directoryPath}\\10-第十篇.markdown`, "# 第十篇"],
    ]);
    const entry = (path) => ({ path, name: path.split("\\").at(-1) });
    window.__fileActionAcceptance = { renames: [], trashRequests: [], documents };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: () => ++callbackId,
      invoke: async (command, args = {}) => {
        if (command === "startup_paths") return [startPath];
        if (command === "list_markdown_files") return [...documents.keys()].map(entry);
        if (command === "list_image_files") return [];
        if (command === "read_document") return {
          ...entry(args.path),
          directory: directoryPath,
          contents: documents.get(args.path) ?? "",
        };
        if (command === "rename_markdown_document") {
          const oldContents = documents.get(args.path);
          if (oldContents === undefined) throw new Error("源文件不存在");
          let name = args.newName.trim();
          if (!/\.(?:md|markdown)$/i.test(name)) name += args.path.toLocaleLowerCase().endsWith(".markdown") ? ".markdown" : ".md";
          const nextPath = `${directoryPath}\\${name}`;
          if (documents.has(nextPath)) throw new Error("同一文件夹中已经有这个文件名。");
          documents.delete(args.path);
          documents.set(nextPath, oldContents);
          window.__fileActionAcceptance.renames.push({ path: args.path, newName: args.newName, result: nextPath });
          return entry(nextPath);
        }
        if (command === "trash_markdown_document") {
          window.__fileActionAcceptance.trashRequests.push(args.path);
          documents.delete(args.path);
          return null;
        }
        if (command === "plugin:window|is_fullscreen") return false;
        if (command === "plugin:event|listen") return ++callbackId;
        if (command.startsWith("plugin:")) return null;
        throw new Error(`未模拟的 Tauri 命令：${command}`);
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  }, { directoryPath: directory, startPath: originalPath });

  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.locator("#document-title", { hasText: "02-第二篇.md" }).waitFor();
  const activeItem = page.locator("#document-list .document-item.active");
  await activeItem.click({ button: "right" });
  await page.locator("#document-context-menu").waitFor({ state: "visible" });
  assert(await page.getByRole("menuitem", { name: /重命名/ }).isVisible(), "右键菜单没有重命名");
  assert(await page.getByRole("menuitem", { name: "移到回收站" }).isVisible(), "右键菜单没有删除入口");

  await page.getByRole("menuitem", { name: /重命名/ }).click();
  await page.locator("#rename-dialog").waitFor({ state: "visible" });
  assert(await page.locator("#rename-input").inputValue() === "02-第二篇.md", "重命名没有带入原文件名");
  await page.locator("#rename-input").fill("01-第一篇.md");
  await page.locator("#rename-form").evaluate((form) => form.requestSubmit());
  await page.locator("#rename-error", { hasText: "已经有这个文件名" }).waitFor();
  assert(await page.locator("#rename-dialog").isVisible(), "遇到同名文件时重命名对话框被错误关闭");

  await page.locator("#rename-input").fill("02-中文 新名称");
  await page.locator("#rename-form").evaluate((form) => form.requestSubmit());
  await page.locator("#rename-dialog").waitFor({ state: "hidden" });
  await page.locator("#document-title", { hasText: "02-中文 新名称.md" }).waitFor();
  assert(await page.locator("#document-path").textContent() === renamedPath, "当前文档路径没有同步为新路径");
  assert(await page.locator("#page-indicator").textContent() === "2 / 3", "重命名后页码或自然排序错误");
  assert(await page.locator("#document-list .document-item.active .document-name").textContent() === "02-中文 新名称.md", "重命名后当前高亮错误");

  await page.locator("[data-mode='editing']").click();
  await page.locator("#editor").fill("尚未保存的修改");
  await page.locator("#document-list .document-item.active").click({ button: "right" });
  await page.getByRole("menuitem", { name: "移到回收站" }).click();
  await page.locator("#delete-dialog").waitFor({ state: "visible" });
  assert((await page.locator("#delete-document-name").textContent()).includes("02-中文 新名称.md"), "删除确认没有显示完整文件名");
  assert(await page.locator("#delete-unsaved-warning").isVisible(), "删除有未保存修改的当前文档时没有额外警告");
  await page.locator("#cancel-delete").click();
  assert((await page.evaluate(() => window.__fileActionAcceptance.trashRequests.length)) === 0, "取消确认后仍执行了删除");

  await page.locator("#document-list .document-item.active").click({ button: "right" });
  await page.getByRole("menuitem", { name: "移到回收站" }).click();
  await page.locator("#confirm-delete").click();
  await page.locator("#document-title", { hasText: "10-第十篇.markdown" }).waitFor();
  assert((await page.evaluate(() => window.__fileActionAcceptance.trashRequests))?.[0] === renamedPath, "确认删除没有把正确文件交给回收站命令");
  assert(await page.locator("#page-indicator").textContent() === "2 / 2", "删除当前文档后没有打开相邻文档");
  assert(await page.locator("#next-document").isDisabled(), "删除后最后一篇的下一篇按钮未禁用");
  assert(!(await page.locator("#previous-document").isDisabled()), "删除后上一页按钮被错误禁用");
  assert(await page.locator("#document-list .document-item.active").getAttribute("title") === replacementPath, "删除后相邻文档没有高亮");
  assert(pageErrors.length === 0, `页面运行错误：${pageErrors.join(" | ")}`);

  const acceptance = await page.evaluate(() => ({
    renames: window.__fileActionAcceptance.renames,
    trashRequests: window.__fileActionAcceptance.trashRequests,
  }));
  console.log(JSON.stringify({
    contextMenu: ["重命名", "移到回收站"],
    duplicateProtection: true,
    rename: acceptance.renames[0],
    deleteConfirmation: true,
    unsavedWarning: true,
    recycleBinRequest: acceptance.trashRequests[0],
    replacementDocument: replacementPath,
    finalPage: "2 / 2",
  }, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
