import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message, open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { accountLabel, answerModeDetails, chooseAiContext, contextPreview, normalizeAnswerMode } from "./ai.js";
import {
  applyTextCompletion,
  buildHeadingSections,
  directoryFromPath,
  extractHeadings,
  findHtmlCompletionContext,
  findTextMatches,
  fileNameFromPath,
  formatSelection,
  imageExtensions,
  isExternalUrl,
  isRelativeImageSource,
  mapScrollByAnchors,
  preferredOpenDirectory,
  renderEditorDecorations,
  sortDocuments,
  suggestedNewDocumentPath,
  supportedFileKind,
} from "./core.js";

const elements = {
  newFile: document.querySelector("#new-file"),
  openFile: document.querySelector("#open-file"),
  openFolder: document.querySelector("#open-folder"),
  saveFile: document.querySelector("#save-file"),
  saveAs: document.querySelector("#save-as"),
  previous: document.querySelector("#previous-document"),
  next: document.querySelector("#next-document"),
  pageIndicator: document.querySelector("#page-indicator"),
  modeSwitcher: document.querySelector("#mode-switcher"),
  modeButtons: [...document.querySelectorAll("[data-mode]")],
  themeToggle: document.querySelector("#theme-toggle"),
  syntaxHelp: document.querySelector("#syntax-help"),
  fullscreenToggle: document.querySelector("#fullscreen-toggle"),
  copyMenuToggle: document.querySelector("#copy-menu-toggle"),
  copyMenu: document.querySelector("#copy-menu"),
  copyMenuItems: [...document.querySelectorAll("#copy-menu [data-copy-mode]")],
  aiToggle: document.querySelector("#ai-toggle"),
  workspace: document.querySelector(".workspace"),
  sidebar: document.querySelector("#sidebar"),
  documentsTab: document.querySelector("#documents-tab"),
  imagesTab: document.querySelector("#images-tab"),
  outlineTab: document.querySelector("#outline-tab"),
  sidebarResizer: document.querySelector("#sidebar-resizer"),
  collapseSidebar: document.querySelector("#collapse-sidebar"),
  expandSidebar: document.querySelector("#expand-sidebar"),
  folderName: document.querySelector("#folder-name"),
  documentList: document.querySelector("#document-list"),
  imageList: document.querySelector("#image-list"),
  outlineList: document.querySelector("#outline-list"),
  emptyList: document.querySelector("#empty-list"),
  emptyImages: document.querySelector("#empty-images"),
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
  syncMode: document.querySelector("#sync-mode"),
  resetSync: document.querySelector("#reset-sync"),
  formattingToolbar: document.querySelector(".formatting-toolbar"),
  highlightTool: document.querySelector("#highlight-tool"),
  redTextTool: document.querySelector("#red-text-tool"),
  formattingHint: document.querySelector("#formatting-hint"),
  indentInsert: document.querySelector("#indent-insert"),
  lineBreakInsert: document.querySelector("#line-break-insert"),
  blankBreakInsert: document.querySelector("#blank-break-insert"),
  editorOverlay: document.querySelector("#editor-overlay"),
  editor: document.querySelector("#editor"),
  htmlCompletion: document.querySelector("#html-completion"),
  preview: document.querySelector("#preview"),
  previewLoading: document.querySelector("#preview-loading"),
  imageViewer: document.querySelector("#image-viewer"),
  imageStage: document.querySelector("#image-stage"),
  imageCanvas: document.querySelector("#image-canvas"),
  imageContent: document.querySelector("#image-content"),
  imageLoading: document.querySelector("#image-loading"),
  imageZoomOut: document.querySelector("#image-zoom-out"),
  imageZoomIn: document.querySelector("#image-zoom-in"),
  imageZoomLabel: document.querySelector("#image-zoom-label"),
  imageFit: document.querySelector("#image-fit"),
  imageActual: document.querySelector("#image-actual"),
  imageDetails: document.querySelector("#image-details"),
  saveStatus: document.querySelector("#save-status"),
  modeStatus: document.querySelector("#mode-status"),
  syntaxDialog: document.querySelector("#syntax-dialog"),
  syntaxArticles: [...document.querySelectorAll("#syntax-grid article")],
  unsavedDialog: document.querySelector("#unsaved-dialog"),
  cancelPending: document.querySelector("#cancel-pending"),
  discardPending: document.querySelector("#discard-pending"),
  savePending: document.querySelector("#save-pending"),
  aiSidebar: document.querySelector("#ai-sidebar"),
  aiResizer: document.querySelector("#ai-resizer"),
  aiClose: document.querySelector("#ai-close"),
  aiNewChat: document.querySelector("#ai-new-chat"),
  aiConnectionDot: document.querySelector("#ai-connection-dot"),
  aiConnectionLabel: document.querySelector("#ai-connection-label"),
  aiModelLabel: document.querySelector("#ai-model-label"),
  aiContextMode: document.querySelector("#ai-context-mode"),
  aiContextSummary: document.querySelector("#ai-context-summary"),
  aiAnswerMode: document.querySelector("#ai-answer-mode"),
  aiAnswerSummary: document.querySelector("#ai-answer-summary"),
  aiMessages: document.querySelector("#ai-messages"),
  aiEmpty: document.querySelector("#ai-empty"),
  aiSuggestions: [...document.querySelectorAll("[data-ai-prompt]")],
  aiForm: document.querySelector("#ai-form"),
  aiQuestion: document.querySelector("#ai-question"),
  aiPrivacyNote: document.querySelector("#ai-privacy-note"),
  aiStop: document.querySelector("#ai-stop"),
  aiSend: document.querySelector("#ai-send"),
};

const state = {
  documents: [],
  images: [],
  headings: [],
  collapsedHeadingKeys: new Set(),
  contentKind: "markdown",
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
  previewProgrammaticTarget: null,
  previewManualFrame: 0,
  scrollSyncMode: ["auto", "manual", "off"].includes(localStorage.getItem("lightmark-scroll-sync-mode"))
    ? localStorage.getItem("lightmark-scroll-sync-mode")
    : "auto",
  completionContext: null,
  completionItems: [],
  completionIndex: 0,
  sidebarView: "documents",
  imageScale: 1,
  imageZoomMode: "fit",
  imageNaturalWidth: 0,
  imageNaturalHeight: 0,
  imageByteSize: 0,
  imageMimeType: "",
  imageDrag: null,
  copyFeedbackTimer: 0,
  findMatches: [],
  findIndex: -1,
  aiOpen: false,
  aiReady: false,
  aiSignedIn: false,
  aiBusy: false,
  aiWidth: Math.min(560, Math.max(300, Number(localStorage.getItem("lightmark-ai-width")) || 360)),
  aiAssistantBody: null,
};

const SIDEBAR_MIN_WIDTH = 190;
const SIDEBAR_MAX_WIDTH = 420;
const SPLIT_DIVIDER_WIDTH = 7;
const AI_MIN_WIDTH = 300;
const AI_MAX_WIDTH = 560;
const IMAGE_MIN_SCALE = 0.05;
const IMAGE_MAX_SCALE = 8;
const IMAGE_ZOOM_MODE_STORAGE_KEY = "lightmark-image-zoom-mode";
const IMAGE_ZOOM_SCALE_STORAGE_KEY = "lightmark-image-zoom-scale";

