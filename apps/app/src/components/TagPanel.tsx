import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import "./TagPanel.css";
import { buildTagCounts } from "../lib/notes";
import { normalizeTagName, sortTagsByName } from "../lib/tags";
import type { Note, Tag } from "../types";

interface TagPanelProps {
  tags: Tag[];
  notes: Note[];
  selectedTagId: string | null;
  labels: {
    title: string;
    add: string;
    rename: string;
    delete: string;
    save: string;
    cancel: string;
    createPlaceholder: string;
  };
  onSelect: (tagId: string | null) => void;
  onCreate: (name: string) => Promise<unknown>;
  onRename: (tagId: string, name: string) => Promise<void>;
  onDelete: (tagId: string) => Promise<void>;
}

export default function TagPanel({
  tags,
  notes,
  selectedTagId,
  labels,
  onSelect,
  onCreate,
  onRename,
  onDelete
}: TagPanelProps) {
  const { t, i18n } = useTranslation();
  const counts = buildTagCounts(notes, tags);
  const [draftName, setDraftName] = useState("");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const sortedTags = useMemo(() => sortTagsByName(tags, i18n.language), [i18n.language, tags]);
  const filteredTags = useMemo(() => {
    const normalizedQuery = normalizeTagName(query).toLocaleLowerCase();

    if (!normalizedQuery) {
      return sortedTags;
    }

    return sortedTags.filter((tag) => tag.name.toLocaleLowerCase().includes(normalizedQuery));
  }, [query, sortedTags]);

  const submitDraft = async () => {
    const normalized = normalizeTagName(draftName);

    if (!normalized) {
      return;
    }

    await onCreate(normalized);
    setDraftName("");
  };

  const submitRename = async () => {
    const normalized = normalizeTagName(editingName);

    if (!editingId || !normalized) {
      return;
    }

    await onRename(editingId, normalized);
    setEditingId(null);
    setEditingName("");
  };

  return (
    <section className="panel sidebar-panel tag-manager-panel">
      <div className="tag-manager-head">
        <div className="tag-manager-titleblock">
          <p className="panel-kicker">{labels.title}</p>
          <h2 className="panel-title">{labels.title}</h2>
          <p className="panel-caption">
            {tags.length} · {notes.length}
          </p>
        </div>
      </div>

      <div className="tag-manager-toolbar">
        <label className="tag-manager-compose">
          <span className="tag-manager-toolbar-label">{labels.add}</span>
          <div className="tag-manager-toolbar-row">
            <input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              className="micro-input tag-manager-input"
              placeholder={labels.createPlaceholder}
            />
            <button className="micro-action primary" onClick={() => void submitDraft()}>
              {labels.add}
            </button>
          </div>
        </label>

        <label className="tag-manager-searchshell">
          <span className="tag-manager-toolbar-label">{t("tags.searchPlaceholder")}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="micro-input tag-manager-search"
            placeholder={t("tags.searchPlaceholder")}
          />
        </label>
      </div>

      <div className="tag-manager-list">
        {filteredTags.length === 0 ? (
          <div className="tag-manager-empty">
            <strong>{t("tags.emptyStateTitle")}</strong>
            <p>
              {query.trim() ? t("tags.noMatches") : t("tags.emptyStateDescription")}
            </p>
          </div>
        ) : (
          filteredTags.map((tag) => {
            const isSelected = selectedTagId === tag.id;
            const noteCount = counts.get(tag.id) ?? 0;

            return (
              <div
                className={`tag-manager-row ${isSelected ? "is-selected" : ""}`}
                key={tag.id}
              >
                {editingId === tag.id ? (
                  <div className="tag-manager-editrow">
                    <input
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      className="micro-input tag-manager-input"
                      placeholder={labels.createPlaceholder}
                    />
                    <div className="tag-manager-row-actions">
                      <button className="micro-action primary" onClick={() => void submitRename()}>
                        {labels.save}
                      </button>
                      <button
                        className="micro-action"
                        onClick={() => {
                          setEditingId(null);
                          setEditingName("");
                        }}
                      >
                        {labels.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      className={`tag-manager-pill ${isSelected ? "is-active" : ""}`}
                      onClick={() => onSelect(isSelected ? null : tag.id)}
                    >
                      <span className="tag-manager-pill-name">{tag.name}</span>
                      <span className="tag-manager-pill-meta">
                        {t("counts.notes", { count: noteCount })}
                      </span>
                    </button>

                    <div className="tag-manager-row-actions">
                      <button
                        className="micro-action"
                        onClick={() => {
                          setEditingId(tag.id);
                          setEditingName(tag.name);
                        }}
                      >
                        {labels.rename}
                      </button>
                      <button className="micro-action danger" onClick={() => void onDelete(tag.id)}>
                        {labels.delete}
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
