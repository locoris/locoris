import { type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import MobileGlassHeader from "./MobileGlassHeader";
import SettingsSurface from "./SettingsSurface";
import "./OrbitalMobileAccountSheet.css";

type MobileAccountTone = "default" | "success" | "warning" | "error";

type MobileAccountStatus = {
  tone: MobileAccountTone;
  text: string;
  compactText?: string;
  title: string;
  description: string;
  primaryActionLabel: string;
  secondaryActionLabel?: string;
  metaItems?: Array<{
    label: string;
    value: string;
    tone?: MobileAccountTone;
  }>;
  meters?: Array<{
    label: string;
    valueLabel: string;
    ratio: number | null;
    tone?: MobileAccountTone;
  }>;
  notice?: string;
};

interface OrbitalMobileAccountSheetProps {
  status: MobileAccountStatus | null | undefined;
  onOpenAccount?: () => void;
  onExportVault?: () => void | Promise<void>;
  onClose: () => void;
}

function AccountGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8.2" r="3.25" />
      <path d="M5.7 18.5a6.4 6.4 0 0 1 12.6 0" />
    </svg>
  );
}

function CloudGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7.1 17.1h9.6a3.7 3.7 0 0 0 .4-7.4 5.4 5.4 0 0 0-10.3-1.4A4.6 4.6 0 0 0 7.1 17.1Z" />
      <path d="M9.3 13.1h5.4" />
    </svg>
  );
}

function ExportGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6.4 18.8h11.2" />
      <path d="M12 4.8v9.2" />
      <path d="m8.6 10.8 3.4 3.4 3.4-3.4" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m7 7 10 10M17 7 7 17" />
    </svg>
  );
}

export default function OrbitalMobileAccountSheet({
  status,
  onOpenAccount,
  onExportVault,
  onClose
}: OrbitalMobileAccountSheetProps) {
  const { t } = useTranslation();
  const metaItems = status?.metaItems ?? [];
  const meters = status?.meters ?? [];
  const tone = status?.tone ?? "default";
  const title = status?.title ?? t("settings.accountCloudNoAccountTitle");
  const description = status?.description ?? t("settings.accountCloudNoAccountDescription");
  const actionLabel = status?.primaryActionLabel ?? t("settings.accountCloudSignIn");

  return (
    <SettingsSurface
      className={`orbital-mobile-account-sheet is-${tone}`}
      role="region"
      aria-label={t("orbit.mobileAccountTitle")}
    >
      <MobileGlassHeader
        className="settings-panel-header orbital-mobile-account-header is-root-action"
        title={t("orbit.mobileAccountKicker")}
        closeLabel={t("dialog.cancel")}
        closeIcon={<CloseGlyph />}
        onClose={onClose}
      />

      <div className="orbital-mobile-account-content">
        <div className="orbital-mobile-account-hero">
          <span className="orbital-mobile-account-avatar" aria-hidden="true">
            <AccountGlyph />
          </span>
          <div className="orbital-mobile-account-hero-copy">
            <span className={`orbital-mobile-account-status is-${tone}`}>{status?.text ?? t("settings.accountCloudSignedOut")}</span>
            <strong>{title}</strong>
            <p>{description}</p>
          </div>
        </div>

        {metaItems.length ? (
          <div className="orbital-mobile-account-meta" aria-label={title}>
            {metaItems.map((item) => (
              <div key={`${item.label}-${item.value}`} className={`orbital-mobile-account-meta-item is-${item.tone ?? "default"}`}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        ) : null}

        {meters.length ? (
          <div className="orbital-mobile-account-meters">
            {meters.map((meter) => {
              const clampedRatio =
                meter.ratio === null || !Number.isFinite(meter.ratio)
                  ? 1
                  : Math.max(0, Math.min(1, meter.ratio));

              return (
                <div
                  key={meter.label}
                  className={`orbital-mobile-account-meter is-${meter.tone ?? "default"} ${
                    meter.ratio === null ? "is-unlimited" : ""
                  }`}
                  style={{ "--mobile-account-meter-fill": `${clampedRatio * 100}%` } as CSSProperties}
                >
                  <div className="orbital-mobile-account-meter-copy">
                    <span>{meter.label}</span>
                    <strong>{meter.valueLabel}</strong>
                  </div>
                  <span className="orbital-mobile-account-meter-track" aria-hidden="true">
                    <span />
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}

        {status?.notice ? <p className="orbital-mobile-account-notice">{status.notice}</p> : null}

        <div className="orbital-mobile-account-actions">
          {onOpenAccount ? (
            <button
              type="button"
              className="is-primary"
              onClick={() => {
                onClose();
                onOpenAccount();
              }}
            >
              <CloudGlyph />
              <span>{actionLabel}</span>
            </button>
          ) : null}
          {status?.secondaryActionLabel && onExportVault ? (
            <button type="button" className="is-secondary" onClick={() => void onExportVault()}>
              <ExportGlyph />
              <span>{status.secondaryActionLabel}</span>
            </button>
          ) : null}
        </div>
      </div>
    </SettingsSurface>
  );
}
