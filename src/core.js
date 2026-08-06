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
