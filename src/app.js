import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message, open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  directoryFromPath,
  extractHeadings,
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
  workspace: document.querySelector(".workspace"),
  sidebar: document.querySelector("#sidebar"),
  documentsTab: document.querySelector("#documents-tab"),
  outlineTab: document.querySelector("#outline-tab"),
  sidebarResizer: document.querySelector("#sidebar-resizer"),
  collapseSidebar: document.querySelector("#collapse-sidebar"),
  expandSidebar: document.querySelector("#expand-sidebar"),
  folderName: document.querySelector("#folder-name"),
  documentList: document.querySelector("#document-list"),
  outlineList: document.querySelector("#outline-list"),
  emptyList: document.querySelector("#empty-list"),
  emptyOutline: document.querySelector("#empty-outline"),
  title: document.querySelector("#document-title"),
  path: document.querySelector("#document-path"),
  dirtyDot: document.querySelector("#dirty-dot"),
  contentPanes: document.querySelector("#content-panes"),
  editorPane: document.querySelector("#editor-pane"),
  previewPane: document.querySelector("#preview-pane"),
  splitResizer: document.querySelector("#split-resizer"),
  paneSwap: document.querySelector("#pane-swap"),
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
  headings: [],
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
  editorSide: localStorage.getItem("lightmark-editor-side") === "right" ? "right" : "left",
  editorSplitRatio: Math.min(0.75, Math.max(0.25, Number(localStorage.getItem("lightmark-editor-split-ratio")) || 0.44)),
  sidebarWidth: Math.min(420, Math.max(190, Number(localStorage.getItem("lightmark-sidebar-width")) || 268)),
  previewScrollFrame: 0,
  sidebarView: "documents",
};

const SIDEBAR_MIN_WIDTH = 190;
const SIDEBAR_MAX_WIDTH = 420;
const SPLIT_DIVIDER_WIDTH = 7;

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
  syncPreviewToEditor();

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
  syncPreviewToEditor();
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
  updateSidebarView();
}

function updateSidebarView() {
  const showingDocuments = state.sidebarView === "documents";
  elements.documentsTab.classList.toggle("active", showingDocuments);
  elements.outlineTab.classList.toggle("active", !showingDocuments);
  elements.documentsTab.setAttribute("aria-selected", String(showingDocuments));
  elements.outlineTab.setAttribute("aria-selected", String(!showingDocuments));
  elements.documentList.hidden = !showingDocuments;
  elements.outlineList.hidden = showingDocuments;
  elements.emptyList.hidden = !showingDocuments || state.documents.length > 0;
  elements.emptyOutline.hidden = showingDocuments || state.headings.length > 0;
}

function setSidebarView(view) {
  state.sidebarView = view === "outline" ? "outline" : "documents";
  updateSidebarView();
}

function renderOutline() {
  state.headings = extractHeadings(elements.editor.value);
  elements.outlineList.replaceChildren();
  state.headings.forEach((heading, index) => {
    const button = document.createElement("button");
    button.className = "outline-item";
    button.dataset.level = String(heading.level);
    button.style.setProperty("--outline-indent", `${9 + (heading.level - 1) * 14}px`);
    button.textContent = heading.title;
    button.title = heading.title;
    button.addEventListener("click", () => jumpToHeading(heading, index));
    elements.outlineList.append(button);
  });
  updateSidebarView();
}

function scrollPreviewToHeading(index) {
  const heading = elements.preview.contentDocument?.querySelectorAll("h1, h2, h3, h4, h5, h6")[index];
  heading?.scrollIntoView({ block: "start", behavior: "auto" });
}