const htmlCompletions = Object.freeze([
  { key: "br", label: "换到下一行", text: "<br>" },
  { key: "brbr", label: "空出一整行", text: "<br><br>" },
  { key: "mark", label: "黄色高光", text: "<mark>高光文字</mark>", selectionStart: 6, selectionEnd: 10 },
  { key: "span", aliases: ["red"], label: "红色文字", text: '<span class="text-red">红色文字</span>', selectionStart: 23, selectionEnd: 27 },
]);

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
    { label: "&emsp;&emsp;", text: "&emsp;&emsp;" },
    { label: "两个全角空格", text: "　　" },
    { label: "<br>", text: "<br>" },
    { label: "<br><br>", text: "<br><br>" },
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
  const supportedPath = paths.find((path) => supportedFileKind(path));
  if (supportedPath) {
    guardUnsaved(() => openSupportedPath(supportedPath, { refreshSiblings: true }))
      .catch((error) => showError("无法打开文件", error));
  }
}).catch(console.error);

listen("codex-ai-event", (event) => handleAiEvent(event.payload)).catch(console.error);

async function prepareRenderer() {
  elements.preview.src = "/preview.html";
}

elements.preview.addEventListener("load", () => {
  state.rendererReady = true;
  elements.previewLoading.classList.add("hidden");
  bindPreviewLinks();
  elements.preview.contentWindow?.addEventListener("scroll", capturePreviewAlignment, { passive: true });
  elements.preview.contentDocument?.addEventListener("selectionchange", updateAiContextSummary);
  renderPreview();
});

function bindPreviewLinks() {
  elements.preview.contentDocument?.addEventListener("lightmark-heading-fold", (event) => {
    toggleHeadingFold(Number(event.detail?.index), Boolean(event.detail?.collapsed));
  });
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
  previewWindow.lightmarkRender(elements.editor.value, collapsedHeadingIndices());
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
      if (generation === state.renderGeneration) {
        image.src = dataUrl;
        await image.decode?.().catch(() => {});
      }
    } catch {
      image.title = `无法加载本地图片：${source}`;
    }
  }));
  rebuildScrollAnchors();
  syncPreviewToEditor();
}

function setDirty(dirty) {
  state.dirty = state.contentKind === "markdown" && dirty;
  elements.dirtyDot.classList.toggle("visible", state.dirty);
  elements.saveStatus.textContent = state.contentKind === "image" && state.currentPath
    ? "本地图片 · 只读"
    : state.dirty
      ? "有未保存修改 · Ctrl+S 保存"
      : state.currentPath
        ? "已保存"
        : "未打开文档";
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
  const [documents, images] = await Promise.all([
    invoke("list_markdown_files", { directoryPath }),
    invoke("list_image_files", { directoryPath }),
  ]);
  state.documents = sortDocuments(documents);
  state.images = sortDocuments(images);
  state.currentDirectory = directoryPath;
  elements.folderName.textContent = fileNameFromPath(directoryPath) || directoryPath;
  renderDocumentList();
}

function renderFileList(entries, container, kind) {
  container.replaceChildren();
  entries.forEach((entry, index) => {
    const button = document.createElement("button");
    button.className = "document-item";
    button.classList.toggle("active", entry.path === state.currentPath);
    button.setAttribute("aria-current", entry.path === state.currentPath ? "page" : "false");
    button.title = entry.path;
    button.innerHTML = `<span class="document-number">${String(index + 1).padStart(2, "0")}</span><span class="document-name"></span>`;
    button.querySelector(".document-name").textContent = entry.name;
    button.addEventListener("click", () => guardUnsaved(() => (
      kind === "image" ? loadImage(entry.path) : loadDocument(entry.path)
    )));
    container.append(button);
  });
}

function renderDocumentList() {
  renderFileList(state.documents, elements.documentList, "markdown");
  renderFileList(state.images, elements.imageList, "image");
  updateNavigation();
  updateSidebarView();
}

function updateSidebarView() {
  const showingDocuments = state.sidebarView === "documents";
  const showingImages = state.sidebarView === "images";
  const showingOutline = state.sidebarView === "outline";
  elements.documentsTab.classList.toggle("active", showingDocuments);
  elements.imagesTab.classList.toggle("active", showingImages);
  elements.outlineTab.classList.toggle("active", showingOutline);
  elements.documentsTab.setAttribute("aria-selected", String(showingDocuments));
  elements.imagesTab.setAttribute("aria-selected", String(showingImages));
  elements.outlineTab.setAttribute("aria-selected", String(showingOutline));
  elements.outlineTab.disabled = state.contentKind === "image";
  elements.documentList.hidden = !showingDocuments;
  elements.imageList.hidden = !showingImages;
  elements.outlineList.hidden = !showingOutline;
  elements.emptyList.hidden = !showingDocuments || state.documents.length > 0;
  elements.emptyImages.hidden = !showingImages || state.images.length > 0;
  elements.emptyOutline.hidden = !showingOutline || state.headings.length > 0;
}

function setSidebarView(view) {
  const allowed = ["documents", "images", "outline"];
  state.sidebarView = allowed.includes(view) ? view : "documents";
  if (state.contentKind === "image" && state.sidebarView === "outline") state.sidebarView = "images";
  updateSidebarView();
}

function renderOutline() {
  state.headings = buildHeadingSections(extractHeadings(elements.editor.value));
  const currentKeys = new Set(state.headings.map((heading) => heading.foldKey));
  state.collapsedHeadingKeys.forEach((key) => {
    if (!currentKeys.has(key)) state.collapsedHeadingKeys.delete(key);
  });
  elements.outlineList.replaceChildren();
  const collapsedAncestors = [];
  state.headings.forEach((heading, index) => {
    while (collapsedAncestors.length && collapsedAncestors.at(-1).level >= heading.level) collapsedAncestors.pop();
    const hiddenByAncestor = collapsedAncestors.length > 0;
    const collapsed = state.collapsedHeadingKeys.has(heading.foldKey);
    const row = document.createElement("div");
    row.className = "outline-row";
    row.dataset.level = String(heading.level);
    row.dataset.headingIndex = String(index);
    row.style.setProperty("--outline-indent", `${5 + (heading.level - 1) * 14}px`);
    row.hidden = hiddenByAncestor;

    const fold = document.createElement("button");
    fold.type = "button";
    fold.className = "outline-fold-toggle";
    fold.setAttribute("aria-expanded", String(!collapsed));
    fold.setAttribute("aria-label", `${collapsed ? "展开" : "收起"}${heading.title}`);
    fold.title = collapsed ? "展开这个标题" : "收起这个标题";
    fold.addEventListener("click", () => toggleHeadingFold(index));

    const button = document.createElement("button");
    button.type = "button";
    button.className = "outline-item";
    button.dataset.level = String(heading.level);
    button.textContent = heading.title;
    button.title = heading.title;
    button.addEventListener("click", () => jumpToHeading(heading, index));
    row.append(fold, button);
    elements.outlineList.append(row);
    if (collapsed) collapsedAncestors.push({ level: heading.level });
  });
  updateSidebarView();
}

function collapsedHeadingIndices() {
  return state.headings.reduce((indices, heading, index) => {
    if (state.collapsedHeadingKeys.has(heading.foldKey)) indices.push(index);
    return indices;
  }, []);
}

function applyPreviewHeadingFolds() {
  elements.preview.contentWindow?.lightmarkSetHeadingFolds?.(collapsedHeadingIndices());
  requestAnimationFrame(() => rebuildScrollAnchors());
}

function toggleHeadingFold(index, nextCollapsed = null) {
  const heading = state.headings[index];
  if (!heading) return;
  const collapsed = nextCollapsed ?? !state.collapsedHeadingKeys.has(heading.foldKey);
  if (collapsed) state.collapsedHeadingKeys.add(heading.foldKey);
  else state.collapsedHeadingKeys.delete(heading.foldKey);
  renderOutline();
  applyPreviewHeadingFolds();
}

