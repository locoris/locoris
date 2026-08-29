import MobileEditorPressButton from "./MobileEditorPressButton";
import MobileNoteEditorSheet from "./MobileNoteEditorSheet";
import "./MobileNoteInsertSheet.css";

export type MobileNoteInsertItem = {
  id: string;
  glyph: string;
  title: string;
  description?: string;
};

export type MobileNoteInsertGroup = {
  id: string;
  title: string;
  items: MobileNoteInsertItem[];
};

type MobileNoteInsertSheetProps = {
  title: string;
  subtitle: string;
  closeLabel: string;
  groups: MobileNoteInsertGroup[];
  onSelect: (id: string) => void;
  onClose: () => void;
};

export default function MobileNoteInsertSheet({ title, subtitle, closeLabel, groups, onSelect, onClose }: MobileNoteInsertSheetProps) {
  return (
    <MobileNoteEditorSheet title={title} subtitle={subtitle} closeLabel={closeLabel} onClose={onClose} className="mobile-note-insert-sheet">
      <div className="mobile-note-insert-sheet__groups">
        {groups.map((group) => (
          <section key={group.id} className="mobile-note-insert-sheet__group">
            <h3>{group.title}</h3>
            <div className="mobile-note-insert-sheet__grid">
              {group.items.map((item) => (
                <MobileEditorPressButton key={item.id} className="mobile-note-insert-sheet__item" onPress={() => onSelect(item.id)}>
                  <span className="mobile-note-insert-sheet__glyph" aria-hidden="true">{item.glyph}</span>
                  <span className="mobile-note-insert-sheet__copy">
                    <strong>{item.title}</strong>
                    {item.description ? <small>{item.description}</small> : null}
                  </span>
                </MobileEditorPressButton>
              ))}
            </div>
          </section>
        ))}
      </div>
    </MobileNoteEditorSheet>
  );
}
