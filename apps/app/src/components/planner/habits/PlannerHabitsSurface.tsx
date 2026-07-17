import { translateApp, translateInline } from "../../../localization/translateInline";
import {
  formatDateValue,
  formatRelativeDate,
  getCurrentLocaleRuntime,
  getPlannerHabitCadenceLabel
} from "../../../localization";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { AppLanguage, Habit, HabitLog, Project } from "../../../types";
import {
  buildPlannerHabitFrequencyRule,
  buildPlannerHabitSummaries,
  type PlannerHabitCadencePreset,
  type PlannerHabitSummary
} from "../../../lib/plannerHabits";
import type { PlannerHabitCreateInput, PlannerHabitUpdateInput } from "../../../lib/planner";
import { useVisualKeyboardInset } from "../../../lib/useVisualKeyboardInset";
import { useFlipListMotion } from "../../../lib/useFlipListMotion";
import type { PlannerUndoSnackbarAction } from "../PlannerUndoSnackbar";
import "./PlannerHabitsSurface.css";

interface PlannerHabitsSurfaceProps {
  habits: Habit[];
  habitLogs: HabitLog[];
  projects: Project[];
  language: AppLanguage;
  isMobile: boolean;
  isTouchLayout: boolean;
  selectedHabitId: string | null;
  isComposerOpen: boolean;
  hideDesktopInspector?: boolean;
  onSelectHabit: (habitId: string | null) => void;
  onComposerOpenChange: (open: boolean) => void;
  onCreateHabit: (input: PlannerHabitCreateInput) => Promise<Habit>;
  onUpdateHabit: (habitId: string, patch: PlannerHabitUpdateInput) => Promise<Habit | null>;
  onDeleteHabit: (habitId: string) => Promise<void>;
  onToggleHabitLog: (habitId: string, dayAt?: number) => Promise<HabitLog | null>;
  onShowUndo?: (label: string, undo: PlannerUndoSnackbarAction["undo"]) => void;
}

type HabitFilterId = "today" | "all";

const HABIT_FILTERS: HabitFilterId[] = ["today", "all"];
const CADENCE_PRESETS: PlannerHabitCadencePreset[] = ["daily", "weekdays", "weekly", "customDaily"];

function getHabitFilterLabel(filterId: HabitFilterId, language: AppLanguage) {
  return translateApp(language, `plannerCore.habitFilters.${filterId}`);
}

function getCadencePresetLabel(preset: PlannerHabitCadencePreset, _intervalDays: number, language: AppLanguage) {
  return translateApp(language, `plannerCore.habitCadenceShort.${preset}`);
}

function getLastLogLabel(value: number | null, language: AppLanguage) {
  if (!value) {
    return translateInline(language, "plannerHabitsSurface.noCheckInsYet");
  }

  return formatRelativeDate(value, getCurrentLocaleRuntime(), {
    fallbackOptions: { day: "numeric", month: "short" }
  });
}

function getShortDateLabel(value: number, language: AppLanguage) {
  void language;
  return formatDateValue(value, getCurrentLocaleRuntime(), {
    day: "numeric",
    month: "short"
  });
}

function formatHabitRate(value: number | null, language: AppLanguage) {
  if (value === null) {
    return translateInline(language, "plannerHabitsSurface.noData");
  }

  return `${Math.round(value * 100)}%`;
}

function getHabitHealthLabel(summary: PlannerHabitSummary, language: AppLanguage) {
  return translateApp(language, `plannerCore.habitHealth.${summary.health}`);
}

function getHabitHealthDescription(summary: PlannerHabitSummary, language: AppLanguage) {
  if (summary.health === "paused") {
    return translateInline(language, "plannerHabitsSurface.pausedDaysKeepTheStreakIntact");
  }

  if (summary.health === "new") {
    return translateInline(language, "plannerHabitsSurface.notEnoughHistoryYet");
  }

  if (summary.health === "steady") {
    return translateInline(language, "plannerHabitsSurface.theLast30DaysLookStable");
  }

  if (summary.health === "risk") {
    return translateInline(language, "plannerHabitsSurface.missesArePilingUpOverTheLast");
  }

  return summary.dueToday && !summary.completedToday
    ? translateInline(language, "plannerHabitsSurface.todaySCheckInIsStillOpen")
    : translateInline(language, "plannerHabitsSurface.theRhythmIsActiveButWorthWatching");
}

