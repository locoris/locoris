import { translateInline } from "../localization/translateInline";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { BlockNoteView } from "@blocknote/mantine";
import { FilePanelExtension, FormattingToolbarExtension } from "@blocknote/core/extensions";
import {
  FilePanelController,
  FormattingToolbarController,
  LinkToolbarController,
  useCreateBlockNote
} from "@blocknote/react";
import { TextSelection } from "prosemirror-state";
import { useTranslation } from "react-i18next";

import "./EditorPane.css";
import "./EditorPane.mobile.css";
import ConfirmDialog from "./ConfirmDialog";
import EditorFormattingToolbar from "./EditorFormattingToolbar";
import FolderPicker from "./FolderPicker";
import NoteTransferModal from "./NoteTransferModal";
import NoteStaticPreview from "./NoteStaticPreview";
import {
  usePrivateVaultWarning,
  type PrivateVaultWarningContext
} from "./PrivateVaultWarningDialog";
import TagInputField from "./TagInputField";
import { COLOR_PALETTE, DEFAULT_NOTE_COLOR } from "../lib/palette";
import { isCommitEnterKey } from "../lib/keyboardInput";
import { editorBlockNoteSchema } from "../lib/blocknoteSchema";
import {
  readPersistentString,
  writePersistentString
} from "../lib/persistentClientStorage";
import {
  flattenFolderOptions,
  formatTimestamp,
  extractPlainText,
  normalizeChecklistOrdering,
  normalizeNoteContent,
  seedChecklistStableOrderMap
} from "../lib/notes";
import {
  EDITOR_AI_OPEN_EVENT,
  generateGeminiMarkdown,
  generateGeminiStructuredEdit,
  readGeminiApiKey,
  readStoredGeminiEditorApplyMode,
  readStoredGeminiEditorFormat,
  readStoredGeminiModel,
  type GeminiAiAction,
  type GeminiAiScope,
  type GeminiCustomMode,
  type GeminiEditorFormat
} from "../lib/aiIntegration";
import {
  EDITOR_CREATE_TASK_EVENT,
  normalizePlannerContextTaskTitle,
  type PlannerContextTaskInput
} from "../lib/plannerLinks";
import {
  collectAiContentStats,
  sanitizeAiStructuredEditPayload,
  type AiContentStats
} from "../lib/aiEditorSchema";
import {
  openTextFileWithDialog,
  saveBlobFileWithDialog
} from "../lib/nativeFileIntegration";
import { useAndroidBackHandler } from "../lib/useAndroidBackHandler";
import {
  createNoteDocxBlob,
  createNoteHtmlBlob,
  createNoteMarkdown,
  createNotePdfBlob,
  getNoteExportBaseName,
  type NoteExportFormat
} from "../lib/exportImport/noteExport";
import type { AppLanguage, Asset, Folder, Note, NoteContent, SaveState, StoredBlock, Tag } from "../types";
import {
  createSpellcheckConfiguration,
  useBlockNoteDictionary,
  useLocale,
  useSpellcheckCapability
} from "../localization";

type MarkdownStatus = "copied" | "exported" | "imported" | "error" | null;
type NoteTransferStatus = {
  tone: "success" | "error" | "info";
  text: string;
} | null;
type TaskCreationStatus = {
  tone: "success" | "error";
  text: string;
} | null;
type EditorTypographyMode = "focus" | "reading";
type PendingMarkdownImport = {
  fileName: string;
  markdown: string;
};
type AiPanelState = {
  scope: GeminiAiScope;
  status: "idle" | "generating" | "applying" | "error";
  customMode: GeminiCustomMode;
  customPrompt: string;
  targetLanguage: string;
  error: string | null;
  targetBlockIds: string[];
  sourceMarkdown: string;
  sourceBlocks: NoteContent;
  targetBlocks: NoteContent;
  inlineRange: AiInlineRange | null;
  anchor: {
    top: number;
    left: number;
    placement: "top" | "bottom" | "left" | "right";
  } | null;
};
type AiInlineRange = {
  from: number;
  to: number;
};
type AiPreviewApplyMode = "replaceBlocks" | "insertBlocks" | "replaceInline";
type AiPreviewMethod = GeminiEditorFormat | "markdown-fallback";
type AiPreviewState = {
  status: "idle" | "applying" | "error";
  action: GeminiAiAction;
  scope: GeminiAiScope;
  applyMode: AiPreviewApplyMode;
  summary: string;
  warnings: string[];
  beforeBlocks: NoteContent;
  afterBlocks: NoteContent;
  beforeStats: AiContentStats;
  afterStats: AiContentStats;
  targetBlockIds: string[];
  referenceBlockId: string | null;
  inlineRange: AiInlineRange | null;
  inlineText: string | null;
  error: string | null;
  fallbackUsed: boolean;
  method: AiPreviewMethod;
};

const EDITOR_TYPOGRAPHY_MODE_STORAGE_KEY = "zen:editor-typography-mode";
const EMPTY_INLINE_PASTE_TARGET_TYPES = new Set([
  "paragraph",
  "heading",
  "quote",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "toggleListItem"
]);
const LIST_CONTINUATION_TARGET_TYPES = new Set([
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "toggleListItem"
]);
const LIST_CONTINUATION_INLINE_STYLE_KEYS = [
  "font",
  "textColor",
  "backgroundColor"
] as const;
const LIST_CONTINUATION_BLOCK_PROP_KEYS = [
  "textColor",
  "backgroundColor",
  "textAlignment"
] as const;
const FLOATING_MEDIA_BLOCK_TYPES = new Set(["image", "file", "audio", "video"]);
const FLOATING_MEDIA_POPOVER_SELECTOR =
  ".editor-floating-toolbar-popover, .bn-formatting-toolbar, .bn-form-popover, .bn-panel-popover, .bn-menu-dropdown";
const FLOATING_MEDIA_BLOCK_SELECTOR =
  "[data-file-block], .bn-block-content[data-content-type='image'], .bn-block-content[data-content-type='video'], .bn-block-content[data-content-type='audio'], .bn-block-content[data-content-type='file']";
const INLINE_AI_REPLACE_ACTIONS = new Set<GeminiAiAction>([
  "fix",
  "improve",
  "translate",
  "custom"
]);
const AI_PANEL_WIDTH = 420;
const AI_PANEL_HEIGHT = 324;
const AI_PANEL_GAP = 10;
const AI_PANEL_MARGIN = 12;

type BlockNoteEditorInstance = ReturnType<typeof useCreateBlockNote>;
type EmptyInlineBlockPasteTarget = {
  block: StoredBlock & { id: string };
  plainText: string;
};
type EmptyInlinePasteRestoreSnapshot = {
  block: StoredBlock & { id: string };
  path: number[];
};
type ListContinuationStyleSeed = {
  sourceBlockId: string;
  sourceBlockType: string;
  styles: Record<string, unknown>;
  props: Record<string, unknown>;
};
type FloatingMediaSelectionSnapshot = {
  blockId: string;
};
type MobileQuickBlockType =
  | "paragraph"
  | "heading"
  | "bulletListItem"
  | "numberedListItem"
  | "checkListItem"
  | "quote";
type MobileInsertBlockType =
  | MobileQuickBlockType
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "heading5"
  | "heading6"
  | "toggleHeading1"
  | "toggleHeading2"
  | "toggleHeading3"
  | "toggleListItem"
  | "codeBlock"
  | "divider"
  | "table"
  | "image"
  | "file"
  | "audio"
  | "video";
type MobileInsertBlockGroup = {
  key: "text" | "lists" | "structure" | "media";
  titleKey: string;
  items: MobileInsertBlockType[];
};

const MOBILE_INSERT_BLOCK_GROUPS: readonly MobileInsertBlockGroup[] = [
  {
    key: "text",
    titleKey: "note.mobileInsertGroupText",
    items: [
      "paragraph",
      "heading1",
      "heading2",
      "heading3",
      "heading4",
      "heading5",
      "heading6",
      "toggleHeading1",
      "toggleHeading2",
      "toggleHeading3",
      "quote"
    ]
  },
  {
    key: "lists",
    titleKey: "note.mobileInsertGroupLists",
    items: ["bulletListItem", "numberedListItem", "checkListItem", "toggleListItem"]
  },
  {
    key: "structure",
    titleKey: "note.mobileInsertGroupStructure",
    items: ["table", "codeBlock", "divider"]
  },
  {
    key: "media",
    titleKey: "note.mobileInsertGroupMedia",
    items: ["image", "file", "audio", "video"]
  }
];

const MOBILE_INSERT_BLOCK_SLASH_KEYS: Record<MobileInsertBlockType, string> = {
  paragraph: "paragraph",
  heading: "heading_2",
  heading1: "heading",
  heading2: "heading_2",
  heading3: "heading_3",
  heading4: "heading_4",
  heading5: "heading_5",
  heading6: "heading_6",
  toggleHeading1: "toggle_heading",
  toggleHeading2: "toggle_heading_2",
  toggleHeading3: "toggle_heading_3",
  bulletListItem: "bullet_list",
  numberedListItem: "numbered_list",
  checkListItem: "check_list",
  toggleListItem: "toggle_list",
  quote: "quote",
  codeBlock: "code_block",
  divider: "divider",
  table: "table",
  image: "image",
  file: "file",
  audio: "audio",
  video: "video"
};

const MOBILE_INSERT_BLOCK_GLYPHS: Record<MobileInsertBlockType, string> = {
  paragraph: "T",
  heading: "H",
  heading1: "H1",
  heading2: "H2",
  heading3: "H3",
  heading4: "H4",
  heading5: "H5",
  heading6: "H6",
  toggleHeading1: "H1+",
  toggleHeading2: "H2+",
  toggleHeading3: "H3+",
  bulletListItem: "-",
  numberedListItem: "1",
  checkListItem: "[]",
  toggleListItem: ">",
  quote: "\"",
  codeBlock: "{}",
  divider: "--",
  table: "#",
  image: "IMG",
  file: "FILE",
  audio: "AUD",
  video: "VID"
};

const MOBILE_INSERT_MEDIA_BLOCK_TYPES = new Set<MobileInsertBlockType>([
  "image",
  "file",
  "audio",
  "video"
]);
const MOBILE_INSERT_CURSOR_BLOCK_TYPES = new Set<MobileInsertBlockType>([
  "paragraph",
  "heading",
  "heading1",
  "heading2",
  "heading3",
  "heading4",
  "heading5",
  "heading6",
  "toggleHeading1",
  "toggleHeading2",
  "toggleHeading3",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "toggleListItem",
  "quote",
  "codeBlock"
]);

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function countStoredBlocks(blocks: NoteContent): number {
  return blocks.reduce((total, block) => {
    const children = Array.isArray(block.children) ? countStoredBlocks(block.children) : 0;

    return total + 1 + children;
  }, 0);
}

function AiSparkleGlyph() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M12 2.75l1.48 4.22a4.16 4.16 0 0 0 2.55 2.55L20.25 11l-4.22 1.48a4.16 4.16 0 0 0-2.55 2.55L12 19.25l-1.48-4.22a4.16 4.16 0 0 0-2.55-2.55L3.75 11l4.22-1.48a4.16 4.16 0 0 0 2.55-2.55L12 2.75Z"
        fill="currentColor"
      />
      <path
        d="M19 16.75l.58 1.67 1.67.58-1.67.58L19 21.25l-.58-1.67-1.67-.58 1.67-.58.58-1.67ZM5.25 3.5l.82 2.18 2.18.82-2.18.82L5.25 9.5l-.82-2.18-2.18-.82 2.18-.82.82-2.18Z"
        fill="currentColor"
        opacity="0.72"
      />
    </svg>
  );
}

function MobileBackGlyph() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M14.75 5.25 8 12l6.75 6.75M8.75 12H20"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
    </svg>
  );
}

function MobileMoreGlyph() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M5.75 12h.01M12 12h.01M18.25 12h.01"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3.2"
      />
    </svg>
  );
}

function AiTextGlyph() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M5 5.75h14M12 5.75v12.5M8.25 18.25h7.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.9"
      />
    </svg>
  );
}

function AiCheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="m5 12.5 4.1 4.1L19.25 6.75"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function AiGlobeGlyph() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="8.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M3.95 12h16.1M12 3.75c2.15 2.2 3.1 4.9 3.1 8.25s-.95 6.05-3.1 8.25C9.85 18.05 8.9 15.35 8.9 12S9.85 5.95 12 3.75Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.55"
      />
    </svg>
  );
}

function AiArrowGlyph() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M5 12h13.25m0 0-5.1-5.1m5.1 5.1-5.1 5.1"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
    </svg>
  );
}

function MobileFocusModeGlyph() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M12 7.75a4.25 4.25 0 1 0 0 8.5 4.25 4.25 0 0 0 0-8.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M12 3.25v2.4M12 18.35v2.4M20.75 12h-2.4M5.65 12h-2.4M12 10.7v2.6M10.7 12h2.6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function MobileReadingModeGlyph() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M5.25 5.75h4.35c1.02 0 1.82.28 2.4.85.58-.57 1.38-.85 2.4-.85h4.35v12.5H14.4c-1.02 0-1.82.28-2.4.85-.58-.57-1.38-.85-2.4-.85H5.25V5.75Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
      <path
        d="M12 6.6v12.5M7.65 9.25h2M7.65 12h2M14.35 9.25h2M14.35 12h2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.55"
      />
    </svg>
  );
}

