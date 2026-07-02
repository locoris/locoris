import { useMemo, useState } from "react";

import type { AppLanguage } from "../../types";
import {
  DEFAULT_PLANNER_END_TIME_MINUTES,
  DEFAULT_PLANNER_START_TIME_MINUTES,
  normalizePlannerTaskDateDraft,
  type PlannerTaskDateDraft,
  type PlannerTaskDateRepeat
} from "../../lib/plannerTaskSchedule";
import { formatPlannerDate, getEndOfLocalDay, getStartOfLocalDay } from "../../lib/planner";
import PlannerTimeField from "./PlannerTimeField";
import "./PlannerDateSelector.css";

interface PlannerDateSelectorProps {
  value: PlannerTaskDateDraft;
  language: AppLanguage;
  isMobile?: boolean;
  onApply: (value: PlannerTaskDateDraft) => void;
  onCancel: () => void;
}

interface PlannerCalendarDay {
  key: string;
  startAt: number;
  label: string;
  isCurrentMonth: boolean;
  isToday: boolean;
}

const REPEAT_OPTIONS: PlannerTaskDateRepeat[] = ["none", "daily", "weekly", "monthly", "customDaily"];
const MIN_TIME_DURATION_MINUTES = 15;
const MAX_TIME_MINUTES = 23 * 60 + 59;
const MAX_START_TIME_MINUTES = MAX_TIME_MINUTES - MIN_TIME_DURATION_MINUTES;

function addDays(value: number, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function addMonths(value: number, months: number) {
  const date = new Date(value);
  date.setMonth(date.getMonth() + months);
  return date.getTime();
}

function getStartOfMonthGrid(value: number) {
  const date = new Date(value);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + mondayOffset);
  return date.getTime();
}

function getCalendarDays(cursorAt: number): PlannerCalendarDay[] {
  const month = new Date(cursorAt).getMonth();
  const today = getStartOfLocalDay();
  const startAt = getStartOfMonthGrid(cursorAt);

  return Array.from({ length: 42 }, (_item, index) => {
    const dayStartAt = addDays(startAt, index);
    const date = new Date(dayStartAt);

    return {
      key: String(dayStartAt),
      startAt: dayStartAt,
      label: String(date.getDate()),
      isCurrentMonth: date.getMonth() === month,
      isToday: dayStartAt === today
    };
  });
}

function getMonthTitle(value: number, language: AppLanguage) {
  return new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", {
    month: "long",
    year: "numeric"
  }).format(value);
}

function getWeekdayLabels(language: AppLanguage) {
  const base = new Date(2024, 0, 1).getTime();
  return Array.from({ length: 7 }, (_item, index) =>
    new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", { weekday: "short" }).format(addDays(base, index))
  );
}

function getRepeatLabel(repeat: PlannerTaskDateRepeat, language: AppLanguage) {
  if (language === "ru") {
    return {
      none: "Не повторять",
      daily: "Каждый день",
      weekly: "Каждую неделю",
      monthly: "Каждый месяц",
      yearly: "Каждый год",
      customDaily: "Каждые N дней"
    }[repeat];
  }

  return {
    none: "No repeat",
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
    yearly: "Yearly",
    customDaily: "Every N days"
  }[repeat];
}

function getQuickDateOptions(language: AppLanguage) {
  const today = getStartOfLocalDay();

  return [
    {
      id: "today",
      label: language === "ru" ? "Сегодня" : "Today",
      value: today
    },
    {
      id: "tomorrow",
      label: language === "ru" ? "Завтра" : "Tomorrow",
      value: addDays(today, 1)
    },
    {
      id: "weekend",
      label: language === "ru" ? "Выходные" : "Weekend",
      value: addDays(today, (6 - new Date(today).getDay() + 7) % 7 || 6)
    }
  ];
}

function clampTimeInputMinutes(value: number, max = MAX_TIME_MINUTES) {
  return Math.max(0, Math.min(max, Math.round(value)));
}

function shiftRepeatIntervalDays(value: number, direction: -1 | 1) {
  return Math.max(2, Math.min(365, Math.round(value || 2) + direction));
}

