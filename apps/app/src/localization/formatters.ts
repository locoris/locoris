import type {
  ClientLocalePreferences,
  WeekdayNumber
} from "./localePreferences";
import {
  readLocalePreferences,
  resolveFormatLocale,
  resolveInterfaceLocale
} from "./localePreferences";

export type LocaleRuntime = {
  interfaceLocale: string;
  formatLocale: string;
  weekStartsOn: WeekdayNumber;
  hourCycle: "h12" | "h23";
};

export const COMMON_FORMAT_LOCALES = [
  "en-US", "en-GB", "de-DE", "fr-FR", "es-ES", "it-IT", "pt-BR", "ru-RU",
  "uk-UA", "pl-PL", "tr-TR", "ja-JP", "ko-KR", "zh-CN", "zh-TW", "ar-SA", "hi-IN"
] as const;

const REGION_SUNDAY_START = new Set([
  "AG", "AS", "BD", "BR", "BS", "BT", "BW", "BZ", "CA", "CN", "CO", "DM", "DO",
  "ET", "GT", "GU", "HK", "HN", "ID", "IL", "IN", "JM", "JP", "KE", "KH", "KR",
  "LA", "MH", "MM", "MO", "MT", "MX", "MZ", "NI", "NP", "PA", "PE", "PH", "PK",
  "PR", "PY", "SA", "SG", "SV", "TH", "TT", "TW", "UM", "US", "VE", "VI", "WS",
  "YE", "ZA", "ZW"
]);
const REGION_SATURDAY_START = new Set(["AE", "AF", "BH", "DJ", "DZ", "EG", "IQ", "IR", "JO", "KW", "LY", "OM", "QA", "SD", "SY"]);

function resolveRegion(locale: string) {
  try {
    const maximized = new Intl.Locale(locale).maximize();
    return maximized.region ?? "";
  } catch {
    return "";
  }
}

function resolveRegionalWeekStart(locale: string): WeekdayNumber {
  try {
    const localeWithWeekInfo = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const weekInfo = localeWithWeekInfo.getWeekInfo?.() ?? localeWithWeekInfo.weekInfo;

    if (weekInfo && weekInfo.firstDay >= 1 && weekInfo.firstDay <= 7) {
      return weekInfo.firstDay as WeekdayNumber;
    }
  } catch {
    // Use the compact CLDR-derived fallback below for older WebViews.
  }

  const region = resolveRegion(locale);

  if (REGION_SATURDAY_START.has(region)) {
    return 6;
  }

  return REGION_SUNDAY_START.has(region) ? 7 : 1;
}

function resolveRegionalHourCycle(locale: string): "h12" | "h23" {
  try {
    const hourCycle = new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hourCycle;
    return hourCycle === "h11" || hourCycle === "h12" ? "h12" : "h23";
  } catch {
    return "h23";
  }
}

export function createLocaleRuntime(preferences: ClientLocalePreferences): LocaleRuntime {
  const formatLocale = resolveFormatLocale(preferences);
  return {
    interfaceLocale: resolveInterfaceLocale(preferences),
    formatLocale,
    weekStartsOn:
      preferences.weekStartsOn === "region"
        ? resolveRegionalWeekStart(formatLocale)
        : preferences.weekStartsOn,
    hourCycle:
      preferences.hourCycle === "region"
        ? resolveRegionalHourCycle(formatLocale)
        : preferences.hourCycle
  };
}

export function getCurrentLocaleRuntime() {
  return createLocaleRuntime(readLocalePreferences());
}

export function getResolvedTimeZone(fallback: string | null = null) {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || fallback;
  } catch {
    return fallback;
  }
}

