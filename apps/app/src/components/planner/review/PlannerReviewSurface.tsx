import { translateApp, translateInline } from "../../../localization/translateInline";
import {
  createDateTimeFormatter,
  formatPlannerDate,
  getCurrentLocaleRuntime,
  getPlannerPriorityLabel
} from "../../../localization";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { AppLanguage, Habit, HabitLog, Project, Task, TimeBlock } from "../../../types";
import { buildPlannerReview, type PlannerReviewMode, type PlannerReviewProjectSignal } from "../../../lib/plannerReview";
import type { PlannerHabitSummary } from "../../../lib/plannerHabits";
import "./PlannerReviewSurface.css";

interface PlannerReviewSurfaceProps {
  tasks: Task[];
  habits: Habit[];
  habitLogs: HabitLog[];
  projects: Project[];
  timeBlocks: TimeBlock[];
  language: AppLanguage;
  isMobile: boolean;
  onToggleTaskDone: (taskId: string, done: boolean) => Promise<void> | void;
  onToggleHabitLog: (habitId: string, dayAt?: number) => Promise<HabitLog | null>;
}

type ReviewSurfaceMode = "review" | "analytics";
type ReviewAnalyticsMode = "tasks" | "habits";
type ReviewDecisionFilter = "all" | "overdue" | "inbox" | "moved" | "projects" | "habits";
type ReviewTone = "neutral" | "success" | "danger" | "attention" | "habit" | "project";

interface ReviewDecisionItem {
  id: string;
  filter: Exclude<ReviewDecisionFilter, "all">;
  tone: ReviewTone;
  title: string;
  kicker: string;
  description: string;
  meta: string;
  task?: Task;
  habit?: PlannerHabitSummary;
  projectSignal?: PlannerReviewProjectSignal;
}

const DECISION_FILTERS: ReviewDecisionFilter[] = ["all", "overdue", "inbox", "moved", "projects", "habits"];

function getRangeLabel(startAt: number, endAt: number, language: AppLanguage) {
  const formatter = createDateTimeFormatter(getCurrentLocaleRuntime(), {
    day: "numeric",
    month: "short"
  });

  if (formatPlannerDate(startAt, language) === formatPlannerDate(endAt, language)) {
    return formatter.format(startAt);
  }

  return `${formatter.format(startAt)} - ${formatter.format(endAt)}`;
}

function formatHabitRate(value: number | null, language: AppLanguage) {
  if (value === null) {
    return translateInline(language, "plannerReviewSurface.noData");
  }

  return `${Math.round(value * 100)}%`;
}

function getProjectLabel(project: Project | null, language: AppLanguage) {
  return project?.name ?? (translateInline(language, "plannerReviewSurface.inbox"));
}

function getTaskProject(task: Task, projectMap: Map<string, Project>) {
  return task.projectId ? projectMap.get(task.projectId) ?? null : null;
}

function getTaskMeta(task: Task, projectMap: Map<string, Project>, language: AppLanguage) {
  const project = getTaskProject(task, projectMap);
  const parts = [
    getProjectLabel(project, language),
    task.dueAt || task.scheduledStartAt ? formatPlannerDate(task.dueAt ?? task.scheduledStartAt, language) : translateInline(language, "plannerReviewSurface.noDate")
  ];

  if (task.priority !== "none") {
    parts.push(getPlannerPriorityLabel(task.priority, language));
  }

  if (task.recurrenceRule) {
    parts.push(translateInline(language, "plannerReviewSurface.repeat"));
  }

  return parts.join(" · ");
}

function getDecisionFilterLabel(filter: ReviewDecisionFilter, language: AppLanguage) {
  return translateApp(language, `plannerCore.reviewFilters.${filter}`);
}

function getHabitHealthLabel(summary: PlannerHabitSummary, language: AppLanguage) {
  return translateApp(language, `plannerCore.habitHealth.${summary.health}`);
}

function getDecisionBadge(item: ReviewDecisionItem, language: AppLanguage) {
  const marks: Record<ReviewDecisionFilter, string> = {
    all: "•", overdue: "!", inbox: "+", moved: "↷", projects: "•", habits: "✓"
  };
  return {
    mark: marks[item.filter],
    label: translateApp(language, `plannerCore.decisionBadges.${item.filter}`)
  };
}

