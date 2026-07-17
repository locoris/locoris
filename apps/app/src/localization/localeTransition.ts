import { createLocaleRuntime } from "./formatters";
import {
  normalizeLocalePreferences,
  type ClientLocalePreferences,
  type PendingLocaleFailure
} from "./localePreferences";

export type LocaleTransitionDependencies = {
  preload: (locale: string) => Promise<unknown>;
  activate: (locale: string) => Promise<unknown>;
  persist: (preferences: ClientLocalePreferences) => ClientLocalePreferences;
  markWorking: (locale: string) => void;
};

export class LocaleTransitionFailure extends Error {
  readonly requestedLocale: string;
  readonly previousLocale: string;
  readonly rollbackPreferences: ClientLocalePreferences;

  constructor(input: {
    cause: unknown;
    requestedLocale: string;
    previousLocale: string;
    rollbackPreferences: ClientLocalePreferences;
  }) {
    super("LOCALE_TRANSITION_FAILED", { cause: input.cause });
    this.name = "LocaleTransitionFailure";
    this.requestedLocale = input.requestedLocale;
    this.previousLocale = input.previousLocale;
    this.rollbackPreferences = input.rollbackPreferences;
  }
}

export async function runLocaleTransition(input: {
  previousPreferences: ClientLocalePreferences;
  nextPreferences: ClientLocalePreferences;
  previousLocale: string;
  dependencies: LocaleTransitionDependencies;
}) {
  const { previousPreferences, previousLocale, dependencies } = input;
  const nextPreferences = normalizeLocalePreferences(input.nextPreferences);
  const requestedLocale = createLocaleRuntime(nextPreferences).interfaceLocale;

  try {
    if (requestedLocale !== previousLocale) {
      await dependencies.preload(requestedLocale);
      await dependencies.activate(requestedLocale);
    }

    const persisted = dependencies.persist(nextPreferences);
    dependencies.markWorking(requestedLocale);
    return { preferences: persisted, locale: requestedLocale };
  } catch (cause) {
    const rollbackCandidate =
      previousPreferences.interfaceLanguage === "system" && requestedLocale !== previousLocale
        ? { ...previousPreferences, interfaceLanguage: previousLocale }
        : previousPreferences;
    const rollbackPreferences = dependencies.persist(rollbackCandidate);
    await dependencies.activate(previousLocale).catch(() => undefined);

    throw new LocaleTransitionFailure({
      cause,
      requestedLocale,
      previousLocale,
      rollbackPreferences
    });
  }
}

export type LocaleStartupDependencies = {
  preload: (locale: string) => Promise<unknown>;
  initialize: (locale: string) => Promise<unknown>;
  persist: (preferences: ClientLocalePreferences) => ClientLocalePreferences;
  markWorking: (locale: string) => void;
  queueFailureNotice: (notice: PendingLocaleFailure) => void;
};

export async function initializeLocaleWithRecovery(input: {
  preferences: ClientLocalePreferences;
  lastWorkingLocale: string | null;
  fallbackLocale: string;
  dependencies: LocaleStartupDependencies;
}) {
  const requestedLocale = createLocaleRuntime(input.preferences).interfaceLocale;

  try {
    await input.dependencies.preload(requestedLocale);
    await input.dependencies.initialize(requestedLocale);
    input.dependencies.markWorking(requestedLocale);
    return requestedLocale;
  } catch (initialLocaleError) {
    const fallbackLocales = [input.lastWorkingLocale, input.fallbackLocale]
      .filter((locale): locale is string => Boolean(locale))
      .filter((locale, index, locales) =>
        locale !== requestedLocale && locales.indexOf(locale) === index
      );
    let recoveredLocale: string | null = null;

    for (const fallbackLocale of fallbackLocales) {
      try {
        await input.dependencies.preload(fallbackLocale);
        await input.dependencies.initialize(fallbackLocale);
        recoveredLocale = fallbackLocale;
        break;
      } catch {
        // Continue through the known-safe candidates before aborting startup.
      }
    }

    if (!recoveredLocale) {
      throw initialLocaleError;
    }

    input.dependencies.persist({
      ...input.preferences,
      interfaceLanguage: recoveredLocale
    });
    input.dependencies.markWorking(recoveredLocale);
    input.dependencies.queueFailureNotice({
      requestedLocale,
      previousLocale: recoveredLocale
    });
    return recoveredLocale;
  }
}
