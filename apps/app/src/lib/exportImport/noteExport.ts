import {
  AlignmentType,
  BorderStyle,
  Document as DocxDocument,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType
} from "docx";
import type { jsPDF as JsPDFDocument } from "jspdf";

import type { AppLanguage, Note, NoteContent, StoredBlock } from "../../types";
import { getDisplayNoteTitle } from "../../localization/displayNames";
import {
  blocksToHtmlBody,
  blocksToMarkdown,
  blocksToPlainText,
  buildNoteHtmlDocument
} from "./noteSerialization";
import { getSelfContainedReadableExportFontCss } from "./readableExportFonts";
import { textBlob } from "./blob";
import { sanitizeExportFileName } from "./filenames";

export type NoteExportFormat = "pdf" | "docx" | "html" | "markdown";
export type NoteDocxAsset = {
  id: string;
  name: string;
  mimeType: string;
  blob: Blob;
};

const DOCX_MAX_IMAGE_WIDTH = 560;
const DOCX_MAX_IMAGE_HEIGHT = 720;
const DOCX_TABLE_WIDTH_TWIPS = 9020;
const DOCX_TABLE_CELL_MARGIN_TWIPS = 120;
const DOCX_TABLE_BORDER_COLOR = "CBD5E1";
const DOCX_TABLE_HEADER_FILL = "F1F5F9";
const DOCX_TABLE_HEADER_TEXT = "111827";

const DOCX_TEXT_COLORS: Record<string, string> = {
  gray: "#6B7280",
  brown: "#8B5E4B",
  red: "#DC2626",
  orange: "#EA580C",
  yellow: "#B45309",
  green: "#047857",
  blue: "#0369A1",
  purple: "#7C3AED",
  pink: "#DB2777"
};

const DOCX_BACKGROUND_COLORS: Record<string, string> = {
  gray: "#F3F4F6",
  brown: "#F4ECE7",
  red: "#FEE2E2",
  orange: "#FFEDD5",
  yellow: "#FEF3C7",
  green: "#D1FAE5",
  blue: "#E0F2FE",
  purple: "#EDE9FE",
  pink: "#FCE7F3"
};

type TableContent = {
  type?: string;
  columnWidths?: unknown;
  headerRows?: unknown;
  headerCols?: unknown;
  rows?: Array<{
    cells?: StoredBlock[];
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getInlineText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((node) => {
      if (typeof node === "string") {
        return node;
      }

      if (!node || typeof node !== "object") {
        return "";
      }

      const record = node as Record<string, unknown>;

      if (record.type === "link" && Array.isArray(record.content)) {
        return getInlineText(record.content);
      }

      return typeof record.text === "string" ? record.text : "";
    })
    .join("");
}

function getBlockProps(block: StoredBlock) {
  return block.props && typeof block.props === "object" ? block.props : {};
}

function getPositiveInteger(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.round(value))
    : fallback;
}

function normalizeDocxHexColor(value: unknown, palette: Record<string, string> = {}) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim();

  if (!normalized || normalized === "default") {
    return "";
  }

  const candidate = palette[normalized] ?? normalized;
  const match = /^#?([0-9a-f]{6})$/i.exec(candidate);

  return match?.[1]?.toUpperCase() ?? "";
}

function getDocxAlignment(value: unknown) {
  if (value === "center") {
    return AlignmentType.CENTER;
  }

  if (value === "right") {
    return AlignmentType.RIGHT;
  }

  if (value === "justify") {
    return AlignmentType.JUSTIFIED;
  }

  return AlignmentType.LEFT;
}

function getTableContent(content: unknown): TableContent | null {
  if (!isRecord(content) || !Array.isArray(content.rows) || content.rows.length === 0) {
    return null;
  }

  return content as TableContent;
}

function getTableCellSpan(cell: StoredBlock, key: "colspan" | "rowspan") {
  const props = getBlockProps(cell);
  return getPositiveInteger(props[key], 1);
}

