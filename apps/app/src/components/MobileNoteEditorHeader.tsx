import type { ChangeEventHandler, FocusEventHandler } from "react";

import MobileEditorPressButton from "./MobileEditorPressButton";
import "./MobileNoteEditorHeader.css";

type MobileNoteEditorHeaderProps = {
  title: string;
  titlePlaceholder: string;
  saveLabel: string;
  saveState: string;
  backLabel: string;
  aiLabel: string;
  moreLabel: string;
  onTitleChange: ChangeEventHandler<HTMLInputElement>;
  onTitleFocus: FocusEventHandler<HTMLInputElement>;
  onTitleBlur: FocusEventHandler<HTMLInputElement>;
  onBack: () => void;
  onAi: () => void;
  onMore: () => void;
};

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m14.5 5-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function SparkleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 3 1.35 3.85A4.25 4.25 0 0 0 16.15 9.65L20 11l-3.85 1.35a4.25 4.25 0 0 0-2.8 2.8L12 19l-1.35-3.85a4.25 4.25 0 0 0-2.8-2.8L4 11l3.85-1.35a4.25 4.25 0 0 0 2.8-2.8L12 3Z" fill="currentColor" />
      <path d="m19 17 .55 1.45L21 19l-1.45.55L19 21l-.55-1.45L17 19l1.45-.55L19 17Z" fill="currentColor" opacity=".7" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="12" r="1.7" fill="currentColor" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <circle cx="18" cy="12" r="1.7" fill="currentColor" />
    </svg>
  );
}

export default function MobileNoteEditorHeader({
  title,
  titlePlaceholder,
  saveLabel,
  saveState,
  backLabel,
  aiLabel,
  moreLabel,
  onTitleChange,
  onTitleFocus,
  onTitleBlur,
  onBack,
  onAi,
  onMore
}: MobileNoteEditorHeaderProps) {
  return (
    <header className="mobile-note-editor-header">
      <MobileEditorPressButton className="mobile-note-editor-header__button" onPress={onBack} aria-label={backLabel} title={backLabel}>
        <BackIcon />
      </MobileEditorPressButton>

      <label className="mobile-note-editor-header__title">
        <input
          value={title}
          onChange={onTitleChange}
          onFocus={onTitleFocus}
          onBlur={onTitleBlur}
          placeholder={titlePlaceholder}
          enterKeyHint="done"
        />
        <span className={`mobile-note-editor-header__save is-${saveState}`} aria-live="polite">
          <i aria-hidden="true" />
          {saveLabel}
        </span>
      </label>

      <MobileEditorPressButton className="mobile-note-editor-header__button is-ai" onPress={onAi} aria-label={aiLabel} title={aiLabel}>
        <SparkleIcon />
      </MobileEditorPressButton>
      <MobileEditorPressButton className="mobile-note-editor-header__button" onPress={onMore} aria-label={moreLabel} title={moreLabel}>
        <MoreIcon />
      </MobileEditorPressButton>
    </header>
  );
}
