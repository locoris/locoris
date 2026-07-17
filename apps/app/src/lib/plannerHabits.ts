import { rrulestr } from "rrule";

import type { Habit, HabitLog, Project } from "../types";
import { getEndOfLocalDay, getStartOfLocalDay } from "./planner";
import { buildPlannerRRule, normalizeRecurrenceRule } from "./plannerRecurrence";

export type PlannerHabitCadencePreset = "daily" | "weekdays" | "weekly" | "customDaily";

export interface PlannerHabitSummary {
  habit: Habit;
  project: Project | null;
  dueToday: boolean;
  completedToday: boolean;
  missed: boolean;
  streak: number;
  bestStreak: number;
  weekDueCount: number;
  weekCompletedCount: number;
  weekDays: PlannerHabitWeekDay[];
  historyDays: PlannerHabitHistoryDay[];
  recentLogDays: number[];
  last30DueCount: number;
  last30CompletedCount: number;
  last30MissedCount: number;
  last30CompletionRate: number | null;
  last90DueCount: number;
  last90CompletedCount: number;
  last90MissedCount: number;
  last90CompletionRate: number | null;
  lastLogAt: number | null;
  health: PlannerHabitHealth;
}

const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR"];
const DAY_MS = 86_400_000;

export type PlannerHabitHealth = "new" | "steady" | "watch" | "risk" | "paused";

export interface PlannerHabitWeekDay {
  dayAt: number;
  due: boolean;
  completed: boolean;
  paused: boolean;
  missed: boolean;
  today: boolean;
  future: boolean;
}

export interface PlannerHabitHistoryDay extends PlannerHabitWeekDay {
  logCount: number;
}

export function buildPlannerHabitFrequencyRule(preset: PlannerHabitCadencePreset, intervalDays = 2) {
  if (preset === "weekdays") {
    return "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR";
  }

  if (preset === "weekly") {
    return buildPlannerRRule({
      frequency: "weekly",
      interval: 1
    });
  }

  if (preset === "customDaily") {
    return buildPlannerRRule({
      frequency: "daily",
      interval: Math.max(2, Math.min(365, Math.round(intervalDays || 2)))
    });
  }

  return buildPlannerRRule({
    frequency: "daily",
    interval: 1
  });
}

export function getPlannerHabitCadencePreset(rule: string | null | undefined): PlannerHabitCadencePreset {
  const normalized = normalizeRecurrenceRule(rule) ?? "";
  const frequency = normalized.match(/FREQ=([A-Z]+)/)?.[1] ?? "";
  const interval = Number(normalized.match(/INTERVAL=(\d+)/)?.[1] ?? "1");
  const byDay = normalized.match(/BYDAY=([A-Z,]+)/)?.[1]?.split(",") ?? [];

  if (frequency === "WEEKLY" && WEEKDAY_CODES.every((day) => byDay.includes(day))) {
    return "weekdays";
  }

  if (frequency === "WEEKLY") {
    return "weekly";
  }

  if (frequency === "DAILY" && interval > 1) {
    return "customDaily";
  }

  return "daily";
}

export function getPlannerHabitIntervalDays(rule: string | null | undefined) {
  const normalized = normalizeRecurrenceRule(rule) ?? "";
  const interval = Number(normalized.match(/INTERVAL=(\d+)/)?.[1] ?? "2");
  return Number.isFinite(interval) ? Math.max(2, Math.min(365, Math.round(interval))) : 2;
}

function getDayRange(dayAt: number) {
  return {
    startAt: getStartOfLocalDay(dayAt),
    endAt: getEndOfLocalDay(dayAt)
  };
}

function createHabitRule(habit: Habit) {
  const normalized = normalizeRecurrenceRule(habit.frequencyRule);

  if (!normalized) {
    return null;
  }

  try {
    return rrulestr(`RRULE:${normalized}`, {
      dtstart: new Date(getStartOfLocalDay(habit.createdAt))
    });
  } catch {
    return null;
  }
}

export function isPlannerHabitPausedOnDay(habit: Habit, dayAt: number) {
  const { startAt } = getDayRange(dayAt);
  const ranges = habit.pauseRanges ?? [];

  if (habit.status === "paused" && ranges.every((range) => range.endAt !== null)) {
    const pausedFrom = habit.pausedAt ?? ranges.at(-1)?.startAt ?? habit.updatedAt;
    return getStartOfLocalDay(pausedFrom) <= startAt;
  }

  return ranges.some((range) => {
    const rangeStartDay = getStartOfLocalDay(range.startAt);
    const rangeEndDay = range.endAt === null ? Number.POSITIVE_INFINITY : getStartOfLocalDay(range.endAt);

    return rangeStartDay <= startAt && rangeEndDay > startAt;
  });
}