function getTableColumnCount(tableContent: TableContent) {
  return Math.max(
    1,
    ...(tableContent.rows ?? []).map((row) =>
      (row.cells ?? []).reduce((count, cell) => count + getTableCellSpan(cell, "colspan"), 0)
    )
  );
}

function getDocxTableColumnWidths(tableContent: TableContent, columnCount: number) {
  const rawWidths = Array.isArray(tableContent.columnWidths) ? tableContent.columnWidths : [];
  const explicitWidths = Array.from({ length: columnCount }, (_, index) => {
    const value = rawWidths[index];
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  });
  const explicitPositiveWidths = explicitWidths.filter((width) => width > 0);
  const fallbackSourceWidth =
    explicitPositiveWidths.length > 0
      ? explicitPositiveWidths.reduce((sum, width) => sum + width, 0) / explicitPositiveWidths.length
      : 0;
  const positiveWidths = explicitWidths.map((width) => width || fallbackSourceWidth);
  const totalWidth = positiveWidths.reduce((sum, width) => sum + width, 0);

  if (totalWidth <= 0) {
    const baseWidth = Math.floor(DOCX_TABLE_WIDTH_TWIPS / columnCount);
    return Array.from({ length: columnCount }, (_, index) =>
      index === columnCount - 1
        ? DOCX_TABLE_WIDTH_TWIPS - baseWidth * (columnCount - 1)
        : baseWidth
    );
  }

  let usedWidth = 0;
  return positiveWidths.map((width, index) => {
    if (index === columnCount - 1) {
      return Math.max(1, DOCX_TABLE_WIDTH_TWIPS - usedWidth);
    }

    const nextWidth = Math.max(1, Math.round((width / totalWidth) * DOCX_TABLE_WIDTH_TWIPS));
    usedWidth += nextWidth;
    return nextWidth;
  });
}

function sumColumnWidths(columnWidths: readonly number[], startIndex: number, span: number) {
  return columnWidths
    .slice(startIndex, Math.min(columnWidths.length, startIndex + span))
    .reduce((sum, width) => sum + width, 0);
}

function createDocxTableBorders() {
  return {
    top: { style: BorderStyle.SINGLE, size: 4, color: DOCX_TABLE_BORDER_COLOR },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: DOCX_TABLE_BORDER_COLOR },
    left: { style: BorderStyle.SINGLE, size: 4, color: DOCX_TABLE_BORDER_COLOR },
    right: { style: BorderStyle.SINGLE, size: 4, color: DOCX_TABLE_BORDER_COLOR },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: DOCX_TABLE_BORDER_COLOR },
    insideVertical: { style: BorderStyle.SINGLE, size: 4, color: DOCX_TABLE_BORDER_COLOR }
  };
}

function createDocxTableCell(input: {
  cell: StoredBlock;
  columnIndex: number;
  columnWidths: readonly number[];
  isHeader: boolean;
}) {
  const props = getBlockProps(input.cell);
  const colSpan = Math.min(
    getTableCellSpan(input.cell, "colspan"),
    Math.max(1, input.columnWidths.length - input.columnIndex)
  );
  const rowSpan = getTableCellSpan(input.cell, "rowspan");
  const cellWidth = Math.max(1, sumColumnWidths(input.columnWidths, input.columnIndex, colSpan));
  const textColor =
    normalizeDocxHexColor(props.textColor, DOCX_TEXT_COLORS) ||
    (input.isHeader ? DOCX_TABLE_HEADER_TEXT : undefined);
  const backgroundColor =
    normalizeDocxHexColor(props.backgroundColor, DOCX_BACKGROUND_COLORS) ||
    (input.isHeader ? DOCX_TABLE_HEADER_FILL : undefined);
  const text = getInlineText(input.cell.content).trim();

  return new TableCell({
    width: { size: cellWidth, type: WidthType.DXA },
    columnSpan: colSpan > 1 ? colSpan : undefined,
    rowSpan: rowSpan > 1 ? rowSpan : undefined,
    verticalAlign: VerticalAlignTable.CENTER,
    margins: {
      top: DOCX_TABLE_CELL_MARGIN_TWIPS,
      bottom: DOCX_TABLE_CELL_MARGIN_TWIPS,
      left: DOCX_TABLE_CELL_MARGIN_TWIPS,
      right: DOCX_TABLE_CELL_MARGIN_TWIPS
    },
    shading: backgroundColor
      ? {
          type: ShadingType.CLEAR,
          fill: backgroundColor,
          color: "auto"
        }
      : undefined,
    children: [
      new Paragraph({
        alignment: getDocxAlignment(props.textAlignment),
        spacing: { before: 0, after: 0 },
        children: [
          new TextRun({
            text: text || " ",
            bold: input.isHeader,
            color: textColor
          })
        ]
      })
    ]
  });
}

