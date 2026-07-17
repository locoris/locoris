import type { Task } from "../types";
import { getResolvedTimeZone } from "../localization/formatters";
import { getEndOfLocalDay, getStartOfLocalDay } from "./planner";
import {
  buildPlannerRRule,
  type PlannerRecurrenceFrequency
} from "./plannerRecurrence";

export type PlannerTaskDateRepeat = "none" | PlannerRecurrenceFrequency | "customDaily";

export interface PlannerTaskDateDraft {
  startDateAt: number | null;
  endDateAt: number | null;
  hasTime: boolean;
  startTimeMinutes: number;
  endTimeMinutes: number;
  repeat: PlannerTaskDateRepeat;
  repeatIntervalDays: number;
  repeatUntilAt: number | null;
}

export const DEFAULT_PLANNER_START_TIME_MINUTES = 9 * 60;
export const DEFAULT_PLANNER_END_TIME_MINUTES = 10 * 60;
const MIN_TIMED_TASK_DURATION_MINUTES = 15;
const MAX_PLANNER_TIME_MINUTES = 23 * 60 + 59;

function clampTimeMinutes(value: number, max = MAX_PLANNER_TIME_MINUTES) {
  return Math.max(0, Math.min(max, Math.round(value)));
}

function getMinutesOfDay(value: number | null | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes();
}

export function addPlannerMinutesToDay(dayAt: number, minutes: number) {
  const date = new Date(getStartOfLocalDay(dayAt));
  date.setMinutes(clampTimeMinutes(minutes));
  return date.getTime();
}

export function createPlannerTaskDateDraft(startDateAt: number | null = null): PlannerTaskDateDraft {
  return {
    startDateAt: startDateAt ? getStartOfLocalDay(startDateAt) : null,
    endDateAt: null,
    hasTime: false,
    startTimeMinutes: DEFAULT_PLANNER_START_TIME_MINUTES,
    endTimeMinutes: DEFAULT_PLANNER_END_TIME_MINUTES,
    repeat: "none",
    repeatIntervalDays: 2,
    repeatUntilAt: null
  };
}

export function getPlannerTaskDateDraft(task: Task | null | undefined): PlannerTaskDateDraft {
  const repeat = getPlannerRepeatFromRule(task?.recurrenceRule);
  const startSource = task?.scheduledStartAt ?? task?.dueAt ?? task?.recurrenceAnchorAt ?? null;
  const endSource = task?.scheduledEndAt ?? task?.recurrenceUntilAt ?? null;
  const startDateAt = startSource ? getStartOfLocalDay(startSource) : null;
  const endDateAt =
    endSource && startDateAt && getStartOfLocalDay(endSource) !== startDateAt
      ? getStartOfLocalDay(endSource)
      : null;
  const startTimeMinutes = getMinutesOfDay(task?.scheduledStartAt, DEFAULT_PLANNER_START_TIME_MINUTES);
  const fallbackEndMinutes = Math.max(startTimeMinutes + 45, DEFAULT_PLANNER_END_TIME_MINUTES);
  const endTimeMinutes = Math.max(
    startTimeMinutes + MIN_TIMED_TASK_DURATION_MINUTES,
    getMinutesOfDay(task?.scheduledEndAt, fallbackEndMinutes)
  );

  return {
    startDateAt,
    endDateAt,
    hasTime: Boolean(task?.scheduledStartAt),
    startTimeMinutes,
    endTimeMinutes: clampTimeMinutes(endTimeMinutes),
    repeat,
    repeatIntervalDays: getPlannerRepeatIntervalDays(task?.recurrenceRule),
    repeatUntilAt: task?.recurrenceUntilAt ?? endDateAt ?? null
  };
}

export function getPlannerRepeatFromRule(rule: string | null | undefined): PlannerTaskDateRepeat {
  const normalized = rule?.trim().toUpperCase() ?? "";

  if (!normalized) {
    return "none";
  }

  const frequency = normalized.match(/FREQ=([A-Z]+)/)?.[1]?.toLowerCase();
  const interval = Number(normalized.match(/INTERVAL=(\d+)/)?.[1] ?? "1");

  if (frequency === "daily" && interval > 1) {
    return "customDaily";
  }

  if (frequency === "daily" || frequency === "weekly" || frequency === "monthly" || frequency === "yearly") {
    return frequency;
  }

  return "none";
}

export function getPlannerRepeatIntervalDays(rule: string | null | undefined) {
  const normalized = rule?.trim().toUpperCase() ?? "";
  const frequency = normalized.match(/FREQ=([A-Z]+)/)?.[1]?.toLowerCase();
  const interval = Number(normalized.match(/INTERVAL=(\d+)/)?.[1] ?? "2");

  if (frequency !== "daily") {
    return 2;
  }

  return Number.isFinite(interval) ? Math.max(2, Math.min(365, Math.round(interval))) : 2;
}