function scrollPreviewToHeading(index) {
  const heading = elements.preview.contentDocument?.querySelector(`[data-lightmark-heading-index="${index}"]`);
  const previewWindow = elements.preview.contentWindow;
  if (!heading || !previewWindow) return;
  setPreviewScroll(heading.getBoundingClientRect().top + previewWindow.scrollY);
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

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function restoreImageZoomPreference() {
  const storedMode = localStorage.getItem(IMAGE_ZOOM_MODE_STORAGE_KEY);
  const storedScale = Number(localStorage.getItem(IMAGE_ZOOM_SCALE_STORAGE_KEY));
  state.imageZoomMode = ["fit", "actual", "custom"].includes(storedMode) ? storedMode : "fit";
  state.imageScale = Number.isFinite(storedScale)
    ? Math.min(IMAGE_MAX_SCALE, Math.max(IMAGE_MIN_SCALE, storedScale))
    : 1;
}

function rememberImageZoomPreference() {
  localStorage.setItem(IMAGE_ZOOM_MODE_STORAGE_KEY, state.imageZoomMode);
  localStorage.setItem(IMAGE_ZOOM_SCALE_STORAGE_KEY, String(state.imageScale));
}

function setContentKind(kind) {
  const imageMode = kind === "image";
  state.contentKind = imageMode ? "image" : "markdown";
  elements.contentPanes.hidden = imageMode;
  elements.imageViewer.hidden = !imageMode;
  elements.modeSwitcher.hidden = imageMode;
  elements.saveFile.disabled = imageMode;
  elements.saveAs.disabled = imageMode;
  elements.copyMenuToggle.disabled = imageMode || !state.currentPath;
  elements.aiToggle.disabled = imageMode;
  elements.syntaxHelp.disabled = imageMode;
  elements.previous.setAttribute("aria-label", imageMode ? "上一张" : "上一篇");
  elements.next.setAttribute("aria-label", imageMode ? "下一张" : "下一篇");
  elements.previous.title = imageMode ? "上一张（←）" : "上一篇（←）";
  elements.next.title = imageMode ? "下一张（→）" : "下一篇（→）";
  elements.dirtyDot.classList.toggle("visible", !imageMode && state.dirty);
  if (imageMode) {
    setCopyMenu(false);
    closeHtmlCompletion();
    if (!elements.findBar.hidden) closeFindBar();
    if (state.aiOpen) setAiOpen(false);
    if (state.sidebarView === "outline") state.sidebarView = "images";
  }
  updateSidebarView();
  updateModeStatus();
  updateCopyAvailability();
  updateAiControls();
}

function updateImageControls() {
  const percent = Math.round(state.imageScale * 100);
  elements.imageZoomLabel.value = state.imageZoomMode === "fit" ? `适合 ${percent}%` : `${percent}%`;
  elements.imageZoomLabel.textContent = elements.imageZoomLabel.value;
  elements.imageZoomOut.disabled = state.imageScale <= IMAGE_MIN_SCALE + 0.001;
  elements.imageZoomIn.disabled = state.imageScale >= IMAGE_MAX_SCALE - 0.001;
  elements.imageFit.classList.toggle("active", state.imageZoomMode === "fit");
  elements.imageActual.classList.toggle("active", state.imageZoomMode === "actual");
}

function setImageScale(scale, mode = "custom", { preserveCenter = false, alignTop = false } = {}) {
  if (!state.imageNaturalWidth || !state.imageNaturalHeight) return;
  const stage = elements.imageStage;
  const centerX = stage.scrollWidth ? (stage.scrollLeft + stage.clientWidth / 2) / stage.scrollWidth : 0.5;
  const centerY = stage.scrollHeight ? (stage.scrollTop + stage.clientHeight / 2) / stage.scrollHeight : 0.5;
  state.imageScale = Math.min(IMAGE_MAX_SCALE, Math.max(IMAGE_MIN_SCALE, scale));
  state.imageZoomMode = mode;
  rememberImageZoomPreference();
  const imageWidth = Math.max(1, Math.round(state.imageNaturalWidth * state.imageScale));
  const imageHeight = Math.max(1, Math.round(state.imageNaturalHeight * state.imageScale));
  elements.imageContent.style.width = `${imageWidth}px`;
  elements.imageContent.style.height = `${imageHeight}px`;
  elements.imageCanvas.style.width = `${Math.max(stage.clientWidth, imageWidth + 48)}px`;
  elements.imageCanvas.style.height = `${Math.max(stage.clientHeight, imageHeight + 48)}px`;
  updateImageControls();
  requestAnimationFrame(() => {
    if (preserveCenter) {
      stage.scrollLeft = centerX * stage.scrollWidth - stage.clientWidth / 2;
      stage.scrollTop = centerY * stage.scrollHeight - stage.clientHeight / 2;
    } else {
      stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2);
      stage.scrollTop = alignTop ? 0 : Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2);
    }
  });
}

function fitImage({ alignTop = false } = {}) {
  if (!state.imageNaturalWidth || !state.imageNaturalHeight) return;
  const availableWidth = Math.max(1, elements.imageStage.clientWidth - 48);
  const availableHeight = Math.max(1, elements.imageStage.clientHeight - 48);
  const scale = Math.min(1, availableWidth / state.imageNaturalWidth, availableHeight / state.imageNaturalHeight);
  setImageScale(scale, "fit", { alignTop });
}

function showImageAtActualSize({ alignTop = false } = {}) {
  setImageScale(1, "actual", { alignTop });
}

function zoomImage(factor) {
  setImageScale(state.imageScale * factor, "custom", { preserveCenter: true });
}

function applyImageZoomPreference({ alignTop = false } = {}) {
  if (state.imageZoomMode === "fit") fitImage({ alignTop });
  else if (state.imageZoomMode === "actual") showImageAtActualSize({ alignTop });
  else setImageScale(state.imageScale, "custom", { alignTop });
}

function updateImageDetails() {
  const type = state.imageMimeType.replace("image/", "").replace("jpeg", "JPG").toLocaleUpperCase();
  elements.imageDetails.textContent = `${state.imageNaturalWidth} × ${state.imageNaturalHeight} · ${formatFileSize(state.imageByteSize)} · ${type}`;
}

async function loadImage(path, { refreshSiblings = false } = {}) {
  const previousPath = state.currentPath;
  const payload = await invoke("read_image", { path });
  if (refreshSiblings || state.currentDirectory !== payload.directory) {
    await refreshDirectory(payload.directory);
  }
  state.currentPath = payload.path;
  state.currentDirectory = payload.directory;
  state.lastSavedText = "";
  state.imageByteSize = payload.byteSize;
  state.imageMimeType = payload.mimeType;
  state.imageNaturalWidth = 0;
  state.imageNaturalHeight = 0;
  elements.editor.value = "";
  state.headings = [];
  state.collapsedHeadingKeys.clear();
  elements.outlineList.replaceChildren();
  elements.title.textContent = payload.name;
  elements.path.textContent = payload.path;
  state.sidebarView = "images";
  setContentKind("image");
  setDirty(false);
  renderDocumentList();
  elements.imageLoading.textContent = "正在读取本地图片…";
  elements.imageLoading.classList.remove("hidden");
  elements.imageDetails.textContent = `${formatFileSize(payload.byteSize)} · 正在读取尺寸`;
  elements.imageContent.removeAttribute("src");
  elements.imageContent.alt = payload.name;
  await new Promise((resolveImage, rejectImage) => {
    elements.imageContent.onload = resolveImage;
    elements.imageContent.onerror = () => {
      elements.imageLoading.textContent = "无法显示这张图片";
      rejectImage(new Error("Windows WebView2 无法解码这张图片。"));
    };
    elements.imageContent.src = payload.dataUrl;
  });
  state.imageNaturalWidth = elements.imageContent.naturalWidth;
  state.imageNaturalHeight = elements.imageContent.naturalHeight;
  updateImageDetails();
  elements.imageLoading.classList.add("hidden");
  requestAnimationFrame(() => applyImageZoomPreference({ alignTop: true }));
  updateCopyAvailability();
  updateAiContextSummary();
  updateAiControls();
  if (previousPath && previousPath !== payload.path) resetAiConversation();
  elements.imageStage.focus({ preventScroll: true });
}

