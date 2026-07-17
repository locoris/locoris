// @vitest-environment node

import { afterEach, describe, expect, test } from "vitest";

import {
  createLocaleRuntime,
  formatRelativeDate,
  startOfLocaleWeek,
  type LocaleRuntime
} from "../src/localization/formatters";
import type { ClientLocalePreferences } from "../src/localization/localePreferences";

const originalTimeZone = process.env.TZ;
const englishRuntime: LocaleRuntime = {
  interfaceLocale: "en",
  formatLocale: "en-US",
  weekStartsOn: 7,
  hourCycle: "h12"
};

function preferences(formatLocale: string): ClientLocalePreferences {
  return {
    interfaceLanguage: "en",
    formatLocale,
    weekStartsOn: "region",
    hourCycle: "region",
    spellcheck: { mode: "system", languages: [] }
  };
}

afterEach(() => {
  if (originalTimeZone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTimeZone;
  }
});

describe("calendar-day formatting across DST", () => {
  test("keeps the next local day as tomorrow across the spring-forward gap", () => {
    process.env.TZ = "America/New_York";

    expect(formatRelativeDate(
      new Date(2026, 2, 9, 0, 30),
      englishRuntime,
      { baseValue: new Date(2026, 2, 8, 23, 30) }
    )).toBe("tomorrow");
  });

  test("keeps the next local day as tomorrow across the fall-back overlap", () => {
    process.env.TZ = "America/New_York";

    expect(formatRelativeDate(
      new Date(2026, 10, 2, 0, 30),
      englishRuntime,
      { baseValue: new Date(2026, 10, 1, 0, 30) }
    )).toBe("tomorrow");
  });

  test("returns local midnight for the week containing a DST boundary", () => {
    process.env.TZ = "America/New_York";
    const weekStart = new Date(startOfLocaleWeek(new Date(2026, 2, 11, 15).getTime(), 1));

    expect([
      weekStart.getFullYear(),
      weekStart.getMonth(),
      weekStart.getDate(),
      weekStart.getHours(),
      weekStart.getMinutes()
    ]).toEqual([2026, 2, 9, 0, 0]);
  });
});

describe("locale week boundaries", () => {
  test("crosses the year boundary for a Monday-first week", () => {
    process.env.TZ = "UTC";
    const weekStart = new Date(startOfLocaleWeek(new Date(2026, 0, 4, 12).getTime(), 1));

    expect(weekStart.toISOString()).toBe("2025-12-29T00:00:00.000Z");
  });

  test("keeps Sunday as the first day for Sunday-first regions", () => {
    process.env.TZ = "UTC";
    const weekStart = new Date(startOfLocaleWeek(new Date(2026, 0, 4, 12).getTime(), 7));

    expect(weekStart.toISOString()).toBe("2026-01-04T00:00:00.000Z");
  });

  test("resolves regional week starts independently from interface language", () => {
    expect(createLocaleRuntime(preferences("en-US")).weekStartsOn).toBe(7);
    expect(createLocaleRuntime(preferences("ru-RU")).weekStartsOn).toBe(1);
  });
});
