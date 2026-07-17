import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";

import { changeAppLanguage } from "../i18n";
import LocaleChangeNotice, {
  type LocaleChangeFailureNotice
} from "./LocaleChangeNotice";
import { createLocaleRuntime, type LocaleRuntime } from "./formatters";
import { preloadLocaleResources } from "./localePacks";
import {
  LocaleTransitionFailure,
  runLocaleTransition
} from "./localeTransition";
import {
  consumeLocaleFailureNotice,
  migrateLegacyLanguagePreference,
  normalizeLocalePreferences,
  readLocalePreferences,
  writeLocalePreferences,
  writeLastWorkingInterfaceLocale,
  type ClientLocalePreferences
} from "./localePreferences";

type LocaleContextValue = {
  preferences: ClientLocalePreferences;
  runtime: LocaleRuntime;
  updatePreferences: (patch: Partial<ClientLocalePreferences>) => Promise<void>;
  migrateLegacyLanguage: (language: string | null | undefined) => Promise<void>;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(readLocalePreferences);
  const [failureNotice, setFailureNotice] = useState<LocaleChangeFailureNotice | null>(() => {
    const pending = consumeLocaleFailureNotice();
    return pending ? { ...pending, id: Date.now() } : null;
  });
  const preferencesRef = useRef(preferences);
  const activeLocaleRef = useRef(createLocaleRuntime(preferences).interfaceLocale);
  const commitQueueRef = useRef<Promise<void>>(Promise.resolve());
  const runtime = useMemo(() => createLocaleRuntime(preferences), [preferences]);

  const commitPreferences = useCallback((
    buildNext: (current: ClientLocalePreferences) => ClientLocalePreferences
  ) => {
    const operation = commitQueueRef.current.then(async () => {
      const previous = preferencesRef.current;
      const previousLocale = activeLocaleRef.current;
      const normalized = normalizeLocalePreferences(buildNext(previous));

      try {
        const result = await runLocaleTransition({
          previousPreferences: previous,
          nextPreferences: normalized,
          previousLocale,
          dependencies: {
            preload: preloadLocaleResources,
            activate: changeAppLanguage,
            persist: writeLocalePreferences,
            markWorking: writeLastWorkingInterfaceLocale
          }
        });
        preferencesRef.current = result.preferences;
        activeLocaleRef.current = result.locale;
        setPreferences(result.preferences);
      } catch (error) {
        if (error instanceof LocaleTransitionFailure) {
          preferencesRef.current = error.rollbackPreferences;
          activeLocaleRef.current = error.previousLocale;
          setPreferences({ ...error.rollbackPreferences });
          setFailureNotice({
            id: Date.now(),
            requestedLocale: error.requestedLocale,
            previousLocale: error.previousLocale
          });
        }
        throw error;
      }
    });

    commitQueueRef.current = operation.catch(() => undefined);
    return operation;
  }, []);

  useEffect(() => {
    if (preferences.interfaceLanguage !== "system" && preferences.formatLocale !== "system") {
      return;
    }

    const handleSystemLanguageChange = () => {
      void commitPreferences((current) => ({ ...current })).catch(() => undefined);
    };

    window.addEventListener("languagechange", handleSystemLanguageChange);
    return () => window.removeEventListener("languagechange", handleSystemLanguageChange);
  }, [commitPreferences, preferences.formatLocale, preferences.interfaceLanguage]);

  const updatePreferences = useCallback(async (patch: Partial<ClientLocalePreferences>) => {
    await commitPreferences((current) => ({
      ...current,
      ...patch,
      spellcheck: patch.spellcheck
        ? { ...current.spellcheck, ...patch.spellcheck }
        : current.spellcheck
    }));
  }, [commitPreferences]);

  const migrateLegacyLanguage = useCallback(async (language: string | null | undefined) => {
    const migrated = migrateLegacyLanguagePreference(language);

    if (!migrated) {
      return;
    }

    await commitPreferences(() => migrated);
  }, [commitPreferences]);

  const dismissFailureNotice = useCallback(() => setFailureNotice(null), []);

  const value = useMemo<LocaleContextValue>(() => ({
    preferences,
    runtime,
    updatePreferences,
    migrateLegacyLanguage
  }), [migrateLegacyLanguage, preferences, runtime, updatePreferences]);

  return (
    <LocaleContext.Provider value={value}>
      {children}
      <LocaleChangeNotice
        notice={failureNotice}
        onDismiss={dismissFailureNotice}
      />
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const value = useContext(LocaleContext);

  if (!value) {
    throw new Error("useLocale must be used inside LocaleProvider");
  }

  return value;
}