function createDocxTableFromBlock(block: StoredBlock) {
  const tableContent = getTableContent(block.content);

  if (!tableContent) {
    return new Paragraph({
      spacing: { after: 90 },
      children: [new TextRun({ text: getInlineText(block.content).trim() || "Table" })]
    });
  }

  const columnCount = getTableColumnCount(tableContent);
  const columnWidths = getDocxTableColumnWidths(tableContent, columnCount);
  const headerRows = getPositiveInteger(tableContent.headerRows, 0);
  const headerCols = getPositiveInteger(tableContent.headerCols, 0);
  const rows = (tableContent.rows ?? []).map((row, rowIndex) => {
    let columnIndex = 0;
    const cells = (row.cells ?? []).map((cell, cellIndex) => {
      const nextCell = createDocxTableCell({
        cell,
        columnIndex,
        columnWidths,
        isHeader: rowIndex < headerRows || cellIndex < headerCols
      });
      columnIndex += getTableCellSpan(cell, "colspan");
      return nextCell;
    });

    while (columnIndex < columnCount) {
      cells.push(
        createDocxTableCell({
          cell: { type: "tableCell", content: [], props: {} } as StoredBlock,
          columnIndex,
          columnWidths,
          isHeader: rowIndex < headerRows || columnIndex < headerCols
        })
      );
      columnIndex += 1;
    }

    return new TableRow({ children: cells });
  });

  return new Table({
    width: { size: "100%", type: WidthType.PERCENTAGE },
    columnWidths,
    layout: TableLayoutType.FIXED,
    margins: {
      top: DOCX_TABLE_CELL_MARGIN_TWIPS,
      bottom: DOCX_TABLE_CELL_MARGIN_TWIPS,
      left: DOCX_TABLE_CELL_MARGIN_TWIPS,
      right: DOCX_TABLE_CELL_MARGIN_TWIPS
    },
    borders: createDocxTableBorders(),
    rows
  });
}

function getMediaBlockUrl(block: StoredBlock, props: Record<string, unknown>) {
  if (typeof props.url === "string") {
    return props.url;
  }

  const legacyUrl = (block as StoredBlock & { url?: unknown }).url;
  return typeof legacyUrl === "string" ? legacyUrl : "";
}

function getAssetIdFromUrl(url: string) {
  return url.startsWith("asset://") ? url.replace("asset://", "") : null;
}

function getImageDisplaySize(input: {
  naturalWidth: number;
  naturalHeight: number;
  previewWidth: unknown;
}) {
  const preferredWidth =
    typeof input.previewWidth === "number" && Number.isFinite(input.previewWidth)
      ? Math.max(96, Math.min(DOCX_MAX_IMAGE_WIDTH, Math.round(input.previewWidth)))
      : DOCX_MAX_IMAGE_WIDTH;
  const scale = Math.min(
    preferredWidth / input.naturalWidth,
    DOCX_MAX_IMAGE_HEIGHT / input.naturalHeight,
    1
  );

  return {
    width: Math.max(1, Math.round(input.naturalWidth * scale)),
    height: Math.max(1, Math.round(input.naturalHeight * scale))
  };
}

