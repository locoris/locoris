import {
  BasicTextStyleButton,
  BlockTypeSelect,
  ColorStyleButton,
  CreateLinkButton,
  FileCaptionButton,
  FileDeleteButton,
  FileDownloadButton,
  FilePreviewButton,
  FileRenameButton,
  FileReplaceButton,
  FormattingToolbar,
  NestBlockButton,
  TableCellMergeButton,
  TextAlignButton,
  UnnestBlockButton,
  useBlockNoteEditor,
  useComponentsContext,
  useEditorState
} from "@blocknote/react";
import { useTranslation } from "react-i18next";

import "./EditorFormattingToolbar.css";
import {
  EDITOR_FONT_CHOICES,
  editorBlockNoteSchema,
  isEditorStoredFontId,
  resolveEditorFontFamily
} from "../lib/blocknoteSchema";
import { EDITOR_AI_OPEN_EVENT } from "../lib/aiIntegration";
import { EDITOR_CREATE_TASK_EVENT } from "../lib/plannerLinks";
import { useAdaptiveLayout } from "../lib/useAdaptiveLayout";
import MobileEditorSelectionToolbar from "./MobileEditorSelectionToolbar";

const AI_TEXT_BLOCK_UNSUPPORTED_TYPES = new Set(["image", "file", "audio", "video"]);

function AiToolbarIcon() {
  return (
    <span className="editor-formatting-ai-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
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
    </span>
  );
}

function TaskToolbarIcon() {
  return (
    <span className="editor-formatting-task-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M6.4 5.2h11.2v13.6H6.4V5.2Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="m8.7 10.1 1.5 1.5 3-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8.7 15.2h6.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function FontStyleSelect() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor(editorBlockNoteSchema);
  const { t } = useTranslation();

  const activeFont = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor.isEditable) {
        return undefined;
      }

      const selectedBlocks =
        editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];

      if (!selectedBlocks.some((block) => block.content !== undefined)) {
        return undefined;
      }

      const currentFont = editor.getActiveStyles().font;

      return typeof currentFont === "string" && isEditorStoredFontId(currentFont)
        ? currentFont
        : "default";
    }
  });

  if (!activeFont) {
    return null;
  }

  return (
    <Components.FormattingToolbar.Select
      className="bn-select editor-font-select"
      items={EDITOR_FONT_CHOICES.map((choice) => ({
        text: t(choice.labelKey),
        icon: (
          <span
            className="editor-font-option-preview"
            data-font-choice={choice.id}
            style={choice.stack ? { fontFamily: choice.stack } : undefined}
          >
            {choice.preview}
          </span>
        ),
        isSelected: activeFont === choice.id,
        onClick: () => {
          editor.focus();

          if (choice.id === "default") {
            editor.removeStyles({ font: "" } as any);
          } else {
            editor.addStyles({ font: choice.id } as any);
          }

          setTimeout(() => {
            editor.focus();
          });
        }
      }))}
    />
  );
}

function AiSelectionButton() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor(editorBlockNoteSchema);
  const { t } = useTranslation();

  const canUseAiForSelection = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor.isEditable) {
        return false;
      }

      const selectedBlocks =
        editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];

      return (
        selectedBlocks.length > 0 &&
        selectedBlocks.every((block) => !AI_TEXT_BLOCK_UNSUPPORTED_TYPES.has(block.type)) &&
        selectedBlocks.some((block) => block.content !== undefined)
      );
    }
  });

  if (!canUseAiForSelection) {
    return null;
  }

  return (
    <Components.FormattingToolbar.Button
      className="editor-formatting-ai-button"
      mainTooltip={t("note.aiSelection")}
      icon={<AiToolbarIcon />}
      label={t("note.aiShort")}
      onClick={(event) => {
        event.preventDefault();
        window.dispatchEvent(
          new CustomEvent(EDITOR_AI_OPEN_EVENT, {
            detail: {
              scope: "selection"
            }
          })
        );
      }}
    />
  );
}

function CreateTaskSelectionButton() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor(editorBlockNoteSchema);
  const { t } = useTranslation();

  const canCreateTask = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor.isEditable) {
        return false;
      }

      const selectedBlocks =
        editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];

      return (
        selectedBlocks.length > 0 &&
        selectedBlocks.every((block) => !AI_TEXT_BLOCK_UNSUPPORTED_TYPES.has(block.type)) &&
        selectedBlocks.some((block) => block.content !== undefined)
      );
    }
  });

  if (!canCreateTask) {
    return null;
  }

  return (
    <Components.FormattingToolbar.Button
      className="editor-formatting-task-button"
      mainTooltip={t("note.createTaskFromSelection")}
      icon={<TaskToolbarIcon />}
      label={t("note.createTaskShort")}
      onClick={(event) => {
        event.preventDefault();
        window.dispatchEvent(
          new CustomEvent(EDITOR_CREATE_TASK_EVENT, {
            detail: {
              scope: "selection"
            }
          })
        );
      }}
    />
  );
}

export default function EditorFormattingToolbar() {
  const { isMobileShell } = useAdaptiveLayout();

  if (isMobileShell) {
    return <MobileEditorSelectionToolbar />;
  }

  return (
    <div className="editor-formatting-toolbar-shell">
      <FormattingToolbar>
        <BlockTypeSelect />
        <FontStyleSelect />
        <TableCellMergeButton />
        <FileCaptionButton />
        <FileReplaceButton />
        <FileRenameButton />
        <FileDeleteButton />
        <FileDownloadButton />
        <FilePreviewButton />
        <BasicTextStyleButton basicTextStyle="bold" />
        <BasicTextStyleButton basicTextStyle="italic" />
        <BasicTextStyleButton basicTextStyle="underline" />
        <BasicTextStyleButton basicTextStyle="strike" />
        <TextAlignButton textAlignment="left" />
        <TextAlignButton textAlignment="center" />
        <TextAlignButton textAlignment="right" />
        <ColorStyleButton />
        <CreateLinkButton />
        <NestBlockButton />
        <UnnestBlockButton />
        <AiSelectionButton />
        <CreateTaskSelectionButton />
      </FormattingToolbar>
    </div>
  );
}