function getWeekdayLabel(value: number, language: AppLanguage) {
  void language;
  return formatDateValue(value, getCurrentLocaleRuntime(), {
    weekday: "short"
  });
}

function getTodayState(summary: PlannerHabitSummary, language: AppLanguage) {
  if (summary.habit.status === "paused") {
    return translateInline(language, "plannerHabitsSurface.paused");
  }

  if (summary.completedToday) {
    return translateInline(language, "plannerHabitsSurface.checkedInToday");
  }

  if (summary.dueToday) {
    return translateInline(language, "plannerHabitsSurface.dueToday");
  }

  return translateInline(language, "plannerHabitsSurface.notScheduledToday");
}

function getHabitActionLabel(summary: PlannerHabitSummary, language: AppLanguage) {
  if (summary.habit.status === "paused") {
    return translateInline(language, "plannerHabitsSurface.paused2");
  }

  if (summary.completedToday) {
    return translateInline(language, "plannerHabitsSurface.undoCheckIn");
  }

  if (!summary.dueToday) {
    return translateInline(language, "plannerHabitsSurface.notScheduled");
  }

  return translateInline(language, "plannerHabitsSurface.checkInToday");
}

function HabitWeekStrip({ summary, language }: { summary: PlannerHabitSummary; language: AppLanguage }) {
  return (
    <div className="planner-habit-week-strip" aria-label={translateInline(language, "plannerHabitsSurface.habitWeek")}>
      {summary.weekDays.map((day) => (
        <span
          key={day.dayAt}
          className={`${day.due ? "is-due" : ""} ${day.completed ? "is-complete" : ""} ${
            day.missed ? "is-missed" : ""
          } ${day.paused ? "is-paused" : ""} ${day.today ? "is-today" : ""} ${day.future ? "is-future" : ""}`}
          title={getWeekdayLabel(day.dayAt, language)}
        />
      ))}
    </div>
  );
}

function HabitHistoryHeatmap({ summary, language }: { summary: PlannerHabitSummary; language: AppLanguage }) {
  return (
    <section className="planner-habit-history">
      <div className="planner-habit-history-head">
        <div>
          <span>{translateInline(language, "plannerHabitsSurface.history")}</span>
          <strong>{translateInline(language, "plannerHabitsSurface.last8Weeks")}</strong>
        </div>
        <em>
          {summary.last30CompletedCount}/{summary.last30DueCount} · {formatHabitRate(summary.last30CompletionRate, language)}
        </em>
      </div>
      <div className="planner-habit-history-heatmap" aria-label={translateInline(language, "plannerHabitsSurface.checkInHistory")}>
        {summary.historyDays.map((day) => (
          <span
            key={day.dayAt}
            className={`${day.due ? "is-due" : ""} ${day.completed ? "is-complete" : ""} ${
              day.missed ? "is-missed" : ""
            } ${day.paused ? "is-paused" : ""} ${day.today ? "is-today" : ""}`}
            title={`${getShortDateLabel(day.dayAt, language)}${
              day.completed
                ? translateInline(language, "plannerHabitsSurface.done")
                : day.missed
                  ? translateInline(language, "plannerHabitsSurface.missed")
                  : day.due
                    ? translateInline(language, "plannerHabitsSurface.scheduled")
                    : ""
            }`}
          />
        ))}
      </div>
    </section>
  );
}

function HabitRecentLogs({ summary, language }: { summary: PlannerHabitSummary; language: AppLanguage }) {
  return (
    <section className="planner-habit-recent">
      <div className="planner-habit-history-head">
        <div>
          <span>{translateInline(language, "plannerHabitsSurface.recent")}</span>
          <strong>{translateInline(language, "plannerHabitsSurface.recentCheckIns")}</strong>
        </div>
      </div>
      {summary.recentLogDays.length > 0 ? (
        <div className="planner-habit-recent-row">
          {summary.recentLogDays.map((dayAt) => (
            <span key={dayAt}>{getShortDateLabel(dayAt, language)}</span>
          ))}
        </div>
      ) : (
        <p>{translateInline(language, "plannerHabitsSurface.noCheckInsYet2")}</p>
      )}
    </section>
  );
}

