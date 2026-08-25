import "./MobileEditorToolbar.css";

type MobileEditorToolbarProps = {
  ariaLabel: string;
  paragraphLabel: string;
  headingLabel: string;
  bulletListLabel: string;
  checklistLabel: string;
  styleLabel: string;
  insertLabel: string;
  onParagraph: () => void;
  onHeading: () => void;
  onBulletList: () => void;
  onChecklist: () => void;
  onStyle: () => void;
  onInsert: () => void;
};

type MobileEditorToolbarButtonProps = {
  glyph: string;
  label: string;
  onPress: () => void;
  emphasis?: boolean;
};

function MobileEditorToolbarButton({
  glyph,
  label,
  onPress,
  emphasis = false
}: MobileEditorToolbarButtonProps) {
  return (
    <button
      type="button"
      className={emphasis ? "is-emphasis" : undefined}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPress}
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true">{glyph}</span>
      <small>{label}</small>
    </button>
  );
}

export default function MobileEditorToolbar({
  ariaLabel,
  paragraphLabel,
  headingLabel,
  bulletListLabel,
  checklistLabel,
  styleLabel,
  insertLabel,
  onParagraph,
  onHeading,
  onBulletList,
  onChecklist,
  onStyle,
  onInsert
}: MobileEditorToolbarProps) {
  return (
    <div className="editor-pane-mobile-formatbar" aria-label={ariaLabel}>
      <MobileEditorToolbarButton glyph="P" label={paragraphLabel} onPress={onParagraph} />
      <MobileEditorToolbarButton glyph="H" label={headingLabel} onPress={onHeading} />
      <MobileEditorToolbarButton glyph="-" label={bulletListLabel} onPress={onBulletList} />
      <MobileEditorToolbarButton glyph="[]" label={checklistLabel} onPress={onChecklist} />
      <MobileEditorToolbarButton glyph="A" label={styleLabel} onPress={onStyle} />
      <MobileEditorToolbarButton
        glyph="+"
        label={insertLabel}
        onPress={onInsert}
        emphasis
      />
    </div>
  );
}
