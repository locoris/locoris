import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { getLocaleDisplayName } from "./localePacks";
import "./LocaleChangeNotice.css";

export type LocaleChangeFailureNotice = {
  id: number;
  requestedLocale: string;
  previousLocale: string;
};

export default function LocaleChangeNotice({
  notice,
  onDismiss
}: {
  notice: LocaleChangeFailureNotice | null;
  onDismiss: () => void;
}) {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeout = window.setTimeout(onDismiss, 9000);
    return () => window.clearTimeout(timeout);
  }, [notice, onDismiss]);

  if (!notice || typeof document === "undefined") {
    return null;
  }

  const displayLocale = i18n.resolvedLanguage ?? notice.previousLocale;

  return createPortal(
    <div className="locale-change-notice" role="alert" aria-live="assertive">
      <span className="locale-change-notice-icon" aria-hidden="true">!</span>
      <p>
        {t("settings.localeChangeFailed", {
          language: getLocaleDisplayName(notice.requestedLocale, displayLocale),
          previousLanguage: getLocaleDisplayName(notice.previousLocale, displayLocale)
        })}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("settings.localeChangeNoticeClose")}
      >
        ×
      </button>
    </div>,
    document.body
  );
}
