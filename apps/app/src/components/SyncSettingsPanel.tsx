import {
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import { useTranslation } from "react-i18next";
import { formatDateTimeValue, useLocale, type LocaleRuntime } from "../localization";

import type { LocalVaultKind, LocalVaultProfile } from "../lib/localVaults";
import { getDisplayVaultName } from "../localization/displayNames";
import { getErrorMessage } from "../lib/errors";
import { getHostedDeviceIdentity } from "../lib/hostedDeviceIdentity";
import {
  connectGoogleDriveAccount,
  createHostedVault,
  createGoogleDriveVault,
  createPersonalServerVault,
  getConfiguredGoogleDriveClientId,
  googleDriveClientConfigured,
  googleDriveOAuthReady,
  GOOGLE_DRIVE_TOKEN_REFRESH_SKEW_MS,
  issueGoogleDriveVaultToken,
  issuePersonalServerVaultToken,
  loadHostedAccountOverview,
  loadGoogleDriveVaults,
  loadPersonalServerVaults,
  loginHostedAccount,
  pollHostedDeviceLogin,
  prepareGoogleDriveOAuth,
  probeSyncConnectionAvailability,
  refreshGoogleDriveAccountSession,
  registerHostedVaultDevice,
  registerHostedAccount,
  startHostedDeviceLogin,
  type HostedAccountOverview
} from "../lib/sync";
import {
  discoverSelfHostedServers,
  selfHostedDiscoveryAvailable
} from "../lib/selfHostedDiscovery";
import {
  consumeSelfHostedEndpointUpdate,
  SELF_HOSTED_ENDPOINT_UPDATE_EVENT
} from "../lib/selfHostedEndpointUpdates";
import type {
  AppSettings,
  RemoteVaultImportResult,
  SyncConnection,
  SyncRemoteVault,
  SyncVaultBinding,
  VaultEncryptionSummary
} from "../types";
import useAutoDismissNotice from "../lib/useAutoDismissNotice";
import {
  consumeIncomingSelfHostedConnectionPackage,
  SELF_HOSTED_INVITE_EVENT
} from "../lib/selfHostedPairing";
import ActionFeedbackToast, { useActionFeedbackAnchor } from "./ActionFeedbackToast";
import ConfirmDialog from "./ConfirmDialog";
import CloudConnectionWizard, { type CloudWizardAuthResult } from "./sync/CloudConnectionWizard";
import SelfHostedAccessManager from "./sync/SelfHostedAccessManager";
import SelfHostedConnectionWizard from "./sync/SelfHostedConnectionWizard";
import SelfHostedEndpointEditor from "./sync/SelfHostedEndpointEditor";
import { SyncSettingsDialog, SyncSettingsLayout } from "./sync/SyncSettingsLayout";
import SyncSettingsMobile from "./sync/SyncSettingsMobile";
import "./SyncSettingsPanel.css";

type SyncFeedbackState = {
  tone: "success" | "error";
  text: string;
} | null;

interface SyncSettingsPanelProps {
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
  onCreateLocalVault: (input: {
    name: string;
    vaultKind: LocalVaultKind;
    passphrase?: string;
  }) => string | Promise<string>;
  onRenameLocalVault: (localVaultId: string, name: string) => void;
  onDeleteLocalVault: (
    localVaultId: string,
    options?: {
      skipConfirmation?: boolean;
    }
  ) => void | Promise<void>;
  onCreateConnection: (input: {
    provider: "selfHosted" | "hosted" | "googleDrive";
    role?: SyncConnection["role"];
    serverUrl: string;
    label?: string;
    managementToken?: string;
    sessionToken?: string;
    refreshToken?: string | null;
    tokenExpiresAt?: number | null;
    userId?: string | null;
    userName?: string;
    userEmail?: string;
    selfHostedDeviceId?: string | null;
    selfHostedRole?: "owner" | "guest" | null;
    selfHostedServerId?: string | null;
  }) => SyncConnection | void | Promise<SyncConnection | void>;
  onDeleteConnection: (connectionId: string) => void | Promise<void>;
  onRevokeGoogleDriveConnection: (connectionId: string) => void | Promise<void>;
  onUpdateConnection: (
    connectionId: string,
    patch: Partial<Omit<SyncConnection, "id" | "provider" | "createdAt" | "refreshToken">> & {
      refreshToken?: string | null;
    }
  ) => void | Promise<void>;
  onRefreshHostedConnectionCredentials: (connection: SyncConnection) => void | Promise<void>;
  onRefreshGoogleDriveConnectionCredentials: (connection: SyncConnection) => void | Promise<void>;
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
    remoteVaultKind?: LocalVaultKind;
    openAfterImport?: boolean;
  }) => Promise<RemoteVaultImportResult>;
  onDeleteRemoteVault: (input: {
    connectionId: string;
    remoteVaultId: string;
  }) => Promise<void>;
  onClearBinding: (localVaultId: string) => void | Promise<void>;
  onRunVaultSync: (
    localVaultId: string,
    connectionOverride?: SyncConnection
  ) => void | Promise<void>;
  onEnableVaultEncryption: (input: {
    localVaultId: string;
    passphrase: string;
  }) => void | Promise<void>;
  onUnlockVaultEncryption: (input: {
    localVaultId: string;
    passphrase: string;
  }) => void | Promise<void>;
  onChangeVaultEncryptionPassphrase: (input: {
    localVaultId: string;
    currentPassphrase?: string;
    nextPassphrase: string;
  }) => void | Promise<void>;
  onDisableVaultEncryption: (input: {
    localVaultId: string;
    currentPassphrase?: string;
  }) => void | Promise<void>;
  onLockVaultEncryption: (localVaultId: string) => void | Promise<void>;
}

type VaultEncryptionModalView = "default" | "unlock" | "changePassphrase" | "disable";
type VaultEncryptionContinuationKind = "import" | "sync" | null;

type PanelModal =
  | { kind: "createVault" }
  | { kind: "renameVault"; vault: LocalVaultProfile }
  | {
      kind: "vaultEncryption";
      vault: LocalVaultProfile;
      view?: VaultEncryptionModalView;
      continuation?: VaultEncryptionContinuationKind;
    }
  | { kind: "addConnection" }
  | { kind: "addSelfHosted" }
  | { kind: "manageSelfHosted"; connection: SyncConnection }
  | { kind: "editSelfHostedEndpoint"; connection: SyncConnection; initialServerUrl?: string }
  | { kind: "hostedWizard"; connection?: SyncConnection | null }
  | { kind: "addHosted"; connection?: SyncConnection | null }
  | { kind: "addGoogleDrive" }
  | null;

type ConfirmState = {
  title: string;
  description: string;
  details?: string[];
  confirmLabel: string;
  tone?: "default" | "danger";
  action: () => Promise<void> | void;
  secondaryLabel?: string;
  secondaryTone?: "default" | "danger";
  secondaryAction?: () => Promise<void> | void;
} | null;

type HostedMode = "login" | "register";

type LinkMetric = {
  id: string;
  path: string;
  color: string;
  statusTone: "idle" | "syncing" | "error";
};

type ConnectionAvailabilityState =
  | "checking"
  | "available"
  | "unavailable"
  | "authError";

type RemoteVaultCatalogEntry = SyncRemoteVault;

function ChevronLeftGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M10 4.1v11.8M4.1 10h11.8" />
    </svg>
  );
}

function EditGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="m5.1 14.9 2.8-.7 6.1-6.1-2.1-2.1-6.1 6.1-.7 2.8Z" />
      <path d="m10.8 5.4 2.1 2.1" className="sync-settings-icon-accent" />
    </svg>
  );
}

function TrashGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M5.8 6.2h8.4" />
      <path d="M7.4 6.2v8.2c0 1 .6 1.6 1.6 1.6h2c1 0 1.6-.6 1.6-1.6V6.2" />
      <path d="M8.4 4.6h3.2" />
      <path d="M8.4 8.4v4.7M11.6 8.4v4.7" className="sync-settings-icon-accent" />
    </svg>
  );
}

function VaultGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M3.7 6.2h12.6v8.7H3.7z" />
      <path d="M3.7 6.2 6.1 4.5h7.8l2.4 1.7" className="sync-settings-icon-accent" />
      <path d="M7 9.1h6" className="sync-settings-icon-accent" />
    </svg>
  );
}

function LockGlyph({ unlocked = false }: { unlocked?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        d={
          unlocked
            ? "M6.2 8V6.8A3.8 3.8 0 0 1 13 4.5M5 8.1h10v7.6H5z"
            : "M6.2 8V6.7a3.8 3.8 0 1 1 7.6 0V8M5 8.1h10v7.6H5z"
        }
      />
      <path d="M10 10.3v2.5" className="sync-settings-icon-accent" />
    </svg>
  );
}

function HostedGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="6.4" />
      <path d="M10 3.6v12.8M3.6 10h12.8" className="sync-settings-icon-accent" />
      <path d="M5.9 5.9c1.7 1.2 4.6 1.9 8.2 0M5.9 14.1c1.7-1.2 4.6-1.9 8.2 0" className="sync-settings-icon-accent" />
    </svg>
  );
}

function SelfHostedGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="3.4" y="4.4" width="13.2" height="4.2" rx="1.4" />
      <rect x="3.4" y="11.4" width="13.2" height="4.2" rx="1.4" />
      <path d="M6.2 6.5h1.8M6.2 13.5h1.8" className="sync-settings-icon-accent" />
    </svg>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M16.2 10a6.2 6.2 0 1 1-1.8-4.4" />
      <path d="M16.2 10H10" className="sync-settings-icon-accent" />
      <path d="M13.4 7.2h2.8V10" className="sync-settings-icon-accent" />
    </svg>
  );
}

function LinkGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M7.3 12.7 5.6 14.4a2.4 2.4 0 1 1-3.4-3.4L4 9.3" />
      <path d="M12.7 7.3 14.4 5.6A2.4 2.4 0 1 1 17.8 9l-1.8 1.7" />
      <path d="m6.8 13.2 6.4-6.4" className="sync-settings-icon-accent" />
    </svg>
  );
}

function RemoteVaultCatalogGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="3.4" y="4.4" width="13.2" height="11.2" rx="2.2" />
      <path d="M6.2 7.1h5.4M6.2 10h4.2M6.2 12.9h3.2" />
      <path d="M13.2 10.8a2.6 2.6 0 1 1-.8 1.8" className="sync-settings-icon-accent" />
      <path d="M12.4 10.6h2.4v2.2" className="sync-settings-icon-accent" />
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

function ChevronToggleGlyph({ expanded = false }: { expanded?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        d={expanded ? "M5.5 7.6 10 12.1l4.5-4.5" : "M7.6 5.5 12.1 10l-4.5 4.5"}
        className="sync-settings-icon-accent"
      />
    </svg>
  );
}

function providerAccent(provider: SyncConnection["provider"]) {
  if (provider === "hosted") {
    return "#73f7ff";
  }

  if (provider === "googleDrive") {
    return "#9cf98d";
  }

  return "#ffd27d";
}

function buildLinkPath(x1: number, y1: number, x2: number, y2: number) {
  const curve = Math.max(48, Math.abs(x2 - x1) * 0.34);
  return `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`;
}

function formatTime(timestamp: number | null, runtime: LocaleRuntime) {
  if (!timestamp) {
    return "—";
  }

  return formatDateTimeValue(timestamp, runtime, {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short"
  });
}

function translateSyncManagerError(message: string, t: ReturnType<typeof useTranslation>["t"]) {
  switch (message) {
    case "SELF_HOSTED_URL_REQUIRED":
    case "SYNC_SERVER_URL_REQUIRED":
      return t("sync.urlRequired");
    case "SYNC_TOKEN_REQUIRED":
    case "SELF_HOSTED_TOKEN_REQUIRED":
      return t("sync.tokenRequired");
    case "PAIRING_PACKAGE_INVALID":
    case "PAIRING_CODE_INVALID":
    case "PAIRING_INVITE_INVALID":
    case "PAIRING_INVITE_UNAVAILABLE":
    case "PAIRING_REQUEST_NOT_FOUND":
      return t("settings.selfHostedPairingInvalid");
    case "PAIRING_PACKAGE_VERSION_UNSUPPORTED":
      return t("settings.selfHostedPairingUnsupported");
    case "PAIRING_RATE_LIMITED":
      return t("settings.selfHostedPairingRateLimited");
    case "PAIRING_SERVER_URL_INVALID":
      return t("settings.selfHostedPairingServerUrlInvalid");
    case "SELF_HOSTED_SERVER_MISMATCH":
      return t("settings.selfHostedEndpointServerMismatch");
    case "SELF_HOSTED_ADDRESS_UNCHANGED":
      return t("settings.selfHostedEndpointAddressUnchanged");
    case "SELF_HOSTED_SERVER_ID_REQUIRED":
      return t("settings.selfHostedEndpointConnectionNotFound");
    case "PAIRING_SETUP_ALREADY_COMPLETED":
      return t("settings.selfHostedPairingInvalid");
    case "PAIRING_REQUEST_EXPIRED":
      return t("settings.selfHostedPairingExpired");
    case "OWNER_ACCESS_REQUIRED":
      return t("settings.selfHostedOwnerRequired");
    case "CURRENT_DEVICE_REVOKE_FORBIDDEN":
      return t("settings.selfHostedCurrentDeviceRevokeForbidden");
    case "LAST_OWNER_DEVICE_REQUIRED":
      return t("settings.selfHostedLastOwnerRequired");
    case "HOSTED_URL_REQUIRED":
      return t("sync.hostedUrlRequired");
    case "GOOGLE_DRIVE_AUTH_REQUIRED":
      return t("sync.googleDriveAuthRequired");
    case "GOOGLE_DRIVE_INTERACTION_REQUIRED":
      return t("sync.googleDriveInteractionRequired");
    case "GOOGLE_DRIVE_STORAGE_QUOTA_EXCEEDED":
      return t("sync.googleDriveStorageQuotaExceeded");
    case "GOOGLE_DRIVE_RATE_LIMITED":
      return t("sync.googleDriveRateLimited");
    case "GOOGLE_DRIVE_PERMISSION_REQUIRED":
      return t("sync.googleDrivePermissionRequired");
    case "GOOGLE_DRIVE_REQUEST_TIMEOUT":
      return t("sync.googleDriveRequestTimeout");
    case "GOOGLE_DRIVE_FILE_NOT_FOUND":
      return t("sync.vaultNotFound");
    case "GOOGLE_DRIVE_PAYLOAD_TOO_LARGE":
      return t("sync.googleDriveUploadFailed");
    case "GOOGLE_DRIVE_INVALID_PAYLOAD":
    case "GOOGLE_DRIVE_MANIFEST_CORRUPT":
    case "GOOGLE_DRIVE_JOURNAL_CORRUPT":
    case "GOOGLE_DRIVE_V2_DATA_CORRUPT":
      return t("sync.googleDriveDataCorrupt");
    case "GOOGLE_DRIVE_RESUMABLE_UPLOAD_FAILED":
      return t("sync.googleDriveUploadFailed");
    case "GOOGLE_OAUTH_REVOKE_FAILED":
      return t("sync.googleDriveRevokeFailed");
    case "GOOGLE_DRIVE_CLIENT_ID_REQUIRED":
      return t("sync.googleDriveClientIdRequired");
    case "GOOGLE_OAUTH_ANDROID_CONFIG_INVALID":
      return t("sync.googleDriveAndroidConfigInvalid");
    case "GOOGLE_OAUTH_INVALID_REQUEST":
      return t("sync.googleDriveDesktopConfigInvalid");
    case "GOOGLE_OAUTH_NOT_READY":
      return t("sync.googleDrivePreparing");
    case "GOOGLE_OAUTH_POPUP_CLOSED":
    case "GOOGLE_OAUTH_ACCESS_DENIED":
      return t("sync.googleDrivePopupClosed");
    case "GOOGLE_OAUTH_POPUP_FAILED":
    case "GOOGLE_OAUTH_BROWSER_OPEN_FAILED":
      return t("sync.googleDrivePopupFailed");
    case "GOOGLE_OAUTH_REDIRECT_TIMEOUT":
      return t("sync.googleDriveRedirectTimeout");
    case "GOOGLE_OAUTH_CALLBACK_FAILED":
      return t("sync.googleDriveRedirectFailed");
    case "GOOGLE_OAUTH_DESKTOP_INSTALL_REQUIRED":
      return t("sync.googleDriveDesktopInstallRequired");
    case "GOOGLE_OAUTH_IN_PROGRESS":
      return t("sync.googleDriveAuthInProgress");
    case "GOOGLE_OAUTH_SCRIPT_FAILED":
    case "GOOGLE_OAUTH_UNAVAILABLE":
    case "NETWORK_ERROR":
      return t("sync.googleDriveSdkFailed");
    case "GOOGLE_OAUTH_FAILED":
      return t("sync.googleDriveOAuthFailed");
    case "GOOGLE_PLAY_SERVICES_UNAVAILABLE":
      return t("sync.googleDrivePlayServicesUnavailable");
    case "ENCRYPTED_SYNC_NOT_IMPLEMENTED":
      return t("sync.googleDriveEncryptedPending");
    case "INVALID_PASSPHRASE":
      return t("sync.vaultEncryptionInvalidPassphrase");
    case "VAULT_ENCRYPTION_DISABLED":
      return t("sync.vaultEncryptionDisabled");
    case "VAULT_ENCRYPTION_LOCKED":
      return t("sync.vaultEncryptionSyncLocked");
    case "VAULT_ENCRYPTION_PASSPHRASE_REQUIRED":
      return t("sync.vaultEncryptionPassphraseRequired");
    case "VAULT_ENCRYPTION_PASSPHRASE_TOO_SHORT":
      return t("sync.vaultEncryptionPassphraseTooShort");
    case "VAULT_ENCRYPTION_REMOTE_SYNC_REQUIRED":
      return t("sync.vaultEncryptionRemoteMigrationRequired");
    case "UNAUTHORIZED":
      return t("sync.unauthorized");
    case "VAULT_ACCESS_DENIED":
      return t("sync.selfHostedVaultAccessDenied");
    case "VAULT_READ_ONLY":
      return t("sync.selfHostedVaultReadOnly");
    case "CLOUD_REAUTH_REQUIRED":
    case "REFRESH_TOKEN_REQUIRED":
    case "REFRESH_TOKEN_INVALID":
    case "REFRESH_TOKEN_REVOKED":
    case "REFRESH_TOKEN_EXPIRED":
    case "REFRESH_TOKEN_REUSED":
    case "REFRESH_TOKEN_DEVICE_MISMATCH":
      return t("sync.hostedSessionExpired");
    case "SERVER_UNAVAILABLE":
    case "HTTP_404":
      return t("sync.serverNotFound");
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
    case "CLOUD_CONNECTION_NOT_READY":
      return t("sync.hostedConnectionNotReady");
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
    case "LOCAL_VAULT_NAME_REQUIRED":
      return t("settings.createVaultNameRequired");
    case "VAULT_NOT_FOUND":
      return t("sync.vaultNotFound");
    case "LAST_VAULT_REQUIRED":
      return t("sync.lastRemoteVaultRequired");
    case "NOT_FOUND":
      return t("sync.serverNotFound");
    default:
      return message === "SYNC_FAILED" ? t("sync.failedGeneric") : message;
  }
}

