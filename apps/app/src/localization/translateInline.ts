import i18n from "../i18n";
import { resolveSupportedLocale } from "./localePacks";

export function translateInline(
  language: string,
  key: string,
  values?: Record<string, unknown>
) {
  return translateApp(language, `inline.${key}`, values);
}

export function translateApp(
  language: string,
  key: string,
  values?: Record<string, unknown>
) {
  return i18n.getFixedT(resolveSupportedLocale(language))(key, values);
}
