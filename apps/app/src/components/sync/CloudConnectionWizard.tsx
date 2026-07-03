import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { LocalVaultProfile } from "../../lib/localVaults";
import type {
  HostedAccountVault,
  SyncConnection
} from "../../types";
import type {
  HostedAccountOverview,
  HostedDeviceLoginStart
} from "../../lib/sync";
import "./CloudConnectionWizard.css";

type CloudWizardAuthMode = "login" | "register";
type CloudWizardStep = "auth" | "choose" | "done";

export type CloudWizardAuthResult = {
  connection: SyncConnection;
  overview: HostedAccountOverview;
};

type CloudConnectionWizardProps = {
  connection?: SyncConnection | null;
  localVaults: LocalVaultProfile[];
  selectedLocalVaultId: string;
  activeLocalVaultId: string;
  defaultServerUrl: string;
  getVaultLabel: (vault: Pick<LocalVaultProfile, "id" | "name"> | null | undefined) => string;
  translateError: (message: string) => string;
  onAuthenticate: (input: {
    mode: CloudWizardAuthMode;
    serverUrl: string;
    name: string;
    email: string;
    password: string;
    connection?: SyncConnection | null;
  }) => Promise<CloudWizardAuthResult>;
  onStartDeviceLogin: (serverUrl: string) => Promise<HostedDeviceLoginStart>;
  onPollDeviceLogin: (serverUrl: string, deviceCode: string, connection?: SyncConnection | null) => Promise<CloudWizardAuthResult>;
  onUploadCurrentVault: (connection: SyncConnection, vault: LocalVaultProfile) => Promise<void>;
  onCreateHostedVault: (connection: SyncConnection, name: string) => Promise<void>;
  onConnectRemoteVault: (connection: SyncConnection, remoteVault: HostedAccountVault) => Promise<void>;
  onRefreshOverview: (connection: SyncConnection) => Promise<HostedAccountOverview>;
  onClose: () => void;
};

function getRawErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error || "UNKNOWN_ERROR");
}

function formatBytes(value: number | null | undefined) {
  const bytes = Number(value ?? 0);

  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = bytes;
  let unitIndex = 0;

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
}

function formatLimit(value: number | null | undefined) {
  return value === null || value === undefined ? "∞" : String(value);
}

function CloudGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7.1 17.2h10.1a3.4 3.4 0 0 0 .3-6.8 5.6 5.6 0 0 0-10.8-1.8A4.4 4.4 0 0 0 7.1 17.2Z" />
      <path className="cloud-wizard-icon-accent" d="M9.1 12.7h5.8M12 9.8v5.8" />
    </svg>
  );
}

function DeviceGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="7.2" y="3.5" width="9.6" height="17" rx="2.2" />
      <path className="cloud-wizard-icon-accent" d="M10.2 6.6h3.6M11 17.4h2" />
    </svg>
  );
}

function VaultGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4.4 8h15.2v10.3H4.4z" />
      <path className="cloud-wizard-icon-accent" d="m4.4 8 3-2.2h9.2l3 2.2M8.3 11.4h7.4" />
    </svg>
  );
}