async function blobToPngImageData(input: {
  blob: Blob;
  previewWidth: unknown;
}) {
  const objectUrl = URL.createObjectURL(input.blob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();

      nextImage.addEventListener("load", () => resolve(nextImage), { once: true });
      nextImage.addEventListener("error", () => reject(new Error("DOCX_IMAGE_LOAD_FAILED")), { once: true });
      nextImage.src = objectUrl;
    });
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;

    if (!naturalWidth || !naturalHeight) {
      throw new Error("DOCX_IMAGE_EMPTY_DIMENSIONS");
    }

    const { width, height } = getImageDisplaySize({
      naturalWidth,
      naturalHeight,
      previewWidth: input.previewWidth
    });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("DOCX_IMAGE_CANVAS_FAILED");
    }

    canvas.width = width;
    canvas.height = height;
    context.drawImage(image, 0, 0, width, height);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error("DOCX_IMAGE_ENCODE_FAILED"));
      }, "image/png");
    });

    return {
      data: await pngBlob.arrayBuffer(),
      width,
      height
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

type DocxImageCacheEntry = Awaited<ReturnType<typeof blobToPngImageData>> | null;
type DocxRenderContext = {
  assetsById: Map<string, NoteDocxAsset>;
  imageCache: Map<string, Promise<DocxImageCacheEntry>>;
};

function getStableStringHash(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash).toString(36);
}

function getImageMimeTypeFromDataUrl(url: string) {
  const match = /^data:([^;,]+)[;,]/i.exec(url);
  return match?.[1] ?? "";
}

function isInlineImageUrl(url: string) {
  if (url.startsWith("data:")) {
    return getImageMimeTypeFromDataUrl(url).startsWith("image/");
  }

  return url.startsWith("blob:");
}

async function imageUrlToBlob(url: string) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("DOCX_INLINE_IMAGE_FETCH_FAILED");
  }

  return response.blob();
}

function getCachedDocxImageFromBlob(input: {
  cacheKey: string;
  blob: Blob;
  previewWidth: unknown;
  context: DocxRenderContext;
}) {
  const cacheKey = `${input.cacheKey}:${String(input.previewWidth ?? "")}`;
  const cached = input.context.imageCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const next = blobToPngImageData({
    blob: input.blob,
    previewWidth: input.previewWidth
  }).catch(() => null);

  input.context.imageCache.set(cacheKey, next);
  return next;
}

function getCachedDocxAssetImage(input: {
  asset: NoteDocxAsset;
  previewWidth: unknown;
  context: DocxRenderContext;
}) {
  return getCachedDocxImageFromBlob({
    cacheKey: `asset:${input.asset.id}`,
    blob: input.asset.blob,
    previewWidth: input.previewWidth,
    context: input.context
  });
}

async function getCachedInlineDocxImage(input: {
  url: string;
  previewWidth: unknown;
  context: DocxRenderContext;
}) {
  const cacheKey = `inline:${getStableStringHash(input.url)}`;
  const cached = input.context.imageCache.get(`${cacheKey}:${String(input.previewWidth ?? "")}`);

  if (cached) {
    return cached;
  }

  const next = imageUrlToBlob(input.url)
    .then((blob) =>
      blobToPngImageData({
        blob,
        previewWidth: input.previewWidth
      })
    )
    .catch(() => null);

  input.context.imageCache.set(`${cacheKey}:${String(input.previewWidth ?? "")}`, next);
  return next;
}

