import { useTranslation } from "react-i18next";
import type { AppLanguage, Note, NoteListView, Tag } from "../types";

import { getDisplayNotePreview, getDisplayNoteTitle } from "../localization/displayNames";
import { formatTimestamp } from "../lib/notes";

interface NotesPanelProps {
  notes: Note[];
  tags: Tag[];
  folderPathMap: Map<string, string>;
  activeNoteId: string | null;
  language: AppLanguage;
  viewMode: NoteListView;
  selectedFolderName: string | null;
  selectedTagName: string | null;
  labels: {
    title: string;
    create: string;
    clear: string;
    filteredByFolder: string;
    filteredByTag: string;
    emptyTitle: string;
    emptyDescription: string;
    allNotes: string;
    favorites: string;
    archived: string;
    trash: string;
  };
  onSelect: (noteId: string) => void;
  onCreate: () => void;
  onClearFilters: () => void;
}

export default function NotesPanel({
  notes,
  tags,
  folderPathMap,
  activeNoteId,
  language,
  viewMode,
  selectedFolderName,
  selectedTagName,
  labels,
  onSelect,
  onCreate,
  onClearFilters
}: NotesPanelProps) {
  const { t } = useTranslation();
  const tagMap = new Map(tags.map((tag) => [tag.id, tag]));
  const title =
    selectedFolderName ?? selectedTagName ?? (viewMode === "favorites"
      ? labels.favorites
      : viewMode === "trash"
          ? labels.trash
          : labels.allNotes);
  const description = selectedFolderName
    ? `${labels.filteredByFolder}: ${selectedFolderName}`
    : selectedTagName
      ? `${labels.filteredByTag}: ${selectedTagName}`
      : t("counts.notes", { count: notes.length });

  return (
    <section className="panel list-panel notes-hub-panel">
      <div className="panel-head list-head notes-hub-head">
        <div className="notes-hub-title">
          <p className="panel-kicker">{labels.title}</p>
          <div className="notes-hub-heading-row">
            <h2 className="panel-title notes-hub-heading">{title}</h2>
            <span className="notes-hub-counter">
              {t("counts.notes", { count: notes.length })}
            </span>
          </div>
          <p className="notes-hub-caption">{description}</p>
        </div>
        <button className="primary-action notes-hub-create" onClick={onCreate}>
          {labels.create}
        </button>
      </div>

      {(selectedFolderName || selectedTagName) ? (
        <div className="active-filters notes-hub-filters">
          {selectedFolderName ? (
            <span className="filter-chip">
              {labels.filteredByFolder}: {selectedFolderName}
            </span>
          ) : null}
          {selectedTagName ? (
            <span className="filter-chip">
              {labels.filteredByTag}: {selectedTagName}
            </span>
          ) : null}
          <button className="toolbar-action" onClick={onClearFilters}>
            {labels.clear}
          </button>
        </div>
      ) : null}

      {notes.length === 0 ? (
        <div className="empty-card">
          <strong>{labels.emptyTitle}</strong>
          <p>{labels.emptyDescription}</p>
        </div>
      ) : (
        <div className="note-card-list notes-hub-list">
          {notes.map((note) => (
            <button
              key={note.id}
              className={`note-card ${activeNoteId === note.id ? "is-active" : ""}`}
              onClick={() => onSelect(note.id)}
            >
              <div className="note-card-topline">
                <div className="note-card-titlewrap">
                  <span className="note-card-title">{getDisplayNoteTitle(note, language)}</span>
                  <span className="note-card-date">{formatTimestamp(note.updatedAt)}</span>
                </div>
                <div className="note-card-flags">
                  {note.pinned || note.favorite ? (
                    <span className="note-card-pin favorite">{t("note.pinnedActive")}</span>
                  ) : null}
                  {note.trashedAt ? <span className="note-card-pin danger">{t("filters.viewTrash")}</span> : null}
                </div>
              </div>
              <div className="note-card-meta">
                <span className="note-card-folder">
                  {note.folderId ? folderPathMap.get(note.folderId) ?? labels.allNotes : labels.allNotes}
                </span>
                <span className="note-card-stat">{note.plainText.length}</span>
              </div>
              <p className="note-card-excerpt">{getDisplayNotePreview(note, language)}</p>
              <div className="note-card-tags">
                {note.tagIds.slice(0, 3).map((tagId) => {
                  const tag = tagMap.get(tagId);

                  if (!tag) {
                    return null;
                  }

                  return (
                    <span key={tag.id} className="tiny-tag">
                      {tag.name}
                    </span>
                  );
                })}
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