async function openSupportedPath(path, options = {}) {
  const kind = supportedFileKind(path);
  if (kind === "markdown") return loadDocument(path, options);
  if (kind === "image") return loadImage(path, options);
  throw new Error("只支持 Markdown、PNG、JPG、JPEG、WebP、GIF 和 BMP 文件。");
}

async function loadDocument(path, { refreshSiblings = false } = {}) {
  const previousPath = state.currentPath;
  const payload = await invoke("read_document", { path });
  if (refreshSiblings || state.currentDirectory !== payload.directory) {
    await refreshDirectory(payload.directory);
  }
  state.currentPath = payload.path;
  state.currentDirectory = payload.directory;
  setContentKind("markdown");
  elements.imageContent.removeAttribute("src");
  state.imageNaturalWidth = 0;
  state.imageNaturalHeight = 0;
  if (state.sidebarView === "images") state.sidebarView = "documents";
  state.previewSyncOffset = 0;
  state.previewProgrammaticTarget = null;
  state.lastSavedText = payload.contents;
  elements.editor.value = payload.contents;
  state.collapsedHeadingKeys.clear();
  renderEditorOverlay();
  renderOutline();
  setFormatTool(null);
  elements.title.textContent = payload.name;
  elements.path.textContent = payload.path;
  setDirty(false);
  updateSyncControls();
  renderDocumentList();
  await renderPreview();
  updateCopyAvailability();
  updateAiContextSummary();
  updateAiControls();
  if (previousPath && previousPath !== payload.path) resetAiConversation();
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
    title: "打开 Markdown 或图片",
    defaultPath: preferredOpenDirectory(state.currentDirectory),
    filters: [
      { name: "Markdown 与图片", extensions: ["md", "markdown", ...imageExtensions] },
      { name: "Markdown", extensions: ["md", "markdown"] },
      { name: "图片", extensions: imageExtensions },
    ],
  }));
  if (path) await guardUnsaved(() => openSupportedPath(path, { refreshSiblings: true }));
}

async function chooseFolder() {
  const selectedPath = singleDialogPath(await open({
    multiple: false,
    directory: false,
    title: "选择文件夹中的任意 Markdown 或图片",
    defaultPath: preferredOpenDirectory(state.currentDirectory),
    filters: [{ name: "Markdown 与图片", extensions: ["md", "markdown", ...imageExtensions] }],
  }));
  if (!selectedPath) return;
  const directoryPath = directoryFromPath(selectedPath);
  await guardUnsaved(async () => {
    await refreshDirectory(directoryPath);
    if (!state.documents.length && !state.images.length) {
      await message("这个文件夹第一层没有支持的 Markdown 或图片文件。", { title: "没有可阅读文件", kind: "info" });
      return;
    }
    await openSupportedPath(selectedPath);
  });
}

async function createDocument() {
  const path = await save({
    title: "新建 Markdown 文档",
    defaultPath: suggestedNewDocumentPath(state.currentDirectory),
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
  });
  if (typeof path !== "string") return false;
  await invoke("write_document", { path, contents: "" });
  await loadDocument(path, { refreshSiblings: true });
  setMode("editing");
  elements.editor.focus();
  return true;
}

async function saveDocument() {
  if (state.contentKind === "image") return false;
  if (!state.currentPath) return saveDocumentAs();
  await invoke("write_document", { path: state.currentPath, contents: elements.editor.value });
  state.lastSavedText = elements.editor.value;
  setDirty(false);
  return true;
}

async function saveDocumentAs() {
  if (state.contentKind === "image") return false;
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
  const entries = state.contentKind === "image" ? state.images : state.documents;
  return entries.findIndex((item) => item.path === state.currentPath);
}

function updateNavigation() {
  const index = currentIndex();
  const total = state.contentKind === "image" ? state.images.length : state.documents.length;
  elements.pageIndicator.value = index >= 0 ? `${index + 1} / ${total}` : total ? `— / ${total}` : "— / —";
  elements.pageIndicator.textContent = elements.pageIndicator.value;
  elements.previous.disabled = index <= 0;
  elements.next.disabled = index < 0 || index >= total - 1;
}

async function navigate(by) {
  const index = currentIndex();
  const entries = state.contentKind === "image" ? state.images : state.documents;
  const destination = entries[index + by];
  if (destination) await guardUnsaved(() => (
    state.contentKind === "image" ? loadImage(destination.path) : loadDocument(destination.path)
  ));
}

function updateModeStatus() {
  if (state.contentKind === "image") {
    elements.modeStatus.textContent = "图片阅读 · ← → 切换 · 滚轮缩放";
    return;
  }
  if (state.mode === "reading") {
    elements.modeStatus.textContent = "阅读模式 · ← → 翻页";
    return;
  }
  if (state.mode === "editing") {
    elements.modeStatus.textContent = "编辑模式 · 方向键移动光标";
    return;
  }
  const labels = {
    auto: "自动锚点同步",
    manual: Math.abs(state.previewSyncOffset) > 1 ? "手动校准同步 · 已记住位置" : "手动校准同步",
    off: "左右独立滚动",
  };
  elements.modeStatus.textContent = `分栏模式 · ${labels[state.scrollSyncMode]}`;
}

function updateSyncControls() {
  const inSplit = state.mode === "split";
  const manual = state.scrollSyncMode === "manual";
  const calibrated = Math.abs(state.previewSyncOffset) > 1;
  elements.syncMode.value = state.scrollSyncMode;
  elements.syncMode.disabled = !inSplit;
  elements.resetSync.disabled = !inSplit || !manual || !calibrated;
  elements.resetSync.classList.toggle("calibrated", !elements.resetSync.disabled);
  elements.resetSync.dataset.offset = String(state.previewSyncOffset);
  elements.resetSync.title = !inSplit
    ? "只在分栏模式使用"
    : !manual
      ? "先把同步方式改为“手动校准”"
      : !calibrated
        ? "当前已经对齐；请先手动滚动右侧预览"
        : "清除手动位置差，并按编辑位置重新对齐";
  updateModeStatus();
}

function setScrollSyncMode(mode) {
  if (!["auto", "manual", "off"].includes(mode)) return;
  if (mode === "manual" && state.mode === "split") {
    rebuildScrollAnchors();
    const actual = elements.preview.contentWindow?.scrollY || 0;
    state.previewSyncOffset = actual - previewScrollTarget({ includeManualOffset: false });
  } else if (mode === "auto") {
    state.previewSyncOffset = 0;
  }
  state.scrollSyncMode = mode;
  localStorage.setItem("lightmark-scroll-sync-mode", mode);
  updateSyncControls();
  if (mode !== "off") syncPreviewToEditor();
}

function resetPreviewAlignment() {
  state.previewSyncOffset = 0;
  updateSyncControls();
  syncPreviewToEditor();
}

