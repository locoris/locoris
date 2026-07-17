// @vitest-environment node

import { describe, expect, test } from "vitest";

import {
  listSupportedLocaleCodes,
  loadBlockNoteDictionary,
  loadLocalePack,
  preloadLocaleResources,
  resolveSupportedLocale
} from "../src/localization/localePacks";

describe("production locale packs", () => {
  test("discovers every production localization wave without registration code", () => {
    expect(listSupportedLocaleCodes()).toEqual(
      expect.arrayContaining([
        "de",
        "en",
        "es-419",
        "fr",
        "it",
        "ja",
        "ko",
        "pt-BR",
        "ru",
        "zh-CN"
      ])
    );
  });

  test.each([
    ["de-DE", "de"],
    ["de-AT", "de"],
    ["es-MX", "es-419"],
    ["es-AR", "es-419"],
    ["es-ES", "es-419"],
    ["fr-FR", "fr"],
    ["fr-CA", "fr"],
    ["pt-BR", "pt-BR"],
    ["pt", "pt-BR"],
    ["pt-PT", "pt-BR"],
    ["it-IT", "it"],
    ["it-CH", "it"],
    ["ja-JP", "ja"],
    ["ko-KR", "ko"],
    ["zh-CN", "zh-CN"],
    ["zh-Hans", "zh-CN"],
    ["zh-SG", "zh-CN"],
    ["zh-TW", "en"],
    ["zh-Hant", "en"],
    ["zh-HK", "en"]
  ])("resolves system locale %s to %s", (requested, expected) => {
    expect(resolveSupportedLocale(requested)).toBe(expected);
  });

  test.each([
    ["de", "Deutsch"],
    ["es-419", "Español (Latinoamérica)"],
    ["fr", "Français"],
    ["it", "Italiano"],
    ["ja", "日本語"],
    ["ko", "한국어"],
    ["pt-BR", "Português (Brasil)"],
    ["zh-CN", "简体中文"]
  ])("loads %s messages and its explicit BlockNote dictionary", async (locale, nativeName) => {
    const pack = await loadLocalePack(locale);
    const dictionary = await loadBlockNoteDictionary(locale);

    expect(pack.meta).toMatchObject({ code: locale, nativeName, direction: "ltr" });
    expect(pack.messages.settings.interfaceLanguageKicker).toBeTruthy();
    expect(pack.messages.settings.interfaceLanguageKicker).not.toBe("Language");
    expect(Object.keys(dictionary).length).toBeGreaterThan(0);
    await expect(preloadLocaleResources(locale)).resolves.toBe(locale);
  });
});
