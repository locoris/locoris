import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import {
  getLocaleDirection,
  listSupportedLocaleCodes,
  loadLocaleMessages,
  resolveSupportedLocale
} from "./localization/localePacks";

let initializationPromise: Promise<typeof i18n> | null = null;

function applyDocumentLocale(locale: string) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.lang = locale;
  document.documentElement.dir = getLocaleDirection(locale);
}

async function ensureLocaleLoaded(locale: string) {
  if (i18n.hasResourceBundle(locale, "translation")) {
    return;
  }

  const messages = await loadLocaleMessages(locale);
  i18n.addResourceBundle(locale, "translation", messages, true, true);
}

export function initializeI18n(requestedLocale: string) {
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    const locale = resolveSupportedLocale(requestedLocale);
    const fallbackLocale = resolveSupportedLocale("en");
    const [fallbackMessages, messages] = await Promise.all([
      loadLocaleMessages(fallbackLocale),
      locale === fallbackLocale ? Promise.resolve(null) : loadLocaleMessages(locale)
    ]);

    await i18n.use(initReactI18next).init({
      resources: {
        [fallbackLocale]: { translation: fallbackMessages },
        ...(messages ? { [locale]: { translation: messages } } : {})
      },
      lng: locale,
      fallbackLng: fallbackLocale,
      supportedLngs: listSupportedLocaleCodes(),
      load: "currentOnly",
      interpolation: {
        escapeValue: false
      },
      returnNull: false
    });
    applyDocumentLocale(locale);
    return i18n;
  })().catch((error: unknown) => {
    initializationPromise = null;
    throw error;
  });

  return initializationPromise;
}

export async function changeAppLanguage(requestedLocale: string) {
  const locale = resolveSupportedLocale(requestedLocale);
  await initializeI18n(locale);
  await ensureLocaleLoaded(locale);
  await i18n.changeLanguage(locale);
  applyDocumentLocale(locale);
  return locale;
}

export default i18n;