function setMode(mode) {
  if (state.contentKind === "image") return;
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
  elements.paneSwap.disabled = mode !== "split";
  updateSyncControls();
  updateCopyAvailability();
  if (mode === "reading") setFormatTool(null);
  if (mode === "reading") closeHtmlCompletion();
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
  const renderedHeadings = [...previewDocument.querySelectorAll("[data-lightmark-heading-index]")]
    .filter((heading) => !heading.classList.contains("heading-fold-hidden"));
  const headingIndexes = renderedHeadings
    .map((heading) => Number(heading.dataset.lightmarkHeadingIndex))
    .filter((index) => Number.isInteger(index) && state.headings[index]);
  const count = Math.min(headingIndexes.length, renderedHeadings.length);
  const editorPositions = measureEditorHeadingPositions(
    headingIndexes.slice(0, count).map((index) => state.headings[index].offset),
  );
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
  let baseTarget;
  if (elements.editor.scrollTop <= 1) {
    baseTarget = 0;
  } else if (elements.editor.scrollTop >= editorRange - 1) {
    baseTarget = previewRange;
  } else {
    const probeOffset = Math.min(180, elements.editor.clientHeight * 0.28);
    const editorProbe = elements.editor.scrollTop + probeOffset;
    const previewProbe = mapScrollByAnchors(editorProbe, state.scrollAnchors);
    const paneOffset = elements.editor.getBoundingClientRect().top - elements.preview.getBoundingClientRect().top;
    baseTarget = previewProbe - probeOffset - paneOffset;
  }
  const manualOffset = includeManualOffset && state.scrollSyncMode === "manual" ? state.previewSyncOffset : 0;
  return Math.min(previewRange, Math.max(0, baseTarget + manualOffset));
}

function setPreviewScroll(top) {
  const previewWindow = elements.preview.contentWindow;
  const scroller = elements.preview.contentDocument?.scrollingElement;
  if (!previewWindow || !scroller) return;
  const previewRange = Math.max(0, scroller.scrollHeight - previewWindow.innerHeight);
  const target = Math.min(previewRange, Math.max(0, top));
  state.previewProgrammaticTarget = target;
  elements.resetSync.dataset.programmaticTarget = String(target);
  previewWindow.scrollTo({ top: target, behavior: "auto" });
}

function capturePreviewAlignment() {
  if (state.mode !== "split" || state.scrollSyncMode !== "manual") return;
  cancelAnimationFrame(state.previewManualFrame);
  state.previewManualFrame = requestAnimationFrame(() => {
    if (state.mode !== "split" || state.scrollSyncMode !== "manual") return;
    const actual = elements.preview.contentWindow?.scrollY || 0;
    const expected = state.previewProgrammaticTarget;
    if (expected !== null && Math.abs(actual - expected) <= 2) return;
    state.previewProgrammaticTarget = null;
    state.previewSyncOffset = actual - previewScrollTarget({ includeManualOffset: false });
    updateSyncControls();
  });
}

function syncPreviewToEditor() {
  if (state.mode !== "split" || !state.rendererReady || state.scrollSyncMode === "off") return;
  cancelAnimationFrame(state.previewScrollFrame);
  state.previewScrollFrame = requestAnimationFrame(() => {
    if (!state.scrollAnchors.length) rebuildScrollAnchors();
    const target = previewScrollTarget();
    setPreviewScroll(target);
  });
}

function closeHtmlCompletion() {
  elements.htmlCompletion.hidden = true;
  elements.htmlCompletion.replaceChildren();
  state.completionContext = null;
  state.completionItems = [];
  state.completionIndex = 0;
}

function editorCaretPosition(offset) {
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
  mirror.append(document.createTextNode(elements.editor.value.slice(0, offset)));
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  mirror.append(marker, document.createTextNode(elements.editor.value.slice(offset) || "\u200b"));
  document.body.append(mirror);
  const result = {
    left: marker.offsetLeft - elements.editor.scrollLeft,
    top: marker.offsetTop - elements.editor.scrollTop,
    lineHeight: Number.parseFloat(style.lineHeight) || 24,
  };
  mirror.remove();
  return result;
}

function positionHtmlCompletion() {
  if (elements.htmlCompletion.hidden || !state.completionContext) return;
  const caret = editorCaretPosition(state.completionContext.end);
  const paneBounds = elements.editorPane.getBoundingClientRect();
  const editorBounds = elements.editor.getBoundingClientRect();
  const preferredLeft = editorBounds.left - paneBounds.left + caret.left;
  const preferredTop = editorBounds.top - paneBounds.top + caret.top + caret.lineHeight + 5;
  const left = Math.max(8, Math.min(preferredLeft, elements.editorPane.clientWidth - elements.htmlCompletion.offsetWidth - 8));
  const belowFits = preferredTop + elements.htmlCompletion.offsetHeight <= elements.editorPane.clientHeight - 8;
  const top = belowFits
    ? preferredTop
    : Math.max(48, editorBounds.top - paneBounds.top + caret.top - elements.htmlCompletion.offsetHeight - 5);
  elements.htmlCompletion.style.left = `${Math.round(left)}px`;
  elements.htmlCompletion.style.top = `${Math.round(top)}px`;
}

function selectHtmlCompletion(index) {
  if (!state.completionItems.length) return;
  state.completionIndex = (index + state.completionItems.length) % state.completionItems.length;
  [...elements.htmlCompletion.querySelectorAll("button")].forEach((button, buttonIndex) => {
    const selected = buttonIndex === state.completionIndex;
    button.setAttribute("aria-selected", String(selected));
    if (selected) button.scrollIntoView({ block: "nearest" });
  });
}

function syncEditorOverlayScroll() {
  elements.editorOverlay.scrollTop = elements.editor.scrollTop;
  elements.editorOverlay.scrollLeft = elements.editor.scrollLeft;
}

function renderEditorOverlay() {
  elements.editorOverlay.innerHTML = `${renderEditorDecorations(elements.editor.value)}\n`;
  syncEditorOverlayScroll();
}

function replaceEditorValue(nextText, selectionStart, selectionEnd) {
  const previousText = elements.editor.value;
  let prefixLength = 0;
  while (
    prefixLength < previousText.length
    && prefixLength < nextText.length
    && previousText[prefixLength] === nextText[prefixLength]
  ) prefixLength += 1;

  let suffixLength = 0;
  while (
    suffixLength < previousText.length - prefixLength
    && suffixLength < nextText.length - prefixLength
    && previousText[previousText.length - 1 - suffixLength] === nextText[nextText.length - 1 - suffixLength]
  ) suffixLength += 1;

  const replacement = nextText.slice(prefixLength, nextText.length - suffixLength);
  elements.editor.focus();
  elements.editor.setSelectionRange(prefixLength, previousText.length - suffixLength);

  let insertedWithNativeUndo = false;
  try {
    insertedWithNativeUndo = document.execCommand("insertText", false, replacement);
  } catch {
    insertedWithNativeUndo = false;
  }

  if (!insertedWithNativeUndo || elements.editor.value !== nextText) {
    elements.editor.value = nextText;
    elements.editor.dispatchEvent(new Event("input", { bubbles: true }));
  }
  elements.editor.setSelectionRange(selectionStart, selectionEnd);
  renderEditorOverlay();
}

function applyHtmlCompletion(index = state.completionIndex) {
  const completion = state.completionItems[index];
  const result = applyTextCompletion(elements.editor.value, state.completionContext, completion);
  if (!result.applied) return;
  replaceEditorValue(result.text, result.selectionStart, result.selectionEnd);
  closeHtmlCompletion();
}

