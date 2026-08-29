import type { ReactNode } from "react";

import MobileEditorPressButton from "./MobileEditorPressButton";
import "./MobileNoteEditorSheet.css";

type MobileNoteEditorSheetProps = {
  title: string;
  subtitle?: string;
  closeLabel: string;
  children: ReactNode;
  onClose: () => void;
  compact?: boolean;
  className?: string;
};

function CloseIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}

export default function MobileNoteEditorSheet({
  title,
  subtitle,
  closeLabel,
  children,
  onClose,
  compact = false,
  className = ""
}: MobileNoteEditorSheetProps) {
  return (
    <div className={`mobile-note-sheet-layer${className ? ` ${className}` : ""}`} role="presentation">
      <MobileEditorPressButton className="mobile-note-sheet-backdrop" onPress={onClose} aria-label={closeLabel} />
      <section className={`mobile-note-sheet${compact ? " is-compact" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="mobile-note-sheet__handle" aria-hidden="true" />
        <header className="mobile-note-sheet__header">
          <div>
            <strong>{title}</strong>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <MobileEditorPressButton className="mobile-note-sheet__close" onPress={onClose} aria-label={closeLabel} title={closeLabel}>
            <CloseIcon />
          </MobileEditorPressButton>
        </header>
        <div className="mobile-note-sheet__scroll">{children}</div>
      </section>
    </div>
  );
}