export function isPlannerHabitDueOnDay(habit: Habit, dayAt: number) {
  if (habit.status === "archived" || isPlannerHabitPausedOnDay(habit, dayAt)) {
    return false;
  }

  const { startAt, endAt } = getDayRange(dayAt);
  const rule = createHabitRule(habit);

  if (!rule) {
    return true;
  }

  return rule.between(new Date(startAt), new Date(endAt), true).length > 0;
}

export function getPlannerHabitLogsForDay(habitLogs: HabitLog[], habitId: string, dayAt: number) {
  const { startAt, endAt } = getDayRange(dayAt);
  return habitLogs.filter((log) => log.habitId === habitId && log.occurredAt >= startAt && log.occurredAt <= endAt);
}

export function isPlannerHabitCompletedOnDay(habit: Habit, habitLogs: HabitLog[], dayAt: number) {
  const logs = getPlannerHabitLogsForDay(habitLogs, habit.id, dayAt);
  const total = logs.reduce((sum, log) => sum + Math.max(0, log.value || 0), 0);
  return total >= Math.max(1, habit.targetCount || 1);
}

export function getPlannerHabitStreak(habit: Habit, habitLogs: HabitLog[], now = Date.now()) {
  let streak = 0;
  const cursor = getStartOfLocalDay(now);

  for (let index = 0; index < 370; index += 1) {
    const dayAt = cursor - index * 86_400_000;

    if (!isPlannerHabitDueOnDay(habit, dayAt)) {
      continue;
    }

    if (!isPlannerHabitCompletedOnDay(habit, habitLogs, dayAt)) {
      if (dayAt === cursor) {
        continue;
      }

      break;
    }

    streak += 1;
  }

  return streak;
}

export function getPlannerHabitBestStreak(habit: Habit, habitLogs: HabitLog[], now = Date.now(), maxDays = 370) {
  let bestStreak = 0;
  let currentStreak = 0;
  const todayStart = getStartOfLocalDay(now);
  const firstDayAt = todayStart - (Math.max(1, maxDays) - 1) * DAY_MS;

  for (let dayAt = firstDayAt; dayAt <= todayStart; dayAt += DAY_MS) {
    if (!isPlannerHabitDueOnDay(habit, dayAt)) {
      continue;
    }

    const completed = isPlannerHabitCompletedOnDay(habit, habitLogs, dayAt);

    if (!completed && dayAt === todayStart) {
      continue;
    }

    if (!completed) {
      currentStreak = 0;
      continue;
    }

    currentStreak += 1;
    bestStreak = Math.max(bestStreak, currentStreak);
  }

  return bestStreak;
}

export function getPlannerHabitRangeStats(habit: Habit, habitLogs: HabitLog[], days: number, now = Date.now()) {
  const todayStart = getStartOfLocalDay(now);
  const normalizedDays = Math.max(1, Math.round(days || 1));
  const historyDays: PlannerHabitHistoryDay[] = [];
  let due = 0;
  let completed = 0;
  let missed = 0;

  for (let offset = normalizedDays - 1; offset >= 0; offset -= 1) {
    const dayAt = todayStart - offset * DAY_MS;
    const paused = isPlannerHabitPausedOnDay(habit, dayAt);
    const isDue = isPlannerHabitDueOnDay(habit, dayAt);
    const logs = getPlannerHabitLogsForDay(habitLogs, habit.id, dayAt);
    const isCompleted = isDue && isPlannerHabitCompletedOnDay(habit, habitLogs, dayAt);
    const isMissed = isDue && !isCompleted && dayAt < todayStart;

    historyDays.push({
      dayAt,
      due: isDue,
      completed: isCompleted,
      paused,
      missed: isMissed,
      today: dayAt === todayStart,
      future: false,
      logCount: logs.length
    });

    if (!isDue || dayAt > todayStart) {
      continue;
    }

    due += 1;

    if (isCompleted) {
      completed += 1;
    } else if (dayAt < todayStart) {
      missed += 1;
    }
  }

  return {
    due,
    completed,
    missed,
    historyDays,
    completionRate: due > 0 ? completed / due : null
  };
}

function getPlannerHabitRecentLogDays(habitLogs: HabitLog[], habitId: string, limit = 5) {
  const seen = new Set<number>();
  return habitLogs
    .filter((log) => log.habitId === habitId)
    .sort((left, right) => right.occurredAt - left.occurredAt)
    .map((log) => getStartOfLocalDay(log.occurredAt))
    .filter((dayAt) => {
      if (seen.has(dayAt)) {
        return false;
      }

      seen.add(dayAt);
      return true;
    })
    .slice(0, limit);
}