function updateHtmlCompletion() {
  if (state.mode === "reading") {
    closeHtmlCompletion();
    return;
  }
  if (elements.editor.selectionStart !== elements.editor.selectionEnd) {
    closeHtmlCompletion();
    return;
  }
  const context = findHtmlCompletionContext(elements.editor.value, elements.editor.selectionStart);
  if (!context) {
    closeHtmlCompletion();
    return;
  }
  const items = htmlCompletions.filter((completion) => {
    const terms = [completion.key, ...(completion.aliases || [])];
    return terms.some((term) => term.startsWith(context.query));
  });
  if (!items.length) {
    closeHtmlCompletion();
    return;
  }
  state.completionContext = context;
  state.completionItems = items;
  state.completionIndex = 0;
  elements.htmlCompletion.replaceChildren(...items.map((completion, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(index === 0));
    const code = document.createElement("code");
    code.textContent = completion.text;
    const label = document.createElement("span");
    label.textContent = completion.label;
    button.append(code, label);
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      applyHtmlCompletion(index);
    });
    return button;
  }));
  elements.htmlCompletion.hidden = false;
  positionHtmlCompletion();
}

const formatToolDetails = {
  highlight: { button: elements.highlightTool, label: "黄色高光笔" },
  redText: { button: elements.redTextTool, label: "红色笔" },
};

const quickInsertDetails = {
  indent: { button: elements.indentInsert, text: "&emsp;&emsp;", shortcut: "Alt+1" },
  lineBreak: { button: elements.lineBreakInsert, text: "<br>", shortcut: "Alt+3" },
  blankBreak: { button: elements.blankBreakInsert, text: "<br><br>", shortcut: "Alt+2" },
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

  replaceEditorValue(result.text, result.selectionStart, result.selectionEnd);
  if (!state.formatTool) {
    const label = tool === "highlight" ? "黄色高光" : "红色文字";
    elements.formattingHint.textContent = result.removed
      ? `已移除${label} · Ctrl+Z 可撤销`
      : `已添加${label} · Ctrl+Z 可撤销`;
  }
  return true;
}

function insertQuickSyntax(detail) {
  if (!state.currentPath || state.mode === "reading") return false;
  const cursor = elements.editor.selectionStart;
  const nextText = `${elements.editor.value.slice(0, cursor)}${detail.text}${elements.editor.value.slice(cursor)}`;
  const nextCursor = cursor + detail.text.length;
  replaceEditorValue(nextText, nextCursor, nextCursor);
  elements.formattingHint.textContent = `已插入 ${detail.text} · Ctrl+Z 可撤销`;
  closeHtmlCompletion();
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
  const noDocument = !state.currentPath || state.contentKind !== "markdown";
  elements.copyMenuToggle.disabled = noDocument;
  Object.values(quickInsertDetails).forEach(({ button }) => {
    button.disabled = noDocument || state.mode === "reading";
  });
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
  if (state.contentKind === "image") return;
  if (elements.syntaxDialog.open) elements.syntaxDialog.close();
  elements.findBar.hidden = false;
  refreshFindResults();
  elements.findInput.focus();
  elements.findInput.select();
}

function closeFindBar() {
  elements.findBar.hidden = true;
  elements.preview.contentWindow?.getSelection()?.removeAllRanges();
  if (state.contentKind === "markdown" && state.mode !== "reading") elements.editor.focus();
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
      button.dataset.copyText = template.text;
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
    if (supportedFileKind(path)) {
      await openSupportedPath(path, { refreshSiblings: true });
      return;
    }
    try {
      await refreshDirectory(path);
      if (state.documents.length) await loadDocument(state.documents[0].path);
      else if (state.images.length) await loadImage(state.images[0].path);
      else await message("拖入的文件夹第一层没有支持的 Markdown 或图片文件。", { title: "没有可阅读文件", kind: "info" });
    } catch (error) {
      await showError("无法打开拖入项目", error);
    }
  });
}

function setAiConnection(label, tone = "") {
  elements.aiConnectionLabel.textContent = label;
  elements.aiConnectionDot.className = `ai-connection-dot${tone ? ` ${tone}` : ""}`;
}

function updateAiControls() {
  const canAsk = state.aiReady && state.aiSignedIn && state.contentKind === "markdown" && Boolean(state.currentPath) && !state.aiBusy;
  const answerDetails = answerModeDetails(currentAiAnswerMode());
  elements.aiQuestion.disabled = !canAsk;
  elements.aiSend.disabled = !canAsk || !elements.aiQuestion.value.trim();
  elements.aiStop.hidden = !state.aiBusy;
  elements.aiContextMode.disabled = state.aiBusy;
  elements.aiAnswerMode.disabled = state.aiBusy;
  elements.aiPrivacyNote.textContent = state.aiBusy
    ? (currentAiAnswerMode() === "web" ? "Codex 正在联网查证" : "Codex 正在只读回答")
    : answerDetails.privacy;
}

function updateAiWidth(width = state.aiWidth, { persist = false } = {}) {
  const workspaceLimit = Math.max(AI_MIN_WIDTH, elements.workspace.clientWidth - 480);
  state.aiWidth = Math.min(AI_MAX_WIDTH, workspaceLimit, Math.max(AI_MIN_WIDTH, width));
  document.documentElement.style.setProperty("--ai-sidebar-width", `${Math.round(state.aiWidth)}px`);
  elements.aiResizer.setAttribute("aria-valuenow", String(Math.round(state.aiWidth)));
  if (persist) localStorage.setItem("lightmark-ai-width", String(state.aiWidth));
}

function editorSelectionText() {
  const { selectionStart, selectionEnd, value } = elements.editor;
  return selectionStart === selectionEnd ? "" : value.slice(selectionStart, selectionEnd);
}

function previewSelectionText() {
  return elements.preview.contentWindow?.getSelection()?.toString() || "";
}

function aiSelectionText() {
  const editorText = editorSelectionText();
  const previewText = previewSelectionText();
  if (state.mode === "reading") return previewText;
  if (state.mode === "editing") return editorText;
  return document.activeElement === elements.editor ? editorText : (previewText || editorText);
}

function currentAiContext() {
  return chooseAiContext({
    mode: elements.aiContextMode.value,
    documentText: elements.editor.value,
    editorSelection: aiSelectionText(),
  });
}

function updateAiContextSummary() {
  const context = currentAiContext();
  elements.aiContextSummary.textContent = context.text
    ? contextPreview(context.kind, context.text)
    : (context.error || "没有资料");
}

function currentAiAnswerMode() {
  return normalizeAnswerMode(elements.aiAnswerMode.value);
}

function updateAiAnswerMode() {
  const details = answerModeDetails(currentAiAnswerMode());
  elements.aiAnswerSummary.textContent = details.summary;
  updateAiControls();
}

function scrollAiToEnd() {
  requestAnimationFrame(() => {
    elements.aiMessages.scrollTop = elements.aiMessages.scrollHeight;
  });
}

function appendAiMessage(role, text = "", context = "") {
  elements.aiEmpty.hidden = true;
  const messageElement = document.createElement("article");
  messageElement.className = `ai-message ${role}`;
  const header = document.createElement("div");
  header.className = "ai-message-header";
  header.textContent = role === "user" ? "你" : "CODEX";
  const body = document.createElement("div");
  body.className = "ai-message-body";
  body.textContent = text;
  messageElement.append(header, body);
  if (context) {
    const contextElement = document.createElement("div");
    contextElement.className = "ai-message-context";
    contextElement.textContent = context;
    messageElement.append(contextElement);
  }
  elements.aiMessages.append(messageElement);
  scrollAiToEnd();
  return { element: messageElement, body };
}

function resetAiConversation({ notifyBackend = true } = {}) {
  elements.aiMessages.querySelectorAll(".ai-message").forEach((item) => item.remove());
  elements.aiEmpty.hidden = false;
  state.aiAssistantBody = null;
  state.aiBusy = false;
  updateAiControls();
  if (notifyBackend && state.aiReady) {
    invoke("codex_new_conversation").catch((error) => console.error("无法重置 Codex 对话", error));
  }
}

