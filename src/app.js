import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message, open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  directoryFromPath,
  extractHeadings,
  findTextMatches,
  fileNameFromPath,
  formatSelection,
  isExternalUrl,
  isMarkdownName,
  isRelativeImageSource,
  mapScrollByAnchors,
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
  fullscreenToggle: document.querySelector("#fullscreen-toggle"),
  copyMenuToggle: document.querySelector("#copy-menu-toggle"),
  copyMenu: document.querySelector("#copy-menu"),
  copyMenuItems: [...document.querySelectorAll("#copy-menu [data-copy-mode]")],
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
  findBar: document.querySelector("#document-find"),
  findInput: document.querySelector("#find-input"),
  findCount: document.querySelector("#find-count"),
  findPrevious: document.querySelector("#find-previous"),
  findNext: document.querySelector("#find-next"),
  findClose: document.querySelector("#find-close"),
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
  syntaxArticles: [...document.querySelectorAll("#syntax-grid article")],
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
  scrollAnchorFrame: 0,
  scrollAnchors: [],
  previewSyncOffset: 0,
  previewSyncUntil: 0,
  previewManualFrame: 0,
  sidebarView: "documents",
  copyFeedbackTimer: 0,
  findMatches: [],
  findIndex: -1,
};

const SIDEBAR_MIN_WIDTH = 190;
const SIDEBAR_MAX_WIDTH = 420;
const SPLIT_DIVIDER_WIDTH = 7;

const syntaxTemplates = Object.freeze({
  heading: [
    { label: "一级标题", text: "# 标题" },
    { label: "二级标题", text: "## 标题" },
  ],
  text: [
    { label: "粗体", text: "**粗体文字**" },
    { label: "斜体", text: "*斜体文字*" },
    { label: "删除线", text: "~~删除线文字~~" },
  ],
  highlight: [{ label: "黄色高光", text: "<mark>需要高光的文字</mark>" }],
  red: [{ label: "红色文字", text: '<span class="text-red">红色文字</span>' }],
  paragraph: [
    { label: "段首空两格", text: "　　正文从这里开始" },
    { label: "空出一整行", text: "上一段文字\n\n<br><br>\n\n下一段文字" },
  ],
  list: [
    { label: "无序列表", text: "- 第一项\n- 第二项" },
    { label: "有序列表", text: "1. 第一项\n2. 第二项" },
    { label: "嵌套列表", text: "- 第一层\n  - 第二层" },
  ],
  task: [{ label: "任务列表", text: "- [ ] 待完成\n- [x] 已完成" }],
  quote: [{ label: "引用", text: "> 引用内容" }],
  link: [
    { label: "普通链接", text: "[显示文字](https://example.com)" },
    { label: "自动链接", text: "<https://example.com>" },
  ],
  image: [{ label: "相对路径图片", text: "![图片说明](images/photo.png)" }],
  "obsidian-image": [
    { label: "Obsidian 图片", text: "![[asset/图片.png]]" },
    { label: "指定宽度图片", text: "![[asset/图片.png|480]]" },
  ],
  "inline-code": [{ label: "行内代码", text: "`代码`" }],
  "code-block": [{ label: "代码块", text: "```js\nconsole.log('Hello')\n```" }],
  table: [{ label: "表格", text: "| 名称 | 数值 |\n| --- | ---: |\n| 示例 | 100 |" }],
  divider: [
    { label: "分隔线", text: "---" },
    { label: "转义星号", text: "\\*显示星号，不作为斜体*" },
  ],
  callout: [
    { label: "基础 Callout", text: "> [!note] 自定义标题\n> 这里是内容" },
    { label: "默认收起", text: "> [!faq]- 默认收起\n> 收起的内容" },
    { label: "默认展开", text: "> [!tip]+ 默认展开\n> 展开的内容" },
    { label: "多层嵌套", text: "> [!question] 可以嵌套吗？\n> > [!todo] 可以\n> > > [!example] 支持多层" },
  ],
  wiki: [
    { label: "Wiki Link", text: "[[文档名称]]" },
    { label: "带别名", text: "[[文档名称|显示文字]]" },
  ],
  frontmatter: [{ label: "Frontmatter", text: "---\ntitle: 文档标题\ntags: [示例]\n---" }],
});

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
  elements.preview.contentWindow?.addEventListener("scroll", capturePreviewAlignment, { passive: true });
  renderPreview();
});

