import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { getDisplayVaultName } from "../../lib/displayNames";
import { getErrorMessage } from "../../lib/errors";
import type { LocalVaultProfile } from "../../lib/localVaults";
import {
  createHostedVault,
  loadHostedAccountOverview,
  loginHostedAccount,
  pollHostedDeviceLogin,
  registerHostedAccount,
  registerHostedVaultDevice,
  startHostedDeviceLogin,
  type HostedAccountOverview
} from "../../lib/sync";
import type {
  AppSettings,
  HostedAccountVault,
  RemoteVaultImportResult,
  SyncConnection,
  SyncVaultBinding,
  VaultEncryptionSummary
} from "../../types";
import CloudConnectionWizard, { type CloudWizardAuthResult } from "../sync/CloudConnectionWizard";
import CloudVaultPickerSheet from "./CloudVaultPickerSheet";
import "./AccountCloudPanel.css";

type SyncFeedbackState = {
  tone: "success" | "error";
  text: string;
} | null;

type AccountCloudPanelProps = {
  settings: AppSettings;
  online: boolean;
  localVaults: LocalVaultProfile[];
  activeLocalVaultId: string;
  selectedLocalVaultId: string;
  syncConnections: SyncConnection[];
  syncBindings: SyncVaultBinding[];
  vaultEncryptionById: Record<string, VaultEncryptionSummary>;
  syncFeedback?: SyncFeedbackState;
  onBack: () => void;
  onClose: () => void;
  onSelectLocalVault: (localVaultId: string) => void;
  onCreateConnection: (input: {
    provider: "hosted";
    role?: SyncConnection["role"];
    serverUrl: string;
    label?: string;
    sessionToken?: string;
    tokenExpiresAt?: number | null;
    userId?: string | null;
    userName?: string;
    userEmail?: string;
  }) => SyncConnection | void | Promise<SyncConnection | void>;
  onDeleteConnection: (connectionId: string) => void | Promise<void>;
  onUpdateConnection: (
    connectionId: string,
    patch: Partial<Omit<SyncConnection, "id" | "provider" | "createdAt">>
  ) => void | Promise<void>;
  onRefreshHostedConnectionCredentials: (connection: SyncConnection) => void | Promise<void>;
  onBindVault: (input: {
    localVaultId: string;
    connectionId: string;
    remoteVaultId: string;
    remoteVaultName?: string;
    syncToken: string;
  }) => void | Promise<void>;
  onImportRemoteVault: (input: {
    connectionId: string;
    remoteVaultId: string;
    remoteVaultName: string;
    remoteVaultKind?: LocalVaultProfile["vaultKind"];
    openAfterImport?: boolean;
  }) => Promise<RemoteVaultImportResult>;
  onClearBinding: (localVaultId: string) => void | Promise<void>;
  onRunVaultSync: (localVaultId: string) => void | Promise<void>;
};

type PanelDialog =
  | { kind: "cloudWizard"; connection?: SyncConnection | null; vaultId?: string | null }
  | null;

function BackGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M12.6 4.8 7.4 10l5.2 5.2" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M5.4 5.4 14.6 14.6M14.6 5.4 5.4 14.6" />
    </svg>
  );
}

function CloudGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M5.7 14.7h9.1a3 3 0 0 0 .3-6 5 5 0 0 0-9.8-1.5A3.9 3.9 0 0 0 5.7 14.7Z" />
      <path d="M8 10.9h4.5M10.3 8.7v4.5" />
    </svg>
  );
}

function VaultGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M3.7 6.2h12.6v8.7H3.7z" />
      <path d="M3.7 6.2 6.1 4.5h7.8l2.4 1.7" />
      <path d="M7 9.1h6" />
    </svg>
  );
}

function DeviceGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="6.2" y="3.3" width="7.6" height="13.4" rx="1.8" />
      <path d="M8.6 5.6h2.8M9.2 14.2h1.6" />
    </svg>
  );
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

function formatTime(timestamp: number | null, locale: string) {
  if (!timestamp) {
    return "—";
  }

  return new Date(timestamp).toLocaleString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short"
  });
}

