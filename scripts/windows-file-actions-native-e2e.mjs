import { access, readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { basename, dirname, join } from "node:path";

const endpoint = process.env.LIGHTMARK_CDP_URL || "http://127.0.0.1:9230";
const sourcePath = process.env.LIGHTMARK_E2E_FILE_ACTION_DOCUMENT;
if (!sourcePath) throw new Error("LIGHTMARK_E2E_FILE_ACTION_DOCUMENT is required");

const renamedName = "02-第二页 已重命名.md";
const renamedPath = join(dirname(sourcePath), renamedName);

function assert(condition, message) {
  if (!condition) throw new Error(`原生文件操作验收失败：${message}`);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const originalContents = await readFile(sourcePath, "utf8");
const browser = await chromium.connectOverCDP(endpoint, { timeout: 10_000 });
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((candidate) => /tauri|localhost/i.test(candidate.url())) || pages[0];
assert(page, "没有找到轻阅 Markdown 的 WebView2 页面");
page.setDefaultTimeout(12_000);
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

await page.waitForLoadState("domcontentloaded");
await page.locator("#documents-tab").click();
const sourceItem = page.locator("#document-list .document-item").filter({ hasText: basename(sourcePath) });
await sourceItem.waitFor();
assert(await sourceItem.getAttribute("title") === sourcePath, "列表中的验收文档不是指定临时副本");
await sourceItem.click({ button: "right" });
await page.getByRole("menuitem", { name: /重命名/ }).click();
await page.locator("#rename-input").fill("02-第二页 已重命名");
await page.locator("#rename-form").evaluate((form) => form.requestSubmit());
await page.locator("#rename-dialog").waitFor({ state: "hidden" });
await page.locator("#document-list .document-item").filter({ hasText: renamedName }).waitFor();
assert(!(await exists(sourcePath)), "原路径仍然存在");
assert(await exists(renamedPath), "新路径没有真实生成");
assert(await readFile(renamedPath, "utf8") === originalContents, "重命名改变了文档内容");

const renamedItem = page.locator("#document-list .document-item").filter({ hasText: renamedName });
assert(await renamedItem.getAttribute("title") === renamedPath, "重命名后的列表路径不是指定临时副本");
await renamedItem.click({ button: "right" });
await page.getByRole("menuitem", { name: "移到回收站" }).click();
assert((await page.locator("#delete-document-name").textContent()).includes(renamedName), "确认框没有显示完整文件名");
await page.locator("#cancel-delete").click();
assert(await exists(renamedPath), "取消删除后文件已经消失");

await renamedItem.click({ button: "right" });
await page.getByRole("menuitem", { name: "移到回收站" }).click();
await page.locator("#confirm-delete").click();
await page.waitForFunction((name) => ![...document.querySelectorAll("#document-list .document-name")].some((item) => item.textContent === name), renamedName);
assert(!(await exists(renamedPath)), "确认删除后文件仍留在原路径");
assert(await page.locator("#document-list .document-item").count() === 2, "删除后文档列表数量不正确");
assert(pageErrors.length === 0, `页面运行错误：${pageErrors.join(" | ")}`);

console.log(JSON.stringify({
  realRename: { from: sourcePath, to: renamedPath, contentsPreserved: true },
  cancelDeletePreservedFile: true,
  confirmedDeleteRemovedSource: true,
  destination: "Windows 回收站",
  remainingDocuments: 2,
}, null, 2));

await browser.close();