async function blockToDocxParagraphs(
  block: StoredBlock,
  depth = 0,
  context: DocxRenderContext
): Promise<Array<Paragraph | Table>> {
  const type = block.type ?? "paragraph";
  const props = getBlockProps(block);
  const text = getInlineText(block.content).trim();
  const children = (
    await Promise.all((block.children ?? []).map((child) => blockToDocxParagraphs(child, depth + 1, context)))
  ).flat();
  const baseRun = new TextRun({
    text: text || " ",
    bold: type === "heading"
  });

  if (type === "heading") {
    const levelValue = props.level;
    const level = typeof levelValue === "number" ? Math.max(1, Math.min(6, Math.round(levelValue))) : 2;
    const heading =
      level === 1
        ? HeadingLevel.HEADING_1
        : level === 2
          ? HeadingLevel.HEADING_2
          : level === 3
            ? HeadingLevel.HEADING_3
            : HeadingLevel.HEADING_4;

    return [
      new Paragraph({
        heading,
        spacing: { before: 180, after: 100 },
        children: [baseRun]
      }),
      ...children
    ];
  }

  if (type === "quote") {
    return [
      new Paragraph({
        indent: { left: 420 },
        border: {
          left: {
            color: "D7A84F",
            space: 8,
            style: BorderStyle.SINGLE,
            size: 12
          }
        },
        spacing: { before: 100, after: 100 },
        children: [new TextRun({ text: text || " ", italics: true })]
      }),
      ...children
    ];
  }

  if (type === "codeBlock") {
    return [
      new Paragraph({
        spacing: { before: 100, after: 100 },
        children: [
          new TextRun({
            text: text || " ",
            font: "IBM Plex Mono"
          })
        ]
      }),
      ...children
    ];
  }

  if (type === "divider") {
    return [
      new Paragraph({
        text: "────────",
        alignment: AlignmentType.CENTER,
        spacing: { before: 100, after: 100 }
      }),
      ...children
    ];
  }

  if (type === "bulletListItem" || type === "toggleListItem") {
    return [
      new Paragraph({
        text: `${"  ".repeat(depth)}• ${text}`,
        spacing: { after: 60 }
      }),
      ...children
    ];
  }

  if (type === "numberedListItem") {
    return [
      new Paragraph({
        text: `${"  ".repeat(depth)}1. ${text}`,
        spacing: { after: 60 }
      }),
      ...children
    ];
  }

  if (type === "checkListItem") {
    return [
      new Paragraph({
        text: `${props.checked === true ? "[x]" : "[ ]"} ${text}`,
        spacing: { after: 60 }
      }),
      ...children
    ];
  }

  if (type === "table") {
    return [
      createDocxTableFromBlock(block),
      ...children
    ];
  }

  if (type === "image" || type === "file" || type === "audio" || type === "video") {
    const name = typeof props.name === "string" ? props.name : type;
    const caption = typeof props.caption === "string" ? props.caption : "";
    const url = getMediaBlockUrl(block, props);
    const assetId = getAssetIdFromUrl(url);
    const asset = assetId ? context.assetsById.get(assetId) ?? null : null;

    if (type === "image" && (asset?.mimeType.startsWith("image/") || isInlineImageUrl(url))) {
      const imageData = asset
        ? await getCachedDocxAssetImage({
            asset,
            previewWidth: props.previewWidth,
            context
          })
        : await getCachedInlineDocxImage({
            url,
            previewWidth: props.previewWidth,
            context
          });

      if (imageData) {
        return [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 100, after: caption ? 40 : 110 },
            children: [
              new ImageRun({
                type: "png",
                data: imageData.data,
                transformation: {
                  width: imageData.width,
                  height: imageData.height
                },
                altText: {
                  name,
                  title: name,
                  description: caption || name
                }
              })
            ]
          }),
          ...(caption
            ? [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 110 },
                  children: [
                    new TextRun({
                      text: caption,
                      italics: true,
                      color: "6B7280"
                    })
                  ]
                })
              ]
            : []),
          ...children
        ];
      }
    }

    return [
      new Paragraph({
        spacing: { before: 80, after: 80 },
        children: [
          new TextRun({ text: name, bold: true }),
          ...(caption ? [new TextRun({ text: ` — ${caption}` })] : [])
        ]
      }),
      ...children
    ];
  }

  return [
    new Paragraph({
      spacing: { after: 90 },
      children: [new TextRun({ text: text || " " })]
    }),
    ...children
  ];
}

export function createNoteMarkdown(input: {
  note: Note;
  markdown?: string;
}) {
  return input.markdown?.trim() || blocksToMarkdown(input.note.content);
}

export function getNoteExportBaseName(note: Note, language: AppLanguage) {
  return sanitizeExportFileName(getDisplayNoteTitle(note, language), "Locoris Note");
}

