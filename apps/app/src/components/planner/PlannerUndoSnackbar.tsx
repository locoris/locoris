import { translateInline } from "../../localization/translateInline";
import type { AppLanguage } from "../../types";
import "./PlannerUndoSnackbar.css";

export type PlannerUndoSnackbarAction = {
  id: number;
  label: string;
  undo: () => Promise<unknown> | unknown;
};

interface PlannerUndoSnackbarProps {
  action: PlannerUndoSnackbarAction | null;
  language: AppLanguage;
  onDismiss: () => void;
}

export default function PlannerUndoSnackbar({ action, language, onDismiss }: PlannerUndoSnackbarProps) {
  if (!action) {
    return null;
  }

  return (
    <div className="planner-undo-snackbar" role="status">
      <span>{action.label}</span>
      <button
        type="button"
        onClick={() => {
          const currentAction = action;
          onDismiss();
          void currentAction.undo();
        }}
      >
        {translateInline(language, "plannerUndoSnackbar.undo")}
      </button>
    </div>
  );
}
