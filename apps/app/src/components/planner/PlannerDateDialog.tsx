import { translateInline } from "../../localization/translateInline";
import { useEffect } from "react";
import { createPortal } from "react-dom";

import type { AppLanguage } from "../../types";
import type { PlannerTaskDateDraft } from "../../lib/plannerTaskSchedule";
import PlannerDateSelector from "./PlannerDateSelector";
import "./PlannerDateDialog.css";

interface PlannerDateDialogProps {
  open: boolean;
  value: PlannerTaskDateDraft;
  language: AppLanguage;
  isMobile?: boolean;
  onApply: (value: PlannerTaskDateDraft) => void;
  onClose: () => void;
}

export default function PlannerDateDialog({
  open,
  value,
  language,
  isMobile = false,
  onApply,
  onClose
}: PlannerDateDialogProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  const dialog = (
    <div className={`planner-date-dialog-layer ${isMobile ? "is-mobile" : "is-desktop"}`} role="dialog" aria-modal="true">
      <button
        type="button"
        className="planner-date-dialog-backdrop"
        onClick={onClose}
        aria-label={translateInline(language, "plannerDateDialog.closeDatePicker")}
      />
      <div className="planner-date-dialog-sheet">
        <PlannerDateSelector
          value={value}
          language={language}
          isMobile={isMobile}
          onCancel={onClose}
          onApply={onApply}
        />
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return dialog;
  }

  return createPortal(dialog, document.body);
}