function MobileFolderGlyph() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M4.5 7.25c0-.9.6-1.5 1.5-1.5h4.15l1.35 1.6H18c.9 0 1.5.6 1.5 1.5v7.9c0 .9-.6 1.5-1.5 1.5H6c-.9 0-1.5-.6-1.5-1.5v-9.5Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
    </svg>
  );
}

function MobileTagGlyph() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M5.25 6.9v5.2c0 .45.18.88.5 1.2l5.45 5.45a1.8 1.8 0 0 0 2.55 0l4-4a1.8 1.8 0 0 0 0-2.55L12.3 6.75a1.7 1.7 0 0 0-1.2-.5H6.9c-.95 0-1.65.7-1.65 1.65Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
      <path d="M8.8 9.1h.02" stroke="currentColor" strokeLinecap="round" strokeWidth="2.6" />
    </svg>
  );
}

function MobilePaletteGlyph() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M12.1 4.25c-4.15 0-7.35 2.82-7.35 6.75 0 3.7 2.62 6.75 6.08 6.75h1.42c.66 0 1.08-.5.92-1.12-.28-1.06.48-2.13 1.58-2.13h1.33c2.05 0 3.17-1.36 3.17-3.27 0-4.05-3.1-6.98-7.15-6.98Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
      <path d="M8 10.1h.02M10.45 7.9h.02M14 8.05h.02M16.2 10.55h.02" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
    </svg>
  );
}

function MobileExportGlyph() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M12 4.5v9M8.55 7.95 12 4.5l3.45 3.45M5.75 12.7v4.55c0 .9.6 1.5 1.5 1.5h9.5c.9 0 1.5-.6 1.5-1.5V12.7"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.85"
      />
    </svg>
  );
}

function MobilePinGlyph() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="m14.6 4.8 4.6 4.6-2.45 1.1-2.2 3.9.75 2.25-1.05 1.05-3.4-3.4-4.65 4.65-1.15-1.15 4.65-4.65-3.4-3.4 1.05-1.05 2.25.75 3.9-2.2 1.1-2.45Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function MobileRestoreGlyph() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M7.25 7.4A7 7 0 1 1 5.1 12.45M7.25 7.4h-3.5V3.9"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.85"
      />
    </svg>
  );
}

function MobileTrashGlyph() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M5.75 7.25h12.5M9.35 7.25V5.8c0-.7.45-1.15 1.15-1.15h3c.7 0 1.15.45 1.15 1.15v1.45M7.25 9.25l.65 8c.08.95.7 1.5 1.65 1.5h4.9c.95 0 1.57-.55 1.65-1.5l.65-8"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="m7.25 7.25 9.5 9.5m0-9.5-9.5 9.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.9"
      />
    </svg>
  );
}

function shouldCarryStyleValue(value: unknown) {
  return value !== undefined && value !== null && value !== "" && value !== "default";
}

function pickListContinuationInlineStyles(styles: unknown) {
  const picked: Record<string, unknown> = {};

  if (!styles || typeof styles !== "object") {
    return picked;
  }

  const record = styles as Record<string, unknown>;

  LIST_CONTINUATION_INLINE_STYLE_KEYS.forEach((key) => {
    const value = record[key];

    if (shouldCarryStyleValue(value)) {
      picked[key] = value;
    }
  });

  return picked;
}

function pickListContinuationBlockProps(props: unknown) {
  const picked: Record<string, unknown> = {};

  if (!props || typeof props !== "object") {
    return picked;
  }

  const record = props as Record<string, unknown>;

  LIST_CONTINUATION_BLOCK_PROP_KEYS.forEach((key) => {
    const value = record[key];

    if (shouldCarryStyleValue(value) && !(key === "textAlignment" && value === "left")) {
      picked[key] = value;
    }
  });

  return picked;
}

function getTrailingInlineStyles(content: unknown) {
  let trailingStyles: Record<string, unknown> = {};

  const visit = (value: unknown) => {
    if (typeof value === "string") {
      if (value.length > 0) {
        trailingStyles = {};
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    const record = value as Record<string, unknown>;

    if (Array.isArray(record.content)) {
      visit(record.content);
    }

    if (typeof record.text === "string" && record.text.length > 0) {
      trailingStyles = pickListContinuationInlineStyles(record.styles);
    }
  };

  visit(content);
  return trailingStyles;
}

function isEmptyInlineEditorContent(content: unknown) {
  if (typeof content === "string") {
    return content.length === 0;
  }

  if (!Array.isArray(content)) {
    return content == null;
  }

  return content.every((entry) => {
    if (typeof entry === "string") {
      return entry.length === 0;
    }

    if (!entry || typeof entry !== "object") {
      return true;
    }

    const text = (entry as Record<string, unknown>).text;
    return typeof text === "string" ? text.length === 0 : false;
  });
}

function isInlinePasteTargetBlock(editor: BlockNoteEditorInstance, block: StoredBlock) {
  const blockType = block.type ?? "paragraph";
  const blockSchema = editor.schema.blockSchema as Record<string, { content?: string }>;

  return (
    typeof block.id === "string" &&
    blockSchema[blockType]?.content === "inline" &&
    EMPTY_INLINE_PASTE_TARGET_TYPES.has(blockType) &&
    isEmptyInlineEditorContent(block.content)
  );
}

function getListContinuationStyleSeed(
  editor: BlockNoteEditorInstance
): ListContinuationStyleSeed | null {
  let currentBlock: StoredBlock;

  try {
    currentBlock = editor.getTextCursorPosition().block as unknown as StoredBlock;
  } catch {
    return null;
  }

  const blockType = currentBlock.type ?? "paragraph";

  if (
    !LIST_CONTINUATION_TARGET_TYPES.has(blockType) ||
    typeof currentBlock.id !== "string" ||
    isEmptyInlineEditorContent(currentBlock.content)
  ) {
    return null;
  }

  const styles = {
    ...getTrailingInlineStyles(currentBlock.content),
    ...pickListContinuationInlineStyles(editor.getActiveStyles())
  };
  const props = pickListContinuationBlockProps(currentBlock.props);

  if (Object.keys(styles).length === 0 && Object.keys(props).length === 0) {
    return null;
  }

  return {
    sourceBlockId: currentBlock.id,
    sourceBlockType: blockType,
    styles,
    props
  };
}

function applyListContinuationStyleSeed(
  editor: BlockNoteEditorInstance,
  seed: ListContinuationStyleSeed
) {
  let currentBlock: StoredBlock;

  try {
    currentBlock = editor.getTextCursorPosition().block as unknown as StoredBlock;
  } catch {
    return false;
  }

  const blockType = currentBlock.type ?? "paragraph";

  if (
    blockType !== seed.sourceBlockType ||
    typeof currentBlock.id !== "string" ||
    currentBlock.id === seed.sourceBlockId ||
    !isEmptyInlineEditorContent(currentBlock.content)
  ) {
    return false;
  }

  const hasProps = Object.keys(seed.props).length > 0;
  const hasStyles = Object.keys(seed.styles).length > 0;

  if (hasProps) {
    editor.updateBlock(currentBlock.id, {
      props: {
        ...(currentBlock.props ?? {}),
        ...seed.props
      }
    });
    editor.setTextCursorPosition(currentBlock.id, "end");
  }

  if (hasStyles) {
    editor.addStyles(seed.styles as any);
  }

  return hasProps || hasStyles;
}

function findBlockPath(blocks: StoredBlock[], blockId: string): number[] | null {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];

    if (block.id === blockId) {
      return [index];
    }

    if (Array.isArray(block.children) && block.children.length > 0) {
      const childPath = findBlockPath(block.children, blockId);

      if (childPath) {
        return [index, ...childPath];
      }
    }
  }

  return null;
}

function getEmptyInlineBlockPasteTarget(
  editor: BlockNoteEditorInstance,
  event: ClipboardEvent
): EmptyInlineBlockPasteTarget | null {
  const clipboardData = event.clipboardData;
  const plainText = clipboardData?.getData("text/plain") ?? "";

  if (!clipboardData || plainText.length === 0) {
    return null;
  }

  const clipboardTypes = Array.from(clipboardData.types);

  if (
    clipboardTypes.includes("Files") ||
    clipboardTypes.includes("blocknote/html") ||
    clipboardTypes.includes("text/markdown")
  ) {
    return null;
  }

  let currentBlock: StoredBlock;

  try {
    currentBlock = editor.getTextCursorPosition().block as unknown as StoredBlock;
  } catch {
    return null;
  }

  if (
    !isInlinePasteTargetBlock(editor, currentBlock) ||
    typeof currentBlock.id !== "string"
  ) {
    return null;
  }

  return {
    block: currentBlock as StoredBlock & { id: string },
    plainText
  };
}

function pasteTextIntoEmptyInlineBlock(
  editor: BlockNoteEditorInstance,
  event: ClipboardEvent
) {
  const pasteTarget = getEmptyInlineBlockPasteTarget(editor, event);

  if (!pasteTarget) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const activeStyles = editor.getActiveStyles();
  const content =
    Object.keys(activeStyles).length > 0
      ? [
          {
            type: "text" as const,
            text: pasteTarget.plainText,
            styles: activeStyles
          }
        ]
      : pasteTarget.plainText;

  editor.updateBlock(pasteTarget.block.id, {
    content
  });
  editor.setTextCursorPosition(pasteTarget.block.id, "end");
  return true;
}

function getClipboardImageFiles(event: ClipboardEvent) {
  const items = event.clipboardData?.items;

  if (!items) {
    return [];
  }

  return Array.from(items)
    .map((item) => (item.kind === "file" ? item.getAsFile() : null))
    .filter((file): file is File => Boolean(file && file.type.startsWith("image/")));
}

function getImageExtension(mimeType: string) {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }

  if (mimeType === "image/svg+xml") {
    return "svg";
  }

  const subtype = mimeType.split("/")[1]?.split("+")[0];
  return subtype || "png";
}

function normalizePastedImageFile(file: File, index: number) {
  if (file.name.trim()) {
    return file;
  }

  const mimeType = file.type || "image/png";

  return new File([file], `pasted-image-${index + 1}.${getImageExtension(mimeType)}`, {
    type: mimeType,
    lastModified: Date.now()
  });
}

function isImageOnlyClipboardPayload(event: ClipboardEvent, imageFiles: File[]) {
  if (imageFiles.length === 0) {
    return false;
  }

  const clipboardData = event.clipboardData;
  const html = clipboardData?.getData("text/html") ?? "";
  const plainText = clipboardData?.getData("text/plain").trim() ?? "";

  if (!html) {
    return plainText.length === 0;
  }

  const parsedDocument = new DOMParser().parseFromString(html, "text/html");

  parsedDocument.body.querySelectorAll("img, picture, source").forEach((element) => element.remove());
  return (parsedDocument.body.textContent ?? "").trim().length === 0;
}

function canReplaceBlockWithPastedImage(block: StoredBlock) {
  return (
    typeof block.id === "string" &&
    Array.isArray(block.content) &&
    block.content.length === 0 &&
    (!Array.isArray(block.children) || block.children.length === 0)
  );
}

function pasteClipboardImagesAsAssetBlocks(
  editor: BlockNoteEditorInstance,
  event: ClipboardEvent,
  uploadFile: (file: File) => Promise<string>
) {
  const imageFiles = getClipboardImageFiles(event);

  if (!isImageOnlyClipboardPayload(event, imageFiles)) {
    return false;
  }

  event.preventDefault();

  void (async () => {
    let referenceBlock: StoredBlock;

    try {
      referenceBlock = editor.getTextCursorPosition().block as unknown as StoredBlock;
    } catch {
      return;
    }

    for (const [index, rawFile] of imageFiles.entries()) {
      const file = normalizePastedImageFile(rawFile, index);
      const url = await uploadFile(file);
      const nextBlock = {
        type: "image",
        props: {
          url,
          name: file.name,
          showPreview: true
        }
      };

      if (index === 0 && canReplaceBlockWithPastedImage(referenceBlock)) {
        referenceBlock = editor.updateBlock(referenceBlock.id, nextBlock as any) as unknown as StoredBlock;
      } else {
        referenceBlock = editor.insertBlocks([nextBlock as any], referenceBlock as any, "after")[0] as unknown as StoredBlock;
      }
    }
  })().catch(() => {
    // The editor remains unchanged if a pasted image cannot be persisted.
  });

  return true;
}

function getCurrentEmptyInlinePasteRestoreSnapshot(
  editor: BlockNoteEditorInstance
): EmptyInlinePasteRestoreSnapshot | null {
  let currentBlock: StoredBlock;

  try {
    currentBlock = editor.getTextCursorPosition().block as unknown as StoredBlock;
  } catch {
    return null;
  }

  if (
    !isInlinePasteTargetBlock(editor, currentBlock) ||
    typeof currentBlock.id !== "string" ||
    (currentBlock.type ?? "paragraph") === "paragraph"
  ) {
    return null;
  }

  const path = findBlockPath(editor.document as unknown as StoredBlock[], currentBlock.id);

  if (!path) {
    return null;
  }

  return {
    block: currentBlock as StoredBlock & { id: string },
    path
  };
}

