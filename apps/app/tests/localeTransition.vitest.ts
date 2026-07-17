// @vitest-environment node

import { describe, expect, test, vi } from "vitest";

import {
  initializeLocaleWithRecovery,
  LocaleTransitionFailure,
  runLocaleTransition
} from "../src/localization/localeTransition";
import type { ClientLocalePreferences } from "../src/localization/localePreferences";

function preferences(interfaceLanguage: string): ClientLocalePreferences {
  return {
    interfaceLanguage,
    formatLocale: "en-US",
    weekStartsOn: "region",
    hourCycle: "region",
    spellcheck: { mode: "system", languages: [] }
  };
}

describe("locale transitions", () => {
  test("persists a language only after its resources and runtime are ready", async () => {
    const order: string[] = [];

    const result = await runLocaleTransition({
      previousPreferences: preferences("en"),
      nextPreferences: preferences("ru"),
      previousLocale: "en",
      dependencies: {
        preload: async (locale) => { order.push(`preload:${locale}`); },
        activate: async (locale) => { order.push(`activate:${locale}`); },
        persist: (value) => { order.push(`persist:${value.interfaceLanguage}`); return value; },
        markWorking: (locale) => { order.push(`working:${locale}`); }
      }
    });

    expect(result.locale).toBe("ru");
    expect(order).toEqual([
      "preload:ru",
      "activate:ru",
      "persist:ru",
      "working:ru"
    ]);
  });

  test("rolls back the preference and active language when a locale chunk fails", async () => {
    const persisted: ClientLocalePreferences[] = [];
    const activated: string[] = [];

    await expect(runLocaleTransition({
      previousPreferences: preferences("en"),
      nextPreferences: preferences("ru"),
      previousLocale: "en",
      dependencies: {
        preload: async () => { throw new Error("chunk unavailable"); },
        activate: async (locale) => { activated.push(locale); },
        persist: (value) => { persisted.push(value); return value; },
        markWorking: vi.fn()
      }
    })).rejects.toMatchObject<Partial<LocaleTransitionFailure>>({
      name: "LocaleTransitionFailure",
      requestedLocale: "ru",
      previousLocale: "en",
      rollbackPreferences: expect.objectContaining({ interfaceLanguage: "en" })
    });

    expect(persisted.map((value) => value.interfaceLanguage)).toEqual(["en"]);
    expect(activated).toEqual(["en"]);
  });

  test("recovers startup through the last working locale and queues a visible notice", async () => {
    const persisted: ClientLocalePreferences[] = [];
    const notices: Array<{ requestedLocale: string; previousLocale: string }> = [];
    const initialized: string[] = [];

    const locale = await initializeLocaleWithRecovery({
      preferences: preferences("ru"),
      lastWorkingLocale: "en",
      fallbackLocale: "en",
      dependencies: {
        preload: async (candidate) => {
          if (candidate === "ru") throw new Error("chunk unavailable");
        },
        initialize: async (candidate) => { initialized.push(candidate); },
        persist: (value) => { persisted.push(value); return value; },
        markWorking: vi.fn(),
        queueFailureNotice: (notice) => { notices.push(notice); }
      }
    });

    expect(locale).toBe("en");
    expect(initialized).toEqual(["en"]);
    expect(persisted.at(-1)?.interfaceLanguage).toBe("en");
    expect(notices).toEqual([{ requestedLocale: "ru", previousLocale: "en" }]);
  });
});
