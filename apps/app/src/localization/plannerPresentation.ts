import type { AppLanguage, PlannerTaskPriority, Task } from "../types";
import type { PlannerViewId } from "../lib/planner";
import { getStartOfLocalDay } from "../lib/planner";
import {
  getPlannerHabitCadencePreset,
  getPlannerHabitIntervalDays
} from "../lib/plannerHabits";
import {
  getPlannerTaskPrimaryOccurrence,
  normalizeRecurrenceRule
} from "../lib/plannerRecurrence";
import {
  buildPlannerTaskScheduleFields,
  type PlannerTaskDateDraft
} from "../lib/plannerTaskSchedule";
import {
  formatDateTimeValue,
  formatDateValue,
  formatTimeValue,
  getCurrentLocaleRuntime
} from "./formatters";
import { translateApp, translateInline } from "./translateInline";

export function getPlannerViewLabels(language: AppLanguage): Record<PlannerViewId, string> {
  return {
    inbox: translateApp(language, "plannerCore.views.inbox"),
    today: translateApp(language, "plannerCore.views.today"),
    overdue: translateApp(language, "plannerCore.views.overdue"),
    upcoming: translateApp(language, "plannerCore.views.upcoming"),
    projects: translateApp(language, "plannerCore.views.projects"),
    habits: translateApp(language, "plannerCore.views.habits"),
    review: translateApp(language, "plannerCore.views.review")
  };
}

export function getPlannerPriorityLabel(priority: PlannerTaskPriority, language: AppLanguage) {
  return translateApp(language, `plannerCore.priorities.${priority}`);
}

export function getPlannerStatusLabel(status: Task["status"], language: AppLanguage) {
  return translateApp(language, `plannerCore.statuses.${status}`);
}

export function formatPlannerDate(value: number | null | undefined, language: AppLanguage) {
  if (!value) {
    return translateApp(language, "plannerCore.noDate");
  }

  return formatDateValue(value, getCurrentLocaleRuntime(), { day: "numeric", month: "short" });
}

export function formatPlannerTime(value: number | null | undefined, _language: AppLanguage) {
  if (!value) {
    return "--:--";
  }

  return formatTimeValue(value, getCurrentLocaleRuntime(), { hour: "2-digit", minute: "2-digit" });
}

export function formatPlannerDateTime(value: number | null | undefined, language: AppLanguage) {
  if (!value) {
    return translateApp(language, "plannerCore.noTime");
  }

  return formatDateTimeValue(value, getCurrentLocaleRuntime(), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function formatPlannerFullDateTime(value: number | null | undefined, language: AppLanguage) {
  if (!value) {
    return translateApp(language, "plannerCore.noTime");
  }

  return formatDateTimeValue(value, getCurrentLocaleRuntime(), {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function summarizePlannerRecurrence(rule: string | null | undefined, language: AppLanguage) {
  const normalized = normalizeRecurrenceRule(rule);

  if (!normalized) {
    return translateInline(language, "plannerRecurrence.noRepeat");
  }

  const frequency = normalized.match(/FREQ=([A-Z]+)/)?.[1] ?? "";
  const interval = Math.max(1, Number(normalized.match(/INTERVAL=(\d+)/)?.[1] ?? "1"));
  const keys = interval === 1
    ? { DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly", YEARLY: "yearly" }
    : { DAILY: "everyDays", WEEKLY: "everyWeeks", MONTHLY: "everyMonths", YEARLY: "everyYears" };
  const key = keys[frequency as keyof typeof keys];
  return key ? translateApp(language, `plannerCore.recurrence.${key}`, { count: interval }) : normalized;
}

export function getPlannerHabitCadenceLabel(rule: string | null | undefined, language: AppLanguage) {
  const preset = getPlannerHabitCadencePreset(rule);
  return translateApp(language, `plannerCore.habitCadence.${preset}`, {
    count: getPlannerHabitIntervalDays(rule)
  });
}

export function getPlannerTaskScheduleSummary(task: Task, language: AppLanguage) {
  if (task.recurrenceRule) {
    const anchor = task.scheduledStartAt ?? task.dueAt ?? task.recurrenceAnchorAt;
    const recurrence = summarizePlannerRecurrence(task.recurrenceRule, language);
    const primaryOccurrence = getPlannerTaskPrimaryOccurrence(task);

    if (primaryOccurrence) {
      const dateLabel = primaryOccurrence.scheduledStartAt
        ? formatPlannerDateTime(primaryOccurrence.startAt, language)
        : formatPlannerDate(primaryOccurrence.startAt, language);
      return `${recurrence} · ${dateLabel}`;
    }

    if (anchor) {
      const dateLabel = task.scheduledStartAt
        ? formatPlannerDateTime(anchor, language)
        : formatPlannerDate(anchor, language);
      return `${recurrence} · ${dateLabel}`;
    }

    return recurrence;
  }

  if (task.scheduledStartAt) {
    if (task.scheduledEndAt && getStartOfLocalDay(task.scheduledEndAt) !== getStartOfLocalDay(task.scheduledStartAt)) {
      return `${formatPlannerDateTime(task.scheduledStartAt, language)} - ${formatPlannerDateTime(task.scheduledEndAt, language)}`;
    }

    if (task.scheduledEndAt) {
      return `${formatPlannerDate(task.scheduledStartAt, language)} · ${formatPlannerTime(task.scheduledStartAt, language)}-${formatPlannerTime(task.scheduledEndAt, language)}`;
    }

    return formatPlannerDateTime(task.scheduledStartAt, language);
  }

  if (task.dueAt) {
    return formatPlannerDate(task.dueAt, language);
  }

  return translateInline(language, "plannerTaskSchedule.noDate");
}

export function getPlannerTaskDateDraftSummary(draft: PlannerTaskDateDraft, language: AppLanguage) {
  const scheduleFields = buildPlannerTaskScheduleFields(draft);

  return getPlannerTaskScheduleSummary({
    recurrenceRule: scheduleFields.recurrenceRule ?? null,
    recurrenceAnchorAt: scheduleFields.recurrenceAnchorAt ?? null,
    scheduledStartAt: scheduleFields.scheduledStartAt ?? null,
    scheduledEndAt: scheduleFields.scheduledEndAt ?? null,
    dueAt: scheduleFields.dueAt ?? null
  } as Task, language);
}
