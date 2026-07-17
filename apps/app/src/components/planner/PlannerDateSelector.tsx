import { translateApp, translateInline } from "../../localization/translateInline";
import { formatDateValue, formatPlannerDate, getCurrentLocaleRuntime } from "../../localization";
import { useMemo, useState } from "react";

import type { AppLanguage } from "../../types";
import {
  DEFAULT_PLANNER_END_TIME_MINUTES,
  DEFAULT_PLANNER_START_TIME_MINUTES,
  normalizePlannerTaskDateDraft,
  type PlannerTaskDateDraft,
  type PlannerTaskDateRepeat
} from "../../lib/plannerTaskSchedule";
import { getEndOfLocalDay, getStartOfLocalDay } from "../../lib/planner";
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
  void language;
  return formatDateValue(value, getCurrentLocaleRuntime(), {
    month: "long",
    year: "numeric"
  });
}

function getWeekdayLabels(language: AppLanguage) {
  void language;
  const base = new Date(2024, 0, 1).getTime();
  return Array.from({ length: 7 }, (_item, index) =>
    formatDateValue(addDays(base, index), getCurrentLocaleRuntime(), { weekday: "short" })
  );
}

function getRepeatLabel(repeat: PlannerTaskDateRepeat, language: AppLanguage) {
  return translateApp(language, `plannerCore.repeats.${repeat}`);
}

function getQuickDateOptions(language: AppLanguage) {
  const today = getStartOfLocalDay();

  return [
    {
      id: "today",
      label: translateInline(language, "plannerDateSelector.today"),
      value: today
    },
    {
      id: "tomorrow",
      label: translateInline(language, "plannerDateSelector.tomorrow"),
      value: addDays(today, 1)
    },
    {
      id: "weekend",
      label: translateInline(language, "plannerDateSelector.weekend"),
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
          <span className="planner-date-selector-kicker">{translateInline(language, "plannerDateSelector.date")}</span>
          <strong>
            {draft.startDateAt
              ? draft.endDateAt
                ? `${formatPlannerDate(draft.startDateAt, language)} - ${formatPlannerDate(draft.endDateAt, language)}`
                : formatPlannerDate(draft.startDateAt, language)
              : translateInline(language, "plannerDateSelector.noDate")}
          </strong>
        </div>
        <button type="button" onClick={onCancel} aria-label={translateInline(language, "plannerDateSelector.close")}>
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
          {translateInline(language, "plannerDateSelector.noDate2")}
        </button>
      </div>

      <div className="planner-date-selector-calendar">
        <div className="planner-date-selector-monthbar">
          <button type="button" onClick={() => setCursorAt((current) => addMonths(current, -1))} aria-label={translateInline(language, "plannerDateSelector.previousMonth")}>
            ‹
          </button>
          <strong>{getMonthTitle(cursorAt, language)}</strong>
          <button type="button" onClick={() => setCursorAt((current) => addMonths(current, 1))} aria-label={translateInline(language, "plannerDateSelector.nextMonth")}>
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
          <span>{translateInline(language, "plannerDateSelector.range")}</span>
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
          <span>{translateInline(language, "plannerDateSelector.time")}</span>
        </button>
      </div>

      {draft.hasTime ? (
        <div className="planner-date-selector-time-block">
          <div className="planner-date-selector-time">
            <label>
              <span>{translateInline(language, "plannerDateSelector.starts")}</span>
              <PlannerTimeField
                valueMinutes={draft.startTimeMinutes}
                language={language}
                ariaLabel={translateInline(language, "plannerDateSelector.startTime")}
                minMinutes={0}
                maxMinutes={MAX_START_TIME_MINUTES}
                onChange={updateStartTime}
              />
            </label>
            <label>
              <span>{translateInline(language, "plannerDateSelector.ends")}</span>
              <PlannerTimeField
                valueMinutes={draft.endTimeMinutes}
                language={language}
                ariaLabel={translateInline(language, "plannerDateSelector.endTime")}
                minMinutes={Math.min(MAX_TIME_MINUTES, draft.startTimeMinutes + MIN_TIME_DURATION_MINUTES)}
                maxMinutes={MAX_TIME_MINUTES}
                onChange={updateEndTime}
              />
            </label>
          </div>
        </div>
      ) : null}

      <div className="planner-date-selector-repeat">
        <span>{translateInline(language, "plannerDateSelector.repeat")}</span>
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
          <span>{translateInline(language, "plannerDateSelector.interval")}</span>
          <div>
            <button
              type="button"
              onClick={() => updateDraft({ repeatIntervalDays: shiftRepeatIntervalDays(draft.repeatIntervalDays, -1) })}
              aria-label={translateInline(language, "plannerDateSelector.decreaseInterval")}
            >
              −
            </button>
            <strong>
              {translateInline(language, "plannerDateSelector.everyDays", { value0: draft.repeatIntervalDays })}
            </strong>
            <button
              type="button"
              onClick={() => updateDraft({ repeatIntervalDays: shiftRepeatIntervalDays(draft.repeatIntervalDays, 1) })}
              aria-label={translateInline(language, "plannerDateSelector.increaseInterval")}
            >
              +
            </button>
          </div>
        </div>
      ) : null}

      {draft.repeat !== "none" ? (
        <p className="planner-date-selector-note">
          {translateApp(
            language,
            draft.endDateAt ? "plannerCore.repeatRangeLimited" : "plannerCore.repeatRangeHint"
          )}
        </p>
      ) : null}

      <footer className="planner-date-selector-actions">
        <button type="button" onClick={onCancel}>
          {translateInline(language, "plannerDateSelector.cancel")}
        </button>
        <button type="button" className="is-primary" onClick={apply}>
          {translateInline(language, "plannerDateSelector.apply")}
        </button>
      </footer>
    </section>
  );
}
