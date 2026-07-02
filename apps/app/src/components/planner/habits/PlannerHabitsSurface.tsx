import { useEffect, useMemo, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { AppLanguage, Habit, HabitLog, Project } from "../../../types";
import {
  buildPlannerHabitFrequencyRule,
  buildPlannerHabitSummaries,
  getPlannerHabitCadenceLabel,
  type PlannerHabitCadencePreset,
  type PlannerHabitSummary
} from "../../../lib/plannerHabits";
import type { PlannerHabitCreateInput, PlannerHabitUpdateInput } from "../../../lib/planner";
import { useVisualKeyboardInset } from "../../../lib/useVisualKeyboardInset";
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
  if (language === "ru") {
    return {
      today: "Сегодня",
      all: "Все"
    }[filterId];
  }

  return {
    today: "Today",
    all: "All"
  }[filterId];
}

function getCadencePresetLabel(preset: PlannerHabitCadencePreset, _intervalDays: number, language: AppLanguage) {
  if (language === "ru") {
    return {
      daily: "Каждый день",
      weekdays: "Будни",
      weekly: "Раз в неделю",
      customDaily: "Каждые n дней"
    }[preset];
  }

  return {
    daily: "Daily",
    weekdays: "Weekdays",
    weekly: "Weekly",
    customDaily: "Every n days"
  }[preset];
}

function getLastLogLabel(value: number | null, language: AppLanguage) {
  if (!value) {
    return language === "ru" ? "Еще нет отметок" : "No check-ins yet";
  }

  return new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "short"
  }).format(value);
}

function getShortDateLabel(value: number, language: AppLanguage) {
  return new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "short"
  }).format(value);
}

function formatHabitRate(value: number | null, language: AppLanguage) {
  if (value === null) {
    return language === "ru" ? "нет данных" : "no data";
  }

  return `${Math.round(value * 100)}%`;
}

function getHabitHealthLabel(summary: PlannerHabitSummary, language: AppLanguage) {
  if (language === "ru") {
    return {
      new: "Новая",
      steady: "Стабильно",
      watch: "Внимание",
      risk: "Риск",
      paused: "Пауза"
    }[summary.health];
  }

  return {
    new: "New",
    steady: "Steady",
    watch: "Watch",
    risk: "At risk",
    paused: "Paused"
  }[summary.health];
}

function getHabitHealthDescription(summary: PlannerHabitSummary, language: AppLanguage) {
  if (summary.health === "paused") {
    return language === "ru" ? "Пауза не ломает streak и не считается пропуском." : "Paused days keep the streak intact.";
  }

  if (summary.health === "new") {
    return language === "ru" ? "Данных пока мало. После нескольких отметок появится точнее." : "Not enough history yet.";
  }

  if (summary.health === "steady") {
    return language === "ru" ? "Ритм держится хорошо за последние 30 дней." : "The last 30 days look stable.";
  }

  if (summary.health === "risk") {
    return language === "ru" ? "За последние 30 дней накопились пропуски." : "Misses are piling up over the last 30 days.";
  }

  return summary.dueToday && !summary.completedToday
    ? language === "ru"
      ? "Сегодня привычка еще ждет отметки."
      : "Today's check-in is still open."
    : language === "ru"
      ? "Ритм живой, но ему стоит уделить внимание."
      : "The rhythm is active, but worth watching.";
}

function getWeekdayLabel(value: number, language: AppLanguage) {
  return new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", {
    weekday: "short"
  }).format(value);
}

function getTodayState(summary: PlannerHabitSummary, language: AppLanguage) {
  if (summary.habit.status === "paused") {
    return language === "ru" ? "На паузе" : "Paused";
  }

  if (summary.completedToday) {
    return language === "ru" ? "Сегодня отмечено" : "Checked in today";
  }

  if (summary.dueToday) {
    return language === "ru" ? "Ожидает сегодня" : "Due today";
  }

  return language === "ru" ? "Сегодня не по плану" : "Not scheduled today";
}

function getHabitActionLabel(summary: PlannerHabitSummary, language: AppLanguage) {
  if (summary.habit.status === "paused") {
    return language === "ru" ? "На паузе" : "Paused";
  }

  if (summary.completedToday) {
    return language === "ru" ? "Убрать отметку" : "Undo check-in";
  }

  if (!summary.dueToday) {
    return language === "ru" ? "Не по плану" : "Not scheduled";
  }

  return language === "ru" ? "Отметить сегодня" : "Check in today";
}

