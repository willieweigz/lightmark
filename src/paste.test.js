import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  pastedImagePlaceholder,
  pastedImageScheme,
  referencedPastedImages,
} from "./paste.js";

describe("富文本粘贴图片助手", () => {
  it("为待保存图片生成不会与普通网址混淆的占位地址", () => {
    assert.equal(pastedImageScheme, "lightmark-paste-image://");
    assert.equal(pastedImagePlaceholder("图-1"), "lightmark-paste-image://图-1");
  });

  it("保存时只提交仍被 Markdown 引用的图片", () => {
    const pending = new Map([
      ["a", { id: "a", source: "https://example.com/a.png" }],
      ["b", { id: "b", source: "https://example.com/b.jpg" }],
    ]);
    assert.deepEqual(
      referencedPastedImages("![保留](lightmark-paste-image://b)", pending),
      [{ id: "b", source: "https://example.com/b.jpg" }],
    );
    assert.deepEqual(referencedPastedImages("占位符已经被用户删除", pending), []);
  });
});
