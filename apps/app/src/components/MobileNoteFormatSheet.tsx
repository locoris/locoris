import MobileEditorPressButton from "./MobileEditorPressButton";
import MobileNoteEditorSheet from "./MobileNoteEditorSheet";
import "./MobileNoteFormatSheet.css";

export type MobileNoteFormatSnapshot = {
  blockType: string;
  headingLevel: number | null;
  alignment: string;
  activeFont: string;
  activeStyles: Record<string, unknown>;
  canNest: boolean;
  canUnnest: boolean;
};

type FormatChoice = { id: string; label: string; glyph: string };

type MobileNoteFormatSheetProps = {
  mode: "format" | "link";
  title: string;
  closeLabel: string;
  doneLabel: string;
  fontLabel: string;
  linkLabel: string;
  linkPlaceholder: string;
  blockChoices: FormatChoice[];
  inlineChoices: FormatChoice[];
  alignmentChoices: FormatChoice[];
  fontChoices: Array<{ id: string; label: string; preview: string; stack?: string }>;
  snapshot: MobileNoteFormatSnapshot;
  linkDraft: string;
  onLinkDraftChange: (value: string) => void;
  onBlock: (id: string) => void;
  onInline: (id: string) => void;
  onAlignment: (id: string) => void;
  onFont: (id: string) => void;
  onNest: () => void;
  onUnnest: () => void;
  onApplyLink: () => void;
  onClose: () => void;
};

export default function MobileNoteFormatSheet({
  mode,
  title,
  closeLabel,
  doneLabel,
  fontLabel,
  linkLabel,
  linkPlaceholder,
  blockChoices,
  inlineChoices,
  alignmentChoices,
  fontChoices,
  snapshot,
  linkDraft,
  onLinkDraftChange,
  onBlock,
  onInline,
  onAlignment,
  onFont,
  onNest,
  onUnnest,
  onApplyLink,
  onClose
}: MobileNoteFormatSheetProps) {
  const isBlockActive = (id: string) => id.startsWith("heading")
    ? snapshot.blockType === "heading" && snapshot.headingLevel === Number(id.replace("heading", ""))
    : snapshot.blockType === id;

  if (mode === "link") {
    return (
      <MobileNoteEditorSheet title={linkLabel} closeLabel={closeLabel} onClose={onClose} compact className="mobile-note-format-sheet">
        <section className="mobile-note-format-sheet__section is-link">
          <div className="mobile-note-format-sheet__link-row">
            <input type="url" inputMode="url" value={linkDraft} onChange={(event) => onLinkDraftChange(event.target.value)} placeholder={linkPlaceholder} autoCapitalize="none" autoCorrect="off" autoFocus />
            <MobileEditorPressButton onPress={onApplyLink} disabled={!linkDraft.trim()}>{doneLabel}</MobileEditorPressButton>
          </div>
        </section>
      </MobileNoteEditorSheet>
    );
  }

  return (
    <MobileNoteEditorSheet title={title} closeLabel={closeLabel} onClose={onClose} className="mobile-note-format-sheet">
      <div className="mobile-note-format-sheet__content">
        <div className="mobile-note-format-sheet__styles" role="group" aria-label={title}>
          {blockChoices.map((choice) => (
            <MobileEditorPressButton key={choice.id} className={`mobile-note-format-sheet__style${isBlockActive(choice.id) ? " is-active" : ""}`} onPress={() => onBlock(choice.id)} aria-pressed={isBlockActive(choice.id)}>
              <span>{choice.glyph}</span><small>{choice.label}</small>
            </MobileEditorPressButton>
          ))}
        </div>

        <div className="mobile-note-format-sheet__strip" role="group" aria-label={title}>
          {inlineChoices.map((choice) => {
            const active = Boolean(snapshot.activeStyles[choice.id]);
            return <MobileEditorPressButton key={choice.id} className={active ? "is-active" : ""} onPress={() => onInline(choice.id)} aria-label={choice.label} title={choice.label} aria-pressed={active}>{choice.glyph}</MobileEditorPressButton>;
          })}
          <span className="mobile-note-format-sheet__separator" />
          {alignmentChoices.map((choice) => {
            const active = snapshot.alignment === choice.id;
            return <MobileEditorPressButton key={choice.id} className={active ? "is-active" : ""} onPress={() => onAlignment(choice.id)} aria-label={choice.label} title={choice.label} aria-pressed={active}>{choice.glyph}</MobileEditorPressButton>;
          })}
        </div>

        <section className="mobile-note-format-sheet__section">
          <h3>{fontLabel}</h3>
          <div className="mobile-note-format-sheet__fonts">
            {fontChoices.map((font) => {
              const active = snapshot.activeFont === font.id;
              return <MobileEditorPressButton key={font.id} className={active ? "is-active" : ""} onPress={() => onFont(font.id)} aria-pressed={active}><span style={font.stack ? { fontFamily: font.stack } : undefined}>{font.preview}</span><small>{font.label}</small></MobileEditorPressButton>;
            })}
          </div>
        </section>

        <div className="mobile-note-format-sheet__indent">
          <MobileEditorPressButton onPress={onUnnest} disabled={!snapshot.canUnnest} aria-label="Outdent">←</MobileEditorPressButton>
          <MobileEditorPressButton onPress={onNest} disabled={!snapshot.canNest} aria-label="Indent">→</MobileEditorPressButton>
        </div>
      </div>
    </MobileNoteEditorSheet>
  );
}
