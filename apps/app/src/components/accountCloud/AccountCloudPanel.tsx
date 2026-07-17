import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { getDisplayVaultName } from "../../localization/displayNames";
import { getErrorMessage } from "../../lib/errors";
import { getHostedDeviceIdentity } from "../../lib/hostedDeviceIdentity";
import { formatDateValue, useLocale, type LocaleRuntime } from "../../localization";
import type { LocalVaultProfile } from "../../lib/localVaults";
import {
  createHostedVault,
  loadHostedAccountOverview,
  loginHostedAccount,
  logoutHostedAccount,
  pollHostedDeviceLogin,
  registerHostedAccount,
  registerHostedVaultDevice,
  revokeHostedAccountDevice,
  startHostedDeviceLogin,
  updateHostedAccountProfile,
  type HostedAccountOverview
} from "../../lib/sync";
import type {
  AppSettings,
  HostedAccountDevice,
  HostedAccountVault,
  HostedCloudEntitlement,
  RemoteVaultImportResult,
  SyncConnection,
  SyncVaultBinding,
  VaultEncryptionSummary
} from "../../types";
import useAutoDismissNotice from "../../lib/useAutoDismissNotice";
import { refreshHostedSessionSingleFlight } from "../../lib/hostedSessionRefresh";
import ActionFeedbackToast, { useActionFeedbackAnchor } from "../ActionFeedbackToast";
import ConfirmDialog from "../ConfirmDialog";
import MobileGlassHeader from "../MobileGlassHeader";
import SettingsSurface from "../SettingsSurface";
import CloudConnectionWizard, { type CloudWizardAuthResult } from "../sync/CloudConnectionWizard";
import AccountCloudDeviceList from "./AccountCloudDeviceList";
import AccountCloudVaultManager from "./AccountCloudVaultManager";
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
  onActivateLocalVault: (localVaultId: string) => void;
  onCreateConnection: (input: {
    provider: "hosted";
    role?: SyncConnection["role"];
    serverUrl: string;
    label?: string;
    sessionToken?: string;
    refreshToken?: string | null;
    tokenExpiresAt?: number | null;
    userId?: string | null;
    userName?: string;
    userEmail?: string;
  }) => SyncConnection | void | Promise<SyncConnection | void>;
  onDeleteConnection: (
    connectionId: string,
    options?: { skipConfirmation?: boolean }
  ) => void | Promise<void>;
  onUpdateConnection: (
    connectionId: string,
    patch: Partial<Omit<SyncConnection, "id" | "provider" | "createdAt" | "refreshToken">> & {
      refreshToken?: string | null;
    }
  ) => void | Promise<void>;
  onRefreshHostedConnectionCredentials: (connection: SyncConnection) => void | Promise<void>;
  onRestoreHostedVaultBindings: (
    connection: SyncConnection,
    remoteVaults: HostedAccountVault[]
  ) => Promise<{ restored: number; failed: number }>;
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
  onRenameLocalVault: (localVaultId: string, name: string) => void | Promise<void>;
  onDeleteLocalVault: (
    localVaultId: string,
    options?: { skipConfirmation?: boolean }
  ) => void | Promise<void>;
  onDeleteRemoteVault: (input: {
    connectionId: string;
    remoteVaultId: string;
  }) => Promise<void>;
  onRenameRemoteVault: (input: {
    connectionId: string;
    remoteVaultId: string;
    name: string;
  }) => Promise<void>;
  onClearBinding: (localVaultId: string) => void | Promise<void>;
  onRunVaultSync: (localVaultId: string) => void | Promise<void>;
};

type PanelDialog =
  | { kind: "cloudWizard"; connection?: SyncConnection | null; vaultId?: string | null }
  | null;

type DestructiveAction =
  | { kind: "localVault"; vault: LocalVaultProfile }
  | { kind: "remoteVault"; vault: HostedAccountVault }
  | { kind: "device"; device: HostedAccountDevice; current: boolean }
  | null;

function BackGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m15 6-6 6 6 6" />
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

function CloudGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M5.7 14.7h9.1a3 3 0 0 0 .3-6 5 5 0 0 0-9.8-1.5A3.9 3.9 0 0 0 5.7 14.7Z" />
      <path d="M8 10.9h4.5M10.3 8.7v4.5" />
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