export default function CloudConnectionWizard({
  connection: initialConnection = null,
  localVaults,
  selectedLocalVaultId,
  activeLocalVaultId,
  defaultServerUrl,
  getVaultLabel,
  translateError,
  onAuthenticate,
  onStartDeviceLogin,
  onPollDeviceLogin,
  onUploadCurrentVault,
  onCreateHostedVault,
  onConnectRemoteVault,
  onRefreshOverview,
  onClose
}: CloudConnectionWizardProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<CloudWizardStep>(initialConnection ? "choose" : "auth");
  const [authMode, setAuthMode] = useState<CloudWizardAuthMode>("login");
  const [serverUrl, setServerUrl] = useState(initialConnection?.serverUrl || defaultServerUrl);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(initialConnection?.userEmail || "");
  const [password, setPassword] = useState("");
  const [connection, setConnection] = useState<SyncConnection | null>(initialConnection);
  const [overview, setOverview] = useState<HostedAccountOverview | null>(null);
  const [deviceLogin, setDeviceLogin] = useState<HostedDeviceLoginStart | null>(null);
  const [createName, setCreateName] = useState("");
  const [busy, setBusy] = useState<string | null>(initialConnection ? "overview" : null);
  const [error, setError] = useState<string | null>(null);
  const activeDeviceCodeRef = useRef<string | null>(null);
  const deviceLoginCompletedRef = useRef(false);
  const deviceLoginPollInFlightRef = useRef<string | null>(null);
  const completedDeviceLoginRef = useRef<{
    deviceCode: string;
    result: CloudWizardAuthResult;
  } | null>(null);

  const selectedVault = useMemo(
    () =>
      localVaults.find((vault) => vault.id === selectedLocalVaultId) ??
      localVaults.find((vault) => vault.id === activeLocalVaultId) ??
      localVaults[0] ??
      null,
    [activeLocalVaultId, localVaults, selectedLocalVaultId]
  );
  const remoteVaults = overview?.vaults ?? [];
  const canWriteCloud = overview?.entitlement.capabilities.canWriteSync ?? true;
  const recommendedCreateName = selectedVault ? getVaultLabel(selectedVault) : t("settings.cloudWizardNewVaultFallback");

  const applyDeviceLoginResult = (result: CloudWizardAuthResult) => {
    setConnection(result.connection);
    setOverview(result.overview);
    setStep("choose");
    setDeviceLogin(null);
    setBusy(null);
    setError(null);
  };

  useEffect(() => {
    let cancelled = false;

    if (!initialConnection) {
      return;
    }

    setBusy("overview");
    onRefreshOverview(initialConnection)
      .then((nextOverview) => {
        if (!cancelled) {
          setOverview(nextOverview);
          setConnection(initialConnection);
          setStep("choose");
          setError(null);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(translateError(getRawErrorMessage(caught)));
          setStep("auth");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialConnection?.id]);

  useEffect(() => {
    if (!deviceLogin || !serverUrl.trim()) {
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;

    const poll = async () => {
      if (cancelled) {
        return;
      }

      const completedLogin = completedDeviceLoginRef.current;
      if (completedLogin?.deviceCode === deviceLogin.deviceCode) {
        applyDeviceLoginResult(completedLogin.result);
        return;
      }

      if (Date.now() > deviceLogin.expiresAt) {
        setBusy(null);
        setDeviceLogin(null);
        setError(t("settings.cloudWizardDeviceExpired"));
        return;
      }

      let acquiredPollSlot = false;

      try {
        if (activeDeviceCodeRef.current !== deviceLogin.deviceCode) {
          return;
        }

        if (deviceLoginPollInFlightRef.current === deviceLogin.deviceCode) {
          timeoutId = window.setTimeout(poll, deviceLogin.interval || 2500);
          return;
        }

        deviceLoginPollInFlightRef.current = deviceLogin.deviceCode;
        acquiredPollSlot = true;
        const result = await onPollDeviceLogin(
          serverUrl.trim(),
          deviceLogin.deviceCode,
          connection ?? initialConnection
        );

        completedDeviceLoginRef.current = {
          deviceCode: deviceLogin.deviceCode,
          result
        };
        deviceLoginCompletedRef.current = true;
        activeDeviceCodeRef.current = null;
        deviceLoginPollInFlightRef.current = null;

        if (cancelled) {
          return;
        }

        applyDeviceLoginResult(result);
      } catch (caught) {
        const rawMessage = getRawErrorMessage(caught);
        const completedLogin = completedDeviceLoginRef.current;

        if (completedLogin?.deviceCode === deviceLogin.deviceCode) {
          applyDeviceLoginResult(completedLogin.result);
          return;
        }

        if (deviceLoginCompletedRef.current || activeDeviceCodeRef.current !== deviceLogin.deviceCode) {
          return;
        }

        if (rawMessage !== "AUTHORIZATION_PENDING") {
          setBusy(null);
          setDeviceLogin(null);
          setError(translateError(rawMessage));
          return;
        }

        timeoutId = window.setTimeout(poll, deviceLogin.interval || 2500);
      } finally {
        if (acquiredPollSlot && deviceLoginPollInFlightRef.current === deviceLogin.deviceCode) {
          deviceLoginPollInFlightRef.current = null;
        }
      }
    };

    timeoutId = window.setTimeout(poll, deviceLogin.interval || 2500);

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [connection?.id, deviceLogin, initialConnection?.id, onPollDeviceLogin, serverUrl, t, translateError]);

  const handleCredentials = async () => {
    if (!serverUrl.trim()) {
      setError(t("sync.hostedUrlRequired"));
      return;
    }

    if (!email.trim() || !password.trim()) {
      setError(t("sync.hostedCredentialsRequired"));
      return;
    }

    setBusy("auth");
    setError(null);

    try {
      const result = await onAuthenticate({
        mode: authMode,
        serverUrl: serverUrl.trim(),
        name: name.trim(),
        email: email.trim(),
        password,
        connection: connection ?? initialConnection
      });

      setConnection(result.connection);
      setOverview(result.overview);
      setStep("choose");
      setPassword("");
    } catch (caught) {
      setError(translateError(getRawErrorMessage(caught)));
    } finally {
      setBusy(null);
    }
  };

  const handleDeviceLogin = async () => {
    if (!serverUrl.trim()) {
      setError(t("sync.hostedUrlRequired"));
      return;
    }

    setBusy("device");
    setError(null);
    deviceLoginCompletedRef.current = false;
    activeDeviceCodeRef.current = null;
    deviceLoginPollInFlightRef.current = null;
    completedDeviceLoginRef.current = null;

    try {
      const started = await onStartDeviceLogin(serverUrl.trim());
      activeDeviceCodeRef.current = started.deviceCode;
      setDeviceLogin(started);
      window.open(started.verificationUri, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setBusy(null);
      setError(translateError(getRawErrorMessage(caught)));
    }
  };

  const runCloudAction = async (action: string, operation: () => Promise<void>) => {
    setBusy(action);
    setError(null);

    try {
      await operation();
      setStep("done");
    } catch (caught) {
      setError(translateError(getRawErrorMessage(caught)));
    } finally {
      setBusy(null);
    }
  };

  const authenticatedConnection = connection;
  const isWorking = busy !== null;

  return (
    <div className="cloud-wizard">
      <div className="cloud-wizard-rail" aria-hidden="true">
        <span className={step === "auth" ? "is-active" : ""}>01</span>
        <span className={step === "choose" ? "is-active" : ""}>02</span>
        <span className={step === "done" ? "is-active" : ""}>03</span>
      </div>

      {step === "auth" ? (
        <section className="cloud-wizard-section">
          <label className="cloud-wizard-field">
            <span>{t("settings.cloudWizardServerLabel")}</span>
            <input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder={t("sync.endpointPlaceholder")} />
          </label>

          <div className="cloud-wizard-auth-grid">
            <div className="cloud-wizard-auth-card">
              <div className="cloud-wizard-mode-switch" role="tablist" aria-label={t("settings.cloudWizardAuthMode")}>
                <button type="button" className={authMode === "login" ? "is-active" : ""} onClick={() => setAuthMode("login")}>
                  {t("sync.hostedLogin")}
                </button>
                <button type="button" className={authMode === "register" ? "is-active" : ""} onClick={() => setAuthMode("register")}>
                  {t("sync.hostedRegister")}
                </button>
              </div>
              {authMode === "register" ? (
                <label className="cloud-wizard-field">
                  <span>{t("sync.hostedName")}</span>
                  <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("sync.hostedNamePlaceholder")} />
                </label>
              ) : null}
              <label className="cloud-wizard-field">
                <span>{t("sync.hostedEmail")}</span>
                <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t("sync.hostedEmailPlaceholder")} type="email" />
              </label>
              <label className="cloud-wizard-field">
                <span>{t("sync.hostedPassword")}</span>
                <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("sync.hostedPasswordPlaceholder")} type="password" />
              </label>
              <button type="button" className="cloud-wizard-primary" disabled={isWorking} onClick={() => void handleCredentials()}>
                {busy === "auth" ? t("sync.syncing") : authMode === "register" ? t("sync.hostedRegister") : t("sync.hostedLogin")}
              </button>
            </div>

            <div className="cloud-wizard-device-card">
              <span className="cloud-wizard-device-icon">
                <DeviceGlyph />
              </span>
              <strong>{t("settings.cloudWizardDeviceTitle")}</strong>
              <p>{t("settings.cloudWizardDeviceDescription")}</p>
              {deviceLogin ? (
                <div className="cloud-wizard-device-code">
                  <a href={deviceLogin.verificationUri} target="_blank" rel="noreferrer">
                    {t("settings.cloudWizardOpenAccount")}
                  </a>
                </div>
              ) : null}
              <button type="button" className="cloud-wizard-secondary" disabled={isWorking} onClick={() => void handleDeviceLogin()}>
                {busy === "device" ? t("settings.cloudWizardDeviceWaiting") : t("settings.cloudWizardDeviceAction")}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {step === "choose" && authenticatedConnection ? (
        <section className="cloud-wizard-section">
          <div className="cloud-wizard-account">
            <div>
              <span>{t("settings.cloudWizardAccountLabel")}</span>
              <strong>{overview?.user.email ?? (authenticatedConnection.userEmail || authenticatedConnection.label)}</strong>
            </div>
            <button
              type="button"
              className="cloud-wizard-refresh"
              disabled={isWorking}
              onClick={() => {
                setBusy("refresh");
                setError(null);
                void (async () => {
                  try {
                  const refreshed = await onRefreshOverview(authenticatedConnection);
                  setOverview(refreshed);
                  setStep("choose");
                  } catch (caught) {
                    setError(translateError(getRawErrorMessage(caught)));
                  } finally {
                    setBusy(null);
                  }
                })();
              }}
            >
              {t("sync.hostedRefresh")}
            </button>
          </div>

          {overview ? (
            <div className="cloud-wizard-preflight">
              <span>
                <small>{t("settings.cloudWizardPlan")}</small>
                <strong>{overview.entitlement.plan.name}</strong>
              </span>
              <span>
                <small>{t("settings.cloudWizardStorage")}</small>
                <strong>{formatBytes(overview.usage.storageBytes)}</strong>
              </span>
              <span>
                <small>{t("settings.cloudWizardVaultLimit")}</small>
                <strong>{overview.usage.vaultCount} / {formatLimit(overview.entitlement.limits.maxVaults)}</strong>
              </span>
              <span>
                <small>{t("settings.cloudWizardDeviceLimit")}</small>
                <strong>{overview.usage.deviceCount ?? overview.usage.syncTokenCount} / {formatLimit(overview.entitlement.limits.maxSyncTokens)}</strong>
              </span>
            </div>
          ) : null}

          {!canWriteCloud ? (
            <div className="cloud-wizard-warning">{t("settings.cloudWizardReadOnlyWarning")}</div>
          ) : null}

          <div className="cloud-wizard-actions-grid">
            <article className="cloud-wizard-action-card is-featured">
              <span className="cloud-wizard-action-icon">
                <VaultGlyph />
              </span>
              <strong>{t("settings.cloudWizardUploadTitle")}</strong>
              <p>
                {selectedVault
                  ? t("settings.cloudWizardUploadDescription", {
                      vault: getVaultLabel(selectedVault)
                    })
                  : t("settings.cloudWizardNoLocalVault")}
              </p>
              <button
                type="button"
                className="cloud-wizard-primary"
                disabled={!selectedVault || isWorking || !canWriteCloud}
                onClick={() =>
                  selectedVault
                    ? void runCloudAction("upload", () => onUploadCurrentVault(authenticatedConnection, selectedVault))
                    : undefined
                }
              >
                {busy === "upload" ? t("sync.syncing") : t("settings.cloudWizardUploadAction")}
              </button>
            </article>

            <article className="cloud-wizard-action-card">
              <span className="cloud-wizard-action-icon">
                <CloudGlyph />
              </span>
              <strong>{t("settings.cloudWizardCreateTitle")}</strong>
              <p>{t("settings.cloudWizardCreateDescription")}</p>
              <input
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder={recommendedCreateName}
              />
              <button
                type="button"
                className="cloud-wizard-secondary"
                disabled={isWorking || !canWriteCloud}
                onClick={() =>
                  void runCloudAction("create", () =>
                    onCreateHostedVault(authenticatedConnection, createName.trim() || recommendedCreateName)
                  )
                }
              >
                {busy === "create" ? t("sync.syncing") : t("settings.cloudWizardCreateAction")}
              </button>
            </article>
          </div>

          <section className="cloud-wizard-remote-section">
            <div className="cloud-wizard-section-head">
              <div>
                <strong>{t("settings.cloudWizardExistingTitle")}</strong>
                <span>{t("settings.cloudWizardExistingDescription")}</span>
              </div>
              <span>{remoteVaults.length}</span>
            </div>
            {remoteVaults.length === 0 ? (
              <div className="cloud-wizard-empty">{t("settings.cloudWizardNoRemoteVaults")}</div>
            ) : (
              <div className="cloud-wizard-remote-list">
                {remoteVaults.map((remoteVault) => (
                  <button
                    type="button"
                    key={remoteVault.id}
                    className="cloud-wizard-remote-row"
                    disabled={isWorking}
                    onClick={() =>
                      void runCloudAction(`remote:${remoteVault.id}`, () =>
                        onConnectRemoteVault(authenticatedConnection, remoteVault)
                      )
                    }
                  >
                    <span className="cloud-wizard-remote-icon">
                      <VaultGlyph />
                    </span>
                    <span>
                      <strong>{remoteVault.name}</strong>
                      <small>{remoteVault.vaultKind === "private" ? t("settings.vaultKindPrivate") : t("settings.vaultKindRegular")}</small>
                    </span>
                    <em>{busy === `remote:${remoteVault.id}` ? t("sync.syncing") : t("settings.cloudWizardConnectAction")}</em>
                  </button>
                ))}
              </div>
            )}
          </section>
        </section>
      ) : null}

      {step === "done" ? (
        <section className="cloud-wizard-section cloud-wizard-done">
          <span className="cloud-wizard-done-icon">
            <CloudGlyph />
          </span>
          <strong>{t("settings.cloudWizardDoneTitle")}</strong>
          <p>{t("settings.cloudWizardDoneDescription")}</p>
          <button type="button" className="cloud-wizard-primary" onClick={onClose}>
            {t("dialog.ok")}
          </button>
        </section>
      ) : null}

      {error ? (
        <div className="cloud-wizard-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
