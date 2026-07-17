import type { AppLocaleMessages } from "./localeSchema";
import type {
  BlockNoteDictionary,
  LocaleDirection,
  LocalePack
} from "./localePack";

type TranslationModule = { default: LocalePack<AppLocaleMessages> };

const localeModules = import.meta.glob<TranslationModule>("../locales/*.ts");
const localePackCache = new Map<string, LocalePack<AppLocaleMessages>>();
const blockNoteDictionaryCache = new Map<string, Promise<BlockNoteDictionary>>();

const RTL_LANGUAGE_CODES = new Set(["ar", "fa", "he", "ps", "ur"]);
const LOCALE_ALIASES: Record<string, string[]> = {
  "es-419": ["es-MX", "es-AR", "es-CL", "es-CO", "es-PE", "es-VE"],
  "pt-BR": ["pt"],
  "zh-CN": ["zh-Hans", "zh-SG", "zh-MY"]
};

export type LocaleOption = {
  code: string;
  shortCode: string;
  nativeName: string;
  direction: LocaleDirection;
};

function localeCodeFromPath(path: string) {
  return path.split("/").pop()?.replace(/\.ts$/, "") ?? "";
}

function canonicalizeLocale(code: string) {
  try {
    return Intl.getCanonicalLocales(code)[0] ?? code;
  } catch {
    return code.replace(/_/g, "-");
  }
}

function getBaseLanguage(code: string) {
  try {
    return new Intl.Locale(code).language;
  } catch {
    return code.split("-")[0]?.toLowerCase() ?? "en";
  }
}

function hasCompatibleScript(requested: string, candidate: string) {
  try {
    const requestedLocale = new Intl.Locale(requested).maximize();
    const candidateLocale = new Intl.Locale(candidate).maximize();
    return requestedLocale.script === candidateLocale.script;
  } catch {
    return true;
  }
}

export function getLocaleLanguageCode(code: string) {
  return getBaseLanguage(canonicalizeLocale(code));
}

export function listSupportedLocaleCodes() {
  return Object.keys(localeModules)
    .map(localeCodeFromPath)
    .filter(Boolean)
    .map(canonicalizeLocale)
    .filter((code) => import.meta.env.DEV || code !== "en-XA")
    .sort((left, right) => left.localeCompare(right));
}

export function resolveSupportedLocale(
  requested: string | null | undefined,
  supported = listSupportedLocaleCodes()
) {
  const fallback = supported.includes("en") ? "en" : supported[0] ?? "en";

  if (!requested || requested === "system") {
    return fallback;
  }

  const canonical = canonicalizeLocale(requested);
  const exact = supported.find((code) => canonicalizeLocale(code) === canonical);

  if (exact) {
    return exact;
  }

  const aliasMatch = supported.find((code) =>
    (LOCALE_ALIASES[canonicalizeLocale(code)] ?? []).some(
      (alias) => canonicalizeLocale(alias) === canonical
    )
  );

  if (aliasMatch) {
    return aliasMatch;
  }

  const requestedLanguage = getBaseLanguage(canonical);
  return supported.find(
    (code) =>
      getBaseLanguage(code) === requestedLanguage
      && hasCompatibleScript(canonical, code)
  ) ?? fallback;
}

export function detectSystemLocale(supported = listSupportedLocaleCodes()) {
  const requestedLocales =
    typeof navigator === "undefined"
      ? ["en"]
      : [...(navigator.languages ?? []), navigator.language].filter(Boolean);

  for (const requested of requestedLocales) {
    const resolved = resolveSupportedLocale(requested, supported);

    if (getBaseLanguage(resolved) === getBaseLanguage(requested)) {
      return resolved;
    }
  }

  return resolveSupportedLocale("en", supported);
}

export function getLocaleDirection(code: string): LocaleDirection {
  const resolved = resolveSupportedLocale(code);
  const cachedDirection = localePackCache.get(resolved)?.meta.direction;

  if (cachedDirection) {
    return cachedDirection;
  }

  return RTL_LANGUAGE_CODES.has(getBaseLanguage(code)) ? "rtl" : "ltr";
}

export function getNativeLocaleName(code: string) {
  const resolved = resolveSupportedLocale(code);
  const cachedNativeName = localePackCache.get(resolved)?.meta.nativeName;

  if (cachedNativeName) {
    return cachedNativeName;
  }

  return getLocaleDisplayName(code, code);
}

export function getLocaleDisplayName(code: string, displayLocale: string) {
  try {
    const displayNames = new Intl.DisplayNames([displayLocale], { type: "language" });
    return displayNames.of(code) ?? code;
  } catch {
    return code;
  }
}

export async function loadLocalePack(code: string) {
  const resolved = resolveSupportedLocale(code);
  const cachedPack = localePackCache.get(resolved);

  if (cachedPack) {
    return cachedPack;
  }

  const entry = Object.entries(localeModules).find(
    ([path]) => canonicalizeLocale(localeCodeFromPath(path)) === resolved
  );

  if (!entry) {
    throw new Error(`Locale pack not found: ${resolved}`);
  }

  const module = await entry[1]();
  const pack = module.default;
  const packCode = canonicalizeLocale(pack.meta.code);

  if (packCode !== resolved) {
    throw new Error(`Locale pack code mismatch: expected ${resolved}, received ${packCode}`);
  }

  localePackCache.set(resolved, pack);
  return pack;
}

export async function loadLocaleOptions(): Promise<LocaleOption[]> {
  const packs = await Promise.all(listSupportedLocaleCodes().map(loadLocalePack));

  return packs.map((pack) => ({
    code: pack.meta.code,
    shortCode: getBaseLanguage(pack.meta.code).slice(0, 2).toUpperCase(),
    nativeName: pack.meta.nativeName,
    direction: pack.meta.direction
  }));
}

export async function loadLocaleMessages(code: string) {
  return (await loadLocalePack(code)).messages;
}

export async function loadBlockNoteDictionary(code: string): Promise<BlockNoteDictionary> {
  const resolved = resolveSupportedLocale(code);
  const cachedDictionary = blockNoteDictionaryCache.get(resolved);

  if (cachedDictionary) {
    return cachedDictionary;
  }

  const dictionaryPromise = loadLocalePack(resolved)
    .then((pack) => pack.blockNoteDictionary())
    .catch((error: unknown) => {
      blockNoteDictionaryCache.delete(resolved);
      throw error;
    });
  blockNoteDictionaryCache.set(resolved, dictionaryPromise);
  return dictionaryPromise;
}

export async function preloadLocaleResources(code: string) {
  const resolved = resolveSupportedLocale(code);
  await Promise.all([
    loadLocalePack(resolved),
    loadBlockNoteDictionary(resolved)
  ]);
  return resolved;
}