function getPlannerHabitHealth(input: {
  habit: Habit;
  dueToday: boolean;
  completedToday: boolean;
  last30DueCount: number;
  last30CompletionRate: number | null;
  last30MissedCount: number;
}) {
  if (input.habit.status === "paused") {
    return "paused" satisfies PlannerHabitHealth;
  }

  if (input.last30DueCount < 3) {
    return "new" satisfies PlannerHabitHealth;
  }

  if (input.last30MissedCount >= 3 || (input.last30CompletionRate ?? 1) < 0.55) {
    return "risk" satisfies PlannerHabitHealth;
  }

  if (!input.completedToday && input.dueToday) {
    return "watch" satisfies PlannerHabitHealth;
  }

  if ((input.last30CompletionRate ?? 0) >= 0.82) {
    return "steady" satisfies PlannerHabitHealth;
  }

  return "watch" satisfies PlannerHabitHealth;
}

export function getPlannerHabitWeekStats(habit: Habit, habitLogs: HabitLog[], now = Date.now()) {
  const cursor = new Date(getStartOfLocalDay(now));
  const day = cursor.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  cursor.setDate(cursor.getDate() + mondayOffset);
  const weekStart = cursor.getTime();
  const todayStart = getStartOfLocalDay(now);
  const todayEnd = getEndOfLocalDay(now);
  let due = 0;
  let completed = 0;
  const days: PlannerHabitWeekDay[] = [];

  for (let index = 0; index < 7; index += 1) {
    const dayAt = weekStart + index * DAY_MS;
    const isFuture = dayAt > todayStart;
    const paused = isPlannerHabitPausedOnDay(habit, dayAt);
    const isDue = isPlannerHabitDueOnDay(habit, dayAt);
    const isCompleted = isDue && isPlannerHabitCompletedOnDay(habit, habitLogs, dayAt);
    const isMissed = isDue && !isCompleted && dayAt < todayStart;

    days.push({
      dayAt,
      due: isDue,
      completed: isCompleted,
      paused,
      missed: isMissed,
      today: dayAt === todayStart,
      future: isFuture
    });

    if (!isDue || dayAt > todayEnd) {
      continue;
    }

    due += 1;

    if (isCompleted) {
      completed += 1;
    }
  }

  return {
    due,
    completed,
    days,
    ratio: due > 0 ? completed / due : 1
  };
}

export function getPlannerHabitLastLogAt(habitLogs: HabitLog[], habitId: string) {
  return habitLogs
    .filter((log) => log.habitId === habitId)
    .reduce<number | null>((latest, log) => Math.max(latest ?? 0, log.occurredAt), null);
}

export function buildPlannerHabitSummaries(input: {
  habits: Habit[];
  habitLogs: HabitLog[];
  projects: Project[];
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const projectMap = new Map(input.projects.map((project) => [project.id, project]));

  return [...input.habits]
    .sort((left, right) => (left.sortOrder ?? left.createdAt) - (right.sortOrder ?? right.createdAt))
    .map((habit) => {
      const weekStats = getPlannerHabitWeekStats(habit, input.habitLogs, now);
      const last30Stats = getPlannerHabitRangeStats(habit, input.habitLogs, 30, now);
      const last90Stats = getPlannerHabitRangeStats(habit, input.habitLogs, 90, now);
      const historyStats = getPlannerHabitRangeStats(habit, input.habitLogs, 56, now);
      const dueToday = isPlannerHabitDueOnDay(habit, now);
      const completedToday = dueToday && isPlannerHabitCompletedOnDay(habit, input.habitLogs, now);
      const missed = weekStats.days.some((day) => day.missed);
      const health = getPlannerHabitHealth({
        habit,
        dueToday,
        completedToday,
        last30DueCount: last30Stats.due,
        last30CompletionRate: last30Stats.completionRate,
        last30MissedCount: last30Stats.missed
      });

      return {
        habit,
        project: habit.projectId ? projectMap.get(habit.projectId) ?? null : null,
        dueToday,
        completedToday,
        missed,
        streak: getPlannerHabitStreak(habit, input.habitLogs, now),
        bestStreak: getPlannerHabitBestStreak(habit, input.habitLogs, now),
        weekDueCount: weekStats.due,
        weekCompletedCount: weekStats.completed,
        weekDays: weekStats.days,
        historyDays: historyStats.historyDays,
        recentLogDays: getPlannerHabitRecentLogDays(input.habitLogs, habit.id),
        last30DueCount: last30Stats.due,
        last30CompletedCount: last30Stats.completed,
        last30MissedCount: last30Stats.missed,
        last30CompletionRate: last30Stats.completionRate,
        last90DueCount: last90Stats.due,
        last90CompletedCount: last90Stats.completed,
        last90MissedCount: last90Stats.missed,
        last90CompletionRate: last90Stats.completionRate,
        lastLogAt: getPlannerHabitLastLogAt(input.habitLogs, habit.id),
        health
      } satisfies PlannerHabitSummary;
    });
}
