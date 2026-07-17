import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AppLanguage, Note } from "../types";
import { getDisplayNotePreview, getDisplayNoteTitle } from "../localization/displayNames";
import { formatTimestamp } from "../lib/notes";
import MobileGlassHeader from "./MobileGlassHeader";
import SettingsSurface from "./SettingsSurface";
import "./TrashPanel.css";

interface TrashPanelProps {
  notes: Note[];
  folderPathMap: Map<string, string>;
  language: AppLanguage;
  labels: {
    title: string;
    deletedAt: string;
    folder: string;
    restore: string;
    deletePermanently: string;
    clearTrash: string;
    emptyTitle: string;
    emptyDescription: string;
    allNotes: string;
    noteType: string;
    canvasType: string;
  };
  onRestore: (noteId: string) => void;
  onDelete: (noteId: string) => void;
  onClear: () => void;
  onClose?: () => void;
}

type TrashFilter = "all" | "note" | "canvas";

function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m7 7 10 10M17 7 7 17" />
    </svg>
  );
}

function TrashGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 7h16" />
      <path d="M9 7V5.7A1.7 1.7 0 0 1 10.7 4h2.6A1.7 1.7 0 0 1 15 5.7V7" />
      <path d="m7.2 7 .7 11.6A2.1 2.1 0 0 0 10 20.6h4a2.1 2.1 0 0 0 2.1-2L16.8 7" />
      <path d="M10.1 11v5M13.9 11v5" className="trash-recovery-glyph-accent" />
    </svg>
  );
}

function NoteGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7 4.6h7.2L18 8.4v9.8a2.2 2.2 0 0 1-2.2 2.2H7a2.2 2.2 0 0 1-2.2-2.2V6.8A2.2 2.2 0 0 1 7 4.6Z" />
      <path d="M14 4.8v2.9a1 1 0 0 0 1 1h2.7" className="trash-recovery-glyph-accent" />
      <path d="M8.5 12.5h7M8.5 15.7h5.2" />
    </svg>
  );
}

function CanvasGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 6.6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10.8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6.6Z" />
      <path d="m8.2 15.8 2.9-3.1 2.3 2.1 2.5-3.4" className="trash-recovery-glyph-accent" />
      <circle cx="9.2" cy="8.9" r="1.05" />
    </svg>
  );
}

function AllItemsGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7.1 5.1h5.6a2 2 0 0 1 2 2v5.6a2 2 0 0 1-2 2H7.1a2 2 0 0 1-2-2V7.1a2 2 0 0 1 2-2Z" />
      <path d="M10.2 9.4h6.7a2 2 0 0 1 2 2v5.5a2 2 0 0 1-2 2h-5.5a2 2 0 0 1-2-2v-6.7" />
      <path d="M8.5 9.8h2.8M8.5 12h2.1" className="trash-recovery-glyph-accent" />
      <path d="M13.1 14.2h2.7M13.1 16.4h2" className="trash-recovery-glyph-accent" />
    </svg>
  );
}

function RestoreGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8.2 8.6H4.8V5.2" className="trash-recovery-glyph-accent" />
      <path d="M5.1 8.5a7.3 7.3 0 1 1 1.8 7.4" />
      <path d="M5.2 8.5 7.9 6" className="trash-recovery-glyph-accent" />
    </svg>
  );
}

function DeleteGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5.2 7.2h13.6" />
      <path d="M9.2 7.2V5.8a1.4 1.4 0 0 1 1.4-1.4h2.8a1.4 1.4 0 0 1 1.4 1.4v1.4" />
      <path d="m8 7.2.7 10.9a1.8 1.8 0 0 0 1.8 1.7h3a1.8 1.8 0 0 0 1.8-1.7L16 7.2" />
      <path d="m10.2 11 3.6 3.6M13.8 11l-3.6 3.6" className="trash-recovery-glyph-accent" />
    </svg>
  );
}

function FolderGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4.5 7.4a2 2 0 0 1 2-2h4l1.9 2.1h5.1a2 2 0 0 1 2 2v7.1a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V7.4Z" />
    </svg>
  );
}

function ClockGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="7.2" />
      <path d="M12 8.4v4l2.8 1.7" className="trash-recovery-glyph-accent" />
    </svg>
  );
}

