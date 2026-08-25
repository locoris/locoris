import { useEffect, useRef, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import "./AccountCloudIdentity.css";

export type AccountCloudUsageMeter = {
  key: string;
  label: string;
  valueLabel: string;
  ratio: number | null;
  tone: "default" | "success" | "warning" | "error";
};

type AccountCloudIdentityProps = {
  connected: boolean;
  authRequired: boolean;
  readOnly: boolean;
  online: boolean;
  busyKey: string | null;
  displayName: string;
  currentProfileName: string;
  email: string;
  profileDescription: string;
  profileDraft: string;
  profileEditing: boolean;
  planLabel: string;
  periodLabel: string;
  usageMeters: AccountCloudUsageMeter[];
  onBeginProfileEdit: () => void;
  onProfileDraftChange: (value: string) => void;
  onCancelProfileEdit: () => void;
  onSaveProfile: () => void;
  onSignIn: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
};

function CloudGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6.4 18h11a3.7 3.7 0 0 0 .4-7.4A6.1 6.1 0 0 0 6 8.8 4.7 4.7 0 0 0 6.4 18Z" />
      <path d="M9 14h6M12 11v6" />
    </svg>
  );
}

function EditGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="m4.2 13.9-.5 2.4 2.4-.5 8.3-8.3-1.9-1.9-8.3 8.3Z" />
      <path d="m11.7 6.4 1.9 1.9" />
    </svg>
  );
}

function RefreshGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M15.4 7.4A5.7 5.7 0 0 0 5.6 5.2L4.2 7" />
      <path d="M4.2 4.1V7h3M4.6 12.6a5.7 5.7 0 0 0 9.8 2.2l1.4-1.8M15.8 15.9V13h-3" />
    </svg>
  );
}

function SignOutGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M8.1 4H5.4A1.4 1.4 0 0 0 4 5.4v9.2A1.4 1.4 0 0 0 5.4 16h2.7" />
      <path d="M12.3 6.5 15.8 10l-3.5 3.5M7.3 10h8.2" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="m4.6 10.3 3.3 3.4 7.6-7.5" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="m5.2 5.2 9.6 9.6M14.8 5.2l-9.6 9.6" />
    </svg>
  );
}