export default function PlannerDateSelector({
  value,
  language,
  isMobile = false,
  onApply,
  onCancel
}: PlannerDateSelectorProps) {
  const [draft, setDraft] = useState(() => normalizePlannerTaskDateDraft(value));
  const [cursorAt, setCursorAt] = useState(value.startDateAt ?? getStartOfLocalDay());
  const [rangeMode, setRangeMode] = useState(Boolean(value.endDateAt));
  const days = useMemo(() => getCalendarDays(cursorAt), [cursorAt]);
  const weekdays = useMemo(() => getWeekdayLabels(language), [language]);
  const quickDates = useMemo(() => getQuickDateOptions(language), [language]);
  const selectedStart = draft.startDateAt ? getStartOfLocalDay(draft.startDateAt) : null;
  const selectedEnd = draft.endDateAt ? getStartOfLocalDay(draft.endDateAt) : null;

  const updateDraft = (patch: Partial<PlannerTaskDateDraft>) => {
    setDraft((current) => normalizePlannerTaskDateDraft({ ...current, ...patch }));
  };

  const updateStartTime = (minutes: number) => {
    const nextStartTimeMinutes = clampTimeInputMinutes(minutes, MAX_START_TIME_MINUTES);
    const currentDuration = Math.max(MIN_TIME_DURATION_MINUTES, draft.endTimeMinutes - draft.startTimeMinutes);
    const nextEndTimeMinutes = Math.min(MAX_TIME_MINUTES, Math.max(nextStartTimeMinutes + MIN_TIME_DURATION_MINUTES, nextStartTimeMinutes + currentDuration));

    updateDraft({
      startTimeMinutes: nextStartTimeMinutes,
      endTimeMinutes: nextEndTimeMinutes
    });
  };

  const updateEndTime = (minutes: number) => {
    updateDraft({
      endTimeMinutes: Math.max(draft.startTimeMinutes + MIN_TIME_DURATION_MINUTES, clampTimeInputMinutes(minutes))
    });
  };

  const selectDay = (dayAt: number) => {
    const normalizedDayAt = getStartOfLocalDay(dayAt);

    if (!rangeMode) {
      updateDraft({
        startDateAt: normalizedDayAt,
        endDateAt: null,
        repeatUntilAt: draft.repeat === "none" ? null : draft.repeatUntilAt
      });
      return;
    }

    if (!draft.startDateAt || draft.endDateAt || normalizedDayAt < draft.startDateAt) {
      updateDraft({
        startDateAt: normalizedDayAt,
        endDateAt: null,
        repeatUntilAt: draft.repeat === "none" ? null : getEndOfLocalDay(normalizedDayAt)
      });
      return;
    }

    updateDraft({
      endDateAt: normalizedDayAt,
      repeatUntilAt: draft.repeat === "none" ? null : getEndOfLocalDay(normalizedDayAt)
    });
  };

  const clearDate = () => {
    updateDraft({
      startDateAt: null,
      endDateAt: null,
      hasTime: false,
      repeat: "none",
      repeatUntilAt: null
    });
  };

  const apply = () => {
    onApply(normalizePlannerTaskDateDraft(draft));
  };

  return (
    <section className={`planner-date-selector ${isMobile ? "is-mobile" : "is-desktop"}`}>
      <header className="planner-date-selector-head">
        <div>
          <span className="planner-date-selector-kicker">{language === "ru" ? "Дата" : "Date"}</span>
          <strong>
            {draft.startDateAt
              ? draft.endDateAt
                ? `${formatPlannerDate(draft.startDateAt, language)} - ${formatPlannerDate(draft.endDateAt, language)}`
                : formatPlannerDate(draft.startDateAt, language)
              : language === "ru"
                ? "Без даты"
                : "No date"}
          </strong>
        </div>
        <button type="button" onClick={onCancel} aria-label={language === "ru" ? "Закрыть" : "Close"}>
          ×
        </button>
      </header>

      <div className="planner-date-selector-quick">
        {quickDates.map((option) => (
          <button
            key={option.id}
            type="button"
            className={selectedStart === option.value ? "is-active" : ""}
            onClick={() => {
              setCursorAt(option.value);
              updateDraft({ startDateAt: option.value, endDateAt: null });
            }}
          >
            {option.label}
          </button>
        ))}
        <button type="button" className={!draft.startDateAt ? "is-active" : ""} onClick={clearDate}>
          {language === "ru" ? "Без даты" : "No date"}
        </button>
      </div>

      <div className="planner-date-selector-calendar">
        <div className="planner-date-selector-monthbar">
          <button type="button" onClick={() => setCursorAt((current) => addMonths(current, -1))} aria-label={language === "ru" ? "Предыдущий месяц" : "Previous month"}>
            ‹
          </button>
          <strong>{getMonthTitle(cursorAt, language)}</strong>
          <button type="button" onClick={() => setCursorAt((current) => addMonths(current, 1))} aria-label={language === "ru" ? "Следующий месяц" : "Next month"}>
            ›
          </button>
        </div>
        <div className="planner-date-selector-weekdays">
          {weekdays.map((weekday) => (
            <span key={weekday}>{weekday}</span>
          ))}
        </div>
        <div className="planner-date-selector-days">
          {days.map((day) => {
            const isSelectedStart = selectedStart === day.startAt;
            const isSelectedEnd = selectedEnd === day.startAt;
            const isInsideRange =
              selectedStart !== null &&
              selectedEnd !== null &&
              day.startAt > selectedStart &&
              day.startAt < selectedEnd;

            return (
              <button
                key={day.key}
                type="button"
                className={`${day.isCurrentMonth ? "" : "is-muted"} ${day.isToday ? "is-today" : ""} ${
                  isSelectedStart ? "is-selected-start" : ""
                } ${isSelectedEnd ? "is-selected-end" : ""} ${isInsideRange ? "is-in-range" : ""}`}
                onClick={() => selectDay(day.startAt)}
              >
                {day.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="planner-date-selector-options">
        <button
          type="button"
          className={rangeMode ? "is-active" : ""}
          onClick={() => {
            setRangeMode((current) => !current);
            if (rangeMode) {
              updateDraft({ endDateAt: null, repeatUntilAt: draft.repeat === "none" ? null : draft.repeatUntilAt });
            }
          }}
        >
          <span className="planner-date-option-icon is-range" aria-hidden="true" />
          <span>{language === "ru" ? "Диапазон" : "Range"}</span>
        </button>
        <button
          type="button"
          className={draft.hasTime ? "is-active" : ""}
          onClick={() =>
            updateDraft({
              hasTime: !draft.hasTime,
              startTimeMinutes: draft.startTimeMinutes || DEFAULT_PLANNER_START_TIME_MINUTES,
              endTimeMinutes: draft.endTimeMinutes || DEFAULT_PLANNER_END_TIME_MINUTES
            })
          }
        >
          <span className="planner-date-option-icon is-time" aria-hidden="true" />
          <span>{language === "ru" ? "Время" : "Time"}</span>
        </button>
      </div>

      {draft.hasTime ? (
        <div className="planner-date-selector-time-block">
          <div className="planner-date-selector-time">
            <label>
              <span>{language === "ru" ? "Начало" : "Starts"}</span>
              <PlannerTimeField
                valueMinutes={draft.startTimeMinutes}
                language={language}
                ariaLabel={language === "ru" ? "Время начала" : "Start time"}
                minMinutes={0}
                maxMinutes={MAX_START_TIME_MINUTES}
                onChange={updateStartTime}
              />
            </label>
            <label>
              <span>{language === "ru" ? "Конец" : "Ends"}</span>
              <PlannerTimeField
                valueMinutes={draft.endTimeMinutes}
                language={language}
                ariaLabel={language === "ru" ? "Время окончания" : "End time"}
                minMinutes={Math.min(MAX_TIME_MINUTES, draft.startTimeMinutes + MIN_TIME_DURATION_MINUTES)}
                maxMinutes={MAX_TIME_MINUTES}
                onChange={updateEndTime}
              />
            </label>
          </div>
        </div>
      ) : null}

      <div className="planner-date-selector-repeat">
        <span>{language === "ru" ? "Повтор" : "Repeat"}</span>
        <div>
          {REPEAT_OPTIONS.map((repeat) => (
            <button
              key={repeat}
              type="button"
              className={draft.repeat === repeat ? "is-active" : ""}
              onClick={() =>
                updateDraft({
                  repeat,
                  repeatIntervalDays: repeat === "customDaily" ? draft.repeatIntervalDays || 2 : draft.repeatIntervalDays,
                  repeatUntilAt: repeat === "none" ? null : draft.endDateAt ? getEndOfLocalDay(draft.endDateAt) : draft.repeatUntilAt
                })
              }
            >
              {getRepeatLabel(repeat, language)}
            </button>
          ))}
        </div>
      </div>

      {draft.repeat === "customDaily" ? (
        <div className="planner-date-selector-custom-repeat">
          <span>{language === "ru" ? "Интервал" : "Interval"}</span>
          <div>
            <button
              type="button"
              onClick={() => updateDraft({ repeatIntervalDays: shiftRepeatIntervalDays(draft.repeatIntervalDays, -1) })}
              aria-label={language === "ru" ? "Уменьшить интервал" : "Decrease interval"}
            >
              −
            </button>
            <strong>
              {language === "ru"
                ? `Каждые ${draft.repeatIntervalDays} дн.`
                : `Every ${draft.repeatIntervalDays} days`}
            </strong>
            <button
              type="button"
              onClick={() => updateDraft({ repeatIntervalDays: shiftRepeatIntervalDays(draft.repeatIntervalDays, 1) })}
              aria-label={language === "ru" ? "Увеличить интервал" : "Increase interval"}
            >
              +
            </button>
          </div>
        </div>
      ) : null}

      {draft.repeat !== "none" ? (
        <p className="planner-date-selector-note">
          {language === "ru"
            ? draft.endDateAt
              ? "Повтор будет ограничен выбранным диапазоном."
              : "Выбери диапазон, если повтор должен закончиться в конкретную дату."
            : draft.endDateAt
              ? "Repeat is limited by the selected range."
              : "Choose a range if the repeat should end on a specific date."}
        </p>
      ) : null}

      <footer className="planner-date-selector-actions">
        <button type="button" onClick={onCancel}>
          {language === "ru" ? "Отмена" : "Cancel"}
        </button>
        <button type="button" className="is-primary" onClick={apply}>
          {language === "ru" ? "Применить" : "Apply"}
        </button>
      </footer>
    </section>
  );
}