function HabitLegend({ language }: { language: AppLanguage }) {
  const items = [
    ["is-complete", translateApp(language, "plannerCore.habitLegend.complete")],
    ["is-missed", translateApp(language, "plannerCore.habitLegend.missed")],
    ["is-today", translateApp(language, "plannerCore.habitLegend.today")],
    ["is-paused", translateApp(language, "plannerCore.habitLegend.paused")]
  ];

  return (
    <div className="planner-habit-legend" aria-label={translateInline(language, "plannerHabitsSurface.habitLegend")}>
      {items.map(([className, label]) => (
        <span key={className}>
          <i className={className} aria-hidden="true" />
          {label}
        </span>
      ))}
    </div>
  );
}

function getHabitRestoreInput(habit: Habit): PlannerHabitCreateInput {
  return {
    title: habit.title,
    description: habit.description,
    status: habit.status,
    projectId: habit.projectId,
    noteId: habit.noteId,
    color: habit.color,
    icon: habit.icon,
    frequencyRule: habit.frequencyRule,
    frequencyTimezone: habit.frequencyTimezone,
    targetCount: habit.targetCount,
    targetUnit: habit.targetUnit,
    targetPeriod: habit.targetPeriod,
    reminders: habit.reminders.map((reminder) => ({ ...reminder })),
    sortOrder: habit.sortOrder
  };
}

interface PlannerHabitInspectorPanelProps {
  summary: PlannerHabitSummary | null;
  language: AppLanguage;
  variant?: "aside" | "sheet";
  onClose?: () => void;
  onToggleToday: (habitId: string) => void;
  onRename?: (summary: PlannerHabitSummary, title: string) => Promise<void> | void;
  onTogglePaused: (summary: PlannerHabitSummary) => void;
  onArchive: (summary: PlannerHabitSummary) => void;
  onDelete: (summary: PlannerHabitSummary) => void;
}