function bindPreviewLinks() {
  elements.preview.contentDocument?.addEventListener("click", async (event) => {
    const link = event.target.closest?.("a");
    if (!link) return;
    const href = link.getAttribute("href") || "";
    const wikiTarget = link.dataset.wikiTarget?.trim();
    if (!wikiTarget && href.startsWith("#")) return;
    event.preventDefault();
    if (isExternalUrl(href)) {
      try {
        await openUrl(href);
      } catch (error) {
        await showError("无法打开外部链接", error);
      }
      return;
    }
    const target = wikiTarget || href;
    if (!state.currentPath || !target) return;
    guardUnsaved(async () => {
      const resolvedPath = await invoke("resolve_markdown_link", {
        documentPath: state.currentPath,
        target,
      });
      await loadDocument(resolvedPath, { refreshSiblings: true });
    }).catch((error) => showError("无法打开 Markdown 链接", error));
  });
}

async function renderPreview() {
  if (!state.rendererReady) return;
  const generation = ++state.renderGeneration;
  const previewWindow = elements.preview.contentWindow;
  previewWindow.lightmarkRender(elements.editor.value);
  rebuildScrollAnchors();
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
  rebuildScrollAnchors();
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
  state.previewSyncUntil = performance.now() + 140;
  heading?.scrollIntoView({ block: "start", behavior: "auto" });
}

function jumpToHeading(heading, index) {
  state.previewSyncOffset = 0;
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
  state.previewSyncOffset = 0;
  state.lastSavedText = payload.contents;
  elements.editor.value = payload.contents;
  renderOutline();
  setFormatTool(null);
  elements.title.textContent = payload.name;
  elements.path.textContent = payload.path;
  setDirty(false);
  renderDocumentList();
  await renderPreview();
  updateCopyAvailability();
  if (!elements.findBar.hidden) refreshFindResults({ restart: true });
}

function singleDialogPath(result) {
  if (typeof result === "string") return result;
  return Array.isArray(result) && typeof result[0] === "string" ? result[0] : null;
}

async function chooseFile() {
  const path = singleDialogPath(await open({
    multiple: false,
    directory: false,
    title: "打开 Markdown 文件",
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
  }));
  if (path) await guardUnsaved(() => loadDocument(path, { refreshSiblings: true }));
}