export default function AccountCloudIdentity({
  connected,
  authRequired,
  readOnly,
  online,
  busyKey,
  displayName,
  currentProfileName,
  email,
  profileDescription,
  profileDraft,
  profileEditing,
  planLabel,
  periodLabel,
  usageMeters,
  onBeginProfileEdit,
  onProfileDraftChange,
  onCancelProfileEdit,
  onSaveProfile,
  onSignIn,
  onRefresh,
  onSignOut
}: AccountCloudIdentityProps) {
  const { t } = useTranslation();
  const profileInputRef = useRef<HTMLInputElement | null>(null);
  const profileCanSave = profileDraft.trim().length > 0 && profileDraft.trim() !== currentProfileName.trim();
  const statusTone = authRequired ? "warning" : readOnly ? "warning" : connected ? "ready" : "muted";
  const statusLabel = authRequired
    ? t("settings.hostedReconnect")
    : readOnly
      ? t("settings.accountCloudReadOnlyTitle")
      : connected
        ? t("settings.accountCloudReady")
        : t("settings.accountCloudSignedOut");

  useEffect(() => {
    if (!profileEditing) {
      return;
    }

    const timer = window.setTimeout(() => {
      profileInputRef.current?.focus({ preventScroll: true });
      profileInputRef.current?.select();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [profileEditing]);

  const handleProfileSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (profileCanSave && !busyKey && online && !authRequired) {
      onSaveProfile();
    }
  };

  const handleProfileKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancelProfileEdit();
    }
  };

  return (
    <section className={`account-cloud-identity is-${statusTone}`} aria-label={t("settings.accountCloudStatusTitle")}>
      <div className="account-cloud-identity-topline">
        <div className="account-cloud-identity-main">
          <span className="account-cloud-identity-icon" aria-hidden="true">
            <CloudGlyph />
          </span>

          <div className="account-cloud-identity-copy">
            {profileEditing ? (
              <form className="account-cloud-profile-inline" onSubmit={handleProfileSubmit}>
                <input
                  ref={profileInputRef}
                  type="text"
                  value={profileDraft}
                  maxLength={120}
                  aria-label={t("settings.accountCloudProfileNameLabel")}
                  placeholder={t("settings.accountCloudProfileNamePlaceholder")}
                  disabled={Boolean(busyKey) || !online || authRequired}
                  onChange={(event) => onProfileDraftChange(event.target.value)}
                  onKeyDown={handleProfileKeyDown}
                />
                <button
                  type="submit"
                  className="account-cloud-profile-icon-action is-save"
                  disabled={!profileCanSave || Boolean(busyKey) || !online || authRequired}
                  aria-label={t("settings.accountCloudProfileSave")}
                  title={t("settings.accountCloudProfileSave")}
                >
                  <CheckGlyph />
                </button>
                <button
                  type="button"
                  className="account-cloud-profile-icon-action"
                  disabled={Boolean(busyKey)}
                  aria-label={t("dialog.cancel")}
                  title={t("dialog.cancel")}
                  onClick={onCancelProfileEdit}
                >
                  <CloseGlyph />
                </button>
              </form>
            ) : (
              <div className="account-cloud-identity-titleline">
                <h3>{displayName}</h3>
                {connected ? (
                  <button
                    type="button"
                    className="account-cloud-profile-edit"
                    disabled={Boolean(busyKey) || !online || authRequired}
                    aria-label={t("settings.accountCloudProfileNameLabel")}
                    title={t("settings.accountCloudProfileNameLabel")}
                    onClick={onBeginProfileEdit}
                  >
                    <EditGlyph />
                  </button>
                ) : null}
              </div>
            )}
            <span className="account-cloud-identity-description">
              {email || profileDescription}
            </span>
            <div className="account-cloud-identity-chips">
              <span className={`is-${statusTone}`}>{statusLabel}</span>
              {connected ? <span>{planLabel}</span> : null}
              {connected && periodLabel ? <span>{periodLabel}</span> : null}
            </div>
          </div>
        </div>

        {connected ? (
          <div className="account-cloud-identity-usage">
            {usageMeters.length > 0
              ? usageMeters.map((meter) => (
                  <div
                    key={meter.key}
                    className={`account-cloud-identity-meter is-${meter.tone} ${meter.ratio === null ? "is-unlimited" : ""}`}
                    style={{ "--account-cloud-meter-fill": `${(meter.ratio ?? 1) * 100}%` } as CSSProperties}
                  >
                    <span>{meter.label}</span>
                    <strong>{meter.valueLabel}</strong>
                    <span
                      className="account-cloud-identity-track"
                      role={meter.ratio === null ? undefined : "progressbar"}
                      aria-label={meter.label}
                      aria-valuemin={meter.ratio === null ? undefined : 0}
                      aria-valuemax={meter.ratio === null ? undefined : 100}
                      aria-valuenow={meter.ratio === null ? undefined : Math.round(meter.ratio * 100)}
                    >
                      <span />
                    </span>
                  </div>
                ))
              : [t("settings.accountCloudVaults"), t("settings.accountCloudDevices"), t("settings.accountCloudStorage")].map(
                  (label) => (
                    <div key={label} className="account-cloud-identity-meter is-loading" aria-hidden="true">
                      <span>{label}</span>
                      <strong>—</strong>
                      <span className="account-cloud-identity-track"><span /></span>
                    </div>
                  )
                )}
          </div>
        ) : null}

        <div className="account-cloud-identity-actions">
          {!connected || authRequired ? (
            <button type="button" className="account-cloud-primary-action" onClick={onSignIn}>
              {authRequired ? t("settings.hostedReconnect") : t("settings.accountCloudSignIn")}
            </button>
          ) : null}
          {connected ? (
            <>
              {!authRequired ? (
                <button
                  type="button"
                  className="account-cloud-icon-button"
                  disabled={Boolean(busyKey) || !online}
                  aria-label={t("sync.hostedRefresh")}
                  title={t("sync.hostedRefresh")}
                  onClick={onRefresh}
                >
                  <RefreshGlyph />
                </button>
              ) : null}
              <button
                type="button"
                className="account-cloud-icon-button is-danger"
                disabled={Boolean(busyKey)}
                aria-label={t("sync.hostedLogout")}
                title={t("sync.hostedLogout")}
                onClick={onSignOut}
              >
                <SignOutGlyph />
              </button>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
