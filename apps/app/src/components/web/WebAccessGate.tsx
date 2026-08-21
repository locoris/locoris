import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { getErrorMessage } from "../../lib/errors";
import type { HostedCloudEntitlement } from "../../types";
import {
  formatByteValue,
  formatDateValue,
  formatNumberValue,
  useLocale,
  type LocaleRuntime
} from "../../localization";
import WebAuthAtmosphere from "./WebAuthAtmosphere";
import "./WebAccessGate.css";

const MARKETING_SITE_URL = (import.meta.env.VITE_LOCORIS_SITE_URL?.trim() || "https://locoris.app").replace(/\/+$/, "");

function marketingUrl(path = "") {
  return `${MARKETING_SITE_URL}${path}`;
}

export type WebAccessMode =
  | "local"
  | "cloud"
  | "cloudPending"
  | "readOnly"
  | "unavailable"
  | "checking"
  | "serverUnavailable"
  | "reauthRequired";
export type WebAuthMode = "login" | "register";

export type WebAuthInput = {
  mode: WebAuthMode;
  email: string;
  password: string;
};

type WebAccessGateProps = {
  enabled: boolean;
  mode: WebAccessMode;
  online: boolean;
  busy: boolean;
  feedback?: {
    tone: "success" | "error";
    text: string;
  } | null;
  accountPortalUrl?: string | null;
  entitlement?: HostedCloudEntitlement | null;
  initialEmail?: string;
  onAuthenticate: (input: WebAuthInput) => Promise<void>;
  onRetry: () => void;
  onOpenCloud: () => void;
  onExportVault: () => void | Promise<void>;
};

function EyeGlyph({ crossed = false }: { crossed?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3.3 12s3.1-5.2 8.7-5.2 8.7 5.2 8.7 5.2-3.1 5.2-8.7 5.2S3.3 12 3.3 12Z" />
      <circle cx="12" cy="12" r="2.3" />
      {crossed ? <path d="m4.5 4.5 15 15" /> : null}
    </svg>
  );
}

function CloudGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7 17h10.2a3.4 3.4 0 0 0 .4-6.8 5.7 5.7 0 0 0-11.1-1.7A4.4 4.4 0 0 0 7 17Z" />
      <path d="M9.1 12.7h5.7M12 9.9v5.7" />
    </svg>
  );
}

function DeviceGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="6.5" y="3.5" width="11" height="17" rx="2.5" />
      <path d="M10 6h4M10.5 17.5h3" />
    </svg>
  );
}

function ShieldGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3.5 19 6v5.2c0 4.4-2.8 7.6-7 9.3-4.2-1.7-7-4.9-7-9.3V6l7-2.5Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function DownloadGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6.2 19h11.6M12 4.8v10m-3.8-3.8L12 15l3.8-3.8" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m6.5 12.2 3.4 3.4 7.6-7.7" />
    </svg>
  );
}