function getBlockAtPath(blocks: StoredBlock[], path: number[]) {
  let currentBlocks = blocks;
  let currentBlock: StoredBlock | null = null;

  for (const index of path) {
    currentBlock = currentBlocks[index] ?? null;

    if (!currentBlock) {
      return null;
    }

    currentBlocks = Array.isArray(currentBlock.children) ? currentBlock.children : [];
  }

  return currentBlock;
}

function restorePastedEmptyInlineBlockType(
  blocks: NoteContent,
  snapshot: EmptyInlinePasteRestoreSnapshot | null
) {
  if (!snapshot) {
    return {
      blocks,
      changed: false
    };
  }

  const restoreBlock = (block: StoredBlock): StoredBlock | null => {
    const targetType = snapshot.block.type ?? "paragraph";
    const sourceProps = snapshot.block.props ?? {};
    const currentProps = block.props ?? {};
    const typeMatches = (block.type ?? "paragraph") === targetType;
    const propsMatch = Object.entries(sourceProps).every(
      ([key, value]) => currentProps[key as keyof typeof currentProps] === value
    );

    if (typeMatches && propsMatch) {
      return null;
    }

    return {
      ...block,
      type: targetType,
      props: {
        ...currentProps,
        ...sourceProps
      }
    };
  };

  const restoreById = (entries: StoredBlock[]): StoredBlock[] | null => {
    let changed = false;
    const nextEntries = entries.map((block) => {
      if (block.id === snapshot.block.id) {
        const restoredBlock = restoreBlock(block);

        if (restoredBlock) {
          changed = true;
          return restoredBlock;
        }
      }

      if (Array.isArray(block.children) && block.children.length > 0) {
        const restoredChildren = restoreById(block.children);

        if (restoredChildren) {
          changed = true;
          return {
            ...block,
            children: restoredChildren
          };
        }
      }

      return block;
    });

    return changed ? nextEntries : null;
  };

  const restoredById = restoreById(blocks);

  if (restoredById) {
    return {
      blocks: restoredById,
      changed: true
    };
  }

  const blockAtOriginalPath = getBlockAtPath(blocks, snapshot.path);
  const restoredBlockAtPath = blockAtOriginalPath ? restoreBlock(blockAtOriginalPath) : null;

  if (!restoredBlockAtPath) {
    return {
      blocks,
      changed: false
    };
  }

  const restoreByPath = (entries: StoredBlock[], path: number[]): StoredBlock[] => {
    const [index, ...restPath] = path;

    return entries.map((block, currentIndex) => {
      if (currentIndex !== index) {
        return block;
      }

      if (restPath.length === 0) {
        return restoredBlockAtPath;
      }

      return {
        ...block,
        children: restoreByPath(Array.isArray(block.children) ? block.children : [], restPath)
      };
    });
  };

  return {
    blocks: restoreByPath(blocks, snapshot.path),
    changed: true
  };
}

interface EditorPaneProps {
  note: Note;
  assets: Asset[];
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
  onContentChange: (content: NoteContent, state: SaveState) => void;
  onUploadFile: (file: File) => Promise<string>;
  onResolveFileUrl: (url: string) => Promise<string>;
  onCreateTaskFromContext?: (input: PlannerContextTaskInput) => Promise<unknown> | void;
  privateVaultWarningContext?: PrivateVaultWarningContext | null;
  immersive?: boolean;
  onClose?: () => void;
}

