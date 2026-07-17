import { translateApp, translateInline } from "../../localization/translateInline";
import {
  formatPlannerFullDateTime,
  getPlannerPriorityLabel,
  getPlannerStatusLabel,
  getPlannerTaskScheduleSummary
} from "../../localization/plannerPresentation";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import type { AppLanguage, Folder, Note, PlannerTaskPriority, Project, Reminder, Tag, Task } from "../../types";
import { getDisplayNoteTitle } from "../../localization/displayNames";
import {
  buildRescheduleOccurrencePatch,
  buildRescheduleRecurringSeriesPatch,
  getPlannerTaskPrimaryOccurrence,
  isRecurringPlannerRule
} from "../../lib/plannerRecurrence";
import {
  buildPlannerTaskSchedulePatch,
  getPlannerTaskDateDraft,
  type PlannerTaskDateDraft
} from "../../lib/plannerTaskSchedule";
import TagInputField from "../TagInputField";
import PlannerDateDialog from "./PlannerDateDialog";
import "./PlannerTaskInspector.css";

interface PlannerTaskInspectorViewProps {
  task: Task | null;
  projects: Project[];
  folders: Folder[];
  notes: Note[];
  tags: Tag[];
  language: AppLanguage;
  isMobile?: boolean;
  onUpdate: (taskId: string, patch: Partial<Task>) => Promise<void> | void;
  onToggleDone: (taskId: string, done: boolean, occurrenceStartAt?: number) => Promise<void> | void;
  onDelete: (taskId: string) => Promise<void> | void;
  onOpenNote?: (noteId: string) => void;
  onOpenProjectMap?: (projectId: string) => void;
  onCreateTag?: (name: string) => Promise<Tag>;
  onClose?: () => void;
}

type PlannerBacklink = {
  key: string;
  kind: "project" | "folder" | "note" | "canvas" | "block" | "canvasElement" | "url";
  title: string;
  subtitle: string;
  projectId?: string | null;
  noteId?: string | null;
  url?: string | null;
};

const PRIORITIES: PlannerTaskPriority[] = ["none", "low", "medium", "high", "urgent"];
const STATUSES: Task["status"][] = ["inbox", "todo", "scheduled", "inProgress", "waiting", "done", "canceled"];
const REMINDER_PRESETS = ["none", "0", "15", "60", "1440"] as const;

type PlannerReminderPreset = (typeof REMINDER_PRESETS)[number];
type PlannerTaskDateScope = "this" | "future" | "all";
type PlannerTaskScopedDateAction = {
  originalStartAt: number;
  currentStartAt: number;
  nextStartAt: number;
  nextEndAt: number | null;
};

function getBacklinkKindLabel(kind: PlannerBacklink["kind"], language: AppLanguage) {
  return translateApp(language, `plannerCore.backlinkKinds.${kind}`);
}

function getShortId(value: string | null | undefined) {
  return value ? value.slice(0, 8) : "";
}

