export const AI_CONTEXT_LIMIT = 160_000;

const ANSWER_MODES = Object.freeze({
  source: { label: "只依据原文", summary: "资料之外不补充", privacy: "仅发送资料；只依据原文" },
  natural: { label: "自然回答", summary: "可补充模型常识", privacy: "仅发送资料；可补充模型常识" },
  web: { label: "联网查证", summary: "搜索网页并列来源", privacy: "将联网搜索并列出关键来源" },
});

export function normalizeAnswerMode(value) {
  return value in ANSWER_MODES ? value : "source";
}

export function answerModeDetails(value) {
  return ANSWER_MODES[normalizeAnswerMode(value)];
}

export function chooseAiContext({ mode, documentText, editorSelection = "", previewSelection = "" }) {
  const selection = (editorSelection || previewSelection).trim();
  if (mode === "selection") {
    return selection
      ? { kind: "选中文字", text: selection }
      : { kind: "选中文字", text: "", error: "请先在文章或编辑区选中一段文字。" };
  }
  const text = String(documentText || "").trim();
  return text
    ? { kind: "整篇文章", text }
    : { kind: "整篇文章", text: "", error: "请先打开一篇 Markdown 文档。" };
}

export function accountLabel({ signedIn, accountType, planType }) {
  if (!signedIn) return "尚未登录 Codex";
  if (accountType === "chatgpt") {
    const plans = {
      free: "Free",
      go: "Go",
      plus: "Plus",
      pro: "Pro",
      prolite: "Pro",
      team: "Team",
      business: "Business",
      enterprise: "Enterprise",
      edu: "Edu",
    };
    return `ChatGPT ${plans[planType] || "已登录"}`;
  }
  if (accountType === "apiKey") return "Codex API Key";
  return "Codex 已登录";
}

export function contextPreview(kind, text) {
  const count = [...String(text || "")].length;
  return `${kind} · ${count.toLocaleString("zh-CN")} 字`;
}