function ReviewDecisionBadge({ item, language }: { item: ReviewDecisionItem; language: AppLanguage }) {
  const badge = getDecisionBadge(item, language);

  return (
    <div className="planner-review-decision-badge" aria-hidden="true">
      <strong>{badge.mark}</strong>
      <span>{badge.label}</span>
    </div>
  );
}

function ReviewSegmentedButton({
  active,
  children,
  onClick
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className={active ? "is-active" : ""} onClick={onClick}>
      {children}
    </button>
  );
}

function ReviewSnapshot({
  items,
  language
}: {
  items: Array<{ id: string; label: string; value: string | number; detail: string; tone: ReviewTone }>;
  language: AppLanguage;
}) {
  return (
    <section className="planner-review-snapshot" aria-label={translateInline(language, "plannerReviewSurface.reviewSnapshot")}>
      {items.map((item) => (
        <article key={item.id} className={`planner-review-snapshot-card is-${item.tone}`}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          <em>{item.detail}</em>
        </article>
      ))}
    </section>
  );
}

function ReviewTaskCheck({
  task,
  language,
  onToggleTaskDone
}: {
  task: Task;
  language: AppLanguage;
  onToggleTaskDone: (taskId: string, done: boolean) => Promise<void> | void;
}) {
  return (
    <button
      type="button"
      className="planner-review-row-check"
      aria-label={translateInline(language, "plannerReviewSurface.markDone")}
      onClick={() => void onToggleTaskDone(task.id, true)}
    >
      <span />
    </button>
  );
}

function ReviewDecisionRow({
  item,
  language,
  onToggleTaskDone,
  onToggleHabitLog
}: {
  item: ReviewDecisionItem;
  language: AppLanguage;
  onToggleTaskDone: (taskId: string, done: boolean) => Promise<void> | void;
  onToggleHabitLog: (habitId: string, dayAt?: number) => Promise<HabitLog | null>;
}) {
  return (
    <article className={`planner-review-decision-row is-${item.tone}`}>
      <ReviewDecisionBadge item={item} language={language} />
      <div className="planner-review-decision-main">
        <div className="planner-review-decision-title">
          <span>{item.kicker}</span>
          <strong>{item.title}</strong>
        </div>
        <p>{item.description}</p>
        <em>{item.meta}</em>
      </div>
      {item.task ? <ReviewTaskCheck task={item.task} language={language} onToggleTaskDone={onToggleTaskDone} /> : null}
      {item.habit?.dueToday ? (
        <button
          type="button"
          className="planner-review-row-action"
          onClick={() => void onToggleHabitLog(item.habit?.habit.id ?? "")}
        >
          {item.habit.completedToday ? (translateInline(language, "plannerReviewSurface.undo")) : translateInline(language, "plannerReviewSurface.check")}
        </button>
      ) : null}
    </article>
  );
}

function ReviewProgressBar({
  label,
  value,
  max,
  meta,
  tone = "neutral"
}: {
  label: string;
  value: number;
  max: number;
  meta: string;
  tone?: ReviewTone;
}) {
  const width = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;

  return (
    <article className={`planner-review-bar-row is-${tone}`} style={{ "--planner-review-bar": `${width}%` } as CSSProperties}>
      <div>
        <strong>{label}</strong>
        <span>{meta}</span>
      </div>
      <em>{value}</em>
      <i aria-hidden="true" />
    </article>
  );
}

function ReviewMiniHabitHeatmap({ summary }: { summary: PlannerHabitSummary }) {
  return (
    <div className="planner-review-mini-heatmap" aria-hidden="true">
      {summary.historyDays.slice(-28).map((day) => (
        <span
          key={day.dayAt}
          className={`${day.due ? "is-due" : ""} ${day.completed ? "is-complete" : ""} ${day.missed ? "is-missed" : ""} ${
            day.paused ? "is-paused" : ""
          } ${day.today ? "is-today" : ""}`}
        />
      ))}
    </div>
  );
}

