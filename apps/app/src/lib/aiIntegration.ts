import type { AppLanguage, NoteContent } from "../types";
import {
  AI_EDITOR_STRUCTURED_OUTPUT_SCHEMA,
  prepareBlocksForAiPrompt,
  supportsStructuredEditorOutput,
  type AiStructuredEditPayload,
  type AiStructuredEditIntent
} from "./aiEditorSchema";
import {
  deleteSecureSecret,
  readSecureSecret,
  writeSecureSecret
} from "./secureSecretStore";
import {
  removePersistentString,
  readPersistentString,
  writePersistentString
} from "./persistentClientStorage";
import { isWebRuntime } from "./runtime";
import { getNativeLocaleName, resolveSupportedLocale } from "../localization";

export type GeminiAiAction = "beautify" | "improve" | "fix" | "translate" | "custom";
export type GeminiAiScope = "note" | "selection";
export type GeminiCustomMode = "edit" | "generate";
export type GeminiEditorFormat = "rich-json" | "markdown";
export type GeminiEditorApplyMode = "diff" | "instant";
export type GeminiCanvasGenerationMode = "mermaid" | "schema";
export type GeminiCanvasDiagramKind =
  | "flowchart"
  | "mindmap"
  | "pie"
  | "sequence"
  | "roadmap"
  | "timeline"
  | "concept"
  | "kanban";
export type CanvasDiagramSpecKind = GeminiCanvasDiagramKind;
export type CanvasAiSourceKind = "description" | "selection" | "canvas" | "note";

export type CanvasDiagramTone =
  | "primary"
  | "accent"
  | "muted"
  | "success"
  | "warning"
  | "danger";

export type CanvasDiagramEdge = {
  from: string;
  to: string;
  label?: string;
  tone?: CanvasDiagramTone;
};

export type CanvasDiagramNode = {
  id: string;
  label: string;
  body?: string;
  level?: number;
  groupId?: string;
  tone?: CanvasDiagramTone;
  shape?: "rectangle" | "diamond" | "ellipse";
};

type CanvasDiagramBaseSpec = {
  title?: string;
  kind: CanvasDiagramSpecKind;
  summary?: string;
  layout?: {
    direction?: "radial" | "leftRight" | "topDown" | "timeline" | "kanban";
    density?: "compact" | "normal" | "airy";
  };
  nodes?: CanvasDiagramNode[];
  groups?: Array<{
    id: string;
    title: string;
    nodeIds?: string[];
  }>;
  edges?: CanvasDiagramEdge[];
};

export type CanvasFlowchartSpec = CanvasDiagramBaseSpec & {
  kind: "flowchart";
  steps: Array<{
    id: string;
    label: string;
    body?: string;
    type?: "start" | "process" | "decision" | "data" | "note" | "end" | "risk";
    groupId?: string;
    tone?: CanvasDiagramTone;
  }>;
};

export type CanvasMindMapSpec = CanvasDiagramBaseSpec & {
  kind: "mindmap";
  root: {
    label: string;
    body?: string;
    tone?: CanvasDiagramTone;
  };
  branches: Array<{
    id: string;
    label: string;
    body?: string;
    tone?: CanvasDiagramTone;
    items?: Array<{
      id: string;
      label: string;
      body?: string;
      tone?: CanvasDiagramTone;
      items?: Array<{
        id: string;
        label: string;
        body?: string;
        tone?: CanvasDiagramTone;
      }>;
    }>;
  }>;
  crossLinks?: CanvasDiagramEdge[];
};

export type CanvasPieChartSpec = CanvasDiagramBaseSpec & {
  kind: "pie";
  center?: {
    label: string;
    body?: string;
  };
  slices: Array<{
    id: string;
    label: string;
    value: number;
    body?: string;
    tone?: CanvasDiagramTone;
  }>;
};

export type CanvasSequenceSpec = CanvasDiagramBaseSpec & {
  kind: "sequence";
  participants: Array<{
    id: string;
    label: string;
    role?: string;
    tone?: CanvasDiagramTone;
  }>;
  messages: Array<{
    from: string;
    to: string;
    label: string;
    note?: string;
    kind?: "sync" | "async" | "return" | "decision" | "loop";
    tone?: CanvasDiagramTone;
  }>;
  notes?: Array<{
    label: string;
    body?: string;
    participantId?: string;
    at?: number;
    tone?: CanvasDiagramTone;
  }>;
};

export type CanvasRoadmapSpec = CanvasDiagramBaseSpec & {
  kind: "roadmap";
  phases: Array<{
    id: string;
    title: string;
    timeframe?: string;
    goal?: string;
    tone?: CanvasDiagramTone;
    milestones?: Array<{
      id: string;
      label: string;
      body?: string;
      status?: "planned" | "active" | "done" | "risk";
      owner?: string;
      tone?: CanvasDiagramTone;
    }>;
    risks?: string[];
    actions?: string[];
  }>;
  dependencies?: CanvasDiagramEdge[];
};

export type CanvasTimelineSpec = CanvasDiagramBaseSpec & {
  kind: "timeline";
  events: Array<{
    id: string;
    date?: string;
    label: string;
    body?: string;
    group?: string;
    tone?: CanvasDiagramTone;
  }>;
};

export type CanvasKanbanSpec = CanvasDiagramBaseSpec & {
  kind: "kanban";
  columns: Array<{
    id: string;
    title: string;
    summary?: string;
    tone?: CanvasDiagramTone;
    cards?: Array<{
      id: string;
      label: string;
      body?: string;
      tone?: CanvasDiagramTone;
      tags?: string[];
    }>;
  }>;
  links?: CanvasDiagramEdge[];
};

export type CanvasSemanticIslandsSpec = CanvasDiagramBaseSpec & {
  kind: "concept";
  islands: Array<{
    id: string;
    title: string;
    summary?: string;
    tone?: CanvasDiagramTone;
    items?: Array<{
      id: string;
      label: string;
      body?: string;
      tone?: CanvasDiagramTone;
    }>;
  }>;
  links?: CanvasDiagramEdge[];
};

export type CanvasDiagramSpec =
  | CanvasFlowchartSpec
  | CanvasMindMapSpec
  | CanvasPieChartSpec
  | CanvasSequenceSpec
  | CanvasRoadmapSpec
  | CanvasTimelineSpec
  | CanvasKanbanSpec
  | CanvasSemanticIslandsSpec;

export function isCanvasDiagramSpecKind(kind: GeminiCanvasDiagramKind): kind is CanvasDiagramSpecKind {
  return Boolean(kind);
}

export type GeminiModelOption = {
  id: string;
  label: string;
  badgeKey: string;
  descriptionKey: string;
  bestForKey: string;
  limitKey: string;
  speed: number;
  quality: number;
  quota: number;
};

export const GEMINI_API_KEY_SECRET_KEY = "ai:gemini:api-key";
export const GEMINI_API_KEY_BROWSER_STORAGE_KEY = "zen:ai.gemini.api-key";
export const GEMINI_MODEL_STORAGE_KEY = "locoris.ai.gemini.model";
export const GEMINI_EDITOR_FORMAT_STORAGE_KEY = "locoris.ai.editor-format";
export const GEMINI_EDITOR_APPLY_MODE_STORAGE_KEY = "locoris.ai.editor-apply-mode";
export const GEMINI_CANVAS_GENERATION_MODE_STORAGE_KEY = "locoris.ai.canvas-generation-mode";
export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
export const DEFAULT_GEMINI_EDITOR_FORMAT: GeminiEditorFormat = "markdown";
export const DEFAULT_GEMINI_EDITOR_APPLY_MODE: GeminiEditorApplyMode = "diff";
export const DEFAULT_GEMINI_CANVAS_GENERATION_MODE: GeminiCanvasGenerationMode = "mermaid";
export const EDITOR_AI_OPEN_EVENT = "locoris:editor-ai-open";

export const GEMINI_MODEL_OPTIONS: readonly GeminiModelOption[] = [
  {
    id: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    badgeKey: "settings.aiModelBadgeDefault",
    descriptionKey: "settings.aiModelGemini31FlashLiteDescription",
    bestForKey: "settings.aiModelGemini31FlashLiteBestFor",
    limitKey: "settings.aiModelGemini31FlashLiteLimit",
    speed: 5,
    quality: 4,
    quota: 5
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    badgeKey: "settings.aiModelBadgeBalanced",
    descriptionKey: "settings.aiModelGemini25FlashDescription",
    bestForKey: "settings.aiModelGemini25FlashBestFor",
    limitKey: "settings.aiModelGemini25FlashLimit",
    speed: 4,
    quality: 4,
    quota: 3
  },
  {
    id: "gemma-4-31b-it",
    label: "Gemma 4 31B IT",
    badgeKey: "settings.aiModelBadgeGemma",
    descriptionKey: "settings.aiModelGemma431bDescription",
    bestForKey: "settings.aiModelGemma431bBestFor",
    limitKey: "settings.aiModelGemma431bLimit",
    speed: 3,
    quality: 4,
    quota: 4
  },
  {
    id: "gemma-4-26b-a4b-it",
    label: "Gemma 4 26B A4B IT",
    badgeKey: "settings.aiModelBadgeGemmaFast",
    descriptionKey: "settings.aiModelGemma426bDescription",
    bestForKey: "settings.aiModelGemma426bBestFor",
    limitKey: "settings.aiModelGemma426bLimit",
    speed: 4,
    quality: 3,
    quota: 4
  },
  {
    id: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash-Lite",
    badgeKey: "settings.aiModelBadgeFast",
    descriptionKey: "settings.aiModelGemini25FlashLiteDescription",
    bestForKey: "settings.aiModelGemini25FlashLiteBestFor",
    limitKey: "settings.aiModelGemini25FlashLiteLimit",
    speed: 5,
    quality: 3,
    quota: 4
  },
  {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    badgeKey: "settings.aiModelBadgeSmart",
    descriptionKey: "settings.aiModelGemini25ProDescription",
    bestForKey: "settings.aiModelGemini25ProBestFor",
    limitKey: "settings.aiModelGemini25ProLimit",
    speed: 2,
    quality: 5,
    quota: 1
  }
] as const;

type GenerateGeminiMarkdownInput = {
  apiKey: string;
  model: string;
  action: GeminiAiAction;
  scope: GeminiAiScope;
  markdown: string;
  appLanguage: AppLanguage;
  noteTitle?: string;
  customPrompt?: string;
  customMode?: GeminiCustomMode;
  targetLanguage?: string;
};

type GenerateGeminiStructuredEditInput = GenerateGeminiMarkdownInput & {
  editorBlocks: NoteContent;
  intent: AiStructuredEditIntent;
};

type GenerateGeminiCanvasMermaidInput = {
  apiKey: string;
  model: string;
  kind: GeminiCanvasDiagramKind;
  mode?: "create" | "transformSelection";
  prompt: string;
  appLanguage: AppLanguage;
  canvasTitle?: string;
  sourceKind?: CanvasAiSourceKind;
  sourceTitle?: string;
  canvasBackgroundColor?: string;
  canvasText?: string;
  selectedText?: string;
};

type GenerateGeminiCanvasSpecInput = GenerateGeminiCanvasMermaidInput & {
  kind: CanvasDiagramSpecKind;
};

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    finishReason?: string;
  }>;
  error?: {
    message?: string;
    status?: string;
  };
};

type GeminiGenerationConfig = Record<string, unknown>;

const CANVAS_DIAGRAM_TONE_SCHEMA = {
  type: "string",
  enum: ["primary", "accent", "muted", "success", "warning", "danger"]
} as const;