export default function TrashPanel({
  notes,
  folderPathMap,
  language,
  labels,
  onRestore,
  onDelete,
  onClear,
  onClose
}: TrashPanelProps) {
  const { t } = useTranslation();
  const text = {
    all: t("trashPanel.all"),
    close: t("trashPanel.close"),
    filteredEmptyTitle: t("trashPanel.filteredEmptyTitle"),
    filteredEmptyDescription: t("trashPanel.filteredEmptyDescription"),
    recovery: t("trashPanel.recovery"),
    subtitle: t("trashPanel.subtitle")
  };
  const [activeFilter, setActiveFilter] = useState<TrashFilter>("all");
  const counts = useMemo(
    () => ({
      all: notes.length,
      note: notes.filter((note) => note.contentType === "note").length,
      canvas: notes.filter((note) => note.contentType === "canvas").length
    }),
    [notes]
  );
  const resolvedFilter = activeFilter !== "all" && counts[activeFilter] === 0 ? "all" : activeFilter;
  const filteredNotes = useMemo(
    () =>
      resolvedFilter === "all"
        ? notes
        : notes.filter((note) => note.contentType === resolvedFilter),
    [notes, resolvedFilter]
  );
  const tabs: Array<{ id: TrashFilter; label: string; count: number; icon: ReactNode }> = [
    { id: "all", label: text.all, count: counts.all, icon: <AllItemsGlyph /> },
    { id: "note", label: labels.noteType, count: counts.note, icon: <NoteGlyph /> },
    { id: "canvas", label: labels.canvasType, count: counts.canvas, icon: <CanvasGlyph /> }
  ];
  const activeTabLabel = tabs.find((tab) => tab.id === resolvedFilter)?.label ?? labels.title;

  return (
    <SettingsSurface className="trash-recovery-shell" aria-label={labels.title}>
      <MobileGlassHeader
        className="settings-panel-header trash-recovery-header is-root-action"
        title={labels.title}
        closeLabel={text.close}
        closeIcon={<CloseGlyph />}
        onClose={onClose}
      />

      {notes.length === 0 ? (
        <div className="trash-recovery-empty">
          <span className="trash-recovery-empty-icon" aria-hidden="true">
            <TrashGlyph />
          </span>
          <div className="trash-recovery-empty-copy">
            <h3>{labels.emptyTitle}</h3>
            <p>{labels.emptyDescription}</p>
          </div>
        </div>
      ) : (
        <div className="trash-recovery-workspace">
          <section className="trash-recovery-toolbar" aria-label={labels.title}>
            <div className="trash-recovery-tabs" role="tablist" aria-label={labels.title}>
              {tabs.map((tab) => (
                <button
                  type="button"
                  role="tab"
                  key={tab.id}
                  className={`trash-recovery-tab is-${tab.id} ${
                    resolvedFilter === tab.id ? "is-active" : ""
                  }`}
                  aria-selected={resolvedFilter === tab.id}
                  onClick={() => setActiveFilter(tab.id)}
                  disabled={tab.id !== "all" && tab.count === 0}
                >
                  <span className="trash-recovery-tab-icon">{tab.icon}</span>
                  <span className="trash-recovery-tab-label">{tab.label}</span>
                  <strong>{tab.count}</strong>
                </button>
              ))}
            </div>

            <button type="button" className="trash-recovery-clear" onClick={onClear}>
              <span className="trash-recovery-button-icon">
                <DeleteGlyph />
              </span>
              <span>{labels.clearTrash}</span>
            </button>
          </section>

          <div className="trash-recovery-list-scroll" role="tabpanel" aria-label={activeTabLabel}>
            {filteredNotes.length === 0 ? (
              <div className="trash-recovery-empty is-filtered">
                <span className="trash-recovery-empty-icon" aria-hidden="true">
                  {resolvedFilter === "canvas" ? <CanvasGlyph /> : <NoteGlyph />}
                </span>
                <div className="trash-recovery-empty-copy">
                  <h3>{text.filteredEmptyTitle}</h3>
                  <p>{text.filteredEmptyDescription}</p>
                </div>
              </div>
            ) : (
              <div className="trash-recovery-list">
                {filteredNotes.map((note) => {
                  const isCanvas = note.contentType === "canvas";
                  const title = getDisplayNoteTitle(note, language);
                  const preview = getDisplayNotePreview(note, language);
                  const typeLabel = isCanvas ? labels.canvasType : labels.noteType;
                  const deletedAt = formatTimestamp(note.trashedAt ?? note.updatedAt);
                  const folderLabel = note.folderId
                    ? folderPathMap.get(note.folderId) ?? labels.allNotes
                    : labels.allNotes;
                  const itemStyle = {
                    "--trash-item-accent":
                      note.color ||
                      (isCanvas
                        ? "var(--trash-recovery-secondary)"
                        : "var(--trash-recovery-tertiary)")
                  } as CSSProperties;

                  return (
                    <article
                      className={`trash-recovery-item ${isCanvas ? "is-canvas" : "is-note"}`}
                      key={note.id}
                      style={itemStyle}
                    >
                      <span className="trash-recovery-item-icon" aria-hidden="true">
                        {isCanvas ? <CanvasGlyph /> : <NoteGlyph />}
                      </span>

                      <div className="trash-recovery-item-main">
                        <div className="trash-recovery-item-head">
                          <h3>{title}</h3>
                          <span>{typeLabel}</span>
                        </div>

                        {preview ? <p className="trash-recovery-preview">{preview}</p> : null}

                        <div className="trash-recovery-meta">
                          <span>
                            <FolderGlyph />
                            {folderLabel}
                          </span>
                          <span>
                            <ClockGlyph />
                            {deletedAt}
                          </span>
                        </div>
                      </div>

                      <div className="trash-recovery-item-actions">
                        <button
                          type="button"
                          className="trash-recovery-action is-restore"
                          onClick={() => onRestore(note.id)}
                          title={labels.restore}
                        >
                          <span className="trash-recovery-button-icon">
                            <RestoreGlyph />
                          </span>
                          <span>{labels.restore}</span>
                        </button>
                        <button
                          type="button"
                          className="trash-recovery-action is-danger"
                          onClick={() => onDelete(note.id)}
                          title={labels.deletePermanently}
                        >
                          <span className="trash-recovery-button-icon">
                            <DeleteGlyph />
                          </span>
                          <span>{labels.deletePermanently}</span>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </SettingsSurface>
  );
}
