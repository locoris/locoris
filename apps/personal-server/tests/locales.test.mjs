import assert from "node:assert/strict";
import test from "node:test";

import { getServerLocalePack, localeIds, localePacks, publishedLocales, resolveSetupLocale } from "../locales/index.mjs";

test("server GUI locale packs have matching non-empty contracts", () => {
  const reference = localePacks.en;
  for (const locale of publishedLocales) {
    const pack = getServerLocalePack(locale);
    assert.deepEqual(Object.keys(pack.setup).sort(), Object.keys(reference.setup).sort());
    assert.deepEqual(Object.keys(pack.desktop).sort(), Object.keys(reference.desktop).sort());
    for (const value of [...Object.values(pack.setup), ...Object.values(pack.desktop)]) {
      assert.equal(typeof value, "string");
      assert.ok(value.trim());
    }
  }
  assert.deepEqual(localeIds, ["en", "ru", "de", "es-419", "pt-BR", "fr", "it", "ja", "ko", "zh-CN"]);
});

test("server GUI resolves explicit language before browser language", () => {
  assert.equal(resolveSetupLocale(new URL("http://localhost/?lang=en"), "ru-RU"), "en");
  assert.equal(resolveSetupLocale(new URL("http://localhost/?lang=ru"), "en-US"), "ru");
  assert.equal(resolveSetupLocale(new URL("http://localhost/"), "ru-RU,ru;q=0.9"), "ru");
  assert.equal(resolveSetupLocale(new URL("http://localhost/"), "de-DE"), "en");
});