function ReviewHabitRow({ summary, language }: { summary: PlannerHabitSummary; language: AppLanguage }) {
  return (
    <article className={`planner-review-habit-row is-${summary.health}`} style={{ "--planner-review-habit-color": summary.habit.color } as CSSProperties}>
      <span aria-hidden="true" />
      <div>
        <strong>{summary.habit.title}</strong>
        <em>
          {getHabitHealthLabel(summary, language)} · {formatHabitRate(summary.last30CompletionRate, language)}
          {summary.last30MissedCount > 0 ? ` · ${translateInline(language, "plannerReviewSurface.missed", { value0: summary.last30MissedCount })}` : ""}
        </em>
      </div>
      <ReviewMiniHabitHeatmap summary={summary} />
    </article>
  );
}

function ReviewLogbookRow({
  task,
  language,
  projectMap,
  onToggleTaskDone
}: {
  task: Task;
  language: AppLanguage;
  projectMap: Map<string, Project>;
  onToggleTaskDone: (taskId: string, done: boolean) => Promise<void> | void;
}) {
  return (
    <article className="planner-review-logbook-row">
      <button
        type="button"
        aria-label={translateInline(language, "plannerReviewSurface.returnTaskToActive")}
        onClick={() => void onToggleTaskDone(task.id, false)}
      >
        <span />
      </button>
      <div>
        <strong>{task.title}</strong>
        <em>{getTaskMeta(task, projectMap, language)}</em>
      </div>
    </article>
  );
}

