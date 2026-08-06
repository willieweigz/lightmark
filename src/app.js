import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message, open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  directoryFromPath,
  fileNameFromPath,
  formatSelection,
  isExternalUrl,
  isMarkdownName,
  isRelativeImageSource,
  sortDocuments,
} from "./core.js";

const elements = {
  openFile: document.querySelector("#open-file"),
  openFolder: document.querySelector("#open-folder"),
  saveFile: document.querySelector("#save-file"),
  saveAs: document.querySelector("#save-as"),
  previous: document.querySelector("#previous-document"),
  next: document.querySelector("#next-document"),
  pageIndicator: document.querySelector("#page-indicator"),
  modeButtons: [...document.querySelectorAll("[data-mode]")],
  themeToggle: document.querySelector("#theme-toggle"),
  syntaxHelp: document.querySelector("#syntax-help"),
  sidebar: document.querySelector("#sidebar"),
  collapseSidebar: document.querySelector("#collapse-sidebar"),
  expandSidebar: document.querySelector("#expand-sidebar"),
  folderName: document.querySelector("#folder-name"),
  documentList: document.querySelector("#document-list"),
  emptyList: document.querySelector("#empty-list"),
  title: document.querySelector("#document-title"),
  path: document.querySelector("#document-path"),
  dirtyDot: document.querySelector("#dirty-dot"),
  contentPanes: document.querySelector("#content-panes"),
  formattingToolbar: document.querySelector(".formatting-toolbar"),
  highlightTool: document.querySelector("#highlight-tool"),
  redTextTool: document.querySelector("#red-text-tool"),
  formattingHint: document.querySelector("#formatting-hint"),
  editor: document.querySelector("#editor"),
  preview: document.querySelector("#preview"),
  previewLoading: document.querySelector("#preview-loading"),
  saveStatus: document.querySelector("#save-status"),
  modeStatus: document.querySelector("#mode-status"),
  syntaxDialog: document.querySelector("#syntax-dialog"),
  syntaxSearch: document.querySelector("#syntax-search"),
  syntaxArticles: [...document.querySelectorAll("#syntax-grid article")],
  syntaxNoResults: document.querySelector("#syntax-no-results"),
  unsavedDialog: document.querySelector("#unsaved-dialog"),
  cancelPending: document.querySelector("#cancel-pending"),
  discardPending: document.querySelector("#discard-pending"),
  savePending: document.querySelector("#save-pending"),
};

const state = {
  documents: [],
  currentPath: null,
  currentDirectory: null,
  lastSavedText: "",
  dirty: false,
  mode: "reading",
  rendererReady: false,
  renderGeneration: 0,
  pendingAction: null,
  formatTool: null,
  theme: localStorage.getItem("lightmark-theme") || "system",
};

listen("single-instance", (event) => {
  const paths = Array.isArray(event.payload) ? event.payload : [];
  const markdownPath = paths.find(isMarkdownName);
  if (markdownPath) {
    guardUnsaved(() => loadDocument(markdownPath, { refreshSiblings: true }))
      .catch((error) => showError("无法打开文档", error));
  }
}).catch(console.error);

async function prepareRenderer() {
  elements.preview.src = "/preview.html";
}

elements.preview.addEventListener("load", () => {
  state.rendererReady = true;
  elements.previewLoading.classList.add("hidden");
  bindPreviewLinks();
  renderPreview();
});

function bindPreviewLinks() {
  elements.preview.contentDocument?.addEventListener("click", async (event) => {
    const link = event.target.closest?.("a");
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute("href") || "";
    if (isExternalUrl(href)) {
      try {
        await openUrl(href);
      } catch (error) {
        await showError("无法打开外部链接", error);
      }
    }
  });
}

async function renderPreview() {
  if (!state.rendererReady) return;
  const generation = ++state.renderGeneration;
  const previewWindow = elements.preview.contentWindow;
  previewWindow.lightmarkRender(elements.editor.value);

  const images = [...elements.preview.contentDocument.querySelectorAll("img")];
  await Promise.all(images.map(async (image) => {
    const source = image.getAttribute("src") || "";
    if (/^https?:/i.test(source)) {
      image.removeAttribute("src");
      image.title = "远程图片已阻止；轻阅 Markdown 只离线加载本地相对路径图片。";
      return;
    }
    if (!state.currentPath || !isRelativeImageSource(source)) return;
    try {
      const dataUrl = await invoke("read_relative_image", {
        documentPath: state.currentPath,
        source,
      });
      if (generation === state.renderGeneration) image.src = dataUrl;
    } catch {
      image.title = `无法加载本地图片：${source}`;
    }
  }));
}

