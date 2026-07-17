import { RRule, rrulestr } from "rrule";

import type { PlannerRecurrenceOverride, Task } from "../types";

export type PlannerRecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";
export type PlannerRecurringTaskAction = "skipOccurrence" | "completeOccurrence" | "completeAllFuture";

const SUPPORTED_FREQUENCIES: Record<PlannerRecurrenceFrequency, string> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
  yearly: "YEARLY"
};

export function normalizeRecurrenceRule(rule: string | null | undefined) {
  const normalized = rule?.trim().toUpperCase() ?? "";

  if (!normalized) {
    return null;
  }

  return normalized.startsWith("RRULE:") ? normalized.slice("RRULE:".length) : normalized;
}

export function normalizePlannerOccurrenceMarker(value: number) {
  return Math.round(value / 1000) * 1000;
}

function getTaskRecurrenceAnchor(task: Task) {
  return task.recurrenceAnchorAt ?? task.scheduledStartAt ?? task.dueAt ?? task.createdAt;
}

function getTaskOccurrenceDuration(task: Task) {
  if (task.scheduledStartAt && task.scheduledEndAt && task.scheduledEndAt > task.scheduledStartAt) {
    return task.scheduledEndAt - task.scheduledStartAt;
  }

  return Math.max(15, task.estimateMinutes ?? 30) * 60_000;
}

function getAllDayOccurrenceEnd(value: number) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function createRRuleFromTask(task: Task) {
  const normalized = normalizeRecurrenceRule(task.recurrenceRule);

  if (!normalized) {
    return null;
  }

  try {
    return rrulestr(`RRULE:${normalized}`, {
      dtstart: new Date(getTaskRecurrenceAnchor(task))
    }) as RRule;
  } catch {
    return null;
  }
}

export function buildPlannerRRule(input: {
  frequency: PlannerRecurrenceFrequency;
  interval?: number;
  untilAt?: number | null;
}) {
  const interval = Math.max(1, Math.floor(input.interval ?? 1));
  const chunks = [`FREQ=${SUPPORTED_FREQUENCIES[input.frequency]}`, `INTERVAL=${interval}`];

  if (input.untilAt) {
    const until = new Date(input.untilAt)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
    chunks.push(`UNTIL=${until}`);
  }

  return chunks.join(";");
}

export function isRecurringPlannerRule(rule: string | null | undefined) {
  return Boolean(normalizeRecurrenceRule(rule));
}

export interface PlannerTaskOccurrence {
  id: string;
  task: Task;
  originalStartAt: number;
  startAt: number;
  endAt: number;
  dueAt: number | null;
  scheduledStartAt: number | null;
  scheduledEndAt: number | null;
  completed: boolean;
  skipped: boolean;
  override: PlannerRecurrenceOverride | null;
}

export function getPlannerTaskOccurrenceId(taskId: string, originalStartAt: number) {
  return `${taskId}:${normalizePlannerOccurrenceMarker(originalStartAt)}`;
}