const CANVAS_DIAGRAM_NODE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label"],
  properties: {
    id: { type: "string", maxLength: 64 },
    label: { type: "string", maxLength: 140 },
    body: { type: "string", maxLength: 720 },
    level: { type: "number", minimum: 0, maximum: 8 },
    groupId: { type: "string", maxLength: 64 },
    tone: CANVAS_DIAGRAM_TONE_SCHEMA,
    shape: { type: "string", enum: ["rectangle", "diamond", "ellipse"] }
  }
} as const;

const CANVAS_DIAGRAM_EDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["from", "to"],
  properties: {
    from: { type: "string", maxLength: 64 },
    to: { type: "string", maxLength: 64 },
    label: { type: "string", maxLength: 140 },
    tone: CANVAS_DIAGRAM_TONE_SCHEMA
  }
} as const;

const CANVAS_DIAGRAM_SPEC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind"],
  properties: {
    title: { type: "string", maxLength: 100 },
    kind: {
      type: "string",
      enum: ["flowchart", "mindmap", "pie", "sequence", "roadmap", "timeline", "concept", "kanban"]
    },
    summary: { type: "string", maxLength: 420 },
    layout: {
      type: "object",
      additionalProperties: false,
      properties: {
        direction: {
          type: "string",
          enum: ["radial", "leftRight", "topDown", "timeline", "kanban"]
        },
        density: {
          type: "string",
          enum: ["compact", "normal", "airy"]
        }
      }
    },
    groups: {
      type: "array",
      maxItems: 32,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title"],
        properties: {
          id: { type: "string", maxLength: 64 },
          title: { type: "string", maxLength: 120 },
          nodeIds: {
            type: "array",
            maxItems: 160,
            items: { type: "string", maxLength: 64 }
          }
        }
      }
    },
    nodes: {
      type: "array",
      maxItems: 140,
      items: CANVAS_DIAGRAM_NODE_SCHEMA
    },
    edges: {
      type: "array",
      maxItems: 260,
      items: CANVAS_DIAGRAM_EDGE_SCHEMA
    },
    steps: {
      type: "array",
      maxItems: 120,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label"],
        properties: {
          id: { type: "string", maxLength: 64 },
          label: { type: "string", maxLength: 140 },
          body: { type: "string", maxLength: 720 },
          type: {
            type: "string",
            enum: ["start", "process", "decision", "data", "note", "end", "risk"]
          },
          groupId: { type: "string", maxLength: 64 },
          tone: CANVAS_DIAGRAM_TONE_SCHEMA
        }
      }
    },
    root: {
      type: "object",
      additionalProperties: false,
      required: ["label"],
      properties: {
        label: { type: "string", maxLength: 140 },
        body: { type: "string", maxLength: 720 },
        tone: CANVAS_DIAGRAM_TONE_SCHEMA
      }
    },
    branches: {
      type: "array",
      maxItems: 18,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label"],
        properties: {
          id: { type: "string", maxLength: 64 },
          label: { type: "string", maxLength: 140 },
          body: { type: "string", maxLength: 720 },
          tone: CANVAS_DIAGRAM_TONE_SCHEMA,
          items: {
            type: "array",
            maxItems: 18,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "label"],
              properties: {
                id: { type: "string", maxLength: 64 },
                label: { type: "string", maxLength: 140 },
                body: { type: "string", maxLength: 720 },
                tone: CANVAS_DIAGRAM_TONE_SCHEMA,
                items: {
                  type: "array",
                  maxItems: 12,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id", "label"],
                    properties: {
                      id: { type: "string", maxLength: 64 },
                      label: { type: "string", maxLength: 140 },
                      body: { type: "string", maxLength: 520 },
                      tone: CANVAS_DIAGRAM_TONE_SCHEMA
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    crossLinks: {
      type: "array",
      maxItems: 80,
      items: CANVAS_DIAGRAM_EDGE_SCHEMA
    },
    center: {
      type: "object",
      additionalProperties: false,
      required: ["label"],
      properties: {
        label: { type: "string", maxLength: 140 },
        body: { type: "string", maxLength: 520 }
      }
    },
    slices: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "value"],
        properties: {
          id: { type: "string", maxLength: 64 },
          label: { type: "string", maxLength: 120 },
          value: { type: "number", minimum: 0.01, maximum: 1000000 },
          body: { type: "string", maxLength: 420 },
          tone: CANVAS_DIAGRAM_TONE_SCHEMA
        }
      }
    },
    participants: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label"],
        properties: {
          id: { type: "string", maxLength: 64 },
          label: { type: "string", maxLength: 120 },
          role: { type: "string", maxLength: 160 },
          tone: CANVAS_DIAGRAM_TONE_SCHEMA
        }
      }
    },
    messages: {
      type: "array",
      maxItems: 180,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "label"],
        properties: {
          from: { type: "string", maxLength: 64 },
          to: { type: "string", maxLength: 64 },
          label: { type: "string", maxLength: 180 },
          note: { type: "string", maxLength: 420 },
          kind: { type: "string", enum: ["sync", "async", "return", "decision", "loop"] },
          tone: CANVAS_DIAGRAM_TONE_SCHEMA
        }
      }
    },
    notes: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label"],
        properties: {
          label: { type: "string", maxLength: 160 },
          body: { type: "string", maxLength: 420 },
          participantId: { type: "string", maxLength: 64 },
          at: { type: "number", minimum: 0, maximum: 200 },
          tone: CANVAS_DIAGRAM_TONE_SCHEMA
        }
      }
    },
    phases: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title"],
        properties: {
          id: { type: "string", maxLength: 64 },
          title: { type: "string", maxLength: 120 },
          timeframe: { type: "string", maxLength: 120 },
          goal: { type: "string", maxLength: 420 },
          tone: CANVAS_DIAGRAM_TONE_SCHEMA,
          milestones: {
            type: "array",
            maxItems: 18,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "label"],
              properties: {
                id: { type: "string", maxLength: 64 },
                label: { type: "string", maxLength: 140 },
                body: { type: "string", maxLength: 520 },
                status: { type: "string", enum: ["planned", "active", "done", "risk"] },
                owner: { type: "string", maxLength: 120 },
                tone: CANVAS_DIAGRAM_TONE_SCHEMA
              }
            }
          },
          risks: {
            type: "array",
            maxItems: 10,
            items: { type: "string", maxLength: 180 }
          },
          actions: {
            type: "array",
            maxItems: 10,
            items: { type: "string", maxLength: 180 }
          }
        }
      }
    },
    dependencies: {
      type: "array",
      maxItems: 120,
      items: CANVAS_DIAGRAM_EDGE_SCHEMA
    },
    events: {
      type: "array",
      maxItems: 120,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label"],
        properties: {
          id: { type: "string", maxLength: 64 },
          date: { type: "string", maxLength: 120 },
          label: { type: "string", maxLength: 140 },
          body: { type: "string", maxLength: 520 },
          group: { type: "string", maxLength: 120 },
          tone: CANVAS_DIAGRAM_TONE_SCHEMA
        }
      }
    },
    columns: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title"],
        properties: {
          id: { type: "string", maxLength: 64 },
          title: { type: "string", maxLength: 120 },
          summary: { type: "string", maxLength: 360 },
          tone: CANVAS_DIAGRAM_TONE_SCHEMA,
          cards: {
            type: "array",
            maxItems: 24,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "label"],
              properties: {
                id: { type: "string", maxLength: 64 },
                label: { type: "string", maxLength: 140 },
                body: { type: "string", maxLength: 520 },
                tone: CANVAS_DIAGRAM_TONE_SCHEMA,
                tags: {
                  type: "array",
                  maxItems: 6,
                  items: { type: "string", maxLength: 40 }
                }
              }
            }
          }
        }
      }
    },
    links: {
      type: "array",
      maxItems: 120,
      items: CANVAS_DIAGRAM_EDGE_SCHEMA
    },
    islands: {
      type: "array",
      maxItems: 18,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title"],
        properties: {
          id: { type: "string", maxLength: 64 },
          title: { type: "string", maxLength: 120 },
          summary: { type: "string", maxLength: 420 },
          tone: CANVAS_DIAGRAM_TONE_SCHEMA,
          items: {
            type: "array",
            maxItems: 18,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "label"],
              properties: {
                id: { type: "string", maxLength: 64 },
                label: { type: "string", maxLength: 140 },
                body: { type: "string", maxLength: 520 },
                tone: CANVAS_DIAGRAM_TONE_SCHEMA
              }
            }
          }
        }
      }
    }
  }
} as const;

const CANVAS_DIAGRAM_SPEC_REQUIRED_FIELDS: Record<CanvasDiagramSpecKind, string[]> = {
  flowchart: ["steps"],
  mindmap: ["root", "branches"],
  pie: ["slices"],
  sequence: ["participants", "messages"],
  roadmap: ["phases"],
  timeline: ["events"],
  concept: ["islands"],
  kanban: ["columns"]
};

function buildCanvasDiagramSpecSchema(kind: CanvasDiagramSpecKind) {
  return {
    ...CANVAS_DIAGRAM_SPEC_SCHEMA,
    required: ["kind", ...CANVAS_DIAGRAM_SPEC_REQUIRED_FIELDS[kind]],
    properties: {
      ...CANVAS_DIAGRAM_SPEC_SCHEMA.properties,
      kind: {
        type: "string",
        enum: [kind]
      }
    }
  };
}

export function sanitizeGeminiModelId(model: string | null | undefined) {
  return (typeof model === "string" ? model.trim() : "").replace(/^models\//i, "");
}

export function isValidGeminiModelId(model: string | null | undefined) {
  const normalized = sanitizeGeminiModelId(model);
  return /^[a-z0-9][a-z0-9._-]{1,159}$/i.test(normalized);
}

function resolveModelId(model: string | null | undefined) {
  const normalized = sanitizeGeminiModelId(model);

  if (!normalized) {
    return DEFAULT_GEMINI_MODEL;
  }

  if (!isValidGeminiModelId(normalized)) {
    throw new Error("GEMINI_MODEL_ID_INVALID");
  }

  return normalized;
}

export function readStoredGeminiModel() {
  try {
    return resolveModelId(readPersistentString(GEMINI_MODEL_STORAGE_KEY));
  } catch {
    return DEFAULT_GEMINI_MODEL;
  }
}

export function writeStoredGeminiModel(model: string) {
  writePersistentString(GEMINI_MODEL_STORAGE_KEY, resolveModelId(model));
}

export function readStoredGeminiEditorFormat(): GeminiEditorFormat {
  const storedFormat = readPersistentString(GEMINI_EDITOR_FORMAT_STORAGE_KEY);

  return storedFormat === "rich-json" ? "rich-json" : DEFAULT_GEMINI_EDITOR_FORMAT;
}

export function writeStoredGeminiEditorFormat(format: GeminiEditorFormat) {
  writePersistentString(
    GEMINI_EDITOR_FORMAT_STORAGE_KEY,
    format === "rich-json" ? "rich-json" : DEFAULT_GEMINI_EDITOR_FORMAT
  );
}

export function readStoredGeminiEditorApplyMode(): GeminiEditorApplyMode {
  const storedMode = readPersistentString(GEMINI_EDITOR_APPLY_MODE_STORAGE_KEY);

  return storedMode === "instant" ? "instant" : DEFAULT_GEMINI_EDITOR_APPLY_MODE;
}

export function writeStoredGeminiEditorApplyMode(mode: GeminiEditorApplyMode) {
  writePersistentString(
    GEMINI_EDITOR_APPLY_MODE_STORAGE_KEY,
    mode === "instant" ? "instant" : DEFAULT_GEMINI_EDITOR_APPLY_MODE
  );
}

export function readStoredGeminiCanvasGenerationMode(): GeminiCanvasGenerationMode {
  const storedMode = readPersistentString(GEMINI_CANVAS_GENERATION_MODE_STORAGE_KEY);

  return storedMode === "schema" ? "schema" : DEFAULT_GEMINI_CANVAS_GENERATION_MODE;
}

export function writeStoredGeminiCanvasGenerationMode(mode: GeminiCanvasGenerationMode) {
  writePersistentString(
    GEMINI_CANVAS_GENERATION_MODE_STORAGE_KEY,
    mode === "schema" ? "schema" : DEFAULT_GEMINI_CANVAS_GENERATION_MODE
  );
}

function canUseBrowserGeminiKeyFallback() {
  return isWebRuntime();
}

export async function readGeminiApiKey() {
  const secureValue = await readSecureSecret(GEMINI_API_KEY_SECRET_KEY);

  if (secureValue || !canUseBrowserGeminiKeyFallback()) {
    return secureValue;
  }

  return readPersistentString(GEMINI_API_KEY_BROWSER_STORAGE_KEY)?.trim() ?? "";
}

export async function writeGeminiApiKey(apiKey: string) {
  await writeSecureSecret(GEMINI_API_KEY_SECRET_KEY, apiKey);

  if (canUseBrowserGeminiKeyFallback()) {
    writePersistentString(GEMINI_API_KEY_BROWSER_STORAGE_KEY, apiKey.trim());
  }
}

export async function deleteGeminiApiKey() {
  await deleteSecureSecret(GEMINI_API_KEY_SECRET_KEY);

  if (canUseBrowserGeminiKeyFallback()) {
    removePersistentString(GEMINI_API_KEY_BROWSER_STORAGE_KEY);
  }
}

function cleanGeminiMarkdown(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);

  return (fenced ? fenced[1] : trimmed).trim();
}