function setDirty(dirty) {
  state.dirty = dirty;
  elements.dirtyDot.classList.toggle("visible", dirty);
  elements.saveStatus.textContent = dirty ? "有未保存修改 · Ctrl+S 保存" : state.currentPath ? "已保存" : "未打开文档";
  updateWindowTitle();
}

async function updateWindowTitle() {
  const title = state.currentPath ? fileNameFromPath(state.currentPath) : "轻阅 Markdown";
  document.title = `${state.dirty ? "● " : ""}${title} — 轻阅 Markdown`;
  try {
    await getCurrentWindow().setTitle(document.title);
  } catch {
    // The browser-only development view has no native window.
  }
}

async function refreshDirectory(directoryPath) {
  const documents = await invoke("list_markdown_files", { directoryPath });
  state.documents = sortDocuments(documents);
  state.currentDirectory = directoryPath;
  elements.folderName.textContent = fileNameFromPath(directoryPath) || directoryPath;
  renderDocumentList();
}

function renderDocumentList() {
  elements.documentList.replaceChildren();
  elements.emptyList.hidden = state.documents.length > 0;
  state.documents.forEach((documentEntry, index) => {
    const button = document.createElement("button");
    button.className = "document-item";
    button.classList.toggle("active", documentEntry.path === state.currentPath);
    button.setAttribute("aria-current", documentEntry.path === state.currentPath ? "page" : "false");
    button.title = documentEntry.path;
    button.innerHTML = `<span class="document-number">${String(index + 1).padStart(2, "0")}</span><span class="document-name"></span>`;
    button.querySelector(".document-name").textContent = documentEntry.name;
    button.addEventListener("click", () => guardUnsaved(() => loadDocument(documentEntry.path)));
    elements.documentList.append(button);
  });
  updateNavigation();
}

async function loadDocument(path, { refreshSiblings = false } = {}) {
  const payload = await invoke("read_document", { path });
  if (refreshSiblings || state.currentDirectory !== payload.directory) {
    await refreshDirectory(payload.directory);
  }
  state.currentPath = payload.path;
  state.currentDirectory = payload.directory;
  state.lastSavedText = payload.contents;
  elements.editor.value = payload.contents;
  setFormatTool(null);
  elements.title.textContent = payload.name;
  elements.path.textContent = payload.path;
  setDirty(false);
  renderDocumentList();
  await renderPreview();
}

async function chooseFile() {
  const path = await open({
    multiple: false,
    directory: false,
    title: "打开 Markdown 文件",
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
  });
  if (typeof path === "string") await guardUnsaved(() => loadDocument(path, { refreshSiblings: true }));
}

async function chooseFolder() {
  const directoryPath = await open({ multiple: false, directory: true, title: "打开 Markdown 文件夹" });
  if (typeof directoryPath !== "string") return;
  await guardUnsaved(async () => {
    await refreshDirectory(directoryPath);
    if (!state.documents.length) {
      await message("这个文件夹第一层没有 .md 或 .markdown 文件。", { title: "没有 Markdown 文档", kind: "info" });
      return;
    }
    await loadDocument(state.documents[0].path);
  });
}

async function saveDocument() {
  if (!state.currentPath) return saveDocumentAs();
  await invoke("write_document", { path: state.currentPath, contents: elements.editor.value });
  state.lastSavedText = elements.editor.value;
  setDirty(false);
  return true;
}

async function saveDocumentAs() {
  const path = await save({
    title: "另存为 Markdown",
    defaultPath: state.currentPath || "未命名.md",
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
  });
  if (typeof path !== "string") return false;
  await invoke("write_document", { path, contents: elements.editor.value });
  await loadDocument(path, { refreshSiblings: true });
  return true;
}

async function guardUnsaved(action) {
  if (!state.dirty) return action();
  state.pendingAction = action;
  elements.unsavedDialog.showModal();
}

async function runPendingAction() {
  const action = state.pendingAction;
  state.pendingAction = null;
  if (action) await action();
}

function currentIndex() {
  return state.documents.findIndex((item) => item.path === state.currentPath);
}