export function PlannerHabitInspectorPanel({
  summary,
  language,
  variant = "aside",
  onClose,
  onToggleToday,
  onRename,
  onTogglePaused,
  onArchive,
  onDelete
}: PlannerHabitInspectorPanelProps) {
  const [titleDraft, setTitleDraft] = useState(summary?.habit.title ?? "");

  useEffect(() => {
    setTitleDraft(summary?.habit.title ?? "");
  }, [summary?.habit.id, summary?.habit.title]);

  const commitTitle = () => {
    if (!summary || !onRename) {
      return;
    }

    const nextTitle = titleDraft.trim();

    if (!nextTitle) {
      setTitleDraft(summary.habit.title);
      return;
    }

    if (nextTitle !== summary.habit.title) {
      setTitleDraft(nextTitle);
      void Promise.resolve(onRename(summary, nextTitle)).catch(() => setTitleDraft(summary.habit.title));
    } else {
      setTitleDraft(summary.habit.title);
    }
  };

  const content = summary ? (
    <>
      {variant === "sheet" ? <div className="planner-habit-mobile-sheet-handle" aria-hidden="true" /> : null}
      <div className={`planner-habit-detail-content is-${variant}`} style={{ "--planner-habit-color": summary.habit.color } as CSSProperties}>
        <div className="planner-habit-detail-head" style={{ "--planner-habit-color": summary.habit.color } as CSSProperties}>
          <span />
          <div>
            {onRename ? (
              <input
                className="planner-habit-title-input"
                type="text"
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={commitTitle}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    setTitleDraft(summary.habit.title);
                    event.currentTarget.blur();
                  }
                }}
                aria-label={translateInline(language, "plannerHabitsSurface.habitTitle")}
                placeholder={translateInline(language, "plannerHabitsSurface.habitTitle2")}
              />
            ) : (
              <strong>{summary.habit.title}</strong>
            )}
            <em>{getPlannerHabitCadenceLabel(summary.habit.frequencyRule, language)}</em>
          </div>
          {variant === "sheet" ? (
            <button
              type="button"
              className="planner-habit-sheet-close"
              onClick={onClose}
              aria-label={translateInline(language, "plannerHabitsSurface.close")}
            />
          ) : null}
        </div>

        <div className={`planner-habit-today-card ${summary.completedToday ? "is-complete" : ""}`}>
          <div>
            <span>{translateInline(language, "plannerHabitsSurface.today")}</span>
            <strong>{getTodayState(summary, language)}</strong>
          </div>
          <button
            type="button"
            disabled={summary.habit.status !== "active" || !summary.dueToday}
            onClick={() => onToggleToday(summary.habit.id)}
          >
            {getHabitActionLabel(summary, language)}
          </button>
        </div>

        <div className="planner-habit-detail-grid">
          <div>
            <span>{translateInline(language, "plannerHabitsSurface.streak")}</span>
            <strong>{summary.streak}</strong>
          </div>
          <div>
            <span>{translateInline(language, "plannerHabitsSurface.best")}</span>
            <strong>{summary.bestStreak}</strong>
          </div>
          <div>
            <span>{translateInline(language, "plannerHabitsSurface.week")}</span>
            <strong>
              {summary.weekCompletedCount}/{summary.weekDueCount}
            </strong>
          </div>
          <div>
            <span>{translateInline(language, "plannerHabitsSurface.30Days")}</span>
            <strong>{formatHabitRate(summary.last30CompletionRate, language)}</strong>
          </div>
          <div>
            <span>{translateInline(language, "plannerHabitsSurface.missed2")}</span>
            <strong>{summary.last30MissedCount}</strong>
          </div>
          <div>
            <span>{translateInline(language, "plannerHabitsSurface.last")}</span>
            <strong>{getLastLogLabel(summary.lastLogAt, language)}</strong>
          </div>
        </div>

        <div className={`planner-habit-health-card is-${summary.health}`}>
          <div>
            <span>{translateInline(language, "plannerHabitsSurface.state")}</span>
            <strong>{getHabitHealthLabel(summary, language)}</strong>
          </div>
          <p>{getHabitHealthDescription(summary, language)}</p>
        </div>

        <HabitHistoryHeatmap summary={summary} language={language} />
        <HabitRecentLogs summary={summary} language={language} />

        <div className="planner-habit-detail-week">
          <div>
            <span>{translateInline(language, "plannerHabitsSurface.week2")}</span>
            <strong>{translateInline(language, "plannerHabitsSurface.scheduleAndCheckIns")}</strong>
          </div>
          <HabitWeekStrip summary={summary} language={language} />
        </div>

        <div className="planner-habit-detail-actions">
          <button type="button" className="is-secondary" onClick={() => onTogglePaused(summary)}>
            <span className="planner-habit-action-icon is-pause" />
            {summary.habit.status === "paused"
              ? translateInline(language, "plannerHabitsSurface.resume")
              : translateInline(language, "plannerHabitsSurface.pause")}
          </button>
          <button type="button" className="is-secondary" onClick={() => onArchive(summary)}>
            <span className="planner-habit-action-icon is-archive" />
            {translateInline(language, "plannerHabitsSurface.archive")}
          </button>
          <button type="button" className="is-danger" onClick={() => onDelete(summary)}>
            <span className="planner-habit-action-icon is-delete" />
            {translateInline(language, "plannerHabitsSurface.delete")}
          </button>
        </div>
        <div className="planner-habit-detail-note">
          {summary.habit.status === "paused"
            ? translateInline(language, "plannerHabitsSurface.pauseKeepsTheStreakIntactPausedDays")
            : translateInline(language, "plannerHabitsSurface.eachCheckInIsStoredForA")}
        </div>
      </div>
    </>
  ) : (
    <div className="planner-habit-empty is-detail">
      <strong>{translateInline(language, "plannerHabitsSurface.selectAHabit")}</strong>
      <span>{translateInline(language, "plannerHabitsSurface.cadenceStreakWeekAndActionsWillAppear")}</span>
    </div>
  );

  if (variant === "sheet") {
    return <>{content}</>;
  }

  return (
    <aside className={`planner-habit-detail ${summary ? "" : "is-empty"}`}>
      {content}
    </aside>
  );
}