function cleanGeminiMermaid(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:mermaid|mmd|markdown|md)?\s*([\s\S]*?)\s*```$/i);
  const withoutFence = fenced ? fenced[1] : trimmed;
  const firstDiagramLine = withoutFence.search(/^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram)\b/im);

  return (firstDiagramLine >= 0 ? withoutFence.slice(firstDiagramLine) : withoutFence).trim();
}

function cleanGeminiJson(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const withoutFence = fenced ? fenced[1] : trimmed;
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return withoutFence.slice(firstBrace, lastBrace + 1).trim();
  }

  return withoutFence.trim();
}

function buildActionInstruction(input: GenerateGeminiMarkdownInput) {
  const scopeLabel = input.scope === "selection" ? "selected text" : "whole note";
  const customMode = input.customMode ?? "edit";

  if (input.action === "beautify") {
    return [
      `Transform the ${scopeLabel} into polished, elegant Markdown.`,
      "Use headings, concise sections, bullet lists, numbered lists, checklists, quotes, and tables only when they genuinely improve clarity.",
      "Add tasteful, context-aware emoji to headings or key list items when it improves warmth, scanability, or presentation. Keep it premium and not noisy.",
      "Preserve the input language exactly unless the user explicitly asked for a different language.",
      "Keep the meaning faithful. Do not invent facts."
    ].join("\n");
  }

  if (input.action === "improve") {
    return [
      `Improve the writing of the ${scopeLabel}.`,
      "Make it clearer, smoother, and more premium in tone while preserving the author's intent.",
      "Keep the original language unless the user explicitly asked otherwise."
    ].join("\n");
  }

  if (input.action === "fix") {
    return [
      `Fix spelling, grammar, punctuation, and obvious typos in the ${scopeLabel}.`,
      "Preserve the wording, structure, language, and formatting as much as possible."
    ].join("\n");
  }

  if (input.action === "translate") {
    return [
      `Translate the ${scopeLabel} to: ${input.targetLanguage?.trim() || "the requested target language"}.`,
      "Preserve the structure and useful Markdown formatting.",
      "Do not add commentary."
    ].join("\n");
  }

  if (customMode === "generate") {
    return [
      "Create new Markdown content from this user instruction:",
      input.customPrompt?.trim() || "",
      "Do not rewrite or summarize the existing note unless the instruction explicitly asks for that.",
      "Return only the newly generated content."
    ].join("\n");
  }

  return [
    `Apply this user instruction to the ${scopeLabel}:`,
    input.customPrompt?.trim() || "",
    "Preserve the input language unless the user instruction explicitly asks for a different language.",
    "Return the best resulting Markdown only."
  ].join("\n");
}

function buildStructuredActionInstruction(input: GenerateGeminiStructuredEditInput) {
  const scopeLabel = input.scope === "selection" ? "selected content" : "whole note";
  const customMode = input.customMode ?? "edit";

  if (input.action === "beautify") {
    return [
      `Transform the ${scopeLabel} into a polished premium Locoris note.`,
      "This action must create a visibly more beautiful rich note, not only a light rewrite.",
      "Do not summarize, compress, shorten, merge away, or omit source ideas. Preserve every meaningful detail, number, name, example, task, and nuance from the input.",
      "The final result should usually be at least as complete as the source. It may be longer when structure, headings, lists, or helpful context improve clarity.",
      "Add elegant hierarchy, expressive headings, concise sections, bullet lists, numbered lists, checklists, quotes, tables, links, and text styles when they improve clarity.",
      "Use tasteful, context-aware emoji in headings or key list items when it makes the note warmer, easier to scan, or more presentation-ready. Keep emoji premium and sparse, but do not omit them when the content naturally supports them.",
      "Use subtle text styles and color/background accents only when they help structure the result.",
      "Preserve the input language exactly unless the user explicitly asked for a different language.",
      "Keep meaning faithful. Do not invent facts."
    ].join("\n");
  }

  if (input.action === "improve") {
    return [
      `Improve the writing of the ${scopeLabel}.`,
      "Make it clearer, smoother, and more premium in tone while preserving structure, intent, language, links, tables, and useful styles.",
      "Do not summarize, shorten, omit examples, or remove details unless the user explicitly asked for compression."
    ].join("\n");
  }

  if (input.action === "fix") {
    return [
      `Fix spelling, grammar, punctuation, and obvious typos in the ${scopeLabel}.`,
      "Preserve wording, language, structure, block types, styles, links, tables, and checklist states as much as possible."
    ].join("\n");
  }

  if (input.action === "translate") {
    return [
      `Translate the ${scopeLabel} to: ${input.targetLanguage?.trim() || "the requested target language"}.`,
      "Preserve the rich editor structure, tables, checklists, links, media blocks, and useful styles."
    ].join("\n");
  }

  if (customMode === "generate") {
    return [
      "Create new rich note content from this user instruction:",
      input.customPrompt?.trim() || "",
      "Use the editor block types that best fit the request.",
      "Do not replace the existing note unless the instruction explicitly asks for that."
    ].join("\n");
  }

  return [
    `Apply this user instruction to the ${scopeLabel}:`,
    input.customPrompt?.trim() || "",
    "Preserve the input language unless the instruction explicitly asks for another language.",
    "Unless the instruction explicitly asks to summarize or shorten, preserve all meaningful source details and do not compress the content.",
    "Return the best resulting rich editor content."
  ].join("\n");
}

function buildAiInterfaceLanguageInstruction(language: AppLanguage) {
  const locale = resolveSupportedLocale(language);
  return `The Locoris interface language is ${getNativeLocaleName(locale)} (${locale}). Use it for user-facing output unless the request explicitly names another target language.`;
}

function buildGeminiPrompt(input: GenerateGeminiMarkdownInput) {
  const uiLanguage = buildAiInterfaceLanguageInstruction(input.appLanguage);
  const title = input.noteTitle?.trim()
    ? `Note title: ${input.noteTitle.trim()}`
    : "Note title: untitled";

  const basePrompt = [
    "You are an AI writing assistant built into a premium dark-themed local-first notes editor called Locoris.",
    `${uiLanguage} This is UI context only and must not determine the output language.`,
    title,
    "",
    "Output rules:",
    "- Return only Markdown.",
    "- Do not wrap the result in a code fence.",
    "- Do not add explanations, prefaces, or afterwords.",
    "- For beautify, improve, fix, and custom edit tasks: keep the same language as the input Markdown. If the input mixes languages, preserve that mix.",
    "- Only change language when the action is translate or the user's custom instruction explicitly requests another language.",
    "- For custom generate tasks: use the language of the user's instruction unless the instruction names another language.",
    "- Preserve links, lists, checklists, tables, quotes, and code blocks when they matter.",
    "- If the input is already well formatted, refine it subtly instead of overdecorating it.",
    "",
    "Task:",
    buildActionInstruction(input)
  ];

  if (input.action === "custom" && input.customMode === "generate") {
    return [
      ...basePrompt,
      "",
      input.markdown.trim()
        ? "Context Markdown (optional tone and continuity reference; do not replace it):"
        : "No existing Markdown context was provided.",
      input.markdown.trim()
    ].join("\n");
  }

  return [
    ...basePrompt,
    "",
    "Input Markdown:",
    input.markdown.trim()
  ].join("\n");
}

function buildGeminiStructuredPrompt(input: GenerateGeminiStructuredEditInput) {
  const uiLanguage = buildAiInterfaceLanguageInstruction(input.appLanguage);
  const title = input.noteTitle?.trim()
    ? `Note title: ${input.noteTitle.trim()}`
    : "Note title: untitled";
  const editorBlocks = JSON.stringify(prepareBlocksForAiPrompt(input.editorBlocks));

  return [
    "You are an AI writing assistant built into Locoris, a premium dark-themed local-first rich notes editor.",
    `${uiLanguage} This is UI context only and must not determine the output language.`,
    title,
    "",
    "Return a single JSON object matching the provided response schema.",
    "Do not wrap JSON in Markdown fences. Do not add prose outside JSON.",
    "",
    "Supported editor block types:",
    "- paragraph, heading, quote, codeBlock",
    "- bulletListItem, numberedListItem, checkListItem, toggleListItem",
    "- table, divider",
    "- image, file, audio, video",
    "",
    "Supported inline content:",
    "- text nodes: { type: \"text\", text: string, styles: { bold, italic, underline, strike, code, textColor, backgroundColor, font } }",
    "- links: { type: \"link\", href: string, content: text[] }",
    "",
    "Supported block props:",
    "- textColor, backgroundColor, textAlignment",
    "- heading: level 1-6 and optional isToggleable",
    "- codeBlock: language",
    "- numberedListItem: start",
    "- checkListItem: checked",
    "- media blocks: url, name, caption, showPreview, previewWidth",
    "- table blocks: put tableContent on the block instead of content",
    "- table cells: textColor, backgroundColor, textAlignment, colspan, rowspan",
    "",
    "Style rules:",
    "- Preserve completeness: never summarize, shorten, or omit meaningful source details unless the task explicitly asks for a shorter version.",
    "- Prefer a one-to-one transformation of source blocks into richer blocks. If you reorganize, carry all original information forward.",
    "- Use font only with one of: onest, ibmPlexSans, golosText, ibmPlexSerif, ibmPlexMono, unbounded.",
    "- Use textColor/backgroundColor as default color names or hex colors.",
    "- Preserve existing media block URLs. Do not invent downloadable file or media URLs.",
    "- Preserve links unless changing them is explicitly requested.",
    "- Preserve checklist checked states unless the task explicitly changes checklist semantics.",
    "- Use tables only when the information benefits from rows and columns.",
    "",
    `Requested edit intent: ${input.intent}.`,
    "",
    "Task:",
    buildStructuredActionInstruction(input),
    "",
    input.action === "custom" && input.customMode === "generate"
      ? "Context editor blocks for tone and continuity. Do not replace these unless explicitly requested:"
      : "Input editor blocks:",
    editorBlocks,
    "",
    input.markdown.trim()
      ? "Input Markdown/plain-text reference:"
      : "No Markdown/plain-text reference was provided.",
    input.markdown.trim()
  ].join("\n");
}

function buildGeminiCanvasMermaidPrompt(input: GenerateGeminiCanvasMermaidInput) {
  const uiLanguage = buildAiInterfaceLanguageInstruction(input.appLanguage);
  const title = input.canvasTitle?.trim()
    ? `Canvas title: ${input.canvasTitle.trim()}`
    : "Canvas title: untitled";
  const selectedText = input.selectedText?.trim();
  const canvasText = input.canvasText?.trim();
  const sourceTitle = input.sourceTitle?.trim();
  const canvasBackgroundColor = input.canvasBackgroundColor?.trim();
  const sourceKind = input.sourceKind ?? (selectedText ? "selection" : canvasText ? "canvas" : "description");
  const sourceLabel =
    sourceKind === "note"
      ? `Source note${sourceTitle ? ` (${sourceTitle})` : ""} text:`
      : sourceKind === "selection"
        ? "Selected canvas text:"
        : "Canvas text context:";
  const description = input.prompt.trim();
  const isTransformSelection = input.mode === "transformSelection" && Boolean(selectedText);
  const diagramInstruction: Record<GeminiCanvasDiagramKind, string[]> = {
    flowchart: [
      "Create an editable Mermaid flowchart.",
      "Start with: flowchart TD or flowchart LR.",
      "Use subgraph sections, rectangles, rounded cards, diamonds for decisions, side-note nodes, and labeled arrows."
    ],
    mindmap: [
      "Create a mind-map-like diagram using Mermaid flowchart LR syntax, not native mindmap syntax.",
      "Use one central node, branch subgraphs, leaf detail nodes, and occasional cross-links.",
      "The result should look like a mind map, not like a linear process."
    ],
    pie: [
      "Create a Mermaid pie chart.",
      "Start with: pie showData.",
      "Use a short title and 4-8 meaningful slices with numeric values. If the user provides exact values, preserve them exactly; otherwise infer sensible proportions from the prompt or source text.",
      "Do not turn this into a flowchart."
    ],
    sequence: [
      "Create a Mermaid sequenceDiagram.",
      "Use actors/participants, notes, alt/opt/loop blocks when useful, and concise but meaningful messages.",
      "For dialogue/story requests, write actual ordered lines and action beats between characters. Use 8-16 message arrows for a useful scene.",
      "Never return only participants/lifelines or a single generic message such as interaction/dialogue. Do not turn this into a flowchart."
    ],
    roadmap: [
      "Create a roadmap using Mermaid flowchart LR syntax.",
      "Use phase subgraphs, milestone cards, dependency arrows, risk/decision nodes, and next-action nodes.",
      "The result should read as a roadmap, not a generic block scheme."
    ],
    timeline: [
      "Create a timeline-style diagram using Mermaid flowchart LR syntax.",
      "Use chronological event cards, period subgraphs, date labels, causes, outcomes, and annotations.",
      "The result should read left-to-right as time."
    ],
    concept: [
      "Create a concept map using Mermaid flowchart LR syntax.",
      "Use semantic cluster subgraphs, labeled relationship arrows, examples, caveats, and cross-links.",
      "The result should explain relationships, not just list boxes."
    ],
    kanban: [
      "Create a kanban-style board using Mermaid flowchart LR syntax.",
      "Use subgraphs as columns and cards inside columns. Include blocked/risk markers and flow arrows between columns when useful.",
      "The result should look like a board, not a generic process."
    ]
  };

  return [
    "You are an AI diagram assistant built into Locoris, a premium dark-themed local-first knowledge canvas.",
    `${uiLanguage} This is UI context only and must not determine the diagram language.`,
    title,
    canvasBackgroundColor
      ? `Canvas background color: ${canvasBackgroundColor}. Use high-contrast light lines/text and palette choices that look premium on this background.`
      : "Canvas background: dark Locoris canvas. Use high-contrast light lines/text.",
    "",
    isTransformSelection
      ? "Task mode: transform the selected canvas elements only."
      : "Task mode: create a new canvas diagram.",
    isTransformSelection
      ? "- The selected canvas text is the source of truth. Apply the user's request only to that selected content."
      : "- Use the user's description as the source of truth when it is provided.",
    isTransformSelection
      ? "- Preserve the selected content's meaning, scope, and rough structure unless the user explicitly asks to change it."
      : "- Use selected or existing canvas text only when the user description is missing or explicitly refers to it.",
    isTransformSelection
      ? "- If the user asks to translate, translate labels/messages only and keep the same diagram scope."
      : "- Do not continue, reuse, or reinterpret unrelated existing diagrams on the canvas.",
    "",
    "Return rules:",
    "- Return only valid Mermaid syntax.",
    "- Do not wrap the result in Markdown fences.",
    "- Do not add explanations, prefaces, comments, or afterwords.",
    "- Do not reuse older requests, examples, or unrelated canvas content.",
    "- Keep all labels in the same language as the user description or source text, unless the user explicitly asks for another language.",
    "- Preserve detail. Do not compress a rich source into a tiny summary.",
    "- For detailed input, use as many nodes and labeled relationships as needed for a useful canvas, while staying readable.",
    "- For short prompts without source context, create a complete useful draft with sections, examples, and practical details.",
    "- Use Mermaid syntax that converts reliably to Excalidraw: flowchart, sequenceDiagram, classDiagram, stateDiagram, erDiagram, or pie.",
    "- Pie charts may be inserted as a rendered graph image when Mermaid cannot expose editable slice geometry.",
    "- Prefer flowchart subgraphs for mind maps, roadmaps, timelines, kanban boards, semantic islands, and concept maps because native Mermaid mindmap/kanban/timeline syntax may not convert to Excalidraw.",
    "- Avoid HTML labels, Markdown tables inside labels, external images, click directives, custom CSS classes, and unsupported Mermaid plugins.",
    "- Keep node labels readable, but use side nodes and labeled arrows to preserve important names, numbers, states, explanations, and decisions.",
    "- Avoid isolated nodes unless the concept is truly standalone. Every major node should have a meaningful relationship.",
    "- If the source is detailed, preserve its important details as nodes or labeled arrows instead of compressing it into a tiny summary.",
    "- Do not use black or very dark arrow/link colors. Prefer light blue-white lines and readable labels for a dark canvas.",
    "- Avoid explicit Mermaid style/class colors unless needed; if you use them, make borders and text high contrast on the given background.",
    "",
    "Diagram type:",
    ...diagramInstruction[input.kind],
    "",
    description
      ? "User description:"
      : selectedText || canvasText
        ? "No explicit user description was provided. Build the diagram from the available canvas text."
        : "User description:",
    description || "",
    "",
    selectedText ? "Selected canvas text:" : "No selected canvas text.",
    selectedText || "",
    "",
    canvasText ? sourceLabel : "No existing canvas text context.",
    canvasText || ""
  ].join("\n");
}

function buildGeminiCanvasSpecPrompt(input: GenerateGeminiCanvasSpecInput) {
  const uiLanguage = buildAiInterfaceLanguageInstruction(input.appLanguage);
  const title = input.canvasTitle?.trim()
    ? `Canvas title: ${input.canvasTitle.trim()}`
    : "Canvas title: untitled";
  const selectedText = input.selectedText?.trim();
  const sourceText = input.canvasText?.trim();
  const sourceTitle = input.sourceTitle?.trim();
  const canvasBackgroundColor = input.canvasBackgroundColor?.trim();
  const description = input.prompt.trim();
  const sourceKind = input.sourceKind ?? (selectedText ? "selection" : sourceText ? "canvas" : "description");
  const sourceLabel =
    sourceKind === "note"
      ? `Source note${sourceTitle ? ` (${sourceTitle})` : ""} text:`
      : sourceKind === "selection"
        ? "Selected canvas text:"
        : "Canvas/source text:";
  const kindInstruction: Record<CanvasDiagramSpecKind, string> = {
    flowchart:
      "Return FlowchartSpec: use steps[] for ordered cards/decisions/notes, groups[] for phases/swimlanes, and edges[] for labeled control flow. Do not use a generic node pile.",
    mindmap:
      "Return MindMapSpec: use root plus branches[] with nested items. The local renderer will draw a radial mind map, so do not flatten it into flowchart steps.",
    pie:
      "Return PieChartSpec: use center and slices[] with numeric values. This must be a proportional pie/donut chart with legend data, not a flowchart.",
    sequence:
      "Return SequenceSpec: use participants[], messages[], and optional notes[]. This must read as a real interaction diagram with lifelines and many ordered message arrows, not a placeholder.",
    roadmap:
      "Return RoadmapSpec: use phases[] with milestones, risks, actions, owners/statuses, and dependencies[]. This must read as a roadmap with phase lanes.",
    timeline:
      "Return TimelineSpec: use events[] with date/period labels, annotations, causes, and outcomes. This must read chronologically along a timeline axis and must not be represented as generic nodes or steps.",
    concept:
      "Return SemanticIslandsSpec: use islands[] with inner items and links[]. This must read as semantic islands/clusters, not a simple process chart.",
    kanban:
      "Return KanbanSpec: use columns[] with cards[] and optional links[]. This must read as a real kanban board with distinct workflow columns and must not be represented as a generic flowchart."
  };
  const shapeContract: Record<CanvasDiagramSpecKind, string[]> = {
    flowchart: [
      "Required useful fields: steps[] and edges[].",
      "Use type=start/end for boundaries, type=decision for choices, type=risk for blockers, type=note for explanations.",
      "Use tones across the map: primary for the main path, warning for choices/risks, success for outcomes, muted for supporting notes.",
      "For any non-trivial prompt, create 10-26 steps and 12-36 edges. Include branches, side notes, decision diamonds, and converging outcomes like a rich Mermaid flowchart."
    ],
    mindmap: [
      "Required useful fields: root and branches[].",
      "Use 4-8 branches for a rich source. Each branch should have 2-8 nested items when there is enough information.",
      "Use crossLinks[] only for meaningful relationships between branches.",
      "For any non-trivial prompt, make it feel like a Mermaid mind-map flowchart: central idea, large branches, leaf details, and occasional cross-links."
    ],
    pie: [
      "Required useful fields: center and slices[].",
      "Use 4-8 slices. Values must be numeric and proportional. If exact numbers are missing, infer useful relative values that add up naturally.",
      "Give each slice a different tone where appropriate and add body text for interpretation."
    ],
    sequence: [
      "Required useful fields: participants[] and messages[].",
      "Use 2-8 participants and enough ordered messages to explain the interaction. For dialogue/story prompts, use 8-16 concrete messages with actual lines and action beats.",
      "Do not use generic labels like interaction, message, dialogue, request, response, or step unless they are expanded with specific content.",
      "Use kind=return for responses, kind=decision or loop for branches/repetition, and notes[] for side explanations."
    ],
    roadmap: [
      "Required useful fields: phases[].",
      "Use 3-7 phases. Each phase should include milestones[] and may include risks[] and actions[].",
      "Use dependencies[] for cross-phase dependencies, not only sequential arrows.",
      "For any non-trivial prompt, create a phase-lane roadmap with 3-6 milestones per phase, risks, next actions, and cross-phase dependencies like a detailed Mermaid roadmap."
    ],
    timeline: [
      "Required useful fields: events[].",
      "Use 5-16 concrete events when possible. Preserve dates, periods, ordering, causes, and outcomes.",
      "Use group labels when the timeline has parallel tracks.",
      "Do not return only title/kind or generic event names like Event, Step, Phase, or Milestone."
    ],
    concept: [
      "Required useful fields: islands[] and links[].",
      "Use 3-8 islands. Each island should contain items[] with examples, caveats, details, or decisions.",
      "Use links[] for cross-island relationships with explanatory labels.",
      "For any non-trivial prompt, create rich semantic clusters like Mermaid subgraphs: each island needs inner details, examples, caveats, and meaningful cross-links."
    ],
    kanban: [
      "Required useful fields: columns[].",
      "Use 3-6 columns that match the requested workflow. Each column must contain practical cards[].",
      "Use tags on cards only when they help scanning.",
      "Do not return empty columns or generic card names like Task, Item, Todo, or Work."
    ]
  };

  return [
    "You are an AI visual knowledge architect built into Locoris, a premium dark-themed local-first knowledge canvas.",
    `${uiLanguage} This is UI context only and must not determine the output language.`,
    title,
    canvasBackgroundColor
      ? `Canvas background color: ${canvasBackgroundColor}. Choose tones and labels that will look premium, harmonious, and readable on this background.`
      : "Canvas background: dark Locoris canvas. Prefer high-contrast light text/links and dark glass-like cards.",
    "",
    `Return a typed Locoris Canvas JSON object for kind: ${input.kind}.`,
    kindInstruction[input.kind],
    "",
    "Typed schema contract:",
    ...shapeContract[input.kind],
    "- The old generic nodes[] field is only a fallback. Prefer the typed fields listed above for this diagram kind.",
    "- Use varied tones across related items so the local renderer can create a premium multi-color composition.",
    "- Do not force every request into steps/nodes/edges. Use the typed structure that matches the requested kind.",
    "- Treat this JSON mode as an editable native version of the Mermaid mode. Match Mermaid's richness: subgraph-like groups, branching structure, side-note nodes, labeled relationships, examples, caveats, risks, numbers, decisions, and outcomes.",
    "- Do not create tiny diagrams. A tiny diagram is acceptable only if the user explicitly asks for a minimal sketch.",
    "- Prefer a complete, useful, detailed map over a compact summary. The local renderer has room for large diagrams.",
    "",
    "Strict output rules:",
    "- Return only valid JSON matching the schema.",
    "- Do not wrap the JSON in Markdown fences.",
    "- Do not add comments, explanations, or prose outside JSON.",
    "- Preserve the source language unless the user explicitly asks for another language.",
    "- Preserve important names, steps, dates, states, dependencies, risks, examples, numbers, and decisions.",
    "- Do not over-compress the source. For detailed notes, create a rich result with enough typed items to preserve meaning.",
    "- For short prompts without source context, still create a complete useful draft with practical details.",
    "- Use concise labels and meaningful body/summary/note text for details, caveats, examples, and decisions.",
    "- Labels should be short scan targets, ideally 2-8 words. Put long explanations into body, summary, note, risks, actions, or tags.",
    "- Avoid extremely long unbroken words in labels. If a technical identifier is long, keep it in body and use a readable short label.",
    "- Arrow/message/link labels must be short relationship phrases, not full sentences. Put extra explanation into notes or body fields.",
    "- Use links/edges/dependencies/messages for real relationships, causes, contrasts, sequence, and next steps.",
    "- Avoid disconnected piles of cards. The structure should be obvious when rendered visually.",
    input.kind === "sequence"
      ? "- Sequence-specific validation: participants without at least 4 concrete messages is invalid. For creative dialogue, include actual spoken lines and action beats as message labels."
      : "",
    input.kind === "timeline"
      ? "- Timeline-specific validation: events[] with at least 4 concrete, ordered events is required. If the prompt is short, invent a useful draft timeline from the described topic."
      : "",
    input.kind === "kanban"
      ? "- Kanban-specific validation: columns[] with non-empty cards[] is required. If the prompt is short, invent a useful board with realistic workflow columns and cards."
      : "",
    "- Use tones deliberately: primary/accent for key items, muted for context, success for outcomes, warning/danger for risks/problems.",
    "- Pick layout.direction deliberately: radial for mindmap/pie, leftRight for maps/roadmaps, topDown for flowcharts/sequences, timeline for time, kanban for boards.",
    "- Pick layout.density 'airy' for complex maps so the local renderer gives it enough space.",
    "- Match the requested kind exactly. Pie must be pie. Roadmap must be roadmap. Mind map must be mind map.",
    "- Never reuse unrelated canvas content or older requests.",
    "",
    description ? "User request:" : "No explicit user request.",
    description || "",
    "",
    selectedText ? "Selected canvas text:" : "No selected canvas text.",
    selectedText || "",
    "",
    sourceText ? sourceLabel : "No source text.",
    sourceText || ""
  ].join("\n");
}

function extractGeminiText(payload: GeminiGenerateResponse) {
  if (payload.error) {
    throw new Error(payload.error.message || payload.error.status || "GEMINI_REQUEST_FAILED");
  }

  const text =
    payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim() ?? "";

  if (!text) {
    throw new Error(payload.candidates?.[0]?.finishReason || "GEMINI_EMPTY_RESPONSE");
  }

  return cleanGeminiMarkdown(text);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function shouldRetryStructuredRequest(error: unknown) {
  const message = getErrorMessage(error);

  return !/api key|unauthenticated|permission_denied|resource_exhausted|quota|not found|not supported|unsupported|model/i.test(
    message
  );
}

function toGeminiResponseSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toGeminiResponseSchema);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => {
      if (key === "type" && typeof entryValue === "string") {
        return [key, entryValue.toUpperCase()];
      }

      return [key, toGeminiResponseSchema(entryValue)];
    })
  );
}

function buildStructuredGenerationConfigs(input: GenerateGeminiStructuredEditInput): GeminiGenerationConfig[] {
  const temperature =
    input.action === "beautify"
      ? 0.52
      : input.action === "custom"
        ? 0.42
        : 0.15;
  const baseConfig = {
    temperature,
    maxOutputTokens: 8192
  };

  return [
    {
      ...baseConfig,
      responseFormat: {
        text: {
          mimeType: "application/json",
          schema: AI_EDITOR_STRUCTURED_OUTPUT_SCHEMA
        }
      }
    },
    {
      ...baseConfig,
      responseMimeType: "application/json",
      responseJsonSchema: AI_EDITOR_STRUCTURED_OUTPUT_SCHEMA
    },
    {
      ...baseConfig,
      responseMimeType: "application/json",
      responseSchema: toGeminiResponseSchema(AI_EDITOR_STRUCTURED_OUTPUT_SCHEMA)
    }
  ];
}

async function requestGeminiGeneratedText(input: {
  apiKey: string;
  model: string;
  prompt: string;
  generationConfig: GeminiGenerationConfig;
}) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: input.prompt
              }
            ]
          }
        ],
        generationConfig: input.generationConfig
      })
    }
  );

  const payload = (await response.json().catch(() => ({}))) as GeminiGenerateResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message || `GEMINI_HTTP_${response.status}`);
  }

  return extractGeminiText(payload);
}

function buildCanvasSpecGenerationConfigs(kind: CanvasDiagramSpecKind): GeminiGenerationConfig[] {
  const schema = buildCanvasDiagramSpecSchema(kind);
  const temperature =
    kind === "sequence"
      ? 0.48
      : kind === "timeline" || kind === "kanban"
        ? 0.46
      : kind === "mindmap" || kind === "concept" || kind === "pie" || kind === "roadmap"
        ? 0.46
        : 0.42;
  const baseConfig = {
    temperature,
    maxOutputTokens: 24576
  };

  return [
    {
      ...baseConfig,
      responseFormat: {
        text: {
          mimeType: "application/json",
          schema
        }
      }
    },
    {
      ...baseConfig,
      responseMimeType: "application/json",
      responseJsonSchema: schema
    },
    {
      ...baseConfig,
      responseMimeType: "application/json",
      responseSchema: toGeminiResponseSchema(schema)
    },
    baseConfig
  ];
}

function asCanvasDiagramSpecKind(value: unknown, fallback: CanvasDiagramSpecKind): CanvasDiagramSpecKind {
  return value === "flowchart" ||
    value === "mindmap" ||
    value === "pie" ||
    value === "sequence" ||
    value === "roadmap" ||
    value === "timeline" ||
    value === "concept" ||
    value === "kanban"
    ? value
    : fallback;
}

function toCanvasSpecText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeCanvasSpecReferenceKey(value: unknown) {
  return toCanvasSpecText(value, 140).toLowerCase();
}

function isGenericCanvasSequenceMessageLabel(label: string) {
  return /^(interaction|message|dialogue|dialog|request|response|step|action|event|exchange|communication)$/i.test(
    label.trim()
  );
}

function isGenericCanvasTimelineEventLabel(label: string) {
  return /^(event|step|milestone|phase|period|date|time|item|point|action)$/i.test(label.trim());
}

function isGenericCanvasKanbanCardLabel(label: string) {
  return /^(card|task|item|todo|to do|work|action|step|issue)$/i.test(label.trim());
}

function toCanvasSpecNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(",", ".").replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function asCanvasDiagramTone(value: unknown): CanvasDiagramTone | undefined {
  return value === "primary" ||
    value === "accent" ||
    value === "muted" ||
    value === "success" ||
    value === "warning" ||
    value === "danger"
    ? value
    : undefined;
}

function asCanvasDiagramShape(value: unknown): CanvasDiagramNode["shape"] {
  return value === "diamond" || value === "ellipse" ? value : "rectangle";
}

function makeCanvasSpecId(rawValue: unknown, fallback: string, seenIds: Set<string>) {
  const rawId = toCanvasSpecText(rawValue, 64) || fallback;
  let id = rawId;
  let suffix = 2;

  while (seenIds.has(id)) {
    id = `${rawId}-${suffix}`;
    suffix += 1;
  }

  seenIds.add(id);
  return id;
}

function normalizeCanvasDiagramNodes(value: unknown, maxItems = 140): CanvasDiagramNode[] {
  const seenIds = new Set<string>();
  const nodes: CanvasDiagramNode[] = [];

  (Array.isArray(value) ? value : []).forEach((nodeInput, index) => {
    if (!nodeInput || typeof nodeInput !== "object" || nodes.length >= maxItems) {
      return;
    }

    const nodeRecord = nodeInput as Record<string, unknown>;
    const label = toCanvasSpecText(nodeRecord.label, 140);

    if (!label) {
      return;
    }

    nodes.push({
      id: makeCanvasSpecId(nodeRecord.id, `node-${index + 1}`, seenIds),
      label,
      body: toCanvasSpecText(nodeRecord.body, 720) || undefined,
      level:
        typeof nodeRecord.level === "number" && Number.isFinite(nodeRecord.level)
          ? Math.max(0, Math.min(8, Math.round(nodeRecord.level)))
          : undefined,
      groupId: toCanvasSpecText(nodeRecord.groupId, 64) || undefined,
      tone: asCanvasDiagramTone(nodeRecord.tone),
      shape: asCanvasDiagramShape(nodeRecord.shape)
    });
  });

  return nodes;
}

function normalizeCanvasDiagramGroups(
  value: unknown,
  validItemIds = new Set<string>(),
  maxItems = 32
): NonNullable<CanvasDiagramBaseSpec["groups"]> {
  const seenIds = new Set<string>();
  const groups: NonNullable<CanvasDiagramBaseSpec["groups"]> = [];

  (Array.isArray(value) ? value : []).forEach((groupInput, index) => {
    if (!groupInput || typeof groupInput !== "object" || groups.length >= maxItems) {
      return;
    }

    const groupRecord = groupInput as Record<string, unknown>;
    const title = toCanvasSpecText(groupRecord.title, 120);

    if (!title) {
      return;
    }

    const id = makeCanvasSpecId(groupRecord.id, `group-${index + 1}`, seenIds);

    groups.push({
      id,
      title,
      nodeIds: Array.isArray(groupRecord.nodeIds)
        ? groupRecord.nodeIds
            .map((nodeId) => toCanvasSpecText(nodeId, 64))
            .filter((nodeId) => !validItemIds.size || validItemIds.has(nodeId))
        : undefined
    });
  });

  return groups;
}

function normalizeCanvasDiagramEdges(
  value: unknown,
  validIds: Set<string>,
  maxItems = 260
): CanvasDiagramEdge[] {
  const edges: CanvasDiagramEdge[] = [];

  (Array.isArray(value) ? value : []).forEach((edgeInput) => {
    if (!edgeInput || typeof edgeInput !== "object" || edges.length >= maxItems) {
      return;
    }

    const edgeRecord = edgeInput as Record<string, unknown>;
    const from = toCanvasSpecText(edgeRecord.from, 64);
    const to = toCanvasSpecText(edgeRecord.to, 64);

    if (!validIds.has(from) || !validIds.has(to) || from === to) {
      return;
    }

    edges.push({
      from,
      to,
      label: toCanvasSpecText(edgeRecord.label, 140) || undefined,
      tone: asCanvasDiagramTone(edgeRecord.tone)
    });
  });

  return edges;
}

function normalizeCanvasSpecBase(
  record: Record<string, unknown>,
  fallbackKind: CanvasDiagramSpecKind
): Omit<CanvasDiagramBaseSpec, "kind"> & {
  kind: CanvasDiagramSpecKind;
  nodes: CanvasDiagramNode[];
  groups: NonNullable<CanvasDiagramBaseSpec["groups"]>;
  edges: CanvasDiagramEdge[];
} {
  const layoutRecord = record.layout && typeof record.layout === "object"
    ? (record.layout as Record<string, unknown>)
    : {};
  const direction = layoutRecord.direction;
  const density = layoutRecord.density;
  const nodes = normalizeCanvasDiagramNodes(record.nodes);
  const nodeIds = new Set(nodes.map((node) => node.id));

  return {
    title: toCanvasSpecText(record.title, 100) || undefined,
    kind: fallbackKind,
    summary: toCanvasSpecText(record.summary, 420) || undefined,
    layout: {
      direction:
        direction === "radial" ||
        direction === "leftRight" ||
        direction === "topDown" ||
        direction === "timeline" ||
        direction === "kanban"
          ? direction
          : undefined,
      density: density === "compact" || density === "airy" ? density : "normal"
    },
    nodes,
    groups: normalizeCanvasDiagramGroups(record.groups, nodeIds),
    edges: normalizeCanvasDiagramEdges(record.edges, nodeIds)
  };
}

function normalizeCanvasFlowchartSpec(
  record: Record<string, unknown>,
  base: ReturnType<typeof normalizeCanvasSpecBase>
): CanvasFlowchartSpec {
  const seenIds = new Set<string>();
  const steps = (Array.isArray(record.steps) ? record.steps : [])
    .map((stepInput, index) => {
      if (!stepInput || typeof stepInput !== "object") {
        return null;
      }

      const stepRecord = stepInput as Record<string, unknown>;
      const label = toCanvasSpecText(stepRecord.label, 140);

      if (!label) {
        return null;
      }

      const stepType = stepRecord.type;

      return {
        id: makeCanvasSpecId(stepRecord.id, `step-${index + 1}`, seenIds),
        label,
        body: toCanvasSpecText(stepRecord.body, 720) || undefined,
        type:
          stepType === "start" ||
          stepType === "process" ||
          stepType === "decision" ||
          stepType === "data" ||
          stepType === "note" ||
          stepType === "end" ||
          stepType === "risk"
            ? stepType
            : undefined,
        groupId: toCanvasSpecText(stepRecord.groupId, 64) || undefined,
        tone: asCanvasDiagramTone(stepRecord.tone)
      };
    })
    .filter(Boolean)
    .slice(0, 120) as CanvasFlowchartSpec["steps"];
  const fallbackSteps = base.nodes.map((node) => ({
    id: makeCanvasSpecId(node.id, node.id, seenIds),
    label: node.label,
    body: node.body,
    type: node.shape === "diamond" ? ("decision" as const) : undefined,
    groupId: node.groupId,
    tone: node.tone
  }));
  const resolvedSteps = steps.length ? steps : fallbackSteps;

  if (!resolvedSteps.length) {
    throw new Error("CANVAS_SPEC_EMPTY");
  }

  const stepIds = new Set(resolvedSteps.map((step) => step.id));
  const explicitEdges = normalizeCanvasDiagramEdges(record.edges, stepIds);
  const fallbackEdges = resolvedSteps.slice(1).map((step, index) => ({
    from: resolvedSteps[index].id,
    to: step.id
  }));

  return {
    ...base,
    kind: "flowchart",
    steps: resolvedSteps,
    groups: normalizeCanvasDiagramGroups(record.groups, stepIds),
    edges: explicitEdges.length ? explicitEdges : fallbackEdges
  };
}

function normalizeCanvasMindMapSpec(
  record: Record<string, unknown>,
  base: ReturnType<typeof normalizeCanvasSpecBase>
): CanvasMindMapSpec {
  const rootRecord = record.root && typeof record.root === "object"
    ? (record.root as Record<string, unknown>)
    : {};
  const fallbackRoot = base.nodes.find((node) => node.level === 0) ?? base.nodes[0];
  const root = {
    label:
      toCanvasSpecText(rootRecord.label, 140) ||
      fallbackRoot?.label ||
      base.title ||
      "Mind map",
    body: toCanvasSpecText(rootRecord.body, 720) || fallbackRoot?.body || undefined,
    tone: asCanvasDiagramTone(rootRecord.tone) ?? fallbackRoot?.tone
  };
  const seenIds = new Set<string>();
  const normalizeBranchItems = (
    itemsInput: unknown,
    prefix: string,
    depth = 0
  ): NonNullable<CanvasMindMapSpec["branches"][number]["items"]> =>
    ((Array.isArray(itemsInput) ? itemsInput : [])
      .map((itemInput, index) => {
        if (!itemInput || typeof itemInput !== "object") {
          return null;
        }

        const itemRecord = itemInput as Record<string, unknown>;
        const label = toCanvasSpecText(itemRecord.label, 140);

        if (!label) {
          return null;
        }

        return {
          id: makeCanvasSpecId(itemRecord.id, `${prefix}-item-${index + 1}`, seenIds),
          label,
          body: toCanvasSpecText(itemRecord.body, depth > 0 ? 520 : 720) || undefined,
          tone: asCanvasDiagramTone(itemRecord.tone),
          items: depth === 0 ? normalizeBranchItems(itemRecord.items, `${prefix}-${index + 1}`, depth + 1) : undefined
        };
      })
      .filter(Boolean)
      .slice(0, depth === 0 ? 18 : 12) as NonNullable<CanvasMindMapSpec["branches"][number]["items"]>);
  const branches = (Array.isArray(record.branches) ? record.branches : [])
    .map((branchInput, index) => {
      if (!branchInput || typeof branchInput !== "object") {
        return null;
      }

      const branchRecord = branchInput as Record<string, unknown>;
      const label = toCanvasSpecText(branchRecord.label, 140);

      if (!label) {
        return null;
      }

      return {
        id: makeCanvasSpecId(branchRecord.id, `branch-${index + 1}`, seenIds),
        label,
        body: toCanvasSpecText(branchRecord.body, 720) || undefined,
        tone: asCanvasDiagramTone(branchRecord.tone),
        items: normalizeBranchItems(branchRecord.items, `branch-${index + 1}`)
      };
    })
    .filter(Boolean)
    .slice(0, 18) as CanvasMindMapSpec["branches"];
  const fallbackBranches = base.nodes
    .filter((node) => node.id !== fallbackRoot?.id)
    .slice(0, 24)
    .map((node) => ({
      id: makeCanvasSpecId(node.id, node.id, seenIds),
      label: node.label,
      body: node.body,
      tone: node.tone,
      items: []
    }));
  const resolvedBranches = branches.length ? branches : fallbackBranches;

  if (!resolvedBranches.length) {
    throw new Error("CANVAS_SPEC_EMPTY");
  }

  const ids = new Set<string>([
    "root",
    ...resolvedBranches.flatMap((branch) => [
      branch.id,
      ...(branch.items ?? []).flatMap((item) => [item.id, ...((item.items ?? []).map((child) => child.id))])
    ])
  ]);

  return {
    ...base,
    kind: "mindmap",
    root,
    branches: resolvedBranches,
    crossLinks: normalizeCanvasDiagramEdges(record.crossLinks, ids, 80)
  };
}

function normalizeCanvasPieChartSpec(
  record: Record<string, unknown>,
  base: ReturnType<typeof normalizeCanvasSpecBase>
): CanvasPieChartSpec {
  const centerRecord = record.center && typeof record.center === "object"
    ? (record.center as Record<string, unknown>)
    : {};
  const rootNode = base.nodes.find((node) => node.level === 0) ?? base.nodes[0];
  const center = {
    label: toCanvasSpecText(centerRecord.label, 140) || base.title || rootNode?.label || "Distribution",
    body: toCanvasSpecText(centerRecord.body, 520) || base.summary || undefined
  };
  const seenIds = new Set<string>();
  const slices = (Array.isArray(record.slices) ? record.slices : [])
    .map((sliceInput, index) => {
      if (!sliceInput || typeof sliceInput !== "object") {
        return null;
      }

      const sliceRecord = sliceInput as Record<string, unknown>;
      const label = toCanvasSpecText(sliceRecord.label, 120);
      const value = toCanvasSpecNumber(sliceRecord.value, 0);

      if (!label || value <= 0) {
        return null;
      }

      return {
        id: makeCanvasSpecId(sliceRecord.id, `slice-${index + 1}`, seenIds),
        label,
        value,
        body: toCanvasSpecText(sliceRecord.body, 420) || undefined,
        tone: asCanvasDiagramTone(sliceRecord.tone)
      };
    })
    .filter(Boolean)
    .slice(0, 12) as CanvasPieChartSpec["slices"];
  const fallbackSlices = base.nodes
    .filter((node) => node.id !== rootNode?.id)
    .slice(0, 8)
    .map((node, index) => ({
      id: makeCanvasSpecId(node.id, `slice-${index + 1}`, seenIds),
      label: node.label,
      value: toCanvasSpecNumber(node.body, 1) || 1,
      body: node.body,
      tone: node.tone
    }));
  const resolvedSlices = slices.length ? slices : fallbackSlices;

  if (resolvedSlices.length < 2) {
    throw new Error("CANVAS_SPEC_EMPTY");
  }

  return {
    ...base,
    kind: "pie",
    center,
    slices: resolvedSlices
  };
}

function normalizeCanvasSequenceSpec(
  record: Record<string, unknown>,
  base: ReturnType<typeof normalizeCanvasSpecBase>
): CanvasSequenceSpec {
  const seenParticipantIds = new Set<string>();
  const participants = (Array.isArray(record.participants) ? record.participants : [])
    .map((participantInput, index) => {
      if (!participantInput || typeof participantInput !== "object") {
        return null;
      }

      const participantRecord = participantInput as Record<string, unknown>;
      const label = toCanvasSpecText(participantRecord.label, 120);

      if (!label) {
        return null;
      }

      return {
        id: makeCanvasSpecId(participantRecord.id, `actor-${index + 1}`, seenParticipantIds),
        label,
        role: toCanvasSpecText(participantRecord.role, 160) || undefined,
        tone: asCanvasDiagramTone(participantRecord.tone)
      };
    })
    .filter(Boolean)
    .slice(0, 16) as CanvasSequenceSpec["participants"];
  const messagesInput = Array.isArray(record.messages) ? record.messages : [];
  const inferredParticipantIds = new Set<string>();

  messagesInput.forEach((messageInput) => {
    if (!messageInput || typeof messageInput !== "object") {
      return;
    }

    const messageRecord = messageInput as Record<string, unknown>;
    const from = toCanvasSpecText(messageRecord.from, 64);
    const to = toCanvasSpecText(messageRecord.to, 64);

    if (from) {
      inferredParticipantIds.add(from);
    }

    if (to) {
      inferredParticipantIds.add(to);
    }
  });

  if (!participants.length) {
    Array.from(inferredParticipantIds).slice(0, 8).forEach((id) => {
      participants.push({
        id: makeCanvasSpecId(id, id, seenParticipantIds),
        label: id
      });
    });
  }

  if (participants.length < 2 && base.nodes.length >= 2) {
    base.nodes.slice(0, 4).forEach((node) => {
      participants.push({
        id: makeCanvasSpecId(node.id, node.id, seenParticipantIds),
        label: node.label,
        role: node.body,
        tone: node.tone
      });
    });
  }

  const participantIds = new Set(participants.map((participant) => participant.id));
  const participantReferenceMap = new Map<string, string>();

  participants.forEach((participant) => {
    [
      participant.id,
      participant.label,
      participant.role
    ].forEach((value) => {
      const key = normalizeCanvasSpecReferenceKey(value);

      if (key && !participantReferenceMap.has(key)) {
        participantReferenceMap.set(key, participant.id);
      }
    });
  });
  const resolveParticipantId = (value: unknown) => {
    const raw = toCanvasSpecText(value, 64);

    if (participantIds.has(raw)) {
      return raw;
    }

    return participantReferenceMap.get(normalizeCanvasSpecReferenceKey(raw)) ?? "";
  };
  const messages = messagesInput
    .map((messageInput) => {
      if (!messageInput || typeof messageInput !== "object") {
        return null;
      }

      const messageRecord = messageInput as Record<string, unknown>;
      const from = resolveParticipantId(messageRecord.from);
      const to = resolveParticipantId(messageRecord.to);
      const label = toCanvasSpecText(messageRecord.label, 180);
      const messageKind = messageRecord.kind;

      if (!from || !to || !label) {
        return null;
      }

      return {
        from,
        to,
        label,
        note: toCanvasSpecText(messageRecord.note, 420) || undefined,
        kind:
          messageKind === "sync" ||
          messageKind === "async" ||
          messageKind === "return" ||
          messageKind === "decision" ||
          messageKind === "loop"
            ? messageKind
            : undefined,
        tone: asCanvasDiagramTone(messageRecord.tone)
      };
    })
    .filter(Boolean)
    .slice(0, 180) as CanvasSequenceSpec["messages"];
  const notes = (Array.isArray(record.notes) ? record.notes : [])
    .map((noteInput) => {
      if (!noteInput || typeof noteInput !== "object") {
        return null;
      }

      const noteRecord = noteInput as Record<string, unknown>;
      const label = toCanvasSpecText(noteRecord.label, 160);

      if (!label) {
        return null;
      }

      const participantId = toCanvasSpecText(noteRecord.participantId, 64);

      return {
        label,
        body: toCanvasSpecText(noteRecord.body, 420) || undefined,
        participantId: participantIds.has(participantId) ? participantId : undefined,
        at:
          typeof noteRecord.at === "number" && Number.isFinite(noteRecord.at)
            ? Math.max(0, Math.min(200, Math.round(noteRecord.at)))
            : undefined,
        tone: asCanvasDiagramTone(noteRecord.tone)
      };
    })
    .filter(Boolean)
    .slice(0, 40) as CanvasSequenceSpec["notes"];

  if (
    participants.length < 2 ||
    messages.length === 0 ||
    messages.length < 3 ||
    messages.every((message) => isGenericCanvasSequenceMessageLabel(message.label))
  ) {
    throw new Error("CANVAS_SPEC_EMPTY");
  }

  return {
    ...base,
    kind: "sequence",
    participants,
    messages,
    notes
  };
}

function normalizeCanvasRoadmapSpec(
  record: Record<string, unknown>,
  base: ReturnType<typeof normalizeCanvasSpecBase>
): CanvasRoadmapSpec {
  const seenPhaseIds = new Set<string>();
  const phases = (Array.isArray(record.phases) ? record.phases : [])
    .map((phaseInput, phaseIndex) => {
      if (!phaseInput || typeof phaseInput !== "object") {
        return null;
      }

      const phaseRecord = phaseInput as Record<string, unknown>;
      const title = toCanvasSpecText(phaseRecord.title, 120);

      if (!title) {
        return null;
      }

      const seenMilestoneIds = new Set<string>();
      const milestones = (Array.isArray(phaseRecord.milestones) ? phaseRecord.milestones : [])
        .map((milestoneInput, milestoneIndex) => {
          if (!milestoneInput || typeof milestoneInput !== "object") {
            return null;
          }

          const milestoneRecord = milestoneInput as Record<string, unknown>;
          const label = toCanvasSpecText(milestoneRecord.label, 140);
          const status = milestoneRecord.status;

          if (!label) {
            return null;
          }

          return {
            id: makeCanvasSpecId(milestoneRecord.id, `m-${phaseIndex + 1}-${milestoneIndex + 1}`, seenMilestoneIds),
            label,
            body: toCanvasSpecText(milestoneRecord.body, 520) || undefined,
            status:
              status === "planned" || status === "active" || status === "done" || status === "risk"
                ? status
                : undefined,
            owner: toCanvasSpecText(milestoneRecord.owner, 120) || undefined,
            tone: asCanvasDiagramTone(milestoneRecord.tone)
          };
        })
        .filter(Boolean)
        .slice(0, 18);

      return {
        id: makeCanvasSpecId(phaseRecord.id, `phase-${phaseIndex + 1}`, seenPhaseIds),
        title,
        timeframe: toCanvasSpecText(phaseRecord.timeframe, 120) || undefined,
        goal: toCanvasSpecText(phaseRecord.goal, 420) || undefined,
        tone: asCanvasDiagramTone(phaseRecord.tone),
        milestones,
        risks: (Array.isArray(phaseRecord.risks) ? phaseRecord.risks : [])
          .map((risk) => toCanvasSpecText(risk, 180))
          .filter(Boolean)
          .slice(0, 10),
        actions: (Array.isArray(phaseRecord.actions) ? phaseRecord.actions : [])
          .map((action) => toCanvasSpecText(action, 180))
          .filter(Boolean)
          .slice(0, 10)
      };
    })
    .filter(Boolean)
    .slice(0, 16) as CanvasRoadmapSpec["phases"];
  const fallbackPhases = phases.length
    ? phases
    : base.nodes.slice(0, 12).map((node, index) => ({
        id: `phase-${index + 1}`,
        title: node.label,
        goal: node.body,
        tone: node.tone,
        milestones: []
      }));
  const phaseIds = new Set(fallbackPhases.map((phase) => phase.id));

  if (!fallbackPhases.length) {
    throw new Error("CANVAS_SPEC_EMPTY");
  }

  return {
    ...base,
    kind: "roadmap",
    phases: fallbackPhases,
    dependencies: normalizeCanvasDiagramEdges(record.dependencies, phaseIds, 120)
  };
}

function normalizeCanvasTimelineSpec(
  record: Record<string, unknown>,
  base: ReturnType<typeof normalizeCanvasSpecBase>
): CanvasTimelineSpec {
  const seenIds = new Set<string>();
  const events = (Array.isArray(record.events) ? record.events : [])
    .map((eventInput, index) => {
      if (!eventInput || typeof eventInput !== "object") {
        return null;
      }

      const eventRecord = eventInput as Record<string, unknown>;
      const label = toCanvasSpecText(eventRecord.label, 140);

      if (!label) {
        return null;
      }

      return {
        id: makeCanvasSpecId(eventRecord.id, `event-${index + 1}`, seenIds),
        date: toCanvasSpecText(eventRecord.date, 120) || undefined,
        label,
        body: toCanvasSpecText(eventRecord.body, 520) || undefined,
        group: toCanvasSpecText(eventRecord.group, 120) || undefined,
        tone: asCanvasDiagramTone(eventRecord.tone)
      };
    })
    .filter(Boolean)
    .slice(0, 120) as CanvasTimelineSpec["events"];
  const stepEvents = (Array.isArray(record.steps) ? record.steps : [])
    .map((stepInput, index) => {
      if (!stepInput || typeof stepInput !== "object") {
        return null;
      }

      const stepRecord = stepInput as Record<string, unknown>;
      const label = toCanvasSpecText(stepRecord.label, 140);

      if (!label) {
        return null;
      }

      return {
        id: makeCanvasSpecId(stepRecord.id, `event-${index + 1}`, seenIds),
        date:
          toCanvasSpecText(stepRecord.date, 120) ||
          toCanvasSpecText(stepRecord.timeframe, 120) ||
          toCanvasSpecText(stepRecord.period, 120) ||
          undefined,
        label,
        body: toCanvasSpecText(stepRecord.body, 520) || undefined,
        group:
          toCanvasSpecText(stepRecord.group, 120) ||
          toCanvasSpecText(stepRecord.groupId, 120) ||
          undefined,
        tone: asCanvasDiagramTone(stepRecord.tone)
      };
    })
    .filter(Boolean)
    .slice(0, 120) as CanvasTimelineSpec["events"];
  const fallbackEvents = events.length
    ? events
    : stepEvents.length
      ? stepEvents
      : base.nodes.slice(0, 24).map((node, index) => ({
          id: makeCanvasSpecId(node.id, `event-${index + 1}`, seenIds),
          label: node.label,
          body: node.body,
          group: node.groupId,
          tone: node.tone
        }));

  if (!fallbackEvents.length || fallbackEvents.every((event) => isGenericCanvasTimelineEventLabel(event.label))) {
    throw new Error("CANVAS_SPEC_EMPTY");
  }

  return {
    ...base,
    kind: "timeline",
    events: fallbackEvents
  };
}

function normalizeCanvasKanbanSpec(
  record: Record<string, unknown>,
  base: ReturnType<typeof normalizeCanvasSpecBase>
): CanvasKanbanSpec {
  const seenColumnIds = new Set<string>();
  const seenCardIds = new Set<string>();
  const columns = (Array.isArray(record.columns) ? record.columns : [])
    .map((columnInput, columnIndex) => {
      if (!columnInput || typeof columnInput !== "object") {
        return null;
      }

      const columnRecord = columnInput as Record<string, unknown>;
      const title = toCanvasSpecText(columnRecord.title, 120);

      if (!title) {
        return null;
      }

      const cards = (Array.isArray(columnRecord.cards) ? columnRecord.cards : [])
        .map((cardInput, cardIndex) => {
          if (!cardInput || typeof cardInput !== "object") {
            return null;
          }

          const cardRecord = cardInput as Record<string, unknown>;
          const label = toCanvasSpecText(cardRecord.label, 140);

          if (!label) {
            return null;
          }

          return {
            id: makeCanvasSpecId(cardRecord.id, `card-${columnIndex + 1}-${cardIndex + 1}`, seenCardIds),
            label,
            body: toCanvasSpecText(cardRecord.body, 520) || undefined,
            tone: asCanvasDiagramTone(cardRecord.tone),
            tags: (Array.isArray(cardRecord.tags) ? cardRecord.tags : [])
              .map((tag) => toCanvasSpecText(tag, 40))
              .filter(Boolean)
              .slice(0, 6)
          };
        })
        .filter(Boolean)
        .slice(0, 24);

      return {
        id: makeCanvasSpecId(columnRecord.id, `column-${columnIndex + 1}`, seenColumnIds),
        title,
        summary: toCanvasSpecText(columnRecord.summary, 360) || undefined,
        tone: asCanvasDiagramTone(columnRecord.tone),
        cards
      };
    })
    .filter(Boolean)
    .slice(0, 12) as CanvasKanbanSpec["columns"];
  type CanvasKanbanCard = NonNullable<CanvasKanbanSpec["columns"][number]["cards"]>[number];
  const distributeKanbanCards = (cards: CanvasKanbanCard[]) => {
    const columnTitles = ["Backlog", "In progress", "Done"];
    const columnCount = Math.min(columnTitles.length, Math.max(1, Math.ceil(cards.length / 4)));

    return columnTitles.slice(0, columnCount).map((title, columnIndex) => ({
      id: `fallback-column-${columnIndex + 1}`,
      title,
      cards: cards.filter((_, cardIndex) => cardIndex % columnCount === columnIndex)
    }));
  };
  const stepCards = (Array.isArray(record.steps) ? record.steps : [])
    .map((stepInput, index) => {
      if (!stepInput || typeof stepInput !== "object") {
        return null;
      }

      const stepRecord = stepInput as Record<string, unknown>;
      const label = toCanvasSpecText(stepRecord.label, 140);

      if (!label) {
        return null;
      }

      return {
        id: makeCanvasSpecId(stepRecord.id, `card-${index + 1}`, seenCardIds),
        label,
        body: toCanvasSpecText(stepRecord.body, 520) || undefined,
        tone: asCanvasDiagramTone(stepRecord.tone),
        tags: []
      };
    })
    .filter(Boolean)
    .slice(0, 24) as CanvasKanbanCard[];
  const baseCards = base.nodes.slice(0, 36).map((node) => ({
    id: node.id,
    label: node.label,
    body: node.body,
    tone: node.tone,
    tags: []
  }));
  const groupedNodeIds = new Set<string>();
  const baseGroupColumns = base.groups
    .map((group) => {
      const cards = base.nodes
        .filter((node) => node.groupId === group.id || group.nodeIds?.includes(node.id))
        .map((node) => {
          groupedNodeIds.add(node.id);

          return {
            id: node.id,
            label: node.label,
            body: node.body,
            tone: node.tone,
            tags: []
          };
        });

      return {
        id: group.id,
        title: group.title,
        cards
      };
    })
    .filter((column) => column.cards.length);
  const ungroupedBaseCards = base.nodes
    .filter((node) => !groupedNodeIds.has(node.id))
    .map((node) => ({
      id: node.id,
      label: node.label,
      body: node.body,
      tone: node.tone,
      tags: []
    }));
  const baseColumns = baseGroupColumns.length
    ? [
        ...baseGroupColumns,
        ...(ungroupedBaseCards.length
          ? [
              {
                id: "fallback-items",
                title: base.title || "Items",
                cards: ungroupedBaseCards
              }
            ]
          : [])
      ]
    : distributeKanbanCards(baseCards);
  const fallbackColumns = columns.length
    ? columns
    : stepCards.length
      ? distributeKanbanCards(stepCards)
      : baseColumns;
  const columnIds = new Set(fallbackColumns.map((column) => column.id));
  const cardIds = new Set(fallbackColumns.flatMap((column) => column.cards?.map((card) => card.id) ?? []));
  const linkIds = new Set([...columnIds, ...cardIds]);
  const cards = fallbackColumns.flatMap((column) => column.cards ?? []);

  if (
    !fallbackColumns.length ||
    !cards.length ||
    cards.every((card) => isGenericCanvasKanbanCardLabel(card.label))
  ) {
    throw new Error("CANVAS_SPEC_EMPTY");
  }

  return {
    ...base,
    kind: "kanban",
    columns: fallbackColumns,
    links: normalizeCanvasDiagramEdges(record.links ?? record.edges, linkIds, 120)
  };
}

function normalizeCanvasSemanticIslandsSpec(
  record: Record<string, unknown>,
  base: ReturnType<typeof normalizeCanvasSpecBase>
): CanvasSemanticIslandsSpec {
  const seenIslandIds = new Set<string>();
  const islands = (Array.isArray(record.islands) ? record.islands : [])
    .map((islandInput, islandIndex) => {
      if (!islandInput || typeof islandInput !== "object") {
        return null;
      }

      const islandRecord = islandInput as Record<string, unknown>;
      const title = toCanvasSpecText(islandRecord.title, 120);

      if (!title) {
        return null;
      }

      const seenItemIds = new Set<string>();
      const items = (Array.isArray(islandRecord.items) ? islandRecord.items : [])
        .map((itemInput, itemIndex) => {
          if (!itemInput || typeof itemInput !== "object") {
            return null;
          }

          const itemRecord = itemInput as Record<string, unknown>;
          const label = toCanvasSpecText(itemRecord.label, 140);

          if (!label) {
            return null;
          }

          return {
            id: makeCanvasSpecId(itemRecord.id, `item-${islandIndex + 1}-${itemIndex + 1}`, seenItemIds),
            label,
            body: toCanvasSpecText(itemRecord.body, 520) || undefined,
            tone: asCanvasDiagramTone(itemRecord.tone)
          };
        })
        .filter(Boolean)
        .slice(0, 18);

      return {
        id: makeCanvasSpecId(islandRecord.id, `island-${islandIndex + 1}`, seenIslandIds),
        title,
        summary: toCanvasSpecText(islandRecord.summary, 420) || undefined,
        tone: asCanvasDiagramTone(islandRecord.tone),
        items
      };
    })
    .filter(Boolean)
    .slice(0, 18) as CanvasSemanticIslandsSpec["islands"];
  const fallbackIslands = islands.length
    ? islands
    : (base.groups.length ? base.groups : [{ id: "main", title: base.title || "Concepts" }]).map((group) => ({
        id: group.id,
        title: group.title,
        items: base.nodes
          .filter((node) => node.groupId === group.id || group.nodeIds?.includes(node.id) || base.groups.length === 0)
          .map((node) => ({
            id: node.id,
            label: node.label,
            body: node.body,
            tone: node.tone
          }))
      }));
  const islandIds = new Set(fallbackIslands.map((island) => island.id));

  if (!fallbackIslands.length || fallbackIslands.every((island) => !island.items?.length)) {
    throw new Error("CANVAS_SPEC_EMPTY");
  }

  return {
    ...base,
    kind: "concept",
    islands: fallbackIslands,
    links: normalizeCanvasDiagramEdges(record.links ?? record.edges, islandIds, 120)
  };
}

function normalizeCanvasDiagramSpec(value: unknown, fallbackKind: CanvasDiagramSpecKind): CanvasDiagramSpec {
  if (!value || typeof value !== "object") {
    throw new Error("CANVAS_SPEC_INVALID");
  }

  const record = value as Record<string, unknown>;
  const base = normalizeCanvasSpecBase(record, fallbackKind);

  switch (base.kind) {
    case "flowchart":
      return normalizeCanvasFlowchartSpec(record, base);
    case "mindmap":
      return normalizeCanvasMindMapSpec(record, base);
    case "pie":
      return normalizeCanvasPieChartSpec(record, base);
    case "sequence":
      return normalizeCanvasSequenceSpec(record, base);
    case "roadmap":
      return normalizeCanvasRoadmapSpec(record, base);
    case "timeline":
      return normalizeCanvasTimelineSpec(record, base);
    case "kanban":
      return normalizeCanvasKanbanSpec(record, base);
    case "concept":
    default:
      return normalizeCanvasSemanticIslandsSpec(record, base);
  }
}

export async function generateGeminiMarkdown(input: GenerateGeminiMarkdownInput) {
  const apiKey = input.apiKey.trim();
  const model = resolveModelId(input.model);
  const markdown = input.markdown.trim();

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY_MISSING");
  }

  if (!markdown && !(input.action === "custom" && input.customMode === "generate")) {
    throw new Error("GEMINI_INPUT_EMPTY");
  }

  return requestGeminiGeneratedText({
    apiKey,
    model,
    prompt: buildGeminiPrompt(input),
    generationConfig: {
      temperature: input.action === "beautify" || input.action === "custom" ? 0.45 : 0.2,
      maxOutputTokens: 8192
    }
  });
}

export async function generateGeminiCanvasMermaid(input: GenerateGeminiCanvasMermaidInput) {
  const apiKey = input.apiKey.trim();
  const model = resolveModelId(input.model);
  const prompt = input.prompt.trim();
  const selectedText = input.selectedText?.trim() ?? "";
  const canvasText = input.canvasText?.trim() ?? "";

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY_MISSING");
  }

  if (!prompt && !selectedText && !canvasText) {
    throw new Error("GEMINI_INPUT_EMPTY");
  }

  const mermaid = await requestGeminiGeneratedText({
    apiKey,
    model,
    prompt: buildGeminiCanvasMermaidPrompt(input),
    generationConfig: {
      temperature: input.kind === "mindmap" ? 0.42 : 0.34,
      maxOutputTokens: 16384
    }
  });

  return cleanGeminiMermaid(mermaid);
}

export async function generateGeminiCanvasSpec(input: GenerateGeminiCanvasSpecInput) {
  const apiKey = input.apiKey.trim();
  const model = resolveModelId(input.model);
  const prompt = input.prompt.trim();
  const selectedText = input.selectedText?.trim() ?? "";
  const canvasText = input.canvasText?.trim() ?? "";

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY_MISSING");
  }

  if (!prompt && !selectedText && !canvasText) {
    throw new Error("GEMINI_INPUT_EMPTY");
  }

  const errors: string[] = [];

  for (const generationConfig of buildCanvasSpecGenerationConfigs(input.kind)) {
    try {
      const text = await requestGeminiGeneratedText({
        apiKey,
        model,
        prompt: buildGeminiCanvasSpecPrompt(input),
        generationConfig
      });
      const parsed = JSON.parse(cleanGeminiJson(text)) as unknown;

      return normalizeCanvasDiagramSpec(parsed, input.kind);
    } catch (error) {
      errors.push(getErrorMessage(error));

      if (!shouldRetryStructuredRequest(error)) {
        break;
      }
    }
  }

  throw new Error(errors[0] || "CANVAS_SPEC_FAILED");
}

export async function generateGeminiStructuredEdit(
  input: GenerateGeminiStructuredEditInput
): Promise<AiStructuredEditPayload> {
  const apiKey = input.apiKey.trim();
  const model = resolveModelId(input.model);
  const markdown = input.markdown.trim();

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY_MISSING");
  }

  if (!supportsStructuredEditorOutput(model)) {
    throw new Error("GEMINI_STRUCTURED_UNSUPPORTED");
  }

  if (!markdown && input.editorBlocks.length === 0 && !(input.action === "custom" && input.customMode === "generate")) {
    throw new Error("GEMINI_INPUT_EMPTY");
  }

  const prompt = buildGeminiStructuredPrompt(input);
  const errors: string[] = [];

  for (const generationConfig of buildStructuredGenerationConfigs(input)) {
    try {
      const text = await requestGeminiGeneratedText({
        apiKey,
        model,
        prompt,
        generationConfig
      });

      return JSON.parse(text) as AiStructuredEditPayload;
    } catch (error) {
      errors.push(getErrorMessage(error));

      if (!shouldRetryStructuredRequest(error)) {
        break;
      }
    }
  }

  throw new Error(errors.length > 0 ? `GEMINI_STRUCTURED_FAILED: ${errors.join(" | ")}` : "GEMINI_STRUCTURED_FAILED");
}

export async function testGeminiConnection(apiKey: string, model: string) {
  const result = await generateGeminiMarkdown({
    apiKey,
    model,
    action: "custom",
    scope: "selection",
    markdown: "Locoris",
    appLanguage: "en",
    customPrompt: "Return the word Locoris unchanged."
  });

  return result.trim().length > 0;
}