function jumpToHeading(heading, index) {
  if (state.mode === "reading") {
    scrollPreviewToHeading(index);
    return;
  }
  elements.editor.focus();
  elements.editor.setSelectionRange(heading.offset, heading.offset);
  const scrollRange = Math.max(0, elements.editor.scrollHeight - elements.editor.clientHeight);
  const documentRatio = elements.editor.value.length ? heading.offset / elements.editor.value.length : 0;
  elements.editor.scrollTop = Math.max(0, scrollRange * documentRatio - elements.editor.clientHeight * 0.16);
  if (state.mode === "split") setTimeout(() => scrollPreviewToHeading(index), 0);
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
  renderOutline();
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
  elements.contentPanes.classList.remove("reading-mode", "editing-mode", "split-mode");
  elements.contentPanes.classList.add(`${mode}-mode`);
  updatePaneOrder();
  elements.modeButtons.forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  elements.modeStatus.textContent = mode === "reading"
    ? "阅读模式 · ← → 翻页"
    : mode === "editing"
      ? "编辑模式 · 方向键移动光标"
      : "分栏模式 · 编辑与预览同步跟随";
  elements.paneSwap.disabled = mode !== "split";
  if (mode === "reading") setFormatTool(null);
  if (mode !== "reading") elements.editor.focus();
  if (mode === "split") requestAnimationFrame(updateSplitLayout);
  if (mode !== "editing") renderPreview();
}

function updatePaneOrder() {
  const editorRight = state.editorSide === "right";
  elements.contentPanes.classList.toggle("editor-right", editorRight);
  elements.paneSwap.setAttribute("aria-pressed", String(editorRight));
  const label = editorRight ? "把编辑区移到左侧" : "把编辑区移到右侧";
  elements.paneSwap.title = label;
  elements.paneSwap.setAttribute("aria-label", label);
}

function swapPaneSides() {
  state.editorSide = state.editorSide === "left" ? "right" : "left";
  localStorage.setItem("lightmark-editor-side", state.editorSide);
  updatePaneOrder();
  updateSplitLayout();
  elements.editor.focus();
}

function splitMetrics() {
  const total = Math.max(0, elements.contentPanes.clientWidth - SPLIT_DIVIDER_WIDTH);
  const editorMinimum = Math.min(280, total / 2);
  const previewMinimum = Math.min(320, total / 2);
  return { total, editorMinimum, previewMinimum };
}

function setSplitFromLeftWidth(leftWidth, { persist = false } = {}) {
  const { total, editorMinimum, previewMinimum } = splitMetrics();
  if (total <= 0) return;
  const firstMinimum = state.editorSide === "left" ? editorMinimum : previewMinimum;
  const secondMinimum = state.editorSide === "left" ? previewMinimum : editorMinimum;
  const boundedLeft = Math.min(total - secondMinimum, Math.max(firstMinimum, leftWidth));
  const editorWidth = state.editorSide === "left" ? boundedLeft : total - boundedLeft;
  state.editorSplitRatio = Math.min(0.75, Math.max(0.25, editorWidth / total));
  elements.contentPanes.style.setProperty("--split-left-width", `${Math.round(boundedLeft)}px`);
  elements.splitResizer.setAttribute("aria-valuenow", String(Math.round(state.editorSplitRatio * 100)));
  elements.splitResizer.setAttribute("aria-valuetext", `编辑区 ${Math.round(state.editorSplitRatio * 100)}%`);
  if (persist) localStorage.setItem("lightmark-editor-split-ratio", String(state.editorSplitRatio));
}

function updateSplitLayout() {
  const { total } = splitMetrics();
  if (total <= 0) return;
  const leftRatio = state.editorSide === "left" ? state.editorSplitRatio : 1 - state.editorSplitRatio;
  setSplitFromLeftWidth(total * leftRatio);
}

function updateSidebarWidth(width = state.sidebarWidth, { persist = false } = {}) {
  const workspaceLimit = Math.max(SIDEBAR_MIN_WIDTH, elements.workspace.clientWidth - 360);
  state.sidebarWidth = Math.min(SIDEBAR_MAX_WIDTH, workspaceLimit, Math.max(SIDEBAR_MIN_WIDTH, width));
  document.documentElement.style.setProperty("--sidebar-width", `${Math.round(state.sidebarWidth)}px`);
  elements.sidebarResizer.setAttribute("aria-valuenow", String(Math.round(state.sidebarWidth)));
  if (persist) localStorage.setItem("lightmark-sidebar-width", String(state.sidebarWidth));
}