function withHourCycle(
  runtime: LocaleRuntime,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormatOptions {
  return {
    ...options,
    hour12: runtime.hourCycle === "h12"
  };
}

export function formatDateValue(
  value: Date | number | string,
  runtime: LocaleRuntime,
  options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" }
) {
  return formatDateForLocale(value, runtime.formatLocale, options);
}

export function formatDateForLocale(
  value: Date | number | string,
  formatLocale: string,
  options: Intl.DateTimeFormatOptions
) {
  return new Intl.DateTimeFormat(formatLocale, options).format(new Date(value));
}

export function formatTimeValue(
  value: Date | number | string,
  runtime: LocaleRuntime,
  options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" }
) {
  return new Intl.DateTimeFormat(runtime.formatLocale, withHourCycle(runtime, options)).format(new Date(value));
}

export function formatDateTimeValue(
  value: Date | number | string,
  runtime: LocaleRuntime,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }
) {
  return new Intl.DateTimeFormat(runtime.formatLocale, withHourCycle(runtime, options)).format(new Date(value));
}

export type RelativeDateFormatOptions = {
  baseValue?: Date | number | string;
  numeric?: Intl.RelativeTimeFormatNumeric;
  style?: Intl.RelativeTimeFormatStyle;
  relativeRangeDays?: number;
  fallbackOptions?: Intl.DateTimeFormatOptions;
};

function getLocalDayOrdinal(value: Date | number | string) {
  const date = new Date(value);
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

/** Formats nearby calendar days relatively and falls back to an absolute locale-aware date. */
export function formatRelativeDate(
  value: Date | number | string,
  runtime: LocaleRuntime,
  options: RelativeDateFormatOptions = {}
) {
  const {
    baseValue = Date.now(),
    numeric = "auto",
    style = "long",
    relativeRangeDays = 6,
    fallbackOptions = { year: "numeric", month: "short", day: "numeric" }
  } = options;
  const dayDifference = getLocalDayOrdinal(value) - getLocalDayOrdinal(baseValue);

  if (Math.abs(dayDifference) <= Math.max(0, relativeRangeDays)) {
    try {
      return new Intl.RelativeTimeFormat(runtime.formatLocale, { numeric, style }).format(dayDifference, "day");
    } catch {
      // Older WebViews fall through to the absolute formatter.
    }
  }

  return formatDateValue(value, runtime, fallbackOptions);
}

export function formatNumberValue(
  value: number,
  runtime: LocaleRuntime,
  options?: Intl.NumberFormatOptions
) {
  return new Intl.NumberFormat(runtime.formatLocale, options).format(value);
}

export function createDateTimeFormatter(
  runtime: LocaleRuntime,
  options: Intl.DateTimeFormatOptions
) {
  return new Intl.DateTimeFormat(runtime.formatLocale, withHourCycle(runtime, options));
}

export function createNumberFormatter(
  runtime: LocaleRuntime,
  options?: Intl.NumberFormatOptions
) {
  return new Intl.NumberFormat(runtime.formatLocale, options);
}

export function formatByteValue(value: number, runtime: LocaleRuntime) {
  const bytes = Number.isFinite(value) && value > 0 ? value : 0;
  const units = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const;
  let amount = bytes;
  let unitIndex = 0;

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  try {
    return new Intl.NumberFormat(runtime.formatLocale, {
      style: "unit",
      unit: units[unitIndex],
      unitDisplay: "short",
      maximumFractionDigits: amount >= 10 || unitIndex === 0 ? 0 : 1
    }).format(amount);
  } catch {
    const fallbackUnits = ["B", "KB", "MB", "GB", "TB"];
    return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${fallbackUnits[unitIndex]}`;
  }
}

export function formatListValue(values: string[], runtime: LocaleRuntime) {
  try {
    return new Intl.ListFormat(runtime.formatLocale, { style: "long", type: "conjunction" }).format(values);
  } catch {
    return values.join(", ");
  }
}

export function createLocaleCollator(runtime: LocaleRuntime, options?: Intl.CollatorOptions) {
  return new Intl.Collator(runtime.formatLocale, {
    numeric: true,
    sensitivity: "base",
    ...options
  });
}

export function startOfLocaleWeek(timestamp: number, weekStartsOn: WeekdayNumber) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  const currentDay = date.getDay() === 0 ? 7 : date.getDay();
  const offset = (currentDay - weekStartsOn + 7) % 7;
  date.setDate(date.getDate() - offset);
  return date.getTime();
}
