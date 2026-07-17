import { translateInline } from "../localization/translateInline";
import { formatPlannerDateTime } from "../localization/plannerPresentation";
import type { AppLanguage, Reminder, Task } from "../types";
import { isPlannerTaskActive } from "./planner";

const REMINDER_HORIZON_MS = 30 * 24 * 60 * 60 * 1000;
const BROWSER_TIMER_HORIZON_MS = 24 * 24 * 60 * 60 * 1000;
const browserReminderTimers = new Map<number, number>();
const nativeScheduledReminderIds = new Set<number>();

interface PlannerReminderScheduleItem {
  id: number;
  taskId: string;
  reminderId: string;
  title: string;
  body: string;
  remindAt: number;
}

function hashReminderId(taskId: string, reminderId: string, remindAt: number) {
  const input = `${taskId}:${reminderId}:${Math.round(remindAt / 60_000)}`;
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash >>> 0);
}

function getReminderFireTime(task: Task, reminder: Reminder) {
  if (!reminder.enabled) {
    return null;
  }

  if (reminder.remindAt) {
    return reminder.remindAt;
  }

  const baseAt = task.scheduledStartAt ?? task.dueAt;

  if (!baseAt || reminder.offsetMinutes === null || reminder.offsetMinutes === undefined) {
    return null;
  }

  return baseAt - Math.max(0, reminder.offsetMinutes) * 60_000;
}

function getScheduleItems(tasks: Task[], language: AppLanguage, now = Date.now()) {
  const items: PlannerReminderScheduleItem[] = [];

  tasks.forEach((task) => {
    if (!isPlannerTaskActive(task)) {
      return;
    }

    (task.reminders ?? []).forEach((reminder) => {
      const remindAt = getReminderFireTime(task, reminder);

      if (!remindAt || remindAt < now - 60_000 || remindAt > now + REMINDER_HORIZON_MS) {
        return;
      }

      items.push({
        id: hashReminderId(task.id, reminder.id, remindAt),
        taskId: task.id,
        reminderId: reminder.id,
        title: reminder.title || (translateInline(language, "plannerReminders.locorisReminder")),
        body: `${task.title} · ${formatPlannerDateTime(remindAt, language)}`,
        remindAt
      });
    });
  });

  return items;
}

function clearBrowserTimersExcept(activeIds: Set<number>) {
  browserReminderTimers.forEach((timerId, id) => {
    if (activeIds.has(id)) {
      return;
    }

    window.clearTimeout(timerId);
    browserReminderTimers.delete(id);
  });
}

async function syncNativeNotifications(items: PlannerReminderScheduleItem[]) {
  try {
    const notification = await import("@tauri-apps/plugin-notification");
    let permissionGranted = await notification.isPermissionGranted();

    if (!permissionGranted) {
      permissionGranted = (await notification.requestPermission()) === "granted";
    }

    if (!permissionGranted) {
      return false;
    }

    await notification
      .createChannel({
        id: "locoris-planner",
        name: "Locoris Planner",
        description: "Task reminders",
        importance: notification.Importance.Default,
        visibility: notification.Visibility.Private
      })
      .catch(() => undefined);

    const desiredIds = new Set(items.map((item) => item.id));
    const staleIds = [...nativeScheduledReminderIds].filter((id) => !desiredIds.has(id));

    if (staleIds.length > 0) {
      await notification.cancel(staleIds).catch(() => undefined);
      staleIds.forEach((id) => nativeScheduledReminderIds.delete(id));
    }

    items.forEach((item) => {
      if (nativeScheduledReminderIds.has(item.id)) {
        return;
      }

      notification.sendNotification({
        id: item.id,
        channelId: "locoris-planner",
        title: item.title,
        body: item.body,
        schedule: notification.Schedule.at(new Date(item.remindAt)),
        group: "locoris-planner",
        autoCancel: true,
        extra: {
          kind: "plannerReminder",
          taskId: item.taskId,
          reminderId: item.reminderId
        }
      });
      nativeScheduledReminderIds.add(item.id);
    });

    return true;
  } catch {
    return false;
  }
}

function syncBrowserNotifications(items: PlannerReminderScheduleItem[]) {
  if (!("Notification" in window)) {
    return;
  }

  const desiredIds = new Set(items.map((item) => item.id));
  clearBrowserTimersExcept(desiredIds);

  if (window.Notification.permission === "default") {
    void window.Notification.requestPermission();
  }

  if (window.Notification.permission !== "granted") {
    return;
  }

  items.forEach((item) => {
    if (browserReminderTimers.has(item.id)) {
      return;
    }

    const delay = item.remindAt - Date.now();

    if (delay < 0 || delay > BROWSER_TIMER_HORIZON_MS) {
      return;
    }

    const timerId = window.setTimeout(() => {
      browserReminderTimers.delete(item.id);
      new window.Notification(item.title, {
        body: item.body,
        tag: `locoris-planner-${item.id}`
      });
    }, delay);
    browserReminderTimers.set(item.id, timerId);
  });
}

export async function syncPlannerReminderNotifications(tasks: Task[], language: AppLanguage) {
  const items = getScheduleItems(tasks, language);

  if (items.length === 0) {
    clearBrowserTimersExcept(new Set());

    if (nativeScheduledReminderIds.size > 0) {
      try {
        const notification = await import("@tauri-apps/plugin-notification");
        await notification.cancel([...nativeScheduledReminderIds]).catch(() => undefined);
      } catch {
        // Web and restricted runtimes fall back to browser timers only.
      }
      nativeScheduledReminderIds.clear();
    }

    return;
  }

  const nativeHandled = await syncNativeNotifications(items);

  if (!nativeHandled) {
    syncBrowserNotifications(items);
  } else {
    clearBrowserTimersExcept(new Set());
  }
}
