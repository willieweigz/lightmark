import test from "node:test";
import assert from "node:assert/strict";
import { accountLabel, answerModeDetails, chooseAiContext, contextPreview, normalizeAnswerMode } from "./ai.js";

test("AI 助读默认发送整篇 Markdown", () => {
  assert.deepEqual(chooseAiContext({ mode: "document", documentText: "# 标题\n正文" }), {
    kind: "整篇文章",
    text: "# 标题\n正文",
  });
});

test("选中文字模式不会悄悄退回整篇文章", () => {
  const result = chooseAiContext({ mode: "selection", documentText: "全文", editorSelection: "" });
  assert.equal(result.text, "");
  assert.match(result.error, /先.*选中/);
});

test("编辑区选中文字优先于预览区旧选区", () => {
  const result = chooseAiContext({
    mode: "selection",
    documentText: "全文",
    editorSelection: "正在编辑的句子",
    previewSelection: "旧选区",
  });
  assert.equal(result.text, "正在编辑的句子");
});

test("账户和上下文标签使用小白可读的中文", () => {
  assert.equal(accountLabel({ signedIn: true, accountType: "chatgpt", planType: "plus" }), "ChatGPT Plus");
  assert.equal(accountLabel({ signedIn: false }), "尚未登录 Codex");
  assert.equal(contextPreview("选中文字", "甲乙丙"), "选中文字 · 3 字");
});

test("三种回答方式逐层扩大知识范围且未知值回到原文模式", () => {
  assert.equal(answerModeDetails("source").label, "只依据原文");
  assert.match(answerModeDetails("natural").summary, /模型常识/);
  assert.match(answerModeDetails("web").summary, /网页/);
  assert.equal(normalizeAnswerMode("future-mode"), "source");
});