async function connectAi() {
  state.aiReady = false;
  state.aiSignedIn = false;
  setAiConnection("正在查找本机 Codex…", "connecting");
  updateAiControls();
  try {
    const status = await invoke("codex_status");
    if (!status.available) throw new Error("没有找到 Codex CLI。请先安装并登录 Codex。 ");
    if (status.version) elements.aiModelLabel.textContent = status.version.replace(/^codex-cli\s*/i, "CLI ");
    await invoke("codex_connect");
  } catch (error) {
    state.aiReady = false;
    setAiConnection("Codex 连接失败", "error");
    elements.aiPrivacyNote.textContent = String(error);
    updateAiControls();
  }
}

function setAiOpen(open) {
  state.aiOpen = open;
  elements.aiSidebar.hidden = !open;
  elements.aiResizer.hidden = !open;
  elements.aiToggle.setAttribute("aria-expanded", String(open));
  elements.aiToggle.title = open ? "收起 Codex AI 助读侧栏" : "打开 Codex AI 助读侧栏";
  if (open) {
    updateAiWidth();
    if (!state.aiReady) connectAi();
    setTimeout(() => elements.aiQuestion.focus(), 180);
  }
  updateSplitLayout();
}

function handleAiEvent(payload) {
  if (!payload || typeof payload.kind !== "string") return;
  if (payload.kind === "connecting") {
    setAiConnection("正在连接 Codex…", "connecting");
  } else if (payload.kind === "ready") {
    state.aiReady = true;
    setAiConnection("已连接，正在检查登录…", "ready");
  } else if (payload.kind === "account") {
    state.aiSignedIn = Boolean(payload.signedIn);
    setAiConnection(accountLabel(payload), state.aiSignedIn ? "ready" : "error");
    if (!state.aiSignedIn) elements.aiPrivacyNote.textContent = "请先在 Codex 中登录 ChatGPT";
  } else if (payload.kind === "model") {
    elements.aiModelLabel.textContent = payload.displayName || payload.model || elements.aiModelLabel.textContent;
  } else if (payload.kind === "turn-starting") {
    setAiConnection(currentAiAnswerMode() === "web" ? "Codex 准备联网查证…" : "Codex 正在阅读…", "connecting");
  } else if (payload.kind === "web-search") {
    setAiConnection("Codex 正在联网查证…", "connecting");
  } else if (payload.kind === "delta") {
    if (state.aiAssistantBody) state.aiAssistantBody.textContent += payload.text || "";
    scrollAiToEnd();
  } else if (payload.kind === "done") {
    state.aiBusy = false;
    state.aiAssistantBody?.closest(".ai-message")?.classList.remove("pending");
    if (state.aiAssistantBody && !state.aiAssistantBody.textContent.trim()) {
      state.aiAssistantBody.textContent = payload.status === "interrupted" ? "回答已停止。" : "Codex 没有返回文字。";
    }
    setAiConnection(accountLabel({ signedIn: state.aiSignedIn }), state.aiSignedIn ? "ready" : "error");
  } else if (payload.kind === "error" || payload.kind === "safety-block") {
    state.aiBusy = false;
    const target = state.aiAssistantBody
      ? { element: state.aiAssistantBody.closest(".ai-message"), body: state.aiAssistantBody }
      : appendAiMessage("assistant");
    target.element?.classList.remove("pending");
    target.element?.classList.add("error");
    target.body.textContent = payload.message || "Codex 发生错误。";
    setAiConnection("本次回答未完成", "error");
  } else if (payload.kind === "disconnected") {
    state.aiReady = false;
    state.aiSignedIn = false;
    state.aiBusy = false;
    setAiConnection("Codex 已断开", "error");
  } else if (payload.kind === "notice") {
    elements.aiPrivacyNote.textContent = payload.message || "Codex 提示";
  } else if (payload.kind === "diagnostic") {
    console.warn("Codex App Server", payload.message);
  }
  updateAiControls();
}

async function askCodex() {
  const question = elements.aiQuestion.value.trim();
  if (!question || state.aiBusy) return;
  const context = currentAiContext();
  if (!context.text) {
    elements.aiPrivacyNote.textContent = context.error;
    elements.aiContextSummary.textContent = context.error;
    return;
  }
  const answerMode = currentAiAnswerMode();
  const answerDetails = answerModeDetails(answerMode);
  appendAiMessage("user", question, `${contextPreview(context.kind, context.text)} · ${answerDetails.label}`);
  const assistant = appendAiMessage("assistant");
  assistant.element.classList.add("pending");
  state.aiAssistantBody = assistant.body;
  state.aiBusy = true;
  elements.aiQuestion.value = "";
  updateAiControls();
  try {
    await invoke("codex_ask", {
      request: {
        question,
        documentTitle: elements.title.textContent || "Markdown 文档",
        contextKind: context.kind,
        context: context.text,
        answerMode,
      },
    });
  } catch (error) {
    state.aiBusy = false;
    assistant.element.classList.remove("pending");
    assistant.element.classList.add("error");
    assistant.body.textContent = String(error);
    updateAiControls();
  }
}

async function showError(title, error) {
  console.error(title, error);
  await message(String(error), { title, kind: "error" });
}

