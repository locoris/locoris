export function normalizeDisplayName(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function truncateDisplayText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trim()}…`;
}

export function stripLeadingPreviewPrefix(source: string, prefix: string) {
  if (!prefix) {
    return source;
  }

  if (!source.toLowerCase().startsWith(prefix.toLowerCase())) {
    return source;
  }

  return source
    .slice(prefix.length)
    .replace(/^[\s\-–—:.,;!?]+/, "")
    .trim();
}

export function hasExplicitDisplayName(value: unknown) {
  return normalizeDisplayName(value).length > 0;
}

export function deriveDisplayTitleFromText(value: unknown, maxLength = 72) {
  const normalized = normalizeDisplayName(value);

  if (!normalized) {
    return "";
  }

  return truncateDisplayText(normalized, maxLength);
}