function getHostedDevicePlatform() {
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";

  if (/android/i.test(userAgent)) {
    return "Android";
  }

  if (/iphone|ipad|ipod/i.test(userAgent)) {
    return "iOS";
  }

  if (/macintosh|mac os x/i.test(userAgent)) {
    return "macOS";
  }

  if (/windows/i.test(userAgent)) {
    return "Windows";
  }

  if (/linux/i.test(userAgent)) {
    return "Linux";
  }

  return "Locoris app";
}

function getHostedDeviceName(settings: AppSettings) {
  const shortDeviceId = settings.localDeviceId.replace(/^device-/, "").slice(0, 6);

  return `${getHostedDevicePlatform()} · ${shortDeviceId || "device"}`;
}

function translateCloudError(message: string, t: ReturnType<typeof useTranslation>["t"]) {
  switch (message) {
    case "INVALID_CREDENTIALS":
      return t("sync.hostedInvalidCredentials");
    case "AUTHORIZATION_PENDING":
      return t("sync.hostedDeviceAuthorizationPending");
    case "DEVICE_CODE_EXPIRED":
      return t("sync.hostedDeviceCodeExpired");
    case "DEVICE_CODE_ALREADY_USED":
      return t("sync.hostedDeviceCodeUsed");
    case "DEVICE_CODE_NOT_FOUND":
    case "INVALID_DEVICE_CODE":
      return t("sync.hostedDeviceCodeInvalid");
    case "PLAN_REQUIRED":
      return t("sync.cloudPlanRequired");
    case "TRIAL_EXPIRED":
      return t("sync.cloudTrialExpired");
    case "SUBSCRIPTION_PAST_DUE":
      return t("sync.cloudSubscriptionPastDue");
    case "SUBSCRIPTION_EXPIRED_READ_ONLY":
      return t("sync.cloudReadOnly");
    case "OVER_STORAGE_LIMIT":
      return t("sync.cloudStorageLimit");
    case "OVER_VAULT_LIMIT":
      return t("sync.cloudVaultLimit");
    case "OVER_DEVICE_LIMIT":
      return t("sync.cloudDeviceLimit");
    case "PAYLOAD_TOO_LARGE":
      return t("sync.cloudPayloadTooLarge");
    case "EMAIL_AND_PASSWORD_REQUIRED":
      return t("sync.hostedCredentialsRequired");
    case "EMAIL_REQUIRED":
      return t("sync.hostedEmailRequired");
    case "INVALID_EMAIL":
      return t("sync.hostedInvalidEmail");
    case "EMAIL_ALREADY_EXISTS":
      return t("sync.hostedEmailExists");
    case "PASSWORD_TOO_SHORT":
      return t("sync.hostedPasswordTooShort");
    case "VAULT_ENCRYPTION_LOCKED":
      return t("sync.vaultEncryptionSyncLocked");
    case "SERVER_UNAVAILABLE":
    case "HTTP_404":
    case "NOT_FOUND":
      return t("sync.serverNotFound");
    case "UNAUTHORIZED":
      return t("sync.hostedSessionExpired");
    default:
      return message || t("sync.hostedFailedGeneric");
  }
}