export function getPlannerTaskOccurrencesForRange(task: Task, rangeStartAt: number, rangeEndAt: number) {
  const rule = createRRuleFromTask(task);
  const duration = getTaskOccurrenceDuration(task);
  const exceptions = new Set((task.recurrenceExceptionDates ?? []).map(normalizePlannerOccurrenceMarker));
  const completed = new Set((task.recurrenceCompletedDates ?? []).map(normalizePlannerOccurrenceMarker));
  const recurrenceUntilAt = task.recurrenceUntilAt ? normalizePlannerOccurrenceMarker(task.recurrenceUntilAt) : null;
  const overrides = new Map(
    (task.recurrenceOverrides ?? []).map((override) => [
      normalizePlannerOccurrenceMarker(override.originalStartAt),
      override
    ])
  );

  if (!rule) {
    const startAt = task.scheduledStartAt ?? task.dueAt;

    if (!startAt) {
      return [];
    }

    const endAt = task.scheduledEndAt ?? (task.scheduledStartAt ? startAt + duration : getAllDayOccurrenceEnd(startAt));

    if (startAt >= rangeEndAt || endAt <= rangeStartAt) {
      return [];
    }

    return [
      {
        id: getPlannerTaskOccurrenceId(task.id, startAt),
        task,
        originalStartAt: startAt,
        startAt,
        endAt,
        dueAt: task.dueAt,
        scheduledStartAt: task.scheduledStartAt,
        scheduledEndAt: task.scheduledEndAt,
        completed: Boolean(task.completedAt),
        skipped: false,
        override: null
      }
    ] satisfies PlannerTaskOccurrence[];
  }

  const occurrenceDates = rule.between(
    new Date(rangeStartAt - duration),
    new Date(rangeEndAt + duration),
    true
  );

  return occurrenceDates
    .filter((date) => {
      if (!recurrenceUntilAt) {
        return true;
      }

      return normalizePlannerOccurrenceMarker(date.getTime()) <= recurrenceUntilAt;
    })
    .map((date) => {
      const originalStartAt = normalizePlannerOccurrenceMarker(date.getTime());
      const override = overrides.get(originalStartAt) ?? null;
      const skipped = exceptions.has(originalStartAt) || Boolean(override?.skipped);
      const startAt = override?.startAt ?? originalStartAt;
      const scheduledStartAt = override?.scheduledStartAt ?? (task.scheduledStartAt ? startAt : null);
      const scheduledEndAt = override?.scheduledEndAt ?? (scheduledStartAt ? startAt + duration : null);
      const dueAt = override?.dueAt ?? (task.dueAt ? startAt : null);
      const endAt = scheduledEndAt ?? getAllDayOccurrenceEnd(startAt);

      return {
        id: getPlannerTaskOccurrenceId(task.id, originalStartAt),
        task,
        originalStartAt,
        startAt,
        endAt,
        dueAt,
        scheduledStartAt,
        scheduledEndAt,
        completed: Boolean(task.completedAt) || completed.has(originalStartAt),
        skipped,
        override
      } satisfies PlannerTaskOccurrence;
    })
    .filter((occurrence) => occurrence.startAt < rangeEndAt && occurrence.endAt > rangeStartAt);
}

export function getNextPlannerTaskOccurrenceStart(task: Task, afterAt: number) {
  const rule = createRRuleFromTask(task);

  if (!rule) {
    return null;
  }

  const next = rule.after(new Date(afterAt), false);
  const nextAt = next ? normalizePlannerOccurrenceMarker(next.getTime()) : null;

  if (!nextAt) {
    return null;
  }

  return task.recurrenceUntilAt && nextAt > normalizePlannerOccurrenceMarker(task.recurrenceUntilAt) ? null : nextAt;
}

function getStartOfLocalDay(value = Date.now()) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function getEndOfLocalDay(value = Date.now()) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

export function getPlannerTaskPrimaryOccurrence(task: Task, fromAt = Date.now()) {
  const rangeStartAt = getStartOfLocalDay(fromAt) - 365 * 86_400_000;
  const rangeEndAt = getStartOfLocalDay(fromAt) + 730 * 86_400_000;
  const occurrences = getPlannerTaskOccurrencesForRange(task, rangeStartAt, rangeEndAt)
    .filter((occurrence) => !occurrence.skipped)
    .sort((left, right) => left.startAt - right.startAt);

  return (
    occurrences.find((occurrence) => !occurrence.completed && occurrence.endAt >= fromAt) ??
    occurrences.find((occurrence) => !occurrence.completed) ??
    occurrences[0] ??
    null
  );
}

export function getPlannerTaskOccurrenceForDay(task: Task, dayAt = Date.now()) {
  const rangeStartAt = getStartOfLocalDay(dayAt);
  const rangeEndAt = getEndOfLocalDay(dayAt);

  return (
    getPlannerTaskOccurrencesForRange(task, rangeStartAt, rangeEndAt)
      .filter((occurrence) => !occurrence.skipped && !occurrence.completed)
      .sort((left, right) => left.startAt - right.startAt)[0] ?? null
  );
}