function updateNavigation() {
  const index = currentIndex();
  const total = state.documents.length;
  elements.pageIndicator.value = index >= 0 ? `${index + 1} / ${total}` : total ? `— / ${total}` : "— / —";
  elements.pageIndicator.textContent = elements.pageIndicator.value;
  elements.previous.disabled = index <= 0;
  elements.next.disabled = index < 0 || index >= total - 1;
}

async function navigate(by) {
  const index = currentIndex();
  const destination = state.documents[index + by];
  if (destination) await guardUnsaved(() => loadDocument(destination.path));
}

function setMode(mode) {
  state.mode = mode;
  elements.contentPanes.className = `content-panes ${mode}-mode`;
  elements.modeButtons.forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  elements.modeStatus.textContent = mode === "reading"
    ? "阅读模式 · ← → 翻页"
    : mode === "editing"
      ? "编辑模式 · 方向键移动光标"
      : "分栏模式 · 实时预览";
  if (mode === "reading") setFormatTool(null);
  if (mode !== "reading") elements.editor.focus();
  if (mode !== "editing") renderPreview();
}

const formatToolDetails = {
  highlight: { button: elements.highlightTool, label: "黄色高光笔" },
  redText: { button: elements.redTextTool, label: "红色笔" },
};

function setFormatTool(tool) {
  state.formatTool = tool;
  Object.entries(formatToolDetails).forEach(([name, details]) => {
    details.button.setAttribute("aria-pressed", String(name === tool));
  });
  elements.formattingToolbar.classList.toggle("tool-active", Boolean(tool));
  elements.formattingHint.textContent = tool
    ? `${formatToolDetails[tool].label}已开启 · 拖选文字即可标记 · Esc 退出`
    : "先选中文字再点按钮，或先开启画笔再拖选";
}

function applyEditorFormat(tool) {
  const result = formatSelection(
    elements.editor.value,
    elements.editor.selectionStart,
    elements.editor.selectionEnd,
    tool,
  );
  if (!result.applied) {
    elements.formattingHint.textContent = result.reason === "multiple-blocks"
      ? "一次请只标记同一段文字"
      : "请先选中要标记的文字";
    return false;
  }

  elements.editor.value = result.text;
  elements.editor.focus();
  elements.editor.setSelectionRange(result.selectionStart, result.selectionEnd);
  elements.editor.dispatchEvent(new Event("input", { bubbles: true }));
  if (!state.formatTool) {
    elements.formattingHint.textContent = result.removed ? "已移除文字标记" : "已添加文字标记";
  }
  return true;
}

function handleFormatToolClick(tool) {
  if (state.formatTool) {
    setFormatTool(state.formatTool === tool ? null : tool);
    elements.editor.focus();
    return;
  }
  if (elements.editor.selectionStart !== elements.editor.selectionEnd) {
    applyEditorFormat(tool);
    return;
  }
  setFormatTool(tool);
  elements.editor.focus();
}

function toggleSidebar() {
  const collapsed = elements.sidebar.classList.toggle("collapsed");
  elements.expandSidebar.classList.toggle("visible", collapsed);
}

function applyTheme(theme) {
  state.theme = theme;
  localStorage.setItem("lightmark-theme", theme);
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = theme;
  const labels = { system: "系统主题", light: "浅色主题", dark: "深色主题" };
  elements.themeToggle.textContent = labels[theme];
  elements.themeToggle.title = `主题：${labels[theme]}`;
}

function cycleTheme() {
  const themes = ["system", "light", "dark"];
  applyTheme(themes[(themes.indexOf(state.theme) + 1) % themes.length]);
}

function filterSyntaxGuide() {
  const query = elements.syntaxSearch.value.trim().toLocaleLowerCase();
  let visible = 0;
  elements.syntaxArticles.forEach((article) => {
    const haystack = `${article.dataset.search} ${article.textContent}`.toLocaleLowerCase();
    const matches = !query || haystack.includes(query);
    article.hidden = !matches;
    if (matches) visible += 1;
  });
  elements.syntaxNoResults.hidden = visible !== 0;
}

function showSyntaxGuide() {
  if (!elements.syntaxDialog.open) elements.syntaxDialog.showModal();
  elements.syntaxSearch.focus();
}

async function handleDroppedPath(path) {
  await guardUnsaved(async () => {
    if (isMarkdownName(path)) {
      await loadDocument(path, { refreshSiblings: true });
      return;
    }
    try {
      await refreshDirectory(path);
      if (state.documents.length) await loadDocument(state.documents[0].path);
      else await message("拖入的文件夹第一层没有 Markdown 文档。", { title: "没有 Markdown 文档", kind: "info" });
    } catch (error) {
      await showError("无法打开拖入项目", error);
    }
  });
}