export default function AccountCloudPanel({
  settings,
  online,
  localVaults,
  activeLocalVaultId,
  selectedLocalVaultId,
  syncConnections,
  syncBindings,
  vaultEncryptionById,
  syncFeedback = null,
  onBack,
  onClose,
  onSelectLocalVault,
  onCreateConnection,
  onDeleteConnection,
  onUpdateConnection,
  onRefreshHostedConnectionCredentials,
  onBindVault,
  onImportRemoteVault,
  onClearBinding,
  onRunVaultSync
}: AccountCloudPanelProps) {
  const { t, i18n } = useTranslation();
  const [cloudWizard, setCloudWizard] = useState<PanelDialog>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [overview, setOverview] = useState<HostedAccountOverview | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [internalFeedback, setInternalFeedback] = useState<SyncFeedbackState>(null);
  const feedback = internalFeedback ?? syncFeedback;

  const sortedVaults = useMemo(
    () => [...localVaults].sort((left, right) => left.createdAt - right.createdAt),
    [localVaults]
  );
  const cloudConnections = useMemo(
    () =>
      syncConnections
        .filter((connection) => connection.provider === "hosted" && connection.role === "locorisCloud")
        .sort((left, right) => right.updatedAt - left.updatedAt),
    [syncConnections]
  );
  const cloudConnection = cloudConnections[0] ?? null;
  const duplicateCloudConnections = cloudConnections.slice(1);
  const cloudConnectionIds = useMemo(
    () => new Set(cloudConnections.map((connection) => connection.id)),
    [cloudConnections]
  );
  const cloudBindings = useMemo(
    () => syncBindings.filter((binding) => cloudConnectionIds.has(binding.connectionId)),
    [cloudConnectionIds, syncBindings]
  );
  const cloudBindingByLocalId = useMemo(
    () => new Map(cloudBindings.map((binding) => [binding.localVaultId, binding])),
    [cloudBindings]
  );
  const cloudBindingByRemoteId = useMemo(
    () => new Map(cloudBindings.map((binding) => [binding.remoteVaultId, binding])),
    [cloudBindings]
  );

  const getVaultLabel = (vault: Pick<LocalVaultProfile, "id" | "name"> | null | undefined) =>
    getDisplayVaultName(
      vault ?? null,
      settings.language,
      vault ? sortedVaults.findIndex((entry) => entry.id === vault.id) : undefined
    );

  const loadOverview = async (connection = cloudConnection) => {
    if (!connection) {
      setOverview(null);
      return null;
    }

    const nextOverview = await loadHostedAccountOverview(connection.serverUrl, connection.sessionToken);
    setOverview(nextOverview);
    return nextOverview;
  };

  useEffect(() => {
    let cancelled = false;

    if (!cloudConnection || !online) {
      if (!cloudConnection) {
        setOverview(null);
      }
      return;
    }

    setBusyKey("overview");
    loadHostedAccountOverview(cloudConnection.serverUrl, cloudConnection.sessionToken)
      .then((nextOverview) => {
        if (!cancelled) {
          setOverview(nextOverview);
          setInternalFeedback(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setInternalFeedback({
            tone: "error",
            text: translateCloudError(getErrorMessage(error), t)
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBusyKey((current) => (current === "overview" ? null : current));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cloudConnection?.id, cloudConnection?.sessionToken, online, t]);

  const showFeedback = (tone: "success" | "error", text: string) => {
    setInternalFeedback({ tone, text });
  };

  const upsertCloudConnection = async (
    serverUrl: string,
    result: {
      user: {
        id: string;
        name: string;
        email: string | null;
      };
      session: {
        token: string;
      };
    },
    connection?: SyncConnection | null
  ): Promise<CloudWizardAuthResult> => {
    const normalizedUrl = serverUrl.trim();
    const targetConnection = connection ?? cloudConnection;

    if (targetConnection) {
      const refreshedConnection = {
        ...targetConnection,
        role: "locorisCloud" as const,
        serverUrl: normalizedUrl,
        sessionToken: result.session.token,
        userId: result.user.id,
        userName: result.user.name,
        userEmail: result.user.email ?? "",
        updatedAt: Date.now()
      } satisfies SyncConnection;

      await Promise.resolve(
        onUpdateConnection(targetConnection.id, {
          role: "locorisCloud",
          serverUrl: refreshedConnection.serverUrl,
          sessionToken: refreshedConnection.sessionToken,
          userId: refreshedConnection.userId,
          userName: refreshedConnection.userName,
          userEmail: refreshedConnection.userEmail
        })
      );
      await Promise.resolve(onRefreshHostedConnectionCredentials(refreshedConnection));

      return {
        connection: refreshedConnection,
        overview: await loadHostedAccountOverview(refreshedConnection.serverUrl, refreshedConnection.sessionToken)
      };
    }

    const createdConnection = await Promise.resolve(
      onCreateConnection({
        provider: "hosted",
        role: "locorisCloud",
        serverUrl: normalizedUrl,
        sessionToken: result.session.token,
        userId: result.user.id,
        userName: result.user.name,
        userEmail: result.user.email ?? "",
        label: result.user.email ?? result.user.name
      })
    );

    if (!createdConnection) {
      throw new Error("CLOUD_CONNECTION_NOT_READY");
    }

    return {
      connection: createdConnection,
      overview: await loadHostedAccountOverview(createdConnection.serverUrl, createdConnection.sessionToken)
    };
  };

  const handleAuthenticate = async (input: {
    mode: "login" | "register";
    serverUrl: string;
    name: string;
    email: string;
    password: string;
    connection?: SyncConnection | null;
  }) => {
    const result =
      input.mode === "register" && !input.connection
        ? await registerHostedAccount(input.serverUrl, {
            name: input.name || input.email,
            email: input.email,
            password: input.password,
            deviceName: getHostedDeviceName(settings),
            deviceId: settings.localDeviceId,
            clientPlatform: getHostedDevicePlatform()
          })
        : await loginHostedAccount(input.serverUrl, {
            email: input.email,
            password: input.password,
            deviceName: getHostedDeviceName(settings),
            deviceId: settings.localDeviceId,
            clientPlatform: getHostedDevicePlatform()
          });

    return upsertCloudConnection(input.serverUrl, result, input.connection);
  };

  const handleStartDeviceLogin = async (serverUrl: string) =>
    startHostedDeviceLogin(serverUrl, {
      deviceName: getHostedDeviceName(settings),
      deviceId: settings.localDeviceId,
      clientPlatform: getHostedDevicePlatform()
    });

  const handlePollDeviceLogin = async (
    serverUrl: string,
    deviceCode: string,
    connection?: SyncConnection | null
  ) => {
    const result = await pollHostedDeviceLogin(serverUrl, deviceCode);
    return upsertCloudConnection(serverUrl, result, connection);
  };

  const ensureCloudVaultBinding = async (connection: SyncConnection, vault: LocalVaultProfile) => {
    const encryption = vaultEncryptionById[vault.id];

    if (vault.vaultKind === "private" && encryption?.enabled && encryption.state === "locked") {
      throw new Error("VAULT_ENCRYPTION_LOCKED");
    }

    const latestOverview =
      overview && connection.id === cloudConnection?.id ? overview : await loadHostedAccountOverview(connection.serverUrl, connection.sessionToken);
    let remoteVault =
      latestOverview.vaults.find((entry) => entry.id === vault.vaultGuid) ??
      latestOverview.vaults.find((entry) => entry.name.trim().toLowerCase() === getVaultLabel(vault).trim().toLowerCase()) ??
      null;

    if (!remoteVault) {
      remoteVault = (
        await createHostedVault(connection.serverUrl, connection.sessionToken, {
          id: vault.vaultGuid || undefined,
          name: getVaultLabel(vault)
        })
      ).vault;
    }

    const deviceRegistration = await registerHostedVaultDevice(
      connection.serverUrl,
      connection.sessionToken,
      remoteVault.id,
      {
        deviceName: getHostedDeviceName(settings),
        deviceId: settings.localDeviceId,
        clientPlatform: getHostedDevicePlatform()
      }
    );

    await Promise.resolve(
      onBindVault({
        localVaultId: vault.id,
        connectionId: connection.id,
        remoteVaultId: remoteVault.id,
        remoteVaultName: remoteVault.name,
        syncToken: deviceRegistration.token
      })
    );
  };

  const handleConnectLocalVault = async (connection: SyncConnection, vault: LocalVaultProfile) => {
    const actionKey = `connect-cloud:${vault.id}`;
    setBusyKey(actionKey);

    try {
      await ensureCloudVaultBinding(connection, vault);
      await Promise.resolve(onRunVaultSync(vault.id));
      await loadOverview(connection);
      showFeedback("success", t("settings.accountCloudVaultConnected", { vault: getVaultLabel(vault) }));
    } catch (error) {
      showFeedback("error", translateCloudError(getErrorMessage(error), t));
      throw error;
    } finally {
      setBusyKey((current) => (current === actionKey ? null : current));
    }
  };

  const handleCreateHostedVault = async (connection: SyncConnection, name: string) => {
    const created = await createHostedVault(connection.serverUrl, connection.sessionToken, {
      name
    });
    await onImportRemoteVault({
      connectionId: connection.id,
      remoteVaultId: created.vault.id,
      remoteVaultName: created.vault.name,
      remoteVaultKind: created.vault.vaultKind,
      openAfterImport: true
    });
    await loadOverview(connection);
  };

  const handleConnectRemoteVault = async (connection: SyncConnection, remoteVault: HostedAccountVault) => {
    await onImportRemoteVault({
      connectionId: connection.id,
      remoteVaultId: remoteVault.id,
      remoteVaultName: remoteVault.name,
      remoteVaultKind: remoteVault.vaultKind,
      openAfterImport: true
    });
    await loadOverview(connection);
  };

  const handleImportRemoteVault = async (remoteVault: HostedAccountVault) => {
    if (!cloudConnection) {
      return;
    }

    const actionKey = `import-cloud:${remoteVault.id}`;
    setBusyKey(actionKey);

    try {
      const result = await onImportRemoteVault({
        connectionId: cloudConnection.id,
        remoteVaultId: remoteVault.id,
        remoteVaultName: remoteVault.name,
        remoteVaultKind: remoteVault.vaultKind,
        openAfterImport: true
      });
      onSelectLocalVault(result.localVaultId);
      setPickerOpen(false);
      await loadOverview(cloudConnection);
      showFeedback("success", t("settings.accountCloudRemoteImported", { vault: result.localVaultName }));
    } catch (error) {
      showFeedback("error", translateCloudError(getErrorMessage(error), t));
    } finally {
      setBusyKey((current) => (current === actionKey ? null : current));
    }
  };

  const handleRefresh = async () => {
    if (!cloudConnection) {
      return;
    }

    setBusyKey("overview");

    try {
      await loadOverview(cloudConnection);
      showFeedback("success", t("settings.accountCloudRefreshed"));
    } catch (error) {
      showFeedback("error", translateCloudError(getErrorMessage(error), t));
    } finally {
      setBusyKey((current) => (current === "overview" ? null : current));
    }
  };

  const handleDisconnectVault = async (localVaultId: string) => {
    setBusyKey(`disconnect-cloud:${localVaultId}`);

    try {
      await Promise.resolve(onClearBinding(localVaultId));
      showFeedback("success", t("settings.accountCloudVaultDisconnected"));
    } catch (error) {
      showFeedback("error", translateCloudError(getErrorMessage(error), t));
    } finally {
      setBusyKey((current) => (current === `disconnect-cloud:${localVaultId}` ? null : current));
    }
  };

  const handleSignOut = async () => {
    if (!cloudConnection) {
      return;
    }

    await Promise.resolve(onDeleteConnection(cloudConnection.id));
    setOverview(null);
    showFeedback("success", t("sync.hostedLoggedOut"));
  };

  const selectedVault =
    sortedVaults.find((vault) => vault.id === selectedLocalVaultId) ??
    sortedVaults.find((vault) => vault.id === activeLocalVaultId) ??
    sortedVaults[0] ??
    null;
  const defaultServerUrl = cloudConnection?.serverUrl || settings.hostedUrl || "http://localhost:8787";
  const remoteVaults = overview?.vaults ?? [];
  const cloudCanWrite = overview?.entitlement.capabilities.canWriteSync ?? true;
  const connectedVaultCount = cloudBindings.length;
  const statusLabel = !cloudConnection
    ? t("settings.accountCloudSignedOut")
    : !online
      ? t("settings.connectionOffline")
      : overview
        ? t("settings.accountCloudReady")
        : t("settings.connectionChecking");
  const wizardConnection = cloudWizard?.kind === "cloudWizard" ? cloudWizard.connection ?? cloudConnection : cloudConnection;
  const wizardSelectedVaultId =
    cloudWizard?.kind === "cloudWizard" && cloudWizard.vaultId
      ? cloudWizard.vaultId
      : selectedVault?.id ?? selectedLocalVaultId;
  const closeCloudWizard = () => {
    setCloudWizard(null);
    void loadOverview();
  };

  if (cloudWizard?.kind === "cloudWizard") {
    return (
      <section className="settings-panel-shell account-cloud-panel-shell is-account-cloud-wizard">
        <header className="settings-panel-header account-cloud-panel-header has-back-action">
          <button
            type="button"
            className="settings-panel-nav-button account-cloud-nav-button"
            onClick={closeCloudWizard}
            aria-label={t("settings.back")}
            title={t("settings.back")}
          >
            <span className="settings-row-action-icon" aria-hidden="true">
              <BackGlyph />
            </span>
          </button>

          <div className="settings-panel-heading">
            <p className="settings-panel-kicker">{t("settings.accountCloudTitle")}</p>
            <h2 className="panel-title settings-panel-title">
              {wizardConnection ? t("settings.accountCloudManage") : t("settings.accountCloudSignIn")}
            </h2>
            <p className="settings-panel-caption">{t("settings.cloudWizardAuthDescription")}</p>
          </div>

          <div className="settings-panel-header-actions">
            <button
              type="button"
              className="settings-panel-nav-button settings-panel-close-button"
              onClick={onClose}
              aria-label={t("orbit.closeModal")}
              title={t("orbit.closeModal")}
            >
              <span className="settings-panel-close-icon" aria-hidden="true">
                <CloseGlyph />
              </span>
            </button>
          </div>
        </header>

        <div className="account-cloud-wizard-grid">
          <CloudConnectionWizard
            connection={wizardConnection}
            localVaults={sortedVaults}
            activeLocalVaultId={activeLocalVaultId}
            selectedLocalVaultId={wizardSelectedVaultId}
            defaultServerUrl={defaultServerUrl}
            getVaultLabel={getVaultLabel}
            translateError={(message) => translateCloudError(message, t)}
            onAuthenticate={handleAuthenticate}
            onStartDeviceLogin={handleStartDeviceLogin}
            onPollDeviceLogin={handlePollDeviceLogin}
            onUploadCurrentVault={handleConnectLocalVault}
            onCreateHostedVault={handleCreateHostedVault}
            onConnectRemoteVault={handleConnectRemoteVault}
            onRefreshOverview={async (connection) => {
              const nextOverview = await loadHostedAccountOverview(connection.serverUrl, connection.sessionToken);
              setOverview(nextOverview);
              return nextOverview;
            }}
            onClose={closeCloudWizard}
          />
        </div>
      </section>
    );
  }

  return (
    <section className="settings-panel-shell account-cloud-panel-shell">
      <header className="settings-panel-header account-cloud-panel-header has-back-action">
        <button
          type="button"
          className="settings-panel-nav-button account-cloud-nav-button"
          onClick={onBack}
          aria-label={t("settings.back")}
          title={t("settings.back")}
        >
          <span className="settings-row-action-icon" aria-hidden="true">
            <BackGlyph />
          </span>
        </button>

        <div className="settings-panel-heading">
          <p className="settings-panel-kicker">{statusLabel}</p>
          <h2 className="panel-title settings-panel-title">{t("settings.accountCloudTitle")}</h2>
          <p className="settings-panel-caption">{t("settings.accountCloudCaption")}</p>
        </div>

        <div className="settings-panel-header-actions">
          <button
            type="button"
            className="settings-panel-nav-button settings-panel-close-button"
            onClick={onClose}
            aria-label={t("orbit.closeModal")}
            title={t("orbit.closeModal")}
          >
            <span className="settings-panel-close-icon" aria-hidden="true">
              <CloseGlyph />
            </span>
          </button>
        </div>
      </header>

      <div className="account-cloud-grid">
        <section className="account-cloud-hero">
          <div className="account-cloud-hero-main">
            <span className="account-cloud-hero-icon" aria-hidden="true">
              <CloudGlyph />
            </span>
            <div>
              <p>{t("settings.accountCloudProfileKicker")}</p>
              <h3>
                {cloudConnection
                  ? overview?.user.email ?? (cloudConnection.userEmail || cloudConnection.label)
                  : t("settings.accountCloudNoAccountTitle")}
              </h3>
              <span>
                {cloudConnection
                  ? t("settings.accountCloudProfileDescription")
                  : t("settings.accountCloudNoAccountDescription")}
              </span>
            </div>
          </div>
          <div className="account-cloud-hero-actions">
            <button
              type="button"
              className="account-cloud-primary-action"
              onClick={() =>
                setCloudWizard({
                  kind: "cloudWizard",
                  connection: cloudConnection,
                  vaultId: selectedVault?.id ?? null
                })
              }
            >
              {cloudConnection ? t("settings.accountCloudManage") : t("settings.accountCloudSignIn")}
            </button>
            {cloudConnection ? (
              <>
                <button
                  type="button"
                  className="account-cloud-secondary-action"
                  disabled={busyKey !== null || !online}
                  onClick={() => void handleRefresh()}
                >
                  {t("sync.hostedRefresh")}
                </button>
                <button
                  type="button"
                  className="account-cloud-secondary-action is-danger"
                  disabled={busyKey !== null}
                  onClick={() => void handleSignOut()}
                >
                  {t("sync.hostedLogout")}
                </button>
              </>
            ) : null}
          </div>
        </section>

        <section className="account-cloud-stats" aria-label={t("settings.accountCloudStatusTitle")}>
          <article>
            <span>{t("settings.accountCloudPlan")}</span>
            <strong>{overview?.entitlement.plan.name ?? "—"}</strong>
          </article>
          <article>
            <span>{t("settings.accountCloudVaults")}</span>
            <strong>
              {overview
                ? `${overview.usage.vaultCount} / ${formatLimit(overview.entitlement.limits.maxVaults)}`
                : `${connectedVaultCount}`}
            </strong>
          </article>
          <article>
            <span>{t("settings.accountCloudDevices")}</span>
            <strong>
              {overview
                ? `${overview.usage.deviceCount ?? overview.usage.syncTokenCount} / ${formatLimit(overview.entitlement.limits.maxSyncTokens)}`
                : "—"}
            </strong>
          </article>
          <article>
            <span>{t("settings.accountCloudStorage")}</span>
            <strong>{formatBytes(overview?.usage.storageBytes)}</strong>
          </article>
        </section>

        {duplicateCloudConnections.length > 0 ? (
          <section className="account-cloud-warning">
            <strong>{t("settings.accountCloudDuplicateTitle")}</strong>
            <span>{t("settings.accountCloudDuplicateDescription", { count: duplicateCloudConnections.length })}</span>
          </section>
        ) : null}

        {!cloudCanWrite ? (
          <section className="account-cloud-warning">
            <strong>{t("settings.accountCloudReadOnlyTitle")}</strong>
            <span>{t("settings.accountCloudReadOnlyDescription")}</span>
          </section>
        ) : null}

        <section className="account-cloud-vaults">
          <div className="account-cloud-section-head">
            <div>
              <p>{t("settings.accountCloudVaultsKicker")}</p>
              <h3>{t("settings.accountCloudVaultsTitle")}</h3>
              <span>{t("settings.accountCloudVaultsDescription")}</span>
            </div>
            <button
              type="button"
              className="account-cloud-secondary-action"
              disabled={!cloudConnection || busyKey !== null}
              onClick={() => setPickerOpen(true)}
            >
              {t("settings.accountCloudImportFromCloud")}
            </button>
          </div>

          <div className="account-cloud-vault-list">
            {sortedVaults.map((vault) => {
              const binding = cloudBindingByLocalId.get(vault.id) ?? null;
              const encryption = vaultEncryptionById[vault.id];
              const locked = vault.vaultKind === "private" && encryption?.enabled && encryption.state === "locked";
              const connected = Boolean(binding);
              const busy =
                busyKey === `connect-cloud:${vault.id}` ||
                busyKey === `disconnect-cloud:${vault.id}`;
              const accent = connected ? "var(--settings-accent-secondary)" : "var(--settings-accent)";

              return (
                <article
                  key={vault.id}
                  className={`account-cloud-vault-card ${connected ? "is-connected" : ""} ${locked ? "is-locked" : ""}`}
                  style={{ "--cloud-vault-accent": accent } as CSSProperties}
                >
                  <div className="account-cloud-vault-main">
                    <span className="account-cloud-vault-icon" aria-hidden="true">
                      <VaultGlyph />
                    </span>
                    <div className="account-cloud-vault-copy">
                      <div className="account-cloud-chip-row">
                        {vault.id === activeLocalVaultId ? <span>{t("sync.localVaultActive")}</span> : null}
                        <span>{vault.vaultKind === "private" ? t("settings.vaultKindPrivate") : t("settings.vaultKindRegular")}</span>
                        <span className={connected ? "is-ready" : ""}>
                          {connected ? t("settings.accountCloudConnected") : t("settings.accountCloudNotConnected")}
                        </span>
                        {locked ? <span className="is-warning">{t("settings.vaultEncryptionLocked")}</span> : null}
                      </div>
                      <strong>{getVaultLabel(vault)}</strong>
                      <small>
                        {binding
                          ? `${binding.remoteVaultName} · ${formatTime(binding.lastSyncAt, i18n.language)}`
                          : t("settings.accountCloudVaultUnbound")}
                      </small>
                    </div>
                  </div>

                  <div className="account-cloud-vault-actions">
                    {connected ? (
                      <>
                        <button
                          type="button"
                          className="account-cloud-secondary-action"
                          disabled={busyKey !== null}
                          onClick={() => void onRunVaultSync(vault.id)}
                        >
                          {t("sync.syncNow")}
                        </button>
                        <button
                          type="button"
                          className="account-cloud-secondary-action is-danger"
                          disabled={busyKey !== null}
                          onClick={() => void handleDisconnectVault(vault.id)}
                        >
                          {busy ? t("sync.syncing") : t("settings.accountCloudDisconnect")}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="account-cloud-primary-action"
                        disabled={!cloudConnection || !cloudCanWrite || locked || busyKey !== null}
                        onClick={() =>
                          cloudConnection
                            ? void handleConnectLocalVault(cloudConnection, vault).catch(() => undefined)
                            : setCloudWizard({ kind: "cloudWizard", connection: null, vaultId: vault.id })
                        }
                      >
                        {busy ? t("sync.syncing") : t("settings.accountCloudConnectVault")}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="account-cloud-devices">
          <div className="account-cloud-section-head">
            <div>
              <p>{t("settings.accountCloudDevicesKicker")}</p>
              <h3>{t("settings.accountCloudDevicesTitle")}</h3>
              <span>{t("settings.accountCloudDevicesDescription")}</span>
            </div>
            <span className="account-cloud-device-pill">
              <DeviceGlyph />
              {getHostedDeviceName(settings)}
            </span>
          </div>
        </section>
      </div>

      {feedback ? (
        <div className={`account-cloud-feedback is-${feedback.tone}`} role="status">
          {feedback.text}
        </div>
      ) : null}

      <CloudVaultPickerSheet
        open={pickerOpen}
        title={t("settings.accountCloudImportKicker")}
        caption={t("settings.accountCloudImportTitle")}
        closeLabel={t("orbit.closeModal")}
        emptyLabel={t("settings.accountCloudNoRemoteVaults")}
        actionLabel={t("settings.accountCloudImportAction")}
        connectedLabel={t("settings.accountCloudConnected")}
        privateLabel={t("settings.vaultKindPrivate")}
        regularLabel={t("settings.vaultKindRegular")}
        busyKey={busyKey}
        remoteVaults={remoteVaults}
        localVaults={sortedVaults}
        cloudBindingByRemoteId={cloudBindingByRemoteId}
        getVaultLabel={getVaultLabel}
        onClose={() => setPickerOpen(false)}
        onImportRemoteVault={(remoteVault) => void handleImportRemoteVault(remoteVault)}
      />
    </section>
  );
}
