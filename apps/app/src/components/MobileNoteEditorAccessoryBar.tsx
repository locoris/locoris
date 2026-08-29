import MobileEditorPressButton from "./MobileEditorPressButton";
import "./MobileNoteEditorAccessoryBar.css";

type MobileNoteEditorAccessoryBarProps = {
  ariaLabel: string;
  tableLabel: string;
  formatLabel: string;
  checklistLabel: string;
  insertLabel: string;
  aiLabel: string;
  dismissLabel: string;
  onTable: () => void;
  onFormat: () => void;
  onChecklist: () => void;
  onInsert: () => void;
  onAi: () => void;
  onDismiss: () => void;
};

function ToolIcon({ type }: { type: "table" | "format" | "check" | "insert" | "ai" | "dismiss" }) {
  if (type === "format") return <span className="mobile-note-accessory__letters" aria-hidden="true">Aa</span>;
  if (type === "insert") return <span className="mobile-note-accessory__plus" aria-hidden="true">+</span>;
  if (type === "ai") return <span className="mobile-note-accessory__sparkle" aria-hidden="true">✦</span>;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {type === "table" ? <><rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="M4 10h16M10 5v14" fill="none" stroke="currentColor" strokeWidth="1.8"/></> : null}
      {type === "check" ? <><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="m8 12 2.5 2.5L16 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></> : null}
      {type === "dismiss" ? <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/> : null}
    </svg>
  );
}
export default function MobileNoteEditorAccessoryBar({
  ariaLabel,
  tableLabel,
  formatLabel,
  checklistLabel,
  insertLabel,
  aiLabel,
  dismissLabel,
  onTable,
  onFormat,
  onChecklist,
  onInsert,
  onAi,
  onDismiss
}: MobileNoteEditorAccessoryBarProps) {
  const buttons = [
    { type: "table" as const, label: tableLabel, onPress: onTable },
    { type: "format" as const, label: formatLabel, onPress: onFormat, emphasis: true },
    { type: "check" as const, label: checklistLabel, onPress: onChecklist },
    { type: "insert" as const, label: insertLabel, onPress: onInsert },
    { type: "ai" as const, label: aiLabel, onPress: onAi, ai: true },
    { type: "dismiss" as const, label: dismissLabel, onPress: onDismiss, dismiss: true }
  ];

  return (
    <nav className="mobile-note-accessory" aria-label={ariaLabel}>
      {buttons.map((button) => (
        <MobileEditorPressButton
          key={button.type}
          className={`mobile-note-accessory__button${button.emphasis ? " is-emphasis" : ""}${button.ai ? " is-ai" : ""}${button.dismiss ? " is-dismiss" : ""}`}
          onPress={button.onPress}
          aria-label={button.label}
          title={button.label}
        >
          <ToolIcon type={button.type} />
        </MobileEditorPressButton>
      ))}
    </nav>
  );
}