function HabitWeekStrip({ summary, language }: { summary: PlannerHabitSummary; language: AppLanguage }) {
  return (
    <div className="planner-habit-week-strip" aria-label={language === "ru" ? "Неделя привычки" : "Habit week"}>
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
          <span>{language === "ru" ? "История" : "History"}</span>
          <strong>{language === "ru" ? "Последние 8 недель" : "Last 8 weeks"}</strong>
        </div>
        <em>
          {summary.last30CompletedCount}/{summary.last30DueCount} · {formatHabitRate(summary.last30CompletionRate, language)}
        </em>
      </div>
      <div className="planner-habit-history-heatmap" aria-label={language === "ru" ? "История отметок" : "Check-in history"}>
        {summary.historyDays.map((day) => (
          <span
            key={day.dayAt}
            className={`${day.due ? "is-due" : ""} ${day.completed ? "is-complete" : ""} ${
              day.missed ? "is-missed" : ""
            } ${day.paused ? "is-paused" : ""} ${day.today ? "is-today" : ""}`}
            title={`${getShortDateLabel(day.dayAt, language)}${
              day.completed
                ? language === "ru"
                  ? " · сделано"
                  : " · done"
                : day.missed
                  ? language === "ru"
                    ? " · пропущено"
                    : " · missed"
                  : day.due
                    ? language === "ru"
                      ? " · по плану"
                      : " · scheduled"
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
          <span>{language === "ru" ? "Последние отметки" : "Recent"}</span>
          <strong>{language === "ru" ? "Живая история" : "Recent check-ins"}</strong>
        </div>
      </div>
      {summary.recentLogDays.length > 0 ? (
        <div className="planner-habit-recent-row">
          {summary.recentLogDays.map((dayAt) => (
            <span key={dayAt}>{getShortDateLabel(dayAt, language)}</span>
          ))}
        </div>
      ) : (
        <p>{language === "ru" ? "Отметок пока нет." : "No check-ins yet."}</p>
      )}
    </section>
  );
}

function HabitLegend({ language }: { language: AppLanguage }) {
  const items = language === "ru"
    ? [
        ["is-complete", "Сделано"],
        ["is-missed", "Пропущено"],
        ["is-today", "Сегодня"],
        ["is-paused", "Пауза"]
      ]
    : [
        ["is-complete", "Done"],
        ["is-missed", "Missed"],
        ["is-today", "Today"],
        ["is-paused", "Paused"]
      ];

  return (
    <div className="planner-habit-legend" aria-label={language === "ru" ? "Легенда привычек" : "Habit legend"}>
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
                aria-label={language === "ru" ? "Название привычки" : "Habit title"}
                placeholder={language === "ru" ? "Название привычки" : "Habit title"}
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
              aria-label={language === "ru" ? "Закрыть" : "Close"}
            />
          ) : null}
        </div>

        <div className={`planner-habit-today-card ${summary.completedToday ? "is-complete" : ""}`}>
          <div>
            <span>{language === "ru" ? "Сегодня" : "Today"}</span>
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
            <span>{language === "ru" ? "Streak" : "Streak"}</span>
            <strong>{summary.streak}</strong>
          </div>
          <div>
            <span>{language === "ru" ? "Лучший" : "Best"}</span>
            <strong>{summary.bestStreak}</strong>
          </div>
          <div>
            <span>{language === "ru" ? "Неделя" : "Week"}</span>
            <strong>
              {summary.weekCompletedCount}/{summary.weekDueCount}
            </strong>
          </div>
          <div>
            <span>{language === "ru" ? "30 дней" : "30 days"}</span>
            <strong>{formatHabitRate(summary.last30CompletionRate, language)}</strong>
          </div>
          <div>
            <span>{language === "ru" ? "Пропуски" : "Missed"}</span>
            <strong>{summary.last30MissedCount}</strong>
          </div>
          <div>
            <span>{language === "ru" ? "Последняя" : "Last"}</span>
            <strong>{getLastLogLabel(summary.lastLogAt, language)}</strong>
          </div>
        </div>

        <div className={`planner-habit-health-card is-${summary.health}`}>
          <div>
            <span>{language === "ru" ? "Состояние" : "State"}</span>
            <strong>{getHabitHealthLabel(summary, language)}</strong>
          </div>
          <p>{getHabitHealthDescription(summary, language)}</p>
        </div>

        <HabitHistoryHeatmap summary={summary} language={language} />
        <HabitRecentLogs summary={summary} language={language} />

        <div className="planner-habit-detail-week">
          <div>
            <span>{language === "ru" ? "Неделя" : "Week"}</span>
            <strong>{language === "ru" ? "План и отметки" : "Schedule and check-ins"}</strong>
          </div>
          <HabitWeekStrip summary={summary} language={language} />
        </div>

        <div className="planner-habit-detail-actions">
          <button type="button" className="is-secondary" onClick={() => onTogglePaused(summary)}>
            <span className="planner-habit-action-icon is-pause" />
            {summary.habit.status === "paused"
              ? language === "ru"
                ? "Возобновить"
                : "Resume"
              : language === "ru"
                ? "Пауза"
                : "Pause"}
          </button>
          <button type="button" className="is-secondary" onClick={() => onArchive(summary)}>
            <span className="planner-habit-action-icon is-archive" />
            {language === "ru" ? "В архив" : "Archive"}
          </button>
          <button type="button" className="is-danger" onClick={() => onDelete(summary)}>
            <span className="planner-habit-action-icon is-delete" />
            {language === "ru" ? "Удалить" : "Delete"}
          </button>
        </div>
        <div className="planner-habit-detail-note">
          {summary.habit.status === "paused"
            ? language === "ru"
              ? "Пауза не ломает streak: дни паузы пропускаются в расчете."
              : "Pause keeps the streak intact: paused days are skipped."
            : language === "ru"
              ? "Отметка хранится как событие конкретного дня. Завтра привычка снова появится в расписании, а сегодняшняя отметка останется в истории."
              : "Each check-in is stored for a specific day. Tomorrow the habit appears again, while today's log stays in history."}
        </div>
      </div>
    </>
  ) : (
    <div className="planner-habit-empty is-detail">
      <strong>{language === "ru" ? "Выбери привычку" : "Select a habit"}</strong>
      <span>{language === "ru" ? "Здесь появятся ритм, streak, неделя и действия." : "Cadence, streak, week, and actions will appear here."}</span>
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
  onSelect,
  onToggleToday
}: {
  summary: PlannerHabitSummary;
  language: AppLanguage;
  selected: boolean;
  onSelect: () => void;
  onToggleToday: () => void;
}) {
  const { habit } = summary;
  const checkDisabled = habit.status === "paused" || habit.status === "archived" || !summary.dueToday;

  return (
    <article
      className={`planner-habit-card ${selected ? "is-selected" : ""} ${
        summary.completedToday ? "is-complete" : ""
      } ${habit.status === "paused" ? "is-paused" : ""} ${summary.missed ? "is-missed" : ""}`}
      style={{ "--planner-habit-color": habit.color } as CSSProperties}
      onClick={onSelect}
    >
      <button
        type="button"
        className="planner-habit-check"
        aria-pressed={summary.completedToday}
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
            {language === "ru" ? "30 дней" : "30 days"} {formatHabitRate(summary.last30CompletionRate, language)}
          </span>
          {summary.last30MissedCount > 0 ? (
            <span className="is-warning">{language === "ru" ? `${summary.last30MissedCount} проп.` : `${summary.last30MissedCount} missed`}</span>
          ) : summary.streak > 0 ? (
            <span>{language === "ru" ? `${summary.streak} дн.` : `${summary.streak}d streak`}</span>
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

    await onToggleHabitLog(habitId);
    onShowUndo?.(language === "ru" ? "Отметка привычки изменена" : "Habit check changed", () => onToggleHabitLog(habitId));
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
    onShowUndo?.(language === "ru" ? "Привычка удалена" : "Habit deleted", () => onCreateHabit(getHabitRestoreInput(habit)));
  };

  const handleToggleHabitPaused = (summary: PlannerHabitSummary) => {
    void handleUpdateHabitWithUndo(
      summary.habit,
      {
        status: summary.habit.status === "paused" ? "active" : "paused"
      },
      summary.habit.status === "paused"
        ? language === "ru"
          ? "Привычка возобновлена"
          : "Habit resumed"
        : language === "ru"
          ? "Привычка поставлена на паузу"
          : "Habit paused"
    );
  };

  const handleArchiveHabit = (summary: PlannerHabitSummary) => {
    void handleUpdateHabitWithUndo(
      summary.habit,
      {
        status: "archived"
      },
      language === "ru" ? "Привычка отправлена в архив" : "Habit archived"
    );
  };

  const handleDeleteHabitSummary = (summary: PlannerHabitSummary) => {
    void handleDeleteHabitWithUndo(summary.habit);
  };

  const handleRenameHabit = async (summary: PlannerHabitSummary, title: string) => {
    await handleUpdateHabitWithUndo(
      summary.habit,
      { title },
      language === "ru" ? "Привычка переименована" : "Habit renamed"
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
          <span>{language === "ru" ? "Новая привычка" : "New habit"}</span>
          {variant === "sheet" ? (
            <strong>{language === "ru" ? "Настрой ритм и привязку" : "Set rhythm and context"}</strong>
          ) : null}
        </div>
        <button
          type="button"
          className="planner-icon-button"
          onClick={closeComposer}
          aria-label={language === "ru" ? "Закрыть" : "Close"}
        >
          ×
        </button>
      </div>
      <div className="planner-habit-composer-body">
        <label className="planner-habit-title-field">
          <span>{language === "ru" ? "Название" : "Title"}</span>
          <input
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            placeholder={language === "ru" ? "Например: вечерний обзор" : "For example: evening review"}
            autoFocus
          />
        </label>
        <div className="planner-habit-composer-group is-cadence">
          <span>{language === "ru" ? "Ритм" : "Cadence"}</span>
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
            <div className="planner-habit-stepper" aria-label={language === "ru" ? "Интервал дней" : "Day interval"}>
              <button type="button" onClick={() => setIntervalDraft((value) => Math.max(2, value - 1))}>-</button>
              <strong>{intervalDraft}</strong>
              <button type="button" onClick={() => setIntervalDraft((value) => Math.min(365, value + 1))}>+</button>
            </div>
          ) : null}
        </div>
        <div className="planner-habit-composer-group is-project">
          <span>{language === "ru" ? "Проект" : "Project"}</span>
          <div className="planner-habit-chip-row is-projects">
            <button
              type="button"
              className={projectDraft === "" ? "is-active" : ""}
              onClick={() => setProjectDraft("")}
              style={{ "--planner-habit-chip-color": "var(--planner-accent-2)" } as CSSProperties}
            >
              <span className="planner-habit-project-dot" aria-hidden="true" />
              <span className="planner-habit-project-name">{language === "ru" ? "Без проекта" : "No project"}</span>
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
          {language === "ru" ? "Создать" : "Create"}
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
            <span>{language === "ru" ? "Сегодня" : "Today"}</span>
            <strong>
              {doneTodayCount}/{dueTodayCount}
            </strong>
          </div>
          <div>
            <span>{language === "ru" ? "Активные" : "Active"}</span>
            <strong>{activeCount}</strong>
          </div>
          <div>
            <span>{language === "ru" ? "Пропуски" : "Missed"}</span>
            <strong>{missedCount}</strong>
          </div>
        </div>

        <div className="planner-habits-toolbar">
          <nav aria-label={language === "ru" ? "Фильтры привычек" : "Habit filters"}>
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

        <div className="planner-habit-list">
          {visibleSummaries.length > 0 ? (
            visibleSummaries.map((summary) => (
              <HabitCard
                key={summary.habit.id}
                summary={summary}
                language={language}
                selected={selectedSummary?.habit.id === summary.habit.id}
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
              <strong>{language === "ru" ? "Здесь пока тихо" : "Quiet here"}</strong>
              <span>{language === "ru" ? "Создай привычку или смени фильтр." : "Create a habit or change the filter."}</span>
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
          <button type="button" className="planner-habit-mobile-sheet-backdrop" onClick={closeComposer} aria-label={language === "ru" ? "Закрыть" : "Close"} />
          <section className="planner-habit-mobile-sheet is-composer">
            <div className="planner-habit-mobile-sheet-handle" aria-hidden="true" />
            {renderComposer("sheet")}
          </section>
        </div>
      ) : null}

    </section>
  );
}
