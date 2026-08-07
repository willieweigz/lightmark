import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyTextCompletion,
  directoryFromPath,
  extractHeadings,
  findHtmlCompletionContext,
  findTextMatches,
  fileNameFromPath,
  formatSelection,
  isExternalUrl,
  isMarkdownName,
  isRelativeImageSource,
  mapScrollByAnchors,
  renderEditorDecorations,
  sortDocuments,
} from "./core.js";

describe("Markdown document helpers", () => {
  it("sorts numbered Chinese filenames naturally", () => {
    const documents = [
      { name: "10-第十页.md" },
      { name: "02-第二页.md" },
      { name: "01-第一页.md" },
    ];
    assert.deepEqual(sortDocuments(documents).map((item) => item.name), [
      "01-第一页.md",
      "02-第二页.md",
      "10-第十页.md",
    ]);
  });

  it("accepts only md and markdown extensions", () => {
    assert.equal(isMarkdownName("说明.MD"), true);
    assert.equal(isMarkdownName("notes.markdown"), true);
    assert.equal(isMarkdownName("notes.txt"), false);
  });

  it("handles Windows paths with drives, spaces, and Chinese characters", () => {
    const path = "D:\\资料 归档\\中文目录\\01-开始.md";
    assert.equal(fileNameFromPath(path), "01-开始.md");
    assert.equal(directoryFromPath(path), "D:\\资料 归档\\中文目录");
  });

  it("finds document text case-insensitively in reading order", () => {
    assert.deepEqual(findTextMatches("Markdown 与 markdown，再来一个 MARKDOWN", "markdown"), [0, 11, 25]);
    assert.deepEqual(findTextMatches("轻阅 Markdown", ""), []);
  });

  it("maps editor scroll between matching content anchors", () => {
    const anchors = [
      { editor: 0, preview: 0 },
      { editor: 100, preview: 220 },
      { editor: 300, preview: 500 },
    ];
    assert.equal(mapScrollByAnchors(-10, anchors), 0);
    assert.equal(mapScrollByAnchors(50, anchors), 110);
    assert.equal(mapScrollByAnchors(200, anchors), 360);
    assert.equal(mapScrollByAnchors(400, anchors), 500);
  });

  it("recognizes only a safe unfinished angle-bracket completion context", () => {
    assert.deepEqual(findHtmlCompletionContext("正文\n<br", 6), { start: 3, end: 6, query: "br" });
    assert.deepEqual(findHtmlCompletionContext("<MA", 3), { start: 0, end: 3, query: "ma" });
    assert.equal(findHtmlCompletionContext("<br>", 4), null);
    assert.equal(findHtmlCompletionContext("普通文字", 4), null);
    assert.equal(findHtmlCompletionContext("<<", 2), null);
  });

  it("inserts a completion and selects only its editable placeholder", () => {
    const context = findHtmlCompletionContext("前文\n<ma", 6);
    const completion = {
      text: "<mark>高光文字</mark>",
      selectionStart: 6,
      selectionEnd: 10,
    };
    assert.deepEqual(applyTextCompletion("前文\n<ma后文", context, completion), {
      text: "前文\n<mark>高光文字</mark>后文",
      selectionStart: 9,
      selectionEnd: 13,
      applied: true,
    });
  });

  it("distinguishes external links and relative images", () => {
    assert.equal(isExternalUrl("https://example.com"), true);
    assert.equal(isExternalUrl("javascript:alert(1)"), false);
    assert.equal(isRelativeImageSource("images/示例.png"), true);
    assert.equal(isRelativeImageSource("https://example.com/image.png"), false);
    assert.equal(isRelativeImageSource("data:image/png;base64,AA=="), false);
  });

  it("extracts a hierarchical outline while ignoring fenced code headings", () => {
    const source = "# 第一章\r\n\r\n## [第二节](chapter.md)\r\n\r\n```md\r\n# 代码里的标题\r\n```\r\n\r\n补充标题\r\n---\r\n";
    assert.deepEqual(extractHeadings(source), [
      { level: 1, title: "第一章", offset: 0, line: 0 },
      { level: 2, title: "第二节", offset: 9, line: 2 },
      { level: 2, title: "补充标题", offset: 57, line: 8 },
    ]);
    assert.deepEqual(extractHeadings("---\ntitle: 不应成为标题\ntags: [测试]\n---\n# 正文标题\n"), [
      { level: 1, title: "正文标题", offset: 33, line: 4 },
    ]);
  });

  it("adds and removes yellow highlight markup around selected text", () => {
    const applied = formatSelection("前面重点后面", 2, 4, "highlight");
    assert.equal(applied.text, "前面<mark>重点</mark>后面");
    assert.deepEqual([applied.selectionStart, applied.selectionEnd], [8, 10]);

    const removed = formatSelection(applied.text, applied.selectionStart, applied.selectionEnd, "highlight");
    assert.equal(removed.text, "前面重点后面");
    assert.equal(removed.removed, true);
  });

  it("adds safe class-based red text markup", () => {
    const applied = formatSelection("这句需要强调", 2, 6, "redText");
    assert.equal(applied.text, '这句<span class="text-red">需要强调</span>');
    assert.deepEqual([applied.selectionStart, applied.selectionEnd], [25, 29]);
  });

  it("renders safe editor-only yellow and red decorations without trusting document HTML", () => {
    const source = '<script>alert(1)</script> <mark>黄色 & 重点</mark> <span class="text-red">红字</span>';
    const html = renderEditorDecorations(source);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /<mark class="editor-source-highlight">黄色 &amp; 重点<\/mark>/);
    assert.match(html, /<span class="editor-source-red">红字<\/span>/);
    assert.match(html, /&lt;mark&gt;/);
    assert.match(html, /&lt;span class=&quot;text-red&quot;&gt;/);
  });

  it("does not wrap selections across Markdown blocks", () => {
    const source = "第一段\n\n第二段";
    assert.deepEqual(formatSelection(source, 0, source.length, "highlight"), {
      text: source,
      applied: false,
      reason: "multiple-blocks",
    });
    const windowsSource = "第一段\r\n\r\n第二段";
    assert.equal(formatSelection(windowsSource, 0, windowsSource.length, "redText").reason, "multiple-blocks");
  });
});
