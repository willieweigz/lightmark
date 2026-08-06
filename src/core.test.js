import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  directoryFromPath,
  fileNameFromPath,
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
});
