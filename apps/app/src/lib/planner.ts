import {
  createPlannerHabit,
  createPlannerHabitLog,
  createPlannerTimeBlock,
  createPlannerTask,
  removePlannerHabit,
  removePlannerHabitLog,
  removePlannerTimeBlock,
  removePlannerTask,
  setPlannerTaskDone,
  togglePlannerHabitLogForDay,
  updatePlannerHabit,
  updatePlannerTimeBlock,
  updatePlannerTask,
  type PlannerHabitCreateInput,
  type PlannerHabitLogCreateInput,
  type PlannerHabitUpdateInput,
  type PlannerTimeBlockCreateInput,
  type PlannerTimeBlockUpdateInput,
  type PlannerTaskCreateInput,
  type PlannerTaskUpdateInput
} from "../data/db";
import type { PlannerTaskPriority, Project, Tag, Task, TimeBlock } from "../types";
import {
  getPlannerTaskOccurrenceForDay,
  getPlannerTaskOverdueOccurrence,
  getPlannerTaskPrimaryOccurrence,
  getPlannerTaskUpcomingOccurrence,
  isRecurringPlannerRule
} from "./plannerRecurrence";

export {
  createPlannerHabit,
  createPlannerHabitLog,
  createPlannerTask,
  createPlannerTimeBlock,
  removePlannerHabit,
  removePlannerHabitLog,
  removePlannerTask,
  removePlannerTimeBlock,
  setPlannerTaskDone,
  togglePlannerHabitLogForDay,
  updatePlannerHabit,
  updatePlannerTask,
  updatePlannerTimeBlock
};
export type {
  PlannerHabitCreateInput,
  PlannerHabitLogCreateInput,
  PlannerHabitUpdateInput,
  PlannerTaskCreateInput,
  PlannerTaskUpdateInput,
  PlannerTimeBlockCreateInput,
  PlannerTimeBlockUpdateInput
};

export type PlannerViewId = "inbox" | "today" | "overdue" | "upcoming" | "projects" | "habits" | "review";

export const PLANNER_VIEW_IDS: PlannerViewId[] = [
  "inbox",
  "today",
  "overdue",
  "upcoming",
  "projects",
  "habits",
  "review"
];

const PRIORITY_WEIGHT: Record<PlannerTaskPriority, number> = {
  urgent: 5,
  high: 4,
  medium: 3,
  low: 2,
  none: 1
};

export function getStartOfLocalDay(value = Date.now()) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function getEndOfLocalDay(value = Date.now()) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

export function isPlannerTaskDone(task: Task) {
  return task.status === "done" || Boolean(task.completedAt);
}

export function isPlannerTaskCanceled(task: Task) {
  return task.status === "canceled" || Boolean(task.canceledAt);
}

export function isPlannerTaskActive(task: Task) {
  return !isPlannerTaskDone(task) && !isPlannerTaskCanceled(task);
}

function getPlannerTaskCalendarAnchor(task: Task) {
  return task.dueAt ?? task.scheduledStartAt ?? task.recurrenceAnchorAt;
}

function getPlannerTaskSortAnchor(task: Task, now = Date.now()) {
  if (isRecurringPlannerRule(task.recurrenceRule)) {
    return getPlannerTaskPrimaryOccurrence(task, now)?.startAt ?? Number.POSITIVE_INFINITY;
  }

  return getPlannerTaskCalendarAnchor(task) ?? Number.POSITIVE_INFINITY;
}

export function isPlannerTaskDueToday(task: Task, now = Date.now()) {
  if (isRecurringPlannerRule(task.recurrenceRule)) {
    return Boolean(isPlannerTaskActive(task) && getPlannerTaskOccurrenceForDay(task, now));
  }

  const anchor = getPlannerTaskCalendarAnchor(task);

  if (!anchor) {
    return false;
  }

  return anchor >= getStartOfLocalDay(now) && anchor <= getEndOfLocalDay(now);
}

export function isPlannerTaskOverdue(task: Task, now = Date.now()) {
  if (isRecurringPlannerRule(task.recurrenceRule)) {
    return Boolean(isPlannerTaskActive(task) && getPlannerTaskOverdueOccurrence(task, now));
  }

  const anchor = getPlannerTaskCalendarAnchor(task);
  return Boolean(anchor && anchor < getStartOfLocalDay(now) && isPlannerTaskActive(task));
}

export function isPlannerTaskUpcoming(task: Task, now = Date.now()) {
  if (isRecurringPlannerRule(task.recurrenceRule)) {
    return Boolean(isPlannerTaskActive(task) && getPlannerTaskUpcomingOccurrence(task, now));
  }

  const anchor = getPlannerTaskCalendarAnchor(task);
  return Boolean(anchor && anchor > getEndOfLocalDay(now) && isPlannerTaskActive(task));
}

export function isPlannerTaskInInbox(task: Task) {
  return isPlannerTaskActive(task) && (task.status === "inbox" || !task.projectId);
}