function formatCloudDate(timestamp: number | null | undefined, runtime: LocaleRuntime) {
  if (!timestamp) {
    return "";
  }

  return formatDateValue(timestamp, runtime, {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function getUsageRatio(used: number, limit: number | null | undefined) {
  if (limit === null || limit === undefined) {
    return null;
  }

  if (limit <= 0) {
    return used > 0 ? 1 : 0;
  }

  return Math.max(0, Math.min(1, used / limit));
}

function getUsageTone(used: number, limit: number | null | undefined) {
  if (limit === null || limit === undefined || limit <= 0) {
    return used > 0 && limit === 0 ? "error" : "default";
  }

  const ratio = used / limit;

  if (ratio >= 1) {
    return "error";
  }

  if (ratio >= 0.8) {
    return "warning";
  }

  return "success";
}

function getAccountPeriodLabel(
  entitlement: HostedCloudEntitlement | null | undefined,
  runtime: LocaleRuntime,
  t: ReturnType<typeof useTranslation>["t"]
) {
  if (!entitlement) {
    return "—";
  }

  const effectiveDate = formatCloudDate(entitlement.effectiveUntil ?? entitlement.trialEndsAt, runtime);
  const trialDate = formatCloudDate(entitlement.trialEndsAt, runtime);
  const readOnlyDate = formatCloudDate(entitlement.retention?.readOnlyUntil, runtime);
  const archiveDate = formatCloudDate(entitlement.retention?.archiveUntil, runtime);

  if (entitlement.reason === "TRIAL_EXPIRED_READ_ONLY" && readOnlyDate) {
    return t("settings.accountCloudReadOnlyUntil", { date: readOnlyDate });
  }

  if (entitlement.reason === "TRIAL_ARCHIVED" && archiveDate) {
    return t("settings.accountCloudArchivedUntil", { date: archiveDate });
  }

  if (entitlement.reason === "TRIAL_RETENTION_EXPIRED" && archiveDate) {
    return t("settings.accountCloudRetentionEndedOn", { date: archiveDate });
  }

  if (entitlement.reason === "TRIAL_EXPIRED" && trialDate) {
    return t("settings.accountCloudTrialExpiredOn", { date: trialDate });
  }

  return effectiveDate
    ? t("settings.accountCloudPeriodUntil", { date: effectiveDate })
    : t("settings.accountCloudPeriodNoExpiry");
}

function getAccountDisplayName(
  name: string | null | undefined,
  email: string | null | undefined,
  label: string | null | undefined,
  fallback: string
) {
  return name?.trim() || email?.trim() || label?.trim() || fallback;
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
    case "TRIAL_EXPIRED_READ_ONLY":
    case "TRIAL_ARCHIVED":
      return t("sync.cloudTrialExpired");
    case "TRIAL_RETENTION_EXPIRED":
      return t("sync.cloudTrialRetentionExpired");
    case "SUBSCRIPTION_PAST_DUE":
      return t("sync.cloudSubscriptionPastDue");
    case "SUBSCRIPTION_EXPIRED_READ_ONLY":
      return t("sync.cloudReadOnly");
    case "SUBSCRIPTION_BLOCKED":
      return t("sync.cloudAccountBlocked");
    case "OVER_STORAGE_LIMIT":
      return t("sync.cloudStorageLimit");
    case "OVER_VAULT_LIMIT":
      return t("sync.cloudVaultLimit");
    case "OVER_DEVICE_LIMIT":
      return t("sync.cloudDeviceLimit");
    case "PAYLOAD_TOO_LARGE":
      return t("sync.cloudPayloadTooLarge");
    case "RATE_LIMITED":
      return t("sync.cloudRateLimited");
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
    case "CLOUD_REAUTH_REQUIRED":
    case "REFRESH_TOKEN_INVALID":
    case "REFRESH_TOKEN_REVOKED":
    case "REFRESH_TOKEN_EXPIRED":
    case "REFRESH_TOKEN_REUSED":
    case "REFRESH_TOKEN_DEVICE_MISMATCH":
      return t("sync.hostedSessionExpired");
    default:
      return message || t("sync.hostedFailedGeneric");
  }
}

function isProfileApiUnavailable(message: string) {
  return message === "SERVER_UNAVAILABLE" || message === "HTTP_404" || message === "HTTP_405" || message === "NOT_FOUND";
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
  onActivateLocalVault,
  onCreateConnection,
  onDeleteConnection,
  onUpdateConnection,
  onRefreshHostedConnectionCredentials,
  onRestoreHostedVaultBindings,
  onBindVault,
  onImportRemoteVault,
  onRenameLocalVault,
  onDeleteLocalVault,
  onDeleteRemoteVault,
  onRenameRemoteVault,
  onClearBinding,
  onRunVaultSync
}: AccountCloudPanelProps) {
  const { t, i18n } = useTranslation();
  const { runtime: localeRuntime } = useLocale();
  const [cloudWizard, setCloudWizard] = useState<PanelDialog>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [overview, setOverview] = useState<HostedAccountOverview | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [internalFeedback, setInternalFeedback] = useState<SyncFeedbackState>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [profileNameDirty, setProfileNameDirty] = useState(false);
  const [destructiveAction, setDestructiveAction] = useState<DestructiveAction>(null);
  const [dismissedFeedbackKey, setDismissedFeedbackKey] = useState<string | null>(null);
  const feedbackAnchor = useActionFeedbackAnchor([
    ".account-cloud-panel-shell",
    ".cloud-vault-picker-layer"
  ]);
  const feedback = internalFeedback ?? syncFeedback;
  const feedbackKey = feedback ? `${feedback.tone}:${feedback.text}` : null;
  const visibleFeedback = feedbackKey !== dismissedFeedbackKey ? feedback : null;

  useAutoDismissNotice(internalFeedback, setInternalFeedback);

  useEffect(() => {
    if (!feedbackKey) {
      setDismissedFeedbackKey(null);
    }
  }, [feedbackKey]);

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
      i18n.resolvedLanguage ?? i18n.language,
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

  const refreshCloudSession = async (connection: SyncConnection) => {
    const result = await refreshHostedSessionSingleFlight(
      connection,
      getHostedDeviceIdentity(settings.localDeviceId)
    );
    const refreshedConnection = {
      ...connection,
      sessionToken: result.session.token,
      refreshToken: result.session.refreshToken ?? connection.refreshToken ?? "",
      tokenExpiresAt: result.session.expiresAt,
      userId: result.user.id,
      userName: result.user.name,
      userEmail: result.user.email ?? connection.userEmail,
      label: result.user.email ?? result.user.name,
      updatedAt: Date.now()
    } satisfies SyncConnection;

    await Promise.resolve(
      onUpdateConnection(connection.id, {
        label: refreshedConnection.label,
        sessionToken: refreshedConnection.sessionToken,
        refreshToken: refreshedConnection.refreshToken ?? null,
        tokenExpiresAt: refreshedConnection.tokenExpiresAt,
        userId: refreshedConnection.userId,
        userName: refreshedConnection.userName,
        userEmail: refreshedConnection.userEmail
      })
    );
    return refreshedConnection;
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
    const loadWithRefresh = async () => {
      try {
        return await loadHostedAccountOverview(cloudConnection.serverUrl, cloudConnection.sessionToken);
      } catch (error) {
        if (getErrorMessage(error) !== "UNAUTHORIZED") {
          throw error;
        }

        const refreshedConnection = await refreshCloudSession(cloudConnection);
        return loadHostedAccountOverview(
          refreshedConnection.serverUrl,
          refreshedConnection.sessionToken
        );
      }
    };

    void loadWithRefresh()
      .then((nextOverview) => {
        if (!cancelled) {
          setOverview(nextOverview);
          setAuthRequired(false);
          setInternalFeedback(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          const message = getErrorMessage(error);
          setAuthRequired(
            [
              "UNAUTHORIZED",
              "CLOUD_REAUTH_REQUIRED",
              "REFRESH_TOKEN_INVALID",
              "REFRESH_TOKEN_REVOKED",
              "REFRESH_TOKEN_EXPIRED",
              "REFRESH_TOKEN_REUSED",
              "REFRESH_TOKEN_DEVICE_MISMATCH"
            ].includes(message)
          );
          setInternalFeedback({
            tone: "error",
            text: translateCloudError(message, t)
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

  const finishCloudAuthentication = async (connection: SyncConnection) => {
    let nextOverview = await loadHostedAccountOverview(
      connection.serverUrl,
      connection.sessionToken
    );
    setOverview(nextOverview);
    setAuthRequired(false);

    const restoration = await onRestoreHostedVaultBindings(connection, nextOverview.vaults);

    if (restoration.restored > 0) {
      nextOverview = await loadHostedAccountOverview(
        connection.serverUrl,
        connection.sessionToken
      );
      setOverview(nextOverview);
    }

    if (restoration.failed > 0) {
      showFeedback(
        "error",
        t("settings.accountCloudBindingsRestorePartial", {
          restored: restoration.restored,
          failed: restoration.failed
        })
      );
    } else if (restoration.restored > 0) {
      showFeedback(
        "success",
        t("settings.accountCloudBindingsRestored", {
          count: restoration.restored
        })
      );
    }

    return nextOverview;
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
        refreshToken?: string;
        expiresAt?: number;
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
        refreshToken: result.session.refreshToken ?? "",
        tokenExpiresAt: result.session.expiresAt ?? null,
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
          refreshToken: refreshedConnection.refreshToken ?? null,
          tokenExpiresAt: refreshedConnection.tokenExpiresAt,
          userId: refreshedConnection.userId,
          userName: refreshedConnection.userName,
          userEmail: refreshedConnection.userEmail
        })
      );
      await Promise.resolve(onRefreshHostedConnectionCredentials(refreshedConnection));

      return {
        connection: refreshedConnection,
        overview: await finishCloudAuthentication(refreshedConnection)
      };
    }

    const createdConnection = await Promise.resolve(
      onCreateConnection({
        provider: "hosted",
        role: "locorisCloud",
        serverUrl: normalizedUrl,
        sessionToken: result.session.token,
        refreshToken: result.session.refreshToken ?? null,
        tokenExpiresAt: result.session.expiresAt ?? null,
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
      overview: await finishCloudAuthentication(createdConnection)
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
            ...getHostedDeviceIdentity(settings.localDeviceId)
          })
        : await loginHostedAccount(input.serverUrl, {
            email: input.email,
            password: input.password,
            ...getHostedDeviceIdentity(settings.localDeviceId)
          });

    return upsertCloudConnection(input.serverUrl, result, input.connection);
  };

  const handleStartDeviceLogin = async (serverUrl: string) =>
    startHostedDeviceLogin(serverUrl, getHostedDeviceIdentity(settings.localDeviceId));

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
      getHostedDeviceIdentity(settings.localDeviceId)
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

  const handleRenameLocalVault = async (localVaultId: string, name: string) => {
    const actionKey = `rename-local:${localVaultId}`;
    setBusyKey(actionKey);

    try {
      const binding = cloudBindingByLocalId.get(localVaultId) ?? null;

      if (binding && cloudConnection) {
        await onRenameRemoteVault({
          connectionId: cloudConnection.id,
          remoteVaultId: binding.remoteVaultId,
          name
        });
        await loadOverview(cloudConnection);
      } else {
        await Promise.resolve(onRenameLocalVault(localVaultId, name));
      }
      showFeedback("success", t("settings.accountCloudLocalVaultRenamed", { vault: name }));
    } catch (error) {
      showFeedback("error", translateCloudError(getErrorMessage(error), t));
      throw error;
    } finally {
      setBusyKey((current) => (current === actionKey ? null : current));
    }
  };

  const handleRenameRemoteVault = async (remoteVault: HostedAccountVault, name: string) => {
    if (!cloudConnection) {
      throw new Error("UNAUTHORIZED");
    }

    const actionKey = `rename-cloud:${remoteVault.id}`;
    setBusyKey(actionKey);

    try {
      await onRenameRemoteVault({
        connectionId: cloudConnection.id,
        remoteVaultId: remoteVault.id,
        name
      });

      await loadOverview(cloudConnection);
      showFeedback("success", t("settings.accountCloudRemoteVaultRenamed", { vault: name }));
    } catch (error) {
      showFeedback("error", translateCloudError(getErrorMessage(error), t));
      throw error;
    } finally {
      setBusyKey((current) => (current === actionKey ? null : current));
    }
  };

  const handleDeleteLocalVault = async (vault: LocalVaultProfile) => {
    if (sortedVaults.length <= 1) {
      showFeedback("error", t("sync.localVaultCannotDeleteLast"));
      return;
    }

    const actionKey = `delete-local:${vault.id}`;
    setBusyKey(actionKey);

    try {
      await Promise.resolve(onDeleteLocalVault(vault.id, { skipConfirmation: true }));
      showFeedback("success", t("settings.accountCloudLocalVaultDeleted", { vault: getVaultLabel(vault) }));
    } catch (error) {
      showFeedback("error", translateCloudError(getErrorMessage(error), t));
    } finally {
      setBusyKey((current) => (current === actionKey ? null : current));
    }
  };

  const handleDeleteRemoteVault = async (remoteVault: HostedAccountVault) => {
    if (!cloudConnection) {
      return;
    }

    const actionKey = `delete-cloud:${remoteVault.id}`;
    setBusyKey(actionKey);

    try {
      await onDeleteRemoteVault({
        connectionId: cloudConnection.id,
        remoteVaultId: remoteVault.id
      });
      await loadOverview(cloudConnection);
      showFeedback("success", t("settings.accountCloudRemoteVaultDeleted", { vault: remoteVault.name }));
    } catch (error) {
      const message = getErrorMessage(error);

      if (message === "VAULT_NOT_FOUND") {
        const binding = cloudBindingByRemoteId.get(remoteVault.id) ?? null;

        if (binding) {
          await Promise.resolve(onClearBinding(binding.localVaultId));
        }
        await loadOverview(cloudConnection).catch(() => null);
        showFeedback("success", t("settings.accountCloudRemoteVaultAlreadyDeleted", { vault: remoteVault.name }));
      } else {
        showFeedback("error", translateCloudError(message, t));
      }
    } finally {
      setBusyKey((current) => (current === actionKey ? null : current));
    }
  };

  const handleRevokeDevice = async (device: HostedAccountDevice, current: boolean) => {
    if (!cloudConnection) {
      return;
    }

    const actionKey = `revoke-device:${device.id}`;
    setBusyKey(actionKey);

    try {
      if (device.id.startsWith("session-")) {
        await logoutHostedAccount(cloudConnection.serverUrl, cloudConnection.sessionToken);
      } else {
        await revokeHostedAccountDevice(
          cloudConnection.serverUrl,
          cloudConnection.sessionToken,
          device.id
        );
      }

      if (current) {
        await Promise.resolve(onDeleteConnection(cloudConnection.id, { skipConfirmation: true }));
        setOverview(null);
        showFeedback("success", t("settings.accountCloudCurrentDeviceSignedOut"));
      } else {
        await loadOverview(cloudConnection);
        showFeedback("success", t("settings.accountCloudDeviceRevoked", { device: device.deviceName }));
      }
    } catch (error) {
      const message = getErrorMessage(error);

      if (message === "DEVICE_NOT_FOUND" && !current) {
        await loadOverview(cloudConnection).catch(() => null);
        showFeedback("success", t("settings.accountCloudDeviceAlreadyRevoked", { device: device.deviceName }));
      } else {
        showFeedback("error", translateCloudError(message, t));
      }
    } finally {
      setBusyKey((currentKey) => (currentKey === actionKey ? null : currentKey));
    }
  };

  const confirmDestructiveAction = () => {
    const action = destructiveAction;
    setDestructiveAction(null);

    if (!action) {
      return;
    }

    if (action.kind === "localVault") {
      void handleDeleteLocalVault(action.vault);
      return;
    }

    if (action.kind === "remoteVault") {
      void handleDeleteRemoteVault(action.vault);
      return;
    }

    void handleRevokeDevice(action.device, action.current);
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
  const cloudImportAccountLabel = cloudConnection
    ? overview?.user.email ?? (cloudConnection.userEmail || cloudConnection.label || t("settings.accountCloudReady"))
    : t("settings.accountCloudSignedOut");
  const cloudCanWrite = overview?.entitlement.capabilities.canWriteSync ?? true;
  const cloudCanDelete = overview?.entitlement.capabilities.canDeleteCloudData ?? true;
  const accountPeriodLabel = getAccountPeriodLabel(overview?.entitlement, localeRuntime, t);
  const accountUsageMeters = overview
    ? [
        {
          key: "vaults",
          label: t("settings.accountCloudVaults"),
          used: overview.usage.vaultCount,
          limit: overview.entitlement.limits.maxVaults,
          format: (value: number) => String(value)
        },
        {
          key: "devices",
          label: t("settings.accountCloudDevices"),
          used: overview.usage.deviceCount ?? overview.usage.syncTokenCount,
          limit: overview.entitlement.limits.maxSyncTokens,
          format: (value: number) => String(value)
        },
        {
          key: "storage",
          label: t("settings.accountCloudStorage"),
          used: overview.usage.storageBytes,
          limit: overview.entitlement.limits.storageBytes,
          format: formatBytes
        }
      ]
    : [];
  const cloudProfileName = overview?.user.name ?? cloudConnection?.userName ?? "";
  const cloudProfileEmail = overview?.user.email ?? cloudConnection?.userEmail ?? "";
  const cloudProfileDisplayName = getAccountDisplayName(
    cloudProfileName,
    cloudProfileEmail,
    cloudConnection?.label,
    t("settings.accountCloudProfileFallbackName")
  );
  const accountDevices = (() => {
    if (!cloudConnection || !overview) {
      return [];
    }

    const devices = [...overview.devices];
    const hostedDeviceIdentity = getHostedDeviceIdentity(settings.localDeviceId);
    const currentDeviceId = overview.session.deviceId ?? hostedDeviceIdentity.deviceId;

    if (currentDeviceId && !devices.some((device) => device.deviceId === currentDeviceId)) {
      devices.unshift({
        id: `session-${overview.session.id}`,
        credentialId: null,
        sessionIds: [overview.session.id],
        vaultId: null,
        vaultName: "",
        vaultIds: [],
        vaultNames: [],
        vaultCount: 0,
        deviceId: currentDeviceId,
        deviceName: overview.session.deviceName || hostedDeviceIdentity.deviceName,
        clientPlatform: overview.session.clientPlatform || hostedDeviceIdentity.clientPlatform,
        createdAt: overview.session.createdAt,
        lastUsedAt: overview.session.createdAt,
        revokedAt: null,
        expiresAt: overview.session.expiresAt,
        active: overview.session.expiresAt > Date.now()
      } satisfies HostedAccountDevice);
    }

    return devices;
  })();
  const profileNameChanged = profileNameDraft.trim() !== cloudProfileName.trim();
  const wizardConnection = cloudWizard?.kind === "cloudWizard" ? cloudWizard.connection ?? cloudConnection : cloudConnection;
  const wizardSelectedVaultId =
    cloudWizard?.kind === "cloudWizard" && cloudWizard.vaultId
      ? cloudWizard.vaultId
      : selectedVault?.id ?? selectedLocalVaultId;
  const closeCloudWizard = () => {
    setCloudWizard(null);
    void loadOverview();
  };

  const destructiveDialog = (() => {
    if (!destructiveAction) {
      return null;
    }

    if (destructiveAction.kind === "localVault") {
      const vaultName = getVaultLabel(destructiveAction.vault);
      const binding = cloudBindingByLocalId.get(destructiveAction.vault.id) ?? null;

      return {
        kicker: t("settings.accountCloudLocalVaultDangerKicker"),
        title: t("settings.accountCloudDeleteLocalVaultTitle", { vault: vaultName }),
        message: t("settings.accountCloudDeleteLocalVaultMessage"),
        details: [
          binding
            ? t("settings.accountCloudDeleteLocalVaultCloudRemains", { vault: binding.remoteVaultName })
            : t("settings.accountCloudDeleteLocalVaultNoCloud"),
          destructiveAction.vault.id === activeLocalVaultId
            ? t("settings.accountCloudDeleteActiveLocalVaultDetail")
            : t("settings.accountCloudDeleteLocalVaultPermanentDetail")
        ],
        confirmLabel: t("settings.accountCloudDeleteLocalVault")
      };
    }

    if (destructiveAction.kind === "remoteVault") {
      const binding = cloudBindingByRemoteId.get(destructiveAction.vault.id) ?? null;
      const localVault = binding
        ? sortedVaults.find((vault) => vault.id === binding.localVaultId) ?? null
        : null;

      return {
        kicker: t("settings.accountCloudRemoteVaultDangerKicker"),
        title: t("settings.accountCloudDeleteRemoteVaultTitle", { vault: destructiveAction.vault.name }),
        message: t("settings.accountCloudDeleteRemoteVaultMessage"),
        details: [
          localVault
            ? t("settings.accountCloudDeleteRemoteVaultLocalRemains", { vault: getVaultLabel(localVault) })
            : t("settings.accountCloudDeleteRemoteVaultNoLocal"),
          t("settings.accountCloudDeleteRemoteVaultDevicesRevoked", {
            count: destructiveAction.vault.deviceCount ?? destructiveAction.vault.tokenCount
          })
        ],
        confirmLabel: t("settings.accountCloudDeleteRemoteVault")
      };
    }

    return {
      kicker: t("settings.accountCloudDeviceDangerKicker"),
      title: destructiveAction.current
        ? t("settings.accountCloudSignOutThisDeviceTitle")
        : t("settings.accountCloudRevokeDeviceTitle", { device: destructiveAction.device.deviceName }),
      message: destructiveAction.current
        ? t("settings.accountCloudSignOutThisDeviceMessage")
        : t("settings.accountCloudRevokeDeviceMessage"),
      details: [
        t("settings.accountCloudRevokeDeviceSessionsDetail"),
        t("settings.accountCloudRevokeDeviceLocalDataDetail")
      ],
      confirmLabel: destructiveAction.current
        ? t("settings.accountCloudSignOutThisDevice")
        : t("settings.accountCloudRevokeDevice")
    };
  })();

  const openCloudImport = () => {
    setPickerOpen(true);

    if (!cloudConnection || !online || overview || busyKey !== null) {
      return;
    }

    setBusyKey("overview");
    loadOverview(cloudConnection)
      .catch((error) => {
        showFeedback("error", translateCloudError(getErrorMessage(error), t));
      })
      .finally(() => {
        setBusyKey((current) => (current === "overview" ? null : current));
      });
  };

  const closeCloudImport = () => {
    setPickerOpen(false);
  };

  const openImportedLocalVault = (localVaultId: string) => {
    onActivateLocalVault(localVaultId);
    closeCloudImport();
  };

  useEffect(() => {
    setProfileNameDraft(cloudProfileName);
    setProfileNameDirty(false);
  }, [cloudConnection?.id, cloudProfileName]);

  const applyLocalProfileName = async (name: string) => {
    if (!cloudConnection) {
      return;
    }

    setOverview((current) =>
      current
        ? {
            ...current,
            user: {
              ...current.user,
              name
            }
          }
        : current
    );
    await Promise.resolve(
      onUpdateConnection(cloudConnection.id, {
        userName: name,
        userEmail: cloudProfileEmail || cloudConnection.userEmail
      })
    );
    setProfileNameDraft(name);
    setProfileNameDirty(false);
  };

  const handleProfileSave = async () => {
    if (!cloudConnection || busyKey !== null || !online || !profileNameChanged) {
      return;
    }

    setBusyKey("profile");

    try {
      const nextName = profileNameDraft.trim();
      const result = await updateHostedAccountProfile(cloudConnection.serverUrl, cloudConnection.sessionToken, {
        name: nextName
      });

      setOverview((current) =>
        current
          ? {
              ...current,
              user: result.user
            }
          : current
      );
      await Promise.resolve(
        onUpdateConnection(cloudConnection.id, {
          userName: result.user.name,
          userEmail: result.user.email ?? cloudConnection.userEmail
        })
      );
      setProfileNameDraft(result.user.name);
      setProfileNameDirty(false);
      showFeedback("success", t("settings.accountCloudProfileSaved"));
    } catch (error) {
      const message = getErrorMessage(error);

      if (isProfileApiUnavailable(message)) {
        await applyLocalProfileName(profileNameDraft.trim());
        showFeedback("success", t("settings.accountCloudProfileSavedLocally"));
      } else {
        showFeedback("error", translateCloudError(message, t));
      }
    } finally {
      setBusyKey((current) => (current === "profile" ? null : current));
    }
  };

  if (cloudWizard?.kind === "cloudWizard") {
    return (
      <SettingsSurface className="account-cloud-panel-shell is-account-cloud-wizard">
        <MobileGlassHeader
          className="settings-panel-header account-cloud-panel-header has-back-action"
          kicker={t("settings.accountCloudTitle")}
          title={wizardConnection ? t("settings.accountCloudManage") : t("settings.accountCloudSignIn")}
          backLabel={t("settings.back")}
          closeLabel={t("orbit.closeModal")}
          backIcon={<BackGlyph />}
          closeIcon={<CloseGlyph />}
          onBack={closeCloudWizard}
          onClose={onClose}
        />

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
      </SettingsSurface>
    );
  }

  return (
    <SettingsSurface className="account-cloud-panel-shell">
      <MobileGlassHeader
        className="settings-panel-header account-cloud-panel-header has-back-action"
        title={t("settings.accountCloudTitle")}
        kicker={t("settings.title")}
        backLabel={t("settings.back")}
        closeLabel={t("orbit.closeModal")}
        backIcon={<BackGlyph />}
        closeIcon={<CloseGlyph />}
        onBack={onBack}
        onClose={onClose}
      />

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
                  ? cloudProfileDisplayName
                  : t("settings.accountCloudNoAccountTitle")}
              </h3>
              <span>
                {cloudConnection
                  ? cloudProfileName.trim()
                    ? cloudProfileEmail || t("settings.accountCloudProfileDescription")
                    : t("settings.accountCloudProfileFallbackDescription", {
                        fallback: cloudProfileDisplayName
                      })
                  : t("settings.accountCloudNoAccountDescription")}
              </span>
              {cloudConnection ? (
                <form
                  className="account-cloud-profile-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleProfileSave();
                  }}
                >
                  <label>
                    <span>{t("settings.accountCloudProfileNameLabel")}</span>
                    <input
                      type="text"
                      value={profileNameDraft}
                      maxLength={120}
                      placeholder={t("settings.accountCloudProfileNamePlaceholder")}
                      disabled={busyKey !== null || !online}
                      onChange={(event) => {
                        setProfileNameDraft(event.target.value);
                        setProfileNameDirty(true);
                      }}
                    />
                  </label>
                  <button
                    type="submit"
                    className="account-cloud-secondary-action"
                    disabled={busyKey !== null || !online || !profileNameDirty || !profileNameChanged}
                  >
                    {busyKey === "profile" ? t("settings.connectionChecking") : t("settings.accountCloudProfileSave")}
                  </button>
                </form>
              ) : null}
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
              {authRequired
                ? t("settings.hostedReconnect")
                : cloudConnection
                  ? t("settings.accountCloudManage")
                  : t("settings.accountCloudSignIn")}
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

        <section className="account-cloud-overview" aria-label={t("settings.accountCloudStatusTitle")}>
          <div className="account-cloud-overview-meta">
            <div>
              <span>{t("settings.accountCloudPlan")}</span>
              <strong>{overview?.entitlement.plan.name ?? "—"}</strong>
            </div>
            <div>
              <span>{t("settings.accountCloudPeriod")}</span>
              <strong>{accountPeriodLabel}</strong>
            </div>
          </div>

          {overview ? (
            <div className="account-cloud-usage-meters">
              {accountUsageMeters.map((meter) => {
                const ratio = getUsageRatio(meter.used, meter.limit);
                const tone = getUsageTone(meter.used, meter.limit);
                const limitLabel =
                  meter.limit === null || meter.limit === undefined
                    ? t("settings.accountCloudUnlimited")
                    : meter.format(meter.limit);
                const valueLabel = `${meter.format(meter.used)} / ${limitLabel}`;

                return (
                  <div
                    key={meter.key}
                    className={`account-cloud-usage-meter is-${tone} ${ratio === null ? "is-unlimited" : ""}`}
                    style={{ "--account-cloud-meter-fill": `${(ratio ?? 1) * 100}%` } as CSSProperties}
                  >
                    <div className="account-cloud-usage-copy">
                      <span>{meter.label}</span>
                      <strong>{valueLabel}</strong>
                    </div>
                    <span
                      className="account-cloud-usage-track"
                      role={ratio === null ? undefined : "progressbar"}
                      aria-label={meter.label}
                      aria-valuemin={ratio === null ? undefined : 0}
                      aria-valuemax={ratio === null ? undefined : meter.limit ?? undefined}
                      aria-valuenow={ratio === null ? undefined : meter.used}
                    >
                      <span />
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="account-cloud-overview-loading" role="status">
              {cloudConnection
                ? busyKey === "overview"
                  ? t("settings.connectionChecking")
                  : t("settings.connectionUnavailable")
                : t("settings.accountCloudSignedOut")}
            </div>
          )}
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
              disabled={!cloudConnection || busyKey !== null || !online}
              onClick={openCloudImport}
            >
              {t("settings.accountCloudImportFromCloud")}
            </button>
          </div>

          <AccountCloudVaultManager
            localVaults={sortedVaults}
            remoteVaults={remoteVaults}
            activeLocalVaultId={activeLocalVaultId}
            cloudConnected={Boolean(cloudConnection)}
            cloudCanWrite={cloudCanWrite}
            cloudCanDelete={cloudCanDelete}
            online={online}
            busyKey={busyKey}
            language={i18n.language}
            vaultEncryptionById={vaultEncryptionById}
            cloudBindingByLocalId={cloudBindingByLocalId}
            cloudBindingByRemoteId={cloudBindingByRemoteId}
            getVaultLabel={getVaultLabel}
            onOpenLocalVault={onActivateLocalVault}
            onConnectLocalVault={(vault) => {
              if (cloudConnection) {
                void handleConnectLocalVault(cloudConnection, vault).catch(() => undefined);
              } else {
                setCloudWizard({ kind: "cloudWizard", connection: null, vaultId: vault.id });
              }
            }}
            onDisconnectLocalVault={(localVaultId) => void handleDisconnectVault(localVaultId)}
            onRunVaultSync={(localVaultId) => void onRunVaultSync(localVaultId)}
            onImportRemoteVault={(remoteVault) => void handleImportRemoteVault(remoteVault)}
            onRenameLocalVault={handleRenameLocalVault}
            onRenameRemoteVault={handleRenameRemoteVault}
            onRequestDeleteLocalVault={(vault) => setDestructiveAction({ kind: "localVault", vault })}
            onRequestDeleteRemoteVault={(vault) => setDestructiveAction({ kind: "remoteVault", vault })}
            onRequestCloudSignIn={() =>
              setCloudWizard({
                kind: "cloudWizard",
                connection: null,
                vaultId: selectedVault?.id ?? null
              })
            }
          />
        </section>

        <section className="account-cloud-devices">
          <div className="account-cloud-section-head">
            <div>
              <p>{t("settings.accountCloudDevicesKicker")}</p>
              <h3>{t("settings.accountCloudDevicesTitle")}</h3>
              <span>{t("settings.accountCloudDevicesDescription")}</span>
            </div>
          </div>

          {accountDevices.length > 0 ? (
            <AccountCloudDeviceList
              devices={accountDevices}
              currentDeviceId={
                overview?.session.deviceId ?? getHostedDeviceIdentity(settings.localDeviceId).deviceId
              }
              language={i18n.language}
              online={online}
              busyDeviceId={busyKey?.startsWith("revoke-device:") ? busyKey.slice("revoke-device:".length) : null}
              onRequestRevoke={(device, current) =>
                setDestructiveAction({ kind: "device", device, current })
              }
            />
          ) : (
            <div className="account-cloud-device-empty">
              {cloudConnection
                ? t("settings.accountCloudDevicesUnavailable")
                : t("settings.accountCloudSignedOut")}
            </div>
          )}
        </section>

      </div>

      {visibleFeedback ? (
        <ActionFeedbackToast
          anchor={feedbackAnchor}
          tone={visibleFeedback.tone}
          dismissLabel={t("orbit.closeModal")}
          onDismiss={() => {
            setDismissedFeedbackKey(feedbackKey);
            if (internalFeedback) {
              setInternalFeedback(null);
            }
          }}
        >
          {visibleFeedback.text}
        </ActionFeedbackToast>
      ) : null}

      <CloudVaultPickerSheet
        open={pickerOpen}
        title={t("settings.accountCloudImportKicker")}
        caption={t("settings.accountCloudImportTitle")}
        accountLabel={cloudImportAccountLabel}
        closeLabel={t("orbit.closeModal")}
        emptyLabel={t("settings.accountCloudNoRemoteVaults")}
        emptyDescription={t("settings.accountCloudImportEmptyDescription")}
        actionLabel={t("settings.accountCloudImportAction")}
        busyLabel={t("sync.syncing")}
        connectedLabel={t("settings.accountCloudConnected")}
        openLocalLabel={t("settings.accountCloudImportOpenLocal")}
        privateLabel={t("settings.vaultKindPrivate")}
        regularLabel={t("settings.vaultKindRegular")}
        loadingLabel={t("settings.accountCloudImportLoading")}
        offlineLabel={t("settings.accountCloudImportOffline")}
        refreshLabel={t("settings.accountCloudImportRefresh")}
        busyKey={busyKey}
        loading={busyKey === "overview" && !overview}
        refreshing={busyKey === "overview"}
        online={online}
        remoteVaults={remoteVaults}
        localVaults={sortedVaults}
        cloudBindingByRemoteId={cloudBindingByRemoteId}
        getVaultLabel={getVaultLabel}
        onClose={closeCloudImport}
        onRefresh={() => void handleRefresh()}
        onOpenLocalVault={openImportedLocalVault}
        onImportRemoteVault={(remoteVault) => void handleImportRemoteVault(remoteVault)}
      />

      <ConfirmDialog
        open={Boolean(destructiveDialog)}
        kicker={destructiveDialog?.kicker ?? ""}
        title={destructiveDialog?.title ?? ""}
        message={destructiveDialog?.message ?? ""}
        details={destructiveDialog?.details ?? []}
        confirmLabel={destructiveDialog?.confirmLabel ?? t("dialog.ok")}
        cancelLabel={t("dialog.cancel")}
        tone="danger"
        onCancel={() => setDestructiveAction(null)}
        onConfirm={confirmDestructiveAction}
      />
    </SettingsSurface>
  );
}
