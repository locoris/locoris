import { translateInline } from "../../localization/translateInline";
import { useEffect, useRef, useState } from "react";

import { isCommitEnterKey } from "../../lib/keyboardInput";
import type { AppLanguage } from "../../types";
import "./PlannerTimeField.css";

const DEFAULT_MAX_MINUTES = 23 * 60 + 59;

interface PlannerTimeFieldProps {
  valueMinutes: number;
  language: AppLanguage;
  ariaLabel: string;
  minMinutes?: number;
  maxMinutes?: number;
  className?: string;
  onChange: (minutes: number) => void;
}

function clampMinutes(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function formatPlannerTimeFieldMinutes(minutes: number) {
  const normalizedMinutes = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(normalizedMinutes / 60);
  const mins = normalizedMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function parsePlannerTimeFieldValue(value: string) {
  const normalized = value.trim().replace(/[.,;]/g, ":").replace(/\s+/g, "");

  if (!normalized) {
    return null;
  }

  let hours: number;
  let minutes: number;

  if (normalized.includes(":")) {
    const [rawHours, rawMinutes = "0"] = normalized.split(":");
    hours = Number(rawHours || "0");
    minutes = Number(rawMinutes || "0");
  } else {
    const digits = normalized.replace(/\D/g, "");

    if (!digits) {
      return null;
    }

    if (digits.length <= 2) {
      hours = Number(digits);
      minutes = 0;
    } else {
      const paddedDigits = digits.padStart(4, "0");
      hours = Number(paddedDigits.slice(0, -2));
      minutes = Number(paddedDigits.slice(-2));
    }
  }

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  if (minutes < 0 || minutes > 59) {
    return null;
  }

  return Math.round(hours * 60 + minutes);
}

export default function PlannerTimeField({
  valueMinutes,
  language,
  ariaLabel,
  minMinutes = 0,
  maxMinutes = DEFAULT_MAX_MINUTES,
  className = "",
  onChange
}: PlannerTimeFieldProps) {
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(() => formatPlannerTimeFieldMinutes(clampMinutes(valueMinutes, minMinutes, maxMinutes)));
  const isEditingRef = useRef(false);
  const normalizedValueMinutes = clampMinutes(valueMinutes, minMinutes, maxMinutes);
  const nativeValue = formatPlannerTimeFieldMinutes(normalizedValueMinutes);

  useEffect(() => {
    if (!isEditingRef.current) {
      setDraft(formatPlannerTimeFieldMinutes(normalizedValueMinutes));
    }
  }, [normalizedValueMinutes]);

  const commitDraft = () => {
    const parsedMinutes = parsePlannerTimeFieldValue(draft);

    if (parsedMinutes === null) {
      setDraft(formatPlannerTimeFieldMinutes(normalizedValueMinutes));
      return;
    }

    const nextMinutes = clampMinutes(parsedMinutes, minMinutes, maxMinutes);
    setDraft(formatPlannerTimeFieldMinutes(nextMinutes));
    onChange(nextMinutes);
  };

  const chooseMinutes = (minutes: number) => {
    const nextMinutes = clampMinutes(Math.round(minutes), minMinutes, maxMinutes);
    setDraft(formatPlannerTimeFieldMinutes(nextMinutes));
    onChange(nextMinutes);
  };

  return (
    <div className={`planner-time-field ${className}`}>
      <div className="planner-time-field-control">
        <input
          ref={textInputRef}
          className="planner-time-field-input"
          type="text"
          inputMode="numeric"
          pattern="[0-9:., ]*"
          value={draft}
          aria-label={ariaLabel}
          placeholder="09:00"
          onFocus={(event) => {
            isEditingRef.current = true;
            event.currentTarget.select();
          }}
          onBlur={() => {
            isEditingRef.current = false;
            commitDraft();
          }}
          onChange={(event) => setDraft(event.target.value.replace(/[^\d:.,\s]/g, ""))}
          onKeyDown={(event) => {
            if (isCommitEnterKey(event)) {
              event.preventDefault();
              commitDraft();
              event.currentTarget.blur();
            }

            if (event.key === "Escape") {
              event.preventDefault();
              setDraft(formatPlannerTimeFieldMinutes(normalizedValueMinutes));
              event.currentTarget.blur();
            }
          }}
        />
        <label
          className="planner-time-field-toggle"
          aria-label={translateInline(language, "plannerTimeField.pickTime")}
          title={translateInline(language, "plannerTimeField.openSystemTimePicker")}
          onMouseDown={() => {
            if (document.activeElement === textInputRef.current) {
              commitDraft();
            }
          }}
        >
          <span aria-hidden="true" />
          <input
            className="planner-time-field-native"
            type="time"
            step={60}
            min={formatPlannerTimeFieldMinutes(minMinutes)}
            max={formatPlannerTimeFieldMinutes(maxMinutes)}
            value={nativeValue}
            aria-label={translateInline(language, "plannerTimeField.systemTimePicker")}
            onChange={(event) => {
              const parsedMinutes = parsePlannerTimeFieldValue(event.currentTarget.value);

              if (parsedMinutes !== null) {
                chooseMinutes(parsedMinutes);
              }
            }}
          />
        </label>
      </div>
    </div>
  );
}