function beginResize(resizer, className, onMove, onFinish) {
  return (event) => {
    if (event.button !== 0 || matchMedia("(max-width: 720px)").matches) return;
    event.preventDefault();
    resizer.setPointerCapture(event.pointerId);
    resizer.classList.add("active");
    elements.workspace.classList.add("is-resizing", className);
    const move = (moveEvent) => onMove(moveEvent);
    const finish = (finishEvent) => {
      if (resizer.hasPointerCapture(finishEvent.pointerId)) resizer.releasePointerCapture(finishEvent.pointerId);
      resizer.classList.remove("active");
      elements.workspace.classList.remove("is-resizing", className);
      resizer.removeEventListener("pointermove", move);
      resizer.removeEventListener("pointerup", finish);
      resizer.removeEventListener("pointercancel", finish);
      onFinish();
    };
    resizer.addEventListener("pointermove", move);
    resizer.addEventListener("pointerup", finish);
    resizer.addEventListener("pointercancel", finish);
  };
}

function syncPreviewToEditor() {
  if (state.mode !== "split" || !state.rendererReady) return;
  cancelAnimationFrame(state.previewScrollFrame);
  state.previewScrollFrame = requestAnimationFrame(() => {
    const editorRange = Math.max(1, elements.editor.scrollHeight - elements.editor.clientHeight);
    const ratio = Math.min(1, Math.max(0, elements.editor.scrollTop / editorRange));
    const previewWindow = elements.preview.contentWindow;
    const previewDocument = elements.preview.contentDocument;
    const scroller = previewDocument?.scrollingElement;
    const previewRange = Math.max(0, (scroller?.scrollHeight || 0) - (previewWindow?.innerHeight || 0));
    previewWindow?.scrollTo({ top: ratio * previewRange, behavior: "auto" });
  });
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
  if (!collapsed) requestAnimationFrame(() => updateSidebarWidth());
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
  renderOutline();
  renderPreview();
});
elements.editor.addEventListener("scroll", syncPreviewToEditor, { passive: true });
elements.editor.addEventListener("keyup", syncPreviewToEditor);
elements.editor.addEventListener("click", syncPreviewToEditor);
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
elements.documentsTab.addEventListener("click", () => setSidebarView("documents"));
elements.outlineTab.addEventListener("click", () => setSidebarView("outline"));
elements.paneSwap.addEventListener("click", swapPaneSides);
elements.sidebarResizer.addEventListener("pointerdown", beginResize(
  elements.sidebarResizer,
  "is-resizing-sidebar",
  (event) => {
    const workspaceLeft = elements.workspace.getBoundingClientRect().left;
    updateSidebarWidth(event.clientX - workspaceLeft);
  },
  () => updateSidebarWidth(state.sidebarWidth, { persist: true }),
));
elements.splitResizer.addEventListener("pointerdown", beginResize(
  elements.splitResizer,
  "is-resizing-split",
  (event) => {
    const panesLeft = elements.contentPanes.getBoundingClientRect().left;
    setSplitFromLeftWidth(event.clientX - panesLeft);
  },
  () => setSplitFromLeftWidth(
    elements.splitResizer.getBoundingClientRect().left - elements.contentPanes.getBoundingClientRect().left,
    { persist: true },
  ),
));
elements.sidebarResizer.addEventListener("keydown", (event) => {
  const changes = { ArrowLeft: -12, ArrowRight: 12, Home: SIDEBAR_MIN_WIDTH, End: SIDEBAR_MAX_WIDTH };
  if (!(event.key in changes)) return;
  event.preventDefault();
  const width = event.key === "Home" || event.key === "End" ? changes[event.key] : state.sidebarWidth + changes[event.key];
  updateSidebarWidth(width, { persist: true });
});
elements.splitResizer.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const { total } = splitMetrics();
  const currentLeft = (state.editorSide === "left" ? state.editorSplitRatio : 1 - state.editorSplitRatio) * total;
  const nextLeft = event.key === "Home" ? total * 0.25 : event.key === "End" ? total * 0.75 : currentLeft + (event.key === "ArrowLeft" ? -16 : 16);
  setSplitFromLeftWidth(nextLeft, { persist: true });
});
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
  updateSidebarWidth();
  updatePaneOrder();
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

new ResizeObserver(() => {
  updateSidebarWidth();
  updateSplitLayout();
}).observe(elements.workspace);

start();