elements.editor.addEventListener("input", () => {
  renderEditorOverlay();
  setDirty(elements.editor.value !== state.lastSavedText);
  renderOutline();
  renderPreview();
  if (!elements.findBar.hidden && state.mode !== "reading") refreshFindResults();
  updateHtmlCompletion();
  updateAiContextSummary();
  updateAiControls();
});
elements.editor.addEventListener("keydown", (event) => {
  if (elements.htmlCompletion.hidden) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    event.stopPropagation();
    selectHtmlCompletion(state.completionIndex + (event.key === "ArrowDown" ? 1 : -1));
  } else if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    event.stopPropagation();
    applyHtmlCompletion();
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeHtmlCompletion();
  }
});
elements.editor.addEventListener("scroll", () => {
  syncEditorOverlayScroll();
  positionHtmlCompletion();
  syncPreviewToEditor();
}, { passive: true });
elements.editor.addEventListener("keyup", syncPreviewToEditor);
elements.editor.addEventListener("click", () => {
  closeHtmlCompletion();
  syncPreviewToEditor();
});
elements.editor.addEventListener("mouseup", () => {
  if (state.formatTool && elements.editor.selectionStart !== elements.editor.selectionEnd) {
    requestAnimationFrame(() => applyEditorFormat(state.formatTool));
  }
  updateAiContextSummary();
});
elements.newFile.addEventListener("click", () => guardUnsaved(createDocument).catch((error) => showError("无法新建文档", error)));
elements.openFile.addEventListener("click", () => chooseFile().catch((error) => showError("无法打开文件", error)));
elements.openFolder.addEventListener("click", () => chooseFolder().catch((error) => showError("无法打开文件夹", error)));
elements.saveFile.addEventListener("click", () => saveDocument().catch((error) => showError("无法保存文件", error)));
elements.saveAs.addEventListener("click", () => saveDocumentAs().catch((error) => showError("无法另存文件", error)));
elements.aiToggle.addEventListener("click", () => setAiOpen(!state.aiOpen));
elements.aiClose.addEventListener("click", () => setAiOpen(false));
elements.aiNewChat.addEventListener("click", () => resetAiConversation());
elements.aiContextMode.addEventListener("change", updateAiContextSummary);
elements.aiAnswerMode.addEventListener("change", () => {
  updateAiAnswerMode();
  resetAiConversation();
});
elements.aiQuestion.addEventListener("input", updateAiControls);
elements.aiQuestion.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.aiForm.requestSubmit();
  }
});
elements.aiForm.addEventListener("submit", (event) => {
  event.preventDefault();
  askCodex();
});
elements.aiStop.addEventListener("click", () => {
  invoke("codex_interrupt").catch((error) => {
    elements.aiPrivacyNote.textContent = String(error);
  });
});
elements.aiSuggestions.forEach((button) => button.addEventListener("click", () => {
  elements.aiQuestion.value = button.dataset.aiPrompt || "";
  updateAiControls();
  elements.aiQuestion.focus();
}));
elements.previous.addEventListener("click", () => navigate(-1).catch((error) => showError("无法打开上一篇", error)));
elements.next.addEventListener("click", () => navigate(1).catch((error) => showError("无法打开下一篇", error)));
elements.modeButtons.forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
elements.collapseSidebar.addEventListener("click", toggleSidebar);
elements.expandSidebar.addEventListener("click", toggleSidebar);
elements.documentsTab.addEventListener("click", () => setSidebarView("documents"));
elements.imagesTab.addEventListener("click", () => setSidebarView("images"));
elements.outlineTab.addEventListener("click", () => setSidebarView("outline"));
elements.imageZoomOut.addEventListener("click", () => zoomImage(1 / 1.2));
elements.imageZoomIn.addEventListener("click", () => zoomImage(1.2));
elements.imageFit.addEventListener("click", fitImage);
elements.imageActual.addEventListener("click", showImageAtActualSize);
elements.imageStage.addEventListener("wheel", (event) => {
  if (state.contentKind !== "image") return;
  event.preventDefault();
  zoomImage(event.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });
elements.imageStage.addEventListener("dblclick", () => {
  if (state.imageZoomMode === "actual") fitImage();
  else showImageAtActualSize();
});
elements.imageStage.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || state.contentKind !== "image") return;
  state.imageDrag = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    left: elements.imageStage.scrollLeft,
    top: elements.imageStage.scrollTop,
  };
  elements.imageStage.setPointerCapture(event.pointerId);
  elements.imageStage.classList.add("dragging");
});
elements.imageStage.addEventListener("pointermove", (event) => {
  if (!state.imageDrag || state.imageDrag.pointerId !== event.pointerId) return;
  elements.imageStage.scrollLeft = state.imageDrag.left - (event.clientX - state.imageDrag.x);
  elements.imageStage.scrollTop = state.imageDrag.top - (event.clientY - state.imageDrag.y);
});
function stopImageDrag(event) {
  if (!state.imageDrag || state.imageDrag.pointerId !== event.pointerId) return;
  state.imageDrag = null;
  elements.imageStage.classList.remove("dragging");
}
elements.imageStage.addEventListener("pointerup", stopImageDrag);
elements.imageStage.addEventListener("pointercancel", stopImageDrag);
elements.imageContent.addEventListener("dragstart", (event) => event.preventDefault());
elements.paneSwap.addEventListener("click", swapPaneSides);
elements.syncMode.addEventListener("change", () => setScrollSyncMode(elements.syncMode.value));
elements.resetSync.addEventListener("click", resetPreviewAlignment);
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
elements.aiResizer.addEventListener("pointerdown", beginResize(
  elements.aiResizer,
  "is-resizing-ai",
  (event) => {
    const workspaceRight = elements.workspace.getBoundingClientRect().right;
    updateAiWidth(workspaceRight - event.clientX);
  },
  () => updateAiWidth(state.aiWidth, { persist: true }),
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
elements.aiResizer.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const widths = { ArrowLeft: state.aiWidth + 12, ArrowRight: state.aiWidth - 12, Home: AI_MAX_WIDTH, End: AI_MIN_WIDTH };
  updateAiWidth(widths[event.key], { persist: true });
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
  if (!elements.htmlCompletion.hidden && !event.target.closest("#html-completion") && event.target !== elements.editor) closeHtmlCompletion();
});
for (const [tool, details] of Object.entries(formatToolDetails)) {
  details.button.addEventListener("mousedown", (event) => event.preventDefault());
  details.button.addEventListener("click", () => handleFormatToolClick(tool));
}
Object.values(quickInsertDetails).forEach((detail) => {
  detail.button.addEventListener("mousedown", (event) => event.preventDefault());
  detail.button.addEventListener("click", () => insertQuickSyntax(detail));
});
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
  const quickInsert = event.altKey && !control && !event.shiftKey && document.activeElement === elements.editor
    ? (event.code === "Digit1"
      ? quickInsertDetails.indent
      : event.code === "Digit2"
        ? quickInsertDetails.blankBreak
        : event.code === "Digit3"
          ? quickInsertDetails.lineBreak
          : null)
    : null;
  if (quickInsert) {
    event.preventDefault();
    insertQuickSyntax(quickInsert);
    return;
  }
  if (event.key === "F11") {
    event.preventDefault();
    toggleFullscreen().catch((error) => showError("无法切换全屏幕", error));
    return;
  }
  if (control && !event.shiftKey && event.key.toLocaleLowerCase() === "n") {
    event.preventDefault();
    guardUnsaved(createDocument).catch((error) => showError("无法新建文档", error));
    return;
  }
  if (control && event.key.toLocaleLowerCase() === "s") {
    event.preventDefault();
    if (state.contentKind === "image") return;
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
    if (state.contentKind === "image") return;
    copyDocument("markdown").catch((error) => showError("无法复制 Markdown 原文", error));
    return;
  }
  if (control && event.key.toLocaleLowerCase() === "f") {
    event.preventDefault();
    if (state.contentKind === "image") return;
    showFindBar();
    return;
  }
  if (control && event.key === "/") {
    event.preventDefault();
    if (state.contentKind === "image") return;
    showSyntaxGuide();
    return;
  }
  if (control && event.key === "\\") {
    event.preventDefault();
    toggleSidebar();
    return;
  }
  const typingTarget = event.target instanceof HTMLInputElement
    || event.target instanceof HTMLTextAreaElement
    || event.target instanceof HTMLSelectElement
    || event.target?.isContentEditable;
  if (state.contentKind === "image" && !typingTarget && !elements.syntaxDialog.open && !elements.unsavedDialog.open) {
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomImage(1.2);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomImage(1 / 1.2);
    } else if (event.key === "0") {
      event.preventDefault();
      fitImage();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      navigate(-1).catch((error) => showError("无法打开上一张", error));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      navigate(1).catch((error) => showError("无法打开下一张", error));
    }
    return;
  }
  if (state.mode === "reading" && !typingTarget && !elements.syntaxDialog.open && !elements.unsavedDialog.open) {
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
  restoreImageZoomPreference();
  applyTheme(state.theme);
  initializeSyntaxCopyButtons();
  renderEditorOverlay();
  updateCopyAvailability();
  try {
    updateFullscreenButton(await getCurrentWindow().isFullscreen());
  } catch {
    updateFullscreenButton(Boolean(document.fullscreenElement));
  }
  updateSidebarWidth();
  updateAiWidth();
  updateAiContextSummary();
  updateAiAnswerMode();
  updateAiControls();
  updatePaneOrder();
  setMode("reading");
  await prepareRenderer();
  try {
    const startupPaths = await invoke("startup_paths");
    const firstSupported = startupPaths.find((path) => supportedFileKind(path));
    if (firstSupported) await openSupportedPath(firstSupported, { refreshSiblings: true });
  } catch (error) {
    await showError("无法处理启动文件", error);
  }
}

new ResizeObserver(() => {
  updateSidebarWidth();
  updateAiWidth();
  updateSplitLayout();
  scheduleScrollAnchorRebuild();
  positionHtmlCompletion();
  if (state.contentKind === "image" && state.imageZoomMode === "fit") fitImage();
}).observe(elements.workspace);

start();
