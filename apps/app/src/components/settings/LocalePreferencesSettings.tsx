import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  detectSystemLocale,
  COMMON_FORMAT_LOCALES,
  COMMON_SPELLCHECK_LOCALES,
  formatDateForLocale,
  formatNumberValue,
  formatTimeValue,
  getSpellcheckCapabilityAdapter,
  getLocaleDisplayName,
  getLocaleDirection,
  getNativeLocaleName,
  loadLocaleOptions,
  type ClientLocalePreferences,
  type LocaleOption,
  type LocaleRuntime,
  type WeekdayNumber
} from "../../localization";
import "./LocalePreferencesSettings.css";

type LocalePreferencesSettingsProps = {
  preferences: ClientLocalePreferences;
  runtime: LocaleRuntime;
  onChange: (patch: Partial<ClientLocalePreferences>) => void | Promise<void>;
};

type LocalePreferencesDestinationProps = {
  runtime: LocaleRuntime;
  onOpen: () => void;
};

type SelectOption = {
  value: string;
  label: string;
};

type LocaleControlIconKind = "language" | "region" | "week" | "time" | "spellcheck";

function LocaleControlIcon({ kind }: { kind: LocaleControlIconKind }) {
  if (kind === "language") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 5h8M8 3v2m3 0c-.7 4.1-3.1 7.4-6.7 9.4M6 9c1.3 2.3 3 4.1 5.1 5.4M14 20l3.5-9 3.5 9M15.2 17h4.6" />
      </svg>
    );
  }

  if (kind === "region") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="9" />
        <path d="M3.6 9h16.8M3.6 15h16.8M12 3c2.2 2.5 3.3 5.5 3.3 9S14.2 18.5 12 21c-2.2-2.5-3.3-5.5-3.3-9S9.8 5.5 12 3Z" />
      </svg>
    );
  }

  if (kind === "week") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M8 3v4M16 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
      </svg>
    );
  }

  if (kind === "time") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m4 16 3 3 5-6M4 5h8M8 3v2m3 0c-.5 3-2.1 5.5-4.6 7.2M14 20l3.5-9 3.5 9M15.2 17h4.6" />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function SelectChevronGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m6 12 4 4 8-9" />
    </svg>
  );
}

function getLocalePreview(runtime: LocaleRuntime) {
  const previewDate = new Date(2026, 6, 16, 16, 30);

  return {
    date: formatDateForLocale(previewDate, runtime.formatLocale, {
      day: "numeric",
      month: "short",
      year: "numeric"
    }),
    time: formatTimeValue(previewDate, runtime),
    number: formatNumberValue(12345.67, runtime, { maximumFractionDigits: 2 })
  };
}

export function LocalePreferencesDestination({
  runtime,
  onOpen
}: LocalePreferencesDestinationProps) {
  const { t } = useTranslation();
  const preview = getLocalePreview(runtime);

  return (
    <button
      type="button"
      className="locale-preferences-destination"
      onClick={onOpen}
    >
      <span className="locale-preferences-destination-icon" aria-hidden="true">
        <LocaleControlIcon kind="language" />
      </span>
      <span className="locale-preferences-destination-copy">
        <span className="panel-kicker settings-panel-block-kicker">
          {t("settings.interfaceLanguageKicker")}
        </span>
        <strong>{t("settings.localePreferencesTitle")}</strong>
        <span>{t("settings.localePreferencesDescription")}</span>
      </span>
      <span className="locale-preferences-destination-preview" aria-hidden="true">
        <strong>{getNativeLocaleName(runtime.interfaceLocale)}</strong>
        <span>{preview.date} · {preview.time}</span>
      </span>
      <span className="locale-preferences-destination-chevron" aria-hidden="true">
        <ChevronGlyph />
      </span>
    </button>
  );
}

function LocaleSelect({
  id,
  value,
  options,
  label,
  onChange
}: {
  id: string;
  value: string;
  options: SelectOption[];
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="locale-preferences-select" htmlFor={id}>
      <span className="sr-only">{label}</span>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="locale-preferences-select-chevron" aria-hidden="true">
        <SelectChevronGlyph />
      </span>
    </label>
  );
}

