import {
  removePersistentString,
  readPersistentString,
  writePersistentString
} from "../lib/persistentClientStorage";
import { detectSystemLocale, resolveSupportedLocale } from "./localePacks";

const LOCALE_PREFERENCES_STORAGE_KEY = "zen:locale-preferences:v1";
const LAST_WORKING_INTERFACE_LOCALE_STORAGE_KEY = "zen:locale-last-working:v1";
const PENDING_LOCALE_FAILURE_STORAGE_KEY = "zen:locale-pending-failure:v1";

export type PendingLocaleFailure = {
  requestedLocale: string;
  previousLocale: string;
};

export type InterfaceLanguagePreference = "system" | string;
export type FormatLocalePreference = "system" | string;
export type WeekdayNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type WeekStartPreference = "region" | WeekdayNumber;
export type HourCyclePreference = "region" | "h12" | "h23";
export type SpellcheckMode = "system" | "off" | "languages";

export type ClientLocalePreferences = {
  interfaceLanguage: InterfaceLanguagePreference;
  formatLocale: FormatLocalePreference;
  weekStartsOn: WeekStartPreference;
  hourCycle: HourCyclePreference;
  spellcheck: {
    mode: SpellcheckMode;
    languages: string[];
  };
};

const DEFAULT_LOCALE_PREFERENCES: ClientLocalePreferences = {
  interfaceLanguage: "system",
  formatLocale: "system",
  weekStartsOn: "region",
  hourCycle: "region",
  spellcheck: {
    mode: "system",
    languages: []
  }
};

function isWeekdayNumber(value: unknown): value is WeekdayNumber {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 7;
}

function normalizeLocaleTag(value: unknown, fallback: string) {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  if (value === "system" || value === "region") {
    return value;
  }

  try {
    return Intl.getCanonicalLocales(value)[0] ?? fallback;
  } catch {
    return fallback;
  }
}

export function normalizeLocalePreferences(value: unknown): ClientLocalePreferences {
  const candidate = value && typeof value === "object" ? value as Partial<ClientLocalePreferences> : {};
  const spellcheck =
    candidate.spellcheck && typeof candidate.spellcheck === "object"
      ? candidate.spellcheck
      : DEFAULT_LOCALE_PREFERENCES.spellcheck;
  const spellcheckMode =
    spellcheck.mode === "off" || spellcheck.mode === "languages" ? spellcheck.mode : "system";
  const spellcheckLanguages = Array.isArray(spellcheck.languages)
    ? [...new Set(spellcheck.languages
        .filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
        .map((entry) => normalizeLocaleTag(entry, ""))
        .filter(Boolean))]
    : [];
  const weekStartsOn =
    candidate.weekStartsOn === "region" || isWeekdayNumber(candidate.weekStartsOn)
      ? candidate.weekStartsOn
      : "region";
  const hourCycle =
    candidate.hourCycle === "h12" || candidate.hourCycle === "h23"
      ? candidate.hourCycle
      : "region";

  return {
    interfaceLanguage: normalizeLocaleTag(candidate.interfaceLanguage, "system"),
    formatLocale: normalizeLocaleTag(candidate.formatLocale, "system"),
    weekStartsOn,
    hourCycle,
    spellcheck: {
      mode: spellcheckMode,
      languages: spellcheckLanguages
    }
  };
}

export function hasStoredLocalePreferences() {
  return readPersistentString(LOCALE_PREFERENCES_STORAGE_KEY) !== null;
}

export function readLocalePreferences() {
  const raw = readPersistentString(LOCALE_PREFERENCES_STORAGE_KEY);

  if (!raw) {
    return DEFAULT_LOCALE_PREFERENCES;
  }

  try {
    return normalizeLocalePreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_LOCALE_PREFERENCES;
  }
}

export function writeLocalePreferences(preferences: ClientLocalePreferences) {
  const normalized = normalizeLocalePreferences(preferences);
  writePersistentString(LOCALE_PREFERENCES_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function readLastWorkingInterfaceLocale() {
  const locale = readPersistentString(LAST_WORKING_INTERFACE_LOCALE_STORAGE_KEY);
  return locale ? normalizeLocaleTag(locale, "") || null : null;
}

export function writeLastWorkingInterfaceLocale(locale: string) {
  const normalized = normalizeLocaleTag(locale, "");

  if (normalized) {
    writePersistentString(LAST_WORKING_INTERFACE_LOCALE_STORAGE_KEY, normalized);
  }
}

export function queueLocaleFailureNotice(notice: PendingLocaleFailure) {
  writePersistentString(PENDING_LOCALE_FAILURE_STORAGE_KEY, JSON.stringify(notice));
}

export function consumeLocaleFailureNotice(): PendingLocaleFailure | null {
  const raw = readPersistentString(PENDING_LOCALE_FAILURE_STORAGE_KEY);
  removePersistentString(PENDING_LOCALE_FAILURE_STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    const value = JSON.parse(raw) as Partial<PendingLocaleFailure>;
    const requestedLocale = normalizeLocaleTag(value.requestedLocale, "");
    const previousLocale = normalizeLocaleTag(value.previousLocale, "");

    return requestedLocale && previousLocale
      ? { requestedLocale, previousLocale }
      : null;
  } catch {
    return null;
  }
}

export function migrateLegacyLanguagePreference(language: string | null | undefined) {
  if (hasStoredLocalePreferences() || !language) {
    return null;
  }

  return normalizeLocalePreferences({
    ...DEFAULT_LOCALE_PREFERENCES,
    interfaceLanguage: resolveSupportedLocale(language)
  });
}

export function resolveInterfaceLocale(preferences: ClientLocalePreferences) {
  return preferences.interfaceLanguage === "system"
    ? detectSystemLocale()
    : resolveSupportedLocale(preferences.interfaceLanguage);
}

export function resolveFormatLocale(preferences: ClientLocalePreferences) {
  if (preferences.formatLocale !== "system") {
    return preferences.formatLocale;
  }

  const systemLocale =
    typeof navigator === "undefined" ? null : navigator.languages?.[0] ?? navigator.language;
  return normalizeLocaleTag(systemLocale, resolveInterfaceLocale(preferences));
}

export function resolveSpellcheckLanguages(preferences: ClientLocalePreferences) {
  const interfaceLocale = resolveInterfaceLocale(preferences);

  if (preferences.spellcheck.mode === "off") {
    return [];
  }

  if (preferences.spellcheck.mode === "languages") {
    return preferences.spellcheck.languages.length > 0
      ? preferences.spellcheck.languages
      : [interfaceLocale];
  }

  if (preferences.spellcheck.mode === "system") {
    const requestedLocales =
      typeof navigator === "undefined"
        ? []
        : [...(navigator.languages ?? []), navigator.language].filter(Boolean);
    const normalizedLocales = requestedLocales
      .map((locale) => normalizeLocaleTag(locale, ""))
      .filter(Boolean);

    return [...new Set([...normalizedLocales, interfaceLocale])];
  }

  return [interfaceLocale];
}
