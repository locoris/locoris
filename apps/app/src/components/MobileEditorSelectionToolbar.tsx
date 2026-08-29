import {
  FileCaptionButton,
  FileDeleteButton,
  FileDownloadButton,
  FilePreviewButton,
  FileRenameButton,
  FileReplaceButton,
  FormattingToolbar,
  useBlockNoteEditor,
  useEditorState
} from "@blocknote/react";
import { useTranslation } from "react-i18next";

import { EDITOR_AI_OPEN_EVENT } from "../lib/aiIntegration";
import { editorBlockNoteSchema } from "../lib/blocknoteSchema";
import { EDITOR_CREATE_TASK_EVENT } from "../lib/plannerLinks";
import MobileEditorPressButton from "./MobileEditorPressButton";
import { MOBILE_EDITOR_OPEN_FORMAT_EVENT, MOBILE_EDITOR_OPEN_LINK_EVENT } from "./mobileEditorEvents";
import "./MobileEditorSelectionToolbar.css";

const MEDIA_TYPES = new Set(["image", "file", "audio", "video"]);

function dispatch(name: string, detail?: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export default function MobileEditorSelectionToolbar() {
  const editor = useBlockNoteEditor(editorBlockNoteSchema);
  const { t } = useTranslation();
  const state = useEditorState({
    editor,
    selector: ({ editor }) => {
      const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
      return {
        activeStyles: editor.getActiveStyles() as Record<string, unknown>,
        media: blocks.length > 0 && blocks.every((block) => MEDIA_TYPES.has(block.type))
      };
    }
  });

  if (state.media) {
    return (
      <div className="mobile-selection-toolbar is-media">
        <FormattingToolbar>
          <FileCaptionButton /><FileReplaceButton /><FileRenameButton /><FileDeleteButton /><FileDownloadButton /><FilePreviewButton />
        </FormattingToolbar>
      </div>
    );
  }

  const dictionary = editor.dictionary.formatting_toolbar;
  const buttons = [
    { id: "bold", glyph: "B", label: dictionary.bold.tooltip, onPress: () => editor.toggleStyles({ bold: true } as any) },
    { id: "italic", glyph: "I", label: dictionary.italic.tooltip, onPress: () => editor.toggleStyles({ italic: true } as any) },
    { id: "underline", glyph: "U", label: dictionary.underline.tooltip, onPress: () => editor.toggleStyles({ underline: true } as any) },
    { id: "link", glyph: "↗", label: dictionary.link.tooltip, onPress: () => dispatch(MOBILE_EDITOR_OPEN_LINK_EVENT) },
    { id: "ai", glyph: "✦", label: t("note.aiSelection"), onPress: () => dispatch(EDITOR_AI_OPEN_EVENT, { scope: "selection" }) },
    { id: "task", glyph: "✓", label: t("note.createTaskFromSelection"), onPress: () => dispatch(EDITOR_CREATE_TASK_EVENT, { scope: "selection" }) },
    { id: "more", glyph: "•••", label: t("note.mobileStyle"), onPress: () => dispatch(MOBILE_EDITOR_OPEN_FORMAT_EVENT) }
  ];

  return (
    <div className="mobile-selection-toolbar" role="toolbar" aria-label={t("note.mobileFormatToolbar")}>
      {buttons.map((button) => (
        <MobileEditorPressButton
          key={button.id}
          className={state.activeStyles[button.id] ? "is-active" : ""}
          onPress={() => { button.onPress(); editor.focus(); }}
          aria-label={button.label}
          title={button.label}
          aria-pressed={button.id in state.activeStyles ? Boolean(state.activeStyles[button.id]) : undefined}
        >
          {button.glyph}
        </MobileEditorPressButton>
      ))}
    </div>
  );
}