export function getPlannerTaskOverdueOccurrence(task: Task, fromAt = Date.now()) {
  const todayStartAt = getStartOfLocalDay(fromAt);
  const rangeStartAt = todayStartAt - 365 * 86_400_000;

  return (
    getPlannerTaskOccurrencesForRange(task, rangeStartAt, todayStartAt)
      .filter((occurrence) => !occurrence.skipped && !occurrence.completed && occurrence.startAt < todayStartAt)
      .sort((left, right) => left.startAt - right.startAt)[0] ?? null
  );
}

export function getPlannerTaskUpcomingOccurrence(task: Task, fromAt = Date.now()) {
  const rangeStartAt = getEndOfLocalDay(fromAt) + 1;
  const rangeEndAt = getStartOfLocalDay(fromAt) + 730 * 86_400_000;

  return (
    getPlannerTaskOccurrencesForRange(task, rangeStartAt, rangeEndAt)
      .filter((occurrence) => !occurrence.skipped && !occurrence.completed && occurrence.startAt >= rangeStartAt)
      .sort((left, right) => left.startAt - right.startAt)[0] ?? null
  );
}

export function getPlannerTaskActionOccurrence(task: Task, fromAt = Date.now()) {
  return (
    getPlannerTaskOverdueOccurrence(task, fromAt) ??
    getPlannerTaskOccurrenceForDay(task, fromAt) ??
    getPlannerTaskUpcomingOccurrence(task, fromAt) ??
    getPlannerTaskPrimaryOccurrence(task, fromAt)
  );
}

function shiftTimestamp(value: number | null | undefined, delta: number) {
  return typeof value === "number" ? value + delta : value;
}

export function buildRescheduleRecurringSeriesPatch(
  task: Task,
  occurrenceStartAt: number,
  nextStartAt: number,
  nextEndAt: number | null,
  scope: "future" | "all",
  currentStartAt = occurrenceStartAt
) {
  const marker = normalizePlannerOccurrenceMarker(occurrenceStartAt);
  const delta = nextStartAt - currentStartAt;
  const wasTimed = Boolean(task.scheduledStartAt);
  const duration = getTaskOccurrenceDuration(task);
  const baseStartAt = task.scheduledStartAt ?? task.dueAt ?? task.recurrenceAnchorAt ?? marker;
  const baseEndAt = task.scheduledEndAt ?? (wasTimed ? baseStartAt + duration : null);
  const shiftedBaseStartAt = baseStartAt + delta;
  const normalizedStartAt =
    scope === "all"
      ? wasTimed
        ? shiftedBaseStartAt
        : getStartOfLocalDay(shiftedBaseStartAt)
      : wasTimed
        ? nextStartAt
        : getStartOfLocalDay(nextStartAt);
  const normalizedEndAt =
    wasTimed
      ? Math.max(
          normalizedStartAt + 15 * 60_000,
          scope === "all" && baseEndAt ? baseEndAt + delta : nextEndAt ?? normalizedStartAt + duration
        )
      : null;
  const shouldShiftMarker = (value: number) => scope === "all" || normalizePlannerOccurrenceMarker(value) >= marker;

  const shiftMarkedDates = (dates: number[]) =>
    Array.from(
      new Set(
        dates.map((date) => (shouldShiftMarker(date) ? normalizePlannerOccurrenceMarker(date + delta) : normalizePlannerOccurrenceMarker(date)))
      )
    );

  const shiftOverrides = (task.recurrenceOverrides ?? []).map((override) => {
    if (!shouldShiftMarker(override.originalStartAt)) {
      return override;
    }

    return {
      ...override,
      originalStartAt: normalizePlannerOccurrenceMarker(override.originalStartAt + delta),
      startAt: shiftTimestamp(override.startAt, delta) ?? override.startAt,
      dueAt: (shiftTimestamp(override.dueAt, delta) as number | null) ?? null,
      scheduledStartAt: (shiftTimestamp(override.scheduledStartAt, delta) as number | null) ?? null,
      scheduledEndAt: (shiftTimestamp(override.scheduledEndAt, delta) as number | null) ?? null,
      updatedAt: Date.now()
    };
  });

  return {
    dueAt: wasTimed ? null : normalizedStartAt,
    scheduledStartAt: wasTimed ? normalizedStartAt : null,
    scheduledEndAt: wasTimed ? normalizedEndAt : null,
    recurrenceAnchorAt: normalizedStartAt,
    recurrenceUntilAt: task.recurrenceUntilAt ? task.recurrenceUntilAt + delta : null,
    recurrenceExceptionDates: shiftMarkedDates(task.recurrenceExceptionDates ?? []),
    recurrenceCompletedDates: shiftMarkedDates(task.recurrenceCompletedDates ?? []),
    recurrenceOverrides: shiftOverrides,
    estimateMinutes: wasTimed && normalizedEndAt ? Math.max(15, Math.round((normalizedEndAt - normalizedStartAt) / 60_000)) : null,
    status: task.status === "inbox" ? (wasTimed ? "scheduled" : "todo") : task.status
  } satisfies Partial<Task>;
}

