export const pastedImageScheme = "lightmark-paste-image://";

function normalizeInlineWhitespace(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[\t\r\n ]+/g, " ");
}

function escapeMarkdownText(value) {
  return normalizeInlineWhitespace(value).replace(/([\\`*_[\]<>])/g, "\\$1");
}

function escapeLinkDestination(value) {
  return String(value || "").replace(/([\\()])/g, "\\$1");
}

function safeLink(value) {
  const trimmed = String(value || "").trim();
  return /^(?:https?:|mailto:)/i.test(trimmed) ? trimmed : "";
}

function saveableImageSource(value) {
  const trimmed = String(value || "").trim();
  return /^(?:https?:|data:image\/(?:png|jpe?g|gif|webp|bmp);base64,)/i.test(trimmed)
    ? trimmed
    : "";
}

function directChildren(element, tagName) {
  return [...element.children].filter((child) => child.tagName.toLocaleLowerCase() === tagName);
}

function renderTable(element, renderChildren) {
  const rows = [...element.querySelectorAll("tr")].map((row) => (
    [...row.querySelectorAll(":scope > th, :scope > td")].map((cell) => (
      renderChildren(cell).trim().replace(/\|/g, "\\|").replace(/\n+/g, "<br>")
    ))
  )).filter((row) => row.length);
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill("")]);
  const lines = [
    `| ${normalized[0].join(" | ")} |`,
    `| ${Array(width).fill("---").join(" | ")} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ];
  return `${lines.join("\n")}\n\n`;
}

function renderList(element, ordered, renderNode, depth = 0) {
  const items = directChildren(element, "li");
  const start = ordered ? Number.parseInt(element.getAttribute("start") || "1", 10) || 1 : 1;
  return `${items.map((item, index) => {
    const nestedLists = [...item.children].filter((child) => ["ul", "ol"].includes(child.tagName.toLocaleLowerCase()));
    const body = [...item.childNodes]
      .filter((child) => !nestedLists.includes(child))
      .map((child) => renderNode(child, depth + 1))
      .join("")
      .trim()
      .replace(/\n+/g, " ");
    const prefix = ordered ? `${start + index}. ` : "- ";
    const nested = nestedLists.map((list) => renderList(
      list,
      list.tagName.toLocaleLowerCase() === "ol",
      renderNode,
      depth + 1,
    )).join("").trimEnd();
    const indentation = "  ".repeat(depth);
    return `${indentation}${prefix}${body}${nested ? `\n${nested}` : ""}`;
  }).join("\n")}\n\n`;
}

export function clipboardHtmlToMarkdown(html, {
  parseHtml = (source) => new DOMParser().parseFromString(source, "text/html"),
  makeImageId = () => crypto.randomUUID(),
} = {}) {
  const document = parseHtml(String(html || ""));
  const images = [];

  const renderChildren = (element, depth = 0) => (
    [...element.childNodes].map((child) => renderNode(child, depth)).join("")
  );

  const renderNode = (node, depth = 0) => {
    if (node.nodeType === 3) return escapeMarkdownText(node.nodeValue);
    if (node.nodeType !== 1) return "";
    const tag = node.tagName.toLocaleLowerCase();
    if (["script", "style", "noscript", "template", "iframe", "object"].includes(tag)) return "";
    if (tag === "br") return "\n";
    if (tag === "hr") return "\n---\n\n";
    if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${renderChildren(node, depth).trim()}\n\n`;
    if (["p", "div", "section", "article", "header", "footer", "main", "aside", "figure", "figcaption"].includes(tag)) {
      const content = renderChildren(node, depth).trim();
      return content ? `${content}\n\n` : "";
    }
    if (["strong", "b"].includes(tag)) {
      const content = renderChildren(node, depth).trim();
      return content ? `**${content}**` : "";
    }
    if (["em", "i"].includes(tag)) {
      const content = renderChildren(node, depth).trim();
      return content ? `*${content}*` : "";
    }
    if (["del", "s", "strike"].includes(tag)) {
      const content = renderChildren(node, depth).trim();
      return content ? `~~${content}~~` : "";
    }
    if (tag === "blockquote") {
      const content = renderChildren(node, depth).trim();
      return content ? `${content.split("\n").map((line) => `> ${line}`).join("\n")}\n\n` : "";
    }
    if (tag === "pre") {
      const code = node.textContent?.replace(/\r\n?/g, "\n").trimEnd() || "";
      const className = node.querySelector("code")?.className || "";
      const language = className.match(/(?:language-|lang-)([\w+-]+)/i)?.[1] || "";
      return code ? `\`\`\`${language}\n${code}\n\`\`\`\n\n` : "";
    }
    if (tag === "code") {
      const content = normalizeInlineWhitespace(node.textContent || "").trim();
      return content ? `\`${content.replace(/`/g, "\\`")}\`` : "";
    }
    if (tag === "a") {
      const content = renderChildren(node, depth).trim();
      const href = safeLink(node.getAttribute("href"));
      return href && content ? `[${content}](${escapeLinkDestination(href)})` : content;
    }
    if (tag === "img") {
      const alt = escapeMarkdownText(node.getAttribute("alt") || node.getAttribute("title") || "图片").trim() || "图片";
      const sourceCandidates = [
        node.getAttribute("src"),
        node.getAttribute("data-src"),
        node.getAttribute("data-original"),
      ].filter(Boolean);
      const rawSource = sourceCandidates[0] || "";
      const source = sourceCandidates.map(saveableImageSource).find(Boolean) || "";
      if (source) {
        const id = String(makeImageId());
        images.push({ id, source });
        return `![${alt}](${pastedImageScheme}${id})`;
      }
      return rawSource ? `![${alt}](${escapeLinkDestination(rawSource)})` : alt;
    }
    if (tag === "ul") return renderList(node, false, renderNode, depth);
    if (tag === "ol") return renderList(node, true, renderNode, depth);
    if (tag === "table") return renderTable(node, (cell) => renderChildren(cell, depth));
    return renderChildren(node, depth);
  };

  const markdown = renderChildren(document.body)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { markdown, images };
}

export function pastedImagePlaceholder(id) {
  return `${pastedImageScheme}${id}`;
}

export function referencedPastedImages(contents, pendingImages) {
  return [...pendingImages.values()].filter((image) => (
    String(contents || "").includes(pastedImagePlaceholder(image.id))
  ));
}