function isSyncBindingAuthError(binding: Pick<SyncVaultBinding, "lastError">) {
  return isConnectionAuthErrorCode(binding.lastError);
}

function isConnectionAuthErrorCode(message: string | null | undefined) {
  return [
    "UNAUTHORIZED",
    "INVALID_CREDENTIALS",
    "CLOUD_REAUTH_REQUIRED",
    "REFRESH_TOKEN_REQUIRED",
    "REFRESH_TOKEN_INVALID",
    "REFRESH_TOKEN_REVOKED",
    "REFRESH_TOKEN_EXPIRED",
    "REFRESH_TOKEN_REUSED",
    "REFRESH_TOKEN_DEVICE_MISMATCH",
    "GOOGLE_DRIVE_AUTH_REQUIRED",
    "GOOGLE_DRIVE_INTERACTION_REQUIRED"
  ].includes(message ?? "");
}

function SyncConnectionIcon({
  provider
}: {
  provider: SyncConnection["provider"] | "googleDrive";
}) {
  if (provider === "hosted") {
    return <HostedGlyph />;
  }

  if (provider === "googleDrive") {
    return <GoogleGlyph />;
  }

  return <SelfHostedGlyph />;
}

export default function SyncSettingsPanel({
  settings,
  online,
  localVaults,
  activeLocalVaultId,
  selectedLocalVaultId,
  syncConnections: allSyncConnections,
  syncBindings: allSyncBindings,
  vaultEncryptionById,
  syncFeedback = null,
  onBack,
  onClose,
  onSelectLocalVault,
  onCreateLocalVault,
  onRenameLocalVault,
  onDeleteLocalVault,
  onCreateConnection,
  onDeleteConnection,
  onRevokeGoogleDriveConnection,
  onUpdateConnection,
  onRefreshHostedConnectionCredentials,
  onRefreshGoogleDriveConnectionCredentials,
  onBindVault,
  onImportRemoteVault,
  onDeleteRemoteVault,
  onClearBinding,
  onRunVaultSync,
  onEnableVaultEncryption,
  onUnlockVaultEncryption,
  onChangeVaultEncryptionPassphrase,
  onDisableVaultEncryption,
  onLockVaultEncryption
}: SyncSettingsPanelProps) {
  const { t, i18n } = useTranslation();
  const { runtime: localeRuntime } = useLocale();
  const sortedVaults = useMemo(
    () => [...localVaults].sort((left, right) => left.createdAt - right.createdAt),
    [localVaults]
  );
  const syncConnections = useMemo(
    () => allSyncConnections.filter((connection) => connection.role !== "locorisCloud"),
    [allSyncConnections]
  );
  const managedConnectionIds = useMemo(
    () => new Set(syncConnections.map((connection) => connection.id)),
    [syncConnections]
  );
  const syncBindings = useMemo(
    () => allSyncBindings.filter((binding) => managedConnectionIds.has(binding.connectionId)),
    [allSyncBindings, managedConnectionIds]
  );
  const getVaultLabel = (vault: Pick<LocalVaultProfile, "id" | "name"> | null | undefined) =>
    getDisplayVaultName(
      vault ?? null,
      i18n.resolvedLanguage ?? i18n.language,
      vault ? sortedVaults.findIndex((entry) => entry.id === vault.id) : undefined
    );
  const bindingsByVaultId = useMemo(
    () => new Map(allSyncBindings.map((binding) => [binding.localVaultId, binding])),
    [allSyncBindings]
  );
  const connectionsById = useMemo(
    () => new Map(allSyncConnections.map((connection) => [connection.id, connection])),
    [allSyncConnections]
  );
  const googleDriveConfigured = googleDriveClientConfigured();
  const googleDriveClientId = getConfiguredGoogleDriveClientId();
  const [panelModal, setPanelModal] = useState<PanelModal>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [internalFeedback, setInternalFeedback] = useState<SyncFeedbackState>(null);
  const [dismissedFeedbackKey, setDismissedFeedbackKey] = useState<string | null>(null);
  const [vaultNameDraft, setVaultNameDraft] = useState("");
  const [vaultNameError, setVaultNameError] = useState<string | null>(null);
  const [vaultKindDraft, setVaultKindDraft] = useState<LocalVaultKind>("regular");
  const [vaultPassphraseDraft, setVaultPassphraseDraft] = useState("");
  const [vaultPassphraseConfirmDraft, setVaultPassphraseConfirmDraft] = useState("");
  const [selfHostedEditingConnectionId, setSelfHostedEditingConnectionId] = useState<string | null>(null);
  const [incomingSelfHostedPackage, setIncomingSelfHostedPackage] = useState("");
  const [hostedMode, setHostedMode] = useState<HostedMode>("login");
  const [hostedUrlDraft, setHostedUrlDraft] = useState("");
  const [hostedNameDraft, setHostedNameDraft] = useState("");
  const [hostedEmailDraft, setHostedEmailDraft] = useState("");
  const [hostedPasswordDraft, setHostedPasswordDraft] = useState("");
  const [hostedDraftError, setHostedDraftError] = useState<string | null>(null);
  const [encryptionPassphraseDraft, setEncryptionPassphraseDraft] = useState("");
  const [encryptionPassphraseConfirmDraft, setEncryptionPassphraseConfirmDraft] = useState("");
  const [encryptionNextPassphraseDraft, setEncryptionNextPassphraseDraft] = useState("");
  const [encryptionNextPassphraseConfirmDraft, setEncryptionNextPassphraseConfirmDraft] = useState("");
  const [pendingBindVaultId, setPendingBindVaultId] = useState<string | null>(null);
  const [bindingSheetVaultId, setBindingSheetVaultId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [linkMetrics, setLinkMetrics] = useState<LinkMetric[]>([]);
  const [connectionAvailability, setConnectionAvailability] = useState<Record<string, ConnectionAvailabilityState>>({});
  const [selfHostedEndpointCandidates, setSelfHostedEndpointCandidates] = useState<Record<string, string>>({});
  const [remoteVaultsByConnectionId, setRemoteVaultsByConnectionId] = useState<
    Record<string, RemoteVaultCatalogEntry[]>
  >({});
  const [remoteVaultErrors, setRemoteVaultErrors] = useState<Record<string, string | null>>({});
  const [remoteVaultLoading, setRemoteVaultLoading] = useState<Record<string, boolean>>({});
  const [expandedRemoteConnectionIds, setExpandedRemoteConnectionIds] = useState<Record<string, boolean>>({});
  const [googleDriveOAuthState, setGoogleDriveOAuthState] = useState<"idle" | "loading" | "ready" | "error">(() =>
    googleDriveConfigured ? (googleDriveOAuthReady() ? "ready" : "idle") : "idle"
  );
  const [googleDriveOAuthError, setGoogleDriveOAuthError] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const vaultListRef = useRef<HTMLDivElement | null>(null);
  const connectionListRef = useRef<HTMLDivElement | null>(null);
  const previousConnectionCountRef = useRef(syncConnections.length);
  const pendingVaultEncryptionContinuationRef = useRef<(() => Promise<void>) | null>(null);
  const vaultRefs = useRef(new Map<string, HTMLElement>());
  const connectionRefs = useRef(new Map<string, HTMLElement>());
  const selfHostedDiscoveryAttemptsRef = useRef(new Set<string>());
  const feedbackAnchor = useActionFeedbackAnchor([
    ".sync-settings-panel-shell",
    ".sync-settings-premium-dialog"
  ]);

  const feedback = internalFeedback ?? syncFeedback;
  const feedbackKey = feedback ? `${feedback.tone}:${feedback.text}` : null;
  const visibleFeedback = feedbackKey !== dismissedFeedbackKey ? feedback : null;

  useAutoDismissNotice(internalFeedback, setInternalFeedback, {
    enabled: !pendingBindVaultId && !bindingSheetVaultId,
    successMs: 5200
  });

  useEffect(() => {
    if (!feedbackKey) {
      setDismissedFeedbackKey(null);
    }
  }, [feedbackKey]);

  const dismissFeedback = () => {
    setDismissedFeedbackKey(feedbackKey);
    if (internalFeedback) {
      setInternalFeedback(null);
    }
  };
  const availabilitySignature = useMemo(
    () =>
      syncConnections
        .map(
          (connection) =>
            `${connection.id}:${connection.updatedAt}:${connection.serverUrl}:${connection.tokenExpiresAt ?? "none"}`
        )
        .join("|"),
    [syncConnections]
  );
  const authErrorConnectionIds = useMemo(() => {
    const connectionIds = new Set<string>();

    syncBindings.forEach((binding) => {
      if (isSyncBindingAuthError(binding)) {
        connectionIds.add(binding.connectionId);
      }
    });

    return connectionIds;
  }, [syncBindings]);
  const authErrorConnectionSignature = useMemo(
    () => [...authErrorConnectionIds].sort().join("|"),
    [authErrorConnectionIds]
  );
  const localVaultByGuid = useMemo(
    () => new Map(sortedVaults.map((vault) => [vault.vaultGuid, vault])),
    [sortedVaults]
  );
  const localVaultNameSet = useMemo(
    () => new Set(sortedVaults.map((vault) => vault.name.trim().toLowerCase())),
    [sortedVaults]
  );
  const selfHostedEditingConnection = selfHostedEditingConnectionId
    ? connectionsById.get(selfHostedEditingConnectionId) ?? null
    : null;

  const normalizeRemoteVaultEntries = useCallback(
    (
      entries: Array<{
        id: string;
        name: string;
        vaultKind?: LocalVaultKind;
        createdAt: number;
        updatedAt: number;
        lastRevision: string | null;
        lastSyncAt: number | null;
        tokenCount?: number;
      }>
    ) =>
      [...entries]
        .map(
          (entry) =>
            ({
              id: entry.id,
              name: entry.name,
              vaultKind: entry.vaultKind ?? "regular",
              createdAt: entry.createdAt,
              updatedAt: entry.updatedAt,
              lastRevision: entry.lastRevision ?? null,
              lastSyncAt: entry.lastSyncAt ?? null,
              tokenCount: entry.tokenCount
            }) satisfies RemoteVaultCatalogEntry
        )
        .sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name)),
    []
  );

  const loadRemoteVaultCatalog = useCallback(
    async (
      connection: SyncConnection,
      options?: {
        silent?: boolean;
      }
    ) => {
      if (!options?.silent) {
        setRemoteVaultLoading((current) => ({
          ...current,
          [connection.id]: true
        }));
      }

      setRemoteVaultErrors((current) => ({
        ...current,
        [connection.id]: null
      }));

      try {
        let targetConnection = connection;
        const fetchRemoteVaults = async (candidate: SyncConnection) =>
          candidate.provider === "hosted"
            ? normalizeRemoteVaultEntries(
                (await loadHostedAccountOverview(candidate.serverUrl, candidate.sessionToken)).vaults
              )
            : candidate.provider === "googleDrive"
              ? normalizeRemoteVaultEntries((await loadGoogleDriveVaults(candidate.sessionToken)).vaults)
              : normalizeRemoteVaultEntries(
                  (await loadPersonalServerVaults(candidate.serverUrl, candidate.managementToken)).vaults
                );

        if (
          targetConnection.provider === "googleDrive" &&
          targetConnection.tokenExpiresAt &&
          targetConnection.tokenExpiresAt <= Date.now() + GOOGLE_DRIVE_TOKEN_REFRESH_SKEW_MS
        ) {
          try {
            targetConnection = await reauthorizeGoogleDriveConnection(targetConnection, {
              silent: true
            });
          } catch {
            // The explicit auth flow remains available from the refresh action and inline error state.
          }
        }

        let remoteVaults: RemoteVaultCatalogEntry[];

        try {
          remoteVaults = await fetchRemoteVaults(targetConnection);
        } catch (error) {
          const message = getErrorMessage(error);

          if (
            targetConnection.provider === "googleDrive" &&
            ["GOOGLE_DRIVE_AUTH_REQUIRED", "GOOGLE_DRIVE_INTERACTION_REQUIRED"].includes(message)
          ) {
            targetConnection = await reauthorizeGoogleDriveConnection(targetConnection, {
              silent: true
            });
            remoteVaults = await fetchRemoteVaults(targetConnection);
          } else {
            throw error;
          }
        }

        setRemoteVaultsByConnectionId((current) => ({
          ...current,
          [connection.id]: remoteVaults
        }));

        setConnectionAvailability((current) => ({
          ...current,
          [connection.id]: authErrorConnectionIds.has(connection.id) ? "authError" : "available"
        }));

        return remoteVaults;
      } catch (error) {
        const message = getErrorMessage(error);

        setRemoteVaultErrors((current) => ({
          ...current,
          [connection.id]: translateSyncManagerError(message, t)
        }));

        setConnectionAvailability((current) => ({
          ...current,
          [connection.id]:
            isConnectionAuthErrorCode(message)
              ? "authError"
              : message === "SERVER_UNAVAILABLE" || message === "HTTP_404"
                ? "unavailable"
                : current[connection.id] ?? "checking"
        }));

        throw error;
      } finally {
        setRemoteVaultLoading((current) => ({
          ...current,
          [connection.id]: false
        }));
      }
    },
    [authErrorConnectionIds, normalizeRemoteVaultEntries, t]
  );

  const registerVaultRef = (vaultId: string, node: HTMLElement | null) => {
    if (node) {
      vaultRefs.current.set(vaultId, node);
      return;
    }

    vaultRefs.current.delete(vaultId);
  };

  const registerConnectionRef = (connectionId: string, node: HTMLElement | null) => {
    if (node) {
      connectionRefs.current.set(connectionId, node);
      return;
    }

    connectionRefs.current.delete(connectionId);
  };

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const vaultList = vaultListRef.current;
    const connectionList = connectionListRef.current;

    if (!stage) {
      return;
    }

    let frameId: number | null = null;

    const compute = () => {
      frameId = null;
      const stageRect = stage.getBoundingClientRect();
      const nextMetrics = syncBindings
        .map((binding) => {
          const vaultNode = vaultRefs.current.get(binding.localVaultId);
          const connectionNode = connectionRefs.current.get(binding.connectionId);
          const connection = connectionsById.get(binding.connectionId);

          if (!vaultNode || !connectionNode || !connection) {
            return null;
          }

          const vaultRect = vaultNode.getBoundingClientRect();
          const connectionRect = connectionNode.getBoundingClientRect();
          const x1 = vaultRect.right - stageRect.left - 6;
          const y1 = vaultRect.top - stageRect.top + vaultRect.height / 2;
          const x2 = connectionRect.left - stageRect.left + 6;
          const y2 = connectionRect.top - stageRect.top + connectionRect.height / 2;

          return {
            id: binding.id,
            path: buildLinkPath(x1, y1, x2, y2),
            color: providerAccent(connection.provider),
            statusTone:
              binding.syncStatus === "error"
                ? "error"
                : binding.syncStatus === "syncing"
                  ? "syncing"
                  : "idle"
          } satisfies LinkMetric;
        })
        .filter(Boolean) as LinkMetric[];

      setLinkMetrics(nextMetrics);
    };

    const schedule = () => {
      if (frameId !== null) {
        return;
      }

      frameId = window.requestAnimationFrame(compute);
    };

    schedule();

    const observer = new ResizeObserver(schedule);
    observer.observe(stage);
    if (vaultList) {
      observer.observe(vaultList);
      vaultList.addEventListener("scroll", schedule, {
        passive: true
      });
    }
    if (connectionList) {
      observer.observe(connectionList);
      connectionList.addEventListener("scroll", schedule, {
        passive: true
      });
    }
    vaultRefs.current.forEach((node) => observer.observe(node));
    connectionRefs.current.forEach((node) => observer.observe(node));
    window.addEventListener("resize", schedule);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      observer.disconnect();
      if (vaultList) {
        vaultList.removeEventListener("scroll", schedule);
      }
      if (connectionList) {
        connectionList.removeEventListener("scroll", schedule);
      }
      window.removeEventListener("resize", schedule);
    };
  }, [connectionsById, syncBindings, syncConnections, sortedVaults]);

  useEffect(() => {
    if (!googleDriveConfigured) {
      setGoogleDriveOAuthState("idle");
      setGoogleDriveOAuthError(null);
      return;
    }

    if (googleDriveOAuthReady()) {
      setGoogleDriveOAuthState("ready");
      setGoogleDriveOAuthError(null);
      return;
    }

    let cancelled = false;

    setGoogleDriveOAuthState("loading");
    setGoogleDriveOAuthError(null);

    void prepareGoogleDriveOAuth()
      .then(() => {
        if (cancelled) {
          return;
        }

        setGoogleDriveOAuthState("ready");
        setGoogleDriveOAuthError(null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        const message = getErrorMessage(error, "GOOGLE_OAUTH_SCRIPT_FAILED");
        setGoogleDriveOAuthState("error");
        setGoogleDriveOAuthError(translateSyncManagerError(message, t));
      });

    return () => {
      cancelled = true;
    };
  }, [googleDriveConfigured, t]);

  useEffect(() => {
    setExpandedRemoteConnectionIds((current) => {
      const next: Record<string, boolean> = {};
      let changed = false;

      syncConnections.forEach((connection) => {
        next[connection.id] = current[connection.id] ?? false;
        if (next[connection.id] !== current[connection.id]) {
          changed = true;
        }
      });

      if (Object.keys(current).length !== Object.keys(next).length) {
        changed = true;
      }

      return changed ? next : current;
    });
  }, [syncConnections]);

  useEffect(() => {
    if (syncConnections.length === 0) {
      setConnectionAvailability({});
      return;
    }

    if (!online) {
      return;
    }

    let cancelled = false;

    setConnectionAvailability(
      Object.fromEntries(
        syncConnections.map((connection) => [
          connection.id,
          authErrorConnectionIds.has(connection.id)
            ? "authError"
            : ("checking" satisfies ConnectionAvailabilityState)
        ])
      )
    );

    void Promise.all(
      syncConnections.map(async (connection) => {
        if (authErrorConnectionIds.has(connection.id)) {
          return;
        }

        const status = await probeSyncConnectionAvailability(connection);

        if (cancelled) {
          return;
        }

        setConnectionAvailability((current) => {
          if (current[connection.id] === status) {
            return current;
          }

          return {
            ...current,
            [connection.id]: status
          };
        });
      })
    );

    return () => {
      cancelled = true;
    };
  }, [authErrorConnectionIds, authErrorConnectionSignature, availabilitySignature, online, syncConnections]);

  useEffect(() => {
    if (!online || !selfHostedDiscoveryAvailable()) {
      return;
    }

    const unavailableConnections = syncConnections.filter(
      (connection) =>
        connection.provider === "selfHosted" &&
        Boolean(connection.selfHostedServerId) &&
        connectionAvailability[connection.id] === "unavailable"
    );
    const pendingConnections = unavailableConnections.filter((connection) => {
      const key = `${connection.id}:${connection.serverUrl}:${connection.updatedAt}`;
      if (selfHostedDiscoveryAttemptsRef.current.has(key)) return false;
      selfHostedDiscoveryAttemptsRef.current.add(key);
      return true;
    });

    if (pendingConnections.length === 0) {
      return;
    }

    let cancelled = false;
    void discoverSelfHostedServers(2_800)
      .then((discovered) => {
        if (cancelled) return;
        setSelfHostedEndpointCandidates((current) => {
          const next = { ...current };
          pendingConnections.forEach((connection) => {
            const candidate = discovered.find(
              (entry) =>
                entry.serverId === connection.selfHostedServerId &&
                entry.url.replace(/\/+$/, "") !== connection.serverUrl.replace(/\/+$/, "")
            );
            if (candidate) {
              next[connection.id] = candidate.url;
            }
          });
          return next;
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [connectionAvailability, online, syncConnections]);

  useEffect(() => {
    setSelfHostedEndpointCandidates((current) => {
      const next = { ...current };
      let changed = false;
      syncConnections.forEach((connection) => {
        if (connectionAvailability[connection.id] === "available" && next[connection.id]) {
          delete next[connection.id];
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [connectionAvailability, syncConnections]);

  useEffect(() => {
    if (syncConnections.length === 0) {
      setRemoteVaultsByConnectionId({});
      setRemoteVaultErrors({});
      setRemoteVaultLoading({});
      return;
    }

    if (!online) {
      return;
    }

    let cancelled = false;

    void Promise.all(
      syncConnections.map(async (connection) => {
        try {
          const remoteVaults = await loadRemoteVaultCatalog(connection, {
            silent: true
          });

          if (cancelled) {
            return;
          }

          setRemoteVaultsByConnectionId((current) => ({
            ...current,
            [connection.id]: remoteVaults
          }));
        } catch {
          if (cancelled) {
            return;
          }
        }
      })
    );

    return () => {
      cancelled = true;
    };
  }, [availabilitySignature, loadRemoteVaultCatalog, online, syncConnections]);

  const boundVaultCountByConnectionId = useMemo(() => {
    const counts = new Map<string, number>();

    syncBindings.forEach((binding) => {
      counts.set(binding.connectionId, (counts.get(binding.connectionId) ?? 0) + 1);
    });

    return counts;
  }, [syncBindings]);

  const showFeedback = (tone: "success" | "error", text: string) => {
    setDismissedFeedbackKey(null);
    setInternalFeedback({
      tone,
      text
    });
  };

  const pendingBindVault = pendingBindVaultId
    ? sortedVaults.find((vault) => vault.id === pendingBindVaultId) ?? null
    : null;
  const bindingSheetVault = bindingSheetVaultId
    ? sortedVaults.find((vault) => vault.id === bindingSheetVaultId) ?? null
    : null;

  useEffect(() => {
    const previousCount = previousConnectionCountRef.current;

    if (pendingBindVaultId && previousCount === 0 && syncConnections.length > 0) {
      setBindingSheetVaultId(pendingBindVaultId);
      showFeedback("success", t("settings.bindingConnectionAddedContinue"));
    }

    previousConnectionCountRef.current = syncConnections.length;
  }, [pendingBindVaultId, syncConnections.length, t]);

  const closeModal = () => {
    setPanelModal(null);
    setConfirmState(null);
    resetConnectionDrafts();
    pendingVaultEncryptionContinuationRef.current = null;
    setVaultNameDraft("");
    setVaultNameError(null);
    setVaultKindDraft("regular");
    setVaultPassphraseDraft("");
    setVaultPassphraseConfirmDraft("");
    setEncryptionPassphraseDraft("");
    setEncryptionPassphraseConfirmDraft("");
    setEncryptionNextPassphraseDraft("");
    setEncryptionNextPassphraseConfirmDraft("");
  };

  const resetConnectionDrafts = () => {
    setSelfHostedEditingConnectionId(null);
    setHostedMode("login");
    setHostedUrlDraft("");
    setHostedNameDraft("");
    setHostedEmailDraft("");
    setHostedPasswordDraft("");
    setHostedDraftError(null);
    setEncryptionPassphraseDraft("");
    setEncryptionPassphraseConfirmDraft("");
    setEncryptionNextPassphraseDraft("");
    setEncryptionNextPassphraseConfirmDraft("");
  };

  const openSelfHostedConnectionModal = (connection?: SyncConnection | null) => {
    setSelfHostedEditingConnectionId(connection?.id ?? null);
    setIncomingSelfHostedPackage("");
    setPanelModal({ kind: "addSelfHosted" });
  };

  const openSelfHostedEndpointModal = (connection: SyncConnection, initialServerUrl?: string) => {
    setPanelModal({ kind: "editSelfHostedEndpoint", connection, initialServerUrl });
  };

  useEffect(() => {
    const openIncomingInvite = () => {
      const connectionPackage = consumeIncomingSelfHostedConnectionPackage();
      if (!connectionPackage) return;
      setSelfHostedEditingConnectionId(null);
      setIncomingSelfHostedPackage(connectionPackage);
      setPanelModal({ kind: "addSelfHosted" });
    };
    openIncomingInvite();
    window.addEventListener(SELF_HOSTED_INVITE_EVENT, openIncomingInvite);
    return () => window.removeEventListener(SELF_HOSTED_INVITE_EVENT, openIncomingInvite);
  }, []);

  useEffect(() => {
    const openIncomingEndpointUpdate = () => {
      const update = consumeSelfHostedEndpointUpdate();
      if (!update) return;
      const connection = syncConnections.find(
        (entry) =>
          entry.provider === "selfHosted" && entry.selfHostedServerId === update.serverId
      );
      if (!connection) {
        showFeedback("error", t("settings.selfHostedEndpointConnectionNotFound"));
        return;
      }
      openSelfHostedEndpointModal(connection, update.serverUrl);
    };

    openIncomingEndpointUpdate();
    window.addEventListener(SELF_HOSTED_ENDPOINT_UPDATE_EVENT, openIncomingEndpointUpdate);
    return () =>
      window.removeEventListener(SELF_HOSTED_ENDPOINT_UPDATE_EVENT, openIncomingEndpointUpdate);
  }, [syncConnections, t]);

  const handleSelfHostedEndpointUpdated = async (
    connection: SyncConnection,
    result: {
      serverUrl: string;
      serverId: string;
      remoteVaults: SyncRemoteVault[];
    }
  ) => {
    await Promise.resolve(
      onUpdateConnection(connection.id, {
        serverUrl: result.serverUrl,
        selfHostedServerId: result.serverId
      })
    );
    setRemoteVaultsByConnectionId((current) => ({
      ...current,
      [connection.id]: normalizeRemoteVaultEntries(result.remoteVaults)
    }));
    setRemoteVaultErrors((current) => ({ ...current, [connection.id]: null }));
    setConnectionAvailability((current) => ({ ...current, [connection.id]: "available" }));
    setSelfHostedEndpointCandidates((current) => {
      const next = { ...current };
      delete next[connection.id];
      return next;
    });
    closeModal();
    showFeedback("success", t("settings.selfHostedEndpointUpdated"));

    const localVaultIds = syncBindings
      .filter((binding) => binding.connectionId === connection.id)
      .map((binding) => binding.localVaultId);
    const updatedConnection: SyncConnection = {
      ...connection,
      serverUrl: result.serverUrl,
      selfHostedServerId: result.serverId,
      updatedAt: Date.now()
    };
    void (async () => {
      for (const localVaultId of localVaultIds) {
        await Promise.resolve(onRunVaultSync(localVaultId, updatedConnection));
      }
    })();
  };

  const openHostedConnectionModal = (connection?: SyncConnection | null) => {
    setHostedMode("login");
    setHostedUrlDraft(connection?.serverUrl ?? "");
    setHostedNameDraft("");
    setHostedEmailDraft(connection?.userEmail ?? "");
    setHostedPasswordDraft("");
    setHostedDraftError(null);
    setPanelModal({ kind: "hostedWizard", connection: connection ?? null });
  };

  const handleCreateVault = async () => {
    const normalizedName = vaultNameDraft.trim();

    if (!normalizedName) {
      setVaultNameError(t("settings.createVaultNameRequired"));
      return;
    }

    setVaultNameError(null);

    if (vaultKindDraft === "private") {
      if (!vaultPassphraseDraft.trim()) {
        showFeedback("error", t("sync.vaultEncryptionPassphraseRequired"));
        return;
      }

      if (vaultPassphraseDraft.trim().length < 8) {
        showFeedback("error", t("sync.vaultEncryptionPassphraseTooShort"));
        return;
      }

      if (vaultPassphraseDraft.trim() !== vaultPassphraseConfirmDraft.trim()) {
        showFeedback("error", t("sync.vaultEncryptionPassphraseMismatch"));
        return;
      }
    }

    try {
      const nextVaultId = await Promise.resolve(
        onCreateLocalVault({
          name: normalizedName,
          vaultKind: vaultKindDraft,
          passphrase: vaultKindDraft === "private" ? vaultPassphraseDraft.trim() : undefined
        })
      );
      if (nextVaultId) {
        onSelectLocalVault(nextVaultId);
      }
      closeModal();
    } catch (error) {
      const message = getErrorMessage(error);
      showFeedback("error", translateSyncManagerError(message, t));
    }
  };

  const handleRenameVault = () => {
    if (!panelModal || panelModal.kind !== "renameVault") {
      return;
    }

    const normalizedName = vaultNameDraft.trim();

    if (!normalizedName) {
      setVaultNameError(t("settings.renameVaultNameRequired"));
      return;
    }

    setVaultNameError(null);
    onRenameLocalVault(panelModal.vault.id, normalizedName);
    setVaultNameDraft("");
    closeModal();
  };

  const handleSelfHostedConnected = async (result: {
    serverUrl: string;
    deviceCredential: string;
    label: string;
    deviceId: string | null;
    role: "owner" | "guest" | null;
    serverId: string | null;
    remoteVaults: SyncRemoteVault[];
  }) => {
    if (selfHostedEditingConnection) {
      await Promise.resolve(
        onUpdateConnection(selfHostedEditingConnection.id, {
          serverUrl: result.serverUrl,
          managementToken: result.deviceCredential,
          label: result.label || selfHostedEditingConnection.label,
          selfHostedDeviceId: result.deviceId,
          selfHostedRole: result.role,
          selfHostedServerId: result.serverId
        })
      );
      setRemoteVaultsByConnectionId((current) => ({
        ...current,
        [selfHostedEditingConnection.id]: normalizeRemoteVaultEntries(result.remoteVaults)
      }));
      setRemoteVaultErrors((current) => ({ ...current, [selfHostedEditingConnection.id]: null }));
      setConnectionAvailability((current) => ({ ...current, [selfHostedEditingConnection.id]: "available" }));
      showFeedback("success", t("settings.connectionUpdated"));
    } else {
      await Promise.resolve(
        onCreateConnection({
          provider: "selfHosted",
          serverUrl: result.serverUrl,
          label: result.label || undefined,
          managementToken: result.deviceCredential,
          selfHostedDeviceId: result.deviceId,
          selfHostedRole: result.role,
          selfHostedServerId: result.serverId
        })
      );
      showFeedback("success", t("settings.connectionAdded"));
    }
    closeModal();
  };

  const handleAddHostedConnection = async () => {
    const hostedEditingConnection =
      panelModal?.kind === "addHosted" ? panelModal.connection ?? null : null;

    if (!hostedUrlDraft.trim()) {
      setHostedDraftError(t("sync.hostedUrlRequired"));
      return;
    }

    if (!hostedEmailDraft.trim() || !hostedPasswordDraft.trim()) {
      setHostedDraftError(t("sync.hostedCredentialsRequired"));
      return;
    }

    setHostedDraftError(null);
    setBusyKey("add-hosted");

    try {
      const result =
        hostedMode === "register" && !hostedEditingConnection
          ? await registerHostedAccount(hostedUrlDraft.trim(), {
              name: hostedNameDraft.trim() || hostedEmailDraft.trim(),
              email: hostedEmailDraft.trim(),
              password: hostedPasswordDraft,
              ...getHostedDeviceIdentity(settings.localDeviceId)
            })
          : await loginHostedAccount(hostedUrlDraft.trim(), {
              email: hostedEmailDraft.trim(),
              password: hostedPasswordDraft,
              ...getHostedDeviceIdentity(settings.localDeviceId)
            });

      if (hostedEditingConnection) {
        const refreshedConnection = {
          ...hostedEditingConnection,
          serverUrl: hostedUrlDraft.trim(),
          sessionToken: result.session.token,
          refreshToken: result.session.refreshToken ?? "",
          tokenExpiresAt: result.session.expiresAt,
          userId: result.user.id,
          userName: result.user.name,
          userEmail: result.user.email ?? "",
          updatedAt: Date.now()
        } satisfies SyncConnection;

        await Promise.resolve(
          onUpdateConnection(hostedEditingConnection.id, {
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
      } else {
        await Promise.resolve(
          onCreateConnection({
            provider: "hosted",
            serverUrl: hostedUrlDraft.trim(),
            sessionToken: result.session.token,
            refreshToken: result.session.refreshToken ?? null,
            tokenExpiresAt: result.session.expiresAt,
            userId: result.user.id,
            userName: result.user.name,
            userEmail: result.user.email ?? ""
          })
        );
      }

      resetConnectionDrafts();
      showFeedback(
        "success",
        hostedEditingConnection
          ? t("settings.hostedReconnectSuccess")
          : hostedMode === "register"
            ? t("sync.hostedAccountCreated")
            : t("sync.hostedLoggedIn")
      );
      closeModal();
    } catch (error) {
      const message = getErrorMessage(error);
      const translatedMessage = translateSyncManagerError(message, t);
      setHostedDraftError(translatedMessage);
      showFeedback("error", translatedMessage);
    } finally {
      setBusyKey(null);
    }
  };

  const loadHostedOverviewForWizard = async (connection: SyncConnection): Promise<HostedAccountOverview> => {
    const overview = await loadHostedAccountOverview(connection.serverUrl, connection.sessionToken);

    setRemoteVaultsByConnectionId((current) => ({
      ...current,
      [connection.id]: normalizeRemoteVaultEntries(overview.vaults)
    }));
    setRemoteVaultErrors((current) => ({
      ...current,
      [connection.id]: null
    }));
    setConnectionAvailability((current) => ({
      ...current,
      [connection.id]: "available"
    }));

    return overview;
  };

  const upsertHostedWizardConnection = async (
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
    const hostedConnection = connection ?? syncConnections.find((entry) => entry.provider === "hosted") ?? null;

    if (hostedConnection) {
      const refreshedConnection = {
        ...hostedConnection,
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
        onUpdateConnection(hostedConnection.id, {
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
        overview: await loadHostedOverviewForWizard(refreshedConnection)
      };
    }

    const createdConnection = await Promise.resolve(
      onCreateConnection({
        provider: "hosted",
        serverUrl: normalizedUrl,
        sessionToken: result.session.token,
        refreshToken: result.session.refreshToken ?? null,
        tokenExpiresAt: result.session.expiresAt ?? null,
        userId: result.user.id,
        userName: result.user.name,
        userEmail: result.user.email ?? ""
      })
    );

    if (!createdConnection) {
      throw new Error("CLOUD_CONNECTION_NOT_READY");
    }

    return {
      connection: createdConnection,
      overview: await loadHostedOverviewForWizard(createdConnection)
    };
  };

  const handleCloudWizardAuthenticate = async (input: {
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

    return upsertHostedWizardConnection(input.serverUrl, result, input.connection);
  };

  const handleCloudWizardStartDeviceLogin = async (serverUrl: string) =>
    startHostedDeviceLogin(serverUrl, getHostedDeviceIdentity(settings.localDeviceId));

  const handleCloudWizardPollDeviceLogin = async (
    serverUrl: string,
    deviceCode: string,
    connection?: SyncConnection | null
  ) => {
    const result = await pollHostedDeviceLogin(serverUrl, deviceCode);

    return upsertHostedWizardConnection(serverUrl, result, connection);
  };

  const handleCloudWizardUploadVault = async (connection: SyncConnection, vault: LocalVaultProfile) => {
    const encryption = resolveVaultEncryptionSummary(vault);

    if (vault.vaultKind === "private" && encryption.enabled && encryption.state === "locked") {
      throw new Error("VAULT_ENCRYPTION_LOCKED");
    }

    await performVaultBinding(vault, connection, {
      refreshCatalog: true
    });
    await Promise.resolve(onRunVaultSync(vault.id));
    await loadHostedOverviewForWizard(connection);
    showFeedback("success", t("settings.cloudWizardUploadSuccess", { vault: getVaultLabel(vault) }));
  };

  const handleCloudWizardCreateVault = async (connection: SyncConnection, name: string) => {
    const created = await createHostedVault(connection.serverUrl, connection.sessionToken, {
      name
    });

    setRemoteVaultsByConnectionId((current) => ({
      ...current,
      [connection.id]: normalizeRemoteVaultEntries([created.vault, ...(current[connection.id] ?? [])])
    }));

    await requestRemoteVaultImport(connection, created.vault, {
      openAfterImport: true
    });
    await loadHostedOverviewForWizard(connection);
  };

  const handleCloudWizardConnectRemoteVault = async (
    connection: SyncConnection,
    remoteVault: SyncRemoteVault
  ) => {
    await requestRemoteVaultImport(connection, remoteVault, {
      openAfterImport: true
    });
    await loadHostedOverviewForWizard(connection);
  };

  const handleAddGoogleDriveConnection = async () => {
    if (!googleDriveConfigured) {
      showFeedback("error", t("sync.googleDriveClientIdRequired"));
      return;
    }

    if (googleDriveOAuthState === "loading" || googleDriveOAuthState === "idle") {
      showFeedback("error", t("sync.googleDrivePreparing"));
      return;
    }

    if (googleDriveOAuthState === "error") {
      showFeedback("error", googleDriveOAuthError ?? t("sync.googleDriveSdkFailed"));
      return;
    }

    setBusyKey("add-google-drive");

    try {
      const result = await connectGoogleDriveAccount({
        clientId: googleDriveClientId
      });

      await Promise.resolve(
        onCreateConnection({
        provider: "googleDrive",
        serverUrl: "https://www.googleapis.com",
        sessionToken: result.accessToken,
        refreshToken: result.refreshToken ?? null,
        tokenExpiresAt: result.expiresAt,
        userId: result.userId,
        userName: result.userName,
        userEmail: result.userEmail,
        label: result.userEmail || result.userName || t("sync.googleDrive")
        })
      );

      resetConnectionDrafts();
      showFeedback("success", t("sync.googleDriveConnected"));
      closeModal();
    } catch (error) {
      const message = getErrorMessage(error);
      showFeedback("error", translateSyncManagerError(message, t));
    } finally {
      setBusyKey(null);
    }
  };

  async function reauthorizeGoogleDriveConnection(
    connection: SyncConnection,
    options?: {
      silent?: boolean;
    }
  ) {
    if (connection.provider !== "googleDrive") {
      return connection;
    }

    const result = options?.silent
      ? await refreshGoogleDriveAccountSession({
          connectionId: connection.id,
          clientId: googleDriveClientId,
          loginHint: connection.userEmail || undefined
        })
      : await connectGoogleDriveAccount({
          clientId: googleDriveClientId,
          loginHint: connection.userEmail || undefined
        });

    await Promise.resolve(
      onUpdateConnection(connection.id, {
      sessionToken: result.accessToken,
      refreshToken: result.refreshToken ?? undefined,
      tokenExpiresAt: result.expiresAt,
      userId: result.userId,
      userName: result.userName,
      userEmail: result.userEmail,
      label: result.userEmail || result.userName || connection.label
      })
    );

    const refreshedConnection = {
      ...connection,
      sessionToken: result.accessToken,
      tokenExpiresAt: result.expiresAt,
      userId: result.userId,
      userName: result.userName,
      userEmail: result.userEmail,
      label: result.userEmail || result.userName || connection.label,
      updatedAt: Date.now()
    } satisfies SyncConnection;

    if (!options?.silent) {
      await Promise.resolve(onRefreshGoogleDriveConnectionCredentials(refreshedConnection));
    }

    return refreshedConnection;
  }

  const performVaultBinding = async (
    vault: LocalVaultProfile,
    connection: SyncConnection,
    options?: {
      refreshCatalog?: boolean;
    }
  ) => {
    const canonicalRemoteVaultId = vault.vaultGuid;
    const existingRemoteVaults =
      remoteVaultsByConnectionId[connection.id] ??
      (await loadRemoteVaultCatalog(connection, {
        silent: true
      }));

    let remoteVault =
      existingRemoteVaults.find((entry) => entry.id === canonicalRemoteVaultId) ?? null;

    if (!remoteVault) {
      remoteVault =
        connection.provider === "selfHosted"
          ? (
              await createPersonalServerVault(connection.serverUrl, connection.managementToken, {
                name: getVaultLabel(vault),
                id: canonicalRemoteVaultId || undefined
              })
            ).vault
          : connection.provider === "googleDrive"
            ? (
                await createGoogleDriveVault(connection.sessionToken, {
                  name: getVaultLabel(vault),
                  id: canonicalRemoteVaultId || undefined
                })
              ).vault
          : (
              await createHostedVault(connection.serverUrl, connection.sessionToken, {
                name: getVaultLabel(vault),
                id: canonicalRemoteVaultId || undefined
              })
            ).vault;
    }

    const token =
      connection.provider === "selfHosted"
        ? await issuePersonalServerVaultToken(
            connection.serverUrl,
            connection.managementToken,
            remoteVault.id,
            `${getVaultLabel(vault)} · ${connection.label}`
          )
        : connection.provider === "googleDrive"
          ? await issueGoogleDriveVaultToken(remoteVault.id)
        : await registerHostedVaultDevice(
            connection.serverUrl,
            connection.sessionToken,
            remoteVault.id,
            getHostedDeviceIdentity(settings.localDeviceId)
          );

    await onBindVault({
      localVaultId: vault.id,
      connectionId: connection.id,
      remoteVaultId: remoteVault.id,
      remoteVaultName: remoteVault.name,
      syncToken: token.token
    });

    if (options?.refreshCatalog ?? true) {
      await loadRemoteVaultCatalog(connection, {
        silent: true
      });
    }
  };

  const requestRemoteVaultImport = async (
    connection: SyncConnection,
    remoteVault: RemoteVaultCatalogEntry,
    options?: {
      openAfterImport?: boolean;
    }
  ) => {
    const localVault = localVaultByGuid.get(remoteVault.id) ?? null;
    const existingBinding = localVault ? bindingsByVaultId.get(localVault.id) ?? null : null;
    const existingConnection = existingBinding
      ? connectionsById.get(existingBinding.connectionId) ?? null
      : null;

    if (localVault && existingConnection?.role === "locorisCloud") {
      showFeedback(
        "error",
        `${t("settings.accountCloudVaultConnected", { vault: getVaultLabel(localVault) })} ${t("settings.syncConnectionsDescription")}`
      );
      return;
    }

    const runImport = async () => {
      setBusyKey(`import:${connection.id}:${remoteVault.id}`);

      try {
        const result = await onImportRemoteVault({
          connectionId: connection.id,
          remoteVaultId: remoteVault.id,
          remoteVaultName: remoteVault.name,
          remoteVaultKind: remoteVault.vaultKind,
          openAfterImport: options?.openAfterImport
        });

        onSelectLocalVault(result.localVaultId);
        await loadRemoteVaultCatalog(connection, {
          silent: true
        });

        if (result.disposition === "pendingUnlock") {
          setInternalFeedback(null);
          openVaultEncryptionModal(
            sortedVaults.find((vault) => vault.id === result.localVaultId) ??
              buildVaultProfileFallback(
                result.localVaultId,
                remoteVault.id,
                result.localVaultName,
                remoteVault.vaultKind
              ),
            {
              view: "unlock",
              continuation: "import",
              continuationAction: async () => {
                await onRunVaultSync(result.localVaultId);
                await loadRemoteVaultCatalog(connection, {
                  silent: true
                });
                onSelectLocalVault(result.localVaultId);
              }
            }
          );
          return;
        }

        showFeedback(
          "success",
          result.disposition === "imported"
            ? result.nameAdjusted
              ? t("settings.remoteImportAdjusted", {
                  vault: result.localVaultName
                })
              : t("settings.remoteImportCreated", {
                  vault: result.localVaultName
                })
            : t("settings.remoteImportLinked", {
                vault: result.localVaultName
              })
        );
      } catch (error) {
        const message = getErrorMessage(error);
        showFeedback("error", translateSyncManagerError(message, t));
      } finally {
        setBusyKey(null);
      }
    };

    if (existingBinding && existingBinding.connectionId !== connection.id) {
      setConfirmState({
        title: t("settings.remoteReconnectTitle"),
        description: t("settings.remoteReconnectDescription", {
          vault: localVault?.name ?? remoteVault.name,
          connection: connection.label
        }),
        confirmLabel: t("settings.remoteReconnectConfirm"),
        tone: "danger",
        action: async () => {
          closeModal();
          await runImport();
        }
      });
      return;
    }

    await runImport();
  };

  const requestImportAllRemoteVaults = async (connection: SyncConnection) => {
    let remoteVaults: RemoteVaultCatalogEntry[];

    try {
      remoteVaults =
        remoteVaultsByConnectionId[connection.id] ??
        (await loadRemoteVaultCatalog(connection, {
          silent: false
        }));
    } catch (error) {
      const message = getErrorMessage(error);
      showFeedback("error", translateSyncManagerError(message, t));
      return;
    }

    const cloudManagedCount = remoteVaults.filter((remoteVault) => {
      const localVault = localVaultByGuid.get(remoteVault.id) ?? null;
      const binding = localVault ? bindingsByVaultId.get(localVault.id) ?? null : null;
      const bindingConnection = binding ? connectionsById.get(binding.connectionId) ?? null : null;
      return bindingConnection?.role === "locorisCloud";
    }).length;
    const candidates = remoteVaults.filter((remoteVault) => {
      const localVault = localVaultByGuid.get(remoteVault.id) ?? null;
      const binding = localVault ? bindingsByVaultId.get(localVault.id) ?? null : null;
      const bindingConnection = binding ? connectionsById.get(binding.connectionId) ?? null : null;

      return (
        bindingConnection?.role !== "locorisCloud" &&
        (!binding || binding.connectionId !== connection.id || binding.remoteVaultId !== remoteVault.id)
      );
    });

    if (candidates.length === 0) {
      showFeedback(
        "success",
        `${t("settings.remoteImportAllNothing")}${
          cloudManagedCount > 0 ? ` ${t("settings.syncConnectionsDescription")}` : ""
        }`
      );
      return;
    }

    const reconnectCount = candidates.filter((remoteVault) => {
      const localVault = localVaultByGuid.get(remoteVault.id) ?? null;
      const binding = localVault ? bindingsByVaultId.get(localVault.id) ?? null : null;
      return Boolean(binding && binding.connectionId !== connection.id);
    }).length;
    const safeCandidates = candidates.filter((remoteVault) => {
      const localVault = localVaultByGuid.get(remoteVault.id) ?? null;
      const binding = localVault ? bindingsByVaultId.get(localVault.id) ?? null : null;
      return !binding || binding.connectionId === connection.id;
    });

    const runImportAll = async (
      targetVaults: RemoteVaultCatalogEntry[],
      options?: {
        skippedCount?: number;
      }
    ) => {
      setBusyKey(`import-all:${connection.id}`);

      try {
        let importedCount = 0;
        let linkedCount = 0;
        let pendingUnlockResult:
          | {
              localVaultId: string;
              localVaultName: string;
              remoteVault: RemoteVaultCatalogEntry;
            }
          | null = null;

        for (const remoteVault of targetVaults) {
          const result = await onImportRemoteVault({
            connectionId: connection.id,
            remoteVaultId: remoteVault.id,
            remoteVaultName: remoteVault.name,
            remoteVaultKind: remoteVault.vaultKind,
            openAfterImport: false
          });

          if (result.disposition === "imported") {
            importedCount += 1;
          } else if (result.disposition === "linked") {
            linkedCount += 1;
          } else {
            pendingUnlockResult = {
              localVaultId: result.localVaultId,
              localVaultName: result.localVaultName,
              remoteVault
            };
            break;
          }
        }

        await loadRemoteVaultCatalog(connection, {
          silent: true
        });

        if (pendingUnlockResult) {
          setInternalFeedback(null);
          openVaultEncryptionModal(
            sortedVaults.find((vault) => vault.id === pendingUnlockResult.localVaultId) ??
              buildVaultProfileFallback(
                pendingUnlockResult.localVaultId,
                pendingUnlockResult.remoteVault.id,
                pendingUnlockResult.localVaultName,
                pendingUnlockResult.remoteVault.vaultKind
              ),
            {
              view: "unlock",
              continuation: "import",
              continuationAction: async () => {
                await onRunVaultSync(pendingUnlockResult.localVaultId);
                await loadRemoteVaultCatalog(connection, {
                  silent: true
                });
                await requestImportAllRemoteVaults(connection);
                onSelectLocalVault(pendingUnlockResult.localVaultId);
              }
            }
          );
          return;
        }

        showFeedback(
          "success",
          options?.skippedCount
            ? t("settings.remoteImportSafeCompleted", {
                imported: importedCount + linkedCount,
                skipped: options.skippedCount
              })
            : t("settings.remoteImportAllCompleted", {
                imported: importedCount,
                linked: linkedCount
              })
        );
      } catch (error) {
        const message = getErrorMessage(error);
        showFeedback("error", translateSyncManagerError(message, t));
      } finally {
        setBusyKey(null);
      }
    };

    if (reconnectCount > 0) {
      setConfirmState({
        title: t("settings.remoteImportAllConfirmTitle"),
        description: t("settings.remoteImportAllConfirmDescription", {
          connection: connection.label
        }),
        details: [
          t("settings.remoteImportAllDetailTotal", {
            count: candidates.length
          }),
          t("settings.remoteImportAllDetailReconnect", {
            count: reconnectCount
          }),
          t("settings.remoteImportAllDetailSafe", {
            count: safeCandidates.length
          })
        ],
        secondaryLabel:
          safeCandidates.length > 0 ? t("settings.remoteImportSafeOnly") : undefined,
        secondaryAction:
          safeCandidates.length > 0
            ? async () => {
                closeModal();
                await runImportAll(safeCandidates, {
                  skippedCount: reconnectCount
                });
              }
            : undefined,
        confirmLabel: t("settings.remoteImportAll"),
        tone: "danger",
        action: async () => {
          closeModal();
          await runImportAll(candidates);
        }
      });
      return;
    }

    await runImportAll(candidates);
  };

  const executeRemoteVaultDeletion = async (
    connection: SyncConnection,
    remoteVault: RemoteVaultCatalogEntry,
    options?: {
      deleteLocalVaultId?: string | null;
    }
  ) => {
    const actionKey = `delete-remote:${connection.id}:${remoteVault.id}`;
    setBusyKey(actionKey);

    try {
      await onDeleteRemoteVault({
        connectionId: connection.id,
        remoteVaultId: remoteVault.id
      });

      if (options?.deleteLocalVaultId) {
        await onDeleteLocalVault(options.deleteLocalVaultId, {
          skipConfirmation: true
        });
      }

      await loadRemoteVaultCatalog(connection, {
        silent: true
      });

      showFeedback(
        "success",
        options?.deleteLocalVaultId
          ? t("settings.remoteDeleteWithLocalCompleted", {
              vault: remoteVault.name
            })
          : t("settings.remoteDeleteCompleted", {
              vault: remoteVault.name
            })
      );
    } catch (error) {
      const message = getErrorMessage(error);
      showFeedback("error", translateSyncManagerError(message, t));
    } finally {
      setBusyKey(null);
    }
  };

  const requestDeleteRemoteVault = (
    connection: SyncConnection,
    remoteVault: RemoteVaultCatalogEntry
  ) => {
    const matchingLocalVault = localVaultByGuid.get(remoteVault.id) ?? null;
    const matchingBinding = matchingLocalVault
      ? bindingsByVaultId.get(matchingLocalVault.id) ?? null
      : null;
    const linkedHere =
      matchingBinding?.connectionId === connection.id && matchingBinding.remoteVaultId === remoteVault.id;

    setConfirmState({
      title: t("settings.remoteDeleteTitle"),
      description: linkedHere
        ? t("settings.remoteDeleteDescriptionLinked", {
            vault: remoteVault.name
          })
        : t("settings.remoteDeleteDescription", {
            vault: remoteVault.name
          }),
      details: [
        t("settings.remoteDeleteDetailServer"),
        t("settings.remoteDeleteDetailLocal"),
        t("settings.remoteDeleteDetailDisconnect")
      ],
      confirmLabel: t("settings.remoteDeleteAction"),
      tone: "danger",
      action: async () => {
        closeModal();
        await executeRemoteVaultDeletion(connection, remoteVault);
      }
    });
  };

  const requestDeleteLocalVault = (vault: LocalVaultProfile) => {
    const binding = bindingsByVaultId.get(vault.id) ?? null;
    const connection = binding ? connectionsById.get(binding.connectionId) ?? null : null;

    if (connection?.role === "locorisCloud") {
      void onDeleteLocalVault(vault.id);
      return;
    }

    if (!binding || !connection || localVaults.length <= 1) {
      void onDeleteLocalVault(vault.id);
      return;
    }

    setConfirmState({
      title: t("settings.localDeleteChoiceTitle"),
      description: t("settings.localDeleteChoiceDescription", {
        vault: getVaultLabel(vault),
        connection: connection.label
      }),
      details: [
        t("settings.localDeleteOnlyDetailLocal"),
        t("settings.localDeleteOnlyDetailRemote", {
          connection: connection.label
        }),
        t("settings.localDeleteRemoteDetailLocal"),
        t("settings.localDeleteRemoteDetailRemote", {
          connection: connection.label
        })
      ],
      secondaryLabel: t("settings.localDeleteOnlyAction"),
      secondaryAction: async () => {
        closeModal();
        await onDeleteLocalVault(vault.id, {
          skipConfirmation: true
        });
      },
      confirmLabel: t("settings.localDeleteRemoteAction"),
      tone: "danger",
      action: async () => {
        closeModal();
        await executeRemoteVaultDeletion(
          connection,
          {
            id: binding.remoteVaultId,
            name: binding.remoteVaultName,
            vaultKind: vault.vaultKind,
            createdAt: 0,
            updatedAt: 0,
            lastRevision: binding.syncCursor,
            lastSyncAt: binding.lastSyncAt,
            tokenCount: 0
          },
          {
            deleteLocalVaultId: vault.id
          }
        );
      }
    });
  };

  const requestVaultBinding = async (vaultId: string, connectionId: string) => {
    const vault = sortedVaults.find((entry) => entry.id === vaultId) ?? null;
    const connection = connectionsById.get(connectionId) ?? null;

    if (!vault || !connection) {
      return;
    }

    const existingBinding = bindingsByVaultId.get(vault.id) ?? null;
    const existingConnection = existingBinding
      ? connectionsById.get(existingBinding.connectionId) ?? null
      : null;

    if (existingConnection?.role === "locorisCloud" && existingConnection.id !== connection.id) {
      setPendingBindVaultId(null);
      setBindingSheetVaultId(null);
      showFeedback(
        "error",
        `${t("settings.accountCloudVaultConnected", { vault: getVaultLabel(vault) })} ${t("settings.syncConnectionsDescription")}`
      );
      return;
    }

    const runBinding = async () => {
      setBusyKey(`bind:${vault.id}:${connection.id}`);
      setInternalFeedback(null);

      try {
        await performVaultBinding(vault, connection, {
          refreshCatalog: true
        });
        setPendingBindVaultId(null);
        setBindingSheetVaultId(null);
        setConnectionAvailability((current) => ({
          ...current,
          [connection.id]: "available"
        }));
        showFeedback("success", t("sync.bindingUpdated"));
      } catch (error) {
        const message = getErrorMessage(error);
        setConnectionAvailability((current) => ({
          ...current,
          [connection.id]:
            isConnectionAuthErrorCode(message)
              ? "authError"
              : message === "SERVER_UNAVAILABLE" || message === "HTTP_404"
                ? "unavailable"
                : current[connection.id] ?? "checking"
        }));
        showFeedback("error", translateSyncManagerError(message, t));
      } finally {
        setBusyKey(null);
      }
    };

    if (existingBinding && existingBinding.connectionId !== connection.id) {
      setBindingSheetVaultId(null);
      setConfirmState({
        title: t("settings.rebindTitle"),
        description: t("settings.rebindDescription", {
          vault: getVaultLabel(vault),
          connection: connection.label
        }),
        confirmLabel: t("settings.rebindConfirm"),
        tone: "danger",
        action: async () => {
          closeModal();
          await runBinding();
        }
      });
      return;
    }

    await runBinding();
  };

  const requestBindAllVaults = (connection: SyncConnection) => {
    const cloudManagedVaults = sortedVaults.filter((vault) => {
      const existingBinding = bindingsByVaultId.get(vault.id) ?? null;
      const existingConnection = existingBinding
        ? connectionsById.get(existingBinding.connectionId) ?? null
        : null;
      return existingConnection?.role === "locorisCloud";
    });
    const eligibleVaults = sortedVaults.filter(
      (vault) => !cloudManagedVaults.some((entry) => entry.id === vault.id)
    );

    if (eligibleVaults.length === 0) {
      showFeedback("error", t("settings.syncConnectionsDescription"));
      return;
    }

    const rebindCount = eligibleVaults.filter((vault) => {
      const existingBinding = bindingsByVaultId.get(vault.id);
      return existingBinding && existingBinding.connectionId !== connection.id;
    }).length;

    const runBindingAll = async () => {
      setBusyKey(`bind-all:${connection.id}`);

      try {
        for (const vault of eligibleVaults) {
          await performVaultBinding(vault, connection, {
            refreshCatalog: false
          });
        }

        await loadRemoteVaultCatalog(connection, {
          silent: true
        });
        setPendingBindVaultId(null);
        setBindingSheetVaultId(null);
        setConnectionAvailability((current) => ({
          ...current,
          [connection.id]: "available"
        }));
        showFeedback(
          "success",
          `${t("settings.bindAllCompleted", { count: eligibleVaults.length })}${
            cloudManagedVaults.length > 0 ? ` ${t("settings.syncConnectionsDescription")}` : ""
          }`
        );
      } catch (error) {
        const message = getErrorMessage(error);
        setConnectionAvailability((current) => ({
          ...current,
          [connection.id]:
            isConnectionAuthErrorCode(message)
              ? "authError"
              : message === "SERVER_UNAVAILABLE" || message === "HTTP_404"
                ? "unavailable"
                : current[connection.id] ?? "checking"
        }));
        showFeedback("error", translateSyncManagerError(message, t));
      } finally {
        setBusyKey(null);
      }
    };

    if (rebindCount > 0) {
      setConfirmState({
        title: t("settings.bindAllConfirmTitle"),
        description: t("settings.bindAllConfirmDescription", {
          count: rebindCount,
          connection: connection.label
        }),
        confirmLabel: t("settings.bindAllVaults"),
        tone: "danger",
        action: async () => {
          closeModal();
          await runBindingAll();
        }
      });
      return;
    }

    void runBindingAll();
  };

  const cancelVaultBindingFlow = () => {
    setPendingBindVaultId(null);
    setBindingSheetVaultId(null);
    setInternalFeedback(null);
  };

  const openAddConnectionCatalog = () => {
    setPanelModal({ kind: "addConnection" });
  };

  const openAddConnectionFromBindingFlow = () => {
    setBindingSheetVaultId(null);
    openAddConnectionCatalog();
    showFeedback("success", t("settings.bindingAddConnectionNext"));
  };

  const startVaultBindingFlow = (vault: LocalVaultProfile) => {
    const currentBinding = bindingsByVaultId.get(vault.id) ?? null;
    const currentConnection = currentBinding
      ? connectionsById.get(currentBinding.connectionId) ?? null
      : null;

    if (currentConnection?.role === "locorisCloud") {
      setPendingBindVaultId(null);
      setBindingSheetVaultId(null);
      showFeedback(
        "error",
        `${t("settings.accountCloudVaultConnected", { vault: getVaultLabel(vault) })} ${t("settings.syncConnectionsDescription")}`
      );
      return;
    }

    onSelectLocalVault(vault.id);
    setPendingBindVaultId(vault.id);
    setBindingSheetVaultId(vault.id);

    if (syncConnections.length === 0) {
      showFeedback(
        "error",
        t("settings.bindingNeedsConnectionFeedback", {
          vault: getVaultLabel(vault)
        })
      );
      return;
    }

    showFeedback(
      "success",
      t("settings.bindingChooseConnectionFeedback", {
        vault: getVaultLabel(vault)
      })
    );
    if (typeof window === "undefined") {
      return;
    }

    window.requestAnimationFrame(() => {
      connectionListRef.current?.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    });
  };

  const requestVaultBindingFromSheet = async (vaultId: string, connectionId: string) => {
    await requestVaultBinding(vaultId, connectionId);
  };

  const refreshConnectionRemoteVaults = async (connection: SyncConnection) => {
    let nextConnection = connection;
    let googleDriveSignInRefreshed = false;
    const availability = online ? connectionAvailability[connection.id] ?? "checking" : "offline";
    const reauthBusyKey = `reauth:${connection.id}`;

    if (connection.provider === "selfHosted" && availability === "authError") {
      openSelfHostedConnectionModal(connection);
      return;
    }

    if (connection.provider === "hosted" && availability === "authError") {
      openHostedConnectionModal(connection);
      return;
    }

    if (connection.provider === "googleDrive" && availability === "authError") {
      try {
        setBusyKey(reauthBusyKey);
        nextConnection = await reauthorizeGoogleDriveConnection(connection);
        googleDriveSignInRefreshed = true;
      } catch (error) {
        const message = getErrorMessage(error);
        showFeedback("error", translateSyncManagerError(message, t));
        setBusyKey(null);
        return;
      }
    }

    try {
      await loadRemoteVaultCatalog(nextConnection, {
        silent: false
      });
      if (googleDriveSignInRefreshed) {
        setConnectionAvailability((current) => ({
          ...current,
          [connection.id]: "available"
        }));
        setRemoteVaultErrors((current) => ({
          ...current,
          [connection.id]: null
        }));
        showFeedback("success", t("settings.googleDriveReconnectSuccess"));
      }
    } finally {
      setBusyKey((current) => (current === reauthBusyKey ? null : current));
    }
  };

  const repairConnectionAuth = async (connection: SyncConnection) => {
    if (connection.provider === "selfHosted") {
      openSelfHostedConnectionModal(connection);
      return;
    }

    if (connection.provider === "hosted") {
      openHostedConnectionModal(connection);
      return;
    }

    if (connection.provider !== "googleDrive") {
      return;
    }

    const reauthBusyKey = `reauth:${connection.id}`;

    try {
      setBusyKey(reauthBusyKey);
      const nextConnection = await reauthorizeGoogleDriveConnection(connection);
      await loadRemoteVaultCatalog(nextConnection, {
        silent: false
      });
      setConnectionAvailability((current) => ({
        ...current,
        [connection.id]: "available"
      }));
      setRemoteVaultErrors((current) => ({
        ...current,
        [connection.id]: null
      }));
      showFeedback("success", t("settings.googleDriveReconnectSuccess"));
    } catch (error) {
      const message = getErrorMessage(error);
      showFeedback("error", translateSyncManagerError(message, t));
    } finally {
      setBusyKey((current) => (current === reauthBusyKey ? null : current));
    }
  };

  const openCreateVaultModal = () => {
    setVaultNameDraft("");
    setVaultNameError(null);
    setVaultKindDraft("regular");
    setVaultPassphraseDraft("");
    setVaultPassphraseConfirmDraft("");
    setPanelModal({
      kind: "createVault"
    });
  };

  const openRenameVaultModal = (vault: LocalVaultProfile) => {
    setVaultNameDraft(vault.name);
    setVaultNameError(null);
    setPanelModal({
      kind: "renameVault",
      vault
    });
  };

  const resolveVaultEncryptionSummary = (vault: LocalVaultProfile) =>
    vaultEncryptionById[vault.id] ?? {
      enabled: false,
      state: "disabled" as const,
      keyId: null,
      updatedAt: null
    };

  const buildVaultProfileFallback = (
    vaultId: string,
    vaultGuid: string,
    name: string,
    vaultKind: LocalVaultKind = "regular"
  ): LocalVaultProfile => ({
    id: vaultId,
    vaultGuid,
    name,
    vaultKind,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  const openVaultEncryptionModal = (
    vault: LocalVaultProfile,
    options?: {
      view?: VaultEncryptionModalView;
      continuation?: VaultEncryptionContinuationKind;
      continuationAction?: (() => Promise<void>) | null;
    }
  ) => {
    if (vault.vaultKind !== "private") {
      return;
    }

    setEncryptionPassphraseDraft("");
    setEncryptionPassphraseConfirmDraft("");
    setEncryptionNextPassphraseDraft("");
    setEncryptionNextPassphraseConfirmDraft("");
    pendingVaultEncryptionContinuationRef.current = options?.continuationAction ?? null;
    setPanelModal({
      kind: "vaultEncryption",
      vault,
      view: options?.view,
      continuation: options?.continuation ?? null
    });
  };

  const handleVaultEncryptionSubmit = async () => {
    if (!panelModal || panelModal.kind !== "vaultEncryption") {
      return;
    }

    const vault = panelModal.vault;
    const summary = resolveVaultEncryptionSummary(vault);
    const modalView = panelModal.view ?? "default";
    const isExplicitUnlock = modalView === "unlock";
    const isEnabling = !isExplicitUnlock && summary.state === "disabled";
    const isLocked = isExplicitUnlock || summary.state === "locked";
    const passphrase = encryptionPassphraseDraft.trim();
    const continuation = pendingVaultEncryptionContinuationRef.current;

    if (isEnabling) {
      if (!passphrase) {
        showFeedback("error", t("sync.vaultEncryptionPassphraseRequired"));
        return;
      }

      if (passphrase.length < 8) {
        showFeedback("error", t("sync.vaultEncryptionPassphraseTooShort"));
        return;
      }

      if (passphrase !== encryptionPassphraseConfirmDraft.trim()) {
        showFeedback("error", t("sync.vaultEncryptionPassphraseMismatch"));
        return;
      }

      setBusyKey(`vault-encryption:${vault.id}:enable`);

      try {
        await onEnableVaultEncryption({
          localVaultId: vault.id,
          passphrase
        });
        closeModal();
      } catch (error) {
        const message = getErrorMessage(error);
        showFeedback("error", translateSyncManagerError(message, t));
      } finally {
        setBusyKey(null);
      }

      return;
    }

    if (isLocked) {
      if (!passphrase) {
        showFeedback("error", t("sync.vaultEncryptionPassphraseRequired"));
        return;
      }

      setBusyKey(`vault-encryption:${vault.id}:unlock`);

      try {
        await onUnlockVaultEncryption({
          localVaultId: vault.id,
          passphrase
        });

        closeModal();

        if (continuation) {
          await continuation();
        }

      } catch (error) {
        const message = getErrorMessage(error);
        showFeedback("error", translateSyncManagerError(message, t));
      } finally {
        setBusyKey(null);
      }
    }
  };

  const handleChangeVaultEncryptionPassphraseSubmit = async () => {
    if (!panelModal || panelModal.kind !== "vaultEncryption") {
      return;
    }

    const vault = panelModal.vault;
    const hasUnlockedSession = resolveVaultEncryptionSummary(vault).state === "ready";
    const currentPassphrase = encryptionPassphraseDraft.trim();
    const nextPassphrase = encryptionNextPassphraseDraft.trim();
    const confirmPassphrase = encryptionNextPassphraseConfirmDraft.trim();

    if (!nextPassphrase) {
      showFeedback("error", t("sync.vaultEncryptionPassphraseRequired"));
      return;
    }

    if (nextPassphrase.length < 8) {
      showFeedback("error", t("sync.vaultEncryptionPassphraseTooShort"));
      return;
    }

    if (nextPassphrase !== confirmPassphrase) {
      showFeedback("error", t("sync.vaultEncryptionPassphraseMismatch"));
      return;
    }

    if (!hasUnlockedSession && !currentPassphrase) {
      showFeedback("error", t("sync.vaultEncryptionPassphraseRequired"));
      return;
    }

    setBusyKey(`vault-encryption:${vault.id}:change`);

    try {
      await onChangeVaultEncryptionPassphrase({
        localVaultId: vault.id,
        currentPassphrase: hasUnlockedSession ? undefined : currentPassphrase,
        nextPassphrase
      });
      closeModal();
    } catch (error) {
      const message = getErrorMessage(error);
      showFeedback("error", translateSyncManagerError(message, t));
    } finally {
      setBusyKey(null);
    }
  };

  const handleDisableVaultEncryptionSubmit = async () => {
    if (!panelModal || panelModal.kind !== "vaultEncryption") {
      return;
    }

    const vault = panelModal.vault;
    const hasUnlockedSession = resolveVaultEncryptionSummary(vault).state === "ready";
    const currentPassphrase = encryptionPassphraseDraft.trim();

    if (!hasUnlockedSession && !currentPassphrase) {
      showFeedback("error", t("sync.vaultEncryptionPassphraseRequired"));
      return;
    }

    setBusyKey(`vault-encryption:${vault.id}:disable`);

    try {
      await onDisableVaultEncryption({
        localVaultId: vault.id,
        currentPassphrase: hasUnlockedSession ? undefined : currentPassphrase
      });
      closeModal();
    } catch (error) {
      const message = getErrorMessage(error);
      showFeedback("error", translateSyncManagerError(message, t));
    } finally {
      setBusyKey(null);
    }
  };

  const handleLockCurrentVaultSession = async (vault: LocalVaultProfile) => {
    setBusyKey(`vault-encryption:${vault.id}:lock`);

    try {
      await onLockVaultEncryption(vault.id);
      closeModal();
    } catch (error) {
      const message = getErrorMessage(error);
      showFeedback("error", translateSyncManagerError(message, t));
    } finally {
      setBusyKey(null);
    }
  };

  const connectionPreviewNames = (connectionId: string) =>
    syncBindings
      .filter((binding) => binding.connectionId === connectionId)
      .map((binding) => sortedVaults.find((vault) => vault.id === binding.localVaultId)?.name ?? binding.localVaultId)
      .slice(0, 3);

  return (
    <>
      <SyncSettingsLayout
        title={t("settings.syncTitle")}
        kicker={online ? t("sync.statusReady") : t("settings.connectionOffline")}
        caption={t("settings.syncManagerIntro")}
        backLabel={t("settings.back")}
        closeLabel={t("orbit.closeModal")}
        backIcon={<ChevronLeftGlyph />}
        closeIcon={<CloseGlyph />}
        stageRef={stageRef}
        onBack={onBack}
        onClose={onClose}
        wires={
          <svg className="sync-settings-links" aria-hidden="true">
          {linkMetrics.map((metric) => (
            <g key={metric.id}>
              <path
                d={metric.path}
                className={`sync-settings-link-wire is-${metric.statusTone}`}
                style={{ "--link-color": metric.color } as CSSProperties}
              />
              <path
                d={metric.path}
                className={`sync-settings-link-stream is-${metric.statusTone}`}
                style={{ "--link-color": metric.color } as CSSProperties}
              />
            </g>
          ))}

          </svg>
        }
        bindingHint={
          pendingBindVault ? (
            <div
              className={`sync-settings-binding-hint ${
                syncConnections.length === 0 ? "is-missing-connection" : "is-choosing-connection"
              }`}
            >
              <span className="sync-settings-binding-icon" aria-hidden="true">
                <LinkGlyph />
              </span>
              <div className="sync-settings-binding-copy">
                <strong>
                  {syncConnections.length === 0
                    ? t("settings.bindingNeedsConnectionTitle")
                    : t("settings.bindingHintTitle")}
                </strong>
                <span>
                  {syncConnections.length === 0
                    ? t("settings.bindingNeedsConnectionDescription", {
                        vault: getVaultLabel(pendingBindVault)
                      })
                    : t("settings.bindingHintDescription", {
                        vault: getVaultLabel(pendingBindVault)
                      })}
                </span>
              </div>
              <div className="sync-settings-binding-actions">
                {syncConnections.length === 0 ? (
                  <button
                    type="button"
                    className="sync-settings-primary-action"
                    onClick={openAddConnectionFromBindingFlow}
                  >
                    {t("settings.addConnection")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="sync-settings-inline-action"
                  onClick={cancelVaultBindingFlow}
                >
                  {t("settings.cancelBindingAction")}
                </button>
              </div>
            </div>
          ) : undefined
        }
      >
        <SyncSettingsMobile
          online={online}
          localVaults={sortedVaults}
          activeLocalVaultId={activeLocalVaultId}
          selectedLocalVaultId={selectedLocalVaultId}
          syncConnections={syncConnections}
          syncBindings={syncBindings}
          bindingConnections={allSyncConnections}
          vaultBindings={allSyncBindings}
          vaultEncryptionById={vaultEncryptionById}
          connectionAvailability={connectionAvailability}
          selfHostedEndpointCandidates={selfHostedEndpointCandidates}
          remoteVaultsByConnectionId={remoteVaultsByConnectionId}
          remoteVaultErrors={remoteVaultErrors}
          remoteVaultLoading={remoteVaultLoading}
          pendingBindVaultId={pendingBindVaultId}
          bindingSheetVault={bindingSheetVault}
          busyKey={busyKey}
          getVaultLabel={getVaultLabel}
          getBindingErrorLabel={(errorCode) =>
            errorCode ? translateSyncManagerError(errorCode, t) : null
          }
          onSelectLocalVault={onSelectLocalVault}
          onCreateVault={openCreateVaultModal}
          onRenameVault={openRenameVaultModal}
          onDeleteLocalVault={requestDeleteLocalVault}
          onStartVaultBinding={startVaultBindingFlow}
          onCancelVaultBinding={cancelVaultBindingFlow}
          onConnectCloud={openHostedConnectionModal}
          onAddConnection={openAddConnectionCatalog}
          onAddConnectionFromBinding={openAddConnectionFromBindingFlow}
          onBindVaultToConnection={requestVaultBindingFromSheet}
          onClearBinding={onClearBinding}
          onOpenVaultEncryption={(vault, view) =>
            openVaultEncryptionModal(vault, {
              view
            })
          }
          onRefreshRemoteVaults={refreshConnectionRemoteVaults}
          onImportAllRemoteVaults={requestImportAllRemoteVaults}
          onImportRemoteVault={requestRemoteVaultImport}
          onDeleteRemoteVault={requestDeleteRemoteVault}
          onBindAllVaults={requestBindAllVaults}
          onDeleteConnection={onDeleteConnection}
          onRevokeGoogleDriveConnection={onRevokeGoogleDriveConnection}
          onRepairConnection={repairConnectionAuth}
          onEditSelfHostedEndpoint={openSelfHostedEndpointModal}
          onManageSelfHostedAccess={(connection) =>
            setPanelModal({ kind: "manageSelfHosted", connection })
          }
        />

        <div className="sync-settings-desktop-surface">
        <div className="sync-settings-columns">
          <section className="sync-settings-column is-vaults">
              <div className="sync-settings-column-head">
                <div className="sync-settings-column-copy">
                  <span className="setting-label">{t("settings.vaultsTitle")}</span>
                  <p>{t("settings.vaultsDescription")}</p>
                </div>
                <div className="sync-settings-column-actions">
                  <span className="sync-settings-column-pill is-vaults">{sortedVaults.length}</span>
                  <button
                    type="button"
                    className="sync-settings-icon-button"
                    onClick={openCreateVaultModal}
                    title={t("sync.localVaultCreate")}
                  >
                    <PlusGlyph />
                  </button>
                </div>
              </div>

              <div className="sync-settings-card-list" ref={vaultListRef}>
                {sortedVaults.map((vault) => {
                  const isActive = vault.id === activeLocalVaultId;
                  const isSelected = vault.id === selectedLocalVaultId;
                  const binding = bindingsByVaultId.get(vault.id) ?? null;
                  const bindingConnection = binding ? connectionsById.get(binding.connectionId) ?? null : null;
                  const isLocorisCloudManaged = bindingConnection?.role === "locorisCloud";
                  const encryption = resolveVaultEncryptionSummary(vault);
                  const privateEncryptionVisible =
                    vault.vaultKind === "private" && encryption.state !== "disabled";
                  const needsUnlock =
                    (binding?.lastError === "VAULT_ENCRYPTION_LOCKED" || encryption.state === "locked") &&
                    encryption.enabled;
                  const needsGoogleDriveSignIn = Boolean(
                    binding &&
                      bindingConnection?.provider === "googleDrive" &&
                      isSyncBindingAuthError(binding)
                  );
                  const statusLabel = !binding
                    ? t("settings.statusUnbound")
                    : needsUnlock
                      ? t("settings.statusUnlockRequired")
                      : binding.syncStatus === "syncing"
                        ? t("settings.statusSyncing")
                        : binding.syncStatus === "error"
                          ? t("settings.statusError")
                          : t("settings.statusReady");

                  return (
                    <article
                      key={vault.id}
                      ref={(node) => registerVaultRef(vault.id, node)}
                      className={`sync-settings-card sync-settings-vault-card ${isSelected ? "is-selected" : ""} ${isActive ? "is-active" : ""} ${pendingBindVaultId === vault.id ? "is-binding-source" : ""}`}
                      onClick={() => onSelectLocalVault(vault.id)}
                    >
                      <div className="sync-settings-card-main">
                        <div className="sync-settings-card-copy">
                          <div className="sync-settings-chip-row sync-settings-chip-row-card">
                            {isActive ? <span className="sync-settings-chip is-accent">{t("sync.localVaultActive")}</span> : null}
                            {vault.vaultKind === "private" ? (
                              <span className="sync-settings-chip is-private">
                                {t("settings.vaultKindPrivate")}
                              </span>
                            ) : (
                              <span className="sync-settings-chip is-default">
                                {t("settings.vaultKindRegular")}
                              </span>
                            )}
                            {privateEncryptionVisible ? (
                              <span
                                className={`sync-settings-chip ${
                                  encryption.state === "ready" ? "is-encrypted-ready" : "is-encrypted-locked"
                                }`}
                              >
                                {encryption.state === "ready"
                                  ? t("settings.vaultEncryptionReady")
                                  : t("settings.vaultEncryptionLocked")}
                              </span>
                            ) : null}
                            {isLocorisCloudManaged ? (
                              <span className="sync-settings-chip is-cloud">
                                {t("settings.accountCloudConnected")}
                              </span>
                            ) : null}
                            <span
                              className={`sync-settings-chip ${
                                !bindingConnection
                                  ? "is-unbound"
                                  : needsUnlock
                                    ? "is-info"
                                    : binding?.syncStatus === "error"
                                      ? "is-error"
                                      : binding?.syncStatus === "syncing"
                                        ? "is-info"
                                        : "is-ready"
                              }`}
                            >
                              {statusLabel}
                            </span>
                          </div>
                          <div className="sync-settings-card-titleline">
                            <span
                              className="sync-settings-card-icon"
                              style={{ "--item-color": bindingConnection ? providerAccent(bindingConnection.provider) : "#e7d6a2" } as CSSProperties}
                            >
                              <VaultGlyph />
                            </span>
                            {privateEncryptionVisible ? (
                              <span
                                className={`sync-settings-encryption-badge ${
                                  encryption.state === "ready" ? "is-ready" : "is-locked"
                                }`}
                                title={
                                  encryption.state === "ready"
                                    ? t("settings.vaultEncryptionReady")
                                    : t("settings.vaultEncryptionLocked")
                                }
                              >
                                <LockGlyph />
                              </span>
                            ) : null}
                            <strong>{getVaultLabel(vault)}</strong>
                          </div>
                          <span className="sync-settings-card-meta">
                            {bindingConnection
                              ? t("settings.boundToConnection", {
                                  connection: bindingConnection.label
                                })
                              : t("sync.localVaultUnbound")}
                          </span>
                          {binding ? (
                            <span className="sync-settings-card-submeta">
                              {binding.remoteVaultName} · {formatTime(binding.lastSyncAt, localeRuntime)}
                            </span>
                          ) : null}
                          {binding?.lastError && binding.lastError !== "VAULT_ENCRYPTION_LOCKED" ? (
                            <span className="sync-settings-card-error" role="status">
                              {translateSyncManagerError(binding.lastError, t)}
                            </span>
                          ) : null}
                          {needsGoogleDriveSignIn && bindingConnection ? (
                            <button
                              type="button"
                              className="sync-settings-inline-action sync-settings-auth-repair-action"
                              disabled={busyKey !== null}
                              onClick={(event) => {
                                event.stopPropagation();
                                void repairConnectionAuth(bindingConnection);
                              }}
                            >
                              {t("settings.googleDriveReconnect")}
                            </button>
                          ) : null}
                        </div>
                      </div>

                      <div className="sync-settings-card-actions">
                        {privateEncryptionVisible ? (
                          <button
                            type="button"
                            className={`sync-settings-icon-button ${
                              encryption.state === "ready" ? "is-encryption-ready" : ""
                            }`}
                            title={
                              encryption.state === "ready"
                                ? t("settings.manageVaultEncryption")
                                : t("settings.unlockVaultEncryption")
                            }
                            onClick={(event) => {
                              event.stopPropagation();
                              openVaultEncryptionModal(vault, {
                                view: encryption.state === "locked" ? "unlock" : "default"
                              });
                            }}
                          >
                            <LockGlyph />
                          </button>
                        ) : null}
                        {!isLocorisCloudManaged ? (
                          <>
                            <button
                              type="button"
                              className={`sync-settings-vault-action ${
                                binding ? "is-change-binding" : "is-bind"
                              }`}
                              title={binding ? t("settings.changeBindingAction") : t("settings.bindVaultAction")}
                              onClick={(event) => {
                                event.stopPropagation();
                                startVaultBindingFlow(vault);
                              }}
                            >
                              {binding ? t("settings.changeBindingAction") : t("settings.bindVaultAction")}
                            </button>
                            {binding ? (
                              <button
                                type="button"
                                className="sync-settings-vault-action is-unbind"
                                title={t("settings.unbindVaultAction")}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void onClearBinding(vault.id);
                                }}
                              >
                                {t("settings.unbindVaultAction")}
                              </button>
                            ) : null}
                          </>
                        ) : null}
                        <button
                          type="button"
                          className="sync-settings-icon-button"
                          title={t("sync.localVaultRename")}
                          onClick={(event) => {
                            event.stopPropagation();
                            openRenameVaultModal(vault);
                          }}
                        >
                          <EditGlyph />
                        </button>
                        <button
                          type="button"
                          className="sync-settings-icon-button is-danger"
                          title={t("sync.localVaultDelete")}
                          onClick={(event) => {
                            event.stopPropagation();
                            requestDeleteLocalVault(vault);
                          }}
                        >
                          <TrashGlyph />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section
              className={`sync-settings-column is-connections ${
                pendingBindVault
                  ? syncConnections.length === 0
                    ? "is-awaiting-connection"
                    : "is-awaiting-choice"
                  : ""
              }`}
            >
              <div className="sync-settings-column-head">
                <div className="sync-settings-column-copy">
                  <span className="setting-label">{t("settings.connectionsTitle")}</span>
                  <p>{t("settings.connectionsDescription")}</p>
                </div>
                <div className="sync-settings-column-actions">
                  <span className="sync-settings-column-pill is-connections">{syncConnections.length}</span>
                  <button
                    type="button"
                    className={`sync-settings-icon-button sync-settings-add-connection-button ${
                      pendingBindVault && syncConnections.length === 0 ? "is-guided" : ""
                    }`}
                    onClick={openAddConnectionCatalog}
                    title={t("settings.addConnection")}
                  >
                    <PlusGlyph />
                  </button>
                </div>
              </div>

            <div className="sync-settings-card-list" ref={connectionListRef}>
              {syncConnections.length === 0 ? (
                <div className="sync-settings-empty-card">
                  <strong>{t("settings.noConnectionsTitle")}</strong>
                  <span>{t("settings.noConnectionsDescription")}</span>
                </div>
              ) : (
                syncConnections.map((connection) => {
                  const previewNames = connectionPreviewNames(connection.id);
                  const boundCount = boundVaultCountByConnectionId.get(connection.id) ?? 0;
                  const remoteVaults = remoteVaultsByConnectionId[connection.id] ?? [];
                  const remoteCount = remoteVaults.length;
                  const remoteError = remoteVaultErrors[connection.id] ?? null;
                  const isRemoteLoading = remoteVaultLoading[connection.id] ?? false;
                  const remoteSectionExpanded = expandedRemoteConnectionIds[connection.id] ?? false;
                  const canBindSelected = pendingBindVaultId !== null;
                  const availability = online
                    ? connectionAvailability[connection.id] ?? "checking"
                    : "offline";
                  const availabilityLabel =
                    availability === "available"
                      ? t("settings.connectionAvailable")
                      : availability === "unavailable"
                        ? t("settings.connectionUnavailable")
                        : availability === "authError"
                          ? t("settings.connectionAuthError")
                          : availability === "offline"
                            ? t("settings.connectionOffline")
                            : t("settings.connectionChecking");
                  const availabilityChipClass =
                    availability === "available"
                      ? "is-ready"
                      : availability === "unavailable"
                        ? "is-error"
                        : availability === "authError"
                          ? "is-info"
                          : availability === "offline"
                            ? "is-offline"
                            : "is-neutral";
                  const canRepairSelfHostedAuth =
                    connection.provider === "selfHosted" && availability === "authError";
                  const canRepairHostedAuth =
                    connection.provider === "hosted" && availability === "authError";
                  const canRepairGoogleDriveAuth =
                    connection.provider === "googleDrive" && availability === "authError";
                  const endpointCandidate = selfHostedEndpointCandidates[connection.id] ?? null;

                  return (
                    <article
                      key={connection.id}
                      data-sync-connection-id={connection.id}
                      ref={(node) => registerConnectionRef(connection.id, node)}
                      className={`sync-settings-card sync-settings-connection-card ${canBindSelected ? "is-bind-target" : ""}`}
                      style={{ "--connection-accent": providerAccent(connection.provider) } as CSSProperties}
                      onClick={() => {
                        if (pendingBindVaultId) {
                          void requestVaultBinding(pendingBindVaultId, connection.id);
                        }
                      }}
                    >
                      <div className="sync-settings-card-main">
                        <div className="sync-settings-card-copy">
                          <div className="sync-settings-chip-row sync-settings-chip-row-card">
                            <span
                              className={`sync-settings-chip ${
                                connection.provider === "hosted"
                                  ? "is-hosted"
                                  : connection.provider === "googleDrive"
                                    ? "is-google-drive"
                                    : "is-self-hosted"
                              }`}
                            >
                              {connection.provider === "hosted"
                                ? t("settings.legacyHostedConnectionTitle")
                                : connection.provider === "googleDrive"
                                  ? t("sync.googleDrive")
                                  : t("sync.selfHosted")}
                            </span>
                            <span className={`sync-settings-chip ${availabilityChipClass}`}>{availabilityLabel}</span>
                          </div>
                          <div className="sync-settings-card-titleline">
                            <span className="sync-settings-card-icon" style={{ "--item-color": providerAccent(connection.provider) } as CSSProperties}>
                              <SyncConnectionIcon provider={connection.provider} />
                            </span>
                            <strong>{connection.label}</strong>
                          </div>
                          <span className="sync-settings-card-meta">
                            {connection.provider === "hosted"
                              ? connection.userEmail || connection.serverUrl
                              : connection.provider === "googleDrive"
                                ? connection.userEmail || t("settings.googleDriveAppFolder")
                              : connection.serverUrl}
                          </span>
                          <span className="sync-settings-card-submeta">
                            {connection.provider === "hosted"
                              ? connection.userName || t("sync.hostedAccountSignedOut")
                              : connection.provider === "googleDrive"
                                ? t("settings.googleDriveSessionReady")
                              : connection.selfHostedRole === "guest"
                                ? t("settings.selfHostedGuestDeviceAccess")
                                : connection.selfHostedDeviceId
                                  ? t("settings.selfHostedTrustedDeviceAccess")
                                  : t("settings.selfHostedLegacyAccess")}
                          </span>
                          <div className="sync-settings-connection-stats">
                            <span className="sync-settings-mini-chip">
                              {t("settings.linkedVaultCount", { count: boundCount })}
                            </span>
                            <span className="sync-settings-mini-chip">
                              {t("settings.remoteVaultCount", { count: remoteCount })}
                            </span>
                            {previewNames.map((name) => (
                              <span key={`${connection.id}-${name}`} className="sync-settings-mini-chip">
                                {name}
                              </span>
                            ))}
                            {boundCount > previewNames.length ? (
                              <span className="sync-settings-mini-chip">+{boundCount - previewNames.length}</span>
                            ) : null}
                          </div>
                          {connection.provider === "hosted" ? (
                            <div className="sync-settings-card-actions">
                              <button
                                type="button"
                                className="sync-settings-inline-action"
                                disabled={busyKey !== null}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openHostedConnectionModal(connection);
                                }}
                              >
                                {availability === "authError"
                                  ? t("settings.hostedReconnect")
                                  : t("settings.cloudWizardManageAction")}
                              </button>
                            </div>
                          ) : null}
                          {canRepairSelfHostedAuth ? (
                            <div className="sync-settings-card-actions">
                              <button
                                type="button"
                                className="sync-settings-inline-action"
                                disabled={busyKey !== null}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openSelfHostedConnectionModal(connection);
                                }}
                              >
                                {t("settings.selfHostedReconnect")}
                              </button>
                            </div>
                          ) : null}
                          {canRepairHostedAuth && connection.provider !== "hosted" ? (
                            <div className="sync-settings-card-actions">
                              <button
                                type="button"
                                className="sync-settings-inline-action"
                                disabled={busyKey !== null}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openHostedConnectionModal(connection);
                                }}
                              >
                                {t("settings.hostedReconnect")}
                              </button>
                            </div>
                          ) : null}
                          {canRepairGoogleDriveAuth ? (
                            <div className="sync-settings-card-actions">
                              <button
                                type="button"
                                className="sync-settings-inline-action"
                                disabled={busyKey !== null}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void repairConnectionAuth(connection);
                                }}
                              >
                                {t("settings.googleDriveReconnect")}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="sync-settings-remote-section" onClick={(event) => event.stopPropagation()}>
                        <div className="sync-settings-remote-head">
                          <div className="sync-settings-remote-copy">
                            <strong>{t("settings.remoteVaultsTitle")}</strong>
                            <span>{t("settings.remoteVaultsDescription")}</span>
                          </div>
                          <div className="sync-settings-remote-actions">
                            <button
                              type="button"
                              className="sync-settings-refresh-action"
                              title={t("settings.remoteVaultRefresh")}
                              disabled={isRemoteLoading || busyKey !== null}
                              onClick={() => {
                                void refreshConnectionRemoteVaults(connection);
                              }}
                            >
                              <span className="sync-settings-refresh-icon" aria-hidden="true">
                                <RemoteVaultCatalogGlyph />
                              </span>
                              <span>{t("settings.remoteVaultRefreshShort")}</span>
                            </button>
                            <button
                              type="button"
                              className="sync-settings-icon-button"
                              title={t("settings.remoteVaultExpand")}
                              onClick={() =>
                                setExpandedRemoteConnectionIds((current) => ({
                                  ...current,
                                  [connection.id]: !remoteSectionExpanded
                                }))
                              }
                            >
                              <ChevronToggleGlyph expanded={remoteSectionExpanded} />
                            </button>
                          </div>
                        </div>

                        {remoteSectionExpanded ? (
                          <>
                            <div className="sync-settings-remote-toolbar">
                              <span className="sync-settings-remote-toolbar-copy">
                                {isRemoteLoading
                                  ? t("settings.remoteVaultLoading")
                                  : t("settings.remoteVaultAvailableCount", {
                                      count: remoteCount
                                    })}
                              </span>
                              <button
                                type="button"
                                className="sync-settings-inline-action"
                                disabled={busyKey !== null || isRemoteLoading || remoteCount === 0}
                                onClick={() => {
                                  void requestImportAllRemoteVaults(connection);
                                }}
                              >
                                {t("settings.remoteImportAll")}
                              </button>
                            </div>

                            {remoteError ? (
                              <div className="sync-settings-remote-empty is-error">
                                <strong>{t("settings.remoteVaultLoadFailed")}</strong>
                                <span>{remoteError}</span>
                                {connection.provider === "selfHosted" &&
                                availability === "authError" ? (
                                  <button
                                    type="button"
                                    className="sync-settings-inline-action"
                                    disabled={busyKey !== null}
                                    onClick={() => {
                                      openSelfHostedConnectionModal(connection);
                                    }}
                                  >
                                    {t("settings.selfHostedReconnect")}
                                  </button>
                                ) : null}
                                {connection.provider === "hosted" &&
                                availability === "authError" ? (
                                  <button
                                    type="button"
                                    className="sync-settings-inline-action"
                                    disabled={busyKey !== null}
                                    onClick={() => {
                                      openHostedConnectionModal(connection);
                                    }}
                                  >
                                    {t("settings.hostedReconnect")}
                                  </button>
                                ) : null}
                                {connection.provider === "googleDrive" &&
                                availability === "authError" ? (
                                  <button
                                    type="button"
                                    className="sync-settings-inline-action"
                                    disabled={busyKey !== null}
                                    onClick={() => {
                                      void repairConnectionAuth(connection);
                                    }}
                                  >
                                    {t("settings.googleDriveReconnect")}
                                  </button>
                                ) : null}
                              </div>
                            ) : null}

                            {!remoteError && remoteCount === 0 && !isRemoteLoading ? (
                              <div className="sync-settings-remote-empty">
                                <strong>{t("sync.remoteVaults")}</strong>
                                <span>{t("sync.remoteVaultEmpty")}</span>
                              </div>
                            ) : null}

                            {remoteCount > 0 ? (
                              <div className="sync-settings-remote-list">
                                {remoteVaults.map((remoteVault) => {
                                  const matchingLocalVault = localVaultByGuid.get(remoteVault.id) ?? null;
                                  const matchingBinding = matchingLocalVault
                                    ? bindingsByVaultId.get(matchingLocalVault.id) ?? null
                                    : null;
                                  const matchingBindingConnection = matchingBinding
                                    ? connectionsById.get(matchingBinding.connectionId) ?? null
                                    : null;
                                  const isLocorisCloudManaged =
                                    matchingBindingConnection?.role === "locorisCloud";
                                  const isLinkedHere =
                                    matchingBinding?.connectionId === connection.id &&
                                    matchingBinding.remoteVaultId === remoteVault.id;
                                  const hasNameCollision =
                                    !matchingLocalVault &&
                                    localVaultNameSet.has(remoteVault.name.trim().toLowerCase());
                                  const actionKey = `import:${connection.id}:${remoteVault.id}`;
                                  const isActionBusy = busyKey === actionKey;

                                  return (
                                    <article key={remoteVault.id} className="sync-settings-remote-card">
                                      <div className="sync-settings-remote-card-copy">
                                        <div className="sync-settings-chip-row sync-settings-chip-row-card">
                                          <span
                                            className={`sync-settings-chip ${
                                              remoteVault.vaultKind === "private" ? "is-private" : "is-neutral"
                                            }`}
                                          >
                                            {remoteVault.vaultKind === "private"
                                              ? t("settings.vaultKindPrivate")
                                              : t("settings.vaultKindRegular")}
                                          </span>
                                          {isLinkedHere ? (
                                            <span className="sync-settings-chip is-ready">
                                              {t("settings.remoteVaultLinkedHere")}
                                            </span>
                                          ) : null}
                                          {matchingLocalVault && !isLinkedHere ? (
                                            <span className="sync-settings-chip is-info">
                                              {t("settings.remoteVaultOnDevice")}
                                            </span>
                                          ) : null}
                                          {isLocorisCloudManaged ? (
                                            <span className="sync-settings-chip is-cloud">
                                              {t("settings.accountCloudConnected")}
                                            </span>
                                          ) : null}
                                          {hasNameCollision ? (
                                            <span className="sync-settings-chip is-count">
                                              {t("settings.remoteVaultNameCollision")}
                                            </span>
                                          ) : null}
                                        </div>
                                        <div className="sync-settings-card-titleline">
                                          <span
                                            className="sync-settings-card-icon"
                                            style={{ "--item-color": providerAccent(connection.provider) } as CSSProperties}
                                          >
                                            <VaultGlyph />
                                          </span>
                                          <strong>{remoteVault.name}</strong>
                                        </div>
                                        <span className="sync-settings-card-meta">
                                          {t("settings.remoteVaultIdLabel", {
                                            id: remoteVault.id
                                          })}
                                        </span>
                                        <span className="sync-settings-card-submeta">
                                          {t("settings.remoteVaultUpdatedAt", {
                                            time: formatTime(remoteVault.lastSyncAt ?? remoteVault.updatedAt, localeRuntime)
                                          })}
                                        </span>
                                        {matchingLocalVault ? (
                                          <span className="sync-settings-card-submeta">
                                            {t("settings.remoteVaultLocalMatch", {
                                              vault: matchingLocalVault.name
                                            })}
                                          </span>
                                        ) : hasNameCollision ? (
                                          <span className="sync-settings-card-submeta">
                                            {t("settings.remoteVaultWillAlias")}
                                          </span>
                                        ) : null}
                                      </div>

                                      <div className="sync-settings-card-actions">
                                        {!isLinkedHere && !isLocorisCloudManaged ? (
                                          <button
                                            type="button"
                                            className="sync-settings-inline-action"
                                            disabled={isActionBusy || busyKey !== null}
                                            onClick={() => {
                                              void requestRemoteVaultImport(connection, remoteVault);
                                            }}
                                          >
                                            {matchingLocalVault
                                              ? t("settings.remoteImportLinkLocal")
                                              : t("settings.remoteImportAction")}
                                          </button>
                                        ) : null}
                                        <button
                                          type="button"
                                          className="sync-settings-icon-button is-danger"
                                          title={t("settings.remoteDeleteAction")}
                                          disabled={busyKey !== null}
                                          onClick={() => {
                                            requestDeleteRemoteVault(connection, remoteVault);
                                          }}
                                        >
                                          <TrashGlyph />
                                        </button>
                                      </div>
                                    </article>
                                  );
                                })}
                              </div>
                            ) : null}
                          </>
                        ) : null}
                      </div>

                      <div className="sync-settings-card-actions sync-settings-card-actions-wide">
                        {connection.provider === "selfHosted" ? (
                          <button
                            type="button"
                            className="sync-settings-inline-action"
                            disabled={busyKey !== null}
                            onClick={(event) => {
                              event.stopPropagation();
                              openSelfHostedEndpointModal(connection, endpointCandidate ?? undefined);
                            }}
                          >
                            {endpointCandidate
                              ? t("settings.selfHostedEndpointFoundAction")
                              : t("settings.selfHostedEndpointAction")}
                          </button>
                        ) : null}
                        {connection.provider === "selfHosted" && connection.selfHostedRole !== "guest" ? (
                          <button
                            type="button"
                            className="sync-settings-inline-action"
                            disabled={busyKey !== null || availability !== "available"}
                            onClick={(event) => {
                              event.stopPropagation();
                              setPanelModal({ kind: "manageSelfHosted", connection });
                            }}
                          >
                            {t("settings.selfHostedManageAccess")}
                          </button>
                        ) : null}
                        {connection.provider === "googleDrive" ? (
                          <button
                            type="button"
                            className="sync-settings-inline-action"
                            disabled={busyKey !== null}
                            onClick={(event) => {
                              event.stopPropagation();
                              void onRevokeGoogleDriveConnection(connection.id);
                            }}
                          >
                            {t("sync.googleDriveRevoke")}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="sync-settings-inline-action"
                          disabled={busyKey !== null}
                          onClick={(event) => {
                            event.stopPropagation();
                            requestBindAllVaults(connection);
                          }}
                        >
                          {t("settings.bindAllVaults")}
                        </button>
                        <button
                          type="button"
                          className="sync-settings-icon-button is-danger"
                          title={t("sync.connectionDelete")}
                          onClick={(event) => {
                            event.stopPropagation();
                            void onDeleteConnection(connection.id);
                          }}
                        >
                          <TrashGlyph />
                        </button>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>
        </div>
        </div>
      </SyncSettingsLayout>

      <SyncSettingsDialog
        open={Boolean(panelModal)}
        closeLabel={t("orbit.closeModal")}
        closeIcon={<CloseGlyph />}
        onClose={closeModal}
        kicker={
          panelModal?.kind === "createVault"
            ? t("sync.localVaultCreate")
            : panelModal?.kind === "renameVault"
              ? t("sync.localVaultRename")
              : panelModal?.kind === "vaultEncryption"
                ? t("settings.vaultEncryptionKicker")
                : panelModal?.kind === "addConnection"
                  ? t("settings.addConnection")
                  : panelModal?.kind === "manageSelfHosted"
                    ? t("settings.selfHostedAccessKicker")
                  : panelModal?.kind === "editSelfHostedEndpoint"
                    ? t("settings.selfHostedEndpointKicker")
                  : panelModal?.kind === "addGoogleDrive"
                    ? t("sync.googleDrive")
                    : panelModal?.kind === "hostedWizard" || panelModal?.kind === "addHosted"
                      ? t("sync.hosted")
                      : t("sync.selfHosted")
        }
        title={
          panelModal?.kind === "createVault"
            ? t("settings.createVaultTitle")
            : panelModal?.kind === "renameVault"
              ? t("settings.renameVaultTitle")
              : panelModal?.kind === "vaultEncryption"
                ? t("settings.vaultEncryptionTitle", {
                    vault: getVaultLabel(panelModal.vault)
                  })
                : panelModal?.kind === "addConnection"
                  ? t("settings.connectionCatalogTitle")
                : panelModal?.kind === "manageSelfHosted"
                    ? t("settings.selfHostedAccessTitle")
                  : panelModal?.kind === "editSelfHostedEndpoint"
                    ? t("settings.selfHostedEndpointTitle")
                  : panelModal?.kind === "addGoogleDrive"
                    ? t("settings.googleDriveConnectionTitle")
                    : panelModal?.kind === "hostedWizard"
                      ? t("settings.cloudWizardTitle")
                      : panelModal?.kind === "addHosted"
                      ? t("settings.hostedConnectionTitle")
                      : selfHostedEditingConnection
                        ? t("settings.selfHostedReconnectTitle")
                        : t("settings.selfHostedConnectionTitle")
        }
      >
        {panelModal ? (
          <>
            {panelModal.kind === "createVault" || panelModal.kind === "renameVault" ? (
              <div className="sync-settings-modal-body">
                <p className="sync-settings-modal-copy">
                  {panelModal.kind === "createVault"
                    ? t("settings.createVaultDescription")
                    : t("settings.renameVaultDescription")}
                </p>
                {panelModal.kind === "createVault" ? (
                  <div className="sync-settings-vault-kind-picker" role="radiogroup" aria-label={t("settings.createVaultTypeLabel")}>
                    <button
                      type="button"
                      className={`sync-settings-vault-kind-card ${vaultKindDraft === "regular" ? "is-selected" : ""}`}
                      aria-pressed={vaultKindDraft === "regular"}
                      onClick={() => setVaultKindDraft("regular")}
                    >
                      <span className="sync-settings-vault-kind-title">{t("settings.vaultKindRegular")}</span>
                      <span className="sync-settings-vault-kind-copy">{t("settings.createVaultRegularDescription")}</span>
                    </button>
                    <button
                      type="button"
                      className={`sync-settings-vault-kind-card ${vaultKindDraft === "private" ? "is-selected" : ""}`}
                      aria-pressed={vaultKindDraft === "private"}
                      onClick={() => setVaultKindDraft("private")}
                    >
                      <span className="sync-settings-vault-kind-title">{t("settings.vaultKindPrivate")}</span>
                      <span className="sync-settings-vault-kind-copy">{t("settings.createVaultPrivateDescription")}</span>
                    </button>
                  </div>
                ) : null}
                <input
                  className="sync-settings-input"
                  value={vaultNameDraft}
                  onChange={(event) => {
                    setVaultNameDraft(event.target.value);
                    if (vaultNameError) {
                      setVaultNameError(null);
                    }
                  }}
                  placeholder={t("sync.localVaultCreatePlaceholder")}
                  autoFocus
                />
                {vaultNameError ? (
                  <span className="sync-settings-note-copy is-error">{vaultNameError}</span>
                ) : null}
                {panelModal.kind === "createVault" && vaultKindDraft === "private" ? (
                  <>
                    <input
                      className="sync-settings-input"
                      type="password"
                      value={vaultPassphraseDraft}
                      onChange={(event) => setVaultPassphraseDraft(event.target.value)}
                      placeholder={t("settings.vaultEncryptionPassphrase")}
                    />
                    <input
                      className="sync-settings-input"
                      type="password"
                      value={vaultPassphraseConfirmDraft}
                      onChange={(event) => setVaultPassphraseConfirmDraft(event.target.value)}
                      placeholder={t("settings.vaultEncryptionConfirmPassphrase")}
                    />
                    <span className="sync-settings-note-copy">
                      {t("settings.createVaultPrivateHint")}
                    </span>
                  </>
                ) : null}
                <div className="sync-settings-modal-actions">
                  <button type="button" className="sync-settings-inline-action" onClick={closeModal}>
                    {t("dialog.cancel")}
                  </button>
                  <button
                    type="button"
                    className="sync-settings-primary-action"
                    onClick={panelModal.kind === "createVault" ? handleCreateVault : handleRenameVault}
                  >
                    {panelModal.kind === "createVault" ? t("orbit.create") : t("sync.localVaultSave")}
                  </button>
                </div>
              </div>
            ) : null}

            {panelModal.kind === "vaultEncryption" ? (
              <div className="sync-settings-modal-body">
                {(() => {
                  const summary = resolveVaultEncryptionSummary(panelModal.vault);
                  const modalView = panelModal.view ?? "default";
                  const isExplicitUnlock = modalView === "unlock";
                  const isEnabling = !isExplicitUnlock && summary.state === "disabled";
                  const isLocked = isExplicitUnlock || summary.state === "locked";
                  const isReady = !isEnabling && !isLocked;
                  const hasUnlockedSession = summary.state === "ready";
                  const needsCurrentPassphrase =
                    (modalView === "changePassphrase" || modalView === "disable") &&
                    !hasUnlockedSession;
                  const hasBinding = Boolean(bindingsByVaultId.get(panelModal.vault.id) ?? null);
                  const enableBusyKey = `vault-encryption:${panelModal.vault.id}:enable`;
                  const unlockBusyKey = `vault-encryption:${panelModal.vault.id}:unlock`;
                  const lockBusyKey = `vault-encryption:${panelModal.vault.id}:lock`;
                  const changeBusyKey = `vault-encryption:${panelModal.vault.id}:change`;
                  const disableBusyKey = `vault-encryption:${panelModal.vault.id}:disable`;
                  const submitBusyKey = isEnabling ? enableBusyKey : unlockBusyKey;

                  return (
                    <>
                      <p className="sync-settings-modal-copy">
                        {isEnabling
                          ? t("settings.vaultEncryptionEnableDescription")
                          : isLocked
                            ? panelModal.continuation === "import"
                              ? t("settings.vaultEncryptionUnlockToContinueImport")
                              : panelModal.continuation === "sync"
                                ? t("settings.vaultEncryptionUnlockToContinueSync")
                                : t("settings.vaultEncryptionUnlockDescription")
                            : modalView === "changePassphrase"
                              ? t("settings.vaultEncryptionChangeDescription")
                              : modalView === "disable"
                                ? t("settings.vaultEncryptionDisableDescription")
                                : t("settings.vaultEncryptionReadyDescription")}
                      </p>

                      <div className="sync-settings-note-shell">
                        <span className="sync-settings-note-chip">E2EE</span>
                        <div className="sync-settings-encryption-stack">
                          <span className="sync-settings-note-copy">
                            {isEnabling
                              ? t("settings.vaultEncryptionEnableHint")
                              : isLocked
                                ? t("settings.vaultEncryptionLockedHint")
                                : modalView === "changePassphrase"
                                  ? hasBinding
                                    ? t("settings.vaultEncryptionBoundMigrationHint")
                                    : t("settings.vaultEncryptionChangeHint")
                                  : modalView === "disable"
                                    ? hasBinding
                                      ? t("settings.vaultEncryptionDisableRemoteHint")
                                      : t("settings.vaultEncryptionDisableLocalHint")
                                    : t("settings.vaultEncryptionReadyHint")}
                          </span>
                          {summary.keyId ? (
                            <div className="sync-settings-encryption-meta">
                              <span>{t("settings.vaultEncryptionKeyId")}</span>
                              <code className="sync-settings-code-pill">{summary.keyId}</code>
                            </div>
                          ) : null}
                          {summary.updatedAt ? (
                            <div className="sync-settings-encryption-meta">
                              <span>{t("settings.vaultEncryptionUpdatedAt")}</span>
                              <strong>{formatTime(summary.updatedAt, localeRuntime)}</strong>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {isEnabling ? (
                        <>
                          <input
                            className="sync-settings-input"
                            value={encryptionPassphraseDraft}
                            onChange={(event) => setEncryptionPassphraseDraft(event.target.value)}
                            placeholder={t("settings.vaultEncryptionPassphrase")}
                            type="password"
                            autoFocus
                          />
                          <input
                            className="sync-settings-input"
                            value={encryptionPassphraseConfirmDraft}
                            onChange={(event) => setEncryptionPassphraseConfirmDraft(event.target.value)}
                            placeholder={t("settings.vaultEncryptionConfirmPassphrase")}
                            type="password"
                          />
                        </>
                      ) : null}

                      {isLocked ? (
                        <input
                          className="sync-settings-input"
                          value={encryptionPassphraseDraft}
                          onChange={(event) => setEncryptionPassphraseDraft(event.target.value)}
                          placeholder={t("settings.vaultEncryptionPassphrase")}
                          type="password"
                          autoFocus
                        />
                      ) : null}

                      {isReady && modalView === "changePassphrase" ? (
                        <>
                          {needsCurrentPassphrase ? (
                            <input
                              className="sync-settings-input"
                              value={encryptionPassphraseDraft}
                              onChange={(event) => setEncryptionPassphraseDraft(event.target.value)}
                              placeholder={t("settings.vaultEncryptionCurrentPassphrase")}
                              type="password"
                              autoFocus
                            />
                          ) : null}
                          <input
                            className="sync-settings-input"
                            value={encryptionNextPassphraseDraft}
                            onChange={(event) => setEncryptionNextPassphraseDraft(event.target.value)}
                            placeholder={t("settings.vaultEncryptionNewPassphrase")}
                            type="password"
                            autoFocus={!needsCurrentPassphrase}
                          />
                          <input
                            className="sync-settings-input"
                            value={encryptionNextPassphraseConfirmDraft}
                            onChange={(event) =>
                              setEncryptionNextPassphraseConfirmDraft(event.target.value)
                            }
                            placeholder={t("settings.vaultEncryptionConfirmNewPassphrase")}
                            type="password"
                          />
                        </>
                      ) : null}

                      {isReady && modalView === "disable" ? (
                        <>
                          {needsCurrentPassphrase ? (
                            <input
                              className="sync-settings-input"
                              value={encryptionPassphraseDraft}
                              onChange={(event) => setEncryptionPassphraseDraft(event.target.value)}
                              placeholder={t("settings.vaultEncryptionCurrentPassphrase")}
                              type="password"
                              autoFocus
                            />
                          ) : null}
                          <div className="sync-settings-confirm-detail">
                            {t("settings.vaultEncryptionDisableConfirm")}
                          </div>
                        </>
                      ) : null}

                      <div className="sync-settings-modal-actions">
                        {isReady && modalView !== "default" ? (
                          <button
                            type="button"
                            className="sync-settings-inline-action"
                            onClick={() =>
                              setPanelModal((current) =>
                                current && current.kind === "vaultEncryption"
                                  ? {
                                      ...current,
                                      view: "default"
                                    }
                                  : current
                              )
                            }
                          >
                            {t("settings.back")}
                          </button>
                        ) : (
                          <button type="button" className="sync-settings-inline-action" onClick={closeModal}>
                            {t("dialog.cancel")}
                          </button>
                        )}
                        {isReady && modalView === "default" ? (
                          <>
                            <button
                              type="button"
                              className="sync-settings-inline-action"
                              onClick={() =>
                                setPanelModal((current) =>
                                  current && current.kind === "vaultEncryption"
                                    ? {
                                        ...current,
                                        view: "changePassphrase"
                                      }
                                    : current
                                )
                              }
                            >
                              {t("settings.vaultEncryptionChangePassphrase")}
                            </button>
                            <button
                              type="button"
                              className="sync-settings-primary-action"
                              disabled={busyKey === lockBusyKey}
                              onClick={() => {
                                void handleLockCurrentVaultSession(panelModal.vault);
                              }}
                            >
                              {busyKey === lockBusyKey
                                ? t("sync.syncing")
                                : t("settings.vaultEncryptionLockDevice")}
                            </button>
                          </>
                        ) : isReady && modalView === "changePassphrase" ? (
                          <button
                            type="button"
                            className="sync-settings-primary-action"
                            disabled={busyKey === changeBusyKey}
                            onClick={() => {
                              void handleChangeVaultEncryptionPassphraseSubmit();
                            }}
                          >
                            {busyKey === changeBusyKey
                              ? t("sync.syncing")
                              : t("settings.vaultEncryptionChangePassphrase")}
                          </button>
                        ) : isReady && modalView === "disable" ? (
                          <button
                            type="button"
                            className="sync-settings-primary-action is-danger"
                            disabled={busyKey === disableBusyKey}
                            onClick={() => {
                              void handleDisableVaultEncryptionSubmit();
                            }}
                          >
                            {busyKey === disableBusyKey
                              ? t("sync.syncing")
                              : t("settings.vaultEncryptionDisable")}
                          </button>
                        ) : summary.state === "ready" ? (
                          <button
                            type="button"
                            className="sync-settings-primary-action"
                            disabled={busyKey === lockBusyKey}
                            onClick={() => {
                              void handleLockCurrentVaultSession(panelModal.vault);
                            }}
                          >
                            {busyKey === lockBusyKey
                              ? t("sync.syncing")
                              : t("settings.vaultEncryptionLockDevice")}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="sync-settings-primary-action"
                            disabled={busyKey === submitBusyKey}
                            onClick={() => {
                              void handleVaultEncryptionSubmit();
                            }}
                          >
                            {busyKey === submitBusyKey
                              ? t("sync.syncing")
                              : isEnabling
                                ? t("settings.enableVaultEncryption")
                                : t("settings.unlockVaultEncryption")}
                          </button>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
            ) : null}

            {panelModal.kind === "addConnection" ? (
              <div className="sync-settings-modal-body">
                <p className="sync-settings-modal-copy">{t("settings.connectionCatalogDescription")}</p>
                <div className="sync-settings-provider-grid">
                  <button
                    type="button"
                    className="sync-settings-provider-card"
                    onClick={() => openSelfHostedConnectionModal()}
                  >
                    <span className="sync-settings-provider-icon" style={{ "--item-color": providerAccent("selfHosted") } as CSSProperties}>
                      <SelfHostedGlyph />
                    </span>
                    <div className="sync-settings-provider-copy">
                      <strong>{t("sync.selfHosted")}</strong>
                      <span>{t("settings.selfHostedConnectionDescription")}</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    className={`sync-settings-provider-card ${!googleDriveConfigured ? "is-disabled" : ""}`}
                    onClick={() => {
                      setPanelModal({ kind: "addGoogleDrive" });
                    }}
                  >
                    <span className="sync-settings-provider-icon" style={{ "--item-color": providerAccent("googleDrive") } as CSSProperties}>
                      <GoogleGlyph />
                    </span>
                    <div className="sync-settings-provider-copy">
                      <strong>{t("sync.googleDrive")}</strong>
                      <span>
                        {googleDriveConfigured
                          ? t("settings.googleDriveConnectionDescription")
                          : t("settings.googleDriveClientMissing")}
                      </span>
                    </div>
                    <span className={`sync-settings-chip ${googleDriveConfigured ? "is-ready" : "is-neutral"}`}>
                      {googleDriveConfigured ? t("sync.ready") : t("sync.planned")}
                    </span>
                  </button>
                </div>
              </div>
            ) : null}

            {panelModal.kind === "addSelfHosted" ? (
              <SelfHostedConnectionWizard
                connection={selfHostedEditingConnection}
                deviceName={getHostedDeviceIdentity(settings.localDeviceId).deviceName}
                platform={getHostedDeviceIdentity(settings.localDeviceId).clientPlatform}
                initialConnectionPackage={incomingSelfHostedPackage}
                translateError={(message) => translateSyncManagerError(message, t)}
                onConnected={handleSelfHostedConnected}
                onCancel={closeModal}
              />
            ) : null}

            {panelModal.kind === "manageSelfHosted" ? (
              <SelfHostedAccessManager
                connection={panelModal.connection}
                remoteVaults={remoteVaultsByConnectionId[panelModal.connection.id] ?? []}
                translateError={(message) => translateSyncManagerError(message, t)}
              />
            ) : null}

            {panelModal.kind === "editSelfHostedEndpoint" ? (
              <SelfHostedEndpointEditor
                connection={panelModal.connection}
                initialServerUrl={panelModal.initialServerUrl}
                translateError={(message) => translateSyncManagerError(message, t)}
                onUpdated={(result) =>
                  handleSelfHostedEndpointUpdated(panelModal.connection, result)
                }
                onCancel={closeModal}
              />
            ) : null}

            {panelModal.kind === "hostedWizard" ? (
              <CloudConnectionWizard
                connection={panelModal.connection ?? null}
                localVaults={sortedVaults}
                selectedLocalVaultId={selectedLocalVaultId}
                activeLocalVaultId={activeLocalVaultId}
                defaultServerUrl={panelModal.connection?.serverUrl ?? hostedUrlDraft}
                getVaultLabel={getVaultLabel}
                translateError={(message) => translateSyncManagerError(message, t)}
                onAuthenticate={handleCloudWizardAuthenticate}
                onStartDeviceLogin={handleCloudWizardStartDeviceLogin}
                onPollDeviceLogin={handleCloudWizardPollDeviceLogin}
                onUploadCurrentVault={handleCloudWizardUploadVault}
                onCreateHostedVault={handleCloudWizardCreateVault}
                onConnectRemoteVault={handleCloudWizardConnectRemoteVault}
                onRefreshOverview={loadHostedOverviewForWizard}
                onClose={closeModal}
              />
            ) : null}

            {panelModal.kind === "addHosted" ? (
              <div className="sync-settings-modal-body">
                <p className="sync-settings-modal-copy">
                  {panelModal.connection
                    ? t("settings.hostedReconnectDescription")
                    : t("settings.hostedModalDescription")}
                </p>
                {!panelModal.connection ? (
                  <div className="sync-settings-mode-switch">
                    <button
                      type="button"
                      className={hostedMode === "login" ? "is-active" : ""}
                      onClick={() => {
                        setHostedMode("login");
                        setHostedDraftError(null);
                      }}
                    >
                      {t("sync.hostedLogin")}
                    </button>
                    <button
                      type="button"
                      className={hostedMode === "register" ? "is-active" : ""}
                      onClick={() => {
                        setHostedMode("register");
                        setHostedDraftError(null);
                      }}
                    >
                      {t("sync.hostedRegister")}
                    </button>
                  </div>
                ) : null}
                <input
                  className="sync-settings-input"
                  value={hostedUrlDraft}
                  onChange={(event) => {
                    setHostedUrlDraft(event.target.value);
                    setHostedDraftError(null);
                  }}
                  placeholder={t("sync.endpointPlaceholder")}
                  autoFocus
                />
                {hostedMode === "register" && !panelModal.connection ? (
                  <input
                    className="sync-settings-input"
                    value={hostedNameDraft}
                    onChange={(event) => {
                      setHostedNameDraft(event.target.value);
                      setHostedDraftError(null);
                    }}
                    placeholder={t("sync.hostedNamePlaceholder")}
                  />
                ) : null}
                <input
                  className="sync-settings-input"
                  value={hostedEmailDraft}
                  onChange={(event) => {
                    setHostedEmailDraft(event.target.value);
                    setHostedDraftError(null);
                  }}
                  placeholder={t("sync.hostedEmailPlaceholder")}
                  type="email"
                />
                <input
                  className="sync-settings-input"
                  value={hostedPasswordDraft}
                  onChange={(event) => {
                    setHostedPasswordDraft(event.target.value);
                    setHostedDraftError(null);
                  }}
                  placeholder={t("sync.hostedPasswordPlaceholder")}
                  type="password"
                />
                {hostedDraftError ? (
                  <div className="sync-settings-modal-error" role="alert">
                    {hostedDraftError}
                  </div>
                ) : null}
                <div className="sync-settings-modal-actions">
                  <button type="button" className="sync-settings-inline-action" onClick={closeModal}>
                    {t("dialog.cancel")}
                  </button>
                  <button
                    type="button"
                    className="sync-settings-primary-action"
                    disabled={busyKey === "add-hosted"}
                    onClick={() => void handleAddHostedConnection()}
                  >
                    {busyKey === "add-hosted"
                      ? t("sync.syncing")
                      : panelModal.connection
                        ? t("settings.hostedReconnectSave")
                        : hostedMode === "register"
                          ? t("sync.hostedRegister")
                          : t("sync.hostedLogin")}
                  </button>
                </div>
              </div>
            ) : null}

            {panelModal.kind === "addGoogleDrive" ? (
              <div className="sync-settings-modal-body">
                <p className="sync-settings-modal-copy">
                  {googleDriveConfigured
                    ? t("settings.googleDriveModalDescription")
                    : t("settings.googleDriveClientMissing")}
                </p>
                {!googleDriveConfigured ? (
                  <div className="sync-settings-note-shell">
                    <span className="sync-settings-note-chip">ENV</span>
                    <span className="sync-settings-note-copy">
                      {t("sync.googleDriveClientIdRequired")}
                    </span>
                    <code className="sync-settings-code-pill">VITE_GOOGLE_DRIVE_CLIENT_ID=your-client-id.apps.googleusercontent.com</code>
                  </div>
                ) : null}
                <div className="sync-settings-note-shell">
                  <span className="sync-settings-note-chip">{t("settings.googleDriveAppFolder")}</span>
                  <span className="sync-settings-note-copy">{t("settings.googleDriveAppFolderDescription")}</span>
                </div>
                {googleDriveConfigured ? (
                  <div className="sync-settings-note-shell">
                    <span className="sync-settings-note-chip">SDK</span>
                    <span className="sync-settings-note-copy">
                      {googleDriveOAuthState === "ready"
                        ? t("settings.googleDriveSdkReady")
                        : googleDriveOAuthState === "error"
                          ? googleDriveOAuthError ?? t("sync.googleDriveSdkFailed")
                          : t("settings.googleDriveSdkLoading")}
                    </span>
                  </div>
                ) : null}
                <div className="sync-settings-modal-actions">
                  <button type="button" className="sync-settings-inline-action" onClick={closeModal}>
                    {t("dialog.cancel")}
                  </button>
                  <button
                    type="button"
                    className="sync-settings-primary-action"
                    disabled={
                      busyKey === "add-google-drive" ||
                      !googleDriveConfigured ||
                      googleDriveOAuthState !== "ready"
                    }
                    onClick={() => {
                      void handleAddGoogleDriveConnection();
                    }}
                  >
                    {busyKey === "add-google-drive"
                      ? t("sync.syncing")
                      : googleDriveOAuthState === "loading" || googleDriveOAuthState === "idle"
                        ? t("sync.googleDrivePreparing")
                        : t("settings.googleDriveConnect")}
                  </button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </SyncSettingsDialog>

      <ConfirmDialog
        open={Boolean(confirmState)}
        kicker={t("dialog.kicker")}
        title={confirmState?.title ?? ""}
        message={confirmState?.description ?? ""}
        details={confirmState?.details}
        cancelLabel={t("dialog.cancel")}
        confirmLabel={confirmState?.confirmLabel ?? ""}
        tone={confirmState?.tone ?? "default"}
        secondaryLabel={confirmState?.secondaryLabel}
        secondaryTone={confirmState?.secondaryTone ?? "default"}
        onCancel={closeModal}
        onSecondary={() => void confirmState?.secondaryAction?.()}
        onConfirm={() => void confirmState?.action()}
      />

      {visibleFeedback ? (
        <ActionFeedbackToast
          anchor={feedbackAnchor}
          tone={visibleFeedback.tone}
          dismissLabel={t("orbit.closeModal")}
          onDismiss={dismissFeedback}
        >
          {visibleFeedback.text}
        </ActionFeedbackToast>
      ) : null}
    </>
  );
}
