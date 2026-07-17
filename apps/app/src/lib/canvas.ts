import type { CanvasContent, CanvasSceneAppState, CanvasSceneElement } from "../types";

export const DEFAULT_CANVAS_BACKGROUND = "#000000";
export const DEFAULT_CANVAS_STROKE_LIGHT = "#f8fafc";
export const DEFAULT_CANVAS_STROKE_DARK = "#1e1e1e";
export const DEFAULT_CANVAS_ELEMENT_BACKGROUND = "transparent";
export const DEFAULT_CANVAS_THEME = "light";
export const DEFAULT_CANVAS_FONT_FAMILY = 6;

function normalizeCanvasColorInput(color: unknown) {
  return typeof color === "string" ? color.trim().toLowerCase() : "";
}

function expandShortHexColor(hex: string) {
  return `#${hex
    .slice(1)
    .split("")
    .map((char) => `${char}${char}`)
    .join("")}`;
}

export function normalizeCanvasHexColor(color: string) {
  const normalized = normalizeCanvasColorInput(color);

  if (!normalized) {
    return null;
  }

  const prefixed = normalized.startsWith("#") ? normalized : `#${normalized}`;

  if (/^#[0-9a-f]{3}$/i.test(prefixed)) {
    return expandShortHexColor(prefixed);
  }

  if (/^#[0-9a-f]{6}$/i.test(prefixed)) {
    return prefixed;
  }

  return null;
}

function parseCanvasRgbChannel(channel: string) {
  const parsed = Number.parseFloat(channel.trim());

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(0, Math.min(255, parsed));
}

function parseCanvasRgbColor(color: string) {
  const match = color.match(/^rgba?\(([^)]+)\)$/i);

  if (!match) {
    return null;
  }

  const channels = match[1].split(",").slice(0, 3).map(parseCanvasRgbChannel);

  if (channels.some((value) => value === null)) {
    return null;
  }

  return channels as [number, number, number];
}

function parseCanvasColorToRgb(color: unknown) {
  const normalized = normalizeCanvasColorInput(color);

  if (!normalized) {
    return null;
  }

  const hex = normalizeCanvasHexColor(normalized);

  if (hex) {
    return [
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16)
    ] as [number, number, number];
  }

  return parseCanvasRgbColor(normalized);
}