export default function PlannerReviewSurface({
  tasks,
  habits,
  habitLogs,
  projects,
  timeBlocks,
  language,
  isMobile,
  onToggleTaskDone,
  onToggleHabitLog
}: PlannerReviewSurfaceProps) {
  const [mode, setMode] = useState<PlannerReviewMode>("day");
  const [surfaceMode, setSurfaceMode] = useState<ReviewSurfaceMode>("review");
  const [analyticsMode, setAnalyticsMode] = useState<ReviewAnalyticsMode>("tasks");
  const [decisionFilter, setDecisionFilter] = useState<ReviewDecisionFilter>("all");
  const [expanded, setExpanded] = useState(false);
  const review = useMemo(
    () =>
      buildPlannerReview({
        tasks,
        habits,
        habitLogs,
        projects,
        timeBlocks,
        mode
      }),
    [habitLogs, habits, mode, projects, tasks, timeBlocks]
  );
  const projectMap = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const rangeLabel = getRangeLabel(review.rangeStartAt, review.rangeEndAt, language);
  const isFullscreenAvailable = typeof document !== "undefined";
  const snapshotItems = [
    {
      id: "completed",
      label: translateInline(language, "plannerReviewSurface.done"),
      value: review.stats.completed,
      detail: translateInline(language, "plannerReviewSurface.inRange"),
      tone: "success" as const
    },
    {
      id: "overdue",
      label: translateInline(language, "plannerReviewSurface.overdue"),
      value: review.stats.overdue,
      detail: translateInline(language, "plannerReviewSurface.needsDecision"),
      tone: review.stats.overdue > 0 ? ("danger" as const) : ("neutral" as const)
    },
    {
      id: "inbox",
      label: "Inbox",
      value: review.stats.inbox,
      detail: translateInline(language, "plannerReviewSurface.needsContext"),
      tone: review.stats.inbox > 0 ? ("attention" as const) : ("neutral" as const)
    },
    {
      id: "moved",
      label: translateInline(language, "plannerReviewSurface.moved"),
      value: review.stats.moved,
      detail: translateInline(language, "plannerReviewSurface.inRange2"),
      tone: review.stats.moved > 0 ? ("attention" as const) : ("neutral" as const)
    },
    {
      id: "habits",
      label: translateInline(language, "plannerReviewSurface.rhythm"),
      value: formatHabitRate(review.stats.habitCompletionRate30, language),
      detail: translateInline(language, "plannerReviewSurface.30Days"),
      tone: review.stats.habitsAtRisk > 0 ? ("habit" as const) : ("success" as const)
    },
    {
      id: "projects",
      label: translateInline(language, "plannerReviewSurface.projects"),
      value: review.stats.staleProjects,
      detail: translateInline(language, "plannerReviewSurface.quiet"),
      tone: review.stats.staleProjects > 0 ? ("project" as const) : ("neutral" as const)
    }
  ];
  const decisionItems = useMemo(() => {
    const items: ReviewDecisionItem[] = [];
    const usedTaskIds = new Set<string>();
    const pushTask = (task: Task, filter: ReviewDecisionItem["filter"], tone: ReviewTone, kicker: string, description: string) => {
      if (usedTaskIds.has(task.id)) {
        return;
      }

      usedTaskIds.add(task.id);
      items.push({
        id: `${filter}-${task.id}`,
        filter,
        tone,
        title: task.title,
        kicker,
        description: task.description || description,
        meta: getTaskMeta(task, projectMap, language),
        task
      });
    };

    for (const task of review.overdueTasks) {
      pushTask(
        task,
        "overdue",
        "danger",
        translateInline(language, "plannerReviewSurface.overdue2"),
        translateInline(language, "plannerReviewSurface.completeRescheduleOrCancelThisDebt")
      );
    }

    for (const task of review.inboxTasks) {
      pushTask(
        task,
        "inbox",
        "neutral",
        "Inbox",
        translateInline(language, "plannerReviewSurface.needsADateProjectOrAClear")
      );
    }

    for (const task of review.movedTasks) {
      pushTask(
        task,
        "moved",
        "attention",
        translateInline(language, "plannerReviewSurface.moved2"),
        translateInline(language, "plannerReviewSurface.checkWhetherThisMoveWasIntentional")
      );
    }

    for (const signal of review.staleProjects) {
      items.push({
        id: `project-${signal.project.id}`,
        filter: "projects",
        tone: "project",
        title: signal.project.name,
        kicker: translateInline(language, "plannerReviewSurface.quietProject"),
        description:
          translateInline(language, "plannerReviewSurface.thereAreActiveTasksButNoRecent"),
        meta:
          translateInline(language, "plannerReviewSurface.activeTasks", { value0: signal.activeTaskCount }),
        projectSignal: signal
      });
    }

    for (const summary of review.habitInsights.atRisk) {
      items.push({
        id: `habit-${summary.habit.id}`,
        filter: "habits",
        tone: summary.health === "risk" ? "danger" : "habit",
        title: summary.habit.title,
        kicker: translateInline(language, "plannerReviewSurface.rhythmNeedsAttention"),
        description:
          summary.health === "risk"
            ? translateInline(language, "plannerReviewSurface.missesArePilingUpOverTheLast")
            : translateInline(language, "plannerReviewSurface.todaySCheckInIsOpenOr"),
        meta: `${getHabitHealthLabel(summary, language)} · ${formatHabitRate(summary.last30CompletionRate, language)}`,
        habit: summary
      });
    }

    return items;
  }, [language, projectMap, review.habitInsights.atRisk, review.inboxTasks, review.movedTasks, review.overdueTasks, review.staleProjects]);
  const decisionCounts = DECISION_FILTERS.reduce<Record<ReviewDecisionFilter, number>>(
    (acc, filter) => {
      acc[filter] = filter === "all" ? decisionItems.length : decisionItems.filter((item) => item.filter === filter).length;
      return acc;
    },
    {
      all: 0,
      overdue: 0,
      inbox: 0,
      moved: 0,
      projects: 0,
      habits: 0
    }
  );
  const filteredDecisionItems =
    decisionFilter === "all" ? decisionItems : decisionItems.filter((item) => item.filter === decisionFilter);
  const maxPriorityValue = Math.max(1, ...review.taskAnalytics.prioritySignals.map((signal) => signal.activeTaskCount + signal.completedTaskCount));
  const maxProjectValue = Math.max(1, ...review.taskAnalytics.projectSignals.map((signal) => signal.activeTaskCount + signal.completedTaskCount));
  const sortedHabitSummaries = [...review.habitSummaries].sort(
    (left, right) =>
      right.last30MissedCount - left.last30MissedCount ||
      (right.last30CompletionRate ?? 0) - (left.last30CompletionRate ?? 0)
  );

  const renderReviewMode = () => (
    <>
      <ReviewSnapshot items={snapshotItems} language={language} />
      <div className="planner-review-cockpit">
        <main className="planner-review-main-column">
          <section className="planner-review-section is-decision">
            <div className="planner-review-section-head">
              <div>
                <span>{translateInline(language, "plannerReviewSurface.reviewFocus")}</span>
                <h3>{translateInline(language, "plannerReviewSurface.whatNeedsADecision")}</h3>
              </div>
              <strong>{decisionItems.length}</strong>
            </div>
            <nav className="planner-review-filter-row" aria-label={translateInline(language, "plannerReviewSurface.decisionFilters")}>
              {DECISION_FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={decisionFilter === filter ? "is-active" : ""}
                  onClick={() => setDecisionFilter(filter)}
                >
                  {getDecisionFilterLabel(filter, language)}
                  <span>{decisionCounts[filter]}</span>
                </button>
              ))}
            </nav>
            <div className="planner-review-decision-list">
              {filteredDecisionItems.length > 0 ? (
                filteredDecisionItems.map((item) => (
                  <ReviewDecisionRow
                    key={item.id}
                    item={item}
                    language={language}
                    onToggleTaskDone={onToggleTaskDone}
                    onToggleHabitLog={onToggleHabitLog}
                  />
                ))
              ) : (
                <div className="planner-review-calm-state">
                  <strong>{translateInline(language, "plannerReviewSurface.allCalmHere")}</strong>
                  <span>{translateInline(language, "plannerReviewSurface.noDecisionsNeedAttentionInThisFilter")}</span>
                </div>
              )}
            </div>
          </section>

          <section className="planner-review-section is-logbook">
            <div className="planner-review-section-head">
              <div>
                <span>{translateInline(language, "plannerReviewSurface.logbook")}</span>
                <h3>{translateInline(language, "plannerReviewSurface.completedInRange")}</h3>
              </div>
              <strong>{review.completedTasks.length}</strong>
            </div>
            <div className="planner-review-logbook-list">
              {review.completedTasks.length > 0 ? (
                review.completedTasks
                  .slice(0, 10)
                  .map((task) => (
                    <ReviewLogbookRow key={task.id} task={task} language={language} projectMap={projectMap} onToggleTaskDone={onToggleTaskDone} />
                  ))
              ) : (
                <p className="planner-review-empty">
                  {translateInline(language, "plannerReviewSurface.nothingCompletedYetTheRangeIsStill")}
                </p>
              )}
            </div>
          </section>
        </main>

        <aside className="planner-review-side-column">
          <section className="planner-review-section is-rhythm">
            <div className="planner-review-section-head">
              <div>
                <span>{translateInline(language, "plannerReviewSurface.rhythm2")}</span>
                <h3>{translateInline(language, "plannerReviewSurface.habits")}</h3>
              </div>
              <strong>
                {review.stats.habitsDoneToday}/{review.stats.habitsDueToday}
              </strong>
            </div>
            <div className="planner-review-rhythm-hero">
              <span>{formatHabitRate(review.stats.habitCompletionRate30, language)}</span>
              <em>{translateInline(language, "plannerReviewSurface.overTheLast30Days")}</em>
            </div>
            <div className="planner-review-rhythm-list">
              {review.habitInsights.atRisk.slice(0, 3).map((summary) => (
                <ReviewHabitRow key={summary.habit.id} summary={summary} language={language} />
              ))}
              {review.habitInsights.atRisk.length === 0 ? (
                <p className="planner-review-empty">{translateInline(language, "plannerReviewSurface.rhythmIsHoldingNoObviousRisks")}</p>
              ) : null}
            </div>
          </section>

          <section className="planner-review-section is-project-health">
            <div className="planner-review-section-head">
              <div>
                <span>{translateInline(language, "plannerReviewSurface.projects2")}</span>
                <h3>{translateInline(language, "plannerReviewSurface.quietProjects")}</h3>
              </div>
              <strong>{review.staleProjects.length}</strong>
            </div>
            <div className="planner-review-project-stack">
              {review.staleProjects.length > 0 ? (
                review.staleProjects.slice(0, 6).map((signal) => (
                  <article key={signal.project.id} className="planner-review-project-row" style={{ "--planner-review-project-color": signal.project.color } as CSSProperties}>
                    <span />
                    <div>
                      <strong>{signal.project.name}</strong>
                      <em>
                        {translateInline(language, "plannerReviewSurface.activeTasks2", { value0: signal.activeTaskCount })}
                      </em>
                    </div>
                  </article>
                ))
              ) : (
                <p className="planner-review-empty">
                  {translateInline(language, "plannerReviewSurface.allActiveProjectsMovedInThisRange")}
                </p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  );

  const renderTaskAnalytics = () => (
    <div className="planner-review-analytics">
      <ReviewSnapshot
        language={language}
        items={[
          {
            id: "created",
            label: translateInline(language, "plannerReviewSurface.created"),
            value: review.taskAnalytics.created,
            detail: translateInline(language, "plannerReviewSurface.inRange3"),
            tone: "neutral"
          },
          {
            id: "completed",
            label: translateInline(language, "plannerReviewSurface.completed"),
            value: review.stats.completed,
            detail: translateInline(language, "plannerReviewSurface.inRange4"),
            tone: "success"
          },
          {
            id: "no-date",
            label: translateInline(language, "plannerReviewSurface.noDate2"),
            value: review.taskAnalytics.noDate,
            detail: translateInline(language, "plannerReviewSurface.active"),
            tone: "attention"
          },
          {
            id: "linked",
            label: translateInline(language, "plannerReviewSurface.linked"),
            value: review.taskAnalytics.linked,
            detail: translateInline(language, "plannerReviewSurface.toContext"),
            tone: "project"
          }
        ]}
      />
      <div className="planner-review-analytics-grid">
        <section className="planner-review-section">
          <div className="planner-review-section-head">
            <div>
              <span>{translateInline(language, "plannerReviewSurface.flow")}</span>
              <h3>{translateInline(language, "plannerReviewSurface.createdVsCompleted")}</h3>
            </div>
          </div>
          <div className="planner-review-bar-stack">
            <ReviewProgressBar
              label={translateInline(language, "plannerReviewSurface.created2")}
              value={review.taskAnalytics.created}
              max={Math.max(review.taskAnalytics.created, review.stats.completed, 1)}
              meta={translateInline(language, "plannerReviewSurface.newLoad")}
              tone="neutral"
            />
            <ReviewProgressBar
              label={translateInline(language, "plannerReviewSurface.completed2")}
              value={review.stats.completed}
              max={Math.max(review.taskAnalytics.created, review.stats.completed, 1)}
              meta={translateInline(language, "plannerReviewSurface.closedWork")}
              tone="success"
            />
            <ReviewProgressBar
              label={translateInline(language, "plannerReviewSurface.overdue3")}
              value={review.stats.overdue}
              max={Math.max(review.taskAnalytics.active, review.stats.overdue, 1)}
              meta={translateInline(language, "plannerReviewSurface.debt")}
              tone="danger"
            />
          </div>
        </section>

        <section className="planner-review-section">
          <div className="planner-review-section-head">
            <div>
              <span>{translateInline(language, "plannerReviewSurface.priority")}</span>
              <h3>{translateInline(language, "plannerReviewSurface.activeAndDone")}</h3>
            </div>
          </div>
          <div className="planner-review-bar-stack">
            {review.taskAnalytics.prioritySignals.length > 0 ? (
              review.taskAnalytics.prioritySignals.map((signal) => (
                <ReviewProgressBar
                  key={signal.priority}
                  label={getPlannerPriorityLabel(signal.priority, language)}
                  value={signal.activeTaskCount + signal.completedTaskCount}
                  max={maxPriorityValue}
                  meta={
                    translateInline(language, "plannerReviewSurface.activeDone", { value0: signal.activeTaskCount, value1: signal.completedTaskCount })
                  }
                  tone={signal.priority === "urgent" || signal.priority === "high" ? "danger" : "neutral"}
                />
              ))
            ) : (
              <p className="planner-review-empty">{translateInline(language, "plannerReviewSurface.noPriorityDataYet")}</p>
            )}
          </div>
        </section>

        <section className="planner-review-section">
          <div className="planner-review-section-head">
            <div>
              <span>{translateInline(language, "plannerReviewSurface.projects3")}</span>
              <h3>{translateInline(language, "plannerReviewSurface.projectLoad")}</h3>
            </div>
          </div>
          <div className="planner-review-bar-stack">
            {review.taskAnalytics.projectSignals.length > 0 ? (
              review.taskAnalytics.projectSignals.slice(0, 10).map((signal) => (
                <ReviewProgressBar
                  key={signal.project?.id ?? "inbox"}
                  label={getProjectLabel(signal.project, language)}
                  value={signal.activeTaskCount + signal.completedTaskCount}
                  max={maxProjectValue}
                  meta={
                    translateInline(language, "plannerReviewSurface.activeDone2", { value0: signal.activeTaskCount, value1: signal.completedTaskCount })
                  }
                  tone={signal.overdueTaskCount > 0 ? "danger" : signal.project ? "project" : "neutral"}
                />
              ))
            ) : (
              <p className="planner-review-empty">{translateInline(language, "plannerReviewSurface.noProjectLoadYet")}</p>
            )}
          </div>
        </section>

        <section className="planner-review-section">
          <div className="planner-review-section-head">
            <div>
              <span>{translateInline(language, "plannerReviewSurface.logbook2")}</span>
              <h3>{translateInline(language, "plannerReviewSurface.completedByProject")}</h3>
            </div>
          </div>
          <div className="planner-review-project-stack">
            {review.taskAnalytics.completedByProject.length > 0 ? (
              review.taskAnalytics.completedByProject.slice(0, 8).map((group) => (
                <article
                  key={group.project?.id ?? "inbox"}
                  className="planner-review-project-row"
                  style={{ "--planner-review-project-color": group.project?.color ?? "var(--planner-accent)" } as CSSProperties}
                >
                  <span />
                  <div>
                    <strong>{getProjectLabel(group.project, language)}</strong>
                    <em>{translateInline(language, "plannerReviewSurface.completed3", { value0: group.tasks.length })}</em>
                  </div>
                </article>
              ))
            ) : (
              <p className="planner-review-empty">{translateInline(language, "plannerReviewSurface.noCompletedTasksInRange")}</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );

  const renderHabitAnalytics = () => (
    <div className="planner-review-analytics">
      <ReviewSnapshot
        language={language}
        items={[
          {
            id: "rate",
            label: translateInline(language, "plannerReviewSurface.30Days2"),
            value: formatHabitRate(review.stats.habitCompletionRate30, language),
            detail: translateInline(language, "plannerReviewSurface.averageRhythm"),
            tone: review.stats.habitsAtRisk > 0 ? "habit" : "success"
          },
          {
            id: "steady",
            label: translateInline(language, "plannerReviewSurface.steady"),
            value: review.stats.habitsSteady,
            detail: translateInline(language, "plannerReviewSurface.holding"),
            tone: "success"
          },
          {
            id: "risk",
            label: translateInline(language, "plannerReviewSurface.watch"),
            value: review.stats.habitsAtRisk,
            detail: translateInline(language, "plannerReviewSurface.needCare"),
            tone: review.stats.habitsAtRisk > 0 ? "danger" : "neutral"
          },
          {
            id: "today",
            label: translateInline(language, "plannerReviewSurface.today"),
            value: `${review.stats.habitsDoneToday}/${review.stats.habitsDueToday}`,
            detail: translateInline(language, "plannerReviewSurface.checked"),
            tone: "habit"
          }
        ]}
      />
      <div className="planner-review-habit-analytics">
        <section className="planner-review-section">
          <div className="planner-review-section-head">
            <div>
              <span>{translateInline(language, "plannerReviewSurface.risk")}</span>
              <h3>{translateInline(language, "plannerReviewSurface.needsAttention")}</h3>
            </div>
            <strong>{review.habitInsights.atRisk.length}</strong>
          </div>
          <div className="planner-review-habit-stack">
            {review.habitInsights.atRisk.length > 0 ? (
              review.habitInsights.atRisk.map((summary) => <ReviewHabitRow key={summary.habit.id} summary={summary} language={language} />)
            ) : (
              <p className="planner-review-empty">{translateInline(language, "plannerReviewSurface.noObviousRisks")}</p>
            )}
          </div>
        </section>

        <section className="planner-review-section">
          <div className="planner-review-section-head">
            <div>
              <span>{translateInline(language, "plannerReviewSurface.stability")}</span>
              <h3>{translateInline(language, "plannerReviewSurface.holdingSteady")}</h3>
            </div>
            <strong>{review.habitInsights.steady.length}</strong>
          </div>
          <div className="planner-review-habit-stack">
            {review.habitInsights.steady.length > 0 ? (
              review.habitInsights.steady.map((summary) => <ReviewHabitRow key={summary.habit.id} summary={summary} language={language} />)
            ) : (
              <p className="planner-review-empty">{translateInline(language, "plannerReviewSurface.noSteadyHabitsYet")}</p>
            )}
          </div>
        </section>

        <section className="planner-review-section is-wide">
          <div className="planner-review-section-head">
            <div>
              <span>{translateInline(language, "plannerReviewSurface.history")}</span>
              <h3>{translateInline(language, "plannerReviewSurface.allHabits")}</h3>
            </div>
            <strong>{review.habitSummaries.length}</strong>
          </div>
          <div className="planner-review-habit-table">
            {sortedHabitSummaries.length > 0 ? (
              sortedHabitSummaries.map((summary) => <ReviewHabitRow key={summary.habit.id} summary={summary} language={language} />)
            ) : (
              <p className="planner-review-empty">{translateInline(language, "plannerReviewSurface.noHabitsYet")}</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );

  const renderAnalyticsMode = () => (
    <>
      <div className="planner-review-submode-row" aria-label={translateInline(language, "plannerReviewSurface.analyticsSection")}>
        <ReviewSegmentedButton active={analyticsMode === "tasks"} onClick={() => setAnalyticsMode("tasks")}>
          {translateInline(language, "plannerReviewSurface.tasks")}
        </ReviewSegmentedButton>
        <ReviewSegmentedButton active={analyticsMode === "habits"} onClick={() => setAnalyticsMode("habits")}>
          {translateInline(language, "plannerReviewSurface.habits2")}
        </ReviewSegmentedButton>
      </div>
      {analyticsMode === "tasks" ? renderTaskAnalytics() : renderHabitAnalytics()}
    </>
  );

  const renderReviewContent = (fullscreen: boolean) => (
    <div className="planner-review-shell">
      <header className="planner-review-head">
        <div className="planner-review-title-block">
          <span className="planner-kicker">{surfaceMode === "review" ? "Review" : translateInline(language, "plannerReviewSurface.analytics")}</span>
          <h2>
            {surfaceMode === "review"
              ? mode === "day"
                ? translateInline(language, "plannerReviewSurface.dailyReview")
                : translateInline(language, "plannerReviewSurface.weeklyReview")
              : analyticsMode === "tasks"
                ? translateInline(language, "plannerReviewSurface.taskAnalytics")
                : translateInline(language, "plannerReviewSurface.habitAnalytics")}
          </h2>
          <p>{rangeLabel}</p>
        </div>
        <div className="planner-review-actions">
          <div className="planner-review-surface-switch" aria-label={translateInline(language, "plannerReviewSurface.reviewMode")}>
            <ReviewSegmentedButton active={surfaceMode === "review"} onClick={() => setSurfaceMode("review")}>
              {translateInline(language, "plannerReviewSurface.review")}
            </ReviewSegmentedButton>
            <ReviewSegmentedButton active={surfaceMode === "analytics"} onClick={() => setSurfaceMode("analytics")}>
              {translateInline(language, "plannerReviewSurface.analytics2")}
            </ReviewSegmentedButton>
          </div>
          <div className="planner-review-period-switch" aria-label={translateInline(language, "plannerReviewSurface.reviewRange")}>
            <ReviewSegmentedButton active={mode === "day"} onClick={() => setMode("day")}>
              {translateInline(language, "plannerReviewSurface.day")}
            </ReviewSegmentedButton>
            <ReviewSegmentedButton active={mode === "week"} onClick={() => setMode("week")}>
              {translateInline(language, "plannerReviewSurface.week")}
            </ReviewSegmentedButton>
          </div>
          {isFullscreenAvailable ? (
            <button type="button" className="planner-review-expand" onClick={() => setExpanded(!fullscreen)}>
              {fullscreen ? (translateInline(language, "plannerReviewSurface.collapse")) : translateInline(language, "plannerReviewSurface.expand")}
            </button>
          ) : null}
        </div>
      </header>
      <div className="planner-review-body">{surfaceMode === "review" ? renderReviewMode() : renderAnalyticsMode()}</div>
    </div>
  );

  return (
    <>
      <section className={`planner-review-surface ${isMobile ? "is-mobile" : "is-desktop"}`}>
        {renderReviewContent(false)}
      </section>
      {expanded && isFullscreenAvailable
        ? createPortal(
            <section
              className={`planner-review-layer ${isMobile ? "is-mobile" : "is-desktop"}`}
              role="dialog"
              aria-modal="true"
              aria-label={translateInline(language, "plannerReviewSurface.review2")}
            >
              {renderReviewContent(true)}
            </section>,
            document.body
          )
        : null}
    </>
  );
}