function LocaleSectionHeader({
  kind,
  kicker,
  title,
  description
}: {
  kind: LocaleControlIconKind;
  kicker: string;
  title: string;
  description: string;
}) {
  return (
    <header className="locale-preferences-section-head">
      <span className={`locale-preferences-section-icon is-${kind}`} aria-hidden="true">
        <LocaleControlIcon kind={kind} />
      </span>
      <span className="locale-preferences-section-copy">
        <span className="panel-kicker settings-panel-block-kicker">{kicker}</span>
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
    </header>
  );
}

function LocaleControlRow({
  kind,
  title,
  description,
  children,
  index
}: {
  kind: LocaleControlIconKind;
  title: string;
  description: string;
  children: ReactNode;
  index: number;
}) {
  return (
    <div
      className="locale-preferences-control-row"
      style={{ "--locale-row-index": index } as CSSProperties}
    >
      <span className={`locale-preferences-control-icon is-${kind}`} aria-hidden="true">
        <LocaleControlIcon kind={kind} />
      </span>
      <span className="locale-preferences-control-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
      <span className="locale-preferences-control">{children}</span>
    </div>
  );
}

export default function LocalePreferencesSettings({
  preferences,
  runtime,
  onChange
}: LocalePreferencesSettingsProps) {
  const { t, i18n } = useTranslation();
  const [localeOptions, setLocaleOptions] = useState<LocaleOption[]>(() => [{
    code: runtime.interfaceLocale,
    shortCode: runtime.interfaceLocale.split("-")[0]?.slice(0, 2).toUpperCase() ?? "EN",
    nativeName: getNativeLocaleName(runtime.interfaceLocale),
    direction: getLocaleDirection(runtime.interfaceLocale)
  }]);

  useEffect(() => {
    let active = true;

    void loadLocaleOptions().then((options) => {
      if (active) {
        setLocaleOptions(options);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  const systemLocale = detectSystemLocale();
  const preview = getLocalePreview(runtime);
  const interfaceOptions = useMemo<SelectOption[]>(() => [
    {
      value: "system",
      label: t("settings.localeSystemLanguage", {
        language: localeOptions.find((option) => option.code === systemLocale)?.nativeName ?? systemLocale
      })
    },
    ...localeOptions.map((option) => ({
      value: option.code,
      label: `${option.nativeName} · ${option.shortCode}`
    }))
  ], [i18n.resolvedLanguage, localeOptions, systemLocale, t]);
  const formatOptions = useMemo<SelectOption[]>(() => {
    const values = new Set<string>([
      ...localeOptions.map((option) => option.code),
      ...COMMON_FORMAT_LOCALES,
      runtime.formatLocale
    ]);

    return [
      { value: "system", label: t("settings.localeSystemFormat") },
      ...Array.from(values).map((code) => {
        try {
          return { value: code, label: getLocaleDisplayName(code, runtime.interfaceLocale) };
        } catch {
          return { value: code, label: code };
        }
      })
    ];
  }, [i18n.resolvedLanguage, localeOptions, runtime.formatLocale, runtime.interfaceLocale, t]);
  const weekOptions: SelectOption[] = [
    { value: "region", label: t("settings.localeWeekRegion") },
    { value: "1", label: t("settings.localeWeekMonday") },
    { value: "6", label: t("settings.localeWeekSaturday") },
    { value: "7", label: t("settings.localeWeekSunday") }
  ];
  const timeOptions: SelectOption[] = [
    { value: "region", label: t("settings.localeTimeRegion") },
    { value: "h23", label: t("settings.localeTime24") },
    { value: "h12", label: t("settings.localeTime12") }
  ];
  const spellcheckOptions: SelectOption[] = [
    { value: "system", label: t("settings.localeSpellcheckSystem") },
    { value: "languages", label: t("settings.localeSpellcheckLanguage") },
    { value: "off", label: t("settings.localeSpellcheckOff") }
  ];
  const selectedSpellcheckLanguages = preferences.spellcheck.languages.length > 0
    ? preferences.spellcheck.languages
    : [runtime.interfaceLocale];
  const weekStartLabel = formatDateForLocale(
    new Date(2026, 6, 13 + runtime.weekStartsOn - 1, 12),
    runtime.formatLocale,
    { weekday: "long" }
  );
  const spellcheckSummary = preferences.spellcheck.mode === "languages"
    ? selectedSpellcheckLanguages
      .map((code) => getLocaleDisplayName(code, runtime.interfaceLocale))
      .join(", ")
    : t(
      preferences.spellcheck.mode === "off"
        ? "settings.localeSpellcheckOff"
        : "settings.localeSpellcheckSystem"
    );
  const spellcheckLanguageOptions = useMemo(() => {
    const codes = new Set([
      ...localeOptions.map((option) => option.code),
      ...COMMON_SPELLCHECK_LOCALES,
      ...selectedSpellcheckLanguages
    ]);

    return [...codes]
      .filter((code) => code !== "en-XA")
      .map((code) => ({
        code,
        shortCode: code.split("-")[0]?.slice(0, 2).toUpperCase() ?? code.slice(0, 2).toUpperCase(),
        nativeName: getLocaleDisplayName(code, code)
      }));
  }, [localeOptions, selectedSpellcheckLanguages]);
  const spellcheckAdapter = getSpellcheckCapabilityAdapter();
  const spellcheckCapabilityKey = {
    web: "settings.localeSpellcheckCapabilityWeb",
    desktop: "settings.localeSpellcheckCapabilityDesktop",
    android: "settings.localeSpellcheckCapabilityAndroid"
  }[spellcheckAdapter.platform];
  const applyChange = async (patch: Partial<ClientLocalePreferences>) => {
    try {
      await onChange(patch);
    } catch {
      // LocaleProvider already rolled back and presented the global error notice.
    }
  };

  return (
    <div className="locale-preferences-page">
      <section className="locale-preferences-summary" aria-label={t("settings.localePreferencesTitle")}>
        <span className="locale-preferences-summary-orb" aria-hidden="true">
          <LocaleControlIcon kind="language" />
        </span>
        <span className="locale-preferences-summary-copy">
          <span className="panel-kicker settings-panel-block-kicker">
            {getNativeLocaleName(runtime.interfaceLocale)}
          </span>
          <strong>{preview.date} · {preview.time}</strong>
          <span>{preview.number} · {runtime.formatLocale}</span>
        </span>
        <span className="locale-preferences-summary-details">
          <span>
            <span className="locale-preferences-summary-detail-icon" aria-hidden="true">
              <LocaleControlIcon kind="week" />
            </span>
            <span>
              <small>{t("settings.localeWeekTitle")}</small>
              <strong>{weekStartLabel}</strong>
            </span>
          </span>
          <span>
            <span className="locale-preferences-summary-detail-icon" aria-hidden="true">
              <LocaleControlIcon kind="time" />
            </span>
            <span>
              <small>{t("settings.localeTimeTitle")}</small>
              <strong>{runtime.hourCycle === "h12" ? "12 h" : "24 h"}</strong>
            </span>
          </span>
          <span>
            <span className="locale-preferences-summary-detail-icon" aria-hidden="true">
              <LocaleControlIcon kind="spellcheck" />
            </span>
            <span>
              <small>{t("settings.localeSpellcheckTitle")}</small>
              <strong>{spellcheckSummary}</strong>
            </span>
          </span>
        </span>
      </section>

      <section className="locale-preferences-section is-language">
        <LocaleSectionHeader
          kind="language"
          kicker={t("settings.interfaceLanguageKicker")}
          title={t("settings.language")}
          description={t("settings.languageDescription")}
        />
        <div className="locale-preferences-primary-control">
          <LocaleSelect
            id="settings-interface-language"
            value={preferences.interfaceLanguage}
            options={interfaceOptions}
            label={t("settings.language")}
            onChange={(interfaceLanguage) => void applyChange({ interfaceLanguage })}
          />
        </div>
      </section>

      <section className="locale-preferences-section is-region">
        <LocaleSectionHeader
          kind="region"
          kicker={t("settings.localeFormatTitle")}
          title={t("settings.localeFormatTitle")}
          description={t("settings.localeFormatDescription")}
        />
        <div className="locale-preferences-row-list">
          <LocaleControlRow
            kind="region"
            title={t("settings.localeFormatTitle")}
            description={preview.date}
            index={1}
          >
            <LocaleSelect
              id="settings-format-locale"
              value={preferences.formatLocale}
              options={formatOptions}
              label={t("settings.localeFormatTitle")}
              onChange={(formatLocale) => void applyChange({ formatLocale })}
            />
          </LocaleControlRow>

          <LocaleControlRow
            kind="week"
            title={t("settings.localeWeekTitle")}
            description={t("settings.localeWeekDescription")}
            index={2}
          >
            <LocaleSelect
              id="settings-week-start"
              value={String(preferences.weekStartsOn)}
              options={weekOptions}
              label={t("settings.localeWeekTitle")}
              onChange={(value) => void applyChange({
                weekStartsOn: value === "region" ? "region" : Number(value) as WeekdayNumber
              })}
            />
          </LocaleControlRow>

          <LocaleControlRow
            kind="time"
            title={t("settings.localeTimeTitle")}
            description={`${t("settings.localeTimeDescription")} ${preview.time}`}
            index={3}
          >
            <LocaleSelect
              id="settings-hour-cycle"
              value={preferences.hourCycle}
              options={timeOptions}
              label={t("settings.localeTimeTitle")}
              onChange={(hourCycle) => void applyChange({
                hourCycle: hourCycle as ClientLocalePreferences["hourCycle"]
              })}
            />
          </LocaleControlRow>
        </div>
      </section>

      <section className="locale-preferences-section is-spellcheck">
        <LocaleSectionHeader
          kind="spellcheck"
          kicker={t("settings.localeSpellcheckTitle")}
          title={t("settings.localeSpellcheckTitle")}
          description={t("settings.localeSpellcheckDescription")}
        />
        <div className="locale-preferences-spellcheck-controls">
          <LocaleSelect
            id="settings-spellcheck-mode"
            value={preferences.spellcheck.mode}
            options={spellcheckOptions}
            label={t("settings.localeSpellcheckTitle")}
            onChange={(mode) => void applyChange({
              spellcheck: {
                mode: mode as ClientLocalePreferences["spellcheck"]["mode"],
                languages:
                  mode === "languages" && preferences.spellcheck.languages.length === 0
                    ? [runtime.interfaceLocale]
                    : preferences.spellcheck.languages
              }
            })}
          />
          {preferences.spellcheck.mode === "languages" ? (
            <div
              className="locale-preferences-spellcheck-languages"
              role="group"
              aria-label={t("settings.localeSpellcheckLanguageLabel")}
            >
              {spellcheckLanguageOptions.map((option) => {
                const selected = selectedSpellcheckLanguages.includes(option.code);
                const onlySelected = selected && selectedSpellcheckLanguages.length === 1;

                return (
                  <button
                    key={option.code}
                    type="button"
                    className={selected ? "is-selected" : ""}
                    aria-pressed={selected}
                    aria-disabled={onlySelected}
                    onClick={() => {
                      if (onlySelected) {
                        return;
                      }

                      const languages = selected
                        ? selectedSpellcheckLanguages.filter((code) => code !== option.code)
                        : [...selectedSpellcheckLanguages, option.code];
                      void applyChange({
                        spellcheck: {
                          mode: "languages",
                          languages
                        }
                      });
                    }}
                  >
                    <span className="locale-preferences-language-mark">{option.shortCode}</span>
                    <strong>{option.nativeName}</strong>
                    <span className="locale-preferences-language-check" aria-hidden="true">
                      {selected ? <CheckGlyph /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <small className="locale-preferences-spellcheck-capability">
            {t(spellcheckCapabilityKey)}
          </small>
        </div>
      </section>

      <p className="locale-preferences-effective">
        {t("settings.localeEffectiveSummary", {
          locale: runtime.formatLocale,
          weekDay: runtime.weekStartsOn,
          time: runtime.hourCycle === "h12" ? "12" : "24"
        })}
      </p>
    </div>
  );
}