export function formatPlannerDateInput(value: number | null | undefined) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parsePlannerDateInput(value: string) {
  if (!value) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return null;
  }

  return new Date(year, month - 1, day, 12, 0, 0, 0).getTime();
}

export function formatPlannerDateTimeInput(value: number | null | undefined) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function parsePlannerDateTimeInput(value: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getPlannerProjectName(projects: Project[], projectId: string | null | undefined) {
  if (!projectId) {
    return null;
  }

  return projects.find((project) => project.id === projectId)?.name ?? null;
}

export function getPlannerTagMap(tags: Tag[]) {
  return new Map(tags.map((tag) => [tag.id, tag]));
}

function taskMatchesSearch(task: Task, searchQuery: string, projects: Project[], tags: Tag[]) {
  const query = searchQuery.trim().toLowerCase();

  if (!query) {
    return true;
  }

  const projectName = getPlannerProjectName(projects, task.projectId) ?? "";
  const tagMap = getPlannerTagMap(tags);
  const tagNames = task.tagIds.map((tagId) => tagMap.get(tagId)?.name ?? "").join(" ");
  const searchable = `${task.title} ${task.description} ${projectName} ${tagNames}`.toLowerCase();
  return searchable.includes(query);
}

export function sortPlannerTasks(tasks: Task[]) {
  const now = Date.now();

  return [...tasks].sort((left, right) => {
    const leftDone = isPlannerTaskDone(left) ? 1 : 0;
    const rightDone = isPlannerTaskDone(right) ? 1 : 0;

    if (leftDone !== rightDone) {
      return leftDone - rightDone;
    }

    const leftDue = getPlannerTaskSortAnchor(left, now);
    const rightDue = getPlannerTaskSortAnchor(right, now);

    if (leftDue !== rightDue) {
      return leftDue - rightDue;
    }

    const priorityDelta = PRIORITY_WEIGHT[right.priority] - PRIORITY_WEIGHT[left.priority];

    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return (left.sortOrder ?? left.createdAt) - (right.sortOrder ?? right.createdAt);
  });
}

export function sortPlannerTimeBlocks(timeBlocks: TimeBlock[]) {
  return [...timeBlocks].sort((left, right) => {
    if (left.startAt !== right.startAt) {
      return left.startAt - right.startAt;
    }

    return left.createdAt - right.createdAt;
  });
}

export function getPlannerTimeBlocksForRange(timeBlocks: TimeBlock[], rangeStartAt: number, rangeEndAt: number) {
  return sortPlannerTimeBlocks(
    timeBlocks.filter((timeBlock) => timeBlock.startAt < rangeEndAt && timeBlock.endAt > rangeStartAt)
  );
}

export function getPlannerScheduledTasksForRange(tasks: Task[], rangeStartAt: number, rangeEndAt: number) {
  return sortPlannerTasks(
    tasks.filter((task) => {
      if (!isPlannerTaskActive(task) || !task.scheduledStartAt) {
        return false;
      }

      const scheduledEndAt = task.scheduledEndAt ?? task.scheduledStartAt + (task.estimateMinutes ?? 30) * 60_000;
      return task.scheduledStartAt < rangeEndAt && scheduledEndAt > rangeStartAt;
    })
  );
}

export function getPlannerTasksForView(input: {
  tasks: Task[];
  viewId: PlannerViewId;
  searchQuery: string;
  projects: Project[];
  tags: Tag[];
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const filteredTasks = input.tasks.filter((task) => {
    if (!taskMatchesSearch(task, input.searchQuery, input.projects, input.tags)) {
      return false;
    }

    if (input.viewId === "inbox") {
      return isPlannerTaskInInbox(task);
    }

    if (input.viewId === "today") {
      return isPlannerTaskActive(task) && isPlannerTaskDueToday(task, now);
    }

    if (input.viewId === "overdue") {
      return isPlannerTaskOverdue(task, now);
    }

    if (input.viewId === "upcoming") {
      return isPlannerTaskUpcoming(task, now);
    }

    if (input.viewId === "projects") {
      return isPlannerTaskActive(task);
    }

    if (input.viewId === "review") {
      return isPlannerTaskDone(task) || isPlannerTaskCanceled(task);
    }

    return false;
  });

  return sortPlannerTasks(filteredTasks);
}

export function getPlannerStats(tasks: Task[], now = Date.now()) {
  const activeTasks = tasks.filter(isPlannerTaskActive);

  return {
    inbox: activeTasks.filter(isPlannerTaskInInbox).length,
    today: activeTasks.filter((task) => isPlannerTaskDueToday(task, now)).length,
    overdue: activeTasks.filter((task) => isPlannerTaskOverdue(task, now)).length,
    upcoming: activeTasks.filter((task) => isPlannerTaskUpcoming(task, now)).length,
    projects: activeTasks.length,
    habits: 0,
    review: tasks.filter((task) => isPlannerTaskDone(task) || isPlannerTaskCanceled(task)).length
  } satisfies Record<PlannerViewId, number>;
}