function shiftLocalDay(value: number, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function getBacklinkCanonicalKey(input: {
  kind: PlannerBacklink["kind"];
  projectId?: string | null;
  folderId?: string | null;
  noteId?: string | null;
  canvasId?: string | null;
  sourceBlockId?: string | null;
  canvasElementId?: string | null;
  url?: string | null;
  fallbackId?: string | null;
}) {
  if (input.kind === "project" && input.projectId) {
    return `project:${input.projectId}`;
  }

  if (input.kind === "folder" && input.folderId) {
    return `folder:${input.folderId}`;
  }

  if (input.kind === "note" && input.noteId) {
    return `note:${input.noteId}`;
  }

  if (input.kind === "canvas" && input.canvasId) {
    return `canvas:${input.canvasId}`;
  }

  if (input.kind === "block" && input.sourceBlockId) {
    return `block:${input.sourceBlockId}`;
  }

  if (input.kind === "canvasElement" && input.canvasElementId) {
    return `canvasElement:${input.canvasElementId}`;
  }

  if (input.kind === "url" && input.url) {
    return `url:${input.url}`;
  }

  return `${input.kind}:${input.fallbackId ?? ""}`;
}

function buildPlannerBacklinks(input: {
  task: Task;
  projects: Project[];
  folders: Folder[];
  notes: Note[];
  language: AppLanguage;
}) {
  const { task, projects, folders, notes, language } = input;
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
  const noteMap = new Map(notes.map((note) => [note.id, note]));
  const backlinks: PlannerBacklink[] = [];
  const seenKeys = new Set<string>();
  const addBacklink = (backlink: PlannerBacklink) => {
    if (seenKeys.has(backlink.key)) {
      return;
    }

    seenKeys.add(backlink.key);
    backlinks.push(backlink);
  };

  if (task.projectId) {
    const project = projectMap.get(task.projectId);
    addBacklink({
      key: `project:${task.projectId}`,
      kind: "project",
      title: project?.name ?? (translateInline(language, "plannerTaskInspectorView.project")),
      subtitle: getBacklinkKindLabel("project", language),
      projectId: task.projectId
    });
  }

  if (task.folderId) {
    const folder = folderMap.get(task.folderId);
    addBacklink({
      key: `folder:${task.folderId}`,
      kind: "folder",
      title: folder?.name ?? (translateInline(language, "plannerTaskInspectorView.folder")),
      subtitle: getBacklinkKindLabel("folder", language)
    });
  }

  if (task.noteId) {
    const note = noteMap.get(task.noteId);
    addBacklink({
      key: `note:${task.noteId}`,
      kind: "note",
      title: note ? getDisplayNoteTitle(note, language) : translateInline(language, "plannerTaskInspectorView.note"),
      subtitle: getBacklinkKindLabel("note", language),
      noteId: task.noteId
    });
  }

  if (task.canvasId) {
    const canvas = noteMap.get(task.canvasId);
    addBacklink({
      key: `canvas:${task.canvasId}`,
      kind: "canvas",
      title: canvas ? getDisplayNoteTitle(canvas, language) : translateInline(language, "plannerTaskInspectorView.canvas"),
      subtitle: getBacklinkKindLabel("canvas", language),
      noteId: task.canvasId
    });
  }

  if (task.sourceBlockId) {
    const sourceLink = (task.links ?? []).find((link) => link.kind === "block" && link.sourceBlockId === task.sourceBlockId);
    addBacklink({
      key: `block:${task.sourceBlockId}`,
      kind: "block",
      title: sourceLink?.label || (translateInline(language, "plannerTaskInspectorView.block", { value0: getShortId(task.sourceBlockId) })),
      subtitle: translateInline(language, "plannerTaskInspectorView.sourceNoteBlock"),
      noteId: task.noteId
    });
  }

  if (task.canvasElementId) {
    const sourceLink = (task.links ?? []).find(
      (link) => link.kind === "canvasElement" && link.canvasElementId === task.canvasElementId
    );
    addBacklink({
      key: `canvasElement:${task.canvasElementId}`,
      kind: "canvasElement",
      title: sourceLink?.label || (translateInline(language, "plannerTaskInspectorView.element", { value0: getShortId(task.canvasElementId) })),
      subtitle: translateInline(language, "plannerTaskInspectorView.sourceCanvasObject"),
      noteId: task.canvasId
    });
  }

  (task.links ?? []).forEach((link) => {
    const key = getBacklinkCanonicalKey({
      kind: link.kind,
      projectId: link.projectId,
      folderId: link.folderId,
      noteId: link.noteId,
      canvasId: link.canvasId,
      sourceBlockId: link.sourceBlockId,
      canvasElementId: link.canvasElementId,
      url: link.url,
      fallbackId: link.id
    });

    addBacklink({
      key,
      kind: link.kind,
      title: link.label || getBacklinkKindLabel(link.kind, language),
      subtitle: getBacklinkKindLabel(link.kind, language),
      projectId: link.projectId,
      noteId: link.noteId ?? link.canvasId,
      url: link.url
    });
  });

  return backlinks;
}

function getReminderPreset(task: Task): PlannerReminderPreset {
  const enabledReminder = (task.reminders ?? []).find((reminder) => reminder.enabled);

  if (!enabledReminder) {
    return "none";
  }

  if (enabledReminder.offsetMinutes !== null) {
    const offset = String(enabledReminder.offsetMinutes);
    return REMINDER_PRESETS.includes(offset as PlannerReminderPreset) ? (offset as PlannerReminderPreset) : "15";
  }

  return "0";
}

function getReminderLabel(preset: PlannerReminderPreset, language: AppLanguage) {
  const keys: Record<PlannerReminderPreset, string> = {
    none: "none",
    "0": "atTime",
    "15": "min15",
    "60": "hour1",
    "1440": "day1"
  };
  return translateApp(language, `plannerCore.reminders.${keys[preset]}`);
}

function buildReminder(task: Task, preset: PlannerReminderPreset, language: AppLanguage): Reminder[] {
  if (preset === "none") {
    return [];
  }

  const offsetMinutes = Number(preset);
  const baseAt = task.scheduledStartAt ?? (task.dueAt ? task.dueAt + 9 * 60 * 60_000 : null);

  if (!baseAt) {
    return task.reminders ?? [];
  }

  const timestamp = Date.now();

  return [
    {
      id: crypto.randomUUID(),
      title: translateInline(language, "plannerTaskInspectorView.reminder"),
      remindAt: task.scheduledStartAt ? null : baseAt - offsetMinutes * 60_000,
      offsetMinutes,
      channel: "system",
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp
    }
  ];
}

export default function PlannerTaskInspectorView({
  task,
  projects,
  folders,
  notes,
  tags,
  language,
  isMobile = false,
  onUpdate,
  onToggleDone,
  onDelete,
  onOpenNote,
  onOpenProjectMap,
  onCreateTag,
  onClose
}: PlannerTaskInspectorViewProps) {
  const [titleDraft, setTitleDraft] = useState(task?.title ?? "");
  const [descriptionDraft, setDescriptionDraft] = useState(task?.description ?? "");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [isDateSelectorOpen, setIsDateSelectorOpen] = useState(false);
  const [isReminderPickerOpen, setIsReminderPickerOpen] = useState(false);
  const [scopedDateAction, setScopedDateAction] = useState<PlannerTaskScopedDateAction | null>(null);

  useEffect(() => {
    setTitleDraft(task?.title ?? "");
    setDescriptionDraft(task?.description ?? "");
    setDeleteArmed(false);
    setIsDateSelectorOpen(false);
    setIsReminderPickerOpen(false);
    setScopedDateAction(null);
  }, [task?.description, task?.id, task?.title]);

  const projectMap = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const selectedProject = task?.projectId ? projectMap.get(task.projectId) ?? null : null;
  const backlinks = useMemo(
    () => (task ? buildPlannerBacklinks({ task, projects, folders, notes, language }) : []),
    [folders, language, notes, projects, task]
  );

  if (!task) {
    return (
      <aside className={`planner-task-inspector planner-task-panel is-empty ${isMobile ? "is-mobile-sheet" : ""}`}>
        <div className="planner-task-panel-empty">
          <span className="planner-task-panel-kicker">{translateInline(language, "plannerTaskInspectorView.inspector")}</span>
          <h2>{translateInline(language, "plannerTaskInspectorView.selectATask")}</h2>
          <p>
            {translateInline(language, "plannerTaskInspectorView.statusDateRemindersTagsAndLinkedContext")}
          </p>
        </div>
      </aside>
    );
  }

  const done = task.status === "done" || Boolean(task.completedAt);
  const scheduleDraft = getPlannerTaskDateDraft(task);
  const scheduleSummary = getPlannerTaskScheduleSummary(task, language);
  const reminderPreset = getReminderPreset(task);
  const hasAnyDate = Boolean(task.scheduledStartAt || task.dueAt || task.recurrenceRule);
  const primaryOccurrence = getPlannerTaskPrimaryOccurrence(task);
  const createdAtLabel =
    task.createdAt > 0
      ? formatPlannerFullDateTime(task.createdAt, language)
      : translateInline(language, "plannerTaskInspectorView.unknown");

  const commitTitle = () => {
    const nextTitle = titleDraft.trim();
    if (nextTitle && nextTitle !== task.title) {
      void onUpdate(task.id, { title: nextTitle });
    } else {
      setTitleDraft(task.title);
    }
  };

  const commitDescription = () => {
    const nextDescription = descriptionDraft.trim();
    if (nextDescription !== task.description) {
      void onUpdate(task.id, { description: nextDescription });
    }
  };

  const applyDateDraft = (draft: PlannerTaskDateDraft) => {
    const patch = buildPlannerTaskSchedulePatch(task, draft);
    setIsDateSelectorOpen(false);
    void onUpdate(task.id, patch);
  };

  const shiftDate = (days: number) => {
    if (isRecurringPlannerRule(task.recurrenceRule) && primaryOccurrence) {
      setScopedDateAction({
        originalStartAt: primaryOccurrence.originalStartAt,
        currentStartAt: primaryOccurrence.startAt,
        nextStartAt: shiftLocalDay(primaryOccurrence.startAt, days),
        nextEndAt: primaryOccurrence.scheduledStartAt ? shiftLocalDay(primaryOccurrence.endAt, days) : null
      });
      return;
    }

    const baseDraft = getPlannerTaskDateDraft(task);
    if (!baseDraft.startDateAt) {
      return;
    }

    applyDateDraft({
      ...baseDraft,
      startDateAt: shiftLocalDay(baseDraft.startDateAt, days),
      endDateAt: baseDraft.endDateAt ? shiftLocalDay(baseDraft.endDateAt, days) : null,
      repeatUntilAt: baseDraft.repeatUntilAt ? shiftLocalDay(baseDraft.repeatUntilAt, days) : null
    });
  };

  const applyScopedDateAction = (scope: PlannerTaskDateScope) => {
    if (!scopedDateAction) {
      return;
    }

    const patch =
      scope === "this"
        ? buildRescheduleOccurrencePatch(
            task,
            scopedDateAction.originalStartAt,
            scopedDateAction.nextStartAt,
            scopedDateAction.nextEndAt
          )
        : buildRescheduleRecurringSeriesPatch(
            task,
            scopedDateAction.originalStartAt,
            scopedDateAction.nextStartAt,
            scopedDateAction.nextEndAt,
            scope,
            scopedDateAction.currentStartAt
          );

    setScopedDateAction(null);
    void onUpdate(task.id, patch);
  };

  const updateReminder = (preset: PlannerReminderPreset) => {
    if (preset !== "none" && !hasAnyDate) {
      return;
    }

    setIsReminderPickerOpen(false);
    void onUpdate(task.id, { reminders: buildReminder(task, preset, language) });
  };

  return (
    <aside className={`planner-task-inspector planner-task-panel ${isMobile ? "is-mobile-sheet" : ""}`}>
      <header className="planner-task-inspector-head">
        <div
          className="planner-task-inspector-orb"
          style={{ "--planner-task-project-color": selectedProject?.color ?? "var(--planner-task-accent)" } as CSSProperties}
          aria-hidden="true"
        />
        <div className="planner-task-inspector-title">
          <span className="planner-task-panel-kicker">{translateInline(language, "plannerTaskInspectorView.task")}</span>
          <input
            type="text"
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            placeholder={translateInline(language, "plannerTaskInspectorView.whatNeedsToHappen")}
          />
          <small>{scheduleSummary}</small>
        </div>
        {onClose ? (
          <button type="button" className="planner-task-panel-close" onClick={onClose} aria-label={translateInline(language, "plannerTaskInspectorView.close")}>
            ×
          </button>
        ) : null}
      </header>

      <div className="planner-task-action-row">
        <button
          type="button"
          className={done ? "is-done" : ""}
          onClick={() => void onToggleDone(task.id, !done, primaryOccurrence?.originalStartAt)}
        >
          <span className={`planner-task-action-icon ${done ? "is-return" : "is-check"}`} aria-hidden="true" />
          <span>{done ? (translateInline(language, "plannerTaskInspectorView.reopen")) : translateInline(language, "plannerTaskInspectorView.done")}</span>
        </button>
        <button
          type="button"
          className="is-danger"
          onClick={() => {
            if (!deleteArmed) {
              setDeleteArmed(true);
              return;
            }
            void onDelete(task.id);
          }}
        >
          <span className={`planner-task-action-icon ${deleteArmed ? "is-confirm-delete" : "is-trash"}`} aria-hidden="true" />
          <span>{deleteArmed ? (translateInline(language, "plannerTaskInspectorView.confirm")) : translateInline(language, "plannerTaskInspectorView.delete")}</span>
        </button>
      </div>

      <section className="planner-task-choice-section">
        <div className="planner-task-section-title">
          <span>{translateInline(language, "plannerTaskInspectorView.project2")}</span>
        </div>
        <div className="planner-task-chip-row is-projects">
          <button
            type="button"
            className={!task.projectId ? "is-active" : ""}
            onClick={() => void onUpdate(task.id, { projectId: null })}
          >
            <span className="planner-task-project-dot" style={{ "--planner-task-project-color": "var(--planner-task-accent)" } as CSSProperties} />
            <strong>{translateInline(language, "plannerTaskInspectorView.noProject")}</strong>
          </button>
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className={project.id === task.projectId ? "is-active" : ""}
              onClick={() => void onUpdate(task.id, { projectId: project.id })}
            >
              <span className="planner-task-project-dot" style={{ "--planner-task-project-color": project.color } as CSSProperties} />
              <strong>{project.name}</strong>
            </button>
          ))}
        </div>
      </section>

      <section className="planner-task-choice-section">
        <div className="planner-task-section-title">
          <span>{translateInline(language, "plannerTaskInspectorView.status")}</span>
        </div>
        <div className="planner-task-chip-row is-status">
          {STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={task.status === status ? "is-active" : ""}
              onClick={() => void onUpdate(task.id, { status })}
            >
              {getPlannerStatusLabel(status, language)}
            </button>
          ))}
        </div>
      </section>

      <section className="planner-task-choice-section">
        <div className="planner-task-section-title">
          <span>{translateInline(language, "plannerTaskInspectorView.priority")}</span>
        </div>
        <div className="planner-task-chip-row planner-task-priority-row">
          {PRIORITIES.map((priority) => (
            <button
              key={priority}
              type="button"
              className={`is-${priority} ${task.priority === priority ? "is-active" : ""}`}
              onClick={() => void onUpdate(task.id, { priority })}
            >
              <span />
              <strong>{getPlannerPriorityLabel(priority, language)}</strong>
            </button>
          ))}
        </div>
      </section>

      <section className="planner-task-date-card">
        <button type="button" className="planner-task-date-summary" onClick={() => setIsDateSelectorOpen((current) => !current)}>
          <span className="planner-task-date-icon" aria-hidden="true" />
          <span>
            <small>{translateInline(language, "plannerTaskInspectorView.date")}</small>
            <strong>{scheduleSummary}</strong>
          </span>
        </button>
        <div className="planner-task-date-stepper-row">
          <button type="button" onClick={() => shiftDate(-1)} disabled={!hasAnyDate}>
            {translateInline(language, "plannerTaskInspectorView.day")}
          </button>
          <button type="button" onClick={() => shiftDate(1)} disabled={!hasAnyDate}>
            {translateInline(language, "plannerTaskInspectorView.day2")}
          </button>
        </div>
        <div className="planner-task-date-meta">
          <span>{translateInline(language, "plannerTaskInspectorView.created")}</span>
          <strong>{createdAtLabel}</strong>
        </div>
      </section>

      <section className="planner-task-choice-section">
        <div className="planner-task-section-title">
          <span>{translateInline(language, "plannerTaskInspectorView.reminder2")}</span>
          {!hasAnyDate ? <small>{translateInline(language, "plannerTaskInspectorView.chooseDateFirst")}</small> : null}
        </div>
        <button
          type="button"
          className="planner-task-reminder-card"
          onClick={() => setIsReminderPickerOpen((current) => !current)}
          disabled={!hasAnyDate && reminderPreset === "none"}
        >
          <span className="planner-task-reminder-icon" aria-hidden="true" />
          <span>
            <small>{reminderPreset === "none" ? (translateInline(language, "plannerTaskInspectorView.add")) : translateInline(language, "plannerTaskInspectorView.selected")}</small>
            <strong>{getReminderLabel(reminderPreset, language)}</strong>
          </span>
        </button>
        {isReminderPickerOpen ? (
          <div className="planner-task-chip-row planner-task-reminder-row">
            {REMINDER_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={reminderPreset === preset ? "is-active" : ""}
                disabled={preset !== "none" && !hasAnyDate}
                onClick={() => updateReminder(preset)}
              >
                {getReminderLabel(preset, language)}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="planner-task-description-block">
        <div className="planner-task-section-title">
          <span>{translateInline(language, "plannerTaskInspectorView.description")}</span>
        </div>
        <textarea
          value={descriptionDraft}
          rows={descriptionDraft ? 4 : 2}
          onChange={(event) => setDescriptionDraft(event.target.value)}
          onBlur={commitDescription}
          placeholder={translateInline(language, "plannerTaskInspectorView.contextAcceptanceNotesLinks")}
        />
      </section>

      <section className="planner-task-choice-section">
        <div className="planner-task-section-title">
          <span>{translateInline(language, "plannerTaskInspectorView.tags")}</span>
          <small>{task.tagIds.length}</small>
        </div>
        {onCreateTag ? (
          <TagInputField
            tags={tags}
            selectedTagIds={task.tagIds}
            language={language}
            onCreateTag={onCreateTag}
            dropdownWithinPortal
            variant="planner"
            onChangeTagIds={(tagIds) => onUpdate(task.id, { tagIds })}
          />
        ) : (
          <p className="planner-task-muted">{translateInline(language, "plannerTaskInspectorView.tagsCanBeAddedInDocuments")}</p>
        )}
      </section>

      {backlinks.length > 0 ? (
        <section className="planner-task-links-section">
          <div className="planner-task-section-title">
            <span>{translateInline(language, "plannerTaskInspectorView.links")}</span>
            <small>{backlinks.length}</small>
          </div>
          <div className="planner-task-calendar-link-list">
            {backlinks.map((backlink) => {
              const canOpen =
                Boolean(backlink.noteId && onOpenNote) ||
                Boolean(backlink.projectId && onOpenProjectMap) ||
                Boolean(backlink.url);
              const linkedProject =
                backlink.kind === "project" && task.projectId ? projectMap.get(task.projectId) ?? selectedProject : null;
              const content = (
                <>
                  {linkedProject ? <i style={{ "--project-color": linkedProject.color } as CSSProperties} /> : null}
                  <span>
                    {backlink.subtitle} · {backlink.title}
                  </span>
                </>
              );

              if (!canOpen) {
                return <span key={backlink.key}>{content}</span>;
              }

              return (
                <button
                  key={backlink.key}
                  type="button"
                  className={`is-${backlink.kind}`}
                  onClick={() => {
                    if (backlink.noteId && onOpenNote) {
                      onOpenNote(backlink.noteId);
                      return;
                    }
                    if (backlink.projectId && onOpenProjectMap) {
                      onOpenProjectMap(backlink.projectId);
                      return;
                    }
                    if (backlink.url) {
                      window.open(backlink.url, "_blank", "noopener,noreferrer");
                    }
                  }}
                >
                  {content}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
      <PlannerDateDialog
        open={isDateSelectorOpen}
        value={scheduleDraft}
        language={language}
        isMobile={isMobile}
        onClose={() => setIsDateSelectorOpen(false)}
        onApply={applyDateDraft}
      />
      {scopedDateAction
        ? createPortal(
            <div className="planner-task-scope-layer" role="dialog" aria-modal="true">
              <button
                type="button"
                className="planner-task-scope-backdrop"
                onClick={() => setScopedDateAction(null)}
                aria-label={translateInline(language, "plannerTaskInspectorView.cancel")}
              />
              <section className="planner-task-scope-dialog">
                <span className="planner-task-panel-kicker">{translateInline(language, "plannerTaskInspectorView.recurringTask")}</span>
                <h3>{translateInline(language, "plannerTaskInspectorView.moveRepeatingEvent")}</h3>
                <p>
                  {translateInline(language, "plannerTaskInspectorView.chooseWhetherToMoveOnlyTheNearest")}
                </p>
                <div>
                  <button type="button" onClick={() => applyScopedDateAction("this")}>
                    <strong>{translateInline(language, "plannerTaskInspectorView.onlyThis")}</strong>
                    <small>{translateInline(language, "plannerTaskInspectorView.aPreciseOverrideForThisOccurrence")}</small>
                  </button>
                  <button type="button" onClick={() => applyScopedDateAction("future")}>
                    <strong>{translateInline(language, "plannerTaskInspectorView.thisAndFuture")}</strong>
                    <small>{translateInline(language, "plannerTaskInspectorView.keepsOneTaskWithoutDuplicates")}</small>
                  </button>
                  <button type="button" onClick={() => applyScopedDateAction("all")}>
                    <strong>{translateInline(language, "plannerTaskInspectorView.wholeSeries")}</strong>
                    <small>{translateInline(language, "plannerTaskInspectorView.moveTheRecurrenceAsAWhole")}</small>
                  </button>
                </div>
              </section>
            </div>,
            document.body
          )
        : null}
    </aside>
  );
}