export function normalizePlannerTaskDateDraft(draft: PlannerTaskDateDraft): PlannerTaskDateDraft {
  const startDateAt = draft.startDateAt ? getStartOfLocalDay(draft.startDateAt) : null;
  const rawEndDateAt = draft.endDateAt ? getStartOfLocalDay(draft.endDateAt) : null;
  const endDateAt = startDateAt && rawEndDateAt && rawEndDateAt > startDateAt ? rawEndDateAt : null;
  const startTimeMinutes = clampTimeMinutes(draft.startTimeMinutes, MAX_PLANNER_TIME_MINUTES - MIN_TIMED_TASK_DURATION_MINUTES);
  const endTimeMinutes = Math.max(startTimeMinutes + MIN_TIMED_TASK_DURATION_MINUTES, clampTimeMinutes(draft.endTimeMinutes));
  const repeatIntervalDays = Math.max(2, Math.min(365, Math.round(draft.repeatIntervalDays || 2)));

  return {
    ...draft,
    startDateAt,
    endDateAt,
    startTimeMinutes,
    endTimeMinutes,
    repeatIntervalDays,
    repeatUntilAt: draft.repeatUntilAt ? getEndOfLocalDay(draft.repeatUntilAt) : endDateAt ? getEndOfLocalDay(endDateAt) : null
  };
}

export function buildPlannerTaskSchedulePatch(task: Task, inputDraft: PlannerTaskDateDraft): Partial<Task> {
  const scheduleFields = buildPlannerTaskScheduleFields(inputDraft, task.status);

  return {
    ...scheduleFields,
    recurrenceExceptionDates: scheduleFields.recurrenceRule ? task.recurrenceExceptionDates ?? [] : [],
    recurrenceCompletedDates: scheduleFields.recurrenceRule ? task.recurrenceCompletedDates ?? [] : [],
    recurrenceOverrides: scheduleFields.recurrenceRule ? task.recurrenceOverrides ?? [] : []
  };
}

export function buildPlannerTaskScheduleFields(
  inputDraft: PlannerTaskDateDraft,
  baseStatus: Task["status"] = "todo"
): Partial<
  Pick<
    Task,
    | "dueAt"
    | "scheduledStartAt"
    | "scheduledEndAt"
    | "recurrenceRule"
    | "recurrenceTimezone"
    | "recurrenceAnchorAt"
    | "recurrenceUntilAt"
    | "recurrenceExceptionDates"
    | "recurrenceCompletedDates"
    | "recurrenceOverrides"
    | "estimateMinutes"
    | "status"
  >
> {
  const draft = normalizePlannerTaskDateDraft(inputDraft);

  if (!draft.startDateAt) {
    return {
      dueAt: null,
      scheduledStartAt: null,
      scheduledEndAt: null,
      recurrenceRule: null,
      recurrenceTimezone: null,
      recurrenceAnchorAt: null,
      recurrenceUntilAt: null,
      recurrenceExceptionDates: [],
      recurrenceCompletedDates: [],
      recurrenceOverrides: [],
      estimateMinutes: null,
      status: baseStatus === "scheduled" ? "todo" : baseStatus
    };
  }

  const hasRange = Boolean(draft.endDateAt);
  const isRepeating = draft.repeat !== "none";
  const shouldCreateDateRange = hasRange && !isRepeating;
  const scheduledStartAt =
    draft.hasTime || shouldCreateDateRange
      ? addPlannerMinutesToDay(draft.startDateAt, draft.hasTime ? draft.startTimeMinutes : 0)
      : null;
  const scheduledEndAt = scheduledStartAt
    ? addPlannerMinutesToDay(
        shouldCreateDateRange ? draft.endDateAt ?? draft.startDateAt : draft.startDateAt,
        draft.hasTime ? draft.endTimeMinutes : MAX_PLANNER_TIME_MINUTES
      )
    : null;
  const dueAt = scheduledStartAt ? null : draft.startDateAt;
  const recurrenceUntilSource = draft.repeatUntilAt ?? draft.endDateAt;
  const recurrenceFrequency: PlannerRecurrenceFrequency | null =
    draft.repeat === "none" ? null : draft.repeat === "customDaily" ? "daily" : draft.repeat;
  const recurrenceRule =
    !recurrenceFrequency
      ? null
      : buildPlannerRRule({
          frequency: recurrenceFrequency,
          interval: draft.repeat === "customDaily" ? draft.repeatIntervalDays : 1,
          untilAt: recurrenceUntilSource ? getEndOfLocalDay(recurrenceUntilSource) : null
        });
  const recurrenceAnchorAt = recurrenceRule ? scheduledStartAt ?? dueAt ?? draft.startDateAt : null;

  return {
    dueAt,
    scheduledStartAt,
    scheduledEndAt,
    recurrenceRule,
    recurrenceTimezone: recurrenceRule ? getResolvedTimeZone() : null,
    recurrenceAnchorAt,
    recurrenceUntilAt: recurrenceRule ? draft.repeatUntilAt ?? (draft.endDateAt ? getEndOfLocalDay(draft.endDateAt) : null) : null,
    recurrenceExceptionDates: [],
    recurrenceCompletedDates: [],
    recurrenceOverrides: [],
    estimateMinutes:
      scheduledStartAt && scheduledEndAt && draft.hasTime
        ? Math.max(MIN_TIMED_TASK_DURATION_MINUTES, Math.round((scheduledEndAt - scheduledStartAt) / 60_000))
        : null,
    status: scheduledStartAt && (baseStatus === "inbox" || baseStatus === "todo") ? "scheduled" : baseStatus
  };
}

export function formatPlannerTimeMinutes(minutes: number) {
  const hours = Math.floor(clampTimeMinutes(minutes) / 60);
  const mins = clampTimeMinutes(minutes) % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}