function HabitCard({
  summary,
  language,
  selected,
  feedbackDone,
  onSelect,
  onToggleToday
}: {
  summary: PlannerHabitSummary;
  language: AppLanguage;
  selected: boolean;
  feedbackDone: boolean;
  onSelect: () => void;
  onToggleToday: () => void;
}) {
  const { habit } = summary;
  const completedToday = summary.completedToday || feedbackDone;
  const checkDisabled = feedbackDone || habit.status === "paused" || habit.status === "archived" || !summary.dueToday;

  return (
    <article
      data-motion-key={habit.id}
      className={`planner-habit-card ${selected ? "is-selected" : ""} ${
        completedToday ? "is-complete" : ""
      } ${feedbackDone ? "is-completing" : ""} ${habit.status === "paused" ? "is-paused" : ""} ${
        summary.missed ? "is-missed" : ""
      }`}
      style={{ "--planner-habit-color": habit.color } as CSSProperties}
      onClick={onSelect}
    >
      <button
        type="button"
        className="planner-habit-check"
        aria-pressed={completedToday}
        disabled={checkDisabled}
        onClick={(event) => {
          event.stopPropagation();

          if (!checkDisabled) {
            onToggleToday();
          }
        }}
      >
        <span />
      </button>
      <div className="planner-habit-card-main">
        <div className="planner-habit-card-title">
          <strong>{habit.title}</strong>
          {summary.project ? <em>{summary.project.name}</em> : null}
        </div>
        <div className="planner-habit-card-meta">
          <span>{getPlannerHabitCadenceLabel(habit.frequencyRule, language)}</span>
          <span className="is-progress">
            {translateInline(language, "plannerHabitsSurface.30Days2")} {formatHabitRate(summary.last30CompletionRate, language)}
          </span>
          {summary.last30MissedCount > 0 ? (
            <span className="is-warning">{translateInline(language, "plannerHabitsSurface.missed3", { value0: summary.last30MissedCount })}</span>
          ) : summary.streak > 0 ? (
            <span>{translateInline(language, "plannerHabitsSurface.dStreak", { value0: summary.streak })}</span>
          ) : null}
          <span className={`is-health is-${summary.health}`}>{getHabitHealthLabel(summary, language)}</span>
        </div>
        <HabitWeekStrip summary={summary} language={language} />
      </div>
    </article>
  );
}