export default function EditorPane({
  note,
  assets,
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
  onUploadFile,
  onResolveFileUrl,
  onCreateTaskFromContext,
  privateVaultWarningContext = null,
  immersive = false,
  onClose
}: EditorPaneProps) {
  const { t } = useTranslation();
  const { preferences: localePreferences, runtime: localeRuntime } = useLocale();
  const [titleDraft, setTitleDraft] = useState(note.title);
  const [typographyMode, setTypographyMode] = useState<EditorTypographyMode>(() => {
    const storedMode = readPersistentString(EDITOR_TYPOGRAPHY_MODE_STORAGE_KEY);

    return storedMode === "reading" ? "reading" : "focus";
  });
  const [noteTransferOpen, setNoteTransferOpen] = useState(false);
  const [noteTransferStatus, setNoteTransferStatus] =
    useState<NoteTransferStatus>(null);
  const [noteTransferBusy, setNoteTransferBusy] =
    useState<NoteExportFormat | "copy" | "import" | null>(null);
  const [pendingMarkdownImport, setPendingMarkdownImport] =
    useState<PendingMarkdownImport | null>(null);
  const [mobileNoteMenuOpen, setMobileNoteMenuOpen] = useState(false);
  const [mobileInsertMenuOpen, setMobileInsertMenuOpen] = useState(false);
  const [taskCreationStatus, setTaskCreationStatus] = useState<TaskCreationStatus>(null);
  const [aiPanel, setAiPanel] = useState<AiPanelState | null>(null);
  const [aiPreview, setAiPreview] = useState<AiPreviewState | null>(null);
  const aiPanelRef = useRef<HTMLDivElement | null>(null);
  const spellcheckStageRef = useRef<HTMLDivElement | null>(null);
  const titleTimeoutRef = useRef<number | null>(null);
  const contentTimeoutRef = useRef<number | null>(null);
  const markdownStatusTimeoutRef = useRef<number | null>(null);
  const taskStatusTimeoutRef = useRef<number | null>(null);
  const isTitleFieldFocusedRef = useRef(false);
  const isApplyingChecklistTransformRef = useRef(false);
  const pendingEmptyInlinePasteRestoreRef =
    useRef<EmptyInlinePasteRestoreSnapshot | null>(null);
  const checklistStableOrderRef = useRef(new Map<string, number>());
  const floatingMediaSelectionRef = useRef<FloatingMediaSelectionSnapshot | null>(null);
  const floatingMediaSelectionGraceUntilRef = useRef(0);
  const latestTitleDraftRef = useRef(titleDraft);
  const latestStoredTitleRef = useRef(note.title);
  const latestEditorRef = useRef<ReturnType<typeof useCreateBlockNote> | null>(null);
  const latestOnContentChangeRef = useRef(onContentChange);
  const latestOnTitleChangeRef = useRef(onTitleChange);
  const folderOptions = useMemo(
    () => flattenFolderOptions(folders.filter((folder) => folder.projectId === note.projectId)),
    [folders, note.projectId]
  );
  const currentFolder = useMemo(
    () => folderOptions.find((folder) => folder.id === note.folderId) ?? null,
    [folderOptions, note.folderId]
  );
  const normalizedContent = useMemo(() => normalizeNoteContent(note.content), [note.content]);
  const mobileNoteStats = useMemo(
    () => ({
      blocks: countStoredBlocks(normalizedContent),
      attachments: assets.length,
      tags: note.tagIds.length
    }),
    [assets.length, normalizedContent, note.tagIds.length]
  );
  const { confirmPrivateVaultAction, privateVaultWarningDialog } =
    usePrivateVaultWarning(privateVaultWarningContext);

  useEffect(() => {
    isTitleFieldFocusedRef.current = false;
    setTitleDraft(note.title);
  }, [note.id]);

  useEffect(() => {
    if (!isTitleFieldFocusedRef.current) {
      setTitleDraft(note.title);
    }
  }, [note.title]);

  useEffect(() => {
    setPendingMarkdownImport(null);
    setNoteTransferOpen(false);
    setNoteTransferStatus(null);
    setNoteTransferBusy(null);
    setMobileNoteMenuOpen(false);
    setMobileInsertMenuOpen(false);
    setAiPanel(null);
    setAiPreview(null);
    checklistStableOrderRef.current = new Map();
  }, [note.id]);

  useEffect(() => {
    writePersistentString(EDITOR_TYPOGRAPHY_MODE_STORAGE_KEY, typographyMode);
  }, [typographyMode]);

  const editorDictionary = useBlockNoteDictionary(localeRuntime.interfaceLocale);
  const spellcheckConfiguration = useMemo(
    () => createSpellcheckConfiguration(localePreferences, localeRuntime.interfaceLocale),
    [localePreferences, localeRuntime.interfaceLocale]
  );
  useSpellcheckCapability(spellcheckStageRef, spellcheckConfiguration);

  const editor = useCreateBlockNote(
    {
      schema: editorBlockNoteSchema,
      initialContent: normalizedContent.length > 0 ? (normalizedContent as any) : undefined,
      animations: true,
      dictionary: {
        ...editorDictionary,
        placeholders: {
          ...editorDictionary.placeholders,
          emptyDocument: t("note.editorPlaceholder"),
          default: t("note.editorPlaceholder")
        }
      },
      tables: {
        splitCells: true,
        cellBackgroundColor: true,
        cellTextColor: true,
        headers: true
      },
      tabBehavior: "prefer-indent",
      uploadFile: onUploadFile,
      resolveFileUrl: onResolveFileUrl,
      pasteHandler: ({ event, editor, defaultPasteHandler }) => {
        if (pasteClipboardImagesAsAssetBlocks(editor, event, onUploadFile)) {
          return true;
        }

        if (pasteTextIntoEmptyInlineBlock(editor, event)) {
          return true;
        }

        return defaultPasteHandler();
      },
      domAttributes: {
        editor: {
          class: "locoris-editor-surface",
          lang: spellcheckConfiguration.primaryLanguage,
          spellcheck: spellcheckConfiguration.enabled ? "true" : "false",
          "data-spellcheck-platform": spellcheckConfiguration.adapter.platform,
          "data-spellcheck-languages": spellcheckConfiguration.languages.join(",")
        }
      }
    },
    [editorDictionary, note.id, spellcheckConfiguration.signature]
  );

  const readActiveFloatingMediaBlock = (): FloatingMediaSelectionSnapshot | null => {
    try {
      const block = editor.getTextCursorPosition().block as StoredBlock & { id?: string };
      const blockId = typeof block.id === "string" ? block.id : null;
      const blockType = typeof block.type === "string" ? block.type : "";

      if (!blockId || !FLOATING_MEDIA_BLOCK_TYPES.has(blockType)) {
        return null;
      }

      return {
        blockId
      };
    } catch {
      return null;
    }
  };

  const rememberFloatingMediaSelection = () => {
    const mediaBlock = readActiveFloatingMediaBlock();

    if (mediaBlock) {
      floatingMediaSelectionRef.current = mediaBlock;
      floatingMediaSelectionGraceUntilRef.current = Date.now() + 3000;
      return;
    }

    if (Date.now() > floatingMediaSelectionGraceUntilRef.current) {
      floatingMediaSelectionRef.current = null;
    }
  };

  const restoreFloatingMediaSelection = () => {
    const snapshot = floatingMediaSelectionRef.current;

    if (!snapshot || Date.now() > floatingMediaSelectionGraceUntilRef.current) {
      return;
    }

    try {
      const activeMediaBlock = readActiveFloatingMediaBlock();

      if (activeMediaBlock?.blockId !== snapshot.blockId) {
        editor.setTextCursorPosition(snapshot.blockId);
      }

      editor.getExtension(FormattingToolbarExtension)?.store.setState(true);
      floatingMediaSelectionGraceUntilRef.current = Date.now() + 3000;
    } catch {
      floatingMediaSelectionRef.current = null;
    }
  };

  const preserveFloatingMediaSelection = (
    event?: ReactMouseEvent<HTMLDivElement> | ReactPointerEvent<HTMLDivElement>
  ) => {
    restoreFloatingMediaSelection();
    event?.preventDefault();
  };

  useEffect(() => {
    rememberFloatingMediaSelection();

    const unsubscribeSelection = editor.onSelectionChange(() => {
      rememberFloatingMediaSelection();
    });

    const handleFloatingPointerMove = (event: PointerEvent) => {
      if (!floatingMediaSelectionRef.current) {
        return;
      }

      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      if (target.closest(FLOATING_MEDIA_POPOVER_SELECTOR)) {
        restoreFloatingMediaSelection();
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      if (
        target.closest(FLOATING_MEDIA_POPOVER_SELECTOR) ||
        target.closest(FLOATING_MEDIA_BLOCK_SELECTOR)
      ) {
        return;
      }

      floatingMediaSelectionRef.current = null;
      floatingMediaSelectionGraceUntilRef.current = 0;
    };

    window.addEventListener("pointermove", handleFloatingPointerMove, true);
    window.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
      unsubscribeSelection();
      window.removeEventListener("pointermove", handleFloatingPointerMove, true);
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [editor]);

  const buildAiPanelAnchor = (
    scope: GeminiAiScope,
    triggerRect?: DOMRect | null
  ): AiPanelState["anchor"] => {
    if (typeof window === "undefined") {
      return null;
    }

    const box = triggerRect ?? (scope === "selection" ? editor.getSelectionBoundingBox() : null);

    if (!box) {
      return null;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const panelWidth = Math.min(AI_PANEL_WIDTH, viewportWidth - AI_PANEL_MARGIN * 2);
    const panelHeight = Math.min(AI_PANEL_HEIGHT, viewportHeight - AI_PANEL_MARGIN * 2);
    const maxLeft = viewportWidth - panelWidth - AI_PANEL_MARGIN;
    const maxTop = viewportHeight - panelHeight - AI_PANEL_MARGIN;
    const centeredLeft = clampNumber(
      box.left + box.width / 2 - panelWidth / 2,
      AI_PANEL_MARGIN,
      Math.max(AI_PANEL_MARGIN, maxLeft)
    );
    const centeredTop = clampNumber(
      box.top + box.height / 2 - panelHeight / 2,
      AI_PANEL_MARGIN,
      Math.max(AI_PANEL_MARGIN, maxTop)
    );
    const spaces = {
      bottom: viewportHeight - box.bottom - AI_PANEL_GAP - AI_PANEL_MARGIN,
      top: box.top - AI_PANEL_GAP - AI_PANEL_MARGIN,
      right: viewportWidth - box.right - AI_PANEL_GAP - AI_PANEL_MARGIN,
      left: box.left - AI_PANEL_GAP - AI_PANEL_MARGIN
    };
    const preferredPlacements: Array<"top" | "bottom" | "left" | "right"> =
      triggerRect && scope === "note"
        ? ["bottom", "right", "left", "top"]
        : ["bottom", "top", "right", "left"];
    const placement =
      preferredPlacements.find((candidate) =>
        candidate === "top" || candidate === "bottom"
          ? spaces[candidate] >= panelHeight
          : spaces[candidate] >= panelWidth
      ) ??
      preferredPlacements.reduce((best, candidate) => {
        const bestSpace =
          best === "top" || best === "bottom" ? spaces[best] : spaces[best];
        const candidateSpace =
          candidate === "top" || candidate === "bottom" ? spaces[candidate] : spaces[candidate];

        return candidateSpace > bestSpace ? candidate : best;
      }, preferredPlacements[0]);

    if (placement === "top") {
      return {
        placement,
        top: clampNumber(box.top - panelHeight - AI_PANEL_GAP, AI_PANEL_MARGIN, maxTop),
        left: centeredLeft
      };
    }

    if (placement === "right") {
      return {
        placement,
        top: centeredTop,
        left: clampNumber(box.right + AI_PANEL_GAP, AI_PANEL_MARGIN, maxLeft)
      };
    }

    if (placement === "left") {
      return {
        placement,
        top: centeredTop,
        left: clampNumber(box.left - panelWidth - AI_PANEL_GAP, AI_PANEL_MARGIN, maxLeft)
      };
    }

    return {
      placement,
      top: clampNumber(box.bottom + AI_PANEL_GAP, AI_PANEL_MARGIN, maxTop),
      left: centeredLeft
    };
  };

  const cloneNoteContent = (blocks: NoteContent): NoteContent =>
    normalizeNoteContent(JSON.parse(JSON.stringify(blocks)) as NoteContent);

  const readEditorDocumentBlocks = () =>
    cloneNoteContent(editor.document as unknown as NoteContent);

  const createPlainPreviewBlocks = (text: string): NoteContent =>
    text.trim()
      ? [
          {
            id: crypto.randomUUID(),
            type: "paragraph",
            props: {},
            content: [
              {
                type: "text",
                text,
                styles: {}
              }
            ],
            children: []
          }
        ]
      : [];

  const getRootBlockIds = () =>
    (editor.document as unknown as StoredBlock[])
      .map((block) => block.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

	  const getAiSourceSnapshot = (scope: GeminiAiScope) => {
    if (scope === "note") {
      const documentBlocks = readEditorDocumentBlocks();

      return {
        markdown: editor.blocksToMarkdownLossy(editor.document as any).trim(),
        targetBlockIds: documentBlocks
          .map((block) => block.id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
        sourceBlocks: documentBlocks,
        targetBlocks: documentBlocks,
        inlineRange: null
      };
    }

    const selection = editor.getSelection();
    const selectedText = editor.getSelectedText().trim();
    const selectedBlocks = cloneNoteContent((selection?.blocks ?? []) as unknown as NoteContent);
    const targetBlockIds =
      selectedBlocks
        .map((block) => block.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0) ?? [];
    let sourceBlocks = selectedBlocks;
    let inlineRange: AiInlineRange | null = null;
    let markdown = selectedText;

    try {
      const cutSelection = editor.getSelectionCutBlocks(false);
      const cutBlocks = cloneNoteContent(cutSelection.blocks as unknown as NoteContent);
      const cutMarkdown = editor.blocksToMarkdownLossy(cutBlocks as any).trim();

      if (cutBlocks.length > 0) {
        sourceBlocks = cutBlocks;
      }

      if (
        selectedText &&
        selectedBlocks.length === 1 &&
        cutBlocks.length === 1 &&
        targetBlockIds.length <= 1 &&
        (cutSelection.blockCutAtStart || cutSelection.blockCutAtEnd)
      ) {
        inlineRange = {
          from: cutSelection._meta.startPos,
          to: cutSelection._meta.endPos
        };
      }

      if (cutMarkdown) {
        markdown = cutMarkdown;
      }
    } catch {
      markdown = selectedText;
    }

    return {
      markdown,
      targetBlockIds,
      sourceBlocks,
      targetBlocks: selectedBlocks,
      inlineRange
	    };
	  };

	  const getCurrentEditorBlockForTask = () => {
	    try {
	      return editor.getTextCursorPosition().block as unknown as StoredBlock;
	    } catch {
	      return null;
	    }
	  };

	  const getPlannerTaskSnapshot = (scope: "note" | "selection") => {
	    if (scope === "note") {
	      const blocks = readEditorDocumentBlocks();
	      const noteText = extractPlainText(blocks);
	      const fallbackTitle = translateInline(language, "editorPane.taskFromNote");

	      return {
	        title: normalizePlannerContextTaskTitle(titleDraft || note.title || noteText, fallbackTitle),
	        description: noteText.slice(0, 1800),
	        sourceBlockId: null,
	        sourceLabel: translateInline(language, "editorPane.wholeNote")
	      };
	    }

	    const selection = editor.getSelection();
	    const selectedText = editor.getSelectedText().trim();
	    const selectedBlocks = cloneNoteContent((selection?.blocks ?? []) as unknown as NoteContent);
	    const currentBlock = selectedBlocks[0] ?? getCurrentEditorBlockForTask();
	    const currentBlockText = currentBlock ? extractPlainText([currentBlock]).trim() : "";
	    const sourceText = selectedText || currentBlockText;
	    const isChecklistItem = currentBlock?.type === "checkListItem";
	    const fallbackTitle = isChecklistItem
	      ? translateInline(language, "editorPane.checklistItem")
	      : translateInline(language, "editorPane.taskFromBlock");

	    return {
	      title: normalizePlannerContextTaskTitle(sourceText, fallbackTitle),
	      description: sourceText.slice(0, 1800),
	      sourceBlockId:
	        typeof currentBlock?.id === "string" && currentBlock.id.length > 0 ? currentBlock.id : null,
	      sourceLabel: isChecklistItem
	        ? translateInline(language, "editorPane.checklistItem2")
	        : selectedText
	          ? translateInline(language, "editorPane.selectedText")
	          : translateInline(language, "editorPane.currentBlock")
	    };
	  };

	  const showTaskCreationStatus = (status: Exclude<TaskCreationStatus, null>) => {
	    setTaskCreationStatus(status);

	    if (taskStatusTimeoutRef.current) {
	      window.clearTimeout(taskStatusTimeoutRef.current);
	    }

	    taskStatusTimeoutRef.current = window.setTimeout(() => {
	      setTaskCreationStatus(null);
	      taskStatusTimeoutRef.current = null;
	    }, 2200);
	  };

	  const handleCreateTaskFromEditor = async (scope: "note" | "selection") => {
	    if (!onCreateTaskFromContext) {
	      return;
	    }

	    const snapshot = getPlannerTaskSnapshot(scope);

	    try {
	      await onCreateTaskFromContext({
	        title: snapshot.title,
	        description: snapshot.description,
	        projectId: note.projectId,
	        folderId: note.folderId,
	        noteId: note.id,
	        sourceBlockId: snapshot.sourceBlockId,
	        sourceLabel: snapshot.sourceLabel
	      });
	      setMobileNoteMenuOpen(false);
	      showTaskCreationStatus({
	        tone: "success",
	        text: t("note.createTaskCreated")
	      });
	    } catch (error) {
	      console.warn("Could not create planner task from note context.", error);
	      showTaskCreationStatus({
	        tone: "error",
	        text: t("note.createTaskFailed")
	      });
	    }
	  };

	  const openAiPanel = (scope: GeminiAiScope, triggerRect?: DOMRect | null) => {
    const snapshot = getAiSourceSnapshot(scope);

    setAiPanel({
      scope,
      status: "idle",
      customMode: snapshot.markdown ? "edit" : "generate",
      customPrompt: "",
      targetLanguage: translateInline(language, "editorPane.defaultTranslationTarget"),
      error: null,
      targetBlockIds: snapshot.targetBlockIds,
      sourceMarkdown: snapshot.markdown,
      sourceBlocks: snapshot.sourceBlocks,
      targetBlocks: snapshot.targetBlocks,
      inlineRange: snapshot.inlineRange,
      anchor: buildAiPanelAnchor(scope, triggerRect)
    });
  };

	  useEffect(() => {
	    const handleOpenAi = (event: Event) => {
	      const detail = (event as CustomEvent<{ scope?: GeminiAiScope }>).detail;
	      openAiPanel(detail?.scope === "selection" ? "selection" : "note");
	    };

	    window.addEventListener(EDITOR_AI_OPEN_EVENT, handleOpenAi);
	    return () => window.removeEventListener(EDITOR_AI_OPEN_EVENT, handleOpenAi);
	  });

	  useEffect(() => {
	    const handleCreateTask = (event: Event) => {
	      const detail = (event as CustomEvent<{ scope?: "note" | "selection" }>).detail;
	      void handleCreateTaskFromEditor(detail?.scope === "note" ? "note" : "selection");
	    };

	    window.addEventListener(EDITOR_CREATE_TASK_EVENT, handleCreateTask);
	    return () => window.removeEventListener(EDITOR_CREATE_TASK_EVENT, handleCreateTask);
	  });

  useEffect(() => {
    if (!aiPanel) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;

      if (target && aiPanelRef.current?.contains(target)) {
        return;
      }

      setAiPanel(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAiPanel(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [aiPanel]);

  useEffect(() => {
    if (!aiPreview) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && aiPreview.status !== "applying") {
        setAiPreview(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [aiPreview]);

  const persistEditorDocument = (state: SaveState = "saved") => {
    const nextDocument = normalizeNoteContent(editor.document as unknown as NoteContent);

    seedChecklistStableOrderMap(nextDocument, checklistStableOrderRef.current);

    if (contentTimeoutRef.current) {
      window.clearTimeout(contentTimeoutRef.current);
      contentTimeoutRef.current = null;
    }

    onContentChange(nextDocument, state);
  };

  const getAiErrorMessage = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error ?? "");

    if (message === "GEMINI_API_KEY_MISSING") {
      return t("note.aiMissingKey");
    }

    if (message === "GEMINI_INPUT_EMPTY") {
      return t("note.aiEmptyInput");
    }

    if (
      message.includes("API key not valid") ||
      message.includes("API_KEY_INVALID") ||
      message.includes("PERMISSION_DENIED")
    ) {
      return t("note.aiInvalidKey");
    }

    if (message.includes("quota") || message.includes("RESOURCE_EXHAUSTED")) {
      return t("note.aiQuota");
    }

    return t("note.aiFailed");
  };

  const parseAiMarkdownToBlocks = async (markdown: string) => {
    const blocks = await Promise.resolve(editor.tryParseMarkdownToBlocks(markdown));

    if (!blocks.length) {
      throw new Error("GEMINI_EMPTY_RESPONSE");
    }

    return blocks as unknown as NoteContent;
  };

  const getAiInsertReferenceBlockId = (targetBlockIds: string[]) => {
    const targetBlockId = targetBlockIds.at(-1);

    if (targetBlockId) {
      return targetBlockId;
    }

    const documentBlocks = editor.document as unknown as StoredBlock[];
    const lastBlockId = documentBlocks.at(-1)?.id;

    return typeof lastBlockId === "string" ? lastBlockId : null;
  };

  const isFatalAiRequestError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error ?? "");

    return (
      message === "GEMINI_API_KEY_MISSING" ||
      message === "GEMINI_INPUT_EMPTY" ||
      message.includes("API key not valid") ||
      message.includes("API_KEY_INVALID") ||
      message.includes("PERMISSION_DENIED") ||
      message.includes("RESOURCE_EXHAUSTED") ||
      message.toLowerCase().includes("quota")
    );
  };

  const createAiPreviewState = (
    panelState: AiPanelState,
    blocks: NoteContent,
    intent: "replace" | "insert",
    action: GeminiAiAction,
    summary: string,
    warnings: string[],
    method: AiPreviewMethod
  ): AiPreviewState => {
    const canReplaceInline =
      intent === "replace" &&
      panelState.scope === "selection" &&
      Boolean(panelState.inlineRange) &&
      INLINE_AI_REPLACE_ACTIONS.has(action) &&
      panelState.targetBlockIds.length <= 1 &&
      blocks.length === 1;
    const inlineText = canReplaceInline ? extractPlainText(blocks).trim() : "";
    const shouldReplaceInline = canReplaceInline && inlineText.length > 0 && !inlineText.includes("\n");
    const applyMode: AiPreviewApplyMode =
      shouldReplaceInline ? "replaceInline" : intent === "insert" ? "insertBlocks" : "replaceBlocks";
    const beforeBlocks =
      applyMode === "replaceInline"
        ? createPlainPreviewBlocks(panelState.sourceMarkdown)
        : intent === "insert"
          ? []
          : panelState.targetBlocks.length > 0
            ? panelState.targetBlocks
            : panelState.sourceBlocks;
    const afterBlocks =
      applyMode === "replaceInline" && inlineText
        ? createPlainPreviewBlocks(inlineText)
        : blocks;

    return {
      status: "idle",
      action,
      scope: panelState.scope,
      applyMode,
      summary: summary || t("note.aiPreviewSummaryDefault"),
      warnings,
      beforeBlocks,
      afterBlocks,
      beforeStats: collectAiContentStats(beforeBlocks),
      afterStats: collectAiContentStats(afterBlocks),
      targetBlockIds: panelState.targetBlockIds,
      referenceBlockId:
        applyMode === "insertBlocks" ? getAiInsertReferenceBlockId(panelState.targetBlockIds) : null,
      inlineRange: applyMode === "replaceInline" ? panelState.inlineRange : null,
      inlineText: applyMode === "replaceInline" ? inlineText : null,
      error: null,
      fallbackUsed: method === "markdown-fallback",
      method
    };
  };

  const openAiPreview = (
    panelState: AiPanelState,
    blocks: NoteContent,
    intent: "replace" | "insert",
    action: GeminiAiAction,
    summary: string,
    warnings: string[],
    method: AiPreviewMethod
  ) => {
    setAiPreview(createAiPreviewState(panelState, blocks, intent, action, summary, warnings, method));
    setAiPanel(null);
  };

  const applyAiPreviewResult = (previewOverride?: AiPreviewState) => {
    const preview = previewOverride ?? aiPreview;

    if (!preview || preview.status === "applying") {
      return;
    }

    if (!previewOverride) {
      setAiPreview({
        ...preview,
        status: "applying",
        error: null
      });
    }

    try {
      editor.focus();
      editor.transact((tr) => {
        if (preview.applyMode === "replaceInline") {
          if (!preview.inlineRange || !preview.inlineText) {
            throw new Error("GEMINI_EMPTY_RESPONSE");
          }

          tr.setSelection(
            TextSelection.create(tr.doc, preview.inlineRange.from, preview.inlineRange.to)
          );
          editor.insertInlineContent(preview.inlineText, {
            updateSelection: true
          });
          return;
        }

        if (preview.applyMode === "insertBlocks") {
          if (preview.referenceBlockId) {
            editor.insertBlocks(preview.afterBlocks as any, preview.referenceBlockId, "after");
          } else {
            editor.replaceBlocks(editor.document as any, preview.afterBlocks as any);
          }
          return;
        }

        const targetBlockIds =
          preview.targetBlockIds.length > 0 ? preview.targetBlockIds : getRootBlockIds();

        if (targetBlockIds.length > 0) {
          editor.replaceBlocks(targetBlockIds, preview.afterBlocks as any);
        } else {
          editor.replaceBlocks(editor.document as any, preview.afterBlocks as any);
        }
      });

      persistEditorDocument("saved");
      setAiPreview(null);
    } catch (error) {
      if (previewOverride) {
        throw error;
      }

      setAiPreview((previous) =>
        previous
          ? {
              ...previous,
              status: "error",
              error: getAiErrorMessage(error)
            }
          : previous
      );
    }
  };

  const handleRunAiAction = async (action: GeminiAiAction) => {
    const currentPanel = aiPanel;

    if (
      !currentPanel ||
      currentPanel.status === "generating" ||
      currentPanel.status === "applying"
    ) {
      return;
    }

    const customPrompt = currentPanel.customPrompt.trim();
    const targetLanguage = currentPanel.targetLanguage.trim();
    const customMode = currentPanel.customMode;
    const shouldGenerateNew = action === "custom" && customMode === "generate";

    if (action === "custom" && !customPrompt) {
      setAiPanel({
        ...currentPanel,
        status: "error",
        error: t("note.aiPromptRequired")
      });
      return;
    }

    if (action === "translate" && !targetLanguage) {
      setAiPanel({
        ...currentPanel,
        status: "error",
        error: t("note.aiTargetLanguageRequired")
      });
      return;
    }

    const snapshot =
      currentPanel.scope === "note"
        ? getAiSourceSnapshot("note")
        : {
            markdown: currentPanel.sourceMarkdown,
            targetBlockIds: currentPanel.targetBlockIds,
            sourceBlocks: currentPanel.sourceBlocks,
            targetBlocks: currentPanel.targetBlocks,
            inlineRange: currentPanel.inlineRange
          };

    if (!shouldGenerateNew && !snapshot.markdown.trim()) {
      setAiPanel({
        ...currentPanel,
        status: "error",
        error: t("note.aiEmptyInput")
      });
      return;
    }

    if (!(await confirmPrivateVaultAction("ai"))) {
      return;
    }

    const nextPanelState = {
      ...currentPanel,
      status: "generating" as const,
      sourceMarkdown: snapshot.markdown,
      targetBlockIds: snapshot.targetBlockIds,
      sourceBlocks: snapshot.sourceBlocks,
      targetBlocks: snapshot.targetBlocks,
      inlineRange: snapshot.inlineRange,
      error: null
    };

    setAiPanel(nextPanelState);

    try {
      const apiKey = await readGeminiApiKey();
      const model = readStoredGeminiModel();
      const editorFormat = readStoredGeminiEditorFormat();
      const editorApplyMode = readStoredGeminiEditorApplyMode();
      const intent = shouldGenerateNew ? "insert" : "replace";
      let resultBlocks: NoteContent;
      let resultSummary = "";
      let resultWarnings: string[] = [];
      let resultMethod: AiPreviewMethod = editorFormat;

      if (editorFormat === "markdown") {
        const resultMarkdown = await generateGeminiMarkdown({
          apiKey,
          model,
          action,
          scope: currentPanel.scope,
          markdown: snapshot.markdown,
          appLanguage: language,
          noteTitle: titleDraft.trim() || note.title,
          customPrompt,
          customMode,
          targetLanguage
        });

        resultBlocks = await parseAiMarkdownToBlocks(resultMarkdown);
      } else {
        try {
          const structuredPayload = await generateGeminiStructuredEdit({
            apiKey,
            model,
            action,
            scope: currentPanel.scope,
            markdown: snapshot.markdown,
            appLanguage: language,
            noteTitle: titleDraft.trim() || note.title,
            customPrompt,
            customMode,
            targetLanguage,
            editorBlocks: snapshot.sourceBlocks,
            intent
          });
          const sanitizedPayload = sanitizeAiStructuredEditPayload(structuredPayload, {
            fallbackSummary: t("note.aiPreviewSummaryDefault")
          });

          resultBlocks = sanitizedPayload.blocks;
          resultSummary = sanitizedPayload.summary;
          resultWarnings = sanitizedPayload.warnings;
        } catch (structuredError) {
          if (isFatalAiRequestError(structuredError)) {
            throw structuredError;
          }

          console.warn("Gemini structured editor output failed; falling back to Markdown.", structuredError);

          const resultMarkdown = await generateGeminiMarkdown({
            apiKey,
            model,
            action,
            scope: currentPanel.scope,
            markdown: snapshot.markdown,
            appLanguage: language,
            noteTitle: titleDraft.trim() || note.title,
            customPrompt,
            customMode,
            targetLanguage
          });

          resultBlocks = await parseAiMarkdownToBlocks(resultMarkdown);
          resultWarnings = [t("note.aiPreviewMarkdownFallback")];
          resultMethod = "markdown-fallback";
        }
      }

      if (editorApplyMode === "instant") {
        setAiPanel({
          ...nextPanelState,
          status: "applying"
        });
        applyAiPreviewResult(
          createAiPreviewState(
            nextPanelState,
            resultBlocks,
            intent,
            action,
            resultSummary,
            resultWarnings,
            resultMethod
          )
        );
        setAiPanel(null);
      } else {
        openAiPreview(
          nextPanelState,
          resultBlocks,
          intent,
          action,
          resultSummary,
          resultWarnings,
          resultMethod
        );
      }
    } catch (error) {
      setAiPanel((previous) =>
        previous
          ? {
              ...previous,
              status: "error",
              error: getAiErrorMessage(error)
            }
          : previous
      );
    }
  };

  useEffect(() => {
    latestTitleDraftRef.current = titleDraft;
  }, [titleDraft]);

  useEffect(() => {
    return editor.onBeforeChange(({ getChanges }) => {
      if (!getChanges().some((change) => change.source.type === "paste")) {
        return;
      }

      pendingEmptyInlinePasteRestoreRef.current =
        getCurrentEmptyInlinePasteRestoreSnapshot(editor);
    });
  }, [editor]);

  useEffect(() => {
    let cancelled = false;
    let removeEditorDomListeners: (() => void) | null = null;
    let animationFrameId: number | null = null;
    let styleContinuationFrameId: number | null = null;

    const handlePasteCapture = (event: ClipboardEvent) => {
      pasteTextIntoEmptyInlineBlock(editor, event);
    };

    const handleKeyDownCapture = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !isCommitEnterKey(event) ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }

      const styleSeed = getListContinuationStyleSeed(editor);

      if (!styleSeed) {
        return;
      }

      if (styleContinuationFrameId !== null) {
        window.cancelAnimationFrame(styleContinuationFrameId);
      }

      styleContinuationFrameId = window.requestAnimationFrame(() => {
        styleContinuationFrameId = null;

        if (!cancelled) {
          applyListContinuationStyleSeed(editor, styleSeed);
        }
      });
    };

    const attachPasteCaptureListener = () => {
      if (cancelled || removeEditorDomListeners) {
        return;
      }

      const editorElement = editor.domElement;

      if (!editorElement) {
        animationFrameId = window.requestAnimationFrame(attachPasteCaptureListener);
        return;
      }

      editorElement.addEventListener("paste", handlePasteCapture, {
        capture: true
      });
      editorElement.addEventListener("keydown", handleKeyDownCapture, {
        capture: true
      });
      removeEditorDomListeners = () => {
        editorElement.removeEventListener("paste", handlePasteCapture, {
          capture: true
        });
        editorElement.removeEventListener("keydown", handleKeyDownCapture, {
          capture: true
        });
      };
    };

    attachPasteCaptureListener();

    return () => {
      cancelled = true;

      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }

      if (styleContinuationFrameId !== null) {
        window.cancelAnimationFrame(styleContinuationFrameId);
      }

      removeEditorDomListeners?.();
    };
  }, [editor]);

  useEffect(() => {
    latestStoredTitleRef.current = note.title;
  }, [note.title]);

  useEffect(() => {
    latestEditorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    latestOnContentChangeRef.current = onContentChange;
  }, [onContentChange]);

  useEffect(() => {
    latestOnTitleChangeRef.current = onTitleChange;
  }, [onTitleChange]);

  const handleEditorChange = () => {
    if (isApplyingChecklistTransformRef.current) {
      isApplyingChecklistTransformRef.current = false;
      return;
    }

    const pasteRestore = restorePastedEmptyInlineBlockType(
      editor.document as unknown as NoteContent,
      pendingEmptyInlinePasteRestoreRef.current
    );
    pendingEmptyInlinePasteRestoreRef.current = null;
    const nextDocument = pasteRestore.changed
      ? pasteRestore.blocks
      : (editor.document as unknown as NoteContent);
    seedChecklistStableOrderMap(nextDocument, checklistStableOrderRef.current);
    const checklistNormalization = normalizeChecklistOrdering(nextDocument, (block, fallbackIndex) => {
      const blockId = typeof block.id === "string" ? block.id : null;

      if (!blockId) {
        return fallbackIndex;
      }

      const knownOrder = checklistStableOrderRef.current.get(blockId);

      if (typeof knownOrder === "number") {
        return knownOrder;
      }

      const assignedOrder = checklistStableOrderRef.current.size;
      checklistStableOrderRef.current.set(blockId, assignedOrder);
      return assignedOrder;
    });
    const contentToPersist = checklistNormalization.changed
      ? checklistNormalization.blocks
      : nextDocument;

    if (contentTimeoutRef.current) {
      window.clearTimeout(contentTimeoutRef.current);
    }

    if (pasteRestore.changed || checklistNormalization.changed) {
      isApplyingChecklistTransformRef.current = true;
      editor.replaceBlocks(editor.document as any, contentToPersist as any);
    }

    onContentChange(contentToPersist, "saving");

    contentTimeoutRef.current = window.setTimeout(() => {
      onContentChange(contentToPersist, "saved");
    }, 280);
  };

  const handleTitleChange = (value: string) => {
    setTitleDraft(value);

    if (titleTimeoutRef.current) {
      window.clearTimeout(titleTimeoutRef.current);
    }

    titleTimeoutRef.current = window.setTimeout(() => {
      onTitleChange(value.trim());
      titleTimeoutRef.current = null;
    }, 220);
  };

  const flushTitleDraft = () => {
    if (titleTimeoutRef.current) {
      window.clearTimeout(titleTimeoutRef.current);
      titleTimeoutRef.current = null;
    }

    const normalizedTitle = latestTitleDraftRef.current.trim();

    if (normalizedTitle !== latestStoredTitleRef.current.trim()) {
      latestOnTitleChangeRef.current(normalizedTitle);
    }
  };

  const showMarkdownStatus = (status: Exclude<MarkdownStatus, null>) => {
    setNoteTransferStatus({
      tone: status === "error" ? "error" : "success",
      text: t(`note.markdownStatus.${status}`)
    });

    if (markdownStatusTimeoutRef.current) {
      window.clearTimeout(markdownStatusTimeoutRef.current);
    }

    markdownStatusTimeoutRef.current = window.setTimeout(() => {
      setNoteTransferStatus(null);
      markdownStatusTimeoutRef.current = null;
    }, 2400);
  };

  const getMarkdown = () => editor.blocksToMarkdownLossy(editor.document as any);

  const getCurrentExportNote = (): Note => {
    const content = editor.document as unknown as NoteContent;

    return {
      ...note,
      title: titleDraft.trim() || note.title,
      content,
      plainText: extractPlainText(content),
      excerpt: extractPlainText(content).slice(0, 180)
    };
  };

  const handleCopyMarkdown = async () => {
    if (!(await confirmPrivateVaultAction("export"))) {
      return;
    }

    setNoteTransferBusy("copy");

    try {
      await navigator.clipboard.writeText(getMarkdown());
      showMarkdownStatus("copied");
    } catch {
      showMarkdownStatus("error");
    } finally {
      setNoteTransferBusy(null);
    }
  };

  const saveNoteExportBlob = async (input: {
    blob: Blob;
    fileName: string;
    filterName: string;
    extensions: string[];
    preferredExtension: string;
  }) => {
    return saveBlobFileWithDialog({
      defaultPath: input.fileName,
      filters: [
        {
          name: input.filterName,
          extensions: input.extensions
        }
      ],
      blob: input.blob,
      preferredExtension: input.preferredExtension
    });
  };

  const handleExportNote = async (format: NoteExportFormat) => {
    if (!(await confirmPrivateVaultAction("export"))) {
      return;
    }

    setNoteTransferBusy(format);
    setNoteTransferStatus(null);

    try {
      const exportNote = getCurrentExportNote();
      const baseName = getNoteExportBaseName(exportNote, language);
      const markdown = getMarkdown();
      const exportMap: Record<NoteExportFormat, {
        fileName: string;
        filterName: string;
        extensions: string[];
        preferredExtension: string;
        createBlob: () => Blob | Promise<Blob>;
      }> = {
        markdown: {
          fileName: `${baseName}.md`,
          filterName: "Markdown",
          extensions: ["md", "markdown"],
          preferredExtension: "md",
          createBlob: () =>
            new Blob([createNoteMarkdown({ note: exportNote, markdown })], {
              type: "text/markdown;charset=utf-8"
            })
        },
        html: {
          fileName: `${baseName}.html`,
          filterName: "HTML",
          extensions: ["html", "htm"],
          preferredExtension: "html",
          createBlob: () => createNoteHtmlBlob({ note: exportNote, language, markdown })
        },
        pdf: {
          fileName: `${baseName}.pdf`,
          filterName: "PDF",
          extensions: ["pdf"],
          preferredExtension: "pdf",
          createBlob: () => createNotePdfBlob({ note: exportNote, language, markdown })
        },
        docx: {
          fileName: `${baseName}.docx`,
          filterName: "Word",
          extensions: ["docx"],
          preferredExtension: "docx",
          createBlob: () => createNoteDocxBlob({ note: exportNote, language, markdown, assets })
        }
      };
      const exportConfig = exportMap[format];
      const didSave = await saveNoteExportBlob({
        blob: await exportConfig.createBlob(),
        fileName: exportConfig.fileName,
        filterName: exportConfig.filterName,
        extensions: exportConfig.extensions,
        preferredExtension: exportConfig.preferredExtension
      });

      if (!didSave) {
        return;
      }

      showMarkdownStatus("exported");
    } catch {
      showMarkdownStatus("error");
    } finally {
      setNoteTransferBusy(null);
    }
  };

  const applyMarkdownImport = async (markdown: string) => {
    setNoteTransferBusy("import");

    try {
      const blocks = await Promise.resolve(editor.tryParseMarkdownToBlocks(markdown));

      editor.replaceBlocks(editor.document as any, blocks as any);
      onContentChange(blocks as unknown as NoteContent, "saved");
      setPendingMarkdownImport(null);
      setNoteTransferOpen(false);
      showMarkdownStatus("imported");
    } catch {
      showMarkdownStatus("error");
    } finally {
      setNoteTransferBusy(null);
    }
  };

  const handleImportMarkdown = async () => {
    setNoteTransferBusy("import");
    setNoteTransferStatus(null);

    const importedFile = await openTextFileWithDialog({
      filters: [
        {
          name: "Markdown",
          extensions: ["md", "markdown", "txt"]
        }
      ]
    });

    if (!importedFile) {
      setNoteTransferBusy(null);
      return;
    }

    try {
      const { fileName, text } = importedFile;

      if (getMarkdown().trim().length > 0) {
        setPendingMarkdownImport({ fileName, markdown: text });
        setNoteTransferBusy(null);
        return;
      }

      await applyMarkdownImport(text);
    } catch {
      showMarkdownStatus("error");
      setNoteTransferBusy(null);
    }
  };

  const getMobileBlockCarryProps = (block: StoredBlock) => {
    const sourceProps = block.props ?? {};
    const nextProps: Record<string, unknown> = {};

    for (const key of ["textColor", "backgroundColor", "textAlignment"]) {
      if (key in sourceProps) {
        nextProps[key] = sourceProps[key];
      }
    }

    return nextProps;
  };

  const applyMobileQuickBlock = (type: MobileQuickBlockType) => {
    try {
      const activeBlock = editor.getTextCursorPosition().block as unknown as StoredBlock;

      if (typeof activeBlock.id !== "string") {
        return;
      }

      const preservedProps = getMobileBlockCarryProps(activeBlock);
      const nextBlock: StoredBlock = {
        type,
        props:
          type === "heading"
            ? { ...preservedProps, level: 2 }
            : type === "checkListItem"
              ? { ...preservedProps, checked: Boolean(activeBlock.props?.checked) }
              : preservedProps
      };

      editor.updateBlock(activeBlock.id, nextBlock as any);
      editor.setTextCursorPosition(activeBlock.id, "end");
    } catch {
      // Mobile quick actions are best-effort; BlockNote keeps the current edit state.
    }
  };

  const getMobileQuickBlockLabel = (type: MobileQuickBlockType) => {
    switch (type) {
      case "heading":
        return t("note.mobileHeading");
      case "bulletListItem":
        return t("note.mobileBulletList");
      case "numberedListItem":
        return t("note.mobileNumberedList");
      case "checkListItem":
        return t("note.mobileChecklist");
      case "quote":
        return t("note.mobileQuote");
      case "paragraph":
      default:
        return t("note.mobileParagraph");
    }
  };

  const getMobileQuickBlockGlyph = (type: MobileQuickBlockType) => {
    switch (type) {
      case "heading":
        return "H";
      case "bulletListItem":
        return "-";
      case "numberedListItem":
        return "1";
      case "checkListItem":
        return "[]";
      case "quote":
        return ">";
      case "paragraph":
      default:
        return "P";
    }
  };

  const getMobileInsertBlockCopy = (type: MobileInsertBlockType) => {
    const slashKey = MOBILE_INSERT_BLOCK_SLASH_KEYS[type];
    const slashItem = (
      editor.dictionary.slash_menu as Record<string, { title?: string; subtext?: string }>
    )[slashKey];

    return {
      title: slashItem?.title ?? getMobileQuickBlockLabel(type as MobileQuickBlockType),
      subtext: slashItem?.subtext ?? ""
    };
  };

  const getMobileInsertBlockGlyph = (type: MobileInsertBlockType) =>
    MOBILE_INSERT_BLOCK_GLYPHS[type] ?? "T";

  const buildMobileInsertBlock = (type: MobileInsertBlockType, sourceBlock: StoredBlock) => {
    const preservedProps = getMobileBlockCarryProps(sourceBlock);

    if (type === "heading") {
      return {
        type: "heading",
        props: { ...preservedProps, level: 2 },
        content: ""
      } as StoredBlock;
    }

    if (type.startsWith("heading")) {
      const level = Number(type.replace("heading", "")) || 2;

      return {
        type: "heading",
        props: { ...preservedProps, level },
        content: ""
      } as StoredBlock;
    }

    if (type.startsWith("toggleHeading")) {
      const level = Number(type.replace("toggleHeading", "")) || 2;

      return {
        type: "heading",
        props: { ...preservedProps, level, isToggleable: true },
        content: ""
      } as StoredBlock;
    }

    if (type === "checkListItem") {
      return {
        type,
        props: { ...preservedProps, checked: false },
        content: ""
      } as StoredBlock;
    }

    if (type === "codeBlock") {
      return {
        type,
        props: { language: "text" },
        content: ""
      } as StoredBlock;
    }

    if (type === "table") {
      return {
        type,
        props: typeof preservedProps.textColor === "string"
          ? { textColor: preservedProps.textColor }
          : {},
        content: {
          type: "tableContent",
          rows: [
            { cells: ["", "", ""] },
            { cells: ["", "", ""] }
          ]
        }
      } as StoredBlock;
    }

    if (type === "divider") {
      return {
        type,
        props: {}
      } as StoredBlock;
    }

    if (MOBILE_INSERT_MEDIA_BLOCK_TYPES.has(type)) {
      return {
        type,
        props: {}
      } as StoredBlock;
    }

    return {
      type,
      props: preservedProps,
      content: ""
    } as StoredBlock;
  };

  const insertMobileBlockAfterCursor = (type: MobileInsertBlockType) => {
    try {
      const activeBlock = editor.getTextCursorPosition().block as unknown as StoredBlock;
      const insertedBlocks = editor.insertBlocks(
        [buildMobileInsertBlock(type, activeBlock) as any],
        activeBlock as any,
        "after"
      );
      const insertedBlock = insertedBlocks[0] as StoredBlock | undefined;

      if (typeof insertedBlock?.id === "string" && MOBILE_INSERT_CURSOR_BLOCK_TYPES.has(type)) {
        editor.setTextCursorPosition(insertedBlock.id, "end");
      }

      if (typeof insertedBlock?.id === "string" && MOBILE_INSERT_MEDIA_BLOCK_TYPES.has(type)) {
        window.setTimeout(() => {
          editor.getExtension(FilePanelExtension)?.showMenu(insertedBlock.id as string);
        }, 0);
      }

      setMobileInsertMenuOpen(false);
    } catch {
      // The slash menu and regular Enter behavior remain available.
    }
  };

  const showMobileFormattingToolbar = () => {
    try {
      editor.focus();
      editor.getExtension(FormattingToolbarExtension)?.store.setState(true);
    } catch {
      // Formatting toolbar visibility is controlled by BlockNote when unavailable.
    }
  };

  useEffect(() => {
    return () => {
      if (titleTimeoutRef.current) {
        window.clearTimeout(titleTimeoutRef.current);
      }

      if (contentTimeoutRef.current) {
        window.clearTimeout(contentTimeoutRef.current);
        if (latestEditorRef.current) {
          latestOnContentChangeRef.current(
            latestEditorRef.current.document as unknown as NoteContent,
            "saved"
          );
        }
      }

	      if (markdownStatusTimeoutRef.current) {
	        window.clearTimeout(markdownStatusTimeoutRef.current);
	      }

	      if (taskStatusTimeoutRef.current) {
	        window.clearTimeout(taskStatusTimeoutRef.current);
	      }

	      if (latestTitleDraftRef.current !== latestStoredTitleRef.current) {
        latestOnTitleChangeRef.current(latestTitleDraftRef.current.trim());
      }
    };
  }, []);

  const aiPanelBusy = aiPanel?.status === "generating" || aiPanel?.status === "applying";
  const androidBackLayer = aiPreview
    ? "ai-preview"
    : aiPanel
      ? "ai-panel"
      : pendingMarkdownImport
        ? "markdown-import"
        : noteTransferOpen
          ? "transfer"
          : mobileInsertMenuOpen
            ? "mobile-insert-menu"
            : mobileNoteMenuOpen
              ? "mobile-note-menu"
              : null;

  useAndroidBackHandler(Boolean(androidBackLayer), () => {
    if (androidBackLayer === "ai-preview") {
      if (aiPreview?.status !== "applying") {
        setAiPreview(null);
      }

      return;
    }

    if (androidBackLayer === "ai-panel") {
      setAiPanel(null);
      return;
    }

    if (androidBackLayer === "markdown-import") {
      setPendingMarkdownImport(null);
      return;
    }

    if (androidBackLayer === "transfer") {
      setNoteTransferOpen(false);
      return;
    }

    if (androidBackLayer === "mobile-insert-menu") {
      setMobileInsertMenuOpen(false);
      return;
    }

    if (androidBackLayer === "mobile-note-menu") {
      setMobileNoteMenuOpen(false);
    }
  });

  return (
    <section
      className={`editor-pane ${immersive ? "is-immersive" : ""} ${
        typographyMode === "reading" ? "is-reading" : ""
      } ${mobileNoteMenuOpen ? "is-mobile-note-menu-open" : ""}`}
      style={{ "--note-accent": note.color || DEFAULT_NOTE_COLOR } as CSSProperties}
    >
	      <div className="editor-pane-mobile-header">
        <button
          type="button"
          className="editor-pane-mobile-icon-action"
          onClick={onClose}
          aria-label={t("note.mobileBack")}
          title={t("note.mobileBack")}
        >
          <MobileBackGlyph />
        </button>

        <input
          value={titleDraft}
          onChange={(event) => handleTitleChange(event.target.value)}
          onFocus={() => {
            isTitleFieldFocusedRef.current = true;
          }}
          onBlur={() => {
            isTitleFieldFocusedRef.current = false;
            flushTitleDraft();
          }}
          className="note-title-input editor-pane-mobile-title-field"
          placeholder={t("note.titlePlaceholder")}
        />

        <button
          type="button"
          className="editor-pane-mobile-ai-action"
          onClick={() => openAiPanel("note")}
          aria-label={t("note.aiNote")}
          title={t("note.aiNote")}
        >
          <AiSparkleGlyph />
        </button>

        <div
          className="editor-pane-mobile-mode-switch"
          role="group"
          aria-label={t("note.typographyMode")}
        >
          <button
            type="button"
            className={typographyMode === "focus" ? "is-active" : ""}
            aria-label={t("note.typographyFocus")}
            aria-pressed={typographyMode === "focus"}
            title={t("note.typographyFocus")}
            onClick={() => setTypographyMode("focus")}
          >
            <MobileFocusModeGlyph />
          </button>
          <button
            type="button"
            className={typographyMode === "reading" ? "is-active" : ""}
            aria-label={t("note.typographyReading")}
            aria-pressed={typographyMode === "reading"}
            title={t("note.typographyReading")}
            onClick={() => setTypographyMode("reading")}
          >
            <MobileReadingModeGlyph />
          </button>
        </div>

        <button
          type="button"
          className="editor-pane-mobile-icon-action"
          onClick={() => setMobileNoteMenuOpen(true)}
          aria-label={t("note.mobileMore")}
          title={t("note.mobileMore")}
        >
          <MobileMoreGlyph />
	        </button>
	      </div>

	      {taskCreationStatus ? (
	        <div className={`editor-pane-mobile-task-toast is-${taskCreationStatus.tone}`} role="status">
	          {taskCreationStatus.text}
	        </div>
	      ) : null}

	      <div className="editor-pane-toolbar">
        <div className="editor-pane-toolbar-main">
          <div className="editor-pane-title-stack">
            <div className="editor-pane-title-row">
              <input
                value={titleDraft}
                onChange={(event) => handleTitleChange(event.target.value)}
                onFocus={() => {
                  isTitleFieldFocusedRef.current = true;
                }}
                onBlur={() => {
                  isTitleFieldFocusedRef.current = false;
                  flushTitleDraft();
                }}
                className="note-title-input editor-pane-title-field"
                placeholder={t("note.titlePlaceholder")}
              />

              <div className="editor-pane-markdown-actions" aria-label={t("note.markdownActions")}>
                <button
                  type="button"
                  className="editor-pane-ghost-action editor-pane-transfer-action"
                  onClick={() => setNoteTransferOpen(true)}
                >
                  {t("note.transferButton")}
                </button>
              </div>
            </div>

            <div className="editor-pane-toolbar-meta">
              <div
                className="editor-pane-typography-switch"
                role="group"
                aria-label={t("note.typographyMode")}
              >
                <button
                  type="button"
                  className={`editor-pane-typography-option ${
                    typographyMode === "focus" ? "is-active" : ""
                  }`}
                  aria-pressed={typographyMode === "focus"}
                  onClick={() => setTypographyMode("focus")}
                >
                  {t("note.typographyFocus")}
                </button>
                <button
                  type="button"
                  className={`editor-pane-typography-option ${
                    typographyMode === "reading" ? "is-active" : ""
                  }`}
                  aria-pressed={typographyMode === "reading"}
                  onClick={() => setTypographyMode("reading")}
                >
                  {t("note.typographyReading")}
                </button>
              </div>
              <span className={`editor-pane-chip editor-pane-save-pill is-${saveState}`}>
                {t(`saveState.${saveState}`)}
              </span>
              <span className="editor-pane-chip">
                {currentFolder?.name ?? t("orbit.uncategorized")}
              </span>
              {note.tagIds.length > 0 ? (
                <span className="editor-pane-chip">
                  {note.tagIds.length} {t("note.tags").toLowerCase()}
                </span>
              ) : null}
              {note.pinned || note.favorite ? (
                <span className="editor-pane-chip is-warm">{t("note.pinnedActive")}</span>
              ) : null}
              <span className="editor-pane-contextmeta">
                {t("note.updated")}: {formatTimestamp(note.updatedAt)}
              </span>
	              <button
	                type="button"
	                className="editor-pane-ai-trigger"
                onClick={(event) =>
                  openAiPanel("note", event.currentTarget.getBoundingClientRect())
                }
                aria-label={t("note.aiNote")}
                title={t("note.aiNote")}
              >
                <span className="editor-pane-ai-trigger-glyph" aria-hidden="true">
                  <AiSparkleGlyph />
                </span>
	                <span>{t("note.aiShort")}</span>
	              </button>
	              {onCreateTaskFromContext ? (
	                <button
	                  type="button"
	                  className="editor-pane-task-trigger"
	                  onClick={() => void handleCreateTaskFromEditor("note")}
	                  aria-label={t("note.createTaskFromNote")}
	                  title={t("note.createTaskFromNote")}
	                >
	                  <span className="editor-pane-task-trigger-glyph" aria-hidden="true" />
	                  <span>{t("note.createTaskShort")}</span>
	                </button>
	              ) : null}
	              {taskCreationStatus ? (
	                <span className={`editor-pane-chip editor-pane-task-status is-${taskCreationStatus.tone}`}>
	                  {taskCreationStatus.text}
	                </span>
	              ) : null}
	            </div>
          </div>
        </div>
      </div>

      <NoteTransferModal
        open={noteTransferOpen}
        status={noteTransferStatus}
        busyFormat={noteTransferBusy}
        onClose={() => setNoteTransferOpen(false)}
        onCopyMarkdown={() => void handleCopyMarkdown()}
        onExport={(format) => void handleExportNote(format)}
        onImportMarkdown={() => void handleImportMarkdown()}
      />

      <ConfirmDialog
        open={Boolean(pendingMarkdownImport)}
        kicker={t("note.importMarkdown")}
        title={t("note.importMarkdownTitle")}
        message={
          pendingMarkdownImport
            ? t("note.importMarkdownMessage", {
                fileName: pendingMarkdownImport.fileName
              })
            : ""
        }
        confirmLabel={t("note.replaceWithMarkdown")}
        cancelLabel={t("dialog.cancel")}
        onCancel={() => setPendingMarkdownImport(null)}
        onConfirm={() => {
          if (!pendingMarkdownImport) {
            return;
          }

          void applyMarkdownImport(pendingMarkdownImport.markdown);
        }}
      />

      {privateVaultWarningDialog}

      {aiPreview ? (
        <div className="editor-ai-preview-layer" role="presentation">
          <button
            type="button"
            className="editor-ai-preview-backdrop"
            aria-label={t("note.aiPreviewCancel")}
            onClick={() => {
              if (aiPreview.status !== "applying") {
                setAiPreview(null);
              }
            }}
          />
          <section
            className="editor-ai-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="editor-ai-preview-title"
          >
            <header className="editor-ai-preview-header">
              <div>
                <p className="editor-ai-preview-kicker">{t("note.aiPreviewKicker")}</p>
                <h3 id="editor-ai-preview-title">{t("note.aiPreviewTitle")}</h3>
                <p>{aiPreview.summary}</p>
              </div>
              <button
                type="button"
                className="editor-ai-preview-close"
                onClick={() => setAiPreview(null)}
                disabled={aiPreview.status === "applying"}
                aria-label={t("note.aiClose")}
              >
                <CloseGlyph />
              </button>
            </header>

            <div className="editor-ai-preview-meta">
              <span>
                {aiPreview.applyMode === "insertBlocks"
                  ? t("note.aiPreviewInsertMode")
                  : aiPreview.applyMode === "replaceInline"
                    ? t("note.aiPreviewInlineMode")
                    : t("note.aiPreviewReplaceMode")}
              </span>
              <span>
                {t("note.aiPreviewStats", {
                  beforeBlocks: aiPreview.beforeStats.blocks,
                  afterBlocks: aiPreview.afterStats.blocks,
                  beforeWords: aiPreview.beforeStats.words,
                  afterWords: aiPreview.afterStats.words
                })}
              </span>
              <span className={`editor-ai-preview-method is-${aiPreview.method}`}>
                {aiPreview.method === "rich-json"
                  ? t("note.aiPreviewMethodRichJson")
                  : aiPreview.method === "markdown"
                    ? t("note.aiPreviewMethodMarkdown")
                    : t("note.aiPreviewFallbackBadge")}
              </span>
            </div>

            {aiPreview.warnings.length > 0 ? (
              <div className="editor-ai-preview-warnings">
                {aiPreview.warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            ) : null}

            <div className="editor-ai-preview-grid">
              <section className="editor-ai-preview-card">
                <div className="editor-ai-preview-card-title">
                  <span>{t("note.aiPreviewBefore")}</span>
                  <span>{t("note.aiPreviewBlocksCount", { count: aiPreview.beforeStats.blocks })}</span>
                </div>
                <div className="editor-ai-preview-scroll">
                  <NoteStaticPreview
                    content={aiPreview.beforeBlocks}
                    emptyLabel={t("note.aiPreviewEmptyBefore")}
                    resolveFileUrl={onResolveFileUrl}
                    compact
                  />
                </div>
              </section>

              <section className="editor-ai-preview-card is-after">
                <div className="editor-ai-preview-card-title">
                  <span>{t("note.aiPreviewAfter")}</span>
                  <span>{t("note.aiPreviewBlocksCount", { count: aiPreview.afterStats.blocks })}</span>
                </div>
                <div className="editor-ai-preview-scroll">
                  <NoteStaticPreview
                    content={aiPreview.afterBlocks}
                    emptyLabel={t("note.aiPreviewEmptyAfter")}
                    resolveFileUrl={onResolveFileUrl}
                    compact
                  />
                </div>
              </section>
            </div>

            {aiPreview.error ? (
              <p className="editor-ai-preview-message is-error">{aiPreview.error}</p>
            ) : null}

            <footer className="editor-ai-preview-footer">
              <button
                type="button"
                className="editor-ai-preview-secondary"
                onClick={() => setAiPreview(null)}
                disabled={aiPreview.status === "applying"}
              >
                {t("note.aiPreviewCancel")}
              </button>
              <button
                type="button"
                className="editor-ai-preview-primary"
                onClick={() => applyAiPreviewResult()}
                disabled={aiPreview.status === "applying"}
              >
                {aiPreview.status === "applying" ? t("note.aiApplying") : t("note.aiPreviewApply")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {aiPanel ? (
        <>
          <button
            type="button"
            className="editor-ai-mobile-backdrop"
            aria-label={t("note.aiClose")}
            onClick={() => {
              if (!aiPanelBusy) {
                setAiPanel(null);
              }
            }}
          />
          <div
            ref={aiPanelRef}
            className={`editor-ai-panel ${aiPanel.anchor ? "is-floating" : "is-docked"} is-${
              aiPanel.scope
            } is-${aiPanel.anchor?.placement ?? "bottom"}`}
            style={
              aiPanel.anchor
                ? ({
                    top: aiPanel.anchor.top,
                    left: aiPanel.anchor.left
                  } as CSSProperties)
                : undefined
            }
          >
          <div className="editor-ai-prompt-card">
            <span className="editor-ai-prompt-icon" aria-hidden="true">
              <AiSparkleGlyph />
            </span>
            <textarea
              value={aiPanel.customPrompt}
              onChange={(event) =>
                setAiPanel((previous) =>
                  previous
                    ? {
                        ...previous,
                        customPrompt: event.target.value,
                        error: null
                      }
                    : previous
                )
              }
              onKeyDown={(event) => {
                if (isCommitEnterKey(event) && !event.shiftKey) {
                  event.preventDefault();
                  void handleRunAiAction("custom");
                }
              }}
              placeholder={t("note.aiPromptPlaceholder")}
              aria-label={t("note.aiCustomPrompt")}
              rows={1}
              disabled={aiPanelBusy}
            />
            <button
              type="button"
              className="editor-ai-prompt-run"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void handleRunAiAction("custom")}
              disabled={aiPanelBusy}
              aria-label={t("note.aiRun")}
              title={t("note.aiRun")}
            >
              <AiArrowGlyph />
            </button>
          </div>

          <div className="editor-ai-command-card">
            <div
              className="editor-ai-mode-switch"
              role="group"
              aria-label={t("note.aiModeLabel")}
            >
              <button
                type="button"
                className={`editor-ai-mode-pill ${
                  aiPanel.customMode === "edit" ? "is-active" : ""
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() =>
                  setAiPanel((previous) =>
                    previous
                      ? {
                          ...previous,
                          customMode: "edit",
                          error: null
                        }
                      : previous
                  )
                }
                disabled={aiPanelBusy}
              >
                {t("note.aiModeEdit")}
              </button>
              <button
                type="button"
                className={`editor-ai-mode-pill ${
                  aiPanel.customMode === "generate" ? "is-active" : ""
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() =>
                  setAiPanel((previous) =>
                    previous
                      ? {
                          ...previous,
                          customMode: "generate",
                          error: null
                        }
                      : previous
                  )
                }
                disabled={aiPanelBusy}
              >
                {t("note.aiModeGenerate")}
              </button>
            </div>

            <div className="editor-ai-command-list">
              <button
                type="button"
                className="editor-ai-command-row"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void handleRunAiAction("beautify")}
                disabled={aiPanelBusy}
              >
                <span className="editor-ai-command-icon" aria-hidden="true">
                  <AiSparkleGlyph />
                </span>
                <span>{t("note.aiBeautify")}</span>
              </button>
              <button
                type="button"
                className="editor-ai-command-row"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void handleRunAiAction("improve")}
                disabled={aiPanelBusy}
              >
                <span className="editor-ai-command-icon" aria-hidden="true">
                  <AiTextGlyph />
                </span>
                <span>{t("note.aiImprove")}</span>
              </button>
              <button
                type="button"
                className="editor-ai-command-row"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void handleRunAiAction("fix")}
                disabled={aiPanelBusy}
              >
                <span className="editor-ai-command-icon" aria-hidden="true">
                  <AiCheckGlyph />
                </span>
                <span>{t("note.aiFix")}</span>
              </button>
              <div className="editor-ai-command-row editor-ai-translate-row">
                <button
                  type="button"
                  className="editor-ai-command-main"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void handleRunAiAction("translate")}
                  disabled={aiPanelBusy}
                >
                  <span className="editor-ai-command-icon" aria-hidden="true">
                    <AiGlobeGlyph />
                  </span>
                  <span>{t("note.aiTranslate")}</span>
                </button>
                <input
                  type="text"
                  value={aiPanel.targetLanguage}
                  onChange={(event) =>
                    setAiPanel((previous) =>
                      previous
                        ? {
                            ...previous,
                            targetLanguage: event.target.value,
                            error: null
                          }
                        : previous
                    )
                  }
                  onKeyDown={(event) => {
                    if (isCommitEnterKey(event)) {
                      event.preventDefault();
                      void handleRunAiAction("translate");
                    }
                  }}
                  placeholder={t("note.aiTargetLanguagePlaceholder")}
                  disabled={aiPanelBusy}
                />
              </div>
            </div>

            {aiPanel.status === "generating" ? (
              <p className="editor-ai-message is-muted">{t("note.aiGenerating")}</p>
            ) : null}
            {aiPanel.status === "applying" ? (
              <p className="editor-ai-message is-muted">{t("note.aiApplying")}</p>
            ) : null}
            {aiPanel.error ? (
              <p className="editor-ai-message is-error">{aiPanel.error}</p>
            ) : null}
          </div>
          </div>
        </>
      ) : null}

      {mobileNoteMenuOpen ? (
        <button
          type="button"
          className="editor-pane-mobile-sheet-backdrop"
          aria-label={t("dialog.cancel")}
          onClick={() => setMobileNoteMenuOpen(false)}
        />
      ) : null}

      {mobileInsertMenuOpen ? (
        <div className="editor-pane-mobile-insert-layer" role="presentation">
          <button
            type="button"
            className="editor-pane-mobile-insert-backdrop"
            aria-label={t("dialog.cancel")}
            onClick={() => setMobileInsertMenuOpen(false)}
          />
          <section
            className="editor-pane-mobile-insert-menu"
            role="dialog"
            aria-modal="true"
            aria-label={t("note.mobileInsertMenuTitle")}
          >
            <div className="editor-pane-mobile-insert-head">
              <span>{t("note.mobileInsertMenuTitle")}</span>
              <p>{t("note.mobileInsertMenuSubtitle")}</p>
            </div>
            <div className="editor-pane-mobile-insert-scroll">
              {MOBILE_INSERT_BLOCK_GROUPS.map((group) => (
                <section key={group.key} className="editor-pane-mobile-insert-group">
                  <h3>{t(group.titleKey)}</h3>
                  <div className="editor-pane-mobile-insert-grid">
                    {group.items.map((type) => {
                      const copy = getMobileInsertBlockCopy(type);

                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => insertMobileBlockAfterCursor(type)}
                        >
                          <span className="editor-pane-mobile-insert-glyph">
                            {getMobileInsertBlockGlyph(type)}
                          </span>
                          <span className="editor-pane-mobile-insert-copy">
                            <strong>{copy.title}</strong>
                            {copy.subtext ? <small>{copy.subtext}</small> : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      <div className="editor-pane-shell">
        <div className="editor-stage-column">
          <div className="editor-stage-frame">
            <div ref={spellcheckStageRef} className="editor-stage-shell">
              <BlockNoteView
                editor={editor}
                theme="dark"
                onChange={handleEditorChange}
                formattingToolbar={false}
                linkToolbar={false}
                slashMenu
                sideMenu
                filePanel={false}
                tableHandles
                emojiPicker
                comments={false}
              >
                <FormattingToolbarController
                  formattingToolbar={EditorFormattingToolbar}
                  floatingUIOptions={{
                    useFloatingOptions: {
                      strategy: "fixed"
                    },
                    elementProps: {
                      className: "editor-floating-toolbar-popover",
                      style: {
                        zIndex: 60
                      },
                      onPointerEnter: () => {
                        restoreFloatingMediaSelection();
                      },
                      onPointerMove: () => {
                        restoreFloatingMediaSelection();
                      },
                      onPointerDownCapture: (event) => {
                        preserveFloatingMediaSelection(event);
                      },
                      onMouseDown: (event) => {
                        preserveFloatingMediaSelection(event);
                      }
                    }
                  }}
                />
                <LinkToolbarController
                  floatingUIOptions={{
                    useFloatingOptions: {
                      strategy: "fixed"
                    },
                    elementProps: {
                      style: {
                        zIndex: 62
                      },
                      onPointerDown: (event) => {
                        event.stopPropagation();
                      }
                    }
                  }}
                />
                <FilePanelController
                  floatingUIOptions={{
                    useFloatingOptions: {
                      strategy: "fixed"
                    },
                    elementProps: {
                      style: {
                        zIndex: 64
                      },
                      onPointerDown: (event) => {
                        event.stopPropagation();
                      }
                    }
                  }}
                />
              </BlockNoteView>
            </div>
          </div>
        </div>

        <aside className="editor-sidepanel editor-pane-mobile-options-sheet">
          <div className="editor-pane-mobile-options-handle" aria-hidden="true" />
          <div className="editor-pane-mobile-sheet-head editor-pane-mobile-options-head">
            <div>
              <span className="editor-pane-mobile-options-kicker">{t("note.mobileMenuTitle")}</span>
              <strong className="editor-pane-mobile-options-title">
                {titleDraft.trim() || t("note.titlePlaceholder")}
              </strong>
              <p>
                {t("note.updated")}: {formatTimestamp(note.updatedAt)}
              </p>
            </div>
            <button
              type="button"
              className="editor-pane-mobile-sheet-close"
              onClick={() => setMobileNoteMenuOpen(false)}
              aria-label={t("dialog.cancel")}
            >
              <CloseGlyph />
            </button>
          </div>

          <section className="editor-pane-mobile-options-summary" aria-label={t("note.details")}>
            <span className={`editor-pane-mobile-options-status is-${saveState}`}>
              {t(`saveState.${saveState}`)}
            </span>
            <span>
              <strong>{mobileNoteStats.blocks}</strong>
              {t("note.blocks").toLowerCase()}
            </span>
            <span>
              <strong>{mobileNoteStats.attachments}</strong>
              {t("note.attachments").toLowerCase()}
            </span>
            <span>
              <strong>{mobileNoteStats.tags}</strong>
              {t("note.tags").toLowerCase()}
            </span>
          </section>

          <section className="editor-pane-detail-card editor-pane-mobile-options-card">
            <div className="editor-pane-mobile-options-section-head">
              <span className="editor-pane-mobile-option-icon" aria-hidden="true">
                <MobileFolderGlyph />
              </span>
              <div>
                <strong>{t("note.mobileMenuFolderTags")}</strong>
                <p>{currentFolder?.name ?? t("orbit.uncategorized")}</p>
              </div>
            </div>

            <div className="editor-pane-detail-field editor-pane-mobile-options-field">
              <span className="editor-pane-detail-label">{t("note.folder")}</span>
              <FolderPicker
                options={folderOptions}
                value={note.folderId}
                emptyLabel={t("orbit.uncategorized")}
                ariaLabel={t("note.folder")}
                onChange={onFolderChange}
              />
            </div>

            <div className="editor-pane-detail-field editor-pane-mobile-options-field">
              <span className="editor-pane-detail-label">{t("note.tags")}</span>
              <div className="editor-pane-mobile-options-field-title">
                <span className="editor-pane-mobile-option-icon is-small" aria-hidden="true">
                  <MobileTagGlyph />
                </span>
                <span>{t("note.tags")}</span>
              </div>
              <TagInputField
                tags={tags}
                selectedTagIds={note.tagIds}
                language={language}
                onChangeTagIds={onTagIdsChange}
                onCreateTag={onCreateTag}
              />
            </div>
          </section>

          <section className="editor-pane-detail-card editor-pane-mobile-options-card">
            <div className="editor-pane-mobile-options-section-head">
              <span className="editor-pane-mobile-option-icon" aria-hidden="true">
                <MobilePaletteGlyph />
              </span>
              <div>
                <strong>{t("note.color")}</strong>
                <p>{(note.color || DEFAULT_NOTE_COLOR).toUpperCase()}</p>
              </div>
            </div>

            <div className="editor-pane-detail-field editor-pane-mobile-options-field">
              <span className="editor-pane-detail-label">{t("note.color")}</span>
              <div className="color-swatch-grid compact editor-pane-color-grid">
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
              <label className="orbital-custom-color-picker editor-pane-custom-color-picker">
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

          <section className="editor-pane-detail-card editor-pane-detail-card-actions editor-pane-mobile-options-card">
            <div className="editor-pane-mobile-options-section-head">
              <span className="editor-pane-mobile-option-icon" aria-hidden="true">
                <MobileExportGlyph />
              </span>
              <div>
                <strong>{t("note.actions")}</strong>
                <p>{t("note.mobileMenuSubtitle")}</p>
              </div>
            </div>

	            <div className="editor-pane-action-grid">
	              <button
                type="button"
                className="micro-action editor-pane-mobile-only-action editor-pane-mobile-action-row"
                onClick={() => {
                  setMobileNoteMenuOpen(false);
                  setNoteTransferOpen(true);
                }}
              >
                <span className="editor-pane-mobile-option-icon" aria-hidden="true">
                  <MobileExportGlyph />
                </span>
                <span>{t("note.transferButton")}</span>
              </button>
              <button
                type="button"
                className={`micro-action editor-pane-mobile-action-row ${
                  note.pinned || note.favorite ? "is-active" : ""
                }`}
                onClick={onTogglePin}
              >
                <span className="editor-pane-mobile-option-icon" aria-hidden="true">
                  <MobilePinGlyph />
                </span>
                <span>{note.pinned || note.favorite ? t("note.unpin") : t("note.pin")}</span>
              </button>
              {note.trashedAt ? (
                <button
                  type="button"
                  className="micro-action editor-pane-mobile-action-row"
                  onClick={onRestore}
                >
                  <span className="editor-pane-mobile-option-icon" aria-hidden="true">
                    <MobileRestoreGlyph />
                  </span>
                  <span>{t("note.restore")}</span>
                </button>
              ) : null}
              <button
                type="button"
                className="micro-action danger editor-pane-mobile-action-row"
                onClick={onDelete}
              >
                <span className="editor-pane-mobile-option-icon" aria-hidden="true">
                  <MobileTrashGlyph />
                </span>
                <span>{note.trashedAt ? t("note.deletePermanently") : t("note.moveToTrash")}</span>
              </button>
            </div>
          </section>
        </aside>
      </div>

      <div className="editor-pane-mobile-formatbar" aria-label={t("note.mobileFormatToolbar")}>
        <button type="button" onClick={() => applyMobileQuickBlock("paragraph")}>
          <span>P</span>
          <small>{t("note.mobileParagraph")}</small>
        </button>
        <button type="button" onClick={() => applyMobileQuickBlock("heading")}>
          <span>H</span>
          <small>{t("note.mobileHeading")}</small>
        </button>
        <button type="button" onClick={() => applyMobileQuickBlock("bulletListItem")}>
          <span>-</span>
          <small>{t("note.mobileBulletList")}</small>
        </button>
        <button type="button" onClick={() => applyMobileQuickBlock("checkListItem")}>
          <span>[]</span>
          <small>{t("note.mobileChecklist")}</small>
        </button>
        <button type="button" onClick={() => showMobileFormattingToolbar()}>
          <span>A</span>
          <small>{t("note.mobileStyle")}</small>
        </button>
        <button type="button" onClick={() => setMobileInsertMenuOpen(true)}>
          <span>+</span>
          <small>{t("note.mobileInsert")}</small>
        </button>
      </div>
    </section>
  );
}