export function buildRecurringTaskPatch(
  task: Task,
  action: PlannerRecurringTaskAction,
  occurrenceStartAt: number,
  now = Date.now()
): Partial<Task> {
  const marker = normalizePlannerOccurrenceMarker(occurrenceStartAt);
  const nextStartAt = getNextPlannerTaskOccurrenceStart(task, marker + 1000);

  if (action === "completeAllFuture") {
    return {
      status: "done",
      completedAt: now,
      recurrenceUntilAt: marker
    };
  }

  if (action === "skipOccurrence") {
    return {
      recurrenceExceptionDates: Array.from(new Set([...(task.recurrenceExceptionDates ?? []), marker]))
    };
  }

  return {
    recurrenceCompletedDates: Array.from(new Set([...(task.recurrenceCompletedDates ?? []), marker])),
    status: nextStartAt ? task.status : "done",
    completedAt: nextStartAt ? task.completedAt : now
  };
}

export function buildUncompleteRecurringOccurrencePatch(task: Task, occurrenceStartAt: number) {
  const marker = normalizePlannerOccurrenceMarker(occurrenceStartAt);
  const nextStatus =
    task.status === "done"
      ? task.scheduledStartAt
        ? "scheduled"
        : task.dueAt || task.recurrenceRule
          ? "todo"
          : "inbox"
      : task.status;

  return {
    recurrenceCompletedDates: (task.recurrenceCompletedDates ?? []).filter(
      (date) => normalizePlannerOccurrenceMarker(date) !== marker
    ),
    completedAt: null,
    status: nextStatus
  } satisfies Partial<Task>;
}

export function buildRescheduleOccurrencePatch(
  task: Task,
  occurrenceStartAt: number,
  nextStartAt: number,
  nextEndAt?: number | null
) {
  const marker = normalizePlannerOccurrenceMarker(occurrenceStartAt);
  const duration = getTaskOccurrenceDuration(task);
  const isTimedOverride = typeof nextEndAt === "number";
  const timestamp = Date.now();
  const previousOverrides = task.recurrenceOverrides ?? [];
  const nextOverride: PlannerRecurrenceOverride = {
    id: crypto.randomUUID(),
    originalStartAt: marker,
    startAt: nextStartAt,
    dueAt: isTimedOverride ? null : getStartOfLocalDay(nextStartAt),
    scheduledStartAt: isTimedOverride ? nextStartAt : null,
    scheduledEndAt: isTimedOverride ? Math.max(nextStartAt + 15 * 60_000, nextEndAt ?? nextStartAt + duration) : null,
    skipped: false,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  return {
    recurrenceOverrides: [
      ...previousOverrides.filter((override) => normalizePlannerOccurrenceMarker(override.originalStartAt) !== marker),
      nextOverride
    ]
  } satisfies Partial<Task>;
}