export default function PlannerHabitsSurface({
  habits,
  habitLogs,
  projects,
  language,
  isMobile,
  isTouchLayout,
  selectedHabitId,
  isComposerOpen,
  hideDesktopInspector = false,
  onSelectHabit,
  onComposerOpenChange,
  onCreateHabit,
  onUpdateHabit,
  onDeleteHabit,
  onToggleHabitLog,
  onShowUndo
}: PlannerHabitsSurfaceProps) {
  const [filterId, setFilterId] = useState<HabitFilterId>("today");
  const [titleDraft, setTitleDraft] = useState("");
  const [projectDraft, setProjectDraft] = useState("");
  const [cadenceDraft, setCadenceDraft] = useState<PlannerHabitCadencePreset>("daily");
  const [intervalDraft, setIntervalDraft] = useState(2);
  const [isCreating, setIsCreating] = useState(false);
  const [completingHabitIds, setCompletingHabitIds] = useState<Set<string>>(() => new Set());
  const habitListRef = useRef<HTMLDivElement | null>(null);
  const keyboardInset = useVisualKeyboardInset(isMobile);
  const summaries = useMemo(
    () =>
      buildPlannerHabitSummaries({
        habits,
        habitLogs,
        projects
      }),
    [habitLogs, habits, projects]
  );
  const visibleSummaries = useMemo(
    () =>
      summaries.filter((summary) => {
        if (filterId === "today") {
          return summary.habit.status !== "archived" && summary.dueToday;
        }

        return summary.habit.status !== "archived";
      }),
    [filterId, summaries]
  );
  const habitLayoutKey = visibleSummaries
    .map((summary) => `${summary.habit.id}:${summary.completedToday ? "done" : "open"}`)
    .join("|");
  useFlipListMotion(habitListRef, habitLayoutKey);
  const selectedSummary = selectedHabitId
    ? summaries.find((summary) => summary.habit.id === selectedHabitId) ?? null
    : null;
  const activeCount = summaries.filter((summary) => summary.habit.status === "active").length;
  const doneTodayCount = summaries.filter((summary) => summary.completedToday).length;
  const dueTodayCount = summaries.filter((summary) => summary.dueToday).length;
  const missedCount = summaries.reduce((sum, summary) => sum + summary.last30MissedCount, 0);

  const resetComposer = () => {
    setTitleDraft("");
    setProjectDraft("");
    setCadenceDraft("daily");
    setIntervalDraft(2);
  };

  const closeComposer = () => {
    onComposerOpenChange(false);
    resetComposer();
  };

  useEffect(() => {
    if (!selectedHabitId) {
      return;
    }

    if (!visibleSummaries.some((summary) => summary.habit.id === selectedHabitId)) {
      onSelectHabit(null);
    }
  }, [onSelectHabit, selectedHabitId, visibleSummaries]);

  useEffect(() => {
    if (!isComposerOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeComposer();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isComposerOpen]);

  const handleBlankPointerDown = (event: PointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;

    if (
      target.closest(
        "button,input,select,textarea,a,.planner-habit-card,.planner-habit-composer,.planner-habit-detail,.planner-habit-mobile-sheet"
      )
    ) {
      return;
    }

    onSelectHabit(null);

    if (isComposerOpen && !isTouchLayout) {
      closeComposer();
    }
  };

  const handleFilterChange = (nextFilterId: HabitFilterId) => {
    setFilterId(nextFilterId);
    onSelectHabit(null);

    if (isComposerOpen) {
      closeComposer();
    }
  };

  const handleCreateHabit = async () => {
    const title = titleDraft.trim();

    if (!title || isCreating) {
      return;
    }

    setIsCreating(true);
    try {
      const project = projects.find((item) => item.id === projectDraft) ?? null;
      const habit = await onCreateHabit({
        title,
        projectId: project?.id ?? null,
        color: project?.color,
        frequencyRule: buildPlannerHabitFrequencyRule(cadenceDraft, intervalDraft),
        targetCount: 1,
        targetUnit: "count",
        targetPeriod: "day"
      });
      onSelectHabit(habit.id);
      closeComposer();
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleHabitToday = async (habitId: string) => {
    const summary = summaries.find((item) => item.habit.id === habitId);

    if (!summary?.dueToday) {
      return;
    }

    if (!summary.completedToday) {
      if (completingHabitIds.has(habitId)) {
        return;
      }

      setCompletingHabitIds((current) => new Set(current).add(habitId));

      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 170));
      }

      window.setTimeout(() => {
        setCompletingHabitIds((current) => {
          const next = new Set(current);
          next.delete(habitId);
          return next;
        });
      }, 520);
    }

    await onToggleHabitLog(habitId);
    onShowUndo?.(translateInline(language, "plannerHabitsSurface.habitCheckChanged"), () => onToggleHabitLog(habitId));
  };

  const handleUpdateHabitWithUndo = async (habit: Habit, patch: PlannerHabitUpdateInput, label: string) => {
    const undoPatch: PlannerHabitUpdateInput = {
      title: habit.title,
      description: habit.description,
      status: habit.status,
      projectId: habit.projectId,
      noteId: habit.noteId,
      color: habit.color,
      icon: habit.icon,
      frequencyRule: habit.frequencyRule,
      frequencyTimezone: habit.frequencyTimezone,
      targetCount: habit.targetCount,
      targetUnit: habit.targetUnit,
      targetPeriod: habit.targetPeriod,
      reminders: habit.reminders.map((reminder) => ({ ...reminder })),
      sortOrder: habit.sortOrder,
      pausedAt: habit.pausedAt,
      archivedAt: habit.archivedAt,
      pauseRanges: habit.pauseRanges.map((range) => ({ ...range }))
    };

    await onUpdateHabit(habit.id, patch);
    onShowUndo?.(label, () => onUpdateHabit(habit.id, undoPatch));
  };

  const handleDeleteHabitWithUndo = async (habit: Habit) => {
    await onDeleteHabit(habit.id);
    onSelectHabit(null);
    onShowUndo?.(translateInline(language, "plannerHabitsSurface.habitDeleted"), () => onCreateHabit(getHabitRestoreInput(habit)));
  };

  const handleToggleHabitPaused = (summary: PlannerHabitSummary) => {
    void handleUpdateHabitWithUndo(
      summary.habit,
      {
        status: summary.habit.status === "paused" ? "active" : "paused"
      },
      summary.habit.status === "paused"
        ? translateInline(language, "plannerHabitsSurface.habitResumed")
        : translateInline(language, "plannerHabitsSurface.habitPaused")
    );
  };

  const handleArchiveHabit = (summary: PlannerHabitSummary) => {
    void handleUpdateHabitWithUndo(
      summary.habit,
      {
        status: "archived"
      },
      translateInline(language, "plannerHabitsSurface.habitArchived")
    );
  };

  const handleDeleteHabitSummary = (summary: PlannerHabitSummary) => {
    void handleDeleteHabitWithUndo(summary.habit);
  };

  const handleRenameHabit = async (summary: PlannerHabitSummary, title: string) => {
    await handleUpdateHabitWithUndo(
      summary.habit,
      { title },
      translateInline(language, "plannerHabitsSurface.habitRenamed")
    );
  };

  const renderComposer = (variant: "inline" | "sheet") => (
    <form
      className={`planner-habit-composer is-${variant}`}
      onSubmit={(event) => {
        event.preventDefault();
        void handleCreateHabit();
      }}
    >
      <div className="planner-habit-composer-head">
        <div>
          <span>{translateInline(language, "plannerHabitsSurface.newHabit")}</span>
          {variant === "sheet" ? (
            <strong>{translateInline(language, "plannerHabitsSurface.setRhythmAndContext")}</strong>
          ) : null}
        </div>
        <button
          type="button"
          className="planner-icon-button"
          onClick={closeComposer}
          aria-label={translateInline(language, "plannerHabitsSurface.close2")}
        >
          ×
        </button>
      </div>
      <div className="planner-habit-composer-body">
        <label className="planner-habit-title-field">
          <span>{translateInline(language, "plannerHabitsSurface.title")}</span>
          <input
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            placeholder={translateInline(language, "plannerHabitsSurface.forExampleEveningReview")}
            autoFocus
          />
        </label>
        <div className="planner-habit-composer-group is-cadence">
          <span>{translateInline(language, "plannerHabitsSurface.cadence")}</span>
          <div className="planner-habit-chip-row">
            {CADENCE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={cadenceDraft === preset ? "is-active" : ""}
                onClick={() => setCadenceDraft(preset)}
              >
                {getCadencePresetLabel(preset, intervalDraft, language)}
              </button>
            ))}
          </div>
          {cadenceDraft === "customDaily" ? (
            <div className="planner-habit-stepper" aria-label={translateInline(language, "plannerHabitsSurface.dayInterval")}>
              <button type="button" onClick={() => setIntervalDraft((value) => Math.max(2, value - 1))}>-</button>
              <strong>{intervalDraft}</strong>
              <button type="button" onClick={() => setIntervalDraft((value) => Math.min(365, value + 1))}>+</button>
            </div>
          ) : null}
        </div>
        <div className="planner-habit-composer-group is-project">
          <span>{translateInline(language, "plannerHabitsSurface.project")}</span>
          <div className="planner-habit-chip-row is-projects">
            <button
              type="button"
              className={projectDraft === "" ? "is-active" : ""}
              onClick={() => setProjectDraft("")}
              style={{ "--planner-habit-chip-color": "var(--planner-accent-2)" } as CSSProperties}
            >
              <span className="planner-habit-project-dot" aria-hidden="true" />
              <span className="planner-habit-project-name">{translateInline(language, "plannerHabitsSurface.noProject")}</span>
            </button>
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                className={projectDraft === project.id ? "is-active" : ""}
                onClick={() => setProjectDraft(project.id)}
                style={{ "--planner-habit-chip-color": project.color } as CSSProperties}
              >
                <span className="planner-habit-project-dot" aria-hidden="true" />
                <span className="planner-habit-project-name">{project.name}</span>
              </button>
            ))}
          </div>
        </div>
        <button type="submit" className="planner-habit-submit" disabled={!titleDraft.trim() || isCreating}>
          {translateInline(language, "plannerHabitsSurface.create")}
        </button>
      </div>
    </form>
  );

  const renderMobileOverlay = (content: ReactNode) =>
    typeof document === "undefined" ? content : createPortal(content, document.body);

  return (
    <section
      className={`planner-habits-surface ${isMobile ? "is-mobile" : "is-desktop"} ${
        selectedSummary ? "has-selection" : "has-no-selection"
      } ${hideDesktopInspector ? "is-main-only" : ""}`}
      onPointerDown={handleBlankPointerDown}
    >
      <div className="planner-habits-board">
        {isComposerOpen && !isMobile ? renderComposer("inline") : null}

        <div className="planner-habits-stats">
          <div>
            <span>{translateInline(language, "plannerHabitsSurface.today2")}</span>
            <strong>
              {doneTodayCount}/{dueTodayCount}
            </strong>
          </div>
          <div>
            <span>{translateInline(language, "plannerHabitsSurface.active")}</span>
            <strong>{activeCount}</strong>
          </div>
          <div>
            <span>{translateInline(language, "plannerHabitsSurface.missed4")}</span>
            <strong>{missedCount}</strong>
          </div>
        </div>

        <div className="planner-habits-toolbar">
          <nav aria-label={translateInline(language, "plannerHabitsSurface.habitFilters")}>
            {HABIT_FILTERS.map((nextFilterId) => (
              <button
                key={nextFilterId}
                type="button"
                className={filterId === nextFilterId ? "is-active" : ""}
                onClick={() => handleFilterChange(nextFilterId)}
              >
                {getHabitFilterLabel(nextFilterId, language)}
              </button>
            ))}
          </nav>
        </div>

        <HabitLegend language={language} />

        <div ref={habitListRef} className="planner-habit-list">
          {visibleSummaries.length > 0 ? (
            visibleSummaries.map((summary) => (
              <HabitCard
                key={summary.habit.id}
                summary={summary}
                language={language}
                selected={selectedSummary?.habit.id === summary.habit.id}
                feedbackDone={completingHabitIds.has(summary.habit.id)}
                onSelect={() => {
                  onSelectHabit(summary.habit.id);
                  if (isComposerOpen) {
                    closeComposer();
                  }
                }}
                onToggleToday={() => void handleToggleHabitToday(summary.habit.id)}
              />
            ))
          ) : (
            <div className="planner-habit-empty">
              <strong>{translateInline(language, "plannerHabitsSurface.quietHere")}</strong>
              <span>{translateInline(language, "plannerHabitsSurface.createAHabitOrChangeTheFilter")}</span>
            </div>
          )}
        </div>
      </div>

      {!isMobile && !hideDesktopInspector ? (
        <PlannerHabitInspectorPanel
          summary={selectedSummary}
          language={language}
          onToggleToday={(habitId) => void handleToggleHabitToday(habitId)}
          onRename={handleRenameHabit}
          onTogglePaused={handleToggleHabitPaused}
          onArchive={handleArchiveHabit}
          onDelete={handleDeleteHabitSummary}
        />
      ) : null}

      {isMobile && isComposerOpen ? renderMobileOverlay(
        <div
          className="planner-habit-mobile-sheet-layer is-centered-composer"
          role="dialog"
          aria-modal="true"
          style={{ "--planner-keyboard-inset": `${keyboardInset}px` } as CSSProperties}
        >
          <button type="button" className="planner-habit-mobile-sheet-backdrop" onClick={closeComposer} aria-label={translateInline(language, "plannerHabitsSurface.close3")} />
          <section className="planner-habit-mobile-sheet is-composer">
            <div className="planner-habit-mobile-sheet-handle" aria-hidden="true" />
            {renderComposer("sheet")}
          </section>
        </div>
      ) : null}

    </section>
  );
}
