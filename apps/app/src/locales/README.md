# Locoris locale packs

The interface language is a device preference and is independent from regional
date/number formats, week start, 12/24-hour time, and editor spellcheck.

To add a locale:

1. Copy `en.ts` to a BCP 47-named file such as `de.ts`.
2. Export a `defineLocalePack()` value with `meta`, `messages`, and an explicit
   lazy `blockNoteDictionary` loader. `meta.code` must match the filename.
3. Import `AppLocaleMessages` and declare `messages` with
   `satisfies AppLocaleMessages`.
4. Translate every message, including quick-add aliases under
   `plannerCore.quickAdd`. Keep `{{interpolation}}` tokens unchanged.
5. Select the matching BlockNote dictionary explicitly. If BlockNote does not
   provide it, add a reviewed local dictionary; never silently use English.
6. Add plural categories (`_one`, `_few`, `_many`, `_other`, as required by the
   locale) for every count-dependent noun phrase.
7. Run `npm run i18n:check`, `npm run typecheck`, and `npm run build`.

Top-level files are discovered and lazy-loaded automatically. No component,
router, settings, or bootstrap change is required. `en-XA` is a development-only
pseudo locale for overflow and untranslated-string QA and is hidden in production.

Locale changes are transactional. Locoris preloads the message catalog and the
BlockNote dictionary before saving a new interface language. A failed chunk or
dictionary load keeps the previous language and preference and shows a dismissible
global notice.

Spellcheck is an independent multi-value preference. The capability adapters in
`src/localization/spellcheckCapabilities.ts` select Web, Tauri Desktop, or Android
native behavior. BlockNote blocks receive per-script language hints so mixed-script
documents can use several selected dictionaries at once; languages sharing a script
use the primary native dictionary hint.

Locale packs contain product language only. Regional locale identifiers must not
be stored as translated strings; use `LocaleRuntime` and the helpers in
`src/localization/formatters.ts` for dates, time, numbers, lists, sorting, and bytes.
The localization audit rejects direct `Intl.*` calls outside this layer, empty
messages, interpolation drift, and incomplete plural categories. It runs in every
Tauri GitHub Actions workflow before packaging.

Production interface locales currently include English (`en`), Russian (`ru`),
German (`de`), Latin American Spanish (`es-419`), French (`fr`), Brazilian
Portuguese (`pt-BR`), Italian (`it`), Japanese (`ja`), Korean (`ko`), and
Simplified Chinese (`zh-CN`). The Spanish pack resolves Latin American system
variants such as `es-MX` and `es-AR`; while it is the only Spanish pack, other
`es-*` variants also resolve to it by language. The Brazilian pack is intentionally
`pt-BR`, not generic `pt`; while it is the only Portuguese pack, `pt` and other
`pt-*` system locales resolve to it.

Simplified Chinese resolves `zh-Hans`, `zh-SG`, and `zh-MY`. Traditional Chinese
variants such as `zh-TW`, `zh-Hant`, and `zh-HK` deliberately fall back to English
until a reviewed Traditional Chinese pack exists; a script-aware fallback must
never silently show Simplified Chinese to those users. Every production pack loads
its explicit BlockNote dictionary (`de`, `es`, `fr`, `pt`, `it`, `ja`, `ko`, or
`zh`) instead of silently falling back to the editor's English catalog.
