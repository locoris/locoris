import { translateInline } from "../localization/translateInline";
import { getLocaleLanguageCode } from "../localization";
import {
  bumpVersion,
  CaptureUpdateAction,
  convertToExcalidrawElements,
  Excalidraw,
  MainMenu
} from "@excalidraw/excalidraw";
import type {
  AppState as ExcalidrawAppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  UIOptions
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import "@excalidraw/excalidraw/index.css";
import "./CanvasPane.css";
import "./CanvasPane.excalidraw.css";
import CanvasMobileChrome from "./CanvasMobileChrome";
import ConfirmDialog from "./ConfirmDialog";
import FolderPicker from "./FolderPicker";
import {
  usePrivateVaultWarning,
  type PrivateVaultWarningContext
} from "./PrivateVaultWarningDialog";
import TagInputField from "./TagInputField";
import {
  DEFAULT_CANVAS_BACKGROUND,
  DEFAULT_CANVAS_ELEMENT_BACKGROUND,
  DEFAULT_CANVAS_FONT_FAMILY,
  DEFAULT_CANVAS_THEME,
  getCanvasRuntimeAppStateDefaults,
  getCanvasStrokeColorForBackground,
  hasMeaningfulCanvasContent,
  normalizeCanvasHexColor,
  shouldMigrateLegacyCanvasStrokeColor,
  shouldAutoAdaptCanvasStrokeColor
} from "../lib/canvas";
import { getDisplayNoteTitle } from "../localization/displayNames";
import {
  persistExcalidrawLibrary,
  readPersistedExcalidrawLibrary
} from "../lib/excalidrawLibrary";
import { COLOR_PALETTE, DEFAULT_NOTE_COLOR } from "../lib/palette";
import { flattenFolderOptions, formatTimestamp } from "../lib/notes";
import { saveBlobFileWithDialog } from "../lib/nativeFileIntegration";
import {
  createCanvasJsonBlob,
  createCanvasPdfBlob,
  type CanvasExportFormat
} from "../lib/exportImport/canvasExport";
import { useAndroidBackHandler } from "../lib/useAndroidBackHandler";
import { sanitizeExportFileName } from "../lib/exportImport/filenames";
import {
  normalizePlannerContextTaskTitle,
  type PlannerContextTaskInput
} from "../lib/plannerLinks";
import {
  generateGeminiCanvasMermaid,
  generateGeminiCanvasSpec,
  readGeminiApiKey,
  readStoredGeminiCanvasGenerationMode,
  readStoredGeminiModel,
  type CanvasAiSourceKind,
  type GeminiCanvasDiagramKind
} from "../lib/aiIntegration";
import {
  buildCanvasAiSpecElements,
  getCanvasAiMermaidThemeVariables,
  getCanvasAiVisualPalette,
  normalizeCanvasAiBinaryFiles,
  styleCanvasAiElements
} from "../lib/canvasAiRenderer";
import type {
  AppLanguage,
  CanvasContent,
  Folder,
  Note,
  NoteContent,
  SaveState,
  StoredBlock,
  Tag
} from "../types";

interface CanvasPaneProps {
  note: Note;
  notes: Note[];
  folders: Folder[];
  tags: Tag[];
  language: AppLanguage;
  saveState: SaveState;
  onTitleChange: (title: string) => void;
  onFolderChange: (folderId: string | null) => void;
  onNoteColorChange: (color: string) => void;
  onTagIdsChange: (tagIds: string[]) => Promise<void> | void;
  onCreateTag: (name: string) => Promise<Tag>;
  onDelete: () => void;
  onRestore: () => void;
  onTogglePin: () => void;
  onContentChange: (
    content: CanvasContent,
    files: BinaryFiles,
    fileNames: Record<string, string>,
    state: SaveState
  ) => void;
  onLoadFiles: () => Promise<BinaryFiles>;
  onCreateCanvasFromAi?: (
    content: CanvasContent,
    files: BinaryFiles,
    fileNames: Record<string, string>,
    title?: string
  ) => Promise<void> | void;
  onCreateTaskFromContext?: (input: PlannerContextTaskInput) => Promise<unknown> | void;
  onClose?: () => void;
  libraryStorageScopeId: string;
  privateVaultWarningContext?: PrivateVaultWarningContext | null;
  immersive?: boolean;
}

type CanvasAiInsertMode = "insert" | "replaceSelection" | "newCanvas";
type CanvasAiStatus = "idle" | "generating" | "ready" | "applying" | "error";
type CanvasAiSourceMode = "description" | "selection" | "canvas" | "note";
type CanvasAiWorkflow = "create" | "improve" | "explain";
type CanvasAiCommandId =
  | GeminiCanvasDiagramKind
  | "semanticIslands"
  | "improveLayout"
  | "labelArrows"
  | "groupSelection"
  | "spreadNodes"
  | "explainCanvas"
  | "findProblems"
  | "findMissingLinks";
type CanvasAiPreviewMethod = "mermaid" | "canvas-json";
type CanvasTaskStatus = "created" | "error" | null;
type CanvasExportStatus = "pdf" | "json" | "error" | null;

type CanvasAiPreview = {
  kind: GeminiCanvasDiagramKind;
  method: CanvasAiPreviewMethod;
  title?: string;
  insertMode: CanvasAiInsertMode;
  sourceKind: CanvasAiSourceKind;
  sourceTitle?: string;
  prompt: string;
  sourceText: string;
  selectedElementIds: Record<string, true>;
  selectedCount: number;
  diagramCode: string;
  elements: ExcalidrawElement[];
  files: BinaryFiles;
  summary: string;
};

type CanvasAiInlineNotice = {
  key: string;
  message: string;
};

type CanvasAiCommandDefinition = {
  id: CanvasAiCommandId;
  workflow: CanvasAiWorkflow;
  kind: GeminiCanvasDiagramKind;
  labelKey: string;
  descriptionKey: string;
  instruction: string;
  preferredSourceMode: CanvasAiSourceMode;
  preferredInsertMode: CanvasAiInsertMode;
  allowedSourceModes?: readonly CanvasAiSourceMode[];
  allowedInsertModes?: readonly CanvasAiInsertMode[];
  requiresSelection?: boolean;
  hiddenByDefault?: boolean;
};

const EXCALIDRAW_UI_OPTIONS: Partial<UIOptions> = {
  canvasActions: {
    changeViewBackgroundColor: false,
    clearCanvas: false,
    export: false,
    loadScene: false,
    saveToActiveFile: false,
    saveAsImage: true,
    toggleTheme: false
  },
  welcomeScreen: false,
  tools: {
    image: true
  }
};

const CANVAS_BACKGROUND_PRESETS = [
  { id: "void", color: "#000000" },
  { id: "slate", color: "#111827" },
  { id: "blue", color: "#081423" },
  { id: "amber", color: "#1b1605" },
  { id: "bronze", color: "#1c1311" }
] as const;

const CANVAS_AI_WORKFLOWS: Array<{
  id: CanvasAiWorkflow;
  labelKey: string;
}> = [
  { id: "create", labelKey: "canvas.aiWorkflow.create" },
  { id: "improve", labelKey: "canvas.aiWorkflow.improve" },
  { id: "explain", labelKey: "canvas.aiWorkflow.explain" }
];

const CANVAS_AI_SOURCE_MODES: readonly CanvasAiSourceMode[] = [
  "description",
  "selection",
  "canvas",
  "note"
];

const CANVAS_AI_INSERT_MODES: readonly CanvasAiInsertMode[] = [
  "insert",
  "replaceSelection",
  "newCanvas"
];

const CONTEXT_SOURCE_MODES: readonly CanvasAiSourceMode[] = [
  "selection",
  "canvas",
  "note"
];

function getCanvasAiCommandSourceModes(command: CanvasAiCommandDefinition) {
  if (command.allowedSourceModes) {
    return command.allowedSourceModes;
  }

  return command.workflow === "create" ? CANVAS_AI_SOURCE_MODES : CONTEXT_SOURCE_MODES;
}

function getCanvasAiCommandInsertModes(command: CanvasAiCommandDefinition) {
  if (command.allowedInsertModes) {
    return command.allowedInsertModes;
  }

  return command.workflow === "explain"
    ? (["insert", "newCanvas"] as const)
    : CANVAS_AI_INSERT_MODES;
}

const CANVAS_AI_COMMANDS: CanvasAiCommandDefinition[] = [
  {
    id: "flowchart",
    workflow: "create",
    kind: "flowchart",
    labelKey: "canvas.aiFlowchart",
    descriptionKey: "canvas.aiFlowchartHint",
    instruction:
      "Create a rich Mermaid flowchart. Use subgraphs, varied node shapes, labeled arrows, decision diamonds, notes as side nodes, and preserve important details.",
    preferredSourceMode: "description",
    preferredInsertMode: "insert"
  },
  {
    id: "mindmap",
    workflow: "create",
    kind: "mindmap",
    labelKey: "canvas.aiMindmap",
    descriptionKey: "canvas.aiMindmapHint",
    instruction:
      "Create a visual mind map using Mermaid flowchart LR syntax: one central idea, branch subgraphs, leaf details, and cross-links where useful.",
    preferredSourceMode: "description",
    preferredInsertMode: "insert"
  },
  {
    id: "sequence",
    workflow: "create",
    kind: "sequence",
    labelKey: "canvas.aiSequence",
    descriptionKey: "canvas.aiSequenceHint",
    instruction:
      "Create a real interaction sequence with actors and 8-16 meaningful ordered messages. For creative dialogue, write actual dialogue/action beats, not generic placeholders like interaction.",
    preferredSourceMode: "description",
    preferredInsertMode: "insert"
  },
  {
    id: "roadmap",
    workflow: "create",
    kind: "roadmap",
    labelKey: "canvas.aiRoadmap",
    descriptionKey: "canvas.aiRoadmapHint",
    instruction:
      "Create a roadmap using Mermaid flowchart LR syntax: phase subgraphs, milestones, dependencies, risks, and next actions.",
    preferredSourceMode: "description",
    preferredInsertMode: "insert"
  },
  {
    id: "timeline",
    workflow: "create",
    kind: "timeline",
    labelKey: "canvas.aiTimeline",
    descriptionKey: "canvas.aiTimelineHint",
    instruction:
      "Create a timeline using Mermaid flowchart LR syntax: chronological chain, period subgraphs, date/event cards, causes, outcomes, and annotations.",
    preferredSourceMode: "description",
    preferredInsertMode: "insert",
    hiddenByDefault: true
  },
  {
    id: "concept",
    workflow: "create",
    kind: "concept",
    labelKey: "canvas.aiConcept",
    descriptionKey: "canvas.aiConceptHint",
    instruction:
      "Create a concept map using Mermaid flowchart LR syntax: semantic clusters as subgraphs, labeled relationship arrows, examples, caveats, and cross-links.",
    preferredSourceMode: "description",
    preferredInsertMode: "insert",
    hiddenByDefault: true
  },
  {
    id: "kanban",
    workflow: "create",
    kind: "kanban",
    labelKey: "canvas.aiKanban",
    descriptionKey: "canvas.aiKanbanHint",
    instruction:
      "Create a kanban-style board using Mermaid flowchart LR syntax: column subgraphs, task cards, blocked/risk markers, and flow arrows between columns.",
    preferredSourceMode: "description",
    preferredInsertMode: "insert",
    hiddenByDefault: true
  },
  {
    id: "pie",
    workflow: "create",
    kind: "pie",
    labelKey: "canvas.aiPieChart",
    descriptionKey: "canvas.aiPieChartHint",
    instruction:
      "Create a Mermaid pie chart. Use pie showData, a clear title, meaningful slice names, and numeric values. If a source is provided, infer the most useful distribution from it.",
    preferredSourceMode: "description",
    preferredInsertMode: "insert"
  },
  {
    id: "semanticIslands",
    workflow: "create",
    kind: "concept",
    labelKey: "canvas.aiSemanticIslands",
    descriptionKey: "canvas.aiSemanticIslandsHint",
    instruction:
      "Break the source into semantic islands using Mermaid flowchart LR syntax: each island must be a subgraph with inner nodes, annotations, and meaningful cross-island links.",
    preferredSourceMode: "note",
    preferredInsertMode: "insert",
    allowedSourceModes: CONTEXT_SOURCE_MODES
  },
  {
    id: "improveLayout",
    workflow: "improve",
    kind: "concept",
    labelKey: "canvas.aiImproveLayout",
    descriptionKey: "canvas.aiImproveLayoutHint",
    instruction:
      "Rebuild the selected/current diagram as a richer Mermaid concept map: better hierarchy, cleaner spacing, labeled relationships, subgraphs, and no lost meaning.",
    preferredSourceMode: "selection",
    preferredInsertMode: "replaceSelection",
    allowedSourceModes: ["selection", "canvas"]
  },
  {
    id: "labelArrows",
    workflow: "improve",
    kind: "flowchart",
    labelKey: "canvas.aiLabelArrows",
    descriptionKey: "canvas.aiLabelArrowsHint",
    instruction:
      "Rebuild the selected/current diagram in Mermaid and add short useful labels to arrows and transitions where they clarify meaning.",
    preferredSourceMode: "selection",
    preferredInsertMode: "replaceSelection",
    allowedSourceModes: ["selection", "canvas"]
  },
  {
    id: "groupSelection",
    workflow: "improve",
    kind: "concept",
    labelKey: "canvas.aiGroupSelection",
    descriptionKey: "canvas.aiGroupSelectionHint",
    instruction:
      "Group the selected/current content into meaningful Mermaid subgraphs. Keep inner details, cross-links, and explanatory nodes.",
    preferredSourceMode: "selection",
    preferredInsertMode: "replaceSelection",
    allowedSourceModes: ["selection", "canvas"]
  },
  {
    id: "spreadNodes",
    workflow: "improve",
    kind: "concept",
    labelKey: "canvas.aiSpreadNodes",
    descriptionKey: "canvas.aiSpreadNodesHint",
    instruction:
      "Rebuild the selected/current diagram with Mermaid subgraphs and a more airy reading order. Reduce overlaps by separating branches and using clear labels.",
    preferredSourceMode: "selection",
    preferredInsertMode: "replaceSelection",
    allowedSourceModes: ["selection", "canvas"]
  },
  {
    id: "explainCanvas",
    workflow: "explain",
    kind: "concept",
    labelKey: "canvas.aiExplainCanvas",
    descriptionKey: "canvas.aiExplainCanvasHint",
    instruction:
      "Create a Mermaid concept map that explains the selected/current canvas: main idea, important parts, relationships, and takeaways.",
    preferredSourceMode: "canvas",
    preferredInsertMode: "insert",
    allowedSourceModes: CONTEXT_SOURCE_MODES,
    allowedInsertModes: ["insert", "newCanvas"]
  },
  {
    id: "findProblems",
    workflow: "explain",
    kind: "kanban",
    labelKey: "canvas.aiFindProblems",
    descriptionKey: "canvas.aiFindProblemsHint",
    instruction:
      "Analyze the selected/current canvas and create a Mermaid issue map with subgraphs for risks, unclear parts, contradictions, and practical fixes.",
    preferredSourceMode: "canvas",
    preferredInsertMode: "insert",
    allowedSourceModes: CONTEXT_SOURCE_MODES,
    allowedInsertModes: ["insert", "newCanvas"]
  },
  {
    id: "findMissingLinks",
    workflow: "explain",
    kind: "concept",
    labelKey: "canvas.aiFindMissingLinks",
    descriptionKey: "canvas.aiFindMissingLinksHint",
    instruction:
      "Find missing relationships or weakly connected ideas and create a Mermaid concept map of suggested links and why they matter.",
    preferredSourceMode: "canvas",
    preferredInsertMode: "insert",
    allowedSourceModes: CONTEXT_SOURCE_MODES,
    allowedInsertModes: ["insert", "newCanvas"]
  }
];

const ELEMENT_STROKE_TOP_PICK_OVERRIDES = [
  ["#1e1e1e", "#ffffff"],
  ["#e03131", "#000000"],
  ["#2f9e44", "#8f5662"],
  ["#1971c2", "#4d735f"],
  ["#f08c00", "#4e6f8f"]
] as const;

const ELEMENT_BACKGROUND_TOP_PICK_OVERRIDES = [
  ["#ffc9c9", "#181116"],
  ["#b2f2bb", "#102019"]
] as const;

const ELEMENT_STROKE_TOP_PICK_OVERRIDE_MAP = new Map<string, string>(ELEMENT_STROKE_TOP_PICK_OVERRIDES);
const ELEMENT_BACKGROUND_TOP_PICK_OVERRIDE_MAP = new Map<string, string>(
  ELEMENT_BACKGROUND_TOP_PICK_OVERRIDES
);

function normalizeCanvasUiColorValue(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function resolveCanvasTopPickOverride(value: string) {
  const normalized = normalizeCanvasUiColorValue(value);

  if (ELEMENT_STROKE_TOP_PICK_OVERRIDE_MAP.has(normalized)) {
    return {
      kind: "stroke" as const,
      replacement: ELEMENT_STROKE_TOP_PICK_OVERRIDE_MAP.get(normalized)!
    };
  }

  if (ELEMENT_BACKGROUND_TOP_PICK_OVERRIDE_MAP.has(normalized)) {
    return {
      kind: "background" as const,
      replacement: ELEMENT_BACKGROUND_TOP_PICK_OVERRIDE_MAP.get(normalized)!
    };
  }

  return null;
}

function markCanvasElementUpdated<T extends ExcalidrawElement>(element: T) {
  const nextElement = { ...element } as T;
  bumpVersion(nextElement);
  return nextElement;
}

function getCanvasDocumentBaseName(note: Note, language: AppLanguage) {
  const safeTitle = getDisplayNoteTitle(note, language)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  return safeTitle || "canvas";
}

const DEFAULT_CANVAS_BACKGROUND_ALIASES = new Set([
  "black",
  "#000",
  "#000000",
  "rgb(0,0,0)",
  "rgb(0, 0, 0)"
]);

function normalizeCanvasColorKey(color: unknown) {
  return typeof color === "string" ? color.trim().toLowerCase() : "";
}

function isMissingOrDefaultCanvasBackground(background: unknown) {
  const normalized = normalizeCanvasColorKey(background);

  if (normalized.length === 0) {
    return true;
  }

  return DEFAULT_CANVAS_BACKGROUND_ALIASES.has(normalized);
}

function shouldUseDefaultCanvasBackground(content: CanvasContent | null | undefined) {
  return !hasMeaningfulCanvasContent(content) && isMissingOrDefaultCanvasBackground(content?.appState?.viewBackgroundColor);
}

function getInitialCanvasAppState(content: CanvasContent | null | undefined) {
  const storedAppState = content?.appState ?? {};
  const resolvedBackground = shouldUseDefaultCanvasBackground(content)
    ? DEFAULT_CANVAS_BACKGROUND
    : storedAppState.viewBackgroundColor;
  const runtimeDefaults = getCanvasRuntimeAppStateDefaults(resolvedBackground);
  const shouldMigrateLegacyStroke = shouldMigrateLegacyCanvasStrokeColor(
    storedAppState.theme,
    storedAppState.currentItemStrokeColor,
    runtimeDefaults.viewBackgroundColor
  );

  return {
    ...runtimeDefaults,
    ...storedAppState,
    theme: DEFAULT_CANVAS_THEME,
    viewBackgroundColor: runtimeDefaults.viewBackgroundColor,
    currentItemStrokeColor:
      typeof storedAppState.currentItemStrokeColor === "string"
        ? shouldMigrateLegacyStroke
          ? runtimeDefaults.currentItemStrokeColor
          : storedAppState.currentItemStrokeColor
        : runtimeDefaults.currentItemStrokeColor,
    currentItemBackgroundColor:
      typeof storedAppState.currentItemBackgroundColor === "string"
        ? storedAppState.currentItemBackgroundColor
        : runtimeDefaults.currentItemBackgroundColor,
    exportBackground: true,
    exportWithDarkMode: false
  } as unknown as Partial<ExcalidrawAppState>;
}

const CANVAS_AI_MAX_CONTEXT_CHARS = 30000;
const CANVAS_AI_MAX_NOTE_CONTEXT_CHARS = 30000;
function getCanvasTextFromElement(element: ExcalidrawElement) {
  if (element.isDeleted || element.type !== "text") {
    return "";
  }

  const textElement = element as ExcalidrawElement & {
    text?: string;
    originalText?: string;
  };

  return (textElement.originalText || textElement.text || "").trim();
}

function getCanvasAiSelectedIdSet(selectedElementIds?: Record<string, true>) {
  return new Set(
    Object.entries(selectedElementIds ?? {})
      .filter(([, selected]) => Boolean(selected))
      .map(([id]) => id)
  );
}

function toCanvasAiSelectedRecord(ids: Iterable<string>) {
  return Object.fromEntries(Array.from(ids).map((id) => [id, true])) as Record<string, true>;
}

function getCanvasAiOwnSelectionIds(
  elements: readonly ExcalidrawElement[],
  selectedElementIds?: Record<string, true>
) {
  const selectedIds = getCanvasAiSelectedIdSet(selectedElementIds);
  const resultIds = new Set(selectedIds);
  const elementById = new Map(elements.map((element) => [element.id, element]));

  selectedIds.forEach((id) => {
    const selectedElement = elementById.get(id) as
      | (ExcalidrawElement & {
          boundElements?: Array<{ id?: string | null }>;
        })
      | undefined;

    selectedElement?.boundElements?.forEach((boundElement) => {
      const relatedElement = boundElement.id ? elementById.get(boundElement.id) : null;

      if (relatedElement?.type === "text") {
        resultIds.add(relatedElement.id);
      }
    });
  });

  elements.forEach((element) => {
    const textElement = element as ExcalidrawElement & {
      containerId?: string | null;
    };

    if (element.type === "text" && textElement.containerId && selectedIds.has(textElement.containerId)) {
      resultIds.add(element.id);
    }
  });

  return resultIds;
}

function collectCanvasText(elements: readonly ExcalidrawElement[], selectedElementIds?: Record<string, true>) {
  const selectedIds = getCanvasAiSelectedIdSet(selectedElementIds);
  const hasSelection = selectedIds.size > 0;
  const lines = elements
    .filter((element) => !hasSelection || selectedIds.has(element.id))
    .map(getCanvasTextFromElement)
    .filter(Boolean);

  return Array.from(new Set(lines)).join("\n").slice(0, CANVAS_AI_MAX_CONTEXT_CHARS);
}

function collectBlockText(value: unknown, parts: string[]) {
  if (typeof value === "string") {
    parts.push(value);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectBlockText(entry, parts));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.text === "string") {
    parts.push(record.text);
  }
}

function getBlockPlainText(block: StoredBlock) {
  const parts: string[] = [];
  collectBlockText(block.content, parts);
  return parts.join("").replace(/\s+/g, " ").trim();
}

function noteContentToCanvasAiMarkdown(blocks: NoteContent) {
  const lines: string[] = [];

  const walk = (entries: StoredBlock[], depth = 0) => {
    entries.forEach((block) => {
      const text = getBlockPlainText(block);
      const indent = "  ".repeat(Math.min(depth, 4));
      const type = block.type ?? "paragraph";

      if (text) {
        if (type === "heading") {
          const level = typeof block.props?.level === "number" ? block.props.level : 2;
          lines.push(`${"#".repeat(Math.max(1, Math.min(4, level)))} ${text}`);
        } else if (type === "numberedListItem") {
          lines.push(`${indent}1. ${text}`);
        } else if (type === "bulletListItem") {
          lines.push(`${indent}- ${text}`);
        } else if (type === "checkListItem") {
          lines.push(`${indent}- [${block.props?.checked ? "x" : " "}] ${text}`);
        } else if (type === "quote") {
          lines.push(`${indent}> ${text}`);
        } else {
          lines.push(`${indent}${text}`);
        }
      }

      if (Array.isArray(block.children) && block.children.length > 0) {
        walk(block.children, depth + 1);
      }
    });
  };

  walk(blocks);
  return lines.join("\n").trim();
}

function limitCanvasAiSourceText(text: string, maxLength = 30000) {
  const trimmed = text.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength).trim()}\n...` : trimmed;
}

function clampCanvasAiNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getCanvasElementsBounds(elements: readonly ExcalidrawElement[]) {
  const visibleElements = elements.filter((element) => !element.isDeleted);

  if (visibleElements.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  const getElementBounds = (element: ExcalidrawElement) => {
    const x = Number.isFinite(element.x) ? element.x : 0;
    const y = Number.isFinite(element.y) ? element.y : 0;
    const width = Number.isFinite(element.width) ? element.width : 0;
    const height = Number.isFinite(element.height) ? element.height : 0;
    const baseBounds = {
      minX: Math.min(x, x + width),
      minY: Math.min(y, y + height),
      maxX: Math.max(x, x + width),
      maxY: Math.max(y, y + height)
    };

    if ((element.type !== "line" && element.type !== "arrow") || !Array.isArray(element.points)) {
      return baseBounds;
    }

    return element.points.reduce((bounds, point) => {
      if (!Array.isArray(point)) {
        return bounds;
      }

      const pointX = Number(point[0]);
      const pointY = Number(point[1]);

      if (!Number.isFinite(pointX) || !Number.isFinite(pointY)) {
        return bounds;
      }

      const absoluteX = x + pointX;
      const absoluteY = y + pointY;

      return {
        minX: Math.min(bounds.minX, absoluteX),
        minY: Math.min(bounds.minY, absoluteY),
        maxX: Math.max(bounds.maxX, absoluteX),
        maxY: Math.max(bounds.maxY, absoluteY)
      };
    }, baseBounds);
  };

  return visibleElements.reduce(
    (bounds, element) => {
      const elementBounds = getElementBounds(element);

      return {
        minX: Math.min(bounds.minX, elementBounds.minX),
        minY: Math.min(bounds.minY, elementBounds.minY),
        maxX: Math.max(bounds.maxX, elementBounds.maxX),
        maxY: Math.max(bounds.maxY, elementBounds.maxY),
        width: Math.max(bounds.maxX, elementBounds.maxX) - Math.min(bounds.minX, elementBounds.minX),
        height: Math.max(bounds.maxY, elementBounds.maxY) - Math.min(bounds.minY, elementBounds.minY)
      };
    },
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
      width: 0,
      height: 0
    }
  );
}

function getCanvasAiInsertionPoint(
  api: ExcalidrawImperativeAPI,
  generatedElements: readonly ExcalidrawElement[],
  insertMode: CanvasAiInsertMode,
  selectedElementIdsOverride?: Record<string, true>
) {
  const appState = api.getAppState();
  const selectedElementIds = selectedElementIdsOverride ?? appState.selectedElementIds ?? {};
  const selectedElements = api
    .getSceneElements()
    .filter((element) => Boolean(selectedElementIds[element.id]) && !element.isDeleted);
  const generatedBounds = getCanvasElementsBounds(generatedElements);

  if (selectedElements.length > 0) {
    const selectedBounds = getCanvasElementsBounds(selectedElements);

    return insertMode === "replaceSelection"
      ? {
          x: selectedBounds.minX,
          y: selectedBounds.minY
        }
      : {
          x: selectedBounds.maxX + 120,
          y: selectedBounds.minY + Math.max(0, (selectedBounds.height - generatedBounds.height) / 2)
        };
  }

  const zoomValue =
    typeof appState.zoom?.value === "number" && Number.isFinite(appState.zoom.value)
      ? appState.zoom.value
      : 1;
  const viewportWidth = typeof appState.width === "number" ? appState.width : 1200;
  const viewportHeight = typeof appState.height === "number" ? appState.height : 800;
  const scrollX = typeof appState.scrollX === "number" ? appState.scrollX : 0;
  const scrollY = typeof appState.scrollY === "number" ? appState.scrollY : 0;

  return {
    x: viewportWidth / 2 / zoomValue - scrollX - generatedBounds.width / 2,
    y: viewportHeight / 2 / zoomValue - scrollY - generatedBounds.height / 2
  };
}

function moveCanvasAiElements(
  elements: readonly ExcalidrawElement[],
  insertionPoint: { x: number; y: number }
) {
  const bounds = getCanvasElementsBounds(elements);
  const dx = insertionPoint.x - bounds.minX;
  const dy = insertionPoint.y - bounds.minY;

  return elements.map((element) =>
    markCanvasElementUpdated({
      ...element,
      x: element.x + dx,
      y: element.y + dy
    } as ExcalidrawElement)
  ) as ExcalidrawElement[];
}

function BackgroundIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 2.25a4.75 4.75 0 1 0 0 9.5 4.75 4.75 0 0 0 0-9.5Zm0 1.5a3.25 3.25 0 0 1 0 6.5 3.25 3.25 0 0 1 0-6.5Z"
        fill="currentColor"
      />
      <path d="M8 0.75a.75.75 0 0 1 .75.75v1a.75.75 0 0 1-1.5 0v-1A.75.75 0 0 1 8 .75Z" fill="currentColor" />
      <path d="M8 12.5a.75.75 0 0 1 .75.75v1a.75.75 0 0 1-1.5 0v-1A.75.75 0 0 1 8 12.5Z" fill="currentColor" />
      <path d="M3.03 3.03a.75.75 0 0 1 1.06 0l.71.72a.75.75 0 0 1-1.06 1.06l-.71-.71a.75.75 0 0 1 0-1.07Z" fill="currentColor" />
      <path d="M11.2 11.2a.75.75 0 0 1 1.06 0l.71.71a.75.75 0 0 1-1.06 1.06l-.71-.71a.75.75 0 0 1 0-1.06Z" fill="currentColor" />
      <path d="M12.5 8a.75.75 0 0 1 .75-.75h1a.75.75 0 0 1 0 1.5h-1A.75.75 0 0 1 12.5 8Z" fill="currentColor" />
      <path d="M.75 8A.75.75 0 0 1 1.5 7.25h1a.75.75 0 0 1 0 1.5h-1A.75.75 0 0 1 .75 8Z" fill="currentColor" />
      <path d="M11.2 4.8a.75.75 0 0 1 0-1.06l.71-.72a.75.75 0 1 1 1.06 1.07l-.71.71a.75.75 0 0 1-1.06 0Z" fill="currentColor" />
      <path d="M3.74 11.2a.75.75 0 0 1 1.06 0 .75.75 0 0 1 0 1.06l-.71.71a.75.75 0 1 1-1.06-1.06l.71-.71Z" fill="currentColor" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M5.5 1.75A1.75 1.75 0 0 0 3.75 3.5v.25H2.5a.75.75 0 0 0 0 1.5h.39l.52 7.16A2 2 0 0 0 5.4 14.25h5.2a2 2 0 0 0 1.99-1.84l.52-7.16h.39a.75.75 0 0 0 0-1.5h-1.25V3.5A1.75 1.75 0 0 0 10.5 1.75h-5Zm5.25 2H5.25V3.5a.25.25 0 0 1 .25-.25h5a.25.25 0 0 1 .25.25v.25ZM5.3 5.25l.47 6.5h4.46l.47-6.5H5.3Z"
        fill="currentColor"
      />
    </svg>
  );
}

function CanvasAiIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M10.9 2.2c.18-.55.96-.55 1.14 0l.45 1.36a3.1 3.1 0 0 0 1.96 1.96l1.36.45c.55.18.55.96 0 1.14l-1.36.45a3.1 3.1 0 0 0-1.96 1.96l-.45 1.36c-.18.55-.96.55-1.14 0l-.45-1.36a3.1 3.1 0 0 0-1.96-1.96l-1.36-.45c-.55-.18-.55-.96 0-1.14l1.36-.45a3.1 3.1 0 0 0 1.96-1.96l.45-1.36Z"
        fill="currentColor"
      />
      <path
        d="M4.1 10.55c.14-.42.74-.42.88 0l.25.76c.18.55.61.98 1.16 1.16l.76.25c.42.14.42.74 0 .88l-.76.25c-.55.18-.98.61-1.16 1.16l-.25.76c-.14.42-.74.42-.88 0l-.25-.76a1.84 1.84 0 0 0-1.16-1.16l-.76-.25c-.42-.14-.42-.74 0-.88l.76-.25c.55-.18.98-.61 1.16-1.16l.25-.76Z"
        fill="currentColor"
        opacity="0.72"
      />
    </svg>
  );
}

function CanvasAiRunIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4.1 10h10.15M10.6 5.85 14.75 10l-4.15 4.15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CanvasAiCloseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="m5.75 5.75 8.5 8.5m0-8.5-8.5 8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M10 3.8v8.1m0 0 3.2-3.2M10 11.9 6.8 8.7M4.5 14.2v1.5h11v-1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface CanvasBackgroundMenuSectionProps {
  label: string;
  customLabel: string;
  value: string;
  hexValue: string;
  presets: typeof CANVAS_BACKGROUND_PRESETS;
  onSelectPreset: (color: string) => void;
  onColorInput: (color: string) => void;
  onHexInput: (value: string) => void;
}

function CanvasBackgroundMenuSection({
  label,
  customLabel,
  value,
  hexValue,
  presets,
  onSelectPreset,
  onColorInput,
  onHexInput
}: CanvasBackgroundMenuSectionProps) {
  const normalizedValue = normalizeCanvasColorKey(value);
  const colorInputValue = normalizeCanvasHexColor(value) ?? DEFAULT_CANVAS_BACKGROUND;

  return (
    <section className="canvas-mainmenu-section">
      <div className="canvas-mainmenu-label">
        <span className="canvas-mainmenu-icon">
          <BackgroundIcon />
        </span>
        <span>{label}</span>
      </div>

      <div className="canvas-mainmenu-swatches">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`canvas-mainmenu-swatch ${normalizedValue === preset.color ? "is-active" : ""}`}
            style={{ "--canvas-menu-swatch": preset.color } as CSSProperties}
            aria-label={`${label}: ${preset.color.toUpperCase()}`}
            title={preset.color.toUpperCase()}
            onClick={() => onSelectPreset(preset.color)}
          >
            <span className="canvas-mainmenu-swatch-fill" />
          </button>
        ))}
      </div>

      <div className="canvas-mainmenu-custom">
        <span className="canvas-mainmenu-custom-label">{customLabel}</span>
        <div className="canvas-mainmenu-custom-controls">
          <input
            type="color"
            className="canvas-mainmenu-color-input"
            value={colorInputValue}
            aria-label={customLabel}
            onChange={(event) => onColorInput(event.target.value)}
          />
          <input
            type="text"
            inputMode="text"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="canvas-mainmenu-hex-input"
            value={hexValue}
            aria-label={`${label} HEX`}
            onChange={(event) => onHexInput(event.target.value)}
          />
        </div>
      </div>
    </section>
  );
}

interface CanvasMenuActionProps {
  label: string;
  onSelect: () => void;
  icon?: "trash" | "export";
  tone?: "default" | "danger";
}

function CanvasMenuAction({ label, onSelect, icon = "trash", tone = "danger" }: CanvasMenuActionProps) {
  return (
    <button type="button" className="canvas-mainmenu-action" onClick={onSelect}>
      <span className={`canvas-mainmenu-icon ${tone === "danger" ? "is-danger" : ""}`}>
        {icon === "export" ? <ExportIcon /> : <TrashIcon />}
      </span>
      <span>{label}</span>
    </button>
  );
}

export default function CanvasPane({
  note,
  notes,
  folders,
  tags,
  language,
  saveState,
  onTitleChange,
  onFolderChange,
  onNoteColorChange,
  onTagIdsChange,
  onCreateTag,
  onDelete,
  onRestore,
  onTogglePin,
  onContentChange,
  onLoadFiles,
  onCreateCanvasFromAi,
  onCreateTaskFromContext,
  onClose = () => undefined,
  libraryStorageScopeId,
  privateVaultWarningContext = null,
  immersive = false
}: CanvasPaneProps) {
  const { t } = useTranslation();
  const [titleDraft, setTitleDraft] = useState(note.title);
  const [activeSurface, setActiveSurface] = useState<"canvas" | "info">("canvas");
  const [currentCanvasBackground, setCurrentCanvasBackground] = useState(
    getInitialCanvasAppState(note.canvasContent).viewBackgroundColor ?? DEFAULT_CANVAS_BACKGROUND
  );
  const [backgroundHexDraft, setBackgroundHexDraft] = useState(
    (getInitialCanvasAppState(note.canvasContent).viewBackgroundColor ?? DEFAULT_CANVAS_BACKGROUND).toUpperCase()
  );
  const [isClearCanvasDialogOpen, setIsClearCanvasDialogOpen] = useState(false);
  const [isCanvasAiOpen, setIsCanvasAiOpen] = useState(false);
  const [canvasAiPopoverStyle, setCanvasAiPopoverStyle] = useState<CSSProperties>({});
  const [canvasAiWorkflow, setCanvasAiWorkflow] = useState<CanvasAiWorkflow>("create");
  const [canvasAiCommandId, setCanvasAiCommandId] = useState<CanvasAiCommandId>("flowchart");
  const [canvasAiShowMoreCommands, setCanvasAiShowMoreCommands] = useState(false);
  const [canvasAiInsertMode, setCanvasAiInsertMode] = useState<CanvasAiInsertMode>("insert");
  const [canvasAiSourceMode, setCanvasAiSourceMode] = useState<CanvasAiSourceMode>("description");
  const [canvasAiSourceNoteId, setCanvasAiSourceNoteId] = useState<string>("");
  const [canvasAiNoteSearch, setCanvasAiNoteSearch] = useState("");
  const [canvasAiPrompt, setCanvasAiPrompt] = useState("");
  const [canvasAiStatus, setCanvasAiStatus] = useState<CanvasAiStatus>("idle");
  const [canvasAiMessage, setCanvasAiMessage] = useState("");
  const [canvasAiNotice, setCanvasAiNotice] = useState<CanvasAiInlineNotice | null>(null);
  const [canvasAiPreview, setCanvasAiPreview] = useState<CanvasAiPreview | null>(null);
  const [canvasTaskStatus, setCanvasTaskStatus] = useState<CanvasTaskStatus>(null);
  const [canvasExportStatus, setCanvasExportStatus] = useState<CanvasExportStatus>(null);
  const [canvasSelectionCount, setCanvasSelectionCount] = useState(0);
  const [isNativeCanvasMenuOpen, setIsNativeCanvasMenuOpen] = useState(false);
  const canvasStageShellRef = useRef<HTMLDivElement | null>(null);
  const canvasAiShellRef = useRef<HTMLDivElement | null>(null);
  const canvasAiMobileShellRef = useRef<HTMLDivElement | null>(null);
  const titleTimeoutRef = useRef<number | null>(null);
  const contentTimeoutRef = useRef<number | null>(null);
  const canvasAiNoticeTimeoutRef = useRef<number | null>(null);
  const canvasTaskStatusTimeoutRef = useRef<number | null>(null);
  const canvasExportStatusTimeoutRef = useRef<number | null>(null);
  const canvasAiRequestIdRef = useRef(0);
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const latestSceneRef = useRef<CanvasContent>(note.canvasContent ?? { elements: [], appState: null });
  const latestFilesRef = useRef<BinaryFiles>({});
  const latestFileNamesRef = useRef<Record<string, string>>({});
  const latestTitleDraftRef = useRef(titleDraft);
  const latestStoredTitleRef = useRef(note.title);
  const latestOnContentChangeRef = useRef(onContentChange);
  const latestOnTitleChangeRef = useRef(onTitleChange);
  const generatedFileNamesRef = useRef<Record<string, string>>({});
  const folderOptions = useMemo(
    () => flattenFolderOptions(folders.filter((folder) => folder.projectId === note.projectId)),
    [folders, note.projectId]
  );
  const canvasAiSourceNotes = useMemo(
    () =>
      notes
        .filter((sourceNote) => sourceNote.contentType === "note" && !sourceNote.trashedAt)
        .sort((left, right) => {
          const projectPriority = Number(right.projectId === note.projectId) - Number(left.projectId === note.projectId);

          if (projectPriority !== 0) {
            return projectPriority;
          }

          return right.updatedAt - left.updatedAt;
        }),
    [note.projectId, notes]
  );
  const filteredCanvasAiSourceNotes = useMemo(() => {
    const query = canvasAiNoteSearch.trim().toLowerCase();

    if (!query) {
      return canvasAiSourceNotes.slice(0, 8);
    }

    return canvasAiSourceNotes
      .filter((sourceNote) => {
        const title = getDisplayNoteTitle(sourceNote, language).toLowerCase();
        const text = `${sourceNote.excerpt} ${sourceNote.plainText}`.toLowerCase();

        return title.includes(query) || text.includes(query);
      })
      .slice(0, 8);
  }, [canvasAiNoteSearch, canvasAiSourceNotes, language]);
  const { confirmPrivateVaultAction, privateVaultWarningDialog } =
    usePrivateVaultWarning(privateVaultWarningContext);
  const selectedCanvasAiSourceNote = useMemo(
    () => canvasAiSourceNotes.find((sourceNote) => sourceNote.id === canvasAiSourceNoteId) ?? null,
    [canvasAiSourceNoteId, canvasAiSourceNotes]
  );
  const activeCanvasAiCommand = useMemo(
    () =>
      CANVAS_AI_COMMANDS.find((command) => command.id === canvasAiCommandId) ??
      CANVAS_AI_COMMANDS[0],
    [canvasAiCommandId]
  );
  const activeCanvasAiSourceModes = useMemo(
    () => getCanvasAiCommandSourceModes(activeCanvasAiCommand),
    [activeCanvasAiCommand]
  );
  const activeCanvasAiInsertModes = useMemo(
    () => getCanvasAiCommandInsertModes(activeCanvasAiCommand),
    [activeCanvasAiCommand]
  );
  const visibleCanvasAiCommands = useMemo(() => {
    const workflowCommands = CANVAS_AI_COMMANDS.filter((command) => command.workflow === canvasAiWorkflow);

    return canvasAiShowMoreCommands
      ? workflowCommands
      : workflowCommands.filter((command) => !command.hiddenByDefault);
  }, [canvasAiShowMoreCommands, canvasAiWorkflow]);
  const hiddenCanvasAiCommandCount = useMemo(
    () =>
      CANVAS_AI_COMMANDS.filter(
        (command) => command.workflow === canvasAiWorkflow && command.hiddenByDefault
      ).length,
    [canvasAiWorkflow]
  );

  useEffect(() => {
    setTitleDraft(note.title);
  }, [note.id, note.title]);

  useEffect(() => {
    setActiveSurface("canvas");
    const initialCanvasBackground =
      getInitialCanvasAppState(note.canvasContent).viewBackgroundColor ?? DEFAULT_CANVAS_BACKGROUND;
    setCurrentCanvasBackground(initialCanvasBackground);
    setBackgroundHexDraft(initialCanvasBackground.toUpperCase());
    setIsClearCanvasDialogOpen(false);
    setIsCanvasAiOpen(false);
    setCanvasAiStatus("idle");
    setCanvasAiMessage("");
    setCanvasAiNotice(null);
    setCanvasAiPreview(null);
    setCanvasAiPrompt("");
    setCanvasAiWorkflow("create");
    setCanvasAiCommandId("flowchart");
    setCanvasAiShowMoreCommands(false);
    setCanvasAiSourceMode("description");
    setCanvasAiSourceNoteId("");
    setCanvasAiNoteSearch("");
    setCanvasSelectionCount(0);
    latestFilesRef.current = {};
    latestFileNamesRef.current = {};
    generatedFileNamesRef.current = {};
  }, [note.id]);

  useEffect(
    () => () => {
	      if (canvasAiNoticeTimeoutRef.current !== null) {
	        window.clearTimeout(canvasAiNoticeTimeoutRef.current);
	      }

	      if (canvasTaskStatusTimeoutRef.current !== null) {
	        window.clearTimeout(canvasTaskStatusTimeoutRef.current);
	      }

	      if (canvasExportStatusTimeoutRef.current !== null) {
        window.clearTimeout(canvasExportStatusTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    latestSceneRef.current = note.canvasContent ?? { elements: [], appState: null };
  }, [note.canvasContent]);

  useEffect(() => {
    latestTitleDraftRef.current = titleDraft;
  }, [titleDraft]);

  useEffect(() => {
    latestStoredTitleRef.current = note.title;
  }, [note.title]);

  useEffect(() => {
    latestOnContentChangeRef.current = onContentChange;
  }, [onContentChange]);

  useEffect(() => {
    latestOnTitleChangeRef.current = onTitleChange;
  }, [onTitleChange]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const root = document.documentElement;
    const previousAccent = root.style.getPropertyValue("--canvas-dialog-accent");
    root.style.setProperty("--canvas-dialog-accent", note.color || DEFAULT_NOTE_COLOR);

    return () => {
      if (previousAccent) {
        root.style.setProperty("--canvas-dialog-accent", previousAccent);
      } else {
        root.style.removeProperty("--canvas-dialog-accent");
      }
    };
  }, [note.color]);

  useEffect(() => {
    if (!isCanvasAiOpen || typeof document === "undefined") {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const shell = canvasAiShellRef.current;
      const mobileShell = canvasAiMobileShellRef.current;

      if (
        !(event.target instanceof Node) ||
        shell?.contains(event.target) ||
        mobileShell?.contains(event.target)
      ) {
        return;
      }

      setIsCanvasAiOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsCanvasAiOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCanvasAiOpen]);

  const persistedLibraryItems = useMemo(
    () => readPersistedExcalidrawLibrary(libraryStorageScopeId),
    [libraryStorageScopeId]
  );

  const applyCanvasQuickColor = (
    kind: "stroke" | "background",
    nextColor: string
  ) => {
    const api = excalidrawApiRef.current;

    if (!api) {
      return;
    }

    const normalizedColor = normalizeCanvasHexColor(nextColor) ?? nextColor;
    const appState = api.getAppState();
    const selectedElementIds = appState.selectedElementIds ?? {};
    const hasSelection = Object.keys(selectedElementIds).length > 0;
    const currentElements = api.getSceneElementsIncludingDeleted();
    let didChangeElement = false;
    const nextElements = hasSelection
      ? currentElements.map((element) => {
          if (!selectedElementIds[element.id] || element.isDeleted) {
            return element;
          }

          if (kind === "stroke" && !("strokeColor" in element)) {
            return element;
          }

          if (kind === "background" && !("backgroundColor" in element)) {
            return element;
          }

          const currentColor =
            kind === "stroke"
              ? normalizeCanvasUiColorValue((element as { strokeColor?: string }).strokeColor)
              : normalizeCanvasUiColorValue((element as { backgroundColor?: string }).backgroundColor);

          if (currentColor === normalizeCanvasUiColorValue(normalizedColor)) {
            return element;
          }

          const updatedElement =
            kind === "stroke"
              ? markCanvasElementUpdated({
                  ...element,
                  strokeColor: normalizedColor
                } as ExcalidrawElement)
              : markCanvasElementUpdated({
                  ...element,
                  backgroundColor: normalizedColor
                } as ExcalidrawElement);

          didChangeElement = true;
          return updatedElement;
        })
      : currentElements;

    api.updateScene({
      ...(didChangeElement ? { elements: nextElements } : {}),
      appState: {
        currentItemStrokeColor:
          kind === "stroke" ? normalizedColor : appState.currentItemStrokeColor,
        currentItemBackgroundColor:
          kind === "background" ? normalizedColor : appState.currentItemBackgroundColor
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY
    });
  };

  const syncCanvasUiChrome = () => {
    const stageShell = canvasStageShellRef.current;
    const canvasRoot = stageShell?.querySelector<HTMLElement>(".excalidraw");

    if (canvasRoot) {
      const colorPickers = canvasRoot.querySelectorAll<HTMLElement>(".color-picker-container");

      colorPickers.forEach((picker) => {
        const activeTrigger = picker.querySelector<HTMLElement>(".color-picker__button.active-color");
        const activeColor = normalizeCanvasUiColorValue(
          activeTrigger?.style.getPropertyValue("--swatch-color") ??
            activeTrigger?.getAttribute("title") ??
            ""
        );

        picker
          .querySelectorAll<HTMLButtonElement>(".color-picker__top-picks .color-picker__button")
          .forEach((button) => {
            const originalColor =
              button.dataset.canvasQuickPickOriginal ??
              button.getAttribute("title") ??
              button.dataset.testid ??
              "";
            const override = resolveCanvasTopPickOverride(originalColor);

            if (!override) {
              button.classList.remove("is-canvas-override-active");
              button.removeAttribute("data-canvas-quick-color");
              return;
            }

            button.dataset.canvasQuickPickOriginal = originalColor;
            button.dataset.canvasQuickColor = override.replacement;
            button.dataset.canvasQuickColorKind = override.kind;
            button.style.setProperty("--swatch-color", override.replacement);
            button.title = override.replacement.toUpperCase();
            button.setAttribute("aria-label", override.replacement.toUpperCase());
            button.classList.toggle(
              "is-canvas-override-active",
              activeColor === normalizeCanvasUiColorValue(override.replacement)
            );
          });
      });

      canvasRoot
        .querySelectorAll<HTMLElement>(".properties-content")
        .forEach((popover) => {
          popover.classList.toggle(
            "canvas-font-picker-popover",
            Boolean(popover.querySelector(".dropdown-menu.fonts"))
          );
        });

      canvasRoot.querySelectorAll<HTMLElement>(".dropdown-menu").forEach((menu) => {
        menu.classList.toggle(
          "canvas-mainmenu-dropdown",
          Boolean(menu.querySelector(".canvas-mainmenu-section"))
        );
      });

      const hasNativeCanvasMenu = Boolean(
        canvasRoot.querySelector(".dropdown-menu.canvas-mainmenu-dropdown")
      );
      setIsNativeCanvasMenuOpen((wasOpen) =>
        wasOpen === hasNativeCanvasMenu ? wasOpen : hasNativeCanvasMenu
      );
    } else {
      setIsNativeCanvasMenuOpen((wasOpen) => (wasOpen ? false : wasOpen));
    }

    document.querySelectorAll<HTMLElement>(".ImageExportModal").forEach((modal) => {
      modal.closest(".Dialog")?.classList.add("canvas-export-dialog");
      modal
        .querySelectorAll<HTMLElement>(".ImageExportModal__settings__setting")
        .forEach((setting) => {
          setting.classList.toggle(
            "canvas-export-setting-hidden",
            Boolean(setting.querySelector("#exportDarkModeSwitch"))
          );
        });
    });
  };

  const applyCanvasBackground = (nextColor: string) => {
    const api = excalidrawApiRef.current;
    const normalized = normalizeCanvasHexColor(nextColor);

    if (!api || !normalized) {
      return;
    }

    const appState = api.getAppState();
    const previousBackground =
      typeof appState.viewBackgroundColor === "string"
        ? appState.viewBackgroundColor
        : currentCanvasBackground;
    const nextStroke = getCanvasStrokeColorForBackground(normalized);
    const shouldAdaptStroke = shouldAutoAdaptCanvasStrokeColor(
      appState.currentItemStrokeColor,
      previousBackground
    );

    setCurrentCanvasBackground(normalized);
    setBackgroundHexDraft(normalized.toUpperCase());
    api.updateScene({
      appState: {
        theme: DEFAULT_CANVAS_THEME,
        viewBackgroundColor: normalized,
        currentItemStrokeColor: shouldAdaptStroke
          ? nextStroke
          : appState.currentItemStrokeColor,
        exportWithDarkMode: false
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY
    });
    window.requestAnimationFrame(syncCanvasUiChrome);
  };

  const handleBackgroundHexInput = (value: string) => {
    const draft = value.startsWith("#") ? value : `#${value}`;
    setBackgroundHexDraft(draft.toUpperCase());
    const normalized = normalizeCanvasHexColor(value);

    if (normalized) {
      applyCanvasBackground(normalized);
    }
  };

  const handleClearCanvasConfirm = () => {
    const api = excalidrawApiRef.current;

    if (!api) {
      setIsClearCanvasDialogOpen(false);
      return;
    }

    const appState = api.getAppState();
    const activeBackground =
      typeof appState.viewBackgroundColor === "string"
        ? appState.viewBackgroundColor
        : currentCanvasBackground;
    const normalizedBackground =
      normalizeCanvasHexColor(activeBackground) ?? DEFAULT_CANVAS_BACKGROUND;

    setIsClearCanvasDialogOpen(false);
    setCurrentCanvasBackground(normalizedBackground);
    setBackgroundHexDraft(normalizedBackground.toUpperCase());
    api.updateScene({
      elements: [],
      appState: ({
        theme: DEFAULT_CANVAS_THEME,
        viewBackgroundColor: normalizedBackground,
        currentItemStrokeColor: getCanvasStrokeColorForBackground(normalizedBackground),
        currentItemBackgroundColor: DEFAULT_CANVAS_ELEMENT_BACKGROUND,
        currentItemFontFamily:
          typeof appState.currentItemFontFamily === "number"
            ? appState.currentItemFontFamily
            : DEFAULT_CANVAS_FONT_FAMILY,
        exportBackground: true,
        exportWithDarkMode: false,
        selectedElementIds: {},
        hoveredElementIds: {},
        selectedGroupIds: {},
        editingTextElement: null,
        editingLinearElement: null,
        selectionElement: null,
        openPopup: null,
        openDialog: null,
        activeTool:
          appState.activeTool.type === "image"
            ? { ...appState.activeTool, type: "selection" }
            : appState.activeTool
      } as unknown as ExcalidrawAppState),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY
    });
    window.requestAnimationFrame(syncCanvasUiChrome);
  };

  const clearCanvasAiNotice = () => {
    if (canvasAiNoticeTimeoutRef.current !== null) {
      window.clearTimeout(canvasAiNoticeTimeoutRef.current);
      canvasAiNoticeTimeoutRef.current = null;
    }

    setCanvasAiNotice(null);
  };

  const showCanvasAiNotice = (key: string, message: string) => {
    if (canvasAiNoticeTimeoutRef.current !== null) {
      window.clearTimeout(canvasAiNoticeTimeoutRef.current);
    }

    setCanvasAiNotice({ key, message });
    canvasAiNoticeTimeoutRef.current = window.setTimeout(() => {
      canvasAiNoticeTimeoutRef.current = null;
      setCanvasAiNotice(null);
    }, 2200);
  };

  const getCanvasAiErrorMessage = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);

    if (/api key|unauthenticated|permission_denied|GEMINI_API_KEY_MISSING/i.test(message)) {
      return t("canvas.aiMissingKey");
    }

    if (/quota|resource_exhausted/i.test(message)) {
      return t("canvas.aiQuota");
    }

    if (/GEMINI_INPUT_EMPTY/i.test(message)) {
      return t("canvas.aiEmptyInput");
    }

    if (/CANVAS_AI_PROMPT_REQUIRED/i.test(message)) {
      return t("canvas.aiPromptRequired");
    }

    if (/CANVAS_AI_CONTEXT_REQUIRED/i.test(message)) {
      return t("canvas.aiContextRequired");
    }

    if (/CANVAS_AI_SELECTION_REQUIRED/i.test(message)) {
      return t("canvas.aiSelectionRequired");
    }

    if (/CANVAS_AI_CANVAS_CONTEXT_REQUIRED/i.test(message)) {
      return t("canvas.aiCanvasContextRequired");
    }

    if (/CANVAS_AI_NOTE_SOURCE_REQUIRED/i.test(message)) {
      return t("canvas.aiNoteSourceRequired");
    }

    if (/CANVAS_AI_NOTE_EMPTY/i.test(message)) {
      return t("canvas.aiNoteSourceEmpty");
    }

    if (/CANVAS_AI_NEW_CANVAS_UNAVAILABLE/i.test(message)) {
      return t("canvas.aiNewCanvasUnavailable");
    }

    if (/CANVAS_AI_REPLACE_SELECTION_REQUIRED/i.test(message)) {
      return t("canvas.aiReplaceNeedsSelection");
    }

    if (/CANVAS_AI_INSERT_MODE_UNAVAILABLE/i.test(message)) {
      return t("canvas.aiInsertModeUnavailable");
    }

    if (/mermaid|parse|syntax|diagram/i.test(message)) {
      return t("canvas.aiDiagramFailed");
    }

    return t("canvas.aiFailed");
  };

  const resetCanvasAiPreviewState = () => {
    canvasAiRequestIdRef.current += 1;
    setCanvasAiPreview(null);
    setCanvasAiStatus("idle");
    setCanvasAiMessage("");
    clearCanvasAiNotice();
  };

  const handleSelectCanvasAiCommand = (
    command: CanvasAiCommandDefinition,
    options: { collapseCommands?: boolean } = {}
  ) => {
    const sourceModes = getCanvasAiCommandSourceModes(command);
    const insertModes = getCanvasAiCommandInsertModes(command);
    const fallbackSourceMode =
      sourceModes.find((sourceMode) => sourceMode !== "selection" || canvasSelectionCount > 0) ??
      sourceModes[0] ??
      "description";
    const nextSourceMode =
      sourceModes.includes(canvasAiSourceMode) &&
      (canvasAiSourceMode !== "selection" || canvasSelectionCount > 0)
        ? canvasAiSourceMode
        : sourceModes.includes(command.preferredSourceMode) &&
            (command.preferredSourceMode !== "selection" || canvasSelectionCount > 0)
          ? command.preferredSourceMode
          : fallbackSourceMode;
    const nextInsertMode =
      insertModes.includes(canvasAiInsertMode) &&
      (canvasAiInsertMode !== "replaceSelection" || canvasSelectionCount > 0)
        ? canvasAiInsertMode
        : insertModes.includes(command.preferredInsertMode) &&
            (command.preferredInsertMode !== "replaceSelection" || canvasSelectionCount > 0)
          ? command.preferredInsertMode
          : insertModes[0] ?? "insert";

    setCanvasAiWorkflow(command.workflow);
    setCanvasAiCommandId(command.id);
    setCanvasAiSourceMode(nextSourceMode);
    setCanvasAiInsertMode(nextInsertMode);

    if (options.collapseCommands) {
      setCanvasAiShowMoreCommands(false);
    }

    resetCanvasAiPreviewState();
  };

  const buildCanvasAiRequestPrompt = (
    command: typeof CANVAS_AI_COMMANDS[number],
    userPrompt: string
  ) =>
    [
      `Canvas AI command: ${command.instruction}`,
      "Quality bar: create a visually useful, information-rich canvas result. Preserve important details, use meaningful relationships, and avoid tiny over-summarized diagrams.",
      userPrompt ? `User request: ${userPrompt}` : "No extra user request was provided."
    ].join("\n");

  const getCanvasAiValidationError = (context?: ReturnType<typeof getCanvasAiContext>) => {
    const prompt = canvasAiPrompt.trim();
    const allowedSourceModes = getCanvasAiCommandSourceModes(activeCanvasAiCommand);
    const allowedInsertModes = getCanvasAiCommandInsertModes(activeCanvasAiCommand);

    if (!allowedSourceModes.includes(canvasAiSourceMode)) {
      return new Error("CANVAS_AI_CONTEXT_REQUIRED");
    }

    if (!allowedInsertModes.includes(canvasAiInsertMode)) {
      return new Error("CANVAS_AI_INSERT_MODE_UNAVAILABLE");
    }

    if (canvasAiInsertMode === "replaceSelection" && canvasSelectionCount === 0) {
      return new Error("CANVAS_AI_REPLACE_SELECTION_REQUIRED");
    }

    if (activeCanvasAiCommand.requiresSelection && canvasSelectionCount === 0) {
      return new Error("CANVAS_AI_SELECTION_REQUIRED");
    }

    if (canvasAiSourceMode === "description") {
      if (activeCanvasAiCommand.workflow !== "create") {
        return new Error("CANVAS_AI_CONTEXT_REQUIRED");
      }

      if (!prompt) {
        return new Error("CANVAS_AI_PROMPT_REQUIRED");
      }
    }

    if (canvasAiSourceMode === "selection") {
      if (canvasSelectionCount === 0) {
        return new Error("CANVAS_AI_SELECTION_REQUIRED");
      }

      if (context && !context.selectedText.trim() && !prompt) {
        return new Error("CANVAS_AI_SELECTION_REQUIRED");
      }
    }

    if (canvasAiSourceMode === "canvas" && context && !context.canvasText.trim() && !prompt) {
      return new Error("CANVAS_AI_CANVAS_CONTEXT_REQUIRED");
    }

    if (canvasAiSourceMode === "note") {
      const sourceNote = selectedCanvasAiSourceNote ?? filteredCanvasAiSourceNotes[0] ?? null;

      if (!sourceNote) {
        return new Error("CANVAS_AI_NOTE_SOURCE_REQUIRED");
      }

      if (context) {
        const sourceText = noteContentToCanvasAiMarkdown(sourceNote.content) || sourceNote.plainText;

        if (!sourceText.trim() && !prompt) {
          return new Error("CANVAS_AI_NOTE_EMPTY");
        }
      }
    }

    return null;
  };

  const getCanvasAiContext = () => {
    const api = excalidrawApiRef.current;
    const elements = api?.getSceneElements() ?? ((latestSceneRef.current.elements ?? []) as unknown as ExcalidrawElement[]);
    const selectedElementIds = (api?.getAppState().selectedElementIds ?? {}) as Record<string, true>;
    const selectedIds = getCanvasAiSelectedIdSet(selectedElementIds);
    const ownSelectionIds = getCanvasAiOwnSelectionIds(elements, selectedElementIds);

    return {
      elements,
      selectedCount: selectedIds.size,
      textSelectedElementIds: toCanvasAiSelectedRecord(ownSelectionIds),
      replacementSelectedElementIds: toCanvasAiSelectedRecord(ownSelectionIds),
      canvasText: collectCanvasText(elements),
      selectedText:
        ownSelectionIds.size > 0
          ? collectCanvasText(elements, toCanvasAiSelectedRecord(ownSelectionIds))
          : ""
    };
  };

  const resolveCanvasAiRequestSource = (context: ReturnType<typeof getCanvasAiContext>) => {
    const prompt = canvasAiPrompt.trim();

    if (canvasAiSourceMode === "note") {
      const sourceNote = selectedCanvasAiSourceNote ?? filteredCanvasAiSourceNotes[0] ?? null;

      if (!sourceNote) {
        throw new Error("CANVAS_AI_NOTE_SOURCE_REQUIRED");
      }

      const sourceText = limitCanvasAiSourceText(
        noteContentToCanvasAiMarkdown(sourceNote.content) || sourceNote.plainText,
        CANVAS_AI_MAX_NOTE_CONTEXT_CHARS
      );

      if (!sourceText && !prompt) {
        throw new Error("CANVAS_AI_NOTE_EMPTY");
      }

      return {
        sourceKind: "note" as const,
        sourceTitle: getDisplayNoteTitle(sourceNote, language),
        selectedText: "",
        canvasText: sourceText,
        sourceText
      };
    }

    if (canvasAiSourceMode === "selection") {
      const sourceText = limitCanvasAiSourceText(context.selectedText);

      if (!sourceText && !prompt) {
        throw new Error("CANVAS_AI_SELECTION_REQUIRED");
      }

      return {
        sourceKind: "selection" as const,
        sourceTitle: "",
        selectedText: sourceText,
        canvasText: "",
        sourceText
      };
    }

    if (canvasAiSourceMode === "canvas") {
      const sourceText = limitCanvasAiSourceText(context.canvasText);

      if (!sourceText && !prompt) {
        throw new Error("CANVAS_AI_CANVAS_CONTEXT_REQUIRED");
      }

      return {
        sourceKind: "canvas" as const,
        sourceTitle: "",
        selectedText: "",
        canvasText: sourceText,
        sourceText
      };
    }

    if (!prompt) {
      throw new Error("CANVAS_AI_PROMPT_REQUIRED");
    }

    return {
      sourceKind: "description" as const,
      sourceTitle: "",
      selectedText: "",
      canvasText: "",
      sourceText: ""
    };
  };

  const handleGenerateCanvasAiPreview = async () => {
    const api = excalidrawApiRef.current;

    if (!api) {
      return;
    }

    if (!(await confirmPrivateVaultAction("ai"))) {
      return;
    }

    const context = getCanvasAiContext();
    const requestId = canvasAiRequestIdRef.current + 1;
    const requestCommand = activeCanvasAiCommand;
    const requestKind = requestCommand.kind;
    const requestInsertMode = canvasAiInsertMode;
    const requestPrompt = canvasAiPrompt.trim();
    const requestAiPrompt = buildCanvasAiRequestPrompt(requestCommand, requestPrompt);
    const requestSelectedElementIds =
      requestInsertMode === "replaceSelection"
        ? context.replacementSelectedElementIds
        : context.textSelectedElementIds;

    canvasAiRequestIdRef.current = requestId;
    setCanvasAiStatus("generating");
    setCanvasAiMessage("");
    clearCanvasAiNotice();
    setCanvasAiPreview(null);

    try {
      const validationError = getCanvasAiValidationError(context);

      if (validationError) {
        throw validationError;
      }

      const requestSource = resolveCanvasAiRequestSource(context);
      const requestSelectedText = requestSource.selectedText;
      const requestCanvasText = requestSource.canvasText;
      const apiKey = await readGeminiApiKey();
      const model = readStoredGeminiModel();
      const canvasGenerationMode = readStoredGeminiCanvasGenerationMode();
      const appState = api.getAppState();
      const activeCanvasBackground =
        normalizeCanvasHexColor(
          typeof appState.viewBackgroundColor === "string" ? appState.viewBackgroundColor : ""
        ) ??
        normalizeCanvasHexColor(currentCanvasBackground) ??
        DEFAULT_CANVAS_BACKGROUND;
      const canvasAiPalette = getCanvasAiVisualPalette(
        note.color || DEFAULT_NOTE_COLOR,
        activeCanvasBackground
      );
      const requestMode =
        requestInsertMode === "replaceSelection" && requestSelectedText
          ? "transformSelection"
          : "create";
      let previewMethod: CanvasAiPreviewMethod;
      let previewTitle: string | undefined;
      let diagramCode = "";
      let styledElements: ExcalidrawElement[] = [];
      let files: BinaryFiles = {};

      if (requestInsertMode === "newCanvas" && !onCreateCanvasFromAi) {
        throw new Error("CANVAS_AI_NEW_CANVAS_UNAVAILABLE");
      }

      if (canvasGenerationMode === "schema") {
        const spec = await generateGeminiCanvasSpec({
          apiKey,
          model,
          kind: requestKind,
          mode: requestMode,
          prompt: requestAiPrompt,
          appLanguage: language,
          canvasTitle: getDisplayNoteTitle(note, language),
          sourceKind: requestSource.sourceKind,
          sourceTitle: requestSource.sourceTitle,
          canvasBackgroundColor: activeCanvasBackground,
          canvasText: requestCanvasText,
          selectedText: requestSelectedText
        });

        previewMethod = "canvas-json";
        previewTitle = spec.title;
        diagramCode = JSON.stringify(spec, null, 2);
        styledElements = await buildCanvasAiSpecElements(
          spec,
          note.color || DEFAULT_NOTE_COLOR,
          activeCanvasBackground
        );
        files = {};
      } else {
        const mermaid = await generateGeminiCanvasMermaid({
          apiKey,
          model,
          kind: requestKind,
          mode: requestMode,
          prompt: requestAiPrompt,
          appLanguage: language,
          canvasTitle: getDisplayNoteTitle(note, language),
          sourceKind: requestSource.sourceKind,
          sourceTitle: requestSource.sourceTitle,
          canvasBackgroundColor: activeCanvasBackground,
          canvasText: requestCanvasText,
          selectedText: requestSelectedText
        });
        const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
        const mermaidConfig = {
          theme: "dark",
          flowchart: {
            curve: "linear"
          },
          themeVariables: getCanvasAiMermaidThemeVariables(canvasAiPalette),
          maxEdges: 500,
          maxTextSize: 300000
        } as unknown as Parameters<typeof parseMermaidToExcalidraw>[1];
        const result = await parseMermaidToExcalidraw(mermaid, mermaidConfig);
        const convertedElements = convertToExcalidrawElements(result.elements, {
          regenerateIds: true
        }) as unknown as ExcalidrawElement[];

        previewMethod = "mermaid";
        previewTitle = undefined;
        diagramCode = mermaid;
        styledElements = styleCanvasAiElements(
          convertedElements,
          note.color || DEFAULT_NOTE_COLOR,
          activeCanvasBackground
        );
        files = await normalizeCanvasAiBinaryFiles((result.files ?? {}) as BinaryFiles, styledElements);
      }

      const visibleCount = styledElements.filter((element) => !element.isDeleted).length;

      if (visibleCount === 0) {
        throw new Error("MERMAID_EMPTY_DIAGRAM");
      }

      if (canvasAiRequestIdRef.current !== requestId) {
        return;
      }

      setCanvasAiPreview({
        kind: requestKind,
        method: previewMethod,
        title: previewTitle,
        insertMode: requestInsertMode,
        sourceKind: requestSource.sourceKind,
        sourceTitle: requestSource.sourceTitle,
        prompt: requestPrompt,
        sourceText: requestSource.sourceText,
        selectedElementIds: requestSelectedElementIds,
        selectedCount: context.selectedCount,
        diagramCode,
        elements: styledElements,
        files,
        summary: t("canvas.aiPreviewSummary", { count: visibleCount })
      });
      setCanvasAiStatus("ready");
      setCanvasAiMessage(t("canvas.aiPreviewReady"));
      setIsCanvasAiOpen(false);
    } catch (error) {
      if (canvasAiRequestIdRef.current !== requestId) {
        return;
      }

      console.warn("Canvas AI generation failed.", error);
      setCanvasAiStatus("error");
      setCanvasAiMessage(getCanvasAiErrorMessage(error));
    }
  };

  const handleCancelCanvasAiPreview = () => {
    if (canvasAiStatus === "applying") {
      return;
    }

    resetCanvasAiPreviewState();
  };

  const handleApplyCanvasAiPreview = async () => {
    const api = excalidrawApiRef.current;

    if (!canvasAiPreview) {
      return;
    }

    setCanvasAiStatus("applying");
    setCanvasAiMessage(t("canvas.aiApplying"));

    if (canvasAiPreview.insertMode === "newCanvas") {
      if (!onCreateCanvasFromAi) {
        setCanvasAiStatus("error");
        setCanvasAiMessage(getCanvasAiErrorMessage(new Error("CANVAS_AI_NEW_CANVAS_UNAVAILABLE")));
        return;
      }

      const positionedElements = moveCanvasAiElements(canvasAiPreview.elements, { x: 80, y: 80 });
      const content: CanvasContent = {
        elements: positionedElements as unknown as CanvasContent["elements"],
        appState: getCanvasRuntimeAppStateDefaults(currentCanvasBackground) as CanvasContent["appState"]
      };

      try {
        await onCreateCanvasFromAi(
          content,
          canvasAiPreview.files,
          {},
          canvasAiPreview.title || canvasAiPreview.prompt || t(`canvas.aiKind.${canvasAiPreview.kind}`)
        );
        canvasAiRequestIdRef.current += 1;
        setCanvasAiStatus("idle");
        setCanvasAiMessage("");
        setCanvasAiPreview(null);
        setCanvasAiPrompt("");
        setIsCanvasAiOpen(false);
      } catch (error) {
        console.warn("Canvas AI new canvas apply failed.", error);
        setCanvasAiStatus("error");
        setCanvasAiMessage(getCanvasAiErrorMessage(error));
      }

      return;
    }

    if (!api) {
      setCanvasAiStatus("error");
      setCanvasAiMessage(getCanvasAiErrorMessage(new Error("CANVAS_AI_CANVAS_UNAVAILABLE")));
      return;
    }

    const selectedElementIds = canvasAiPreview.selectedElementIds;
    const shouldReplaceSelection =
      canvasAiPreview.insertMode === "replaceSelection" && Object.keys(selectedElementIds).length > 0;
    const insertionPoint = getCanvasAiInsertionPoint(
      api,
      canvasAiPreview.elements,
      canvasAiPreview.insertMode,
      selectedElementIds
    );
    const positionedElements = moveCanvasAiElements(canvasAiPreview.elements, insertionPoint);
    const selectedAiElementIds = Object.fromEntries(
      positionedElements.filter((element) => !element.isDeleted).map((element) => [element.id, true])
    );
    const currentElements = api.getSceneElementsIncludingDeleted();
    const nextBaseElements = shouldReplaceSelection
      ? currentElements.map((element) =>
          selectedElementIds[element.id]
            ? markCanvasElementUpdated({ ...element, isDeleted: true } as ExcalidrawElement)
            : element
        )
      : currentElements;

    if (Object.keys(canvasAiPreview.files).length > 0) {
      api.addFiles(Object.values(canvasAiPreview.files));
    }

    api.updateScene({
      elements: [...nextBaseElements, ...positionedElements],
      appState: {
        selectedElementIds: selectedAiElementIds,
        selectedGroupIds: {},
        editingGroupId: null,
        editingTextElement: null,
        editingLinearElement: null,
        selectionElement: null
      } as unknown as ExcalidrawAppState,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY
    });
    api.refresh();
    setCanvasSelectionCount(Object.keys(selectedAiElementIds).length);
    canvasAiRequestIdRef.current += 1;
    setCanvasAiStatus("idle");
    setCanvasAiMessage("");
    setCanvasAiPreview(null);
    setCanvasAiPrompt("");
    setIsCanvasAiOpen(false);
    window.requestAnimationFrame(() => {
      const liveElements = api.getSceneElementsIncludingDeleted();
      const refreshedElements = liveElements.map((element) =>
        selectedAiElementIds[element.id]
          ? markCanvasElementUpdated(element as ExcalidrawElement)
          : element
      );
      const liveAiElements = refreshedElements.filter(
        (element) => selectedAiElementIds[element.id] && !element.isDeleted
      ) as ExcalidrawElement[];

      api.updateScene({
        elements: refreshedElements,
        appState: {
          selectedElementIds: selectedAiElementIds,
          selectedGroupIds: {},
          editingGroupId: null,
          editingTextElement: null,
          editingLinearElement: null,
          selectionElement: null
        } as unknown as ExcalidrawAppState,
        captureUpdate: CaptureUpdateAction.NEVER
      });
      api.refresh();
      api.scrollToContent(liveAiElements.length > 0 ? liveAiElements : positionedElements, {
        fitToViewport: true,
        viewportZoomFactor: 0.72,
        animate: true
      });
      syncCanvasUiChrome();
    });
  };

  const handleSceneChange = (
    elements: readonly CanvasContent["elements"][number][],
    appState: CanvasContent["appState"],
    files: BinaryFiles
  ) => {
    const runtimeDefaults = getCanvasRuntimeAppStateDefaults(appState?.viewBackgroundColor);
    const nextScene: CanvasContent = {
      elements: elements.map((element) => ({ ...element })),
      appState: appState
        ? {
            ...runtimeDefaults,
            ...appState,
            theme: DEFAULT_CANVAS_THEME,
            viewBackgroundColor:
              typeof appState.viewBackgroundColor === "string"
                ? appState.viewBackgroundColor
                : runtimeDefaults.viewBackgroundColor,
            currentItemStrokeColor:
              typeof appState.currentItemStrokeColor === "string"
                ? appState.currentItemStrokeColor
                : runtimeDefaults.currentItemStrokeColor,
            currentItemBackgroundColor:
              typeof appState.currentItemBackgroundColor === "string"
                ? appState.currentItemBackgroundColor
                : runtimeDefaults.currentItemBackgroundColor,
            exportBackground:
              typeof appState.exportBackground === "boolean"
                ? appState.exportBackground
                : true,
            exportWithDarkMode: false
          }
        : runtimeDefaults
    };

    const nextBackground =
      nextScene.appState?.viewBackgroundColor ??
      runtimeDefaults.viewBackgroundColor ??
      DEFAULT_CANVAS_BACKGROUND;
    const nextSelectedCount = Object.values(appState?.selectedElementIds ?? {}).filter(Boolean).length;

    setCurrentCanvasBackground(nextBackground);
    setBackgroundHexDraft(nextBackground.toUpperCase());
    setCanvasSelectionCount(nextSelectedCount);

    latestSceneRef.current = nextScene;
    latestFilesRef.current = files;
    latestFileNamesRef.current = {
      ...latestFileNamesRef.current,
      ...generatedFileNamesRef.current
    };

    if (contentTimeoutRef.current) {
      window.clearTimeout(contentTimeoutRef.current);
    }

    onContentChange(nextScene, files, latestFileNamesRef.current, "saving");

    contentTimeoutRef.current = window.setTimeout(() => {
      latestOnContentChangeRef.current(
        latestSceneRef.current,
        latestFilesRef.current,
        latestFileNamesRef.current,
        "saved"
      );
    }, 360);

    window.requestAnimationFrame(syncCanvasUiChrome);
  };

  const handleTitleChange = (value: string) => {
    setTitleDraft(value);

    if (titleTimeoutRef.current) {
      window.clearTimeout(titleTimeoutRef.current);
    }

    titleTimeoutRef.current = window.setTimeout(() => {
      onTitleChange(value.trim());
    }, 220);
  };

	  const showCanvasExportStatus = (status: Exclude<CanvasExportStatus, null>) => {
    setCanvasExportStatus(status);

    if (canvasExportStatusTimeoutRef.current !== null) {
      window.clearTimeout(canvasExportStatusTimeoutRef.current);
    }

    canvasExportStatusTimeoutRef.current = window.setTimeout(() => {
      setCanvasExportStatus(null);
      canvasExportStatusTimeoutRef.current = null;
	    }, 2400);
	  };

	  const showCanvasTaskStatus = (status: Exclude<CanvasTaskStatus, null>) => {
	    setCanvasTaskStatus(status);

	    if (canvasTaskStatusTimeoutRef.current !== null) {
	      window.clearTimeout(canvasTaskStatusTimeoutRef.current);
	    }

	    canvasTaskStatusTimeoutRef.current = window.setTimeout(() => {
	      setCanvasTaskStatus(null);
	      canvasTaskStatusTimeoutRef.current = null;
	    }, 2200);
	  };

	  const handleCreateTaskFromCanvasSelection = async () => {
	    const api = excalidrawApiRef.current;

	    if (!api || !onCreateTaskFromContext) {
	      return;
	    }

	    const appState = api.getAppState();
	    const selectedElementIds = appState.selectedElementIds ?? {};
	    const selectedIds = Object.keys(selectedElementIds).filter((id) => selectedElementIds[id]);

	    if (selectedIds.length === 0) {
	      showCanvasTaskStatus("error");
	      return;
	    }

	    const elements = api.getSceneElements() as readonly ExcalidrawElement[];
	    const ownSelectionIds = getCanvasAiOwnSelectionIds(elements, selectedElementIds);
	    const selectedRecord = toCanvasAiSelectedRecord(ownSelectionIds);
	    const selectedText = collectCanvasText(elements, selectedRecord);
	    const firstElementId = selectedIds[0] ?? null;
	    const fallbackTitle = translateInline(language, "canvasPane.taskFromCanvas");

	    try {
	      await onCreateTaskFromContext({
	        title: normalizePlannerContextTaskTitle(selectedText || titleDraft || note.title, fallbackTitle),
	        description: selectedText.slice(0, 1800),
	        projectId: note.projectId,
	        folderId: note.folderId,
	        canvasId: note.id,
	        canvasElementId: firstElementId,
	        sourceLabel: translateInline(language, "canvasPane.canvasSelection")
	      });
	      showCanvasTaskStatus("created");
	    } catch (error) {
	      console.warn("Could not create planner task from canvas selection.", error);
	      showCanvasTaskStatus("error");
	    }
	  };

	  const handleExportCanvas = async (format: CanvasExportFormat) => {
    const api = excalidrawApiRef.current;

    if (!api) {
      showCanvasExportStatus("error");
      return;
    }

    if (!(await confirmPrivateVaultAction("export"))) {
      return;
    }

    try {
      const name = sanitizeExportFileName(titleDraft.trim() || getDisplayNoteTitle(note, language), "canvas");
      const elements = api.getSceneElements() as readonly ExcalidrawElement[];
      const appState = api.getAppState() as Partial<ExcalidrawAppState>;
      const files = api.getFiles();
      const exportConfig =
        format === "pdf"
          ? {
              defaultPath: `${name}.pdf`,
              filterName: "PDF",
              extensions: ["pdf"],
              preferredExtension: "pdf",
              blob: await createCanvasPdfBlob({ elements, appState, files, name })
            }
          : {
              defaultPath: `${name}.excalidraw.json`,
              filterName: "Excalidraw JSON",
              extensions: ["json", "excalidraw"],
              preferredExtension: "json",
              blob: await createCanvasJsonBlob({ elements, appState, files, name })
            };
      const didSave = await saveBlobFileWithDialog({
        defaultPath: exportConfig.defaultPath,
        filters: [
          {
            name: exportConfig.filterName,
            extensions: exportConfig.extensions
          }
        ],
        blob: exportConfig.blob,
        preferredExtension: exportConfig.preferredExtension
      });

      if (didSave) {
        showCanvasExportStatus(format);
      }
    } catch {
      showCanvasExportStatus("error");
    }
  };

  const handleFitCanvasContent = () => {
    const api = excalidrawApiRef.current;

    if (!api) {
      return;
    }

    const liveElements = api.getSceneElements().filter((element) => !element.isDeleted);

    if (liveElements.length > 0) {
      api.scrollToContent(liveElements, {
        fitToContent: true,
        viewportZoomFactor: 0.78,
        animate: true,
        duration: 260
      });
      return;
    }

    api.scrollToContent(undefined, {
      fitToViewport: true,
      viewportZoomFactor: 0.9,
      animate: true,
      duration: 260
    });
  };

  const handleOpenNativeCanvasMenu = () => {
    setActiveSurface("canvas");
    setIsCanvasAiOpen(false);

    window.requestAnimationFrame(() => {
      const nativeMenuTrigger =
        canvasStageShellRef.current?.querySelector<HTMLButtonElement>(".excalidraw .main-menu-trigger");

      if (!nativeMenuTrigger) {
        return;
      }

      nativeMenuTrigger.click();
      window.requestAnimationFrame(syncCanvasUiChrome);
    });
  };

  const handleCloseNativeCanvasMenu = () => {
    const hasNativeMenu =
      canvasStageShellRef.current?.querySelector(".dropdown-menu.canvas-mainmenu-dropdown") != null;
    const nativeMenuTrigger =
      canvasStageShellRef.current?.querySelector<HTMLButtonElement>(".excalidraw .main-menu-trigger");

    if (hasNativeMenu) {
      nativeMenuTrigger?.click();
    }
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true
      })
    );
    setIsNativeCanvasMenuOpen(false);
    window.requestAnimationFrame(syncCanvasUiChrome);
  };

  useEffect(() => {
    if (!isNativeCanvasMenuOpen) {
      return undefined;
    }

    const handleNativeMenuOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      if (
        target.closest(".dropdown-menu.canvas-mainmenu-dropdown") ||
        target.closest(".Dialog") ||
        target.closest(".Modal")
      ) {
        return;
      }

      handleCloseNativeCanvasMenu();
    };

    document.addEventListener("pointerdown", handleNativeMenuOutsidePointerDown, true);

    return () => {
      document.removeEventListener("pointerdown", handleNativeMenuOutsidePointerDown, true);
    };
  }, [isNativeCanvasMenuOpen]);

  useEffect(() => {
    const updateMobileDialogScope = () => {
      const isMobileCanvasShell =
        canvasStageShellRef.current?.closest(".locoris-adaptive-shell[data-mobile-shell='true']") != null;

      document.body.classList.toggle("locoris-canvas-mobile-dialogs", isMobileCanvasShell);
    };

    updateMobileDialogScope();

    const adaptiveShell = canvasStageShellRef.current?.closest(".locoris-adaptive-shell") ?? null;
    const mobileShellObserver = adaptiveShell ? new MutationObserver(updateMobileDialogScope) : null;

    if (adaptiveShell && mobileShellObserver) {
      mobileShellObserver.observe(adaptiveShell, {
        attributeFilter: ["data-mobile-shell"],
        attributes: true
      });
    }
    window.addEventListener("resize", updateMobileDialogScope);

    return () => {
      mobileShellObserver?.disconnect();
      window.removeEventListener("resize", updateMobileDialogScope);
      document.body.classList.remove("locoris-canvas-mobile-dialogs");
    };
  }, []);

  useEffect(() => {
    return () => {
      if (titleTimeoutRef.current) {
        window.clearTimeout(titleTimeoutRef.current);
      }

      if (contentTimeoutRef.current) {
        window.clearTimeout(contentTimeoutRef.current);
        latestOnContentChangeRef.current(
          latestSceneRef.current,
          latestFilesRef.current,
          latestFileNamesRef.current,
          "saved"
        );
      }

      if (latestTitleDraftRef.current !== latestStoredTitleRef.current) {
        latestOnTitleChangeRef.current(latestTitleDraftRef.current.trim());
      }
    };
  }, []);

  const updateCanvasAiPopoverGeometry = () => {
    const shell = canvasAiShellRef.current;

    if (!shell) {
      return;
    }

    if (shell.closest('.locoris-adaptive-shell[data-mobile-shell="true"]')) {
      setCanvasAiPopoverStyle({});
      return;
    }

    const shellRect = shell.getBoundingClientRect();
    const boundaryElement =
      shell.closest(".orbital-editor-modal-window") ??
      shell.closest(".canvas-pane") ??
      document.documentElement;
    const boundaryRect = boundaryElement.getBoundingClientRect();
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const inset = 10;
    const boundaryLeft = Math.max(inset, boundaryRect.left + inset);
    const boundaryTop = Math.max(inset, boundaryRect.top + inset);
    const boundaryRight = Math.min(viewportWidth - inset, boundaryRect.right - inset);
    const boundaryBottom = Math.min(viewportHeight - inset, boundaryRect.bottom - inset);
    const availableWidth = Math.max(260, boundaryRight - boundaryLeft);
    const width = Math.min(420, availableWidth);
    const belowTop = shellRect.bottom + 10;
    const aboveBottom = shellRect.top - 10;
    const availableBelow = boundaryBottom - belowTop;
    const availableAbove = aboveBottom - boundaryTop;
    const shouldPlaceAbove = availableBelow < 380 && availableAbove > availableBelow;
    const preferredHeight = shouldPlaceAbove ? availableAbove : availableBelow;
    const maxHeight = Math.max(240, Math.min(620, preferredHeight, boundaryBottom - boundaryTop));
    const left = clampCanvasAiNumber(
      shellRect.right - width,
      boundaryLeft,
      Math.max(boundaryLeft, boundaryRight - width)
    ) - shellRect.left;
    const rawTop = shouldPlaceAbove ? aboveBottom - maxHeight : belowTop;
    const top =
      clampCanvasAiNumber(rawTop, boundaryTop, Math.max(boundaryTop, boundaryBottom - maxHeight)) -
      shellRect.top;

    setCanvasAiPopoverStyle({
      position: "absolute",
      right: "auto",
      left,
      top,
      width,
      maxHeight
    });
  };

  useLayoutEffect(() => {
    if (!isCanvasAiOpen) {
      setCanvasAiPopoverStyle({});
      return undefined;
    }

    let frameId = window.requestAnimationFrame(updateCanvasAiPopoverGeometry);
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateCanvasAiPopoverGeometry);
    };

    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    window.visualViewport?.addEventListener("resize", scheduleUpdate);
    window.visualViewport?.addEventListener("scroll", scheduleUpdate);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.visualViewport?.removeEventListener("resize", scheduleUpdate);
      window.visualViewport?.removeEventListener("scroll", scheduleUpdate);
    };
  }, [
    canvasAiCommandId,
    canvasAiInsertMode,
    canvasAiMessage,
    canvasAiNoteSearch,
    canvasAiShowMoreCommands,
    canvasAiSourceMode,
    canvasAiStatus,
    canvasAiWorkflow,
    filteredCanvasAiSourceNotes.length,
    isCanvasAiOpen
  ]);

  useEffect(() => {
    const stageShell = canvasStageShellRef.current;

    if (!stageShell) {
      return undefined;
    }

    const scheduleSync = () => {
      window.requestAnimationFrame(syncCanvasUiChrome);
    };

    const handleTopPickClickCapture = (event: Event) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const button = event.target.closest<HTMLButtonElement>(
        ".color-picker__top-picks .color-picker__button"
      );

      if (!button) {
        return;
      }

      const originalColor =
        button.dataset.canvasQuickPickOriginal ??
        button.getAttribute("title") ??
        button.dataset.testid ??
        "";
      const override = resolveCanvasTopPickOverride(originalColor);

      if (!override) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      applyCanvasQuickColor(override.kind, override.replacement);
      scheduleSync();
    };

    const stageObserver = new MutationObserver(scheduleSync);
    const bodyObserver = new MutationObserver(scheduleSync);

    stageShell.addEventListener("click", handleTopPickClickCapture, true);
    stageObserver.observe(stageShell, { childList: true, subtree: true });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
    scheduleSync();

    return () => {
      stageShell.removeEventListener("click", handleTopPickClickCapture, true);
      stageObserver.disconnect();
      bodyObserver.disconnect();
    };
  }, [note.id]);

  const canvasAiBusy = canvasAiStatus === "generating" || canvasAiStatus === "applying";
  const hasCanvasSelection = canvasSelectionCount > 0;
  const canvasAiRenderContext = isCanvasAiOpen ? getCanvasAiContext() : undefined;
  const canvasAiValidationWarning = getCanvasAiValidationError(canvasAiRenderContext);
  const canvasAiRunDisabled = canvasAiBusy;
  const androidBackLayer = canvasAiPreview
    ? "ai-preview"
    : isCanvasAiOpen
      ? "ai-panel"
      : isClearCanvasDialogOpen
        ? "clear-canvas"
        : activeSurface === "info"
          ? "details"
          : null;

  useAndroidBackHandler(Boolean(androidBackLayer), () => {
    if (androidBackLayer === "ai-preview") {
      if (canvasAiStatus !== "applying") {
        handleCancelCanvasAiPreview();
      }

      return;
    }

    if (androidBackLayer === "ai-panel") {
      setIsCanvasAiOpen(false);
      return;
    }

    if (androidBackLayer === "clear-canvas") {
      setIsClearCanvasDialogOpen(false);
      return;
    }

    if (androidBackLayer === "details") {
      setActiveSurface("canvas");
    }
  });

  const renderCanvasAiPanel = (style?: CSSProperties) => (
    <div
      className="canvas-ai-popover"
      role="dialog"
      aria-label={t("canvas.aiTitle")}
      style={style}
    >
      <label className="canvas-ai-prompt-card">
        <span className="canvas-ai-prompt-icon" aria-hidden="true">
          <CanvasAiIcon />
        </span>
        <textarea
          value={canvasAiPrompt}
          onChange={(event) => {
            setCanvasAiPrompt(event.target.value);
            resetCanvasAiPreviewState();
          }}
          placeholder={t("canvas.aiPromptPlaceholder")}
          aria-label={t("canvas.aiPromptLabel")}
          rows={3}
          disabled={canvasAiBusy}
        />
        <button
          type="button"
          className="canvas-ai-prompt-run"
          onClick={() => void handleGenerateCanvasAiPreview()}
          disabled={canvasAiRunDisabled}
          title={canvasAiPreview ? t("canvas.aiRegenerate") : t("canvas.aiGenerate")}
          aria-label={canvasAiPreview ? t("canvas.aiRegenerate") : t("canvas.aiGenerate")}
        >
          <CanvasAiRunIcon />
        </button>
      </label>

      <div className="canvas-ai-command-card">
        <div className="canvas-ai-panel-section">
          <div className="canvas-ai-section-title">
            <span>{t("canvas.aiSourceLabel")}</span>
          </div>
          <div className="canvas-ai-source-switch" role="radiogroup" aria-label={t("canvas.aiSourceLabel")}>
            {CANVAS_AI_SOURCE_MODES.map((sourceMode) => {
              const noticeKey = `source:${sourceMode}`;
              const isAllowed = activeCanvasAiSourceModes.includes(sourceMode);
              const needsSelection = sourceMode === "selection" && !hasCanvasSelection;
              const unavailableMessage = !isAllowed
                ? t("canvas.aiSourceUnavailable")
                : needsSelection
                  ? t("canvas.aiSelectionRequired")
                  : "";

              return (
                <button
                  key={sourceMode}
                  type="button"
                  className={`canvas-ai-source-pill ${canvasAiSourceMode === sourceMode ? "is-active" : ""} ${
                    unavailableMessage ? "is-disabled" : ""
                  }`}
                  onClick={() => {
                    if (unavailableMessage) {
                      showCanvasAiNotice(noticeKey, unavailableMessage);
                      return;
                    }

                    setCanvasAiSourceMode(sourceMode);
                    resetCanvasAiPreviewState();
                  }}
                  disabled={canvasAiBusy}
                  aria-disabled={unavailableMessage ? true : undefined}
                  title={unavailableMessage || undefined}
                >
                  {t(`canvas.aiSource.${sourceMode}`)}
                  {canvasAiNotice?.key === noticeKey ? (
                    <span className="canvas-ai-inline-notice" role="status">
                      {canvasAiNotice.message}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {canvasAiSourceMode === "note" ? (
            <div className="canvas-ai-note-source">
              <input
                type="search"
                value={canvasAiNoteSearch}
                onChange={(event) => {
                  setCanvasAiNoteSearch(event.target.value);
                  setCanvasAiSourceNoteId("");
                  resetCanvasAiPreviewState();
                }}
                placeholder={t("canvas.aiSourceNoteSearch")}
                aria-label={t("canvas.aiSourceNoteSearch")}
                disabled={canvasAiBusy}
              />
              <div className="canvas-ai-note-list">
                {filteredCanvasAiSourceNotes.length > 0 ? (
                  filteredCanvasAiSourceNotes.map((sourceNote) => {
                    const isSelected =
                      sourceNote.id === (selectedCanvasAiSourceNote?.id ?? filteredCanvasAiSourceNotes[0]?.id);

                    return (
                      <button
                        key={sourceNote.id}
                        type="button"
                        className={`canvas-ai-note-row ${isSelected ? "is-active" : ""}`}
                        onClick={() => {
                          setCanvasAiSourceNoteId(sourceNote.id);
                          resetCanvasAiPreviewState();
                        }}
                        disabled={canvasAiBusy}
                      >
                        <span>{getDisplayNoteTitle(sourceNote, language)}</span>
                        <small>{sourceNote.excerpt || sourceNote.plainText || t("canvas.aiPreviewEmptySource")}</small>
                      </button>
                    );
                  })
                ) : (
                  <p className="canvas-ai-note-empty">{t("canvas.aiSourceNoNotes")}</p>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="canvas-ai-panel-section">
          <div className="canvas-ai-section-title">
            <span>{t("canvas.aiWorkflowLabel")}</span>
          </div>
          <div className="canvas-ai-workflow-switch" role="tablist" aria-label={t("canvas.aiWorkflowLabel")}>
            {CANVAS_AI_WORKFLOWS.map((workflow) => (
              <button
                key={workflow.id}
                type="button"
                className={`canvas-ai-workflow-pill ${canvasAiWorkflow === workflow.id ? "is-active" : ""}`}
                onClick={() => {
                  const nextCommand =
                    CANVAS_AI_COMMANDS.find((command) => command.workflow === workflow.id && !command.hiddenByDefault) ??
                    CANVAS_AI_COMMANDS.find((command) => command.workflow === workflow.id);

                  if (nextCommand) {
                    handleSelectCanvasAiCommand(nextCommand, { collapseCommands: true });
                  } else {
                    setCanvasAiWorkflow(workflow.id);
                    setCanvasAiShowMoreCommands(false);
                    resetCanvasAiPreviewState();
                  }
                }}
                disabled={canvasAiBusy}
              >
                {t(workflow.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="canvas-ai-panel-section">
          <div className="canvas-ai-section-title">
            <span>{t("canvas.aiInsertModeLabel")}</span>
          </div>
          <div className="canvas-ai-mode-switch" role="radiogroup" aria-label={t("canvas.aiInsertModeLabel")}>
            {CANVAS_AI_INSERT_MODES.map((insertMode) => {
              const noticeKey = `insert:${insertMode}`;
              const isAllowed = activeCanvasAiInsertModes.includes(insertMode);
              const needsSelection = insertMode === "replaceSelection" && !hasCanvasSelection;
              const needsCreateHandler = insertMode === "newCanvas" && !onCreateCanvasFromAi;
              const unavailableMessage = !isAllowed
                ? t("canvas.aiInsertModeUnavailable")
                : needsSelection
                  ? t("canvas.aiReplaceNeedsSelection")
                  : needsCreateHandler
                    ? t("canvas.aiNewCanvasUnavailable")
                    : "";

              return (
                <button
                  key={insertMode}
                  type="button"
                  className={`canvas-ai-mode-pill ${canvasAiInsertMode === insertMode ? "is-active" : ""} ${
                    unavailableMessage ? "is-disabled" : ""
                  }`}
                  onClick={() => {
                    if (unavailableMessage) {
                      showCanvasAiNotice(noticeKey, unavailableMessage);
                      return;
                    }

                    setCanvasAiInsertMode(insertMode);
                    resetCanvasAiPreviewState();
                  }}
                  disabled={canvasAiBusy}
                  aria-disabled={unavailableMessage ? true : undefined}
                  title={unavailableMessage || undefined}
                >
                  {insertMode === "replaceSelection"
                    ? t("canvas.aiReplaceSelection")
                    : insertMode === "newCanvas"
                      ? t("canvas.aiNewCanvas")
                      : t("canvas.aiInsertNearby")}
                  {canvasAiNotice?.key === noticeKey ? (
                    <span className="canvas-ai-inline-notice" role="status">
                      {canvasAiNotice.message}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="canvas-ai-panel-section">
          <div className="canvas-ai-section-title">
            <span>{t("canvas.aiCommandLabel")}</span>
            {hiddenCanvasAiCommandCount > 0 ? (
              <button
                type="button"
                className="canvas-ai-more-button"
                onClick={() => setCanvasAiShowMoreCommands((showMore) => !showMore)}
                disabled={canvasAiBusy}
              >
                {canvasAiShowMoreCommands
                  ? t("canvas.aiLessCommands")
                  : t("canvas.aiMoreCommands", { count: hiddenCanvasAiCommandCount })}
              </button>
            ) : null}
          </div>
          <div className="canvas-ai-command-list" role="radiogroup" aria-label={t("canvas.aiCommandLabel")}>
            {visibleCanvasAiCommands.map((command) => {
              const noticeKey = `command:${command.id}`;
              const unavailableMessage =
                command.requiresSelection && !hasCanvasSelection
                  ? t("canvas.aiSelectionRequired")
                  : "";

              return (
                <button
                  key={command.id}
                  type="button"
                  className={`canvas-ai-command-row ${canvasAiCommandId === command.id ? "is-active" : ""} ${
                    unavailableMessage ? "is-disabled" : ""
                  }`}
                  onClick={() => {
                    if (unavailableMessage) {
                      showCanvasAiNotice(noticeKey, unavailableMessage);
                      return;
                    }

                    handleSelectCanvasAiCommand(command);
                  }}
                  disabled={canvasAiBusy}
                  aria-disabled={unavailableMessage ? true : undefined}
                  title={unavailableMessage || undefined}
                >
                  <span className="canvas-ai-command-icon" aria-hidden="true">
                    <CanvasAiIcon />
                  </span>
                  <span>
                    <strong>{t(command.labelKey)}</strong>
                    <small>{t(command.descriptionKey)}</small>
                  </span>
                  {canvasAiNotice?.key === noticeKey ? (
                    <span className="canvas-ai-inline-notice" role="status">
                      {canvasAiNotice.message}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {!canvasAiNotice && canvasAiValidationWarning ? (
          <p className="canvas-ai-message is-warning">
            {getCanvasAiErrorMessage(canvasAiValidationWarning)}
          </p>
        ) : null}

        {canvasAiMessage ? (
          <p className={`canvas-ai-message is-${canvasAiStatus}`}>{canvasAiMessage}</p>
        ) : null}
      </div>
    </div>
  );

  const renderCanvasInfoPanel = ({
    className = "",
    mobile = false
  }: {
    className?: string;
    mobile?: boolean;
  } = {}) => (
    <aside
      className={["canvas-sidepanel", className].filter(Boolean).join(" ")}
      role={mobile ? "dialog" : undefined}
      aria-modal={mobile ? true : undefined}
      aria-label={mobile ? t("canvas.infoTab") : undefined}
    >
      <div className="canvas-mobile-info-head">
        <div className="canvas-mobile-sheet-handle" aria-hidden="true" />
        <header>
          <div>
            <span>{t("canvas.mobile.infoKicker")}</span>
            <strong>{t("canvas.infoTab")}</strong>
          </div>
          <button
            type="button"
            className="canvas-mobile-sheet-close"
            onClick={() => setActiveSurface("canvas")}
            aria-label={t("canvas.mobile.closeSheet")}
          >
            <span aria-hidden="true" />
          </button>
        </header>
      </div>

      <div className="canvas-mobile-info-body">
        <section className="canvas-detail-card">
          <div className="canvas-detail-field">
            <span className="canvas-detail-label">{t("note.folder")}</span>
            <FolderPicker
              options={folderOptions}
              value={note.folderId}
              emptyLabel={t("orbit.uncategorized")}
              ariaLabel={t("note.folder")}
              onChange={onFolderChange}
            />
          </div>

          <div className="canvas-detail-field">
            <span className="canvas-detail-label">{t("note.tags")}</span>
            <TagInputField
              tags={tags}
              selectedTagIds={note.tagIds}
              language={language}
              onChangeTagIds={onTagIdsChange}
              onCreateTag={onCreateTag}
            />
          </div>

          <div className="canvas-detail-field">
            <span className="canvas-detail-label">{t("note.color")}</span>
            <div className="color-swatch-grid compact">
              {COLOR_PALETTE.map((colorOption) => (
                <button
                  type="button"
                  key={colorOption.id}
                  className={`color-swatch compact ${note.color === colorOption.hex ? "is-active" : ""}`}
                  onClick={() => onNoteColorChange(colorOption.hex)}
                  style={{ "--swatch-color": colorOption.hex } as CSSProperties}
                  aria-label={`${t("note.color")}: ${t(colorOption.labelKey)}`}
                  title={t(colorOption.labelKey)}
                >
                  <span className="color-swatch-fill" />
                </button>
              ))}
            </div>
            <label className="orbital-custom-color-picker">
              <span className="orbital-color-label">{t("orbit.customColor")}</span>
              <span className="orbital-custom-color-control">
                <input
                  type="color"
                  className="orbital-custom-color-input"
                  value={note.color || DEFAULT_NOTE_COLOR}
                  onChange={(event) => onNoteColorChange(event.target.value)}
                  aria-label={t("orbit.customColor")}
                />
                <span className="orbital-custom-color-value">
                  {(note.color || DEFAULT_NOTE_COLOR).toUpperCase()}
                </span>
              </span>
            </label>
          </div>
        </section>

        {!mobile ? (
          <section className="canvas-detail-card canvas-detail-card-actions">
            <div className="canvas-action-grid">
              <button
                type="button"
                className={`micro-action ${note.pinned || note.favorite ? "is-active" : ""}`}
                onClick={onTogglePin}
              >
                {note.pinned || note.favorite ? t("note.unpin") : t("note.pin")}
              </button>
              {note.trashedAt ? (
                <button type="button" className="micro-action" onClick={onRestore}>
                  {t("note.restore")}
                </button>
              ) : null}
              <button type="button" className="micro-action danger" onClick={onDelete}>
                {note.trashedAt ? t("note.deletePermanently") : t("note.moveToTrash")}
              </button>
            </div>
          </section>
        ) : null}

      </div>
    </aside>
  );

  return (
    <section
      className={`canvas-pane ${immersive ? "is-immersive" : ""} ${
        activeSurface === "info" ? "is-details-open" : ""
      }`}
      style={{ "--note-accent": note.color || DEFAULT_NOTE_COLOR } as CSSProperties}
    >
      <CanvasMobileChrome
        title={titleDraft}
        placeholder={t("canvas.titlePlaceholder")}
        saveState={saveState}
        exportStatus={canvasExportStatus}
        taskStatus={canvasTaskStatus}
        selectionCount={canvasSelectionCount}
        isAiOpen={isCanvasAiOpen}
        isPinned={Boolean(note.pinned || note.favorite)}
        isTrashed={Boolean(note.trashedAt)}
        onTitleChange={handleTitleChange}
        onClose={onClose}
        onToggleAi={() => {
          setActiveSurface("canvas");
          setIsCanvasAiOpen((isOpen) => !isOpen);
          setCanvasAiMessage("");
        }}
        onOpenInfo={() => {
          setIsCanvasAiOpen(false);
          setActiveSurface("info");
        }}
        onFitContent={handleFitCanvasContent}
        onCreateTask={() => void handleCreateTaskFromCanvasSelection()}
        onOpenNativeMenu={handleOpenNativeCanvasMenu}
        onTogglePin={onTogglePin}
        onRestore={onRestore}
        onDelete={onDelete}
        onClearCanvas={() => {
          setIsCanvasAiOpen(false);
          setActiveSurface("canvas");
          setIsClearCanvasDialogOpen(true);
        }}
      />
      {isCanvasAiOpen ? (
        <div ref={canvasAiMobileShellRef} className="canvas-ai-mobile-sheet-layer" role="presentation">
          <button
            type="button"
            className="canvas-ai-mobile-backdrop"
            onClick={() => setIsCanvasAiOpen(false)}
            aria-label={t("canvas.mobile.closeSheet")}
          />
          <section className="canvas-ai-mobile-sheet" role="presentation">
            <button
              type="button"
              className="canvas-ai-mobile-sheet-close"
              onClick={() => setIsCanvasAiOpen(false)}
              aria-label={t("canvas.mobile.closeSheet")}
            >
              <CanvasAiCloseIcon />
            </button>
            {renderCanvasAiPanel()}
          </section>
        </div>
      ) : null}
      {activeSurface === "info" ? (
        <div className="canvas-info-mobile-sheet-layer" role="presentation">
          <button
            type="button"
            className="canvas-info-mobile-backdrop"
            onClick={() => setActiveSurface("canvas")}
            aria-label={t("canvas.mobile.closeSheet")}
          />
          {renderCanvasInfoPanel({ className: "is-mobile-sheet", mobile: true })}
        </div>
      ) : null}
      <div className="canvas-pane-toolbar">
        <div className="canvas-pane-toolbar-main">
          <input
            value={titleDraft}
            onChange={(event) => handleTitleChange(event.target.value)}
            className="note-title-input canvas-title-field"
            placeholder={t("canvas.titlePlaceholder")}
          />

          <div className="canvas-pane-toolbar-meta">
            <span className={`editor-save-pill is-${saveState}`}>{t(`saveState.${saveState}`)}</span>
	            {canvasExportStatus ? (
	              <span className={`canvas-pane-file-status is-${canvasExportStatus}`}>
	                {t(`canvas.exportStatus.${canvasExportStatus}`)}
	              </span>
	            ) : null}
	            {canvasTaskStatus ? (
	              <span className={`canvas-pane-file-status is-task-${canvasTaskStatus}`}>
	                {canvasTaskStatus === "created" ? t("canvas.taskCreated") : t("canvas.taskFailed")}
	              </span>
	            ) : null}
            <span className="canvas-pane-contextmeta">
              {t("note.updated")}: {formatTimestamp(note.updatedAt)}
            </span>
          </div>
        </div>

        <div className="canvas-pane-tools">
          <div
            className="canvas-surface-switcher"
            role="tablist"
            aria-label={t("canvas.surfaceLabel")}
          >
            <button
              type="button"
              className={`canvas-surface-tab ${activeSurface === "canvas" ? "is-active" : ""}`}
              onClick={() => setActiveSurface("canvas")}
            >
              {t("canvas.drawTab")}
            </button>
            <button
              type="button"
              className={`canvas-surface-tab ${activeSurface === "info" ? "is-active" : ""}`}
              onClick={() => setActiveSurface("info")}
            >
              {t("canvas.infoTab")}
            </button>
          </div>

	          <div ref={canvasAiShellRef} className={`canvas-ai-shell ${isCanvasAiOpen ? "is-open" : ""}`}>
	            {onCreateTaskFromContext ? (
	              <button
	                type="button"
	                className="canvas-task-trigger"
	                onClick={() => void handleCreateTaskFromCanvasSelection()}
	                disabled={canvasSelectionCount === 0}
	                aria-label={t("canvas.taskFromSelection")}
	                title={canvasSelectionCount === 0 ? t("canvas.taskSelectionRequired") : t("canvas.taskFromSelection")}
	              >
	                <span className="canvas-task-trigger-icon" aria-hidden="true" />
	                <span>{t("note.createTaskShort")}</span>
	              </button>
	            ) : null}
	            <button
              type="button"
              className={`canvas-ai-trigger ${isCanvasAiOpen ? "is-active" : ""}`}
              onClick={() => {
                setIsCanvasAiOpen((isOpen) => !isOpen);
                setCanvasAiMessage("");
              }}
              aria-label={t("canvas.aiButton")}
              title={t("canvas.aiButton")}
            >
              <span className="canvas-ai-trigger-icon">
                <CanvasAiIcon />
              </span>
              <span>{t("canvas.aiShort")}</span>
            </button>

            {isCanvasAiOpen ? (
              <button
                type="button"
                className="canvas-ai-mobile-backdrop"
                onClick={() => setIsCanvasAiOpen(false)}
                aria-label={t("canvas.mobile.closeSheet")}
              />
            ) : null}

            {isCanvasAiOpen ? renderCanvasAiPanel(canvasAiPopoverStyle) : null}
          </div>
        </div>
      </div>

      {canvasAiPreview ? (
        <div className="canvas-ai-preview-layer" role="presentation">
          <button
            type="button"
            className="canvas-ai-preview-backdrop"
            aria-label={t("canvas.aiPreviewCancel")}
            onClick={handleCancelCanvasAiPreview}
            disabled={canvasAiStatus === "applying"}
          />
          <section
            className="canvas-ai-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="canvas-ai-preview-title"
          >
            <header className="canvas-ai-preview-header">
              <div>
                <p className="canvas-ai-preview-kicker">{t("canvas.aiPreviewKicker")}</p>
                <h3 id="canvas-ai-preview-title">{t("canvas.aiPreviewTitle")}</h3>
                <p>{canvasAiPreview.summary}</p>
              </div>
              <button
                type="button"
                className="canvas-ai-preview-close"
                onClick={handleCancelCanvasAiPreview}
                disabled={canvasAiStatus === "applying"}
                aria-label={t("canvas.aiPreviewCancel")}
              >
                <CanvasAiCloseIcon />
              </button>
            </header>

            <div className="canvas-ai-preview-meta">
              <span className="canvas-ai-preview-method">{t(`canvas.aiKind.${canvasAiPreview.kind}`)}</span>
              <span className="canvas-ai-preview-method">
                {canvasAiPreview.method === "canvas-json"
                  ? t("canvas.aiPreviewMethodJson")
                  : t("canvas.aiPreviewMethodMermaid")}
              </span>
              <span>
                {canvasAiPreview.insertMode === "replaceSelection"
                  ? t("canvas.aiPreviewReplaceMode")
                  : canvasAiPreview.insertMode === "newCanvas"
                    ? t("canvas.aiPreviewNewCanvasMode")
                    : t("canvas.aiPreviewInsertMode")}
              </span>
              <span>
                {canvasAiPreview.sourceKind === "selection"
                  ? t("canvas.aiPreviewSourceSelection")
                  : canvasAiPreview.sourceKind === "description"
                    ? t("canvas.aiPreviewSourceDescription")
                    : canvasAiPreview.sourceKind === "note"
                      ? t("canvas.aiPreviewSourceNote")
                      : t("canvas.aiPreviewSourceCanvas")}
              </span>
              {canvasAiPreview.sourceTitle ? <span>{canvasAiPreview.sourceTitle}</span> : null}
              {canvasAiPreview.selectedCount > 0 ? (
                <span>{t("canvas.aiPreviewSelectionCount", { count: canvasAiPreview.selectedCount })}</span>
              ) : null}
            </div>

            <div className="canvas-ai-preview-grid">
              <section className="canvas-ai-preview-card">
                <div className="canvas-ai-preview-card-title">
                  <span>{t("canvas.aiPreviewBefore")}</span>
                  <span>{t("canvas.aiPreviewSourceLabel")}</span>
                </div>
                <div className="canvas-ai-preview-scroll">
                  {canvasAiPreview.prompt ? (
                    <div className="canvas-ai-preview-source-block">
                      <span>{t("canvas.aiPreviewPrompt")}</span>
                      <p>{canvasAiPreview.prompt}</p>
                    </div>
                  ) : null}
                  {canvasAiPreview.sourceText ? (
                    <div className="canvas-ai-preview-source-block">
                      <span>
                        {canvasAiPreview.sourceKind === "selection"
                          ? t("canvas.aiPreviewSourceSelection")
                          : canvasAiPreview.sourceKind === "note"
                            ? t("canvas.aiPreviewSourceNote")
                            : t("canvas.aiPreviewSourceCanvas")}
                      </span>
                      <pre>{canvasAiPreview.sourceText}</pre>
                    </div>
                  ) : !canvasAiPreview.prompt ? (
                    <p className="canvas-ai-preview-empty">{t("canvas.aiPreviewEmptySource")}</p>
                  ) : null}
                </div>
              </section>

              <section className="canvas-ai-preview-card is-after">
                <div className="canvas-ai-preview-card-title">
                  <span>{t("canvas.aiPreviewAfter")}</span>
                  <span>
                    {canvasAiPreview.method === "canvas-json"
                      ? t("canvas.aiPreviewMethodJson")
                      : t("canvas.aiPreviewMethodMermaid")}
                  </span>
                </div>
                <div className="canvas-ai-preview-scroll">
                  <pre className="canvas-ai-preview-mermaid">{canvasAiPreview.diagramCode}</pre>
                </div>
              </section>
            </div>

            {canvasAiMessage ? (
              <p className={`canvas-ai-preview-message is-${canvasAiStatus}`}>{canvasAiMessage}</p>
            ) : null}

            <footer className="canvas-ai-preview-footer">
              <button
                type="button"
                className="canvas-ai-preview-secondary"
                onClick={handleCancelCanvasAiPreview}
                disabled={canvasAiStatus === "applying"}
              >
                {t("canvas.aiPreviewCancel")}
              </button>
              <button
                type="button"
                className="canvas-ai-preview-primary"
                onClick={() => void handleApplyCanvasAiPreview()}
                disabled={canvasAiStatus === "applying"}
              >
                {canvasAiStatus === "applying" ? t("canvas.aiApplyingShort") : t("canvas.aiPreviewApply")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      <div className="canvas-pane-shell">
        <div className={`canvas-stage-column ${activeSurface === "info" ? "is-hidden-mobile" : ""}`}>
          <div className="canvas-stage-frame">
            <div ref={canvasStageShellRef} className="canvas-stage-shell">
              <Excalidraw
                key={note.id}
                excalidrawAPI={(api) => {
                  excalidrawApiRef.current = api;

                  window.requestAnimationFrame(() => {
                    api.updateScene({
                      appState: getCanvasRuntimeAppStateDefaults(
                        getInitialCanvasAppState(note.canvasContent).viewBackgroundColor
                      ) as unknown as ExcalidrawAppState,
                      captureUpdate: CaptureUpdateAction.NEVER
                    });
                    syncCanvasUiChrome();
                  });
                }}
                name={getDisplayNoteTitle(note, language)}
                langCode={getLocaleLanguageCode(language)}
                theme="light"
                UIOptions={EXCALIDRAW_UI_OPTIONS}
                initialData={async (): Promise<ExcalidrawInitialDataState> => ({
                  elements: (note.canvasContent?.elements ?? []) as unknown as readonly ExcalidrawElement[],
                  appState: getInitialCanvasAppState(note.canvasContent),
                  files: await onLoadFiles(),
                  libraryItems: persistedLibraryItems
                })}
                onChange={(elements, appState, files) =>
                  handleSceneChange(
                    elements as unknown as CanvasContent["elements"],
                    appState as unknown as CanvasContent["appState"],
                    files
                  )
                }
                onLibraryChange={(libraryItems) =>
                  persistExcalidrawLibrary(libraryStorageScopeId, libraryItems)
                }
                generateIdForFile={(file) => {
                  const id = crypto.randomUUID();
                  generatedFileNamesRef.current[id] = file.name;
                  return id;
                }}
                viewModeEnabled={false}
              >
                <MainMenu>
                  <MainMenu.DefaultItems.SaveAsImage />
                  <CanvasMenuAction
                    label={t("canvas.exportPdf")}
                    icon="export"
                    tone="default"
                    onSelect={() => void handleExportCanvas("pdf")}
                  />
                  <CanvasMenuAction
                    label={t("canvas.exportJson")}
                    icon="export"
                    tone="default"
                    onSelect={() => void handleExportCanvas("json")}
                  />
                  <MainMenu.Separator />
                  <CanvasBackgroundMenuSection
                    label={t("canvas.backgroundLabel")}
                    customLabel={t("canvas.backgroundCustom")}
                    value={currentCanvasBackground}
                    hexValue={backgroundHexDraft}
                    presets={CANVAS_BACKGROUND_PRESETS}
                    onSelectPreset={applyCanvasBackground}
                    onColorInput={applyCanvasBackground}
                    onHexInput={handleBackgroundHexInput}
                  />
                  <MainMenu.Separator />
                  <CanvasMenuAction
                    label={t("canvas.clearCanvas")}
                    icon="trash"
                    tone="danger"
                    onSelect={() => setIsClearCanvasDialogOpen(true)}
                  />
                  <MainMenu.Separator />
                  <MainMenu.DefaultItems.Help />
                </MainMenu>
              </Excalidraw>
            </div>
            <ConfirmDialog
              open={isClearCanvasDialogOpen}
              kicker={t("canvas.clearCanvasKicker")}
              title={t("canvas.clearCanvasTitle")}
              message={t("canvas.clearCanvasMessage")}
              confirmLabel={t("canvas.clearCanvasConfirm")}
              cancelLabel={t("canvas.clearCanvasCancel")}
              onConfirm={handleClearCanvasConfirm}
              onCancel={() => setIsClearCanvasDialogOpen(false)}
            />
            {privateVaultWarningDialog}
          </div>
        </div>

        {renderCanvasInfoPanel({
          className: `is-desktop-panel ${activeSurface === "canvas" ? "is-hidden-mobile" : ""}`
        })}
      </div>
    </section>
  );
}
