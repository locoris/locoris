import type { AppLanguage, Note, NoteContent, StoredBlock } from "../../types";
import { getDisplayNoteTitle } from "../../localization/displayNames";
import { extractPlainText } from "../notes";
import { sanitizeExportFileName } from "./filenames";
import {
  formatDateTimeValue,
  getCurrentLocaleRuntime,
  getLocaleDirection,
  resolveSupportedLocale
} from "../../localization";

type InlineRenderResult = {
  markdown: string;
  html: string;
  text: string;
};

const FONT_FAMILIES: Record<string, string> = {
  onest: "'Onest Variable', Onest, system-ui, sans-serif",
  ibmPlexSans: "'IBM Plex Sans', system-ui, sans-serif",
  golosText: "'Golos Text Variable', 'Golos Text', system-ui, sans-serif",
  ibmPlexSerif: "'IBM Plex Serif', Georgia, serif",
  ibmPlexMono: "'IBM Plex Mono', monospace",
  unbounded: "'Unbounded Variable', Unbounded, system-ui, sans-serif"
};

export function getNoteExportBaseName(note: Pick<Note, "title" | "plainText" | "excerpt">, language: AppLanguage) {
  return sanitizeExportFileName(getDisplayNoteTitle(note, language), "note");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const MARKDOWN_SPECIAL_CHARACTERS = new Set([
  "\\",
  "`",
  "*",
  "_",
  "[",
  "]",
  "<",
  ">",
  "|"
]);

const MARKDOWN_LINK_CHARACTER_ESCAPES: Record<string, string> = {
  " ": "%20",
  "\n": "%0A",
  "\r": "%0D",
  "(": "%28",
  ")": "%29",
  "<": "%3C",
  ">": "%3E",
  "\\": "%5C"
};

function escapeMarkdown(value: string) {
  return Array.from(value, (character) =>
    MARKDOWN_SPECIAL_CHARACTERS.has(character) ? `\\${character}` : character
  ).join("");
}

function escapeMarkdownLinkDestination(value: string) {
  return Array.from(value, (character) => MARKDOWN_LINK_CHARACTER_ESCAPES[character] ?? character).join("");
}

function normalizeColor(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim();
  return /^(?:#[0-9a-f]{3,8}|[a-z]+)$/i.test(normalized) ? normalized : "";
}

function normalizeAlignment(value: unknown) {
  return value === "center" || value === "right" || value === "justify" ? value : "";
}

function normalizeExportUrl(value: unknown, options: { allowImageData?: boolean } = {}) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim();
  if (!normalized || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return "";
  }

  if (
    options.allowImageData &&
    /^data:image\/(?:avif|gif|jpe?g|png|webp);base64,[a-z0-9+/=\s]+$/i.test(normalized)
  ) {
    return normalized;
  }

  try {
    const parsed = new URL(normalized, "https://locoris.invalid/");
    return ["http:", "https:", "mailto:", "tel:", "asset:"].includes(parsed.protocol)
      ? normalized
      : "";
  } catch {
    return "";
  }
}

function renderInlineNode(node: unknown): InlineRenderResult {
  if (typeof node === "string") {
    return {
      markdown: node,
      html: escapeHtml(node),
      text: node
    };
  }

  if (!node || typeof node !== "object") {
    return { markdown: "", html: "", text: "" };
  }

  const record = node as Record<string, unknown>;

  if (record.type === "link") {
    const rendered = renderInlineContent(record.content);
    const href = normalizeExportUrl(record.href);
    const safeHref = escapeHtml(href);
    const markdownHref = escapeMarkdownLinkDestination(href);

    return {
      markdown: href
        ? `[${rendered.markdown || escapeMarkdown(rendered.text)}](${markdownHref})`
        : rendered.markdown,
      html: href
        ? `<a href="${safeHref}" rel="noopener noreferrer">${rendered.html}</a>`
        : rendered.html,
      text: rendered.text
    };
  }

  const rawText = typeof record.text === "string" ? record.text : "";
  const styles = record.styles && typeof record.styles === "object"
    ? (record.styles as Record<string, unknown>)
    : {};
  let markdown = escapeMarkdown(rawText);
  let html = escapeHtml(rawText);
  const styleRules: string[] = [];
  const textColor = normalizeColor(styles.textColor);
  const backgroundColor = normalizeColor(styles.backgroundColor);
  const font = typeof styles.font === "string" ? FONT_FAMILIES[styles.font] : "";

  if (styles.code) {
    markdown = `\`${markdown}\``;
    html = `<code>${html}</code>`;
  }

  if (styles.bold) {
    markdown = `**${markdown}**`;
    html = `<strong>${html}</strong>`;
  }

  if (styles.italic) {
    markdown = `_${markdown}_`;
    html = `<em>${html}</em>`;
  }

  if (styles.underline) {
    html = `<u>${html}</u>`;
  }

  if (styles.strike) {
    markdown = `~~${markdown}~~`;
    html = `<s>${html}</s>`;
  }

  if (textColor) {
    styleRules.push(`color:${escapeHtml(textColor)}`);
  }

  if (backgroundColor) {
    styleRules.push(`background:${escapeHtml(backgroundColor)}`);
    styleRules.push("border-radius:4px");
    styleRules.push("padding:0 0.15em");
  }

  if (font) {
    styleRules.push(`font-family:${font}`);
  }

  if (styleRules.length) {
    html = `<span style="${styleRules.join(";")}">${html}</span>`;
  }

  return {
    markdown,
    html,
    text: rawText
  };
}

function renderInlineContent(content: unknown): InlineRenderResult {
  const parts = Array.isArray(content) ? content.map(renderInlineNode) : [renderInlineNode(content)];

  return {
    markdown: parts.map((part) => part.markdown).join(""),
    html: parts.map((part) => part.html).join(""),
    text: parts.map((part) => part.text).join("")
  };
}

function getBlockProps(block: StoredBlock) {
  return block.props && typeof block.props === "object" ? block.props : {};
}

function getBlockText(block: StoredBlock) {
  return renderInlineContent(block.content).text.trim();
}

function getBlockHtmlStyle(block: StoredBlock) {
  const props = getBlockProps(block);
  const rules: string[] = [];
  const textColor = normalizeColor(props.textColor);
  const backgroundColor = normalizeColor(props.backgroundColor);
  const alignment = normalizeAlignment(props.textAlignment);

  if (textColor) {
    rules.push(`color:${escapeHtml(textColor)}`);
  }

  if (backgroundColor) {
    rules.push(`background:${escapeHtml(backgroundColor)}`);
    rules.push("border-radius:8px");
    rules.push("padding:0.32rem 0.5rem");
  }

  if (alignment) {
    rules.push(`text-align:${alignment}`);
  }

  return rules.length ? ` style="${rules.join(";")}"` : "";
}

function renderBlockMarkdown(block: StoredBlock, depth = 0): string[] {
  const type = block.type ?? "paragraph";
  const rendered = renderInlineContent(block.content);
  const indent = "  ".repeat(depth);
  const children = (block.children ?? []).flatMap((child) => renderBlockMarkdown(child, depth + 1));

  let lines: string[];

  if (type === "heading") {
    const levelValue = getBlockProps(block).level;
    const level = typeof levelValue === "number" ? Math.max(1, Math.min(6, Math.round(levelValue))) : 2;
    lines = [`${"#".repeat(level)} ${rendered.markdown}`];
  } else if (type === "quote") {
    lines = [`> ${rendered.markdown}`];
  } else if (type === "codeBlock") {
    const language = typeof getBlockProps(block).language === "string" ? getBlockProps(block).language : "";
    lines = [`\`\`\`${language}`, rendered.text, "```"];
  } else if (type === "bulletListItem" || type === "toggleListItem") {
    lines = [`${indent}- ${rendered.markdown}`];
  } else if (type === "numberedListItem") {
    lines = [`${indent}1. ${rendered.markdown}`];
  } else if (type === "checkListItem") {
    const checked = getBlockProps(block).checked === true ? "x" : " ";
    lines = [`${indent}- [${checked}] ${rendered.markdown}`];
  } else if (type === "divider") {
    lines = ["---"];
  } else if (type === "image" || type === "file" || type === "audio" || type === "video") {
    const props = getBlockProps(block);
    const name = typeof props.name === "string" ? props.name : type;
    const url = normalizeExportUrl(props.url, { allowImageData: type === "image" });
    const safeName = escapeMarkdown(name);
    lines = url
      ? [`[${safeName}](${escapeMarkdownLinkDestination(url)})`]
      : [`[${safeName}]`];
  } else {
    lines = [rendered.markdown];
  }

  return [...lines, ...children];
}

function renderBlockHtml(block: StoredBlock): string {
  const type = block.type ?? "paragraph";
  const rendered = renderInlineContent(block.content);
  const style = getBlockHtmlStyle(block);
  const children = (block.children ?? []).map(renderBlockHtml).join("");

  if (type === "heading") {
    const levelValue = getBlockProps(block).level;
    const level = typeof levelValue === "number" ? Math.max(1, Math.min(6, Math.round(levelValue))) : 2;
    return `<h${level}${style}>${rendered.html}</h${level}>${children}`;
  }

  if (type === "quote") {
    return `<blockquote${style}>${rendered.html}</blockquote>${children}`;
  }

  if (type === "codeBlock") {
    return `<pre${style}><code>${escapeHtml(rendered.text)}</code></pre>${children}`;
  }

  if (type === "bulletListItem" || type === "toggleListItem") {
    return `<ul${style}><li>${rendered.html}${children}</li></ul>`;
  }

  if (type === "numberedListItem") {
    return `<ol${style}><li>${rendered.html}${children}</li></ol>`;
  }

  if (type === "checkListItem") {
    const checked = getBlockProps(block).checked === true;
    return `<ul class="checklist"${style}><li data-checked="${checked ? "true" : "false"}"><span class="check">${checked ? "✓" : ""}</span>${rendered.html}${children}</li></ul>`;
  }

  if (type === "divider") {
    return "<hr />";
  }

  if (type === "image" || type === "file" || type === "audio" || type === "video") {
    const props = getBlockProps(block);
    const name = typeof props.name === "string" ? props.name : type;
    const url = normalizeExportUrl(props.url, { allowImageData: type === "image" });
    const caption = typeof props.caption === "string" ? props.caption : "";

    if (type === "image" && url) {
      return `<figure${style}><img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" /><figcaption>${escapeHtml(caption || name)}</figcaption></figure>${children}`;
    }

    const label = escapeHtml(name);
    const link = url
      ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${label}</a>`
      : label;
    return `<p${style}>${link}${caption ? ` <span>${escapeHtml(caption)}</span>` : ""}</p>${children}`;
  }

  return `<p${style}>${rendered.html || "&nbsp;"}</p>${children}`;
}

export function blocksToMarkdown(blocks: NoteContent) {
  return blocks
    .flatMap((block) => renderBlockMarkdown(block))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function blocksToPlainText(blocks: NoteContent) {
  return extractPlainText(blocks).trim();
}

export function blocksToHtmlBody(blocks: NoteContent) {
  return blocks.map(renderBlockHtml).join("\n");
}

export function buildNoteHtmlDocument(input: {
  note: Note;
  language: AppLanguage;
  markdown?: string;
  generatedAt?: Date;
  additionalCss?: string;
}) {
  const title = getDisplayNoteTitle(input.note, input.language);
  const body = blocksToHtmlBody(input.note.content);
  const documentLocale = resolveSupportedLocale(input.language);
  const direction = getLocaleDirection(documentLocale);
  const generatedLabel = formatDateTimeValue(
    input.generatedAt ?? new Date(),
    getCurrentLocaleRuntime(),
    { dateStyle: "medium", timeStyle: "short" }
  );

  return `<!doctype html>
<html lang="${documentLocale}" dir="${direction}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    ${input.additionalCss ? `${input.additionalCss}\n` : ""}
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 48px;
      background: #f7f8fb;
      color: #111827;
      font-family: "Golos Text Variable", "Golos Text", "IBM Plex Sans", "Onest Variable", Onest, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.65;
      font-kerning: normal;
      text-rendering: optimizeLegibility;
    }
    main {
      max-width: 840px;
      margin: 0 auto;
      padding: 42px;
      border: 1px solid rgba(17, 24, 39, 0.08);
      border-radius: 24px;
      background: #ffffff;
      box-shadow: 0 24px 80px rgba(15, 23, 42, 0.08);
      overflow-wrap: anywhere;
    }
    h1, h2, h3, h4, h5, h6 {
      font-family: "IBM Plex Sans", "Onest Variable", Onest, system-ui, sans-serif;
      line-height: 1.28;
      letter-spacing: 0;
      break-after: avoid;
      page-break-after: avoid;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    h1.title { margin-top: 0; font-size: 2rem; }
    p, ul, ol, blockquote, pre, figure, table, hr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    blockquote { margin-left: 0; padding-left: 1rem; border-left: 3px solid ${escapeHtml(normalizeColor(input.note.color) || "#d7a84f")}; color: #4b5563; }
    pre { overflow: auto; padding: 1rem; border-radius: 14px; background: #111827; color: #f8fafc; }
    code { font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    img { max-width: 100%; height: auto; border-radius: 14px; }
    figcaption { color: #6b7280; font-size: 0.85rem; }
    .meta { color: #6b7280; font-size: 0.82rem; margin-bottom: 1.4rem; }
    .checklist { list-style: none; padding-left: 0; }
    .check { width: 1.1rem; height: 1.1rem; display: inline-grid; place-items: center; margin-right: 0.5rem; border: 1px solid #9ca3af; border-radius: 0.35rem; color: #0f766e; font-weight: 700; }
    @media print {
      body { padding: 0; background: #fff; }
      main { box-shadow: none; border: 0; border-radius: 0; }
    }
  </style>
</head>
<body>
  <main>
    <h1 class="title">${escapeHtml(title)}</h1>
    <p class="meta">${escapeHtml(generatedLabel)}</p>
    ${body || "<p></p>"}
  </main>
</body>
</html>`;
}