async function chooseFolder() {
  const selectedPath = singleDialogPath(await open({
    multiple: false,
    directory: false,
    title: "选择文件夹中的任意 Markdown 文档",
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
  }));
  if (!selectedPath) return;
  const directoryPath = directoryFromPath(selectedPath);
  await guardUnsaved(async () => {
    await refreshDirectory(directoryPath);
    if (!state.documents.length) {
      await message("这个文件夹第一层没有 .md 或 .markdown 文件。", { title: "没有 Markdown 文档", kind: "info" });
      return;
    }
    const selectedDocument = state.documents.find((item) => item.path.toLocaleLowerCase() === selectedPath.toLocaleLowerCase());
    await loadDocument(selectedDocument?.path || state.documents[0].path);
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
  const previousMode = state.mode;
  state.mode = mode;
  if (mode === "split" && previousMode !== "split") state.previewSyncOffset = 0;
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
  if (mode === "split") requestAnimationFrame(() => {
    updateSplitLayout();
    rebuildScrollAnchors();
    syncPreviewToEditor();
  });
  if (mode !== "editing") renderPreview();
  if (!elements.findBar.hidden) requestAnimationFrame(() => refreshFindResults({ restart: true }));
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

function measureEditorHeadingPositions(offsets) {
  if (!offsets.length || elements.editor.clientWidth <= 0) return [];
  const style = getComputedStyle(elements.editor);
  const mirror = document.createElement("div");
  Object.assign(mirror.style, {
    position: "fixed",
    visibility: "hidden",
    pointerEvents: "none",
    left: "-100000px",
    top: "0",
    width: `${elements.editor.clientWidth}px`,
    height: "auto",
    minHeight: "0",
    overflow: "visible",
    boxSizing: "border-box",
    whiteSpace: "pre-wrap",
    overflowWrap: style.overflowWrap,
    wordBreak: style.wordBreak,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    wordSpacing: style.wordSpacing,
    tabSize: style.tabSize,
    paddingTop: style.paddingTop,
    paddingRight: style.paddingRight,
    paddingBottom: style.paddingBottom,
    paddingLeft: style.paddingLeft,
    border: "0",
  });
  const markers = [];
  let cursor = 0;
  offsets.forEach((offset) => {
    mirror.append(document.createTextNode(elements.editor.value.slice(cursor, offset)));
    const marker = document.createElement("span");
    marker.style.cssText = "display:inline-block;width:0;height:1em;padding:0;margin:0;";
    marker.textContent = "\u200b";
    mirror.append(marker);
    markers.push(marker);
    cursor = offset;
  });
  mirror.append(document.createTextNode(elements.editor.value.slice(cursor) || "\u200b"));
  document.body.append(mirror);
  const scale = elements.editor.scrollHeight / Math.max(1, mirror.scrollHeight);
  const positions = markers.map((marker) => marker.offsetTop * scale);
  mirror.remove();
  return positions;
}

function rebuildScrollAnchors() {
  if (!state.rendererReady || state.mode !== "split") return;
  const previewWindow = elements.preview.contentWindow;
  const previewDocument = elements.preview.contentDocument;
  const scroller = previewDocument?.scrollingElement;
  if (!previewWindow || !scroller) return;
  const renderedHeadings = [...previewDocument.querySelectorAll("h1, h2, h3, h4, h5, h6")];
  const count = Math.min(state.headings.length, renderedHeadings.length);
  const editorPositions = measureEditorHeadingPositions(state.headings.slice(0, count).map((heading) => heading.offset));
  const anchors = [{ editor: 0, preview: 0 }];
  for (let index = 0; index < count; index += 1) {
    const editor = editorPositions[index];
    const preview = renderedHeadings[index].getBoundingClientRect().top + previewWindow.scrollY;
    const previous = anchors[anchors.length - 1];
    if (editor > previous.editor + 1 && preview > previous.preview + 1) anchors.push({ editor, preview });
  }
  const end = { editor: elements.editor.scrollHeight, preview: scroller.scrollHeight };
  const previous = anchors[anchors.length - 1];
  if (end.editor > previous.editor && end.preview > previous.preview) anchors.push(end);
  state.scrollAnchors = anchors;
}

function scheduleScrollAnchorRebuild() {
  cancelAnimationFrame(state.scrollAnchorFrame);
  state.scrollAnchorFrame = requestAnimationFrame(() => {
    rebuildScrollAnchors();
    syncPreviewToEditor();
  });
}

function previewScrollTarget({ includeManualOffset = true } = {}) {
  const previewWindow = elements.preview.contentWindow;
  const scroller = elements.preview.contentDocument?.scrollingElement;
  if (!previewWindow || !scroller) return 0;
  const editorRange = Math.max(0, elements.editor.scrollHeight - elements.editor.clientHeight);
  const previewRange = Math.max(0, scroller.scrollHeight - previewWindow.innerHeight);
  if (elements.editor.scrollTop <= 1) {
    return Math.min(previewRange, Math.max(0, includeManualOffset ? state.previewSyncOffset : 0));
  }
  if (elements.editor.scrollTop >= editorRange - 1) return previewRange;
  const probeOffset = Math.min(180, elements.editor.clientHeight * 0.28);
  const editorProbe = elements.editor.scrollTop + probeOffset;
  const previewProbe = mapScrollByAnchors(editorProbe, state.scrollAnchors);
  const paneOffset = elements.editor.getBoundingClientRect().top - elements.preview.getBoundingClientRect().top;
  const manualOffset = includeManualOffset ? state.previewSyncOffset : 0;
  return Math.min(previewRange, Math.max(0, previewProbe - probeOffset - paneOffset + manualOffset));
}

function capturePreviewAlignment() {
  if (state.mode !== "split" || performance.now() < state.previewSyncUntil) return;
  cancelAnimationFrame(state.previewManualFrame);
  state.previewManualFrame = requestAnimationFrame(() => {
    if (state.mode !== "split" || performance.now() < state.previewSyncUntil) return;
    const actual = elements.preview.contentWindow?.scrollY || 0;
    state.previewSyncOffset = actual - previewScrollTarget({ includeManualOffset: false });
  });
}

function syncPreviewToEditor() {
  if (state.mode !== "split" || !state.rendererReady) return;
  cancelAnimationFrame(state.previewScrollFrame);
  state.previewScrollFrame = requestAnimationFrame(() => {
    if (!state.scrollAnchors.length) rebuildScrollAnchors();
    const previewWindow = elements.preview.contentWindow;
    const target = previewScrollTarget();
    state.previewSyncUntil = performance.now() + 140;
    previewWindow?.scrollTo({ top: target, behavior: "auto" });
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

function updateCopyAvailability() {
  elements.copyMenuToggle.disabled = !state.currentPath;
}

function setCopyMenu(openMenu) {
  elements.copyMenu.hidden = !openMenu;
  elements.copyMenuToggle.setAttribute("aria-expanded", String(openMenu));
  if (openMenu) elements.copyMenu.querySelector("button")?.focus();
}

function legacyCopy(text, html = null) {
  const selection = document.getSelection();
  const savedRanges = selection ? [...Array(selection.rangeCount)].map((_, index) => selection.getRangeAt(index).cloneRange()) : [];
  let temporary;
  if (html) {
    temporary = document.createElement("div");
    temporary.contentEditable = "true";
    temporary.innerHTML = html;
  } else {
    temporary = document.createElement("textarea");
    temporary.value = text;
  }
  temporary.setAttribute("aria-hidden", "true");
  temporary.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;";
  document.body.append(temporary);
  if (html) {
    const range = document.createRange();
    range.selectNodeContents(temporary);
    selection?.removeAllRanges();
    selection?.addRange(range);
  } else {
    temporary.select();
  }
  const copied = document.execCommand("copy");
  temporary.remove();
  selection?.removeAllRanges();
  savedRanges.forEach((range) => selection?.addRange(range));
  if (!copied) throw new Error("系统没有允许写入剪贴板。");
}

async function writeClipboard(text, html = null) {
  try {
    if (html && navigator.clipboard?.write && globalThis.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      })]);
      return;
    }
    if (!html && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // WebView2 may deny the asynchronous API; the user-initiated legacy path remains available.
  }
  legacyCopy(text, html);
}

function previewPage() {
  return elements.preview.contentDocument?.querySelector("#page");
}

function plainTextFromPreview() {
  return previewPage()?.innerText.trim() || elements.editor.value;
}

function richHtmlFromPreview() {
  const source = previewPage();
  if (!source) return `<article>${elements.editor.value}</article>`;
  const clone = source.cloneNode(true);
  const sourceNodes = [source, ...source.querySelectorAll("*")];
  const cloneNodes = [clone, ...clone.querySelectorAll("*")];
  const properties = [
    "display", "font-family", "font-size", "font-weight", "font-style", "line-height", "color",
    "background-color", "text-decoration", "text-align", "white-space", "margin", "padding", "border",
    "border-collapse", "list-style-type",
  ];
  sourceNodes.forEach((node, index) => {
    const destination = cloneNodes[index];
    if (!destination) return;
    const computed = elements.preview.contentWindow.getComputedStyle(node);
    properties.forEach((property) => {
      const value = computed.getPropertyValue(property);
      if (value) destination.style.setProperty(property, value);
    });
    destination.removeAttribute("id");
  });
  return `<article style="max-width:760px">${clone.innerHTML}</article>`;
}

function showCopyFeedback(label) {
  clearTimeout(state.copyFeedbackTimer);
  elements.saveStatus.textContent = `${label}已复制`;
  state.copyFeedbackTimer = setTimeout(() => setDirty(state.dirty), 1600);
}

async function copyDocument(mode) {
  if (!state.currentPath) return;
  await renderPreview();
  const labels = { markdown: "Markdown 原文", plain: "纯文本", rich: "富文本" };
  if (mode === "markdown") await writeClipboard(elements.editor.value);
  else if (mode === "plain") await writeClipboard(plainTextFromPreview());
  else if (mode === "rich") await writeClipboard(plainTextFromPreview(), richHtmlFromPreview());
  else return;
  setCopyMenu(false);
  showCopyFeedback(labels[mode]);
}

function updateFullscreenButton(isFullscreen) {
  elements.fullscreenToggle.textContent = isFullscreen ? "退出全屏" : "全屏";
  elements.fullscreenToggle.title = `${isFullscreen ? "退出" : "进入"}全屏幕（F11）`;
  elements.fullscreenToggle.setAttribute("aria-label", isFullscreen ? "退出全屏幕" : "进入全屏幕");
}

async function toggleFullscreen() {
  try {
    const appWindow = getCurrentWindow();
    const isFullscreen = await appWindow.isFullscreen();
    await appWindow.setFullscreen(!isFullscreen);
    updateFullscreenButton(!isFullscreen);
  } catch {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
    updateFullscreenButton(Boolean(document.fullscreenElement));
  }
}

function activeFindText() {
  return state.mode === "reading" ? plainTextFromPreview() : elements.editor.value;
}

function updateFindControls() {
  const total = state.findMatches.length;
  elements.findCount.value = total ? `${state.findIndex + 1} / ${total}` : "0 / 0";
  elements.findCount.textContent = elements.findCount.value;
  elements.findPrevious.disabled = total === 0;
  elements.findNext.disabled = total === 0;
}

function revealFindMatch({ backwards = false, restart = false } = {}) {
  if (state.findIndex < 0 || !state.findMatches.length) return;
  const query = elements.findInput.value;
  if (state.mode === "reading") {
    const previewWindow = elements.preview.contentWindow;
    if (restart) previewWindow.getSelection()?.removeAllRanges();
    previewWindow.find(query, false, backwards, true, false, false, false);
    return;
  }
  const start = state.findMatches[state.findIndex];
  elements.editor.setSelectionRange(start, start + query.length);
  const line = elements.editor.value.slice(0, start).split(/\r\n|\r|\n/).length - 1;
  const lineHeight = Number.parseFloat(getComputedStyle(elements.editor).lineHeight) || 24;
  elements.editor.scrollTop = Math.max(0, line * lineHeight - elements.editor.clientHeight * 0.28);
  if (state.mode === "split") syncPreviewToEditor();
}

function refreshFindResults({ restart = true } = {}) {
  state.findMatches = findTextMatches(activeFindText(), elements.findInput.value);
  if (!state.findMatches.length) state.findIndex = -1;
  else if (restart || state.findIndex < 0 || state.findIndex >= state.findMatches.length) state.findIndex = 0;
  updateFindControls();
  revealFindMatch({ restart });
}

function stepFind(by) {
  if (!state.findMatches.length) return;
  state.findIndex = (state.findIndex + by + state.findMatches.length) % state.findMatches.length;
  updateFindControls();
  revealFindMatch({ backwards: by < 0 });
}

function showFindBar() {
  if (elements.syntaxDialog.open) elements.syntaxDialog.close();
  elements.findBar.hidden = false;
  refreshFindResults();
  elements.findInput.focus();
  elements.findInput.select();
}

function closeFindBar() {
  elements.findBar.hidden = true;
  elements.preview.contentWindow?.getSelection()?.removeAllRanges();
  if (state.mode !== "reading") elements.editor.focus();
}

function initializeSyntaxCopyButtons() {
  elements.syntaxArticles.forEach((article) => {
    const templates = syntaxTemplates[article.dataset.syntax] || [];
    if (!templates.length) return;
    const actions = document.createElement("div");
    actions.className = "syntax-copy-actions";
    templates.forEach((template) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "syntax-copy-button";
      button.textContent = `复制${template.label}`;
      button.addEventListener("click", async () => {
        try {
          await writeClipboard(template.text);
          const previous = button.textContent;
          button.textContent = "已复制";
          button.classList.add("copied");
          setTimeout(() => {
            button.textContent = previous;
            button.classList.remove("copied");
          }, 1200);
        } catch (error) {
          await showError("无法复制语法格式", error);
        }
      });
      actions.append(button);
    });
    article.append(actions);
  });
}

function showSyntaxGuide() {
  if (!elements.syntaxDialog.open) elements.syntaxDialog.showModal();
  elements.syntaxDialog.querySelector(".syntax-copy-button")?.focus();
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
  if (!elements.findBar.hidden && state.mode !== "reading") refreshFindResults();
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
elements.fullscreenToggle.addEventListener("click", () => toggleFullscreen().catch((error) => showError("无法切换全屏幕", error)));
elements.syntaxHelp.addEventListener("click", showSyntaxGuide);
elements.copyMenuToggle.addEventListener("click", () => setCopyMenu(elements.copyMenu.hidden));
elements.copyMenuItems.forEach((button) => {
  button.addEventListener("click", () => copyDocument(button.dataset.copyMode).catch((error) => showError("无法复制文档", error)));
});
elements.findInput.addEventListener("input", () => refreshFindResults());
elements.findInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    stepFind(event.shiftKey ? -1 : 1);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeFindBar();
  }
});
elements.findPrevious.addEventListener("click", () => stepFind(-1));
elements.findNext.addEventListener("click", () => stepFind(1));
elements.findClose.addEventListener("click", closeFindBar);
document.addEventListener("pointerdown", (event) => {
  if (!elements.copyMenu.hidden && !event.target.closest(".copy-menu-wrap")) setCopyMenu(false);
});
for (const [tool, details] of Object.entries(formatToolDetails)) {
  details.button.addEventListener("mousedown", (event) => event.preventDefault());
  details.button.addEventListener("click", () => handleFormatToolClick(tool));
}
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
  if (event.key === "Escape" && !elements.copyMenu.hidden) {
    event.preventDefault();
    setCopyMenu(false);
    elements.copyMenuToggle.focus();
    return;
  }
  if (event.key === "Escape" && !elements.findBar.hidden) {
    event.preventDefault();
    closeFindBar();
    return;
  }
  if (event.key === "Escape" && state.formatTool) {
    event.preventDefault();
    setFormatTool(null);
    elements.editor.focus();
    return;
  }
  const control = event.ctrlKey || event.metaKey;
  if (event.key === "F11") {
    event.preventDefault();
    toggleFullscreen().catch((error) => showError("无法切换全屏幕", error));
    return;
  }
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
  if (control && event.shiftKey && event.key.toLocaleLowerCase() === "c") {
    event.preventDefault();
    copyDocument("markdown").catch((error) => showError("无法复制 Markdown 原文", error));
    return;
  }
  if (control && event.key.toLocaleLowerCase() === "f") {
    event.preventDefault();
    showFindBar();
    return;
  }
  if (control && event.key === "/") {
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
  initializeSyntaxCopyButtons();
  updateCopyAvailability();
  try {
    updateFullscreenButton(await getCurrentWindow().isFullscreen());
  } catch {
    updateFullscreenButton(Boolean(document.fullscreenElement));
  }
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
  scheduleScrollAnchorRebuild();
}).observe(elements.workspace);

start();