function formatEntitlementDate(timestamp: number | null | undefined, runtime: LocaleRuntime) {
  if (!timestamp) {
    return "";
  }

  return formatDateValue(timestamp, runtime, {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function formatPlanPrice(amountRub: number | undefined, runtime: LocaleRuntime) {
  if (typeof amountRub !== "number") {
    return "";
  }

  return formatNumberValue(amountRub, runtime, {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0
  });
}

function formatPlanStorage(bytes: number | null | undefined, runtime: LocaleRuntime, unlimitedLabel: string) {
  if (bytes === null || bytes === undefined) {
    return unlimitedLabel;
  }

  return formatByteValue(bytes, runtime);
}

function resolveAuthError(message: string, mode: WebAuthMode, t: ReturnType<typeof useTranslation>["t"]) {
  switch (message) {
    case "INVALID_CREDENTIALS":
    case "UNAUTHORIZED":
      return t("webAccess.authInvalidCredentials");
    case "RATE_LIMITED":
      return t("webAccess.authRateLimited");
    case "OVER_DEVICE_LIMIT":
      return t("webAccess.authDeviceLimit");
    case "SERVER_UNAVAILABLE":
    case "HTTP_404":
    case "NOT_FOUND":
      return t("webAccess.authServerUnavailable");
    case "CLOUD_ENDPOINT_NOT_CONFIGURED":
      return t("webAccess.authNotConfigured");
    case "REGISTRATION_FAILED":
    case "EMAIL_ALREADY_EXISTS":
      return t("webAccess.authRegistrationFailed");
    case "PASSWORD_TOO_SHORT":
      return t("webAccess.authPasswordHint");
    case "INVALID_EMAIL":
      return t("webAccess.authInvalidEmail");
    default:
      return mode === "login"
        ? t("webAccess.authInvalidCredentials")
        : t("webAccess.authRegistrationFailed");
  }
}

export default function WebAccessGate({
  enabled,
  mode,
  online,
  busy,
  feedback = null,
  accountPortalUrl = null,
  entitlement = null,
  initialEmail = "",
  onAuthenticate,
  onRetry,
  onOpenCloud,
  onExportVault
}: WebAccessGateProps) {
  const { t } = useTranslation();
  const { runtime: localeRuntime } = useLocale();
  const [authMode, setAuthMode] = useState<WebAuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const unavailable = mode === "unavailable";
  const checking = mode === "checking";
  const serverUnavailable = mode === "serverUnavailable";
  const reauthRequired = mode === "reauthRequired";
  const entitlementReason = entitlement?.reason ?? "";
  const trialExpired = entitlementReason.startsWith("TRIAL_") && entitlementReason !== "TRIAL_ACTIVE";
  const trialRetentionExpired = entitlementReason === "TRIAL_RETENTION_EXPIRED";
  const recommendedPlan = entitlement?.upgradeOffer?.recommendedPlan ?? null;
  const trialEndedLabel = formatEntitlementDate(
    entitlement?.retention?.trialEndsAt ?? entitlement?.trialEndsAt,
    localeRuntime
  );
  const readOnlyUntilLabel = formatEntitlementDate(entitlement?.retention?.readOnlyUntil, localeRuntime);
  const archiveUntilLabel = formatEntitlementDate(entitlement?.retention?.archiveUntil, localeRuntime);
  const recommendedPrice = formatPlanPrice(recommendedPlan?.amountRub, localeRuntime);
  const unlimitedLabel = t("webAccess.unlimited");
  const recommendedLimits = recommendedPlan?.limits ?? null;
  const disabled = busy || submitting || !online;
  const normalizedEmail = email.trim().toLowerCase();
  const passwordStrength = useMemo(() => {
    if (!password) {
      return 0;
    }

    return [
      password.length >= 8,
      password.length >= 12,
      /\p{L}/u.test(password) && /\d/u.test(password),
      /[^\p{L}\d]/u.test(password)
    ].filter(Boolean).length;
  }, [password]);

  useEffect(() => {
    setFormError(null);
    setPassword("");
    setPasswordConfirmation("");
    setShowPassword(false);
    setCapsLock(false);
  }, [authMode]);

  useEffect(() => {
    if (reauthRequired) {
      setAuthMode("login");
      setEmail(initialEmail);
    }
  }, [initialEmail, reauthRequired]);

  if (
    !enabled ||
    !["local", "unavailable", "checking", "serverUnavailable", "reauthRequired"].includes(mode)
  ) {
    return null;
  }

  const validate = () => {
    if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      return t("webAccess.authInvalidEmail");
    }

    if (password.length < 8) {
      return t("webAccess.authPasswordHint");
    }

    if (authMode === "register") {
      if (password !== passwordConfirmation) {
        return t("webAccess.authPasswordsMismatch");
      }

      if (!acceptedLegal) {
        return t("webAccess.authLegalRequired");
      }
    }

    return null;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    const validationError = validate();

    if (validationError) {
      setFormError(validationError);
      return;
    }

    if (!online) {
      setFormError(t("webAccess.authOffline"));
      return;
    }

    setSubmitting(true);

    try {
      await onAuthenticate({
        mode: authMode,
        email: normalizedEmail,
        password
      });
    } catch (error) {
      setFormError(resolveAuthError(getErrorMessage(error), authMode, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="web-auth-page" aria-labelledby="web-auth-title">
      <WebAuthAtmosphere />
      <header className="web-auth-brandbar">
        <a className="web-auth-brand" href={marketingUrl()} aria-label={t("webAccess.authHomeLabel")}>
          <img src="/pwa-icon.svg" alt="" />
          <strong>Locoris</strong>
        </a>
        <a className="web-auth-download-link" href={marketingUrl("/download")} target="_blank" rel="noreferrer">
          <DownloadGlyph />
          <span>{t("webAccess.downloadApp")}</span>
        </a>
      </header>

      <div className="web-auth-layout">
        <section className="web-auth-context" aria-label={t("webAccess.authContextLabel")}>
          <p className="web-auth-kicker">{t("webAccess.authKicker")}</p>
          <h1 id="web-auth-title">
            {unavailable
              ? trialRetentionExpired
                ? t("webAccess.trialRetentionExpiredTitle")
                : trialExpired
                ? t("webAccess.trialExpiredTitle")
                : t("webAccess.unavailableTitle")
              : serverUnavailable
                ? t("webAccess.attentionTitle")
              : reauthRequired
                ? t("webAccess.authReauthTitle")
                : checking
                  ? t("webAccess.authCheckingTitle")
                  : t("webAccess.authTitle")}
          </h1>
          <p className="web-auth-lead">
            {unavailable
              ? trialRetentionExpired
                ? t("webAccess.trialRetentionExpiredDescription")
                : trialExpired
                ? t("webAccess.trialExpiredDescription")
                : t("webAccess.unavailableDescription")
              : serverUnavailable
                ? t("webAccess.authServerUnavailable")
              : reauthRequired
                ? t("webAccess.authReauthDescription")
                : checking
                  ? t("webAccess.authCheckingDescription")
                  : t("webAccess.authDescription")}
          </p>

          <div className={`web-auth-benefits${trialExpired ? " is-conversion" : ""}`}>
            <div>
              <span aria-hidden="true"><CloudGlyph /></span>
              <p>
                <strong>{t(trialExpired ? "webAccess.upgradeSyncTitle" : "webAccess.authCloudBenefitTitle")}</strong>
                {t(trialExpired ? "webAccess.upgradeSyncDescription" : "webAccess.authCloudBenefitDescription")}
              </p>
            </div>
            <div>
              <span aria-hidden="true"><DeviceGlyph /></span>
              <p>
                <strong>{t(trialExpired ? "webAccess.upgradeWebTitle" : "webAccess.authAppsBenefitTitle")}</strong>
                {t(trialExpired ? "webAccess.upgradeWebDescription" : "webAccess.authAppsBenefitDescription")}
              </p>
            </div>
            <div>
              <span aria-hidden="true"><ShieldGlyph /></span>
              <p>
                <strong>{t(trialExpired ? "webAccess.upgradeHistoryTitle" : "webAccess.authSecurityBenefitTitle")}</strong>
                {t(trialExpired ? "webAccess.upgradeHistoryDescription" : "webAccess.authSecurityBenefitDescription")}
              </p>
            </div>
          </div>

          <div className="web-auth-app-note">
            <strong>{t("webAccess.authNoAccountTitle")}</strong>
            <p>{t("webAccess.authNoAccountDescription")}</p>
            <a href={marketingUrl("/download")} target="_blank" rel="noreferrer">
              {t("webAccess.authDownloadApps")}
            </a>
          </div>
        </section>

        <section className="web-auth-panel" aria-label={unavailable ? t("webAccess.unavailableTitle") : t("webAccess.authPanelLabel")}>
          {checking ? (
            <div className="web-auth-unavailable is-checking" aria-live="polite">
              <span className="web-auth-panel-icon" aria-hidden="true"><CloudGlyph /></span>
              <p className="web-auth-panel-kicker">{t("webAccess.authSecureAccess")}</p>
              <h2>{t("webAccess.authCheckingTitle")}</h2>
              <p>{t("webAccess.authCheckingDescription")}</p>
              <span className="web-auth-checking-indicator" aria-hidden="true" />
            </div>
          ) : serverUnavailable ? (
            <div className="web-auth-unavailable" aria-live="polite">
              <span className="web-auth-panel-icon" aria-hidden="true"><CloudGlyph /></span>
              <p className="web-auth-panel-kicker">{t("webAccess.authSecureAccess")}</p>
              <h2>{t("webAccess.attentionTitle")}</h2>
              <p>{t("webAccess.authServerUnavailable")}</p>
              <div className="web-auth-unavailable-actions">
                <button type="button" className="web-auth-primary-action" disabled={!online} onClick={onRetry}>
                  {t("sync.hostedRefresh")}
                </button>
                <a className="web-auth-secondary-action" href={marketingUrl("/download")} target="_blank" rel="noreferrer">
                  {t("webAccess.downloadApp")}
                </a>
              </div>
            </div>
          ) : unavailable ? (
            <div className={`web-auth-unavailable${trialExpired ? " is-upgrade" : ""}`}>
              <span className="web-auth-panel-icon" aria-hidden="true"><CloudGlyph /></span>
              <p className="web-auth-panel-kicker">
                {t(trialExpired ? "webAccess.trialExpiredKicker" : "webAccess.authAccountStatus")}
              </p>
              <h2>{t(trialExpired ? "webAccess.trialExpiredPanelTitle" : "webAccess.unavailableTitle")}</h2>
              <p>
                {t(
                  trialRetentionExpired
                    ? "webAccess.trialRetentionExpiredPanelDescription"
                    : trialExpired
                      ? "webAccess.trialExpiredPanelDescription"
                      : "webAccess.unavailableActionDescription"
                )}
              </p>

              {trialExpired ? (
                <>
                  <div className="web-auth-entitlement-facts" aria-label={t("webAccess.trialTimelineLabel")}>
                    {trialEndedLabel ? (
                      <span className="web-auth-state-chip is-expired">
                        {t("webAccess.trialEndedOn", { date: trialEndedLabel })}
                      </span>
                    ) : null}
                    {readOnlyUntilLabel && entitlementReason === "TRIAL_EXPIRED_READ_ONLY" ? (
                      <span className="web-auth-state-chip">
                        {t("webAccess.trialReadOnlyUntil", { date: readOnlyUntilLabel })}
                      </span>
                    ) : null}
                    {archiveUntilLabel && entitlementReason === "TRIAL_ARCHIVED" ? (
                      <span className="web-auth-state-chip">
                        {t("webAccess.trialArchiveUntil", { date: archiveUntilLabel })}
                      </span>
                    ) : null}
                  </div>

                  <div className="web-auth-data-assurance">
                    <ShieldGlyph />
                    <p>
                      <strong>
                        {t(trialRetentionExpired ? "webAccess.localDataSafeTitle" : "webAccess.trialDataSafeTitle")}
                      </strong>
                      {t(
                        trialRetentionExpired
                          ? "webAccess.localDataSafeDescription"
                          : "webAccess.trialDataSafeDescription"
                      )}
                    </p>
                  </div>

                  {recommendedPlan ? (
                    <div className="web-auth-upgrade-offer">
                      <div>
                        <p className="web-auth-panel-kicker">{t("webAccess.recommendedPlan")}</p>
                        <strong>{recommendedPlan.name}</strong>
                      </div>
                      <p className="web-auth-upgrade-price">
                        <strong>{recommendedPrice}</strong>
                        <span>{t("webAccess.perMonth")}</span>
                      </p>
                      <ul>
                        <li>
                          <CheckGlyph />
                          {t("webAccess.planVaultLimit", {
                            count: recommendedLimits?.maxVaults ?? unlimitedLabel
                          })}
                        </li>
                        <li>
                          <CheckGlyph />
                          {t("webAccess.planDeviceLimit", {
                            count: recommendedLimits?.maxSyncTokens ?? unlimitedLabel
                          })}
                        </li>
                        <li>
                          <CheckGlyph />
                          {t("webAccess.planStorageLimit", {
                            storage: formatPlanStorage(recommendedLimits?.storageBytes, localeRuntime, unlimitedLabel)
                          })}
                        </li>
                        <li>
                          <CheckGlyph />
                          {t("webAccess.planHistoryLimit", {
                            history:
                              typeof recommendedLimits?.historyDays === "number"
                                ? t("webAccess.planHistoryDays", { days: recommendedLimits.historyDays })
                                : unlimitedLabel
                          })}
                        </li>
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : null}

              <div className="web-auth-unavailable-actions">
                {accountPortalUrl ? (
                  <a className="web-auth-primary-action" href={accountPortalUrl} target="_blank" rel="noreferrer">
                    {t(trialExpired ? "webAccess.subscribeAction" : "webAccess.authOpenAccountPortal")}
                  </a>
                ) : (
                  <button type="button" className="web-auth-primary-action" onClick={onOpenCloud}>
                    {t("webAccess.manageCloud")}
                  </button>
                )}
                <button type="button" className="web-auth-secondary-action" disabled={busy} onClick={() => void onExportVault()}>
                  {t("webAccess.exportVault")}
                </button>
              </div>
              {trialExpired ? <p className="web-auth-upgrade-note">{t("webAccess.upgradeNote")}</p> : null}
              {feedback ? <div className={`web-auth-feedback is-${feedback.tone}`}>{feedback.text}</div> : null}
            </div>
          ) : (
            <>
              <div className="web-auth-panel-head">
                <p className="web-auth-panel-kicker">{t("webAccess.authSecureAccess")}</p>
                <h2>
                  {reauthRequired
                    ? t("webAccess.authReauthPanelTitle")
                    : authMode === "login"
                      ? t("webAccess.authLoginTitle")
                      : t("webAccess.authRegisterTitle")}
                </h2>
                <p>
                  {reauthRequired
                    ? t("webAccess.authReauthPanelDescription")
                    : authMode === "login"
                      ? t("webAccess.authLoginDescription")
                      : t("webAccess.authRegisterDescription")}
                </p>
              </div>

              {!reauthRequired ? <div className="web-auth-mode-switch" aria-label={t("webAccess.authModeLabel")}>
                <button type="button" className={authMode === "login" ? "is-active" : ""} aria-pressed={authMode === "login"} onClick={() => setAuthMode("login")}>
                  {t("webAccess.authLoginTab")}
                </button>
                <button type="button" className={authMode === "register" ? "is-active" : ""} aria-pressed={authMode === "register"} onClick={() => setAuthMode("register")}>
                  {t("webAccess.authRegisterTab")}
                </button>
              </div> : null}

              <form className="web-auth-form" noValidate onSubmit={handleSubmit}>
                <label className="web-auth-field">
                  <span>{t("webAccess.authEmailLabel")}</span>
                  <input
                    type="email"
                    inputMode="email"
                    value={email}
                    maxLength={254}
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    disabled={disabled}
                    placeholder="name@example.com"
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>

                <label className="web-auth-field">
                  <span>{t("webAccess.authPasswordLabel")}</span>
                  <span className="web-auth-password-control">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      minLength={8}
                      maxLength={256}
                      autoComplete={authMode === "login" ? "current-password" : "new-password"}
                      disabled={disabled}
                      placeholder={t("webAccess.authPasswordPlaceholder")}
                      onKeyUp={(event) => setCapsLock(event.getModifierState("CapsLock"))}
                      onKeyDown={(event) => setCapsLock(event.getModifierState("CapsLock"))}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <button
                      type="button"
                      className="web-auth-password-toggle"
                      aria-label={showPassword ? t("webAccess.authHidePassword") : t("webAccess.authShowPassword")}
                      title={showPassword ? t("webAccess.authHidePassword") : t("webAccess.authShowPassword")}
                      onClick={() => setShowPassword((current) => !current)}
                    >
                      <EyeGlyph crossed={showPassword} />
                    </button>
                  </span>
                </label>

                {authMode === "register" ? (
                  <>
                    <div className="web-auth-strength" aria-label={t("webAccess.authPasswordStrength")}>
                      {[1, 2, 3, 4].map((level) => <span key={level} className={passwordStrength >= level ? "is-active" : ""} />)}
                    </div>
                    <label className="web-auth-field">
                      <span>{t("webAccess.authPasswordConfirmationLabel")}</span>
                      <input
                        type={showPassword ? "text" : "password"}
                        value={passwordConfirmation}
                        minLength={8}
                        maxLength={256}
                        autoComplete="new-password"
                        disabled={disabled}
                        placeholder={t("webAccess.authPasswordConfirmationPlaceholder")}
                        onChange={(event) => setPasswordConfirmation(event.target.value)}
                      />
                    </label>
                    <label className="web-auth-legal">
                      <input type="checkbox" checked={acceptedLegal} disabled={disabled} onChange={(event) => setAcceptedLegal(event.target.checked)} />
                      <span>
                        {t("webAccess.authLegalPrefix")} <a href={marketingUrl("/legal/terms")} target="_blank" rel="noreferrer">{t("webAccess.authTerms")}</a> {t("webAccess.authLegalJoin")} <a href={marketingUrl("/legal/privacy")} target="_blank" rel="noreferrer">{t("webAccess.authPrivacy")}</a>.
                      </span>
                    </label>
                  </>
                ) : null}

                {capsLock ? <p className="web-auth-field-hint is-warning">{t("webAccess.authCapsLock")}</p> : null}
                {!online ? <div className="web-auth-feedback is-error" role="status">{t("webAccess.authOffline")}</div> : null}
                {formError ? <div className="web-auth-feedback is-error" role="alert">{formError}</div> : null}

                <button type="submit" className="web-auth-submit" disabled={disabled}>
                  {submitting
                    ? t("webAccess.authSubmitting")
                    : authMode === "login"
                      ? t("webAccess.authLoginAction")
                      : t("webAccess.authRegisterAction")}
                </button>

                {authMode === "login" ? (
                  <a className="web-auth-help-link" href="mailto:support@locoris.app?subject=Locoris%20Cloud%20access">
                    {t("webAccess.authAccessHelp")}
                  </a>
                ) : null}
              </form>
            </>
          )}
        </section>
      </div>

      <footer className="web-auth-footer">
        <span>{t("webAccess.authFooterSecurity")}</span>
        <nav aria-label={t("webAccess.authLegalNavigation")}>
          <a href={marketingUrl("/legal/privacy")} target="_blank" rel="noreferrer">{t("webAccess.authPrivacy")}</a>
          <a href={marketingUrl("/legal/terms")} target="_blank" rel="noreferrer">{t("webAccess.authTerms")}</a>
        </nav>
      </footer>
    </main>
  );
}