function getCanvasRelativeLuminance(color: unknown) {
  const rgb = parseCanvasColorToRgb(color);

  if (!rgb) {
    return null;
  }

  const [red, green, blue] = rgb.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function getCanvasStrokeColorForBackground(background: unknown) {
  const luminance = getCanvasRelativeLuminance(background);

  if (luminance === null) {
    return DEFAULT_CANVAS_STROKE_LIGHT;
  }

  return luminance >= 0.54 ? DEFAULT_CANVAS_STROKE_DARK : DEFAULT_CANVAS_STROKE_LIGHT;
}

export function getCanvasRuntimeAppStateDefaults(background?: unknown): CanvasSceneAppState {
  const resolvedBackground =
    normalizeCanvasHexColor(typeof background === "string" ? background : "") ??
    (typeof background === "string" && background.trim().length > 0
      ? background.trim()
      : DEFAULT_CANVAS_BACKGROUND);

  return {
    theme: DEFAULT_CANVAS_THEME,
    viewBackgroundColor: resolvedBackground,
    currentItemStrokeColor: getCanvasStrokeColorForBackground(resolvedBackground),
    currentItemBackgroundColor: DEFAULT_CANVAS_ELEMENT_BACKGROUND,
    currentItemFontFamily: DEFAULT_CANVAS_FONT_FAMILY,
    exportBackground: true,
    exportWithDarkMode: false
  };
}

export function shouldMigrateLegacyCanvasStrokeColor(
  theme: unknown,
  currentStrokeColor: unknown,
  background: unknown
) {
  return (
    theme === "dark" &&
    shouldAutoAdaptCanvasStrokeColor(currentStrokeColor, background)
  );
}

export function shouldAutoAdaptCanvasStrokeColor(
  currentStrokeColor: unknown,
  previousBackground: unknown
) {
  const normalizedStroke =
    typeof currentStrokeColor === "string" ? currentStrokeColor.trim().toLowerCase() : "";

  if (!normalizedStroke) {
    return true;
  }

  const legacyDefault = DEFAULT_CANVAS_STROKE_DARK.toLowerCase();
  const previousAutomatic = getCanvasStrokeColorForBackground(previousBackground).toLowerCase();

  return normalizedStroke === legacyDefault || normalizedStroke === previousAutomatic;
}

export function createStarterCanvasContent(): CanvasContent {
  return {
    elements: [],
    appState: getCanvasRuntimeAppStateDefaults()
  };
}

export function hasMeaningfulCanvasContent(content: CanvasContent | null | undefined) {
  return (content?.elements ?? []).some((element) => !element.isDeleted);
}

export function normalizeCanvasElements(elements: readonly CanvasSceneElement[] | null | undefined) {
  if (!elements || elements.length === 0) {
    return [];
  }

  return elements.map((element) => ({
    ...element
  }));
}

export function pickCanvasAppState(appState: CanvasSceneAppState | null | undefined): CanvasSceneAppState | null {
  if (!appState) {
    return null;
  }

  const runtimeDefaults = getCanvasRuntimeAppStateDefaults(appState.viewBackgroundColor);
  const shouldMigrateLegacyStroke = shouldMigrateLegacyCanvasStrokeColor(
    appState.theme,
    appState.currentItemStrokeColor,
    runtimeDefaults.viewBackgroundColor
  );

  return {
    theme: DEFAULT_CANVAS_THEME,
    viewBackgroundColor:
      typeof appState.viewBackgroundColor === "string"
        ? appState.viewBackgroundColor
        : DEFAULT_CANVAS_BACKGROUND,
    gridSize:
      typeof appState.gridSize === "number" || appState.gridSize === null
        ? appState.gridSize
        : null,
    gridStep: typeof appState.gridStep === "number" ? appState.gridStep : undefined,
    scrollX: typeof appState.scrollX === "number" ? appState.scrollX : undefined,
    scrollY: typeof appState.scrollY === "number" ? appState.scrollY : undefined,
    zoom: appState.zoom && typeof appState.zoom === "object" ? { ...appState.zoom } : undefined,
    currentItemStrokeColor:
      typeof appState.currentItemStrokeColor === "string"
        ? shouldMigrateLegacyStroke
          ? runtimeDefaults.currentItemStrokeColor
          : appState.currentItemStrokeColor
        : runtimeDefaults.currentItemStrokeColor,
    currentItemBackgroundColor:
      typeof appState.currentItemBackgroundColor === "string"
        ? appState.currentItemBackgroundColor
        : runtimeDefaults.currentItemBackgroundColor,
    currentItemFontFamily:
      typeof appState.currentItemFontFamily === "number"
        ? appState.currentItemFontFamily
        : runtimeDefaults.currentItemFontFamily,
    exportBackground:
      typeof appState.exportBackground === "boolean"
        ? appState.exportBackground
        : runtimeDefaults.exportBackground,
    exportWithDarkMode: false
  };
}

export function normalizeCanvasContent(content: CanvasContent | null | undefined): CanvasContent {
  return {
    elements: normalizeCanvasElements(content?.elements),
    appState: pickCanvasAppState(content?.appState) ?? getCanvasRuntimeAppStateDefaults()
  };
}

export function extractCanvasPlainText(content: CanvasContent | null | undefined) {
  const normalized = normalizeCanvasContent(content);
  const activeElements = normalized.elements.filter((element) => !element.isDeleted);

  if (activeElements.length === 0) {
    return "";
  }

  return activeElements
    .map((element) => {
      const textValue = (element as unknown as { text?: unknown }).text;
      return typeof textValue === "string" ? textValue : "";
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildCanvasExcerpt(content: CanvasContent | null | undefined, maxLength = 180) {
  const plainText = extractCanvasPlainText(content);

  if (!plainText) {
    return "";
  }

  if (plainText.length <= maxLength) {
    return plainText;
  }

  return `${plainText.slice(0, maxLength).trim()}...`;
}

export function extractCanvasReferencedFileIds(content: CanvasContent | null | undefined) {
  const normalized = normalizeCanvasContent(content);
  const fileIds = new Set<string>();

  normalized.elements.forEach((element) => {
    if (element.isDeleted || typeof element.fileId !== "string" || element.fileId.length === 0) {
      return;
    }

    fileIds.add(element.fileId);
  });

  return [...fileIds];
}

export function remapCanvasFileIds(
  content: CanvasContent | null | undefined,
  fileIdMap: ReadonlyMap<string, string>
) {
  const normalized = normalizeCanvasContent(content);

  return {
    ...normalized,
    elements: normalized.elements.map((element) => {
      if (typeof element.fileId !== "string" || element.fileId.length === 0) {
        return {
          ...element
        };
      }

      return {
        ...element,
        fileId: fileIdMap.get(element.fileId) ?? element.fileId
      };
    })
  };
}

export function getCanvasMetrics(
  content: CanvasContent | null | undefined,
  options?: { includePlainText?: boolean }
) {
  const normalized = normalizeCanvasContent(content);
  let activeElementCount = 0;
  let imageCount = 0;
  let frameCount = 0;

  normalized.elements.forEach((element) => {
    if (element.isDeleted) {
      return;
    }

    activeElementCount += 1;

    if (element.type === "image") {
      imageCount += 1;
    }

    if (element.type === "frame" || element.type === "magicframe") {
      frameCount += 1;
    }
  });

  return {
    activeElementCount,
    imageCount,
    frameCount,
    plainText: options?.includePlainText === false ? "" : extractCanvasPlainText(normalized)
  };
}

export function getCanvasBackgroundColor(content: CanvasContent | null | undefined) {
  return normalizeCanvasContent(content).appState?.viewBackgroundColor ?? DEFAULT_CANVAS_BACKGROUND;
}
