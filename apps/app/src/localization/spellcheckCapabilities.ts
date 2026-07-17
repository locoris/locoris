import { getRuntimeKind, type AppRuntimeKind } from "../lib/runtime";
import type { ClientLocalePreferences } from "./localePreferences";
import { resolveSpellcheckLanguages } from "./localePreferences";

export type SpellcheckPlatform = AppRuntimeKind;
export type SpellcheckLanguageStrategy = "browser-native" | "desktop-native" | "android-native";

export type SpellcheckCapabilityAdapter = {
  platform: SpellcheckPlatform;
  strategy: SpellcheckLanguageStrategy;
  nativeSpellcheck: boolean;
  multipleLanguages: boolean;
  blockLanguageHints: boolean;
};

export type SpellcheckConfiguration = {
  adapter: SpellcheckCapabilityAdapter;
  enabled: boolean;
  languages: string[];
  primaryLanguage: string;
  signature: string;
};

export const COMMON_SPELLCHECK_LOCALES = [
  "en", "ru", "uk", "de", "fr", "es", "it", "pt-BR", "pl", "tr",
  "ar", "hi", "ja", "ko", "zh-CN"
] as const;

const SPELLCHECK_ADAPTERS: Record<SpellcheckPlatform, SpellcheckCapabilityAdapter> = {
  web: {
    platform: "web",
    strategy: "browser-native",
    nativeSpellcheck: true,
    multipleLanguages: true,
    blockLanguageHints: true
  },
  desktop: {
    platform: "desktop",
    strategy: "desktop-native",
    nativeSpellcheck: true,
    multipleLanguages: true,
    blockLanguageHints: true
  },
  android: {
    platform: "android",
    strategy: "android-native",
    nativeSpellcheck: true,
    multipleLanguages: true,
    blockLanguageHints: true
  }
};

const LANGUAGE_MARKERS: Record<string, ReadonlySet<string>> = Object.fromEntries(
  Object.entries({
    en: ["the", "and", "this", "that", "with", "from", "for", "is", "are", "you", "your"],
    ru: ["это", "что", "для", "как", "или", "при", "его", "она", "они", "есть", "будет"],
    uk: ["це", "що", "для", "як", "або", "при", "його", "вона", "вони", "буде", "та"],
    de: ["der", "die", "das", "und", "ist", "mit", "für", "ein", "eine", "von", "nicht"],
    fr: ["le", "la", "les", "une", "et", "est", "avec", "pour", "dans", "vous", "pas"],
    es: ["el", "la", "los", "las", "una", "es", "con", "para", "este", "esta", "pero"],
    it: ["il", "lo", "la", "gli", "una", "con", "per", "questo", "questa", "non", "sono"],
    pt: ["os", "as", "uma", "com", "para", "este", "esta", "não", "são", "por", "que"],
    pl: ["jest", "dla", "oraz", "nie", "się", "ten", "ta", "który", "przez", "jako", "ale"],
    tr: ["bir", "bu", "için", "ile", "olan", "değil", "veya", "olarak", "daha", "ama", "çok"]
  }).map(([language, markers]) => [language, new Set(markers)])
);

export function getSpellcheckCapabilityAdapter(
  platform: SpellcheckPlatform = getRuntimeKind()
) {
  return SPELLCHECK_ADAPTERS[platform];
}

export function createSpellcheckConfiguration(
  preferences: ClientLocalePreferences,
  fallbackLocale: string,
  platform: SpellcheckPlatform = getRuntimeKind()
): SpellcheckConfiguration {
  const adapter = getSpellcheckCapabilityAdapter(platform);
  const languages = [...new Set(resolveSpellcheckLanguages(preferences))];
  const enabled = preferences.spellcheck.mode !== "off" && adapter.nativeSpellcheck;
  const effectiveLanguages = enabled && languages.length > 0 ? languages : [fallbackLocale];
  const primaryLanguage = effectiveLanguages[0] ?? fallbackLocale;

  return {
    adapter,
    enabled,
    languages: effectiveLanguages,
    primaryLanguage,
    signature: [adapter.platform, enabled ? "on" : "off", ...effectiveLanguages].join(":")
  };
}

function getLanguageScript(language: string) {
  try {
    return new Intl.Locale(language).maximize().script ?? null;
  } catch {
    return null;
  }
}

function countScriptCharacters(text: string, script: string) {
  try {
    return text.match(new RegExp(`\\p{Script=${script}}`, "gu"))?.length ?? 0;
  } catch {
    return 0;
  }
}

function getBaseLanguage(language: string) {
  try {
    return new Intl.Locale(language).language;
  } catch {
    return language.split("-")[0]?.toLowerCase() ?? language.toLowerCase();
  }
}

function detectLanguageFromMarkers(text: string, languages: string[]) {
  const words = text.toLocaleLowerCase().match(/\p{Letter}+/gu) ?? [];
  let bestLanguage: string | null = null;
  let bestScore = 0;

  for (const language of languages) {
    const markers = LANGUAGE_MARKERS[getBaseLanguage(language)];

    if (!markers) {
      continue;
    }

    const score = words.reduce((total, word) => total + (markers.has(word) ? 1 : 0), 0);

    if (score > bestScore) {
      bestLanguage = language;
      bestScore = score;
    }
  }

  return bestLanguage;
}

export function detectSpellcheckLanguage(
  text: string,
  languages: string[],
  fallbackLanguage: string
) {
  if (languages.length <= 1 || !text.trim()) {
    return languages[0] ?? fallbackLanguage;
  }

  const candidatesByScript = new Map<string, string[]>();

  for (const language of languages) {
    const script = getLanguageScript(language);

    if (!script) {
      continue;
    }

    candidatesByScript.set(script, [...(candidatesByScript.get(script) ?? []), language]);
  }

  let bestScript: string | null = null;
  let bestScore = 0;

  for (const script of candidatesByScript.keys()) {
    const score = countScriptCharacters(text, script);

    if (score > bestScore) {
      bestScript = script;
      bestScore = score;
    }
  }

  if (!bestScript || bestScore === 0) {
    return fallbackLanguage;
  }

  const matchingLanguages = candidatesByScript.get(bestScript) ?? [];
  const detectedLanguage = detectLanguageFromMarkers(text, matchingLanguages);

  if (detectedLanguage) {
    return detectedLanguage;
  }

  return matchingLanguages.includes(fallbackLanguage)
    ? fallbackLanguage
    : matchingLanguages[0] ?? fallbackLanguage;
}