async function showError(title, error) {
  console.error(title, error);
  await message(String(error), { title, kind: "error" });
}

elements.editor.addEventListener("input", () => {
  setDirty(elements.editor.value !== state.lastSavedText);
  renderPreview();
});
elements.editor.addEventListener("mouseup", () => {
  if (state.formatTool && elements.editor.selectionStart !== elements.editor.selectionEnd) {
    requestAnimationFrame(() => applyEditorFormat(state.formatTool));
  }
});
elements.openFile.addEventListener("click", () => chooseFile().catch((error) => showError("无法打开文件", error)));
elements.openFolder.addEventListener("click", () => chooseFolder().catch((error) => showError("无法打开文件夹", error)));
elements.saveFile.addEventListener("click", () => saveDocument().catch((error) => showError("无法保存文件", error)));
elements.saveAs.addEventListener("click", () => saveDocumentAs().catch((error) => showError("无法另存文件", error)));
elements.previous.addEventListener("click", () => navigate(-1).catch((error) => showError("无法打开上一篇", error)));
elements.next.addEventListener("click", () => navigate(1).catch((error) => showError("无法打开下一篇", error)));
elements.modeButtons.forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
elements.collapseSidebar.addEventListener("click", toggleSidebar);
elements.expandSidebar.addEventListener("click", toggleSidebar);
elements.themeToggle.addEventListener("click", cycleTheme);
elements.syntaxHelp.addEventListener("click", showSyntaxGuide);
for (const [tool, details] of Object.entries(formatToolDetails)) {
  details.button.addEventListener("mousedown", (event) => event.preventDefault());
  details.button.addEventListener("click", () => handleFormatToolClick(tool));
}
elements.syntaxSearch.addEventListener("input", filterSyntaxGuide);
elements.cancelPending.addEventListener("click", () => {
  state.pendingAction = null;
  elements.unsavedDialog.close();
});
elements.discardPending.addEventListener("click", async () => {
  elements.unsavedDialog.close();
  setDirty(false);
  await runPendingAction();
});
elements.savePending.addEventListener("click", async () => {
  try {
    const saved = await saveDocument();
    if (!saved) return;
    elements.unsavedDialog.close();
    await runPendingAction();
  } catch (error) {
    await showError("无法保存文件", error);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.formatTool) {
    event.preventDefault();
    setFormatTool(null);
    elements.editor.focus();
    return;
  }
  const control = event.ctrlKey || event.metaKey;
  if (control && event.key.toLocaleLowerCase() === "s") {
    event.preventDefault();
    const action = event.shiftKey ? saveDocumentAs() : saveDocument();
    action.catch((error) => showError("无法保存文件", error));
    return;
  }
  if (control && event.key.toLocaleLowerCase() === "o") {
    event.preventDefault();
    const action = event.shiftKey ? chooseFolder() : chooseFile();
    action.catch((error) => showError("无法打开", error));
    return;
  }
  if (control && (event.key === "/" || event.key.toLocaleLowerCase() === "f")) {
    event.preventDefault();
    showSyntaxGuide();
    return;
  }
  if (control && event.key === "\\") {
    event.preventDefault();
    toggleSidebar();
    return;
  }
  if (state.mode === "reading" && !elements.syntaxDialog.open && !elements.unsavedDialog.open) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      navigate(-1).catch((error) => showError("无法打开上一篇", error));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      navigate(1).catch((error) => showError("无法打开下一篇", error));
    }
  }
});

getCurrentWebview().onDragDropEvent((event) => {
  if (event.payload.type === "drop" && event.payload.paths?.[0]) {
    handleDroppedPath(event.payload.paths[0]);
  }
}).catch(console.error);

getCurrentWindow().onCloseRequested((event) => {
  if (!state.dirty) return;
  event.preventDefault();
  guardUnsaved(() => getCurrentWindow().destroy());
}).catch(console.error);

async function start() {
  applyTheme(state.theme);
  setMode("reading");
  await prepareRenderer();
  try {
    const startupPaths = await invoke("startup_paths");
    const firstMarkdown = startupPaths.find(isMarkdownName);
    if (firstMarkdown) await loadDocument(firstMarkdown, { refreshSiblings: true });
  } catch (error) {
    await showError("无法处理启动文件", error);
  }
}

start();