export async function createNoteHtmlBlob(input: {
  note: Note;
  language: AppLanguage;
  markdown?: string;
}) {
  return textBlob(
    buildNoteHtmlDocument({
      note: input.note,
      language: input.language,
      markdown: input.markdown,
      additionalCss: await getSelfContainedReadableExportFontCss()
    }),
    "text/html;charset=utf-8"
  );
}

export async function createNoteDocxBlob(input: {
  note: Note;
  language: AppLanguage;
  markdown?: string;
  assets?: NoteDocxAsset[];
}) {
  const title = getDisplayNoteTitle(input.note, input.language);
  const context: DocxRenderContext = {
    assetsById: new Map((input.assets ?? []).map((asset) => [asset.id, asset])),
    imageCache: new Map()
  };
  const contentChildren = (
    await Promise.all(input.note.content.map((block) => blockToDocxParagraphs(block, 0, context)))
  ).flat();
  const children = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 240 },
      children: [new TextRun({ text: title, bold: true })]
    }),
    ...contentChildren
  ];
  const document = new DocxDocument({
    creator: "Locoris",
    description: "Exported from Locoris",
    title,
    sections: [
      {
        properties: {},
        children
      }
    ]
  });

  return Packer.toBlob(document);
}

async function waitForPdfRenderDocument(documentRef: globalThis.Document) {
  const fontSet = documentRef.fonts;

  if (fontSet) {
    try {
      await fontSet.ready;
    } catch {
      // The browser can still render with fallback fonts if a webfont is unavailable.
    }
  }

  const images = Array.from(documentRef.images);
  await Promise.all(
    images.map((image) => {
      if (image.complete) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      });
    })
  );
}

function getPdfBlockBoxes(sourceElement: HTMLElement) {
  const sourceRect = sourceElement.getBoundingClientRect();

  return Array.from(sourceElement.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement)
    .map((child) => {
      const rect = child.getBoundingClientRect();
      const styles = child.ownerDocument.defaultView?.getComputedStyle(child);
      const marginBottom = styles ? Number.parseFloat(styles.marginBottom) || 0 : 0;

      return {
        tagName: child.tagName.toLowerCase(),
        top: Math.max(0, rect.top - sourceRect.top),
        bottom: Math.max(0, rect.bottom - sourceRect.top + marginBottom)
      };
    })
    .filter((box) => box.bottom > box.top + 1)
    .sort((a, b) => a.top - b.top);
}

function isPdfHeadingBox(box: { tagName: string }) {
  return /^h[1-6]$/.test(box.tagName);
}

function getPdfPageSlices(input: {
  sourceElement: HTMLElement;
  canvas: HTMLCanvasElement;
  sourcePageHeightCss: number;
}) {
  const sourceRect = input.sourceElement.getBoundingClientRect();
  const canvasScale = input.canvas.width / Math.max(1, sourceRect.width);
  const totalHeightCss = input.canvas.height / Math.max(1, canvasScale);
  const blockBoxes = getPdfBlockBoxes(input.sourceElement);
  const slices: Array<{ start: number; end: number }> = [];
  const minPageProgress = Math.min(180, input.sourcePageHeightCss * 0.38);
  const pageSafetyGap = 8;
  let pageStart = 0;

  while (pageStart < totalHeightCss - 1) {
    const hardEnd = Math.min(totalHeightCss, pageStart + input.sourcePageHeightCss);

    if (totalHeightCss - pageStart <= input.sourcePageHeightCss + pageSafetyGap) {
      slices.push({ start: pageStart, end: totalHeightCss });
      break;
    }

    const candidates = blockBoxes.filter(
      (box) =>
        box.bottom > pageStart + minPageProgress &&
        box.bottom <= hardEnd - pageSafetyGap &&
        !isPdfHeadingBox(box)
    );
    const candidate = candidates.at(-1);
    let pageEnd = candidate?.bottom ?? hardEnd;

    if (candidate) {
      const nextBox = blockBoxes.find((box) => box.top >= candidate.bottom - 1);

      if (nextBox && isPdfHeadingBox(nextBox) && nextBox.top > pageStart + minPageProgress) {
        pageEnd = nextBox.top;
      }
    }

    if (pageEnd <= pageStart + 1) {
      pageEnd = hardEnd;
    }

    slices.push({ start: pageStart, end: pageEnd });
    pageStart = pageEnd;
  }

  return {
    canvasScale,
    slices
  };
}

