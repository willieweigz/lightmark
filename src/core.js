export const markdownExtensions = ["md", "markdown"];

export function isMarkdownName(name) {
  const extension = name.split(".").pop()?.toLocaleLowerCase();
  return markdownExtensions.includes(extension);
}

export function sortDocuments(documents, locale = "zh-CN") {
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: "base",
  });
  return [...documents].sort((left, right) => collator.compare(left.name, right.name));
}

export function isExternalUrl(value) {
  return /^(https?:|mailto:)/i.test(value);
}

export function isRelativeImageSource(value) {
  return Boolean(value) && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#|\/)/i.test(value);
}

export function fileNameFromPath(path) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function directoryFromPath(path) {
  const normalized = path.replace(/[\\/]+$/, "");
  const index = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  return index >= 0 ? normalized.slice(0, index) : "";
}

export function findTextMatches(source, query, locale = "zh-CN") {
  if (!query) return [];
  const haystack = source.toLocaleLowerCase(locale);
  const needle = query.toLocaleLowerCase(locale);
  const matches = [];
  let offset = 0;
  while (offset <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, offset);
    if (index < 0) break;
    matches.push(index);
    offset = index + Math.max(1, needle.length);
  }
  return matches;
}

export function mapScrollByAnchors(position, anchors) {
  if (!anchors.length) return 0;
  if (position <= anchors[0].editor) return anchors[0].preview;
  for (let index = 1; index < anchors.length; index += 1) {
    const previous = anchors[index - 1];
    const next = anchors[index];
    if (position > next.editor) continue;
    const span = next.editor - previous.editor;
    if (span <= 0) return next.preview;
    const progress = (position - previous.editor) / span;
    return previous.preview + (next.preview - previous.preview) * progress;
  }
  return anchors[anchors.length - 1].preview;
}

export function findHtmlCompletionContext(source, cursor) {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > source.length) return null;
  const lineStart = Math.max(source.lastIndexOf("\n", cursor - 1), source.lastIndexOf("\r", cursor - 1)) + 1;
  const fragment = source.slice(lineStart, cursor);
  const match = fragment.match(/<([a-z]*)$/i);
  if (!match) return null;
  const start = lineStart + match.index;
  if (start > 0 && source[start - 1] === "<") return null;
  return { start, end: cursor, query: match[1].toLocaleLowerCase() };
}

export function applyTextCompletion(source, context, completion) {
  const validContext = context
    && Number.isInteger(context.start)
    && Number.isInteger(context.end)
    && context.start >= 0
    && context.end >= context.start
    && context.end <= source.length;
  if (!validContext || typeof completion?.text !== "string") {
    return { text: source, applied: false };
  }
  const selectionStart = context.start + (completion.selectionStart ?? completion.text.length);
  const selectionEnd = context.start + (completion.selectionEnd ?? completion.selectionStart ?? completion.text.length);
  return {
    text: source.slice(0, context.start) + completion.text + source.slice(context.end),
    selectionStart,
    selectionEnd,
    applied: true,
  };
}

function plainHeadingText(value) {
  return value
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?]]/g, (_, target, label) => label || target)
    .replace(/<[^>]+>/g, "")
    .replace(/[*_~`]/g, "")
    .trim();
}

export function extractHeadings(source) {
  const headings = [];
  let fence = null;
  let frontmatter = false;
  let previousLine = null;
  let lineNumber = 0;

  for (const match of source.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    if (!match[0]) break;
    const line = match[0].replace(/(?:\r\n|\r|\n)$/, "");
    const normalizedLine = line.replace(/^\uFEFF/, "").trim();
    if (lineNumber === 0 && normalizedLine === "---") {
      frontmatter = true;
      previousLine = null;
      lineNumber += 1;
      continue;
    }
    if (frontmatter) {
      if (normalizedLine === "---") frontmatter = false;
      previousLine = null;
      lineNumber += 1;
      continue;
    }
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) fence = { character: marker[0], length: marker.length };
      else if (marker[0] === fence.character && marker.length >= fence.length) fence = null;
      previousLine = null;
      lineNumber += 1;
      continue;
    }
    if (fence) {
      previousLine = null;
      lineNumber += 1;
      continue;
    }

    const atx = line.match(/^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/);
    if (atx) {
      const title = plainHeadingText(atx[2].replace(/[ \t]+#+[ \t]*$/, ""));
      if (title) headings.push({ level: atx[1].length, title, offset: match.index, line: lineNumber });
      previousLine = null;
      lineNumber += 1;
      continue;
    }

    const setext = line.match(/^ {0,3}(=+|-+)[ \t]*$/);
    if (setext && previousLine?.text.trim()) {
      const title = plainHeadingText(previousLine.text);
      if (title) headings.push({
        level: setext[1][0] === "=" ? 1 : 2,
        title,
        offset: previousLine.offset,
        line: previousLine.line,
      });
      previousLine = null;
    } else {
      previousLine = { text: line, offset: match.index, line: lineNumber };
    }
    lineNumber += 1;
  }
  return headings;
}

const inlineFormats = Object.freeze({
  highlight: { opening: "<mark>", closing: "</mark>" },
  redText: { opening: '<span class="text-red">', closing: "</span>" },
});

export function formatSelection(source, selectionStart, selectionEnd, format) {
  const wrapper = inlineFormats[format];
  const validRange = Number.isInteger(selectionStart)
    && Number.isInteger(selectionEnd)
    && selectionStart >= 0
    && selectionEnd <= source.length
    && selectionStart < selectionEnd;
  if (!wrapper || !validRange) return { text: source, applied: false, reason: "invalid-selection" };

  const { opening, closing } = wrapper;
  const selected = source.slice(selectionStart, selectionEnd);
  if (/\r?\n\r?\n/.test(selected)) return { text: source, applied: false, reason: "multiple-blocks" };

  const outerStart = selectionStart - opening.length;
  const outerEnd = selectionEnd + closing.length;
  if (
    outerStart >= 0
    && source.slice(outerStart, selectionStart) === opening
    && source.slice(selectionEnd, outerEnd) === closing
  ) {
    return {
      text: source.slice(0, outerStart) + selected + source.slice(outerEnd),
      selectionStart: outerStart,
      selectionEnd: outerStart + selected.length,
      applied: true,
      removed: true,
    };
  }

  if (selected.startsWith(opening) && selected.endsWith(closing)) {
    const content = selected.slice(opening.length, -closing.length);
    return {
      text: source.slice(0, selectionStart) + content + source.slice(selectionEnd),
      selectionStart,
      selectionEnd: selectionStart + content.length,
      applied: true,
      removed: true,
    };
  }

  return {
    text: source.slice(0, selectionStart) + opening + selected + closing + source.slice(selectionEnd),
    selectionStart: selectionStart + opening.length,
    selectionEnd: selectionEnd + opening.length,
    applied: true,
    removed: false,
  };
}
