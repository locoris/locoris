import en from "./en.mjs";
import ru from "./ru.mjs";

export const localeIds = ["en", "ru", "de", "es-419", "pt-BR", "fr", "it", "ja", "ko", "zh-CN"];
export const publishedLocales = ["en", "ru"];
export const localePacks = { en, ru };

export function normalizeServerLocale(value) {
  const normalized = String(value ?? "").trim();
  if (publishedLocales.includes(normalized)) return normalized;
  if (normalized.toLowerCase().startsWith("ru")) return "ru";
  return "en";
}

export function getServerLocalePack(value) {
  return localePacks[normalizeServerLocale(value)];
}

export function resolveSetupLocale(url, acceptLanguage = "") {
  const requested = url?.searchParams?.get("lang");
  return normalizeServerLocale(requested || acceptLanguage);
}