function addCanvasToPdfPages(doc: JsPDFDocument, canvas: HTMLCanvasElement, sourceElement: HTMLElement) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 24;
  const targetWidth = pageWidth - margin * 2;
  const targetHeight = pageHeight - margin * 2;
  const sourceRect = sourceElement.getBoundingClientRect();
  const sourcePageHeightCss = (targetHeight * Math.max(1, sourceRect.width)) / targetWidth;
  const { canvasScale, slices } = getPdfPageSlices({
    sourceElement,
    canvas,
    sourcePageHeightCss
  });

  slices.forEach((slice, pageIndex) => {
    const sourceY = Math.max(0, Math.floor(slice.start * canvasScale));
    const nextY = Math.min(canvas.height, Math.ceil(slice.end * canvasScale));
    const sliceHeight = Math.max(1, nextY - sourceY);
    const pageCanvas = document.createElement("canvas");
    const pageContext = pageCanvas.getContext("2d");

    if (!pageContext) {
      throw new Error("NOTE_PDF_CANVAS_CONTEXT_FAILED");
    }

    pageCanvas.width = canvas.width;
    pageCanvas.height = sliceHeight;
    pageContext.fillStyle = "#ffffff";
    pageContext.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
    pageContext.drawImage(canvas, 0, sourceY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

    if (pageIndex !== 0) {
      doc.addPage();
    }

    const imageHeight = (sliceHeight * targetWidth) / canvas.width;
    doc.addImage(pageCanvas.toDataURL("image/png"), "PNG", margin, margin, targetWidth, imageHeight);
  });
}

export async function createNotePdfBlob(input: {
  note: Note;
  language: AppLanguage;
  markdown?: string;
}) {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([
    import("jspdf"),
    import("html2canvas")
  ]);
  const doc = new jsPDF({
    unit: "pt",
    format: "a4"
  });
  const iframe = document.createElement("iframe");

  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.width = "920px";
  iframe.style.height = "1400px";
  iframe.style.border = "0";
  iframe.style.pointerEvents = "none";

  document.body.appendChild(iframe);

  try {
    const iframeDocument = iframe.contentDocument;

    if (!iframeDocument) {
      throw new Error("NOTE_PDF_DOCUMENT_FAILED");
    }

    iframeDocument.open();
    iframeDocument.write(
      buildNoteHtmlDocument({
        note: input.note,
        language: input.language,
        markdown: input.markdown
      })
    );
    iframeDocument.close();

    await waitForPdfRenderDocument(iframeDocument);

    const sourceElement = iframeDocument.querySelector("main") as HTMLElement | null;

    if (!sourceElement) {
      throw new Error("NOTE_PDF_SOURCE_FAILED");
    }

    iframe.style.height = `${Math.max(1400, iframeDocument.documentElement.scrollHeight + 80)}px`;

    const canvas = await html2canvas(sourceElement, {
      backgroundColor: "#ffffff",
      scale: Math.min(window.devicePixelRatio || 2, 2),
      useCORS: true,
      logging: false,
      windowWidth: iframeDocument.documentElement.scrollWidth,
      windowHeight: iframeDocument.documentElement.scrollHeight
    });

    addCanvasToPdfPages(doc, canvas, sourceElement);
  } finally {
    iframe.remove();
  }

  return doc.output("blob");
}

export function getNoteExportMetadata(input: {
  note: Note;
  language: AppLanguage;
  markdown?: string;
}) {
  const markdown = createNoteMarkdown(input);
  const htmlBody = blocksToHtmlBody(input.note.content);

  return {
    markdown,
    htmlBody,
    plainText: blocksToPlainText(input.note.content)
  };
}
