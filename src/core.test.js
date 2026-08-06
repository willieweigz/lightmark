import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  directoryFromPath,
  fileNameFromPath,
  formatSelection,
  isExternalUrl,
  isMarkdownName,
  isRelativeImageSource,
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

  it("distinguishes external links and relative images", () => {
    assert.equal(isExternalUrl("https://example.com"), true);
    assert.equal(isExternalUrl("javascript:alert(1)"), false);
    assert.equal(isRelativeImageSource("images/示例.png"), true);
    assert.equal(isRelativeImageSource("https://example.com/image.png"), false);
    assert.equal(isRelativeImageSource("data:image/png;base64,AA=="), false);
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
