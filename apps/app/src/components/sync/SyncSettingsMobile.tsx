import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { formatDateTimeValue, useLocale, type LocaleRuntime } from "../../localization";

import type { LocalVaultProfile } from "../../lib/localVaults";
import { useAndroidBackHandler } from "../../lib/useAndroidBackHandler";
import type { RemoteVaultImportResult, SyncConnection, SyncRemoteVault, SyncVaultBinding, VaultEncryptionSummary } from "../../types";
import "./SyncSettingsMobile.css";

type ConnectionAvailabilityState = "checking" | "available" | "unavailable" | "authError";
type MobileTab = "vaults" | "connections";

function renderMobilePortal(content: ReactNode) {
  if (typeof document === "undefined") {
    return content;
  }

  return createPortal(content, document.body);
}

type SyncSettingsMobileProps = {
  online: boolean;
  localVaults: LocalVaultProfile[];
  activeLocalVaultId: string;
  selectedLocalVaultId: string;
  syncConnections: SyncConnection[];
  syncBindings: SyncVaultBinding[];
  bindingConnections: SyncConnection[];
  vaultBindings: SyncVaultBinding[];
  vaultEncryptionById: Record<string, VaultEncryptionSummary>;
  connectionAvailability: Record<string, ConnectionAvailabilityState>;
  selfHostedEndpointCandidates: Record<string, string>;
  remoteVaultsByConnectionId: Record<string, SyncRemoteVault[]>;
  remoteVaultErrors: Record<string, string | null>;
  remoteVaultLoading: Record<string, boolean>;
  pendingBindVaultId: string | null;
  bindingSheetVault: LocalVaultProfile | null;
  busyKey: string | null;
  getVaultLabel: (vault: Pick<LocalVaultProfile, "id" | "name"> | null | undefined) => string;
  getBindingErrorLabel: (errorCode: string | null) => string | null;
  onSelectLocalVault: (localVaultId: string) => void;
  onCreateVault: () => void;
  onRenameVault: (vault: LocalVaultProfile) => void;
  onDeleteLocalVault: (vault: LocalVaultProfile) => void;
  onStartVaultBinding: (vault: LocalVaultProfile) => void;
  onCancelVaultBinding: () => void;
  onConnectCloud: (connection?: SyncConnection | null) => void;
  onAddConnection: () => void;
  onAddConnectionFromBinding: () => void;
  onBindVaultToConnection: (vaultId: string, connectionId: string) => void | Promise<void>;
  onClearBinding: (localVaultId: string) => void | Promise<void>;
  onOpenVaultEncryption: (vault: LocalVaultProfile, view: "default" | "unlock") => void;
  onRefreshRemoteVaults: (connection: SyncConnection) => void | Promise<void>;
  onImportAllRemoteVaults: (connection: SyncConnection) => void | Promise<void>;
  onImportRemoteVault: (connection: SyncConnection, remoteVault: SyncRemoteVault) => Promise<void> | Promise<RemoteVaultImportResult> | void;
  onDeleteRemoteVault: (connection: SyncConnection, remoteVault: SyncRemoteVault) => void;
  onBindAllVaults: (connection: SyncConnection) => void;
  onDeleteConnection: (connectionId: string) => void | Promise<void>;
  onRevokeGoogleDriveConnection: (connectionId: string) => void | Promise<void>;
  onRepairConnection: (connection: SyncConnection) => void | Promise<void>;
  onEditSelfHostedEndpoint: (connection: SyncConnection, initialServerUrl?: string) => void;
  onManageSelfHostedAccess: (connection: SyncConnection) => void;
};

function MobileIconButton({
  children,
  label,
  className = "",
  disabled,
  onClick
}: {
  children: ReactNode;
  label: string;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`sync-mobile-icon-button ${className}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M5.4 5.4 14.6 14.6M14.6 5.4 5.4 14.6" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M10 4.2v11.6M4.2 10h11.6" />
    </svg>
  );
}

function EditGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="m5.1 14.9 2.8-.7 6.1-6.1-2.1-2.1-6.1 6.1-.7 2.8Z" />
      <path d="m10.8 5.4 2.1 2.1" className="sync-mobile-icon-accent" />
    </svg>
  );
}

function TrashGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M5.8 6.2h8.4" />
      <path d="M7.4 6.2v8.2c0 1 .6 1.6 1.6 1.6h2c1 0 1.6-.6 1.6-1.6V6.2" />
      <path d="M8.4 4.6h3.2" />
      <path d="M8.4 8.4v4.7M11.6 8.4v4.7" className="sync-mobile-icon-accent" />
    </svg>
  );
}

function VaultGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M3.7 6.2h12.6v8.7H3.7z" />
      <path d="M3.7 6.2 6.1 4.5h7.8l2.4 1.7" className="sync-mobile-icon-accent" />
      <path d="M7 9.1h6" className="sync-mobile-icon-accent" />
    </svg>
  );
}

function LinkGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M7.3 12.7 5.6 14.4a2.4 2.4 0 1 1-3.4-3.4L4 9.3" />
      <path d="M12.7 7.3 14.4 5.6A2.4 2.4 0 1 1 17.8 9l-1.8 1.7" />
      <path d="m6.8 13.2 6.4-6.4" className="sync-mobile-icon-accent" />
    </svg>
  );
}

function LockGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M6.2 8V6.7a3.8 3.8 0 1 1 7.6 0V8M5 8.1h10v7.6H5z" />
      <path d="M10 10.3v2.5" className="sync-mobile-icon-accent" />
    </svg>
  );
}

function HostedGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="6.4" />
      <path d="M10 3.6v12.8M3.6 10h12.8" className="sync-mobile-icon-accent" />
      <path d="M5.9 5.9c1.7 1.2 4.6 1.9 8.2 0M5.9 14.1c1.7-1.2 4.6-1.9 8.2 0" className="sync-mobile-icon-accent" />
    </svg>
  );
}

function SelfHostedGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="3.4" y="4.4" width="13.2" height="4.2" rx="1.4" />
      <rect x="3.4" y="11.4" width="13.2" height="4.2" rx="1.4" />
      <path d="M6.2 6.5h1.8M6.2 13.5h1.8" className="sync-mobile-icon-accent" />
    </svg>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M16.2 10a6.2 6.2 0 1 1-1.8-4.4" />
      <path d="M16.2 10H10" className="sync-mobile-icon-accent" />
      <path d="M13.4 7.2h2.8V10" className="sync-mobile-icon-accent" />
    </svg>
  );
}

function CatalogGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="3.4" y="4.4" width="13.2" height="11.2" rx="2.2" />
      <path d="M6.2 7.1h5.4M6.2 10h4.2M6.2 12.9h3.2" />
      <path d="M13.2 10.8a2.6 2.6 0 1 1-.8 1.8" className="sync-mobile-icon-accent" />
      <path d="M12.4 10.6h2.4v2.2" className="sync-mobile-icon-accent" />
    </svg>
  );
}

function ProviderIcon({ provider }: { provider: SyncConnection["provider"] }) {
  if (provider === "hosted") {
    return <HostedGlyph />;
  }

  if (provider === "googleDrive") {
    return <GoogleGlyph />;
  }

  return <SelfHostedGlyph />;
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

export default function SyncSettingsMobile({
  online,
  localVaults,
  activeLocalVaultId,
  selectedLocalVaultId,
  syncConnections,
  syncBindings,
  bindingConnections,
  vaultBindings,
  vaultEncryptionById,
  connectionAvailability,
  selfHostedEndpointCandidates,
  remoteVaultsByConnectionId,
  remoteVaultErrors,
  remoteVaultLoading,
  pendingBindVaultId,
  bindingSheetVault,
  busyKey,
  getVaultLabel,
  getBindingErrorLabel,
  onSelectLocalVault,
  onCreateVault,
  onRenameVault,
  onDeleteLocalVault,
  onStartVaultBinding,
  onCancelVaultBinding,
  onConnectCloud,
  onAddConnection,
  onAddConnectionFromBinding,
  onBindVaultToConnection,
  onClearBinding,
  onOpenVaultEncryption,
  onRefreshRemoteVaults,
  onImportAllRemoteVaults,
  onImportRemoteVault,
  onDeleteRemoteVault,
  onBindAllVaults,
  onDeleteConnection,
  onRevokeGoogleDriveConnection,
  onRepairConnection,
  onEditSelfHostedEndpoint,
  onManageSelfHostedAccess
}: SyncSettingsMobileProps) {
  const { t, i18n } = useTranslation();
  const { runtime: localeRuntime } = useLocale();
  const [activeTab, setActiveTab] = useState<MobileTab>("vaults");
  const [detailConnectionId, setDetailConnectionId] = useState<string | null>(null);
  const [isMobilePortrait, setIsMobilePortrait] = useState(false);

  const bindingsByVaultId = useMemo(
    () => new Map(vaultBindings.map((binding) => [binding.localVaultId, binding])),
    [vaultBindings]
  );
  const connectionsById = useMemo(
    () => new Map(syncConnections.map((connection) => [connection.id, connection])),
    [syncConnections]
  );
  const bindingConnectionsById = useMemo(
    () => new Map(bindingConnections.map((connection) => [connection.id, connection])),
    [bindingConnections]
  );
  const localVaultByGuid = useMemo(
    () => new Map(localVaults.map((vault) => [vault.vaultGuid, vault])),
    [localVaults]
  );
  const localVaultNameSet = useMemo(
    () => new Set(localVaults.map((vault) => vault.name.trim().toLowerCase())),
    [localVaults]
  );
  const boundVaultCountByConnectionId = useMemo(() => {
    const counts = new Map<string, number>();
    syncBindings.forEach((binding) => {
      counts.set(binding.connectionId, (counts.get(binding.connectionId) ?? 0) + 1);
    });
    return counts;
  }, [syncBindings]);
  const detailConnection = detailConnectionId ? connectionsById.get(detailConnectionId) ?? null : null;
  const hostedConnection = syncConnections.find((connection) => connection.provider === "hosted") ?? null;
  const mobileSheetOpen = isMobilePortrait && Boolean(bindingSheetVault || detailConnection);
  const closeTopMobileSheet = () => {
    if (bindingSheetVault) {
      onCancelVaultBinding();
      return;
    }

    setDetailConnectionId(null);
  };

  useEffect(() => {
    if (detailConnectionId && !connectionsById.has(detailConnectionId)) {
      setDetailConnectionId(null);
    }
  }, [connectionsById, detailConnectionId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const query = window.matchMedia(
      "(max-width: 1180px) and (orientation: portrait), (pointer: coarse) and (orientation: portrait)"
    );
    const updateMatches = () => setIsMobilePortrait(query.matches);

    updateMatches();
    query.addEventListener("change", updateMatches);

    return () => query.removeEventListener("change", updateMatches);
  }, []);

  useEffect(() => {
    if (!isMobilePortrait || (!bindingSheetVault && !detailConnection)) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeTopMobileSheet();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [bindingSheetVault, detailConnection, isMobilePortrait, onCancelVaultBinding]);

  useAndroidBackHandler(mobileSheetOpen, closeTopMobileSheet);

  const getAvailability = (connection: SyncConnection) =>
    online ? connectionAvailability[connection.id] ?? "checking" : "offline";
  const hostedAvailability = hostedConnection ? getAvailability(hostedConnection) : null;

  const getAvailabilityLabel = (availability: ReturnType<typeof getAvailability>) =>
    availability === "available"
      ? t("settings.connectionAvailable")
      : availability === "unavailable"
        ? t("settings.connectionUnavailable")
        : availability === "authError"
          ? t("settings.connectionAuthError")
          : availability === "offline"
            ? t("settings.connectionOffline")
            : t("settings.connectionChecking");

  const renderConnectionSubtitle = (connection: SyncConnection) =>
    connection.provider === "hosted"
      ? connection.userEmail || connection.serverUrl
      : connection.provider === "googleDrive"
        ? connection.userEmail || t("settings.googleDriveAppFolder")
        : connection.serverUrl;

  const renderConnectionMeta = (connection: SyncConnection) =>
    connection.provider === "hosted"
      ? connection.userName || t("sync.hostedAccountSignedOut")
      : connection.provider === "googleDrive"
        ? t("settings.googleDriveSessionReady")
        : connection.selfHostedRole === "guest"
          ? t("settings.selfHostedGuestDeviceAccess")
          : connection.selfHostedDeviceId
            ? t("settings.selfHostedTrustedDeviceAccess")
            : t("settings.selfHostedLegacyAccess");

  const renderRemoteVaultCard = (connection: SyncConnection, remoteVault: SyncRemoteVault) => {
    const matchingLocalVault = localVaultByGuid.get(remoteVault.id) ?? null;
    const matchingBinding = matchingLocalVault ? bindingsByVaultId.get(matchingLocalVault.id) ?? null : null;
    const matchingBindingConnection = matchingBinding
      ? bindingConnectionsById.get(matchingBinding.connectionId) ?? null
      : null;
    const isLocorisCloudManaged = matchingBindingConnection?.role === "locorisCloud";
    const isLinkedHere =
      matchingBinding?.connectionId === connection.id && matchingBinding.remoteVaultId === remoteVault.id;
    const hasNameCollision = !matchingLocalVault && localVaultNameSet.has(remoteVault.name.trim().toLowerCase());
    const actionKey = `import:${connection.id}:${remoteVault.id}`;
    const isActionBusy = busyKey === actionKey;

    return (
      <article key={remoteVault.id} className="sync-mobile-remote-card">
        <div className="sync-mobile-chip-row">
          <span className={`sync-mobile-chip ${remoteVault.vaultKind === "private" ? "is-private" : "is-neutral"}`}>
            {remoteVault.vaultKind === "private" ? t("settings.vaultKindPrivate") : t("settings.vaultKindRegular")}
          </span>
          {isLinkedHere ? <span className="sync-mobile-chip is-ready">{t("settings.remoteVaultLinkedHere")}</span> : null}
          {matchingLocalVault && !isLinkedHere ? (
            <span className="sync-mobile-chip is-info">{t("settings.remoteVaultOnDevice")}</span>
          ) : null}
          {isLocorisCloudManaged ? (
            <span className="sync-mobile-chip is-cloud">{t("settings.accountCloudConnected")}</span>
          ) : null}
          {hasNameCollision ? (
            <span className="sync-mobile-chip is-count">{t("settings.remoteVaultNameCollision")}</span>
          ) : null}
        </div>

        <div className="sync-mobile-remote-title">
          <span className="sync-mobile-item-icon" style={{ "--sync-mobile-item": providerAccent(connection.provider) } as CSSProperties}>
            <VaultGlyph />
          </span>
          <strong>{remoteVault.name}</strong>
        </div>
        <span className="sync-mobile-muted">{t("settings.remoteVaultIdLabel", { id: remoteVault.id })}</span>
        <span className="sync-mobile-muted">
          {t("settings.remoteVaultUpdatedAt", {
            time: formatTime(remoteVault.lastSyncAt ?? remoteVault.updatedAt, localeRuntime)
          })}
        </span>
        {matchingLocalVault ? (
          <span className="sync-mobile-muted">
            {t("settings.remoteVaultLocalMatch", {
              vault: matchingLocalVault.name
            })}
          </span>
        ) : hasNameCollision ? (
          <span className="sync-mobile-muted">{t("settings.remoteVaultWillAlias")}</span>
        ) : null}

        <div className="sync-mobile-remote-actions">
          {!isLinkedHere && !isLocorisCloudManaged ? (
            <button
              type="button"
              className="sync-mobile-secondary-action"
              disabled={isActionBusy || busyKey !== null}
              onClick={() => {
                void onImportRemoteVault(connection, remoteVault);
              }}
            >
              {matchingLocalVault ? t("settings.remoteImportLinkLocal") : t("settings.remoteImportAction")}
            </button>
          ) : null}
          <MobileIconButton
            label={t("settings.remoteDeleteAction")}
            className="is-danger"
            disabled={busyKey !== null}
            onClick={() => onDeleteRemoteVault(connection, remoteVault)}
          >
            <TrashGlyph />
          </MobileIconButton>
        </div>
      </article>
    );
  };

  const renderVaults = () => (
    <div className="sync-mobile-list">
      {localVaults.map((vault) => {
        const binding = bindingsByVaultId.get(vault.id) ?? null;
        const bindingConnection = binding
          ? bindingConnectionsById.get(binding.connectionId) ?? null
          : null;
        const isLocorisCloudManaged = bindingConnection?.role === "locorisCloud";
        const encryption =
          vaultEncryptionById[vault.id] ?? {
            enabled: false,
            state: "disabled" as const,
            keyId: null,
            updatedAt: null
          };
        const privateEncryptionVisible = vault.vaultKind === "private" && encryption.state !== "disabled";
        const needsUnlock =
          (binding?.lastError === "VAULT_ENCRYPTION_LOCKED" || encryption.state === "locked") && encryption.enabled;
        const needsGoogleDriveSignIn = Boolean(
          binding &&
            bindingConnection?.provider === "googleDrive" &&
            ["GOOGLE_DRIVE_AUTH_REQUIRED", "GOOGLE_DRIVE_INTERACTION_REQUIRED"].includes(
              binding.lastError ?? ""
            )
        );
        const isSelected = selectedLocalVaultId === vault.id;
        const isActive = activeLocalVaultId === vault.id;
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
            className={`sync-mobile-card sync-mobile-vault-card ${isSelected ? "is-selected" : ""} ${
              pendingBindVaultId === vault.id ? "is-binding" : ""
            }`}
            onClick={() => onSelectLocalVault(vault.id)}
          >
            <div className="sync-mobile-chip-row">
              {isActive ? <span className="sync-mobile-chip is-accent">{t("sync.localVaultActive")}</span> : null}
              <span className={`sync-mobile-chip ${vault.vaultKind === "private" ? "is-private" : "is-neutral"}`}>
                {vault.vaultKind === "private" ? t("settings.vaultKindPrivate") : t("settings.vaultKindRegular")}
              </span>
              {privateEncryptionVisible ? (
                <span className={`sync-mobile-chip ${encryption.state === "ready" ? "is-encrypted-ready" : "is-encrypted-locked"}`}>
                  {encryption.state === "ready" ? t("settings.vaultEncryptionReady") : t("settings.vaultEncryptionLocked")}
                </span>
              ) : null}
              {isLocorisCloudManaged ? (
                <span className="sync-mobile-chip is-cloud">
                  {t("settings.accountCloudConnected")}
                </span>
              ) : null}
              <span
                className={`sync-mobile-chip ${
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

            <div className="sync-mobile-card-main">
              <span
                className="sync-mobile-item-icon"
                style={{ "--sync-mobile-item": bindingConnection ? providerAccent(bindingConnection.provider) : "#e7d6a2" } as CSSProperties}
              >
                <VaultGlyph />
              </span>
              <div className="sync-mobile-card-copy">
                <strong>{getVaultLabel(vault)}</strong>
                <span>
                  {bindingConnection
                    ? t("settings.boundToConnection", {
                        connection: bindingConnection.label
                      })
                    : t("sync.localVaultUnbound")}
                </span>
                {binding ? (
                  <small>{`${binding.remoteVaultName} · ${formatTime(binding.lastSyncAt, localeRuntime)}`}</small>
                ) : null}
                {binding?.lastError && binding.lastError !== "VAULT_ENCRYPTION_LOCKED" ? (
                  <small className="sync-mobile-binding-error" role="status">
                    {getBindingErrorLabel(binding.lastError)}
                  </small>
                ) : null}
              </div>
            </div>

            <div className="sync-mobile-action-row">
              {needsGoogleDriveSignIn && bindingConnection ? (
                <button
                  type="button"
                  className="sync-mobile-primary-action"
                  disabled={busyKey !== null}
                  onClick={(event) => {
                    event.stopPropagation();
                    void onRepairConnection(bindingConnection);
                  }}
                >
                  {t("settings.googleDriveReconnect")}
                </button>
              ) : null}
              {privateEncryptionVisible ? (
                <button
                  type="button"
                  className="sync-mobile-secondary-action is-icon-text"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenVaultEncryption(vault, encryption.state === "locked" ? "unlock" : "default");
                  }}
                >
                  <LockGlyph />
                  <span>
                    {encryption.state === "locked"
                      ? t("settings.unlockVaultEncryption")
                      : t("settings.manageVaultEncryption")}
                  </span>
                </button>
              ) : null}
              {!isLocorisCloudManaged ? (
                <>
                  <button
                    type="button"
                    className={`sync-mobile-primary-action ${binding ? "is-change" : ""}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onStartVaultBinding(vault);
                    }}
                  >
                    {binding ? t("settings.changeBindingAction") : t("settings.bindVaultAction")}
                  </button>
                  {binding ? (
                    <button
                      type="button"
                      className="sync-mobile-secondary-action is-danger-soft"
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
              <MobileIconButton
                label={t("sync.localVaultRename")}
                onClick={() => onRenameVault(vault)}
              >
                <EditGlyph />
              </MobileIconButton>
              <MobileIconButton
                label={t("sync.localVaultDelete")}
                className="is-danger"
                onClick={() => onDeleteLocalVault(vault)}
              >
                <TrashGlyph />
              </MobileIconButton>
            </div>
          </article>
        );
      })}
    </div>
  );

  const renderConnections = () => (
    <div className="sync-mobile-list">
      {syncConnections.length === 0 ? (
        <div className="sync-mobile-empty">
          <span className="sync-mobile-empty-icon">
            <LinkGlyph />
          </span>
          <strong>{t("settings.noConnectionsTitle")}</strong>
          <span>{t("settings.noConnectionsDescription")}</span>
          <button type="button" className="sync-mobile-primary-action" onClick={onAddConnection}>
            {t("settings.addConnection")}
          </button>
        </div>
      ) : (
        syncConnections.map((connection) => {
          const availability = getAvailability(connection);
          const boundCount = boundVaultCountByConnectionId.get(connection.id) ?? 0;
          const remoteCount = remoteVaultsByConnectionId[connection.id]?.length ?? 0;
          const isLoading = remoteVaultLoading[connection.id] ?? false;

          return (
            <article
              key={connection.id}
              className="sync-mobile-card sync-mobile-connection-card"
              style={{ "--sync-mobile-item": providerAccent(connection.provider) } as CSSProperties}
              onClick={() => setDetailConnectionId(connection.id)}
            >
              <div className="sync-mobile-chip-row">
                <span
                  className={`sync-mobile-chip ${
                    connection.provider === "hosted"
                      ? "is-hosted"
                      : connection.provider === "googleDrive"
                        ? "is-google-drive"
                        : "is-self-hosted"
                  }`}
                >
                  {connection.provider === "hosted"
                    ? t("sync.hosted")
                    : connection.provider === "googleDrive"
                      ? t("sync.googleDrive")
                      : t("sync.selfHosted")}
                </span>
                <span className={`sync-mobile-chip is-${availability}`}>{getAvailabilityLabel(availability)}</span>
              </div>

              <div className="sync-mobile-card-main">
                <span className="sync-mobile-item-icon">
                  <ProviderIcon provider={connection.provider} />
                </span>
                <div className="sync-mobile-card-copy">
                  <strong>{connection.label}</strong>
                  <span>{renderConnectionSubtitle(connection)}</span>
                  <small>{renderConnectionMeta(connection)}</small>
                </div>
              </div>

              <div className="sync-mobile-metrics">
                <span>{t("settings.linkedVaultCount", { count: boundCount })}</span>
                <span>{t("settings.remoteVaultCount", { count: remoteCount })}</span>
              </div>

              <div className="sync-mobile-action-row">
                {connection.provider === "googleDrive" && availability === "authError" ? (
                  <button
                    type="button"
                    className="sync-mobile-primary-action"
                    disabled={busyKey !== null}
                    onClick={(event) => {
                      event.stopPropagation();
                      void onRepairConnection(connection);
                    }}
                  >
                    {t("settings.googleDriveReconnect")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="sync-mobile-primary-action"
                  onClick={(event) => {
                    event.stopPropagation();
                    setDetailConnectionId(connection.id);
                  }}
                >
                  {t("settings.mobileConnectionDetails")}
                </button>
                <button
                  type="button"
                  className="sync-mobile-secondary-action is-icon-text"
                  disabled={busyKey !== null || isLoading}
                  onClick={(event) => {
                    event.stopPropagation();
                    void onRefreshRemoteVaults(connection);
                  }}
                >
                  <CatalogGlyph />
                  <span>{t("settings.remoteVaultRefreshShort")}</span>
                </button>
              </div>
            </article>
          );
        })
      )}
    </div>
  );

  const renderBindingSheet = () => {
    if (!isMobilePortrait || !bindingSheetVault) {
      return null;
    }

    return renderMobilePortal(
      <div className="sync-mobile-sheet-layer" role="dialog" aria-modal="true">
        <button type="button" className="sync-mobile-sheet-dim" aria-label={t("orbit.closeModal")} onClick={onCancelVaultBinding} />
        <section className="sync-mobile-sheet is-binding">
          <div className="sync-mobile-sheet-grabber" aria-hidden="true" />
          <header className="sync-mobile-sheet-head">
            <div>
              <span className="sync-mobile-kicker">{t("settings.bindingSheetKicker")}</span>
              <h3>{t("settings.bindingSheetTitle", { vault: getVaultLabel(bindingSheetVault) })}</h3>
              <p>
                {syncConnections.length === 0
                  ? t("settings.bindingSheetEmptyDescription")
                  : t("settings.bindingSheetDescription")}
              </p>
            </div>
            <MobileIconButton label={t("orbit.closeModal")} onClick={onCancelVaultBinding}>
              <CloseGlyph />
            </MobileIconButton>
          </header>

          {syncConnections.length === 0 ? (
            <div className="sync-mobile-empty is-sheet-empty">
              <span className="sync-mobile-empty-icon">
                <LinkGlyph />
              </span>
              <strong>{t("settings.noConnectionsTitle")}</strong>
              <span>{t("settings.bindingNeedsConnectionDescription", { vault: getVaultLabel(bindingSheetVault) })}</span>
              <button type="button" className="sync-mobile-primary-action" onClick={onAddConnectionFromBinding}>
                {t("settings.addConnection")}
              </button>
            </div>
          ) : (
            <div className="sync-mobile-sheet-list">
              {syncConnections.map((connection) => {
                const availability = getAvailability(connection);
                const boundCount = boundVaultCountByConnectionId.get(connection.id) ?? 0;

                return (
                  <button
                    type="button"
                    key={connection.id}
                    className="sync-mobile-binding-option"
                    style={{ "--sync-mobile-item": providerAccent(connection.provider) } as CSSProperties}
                    disabled={busyKey !== null}
                    onClick={() => {
                      void onBindVaultToConnection(bindingSheetVault.id, connection.id);
                    }}
                  >
                    <span className="sync-mobile-item-icon">
                      <ProviderIcon provider={connection.provider} />
                    </span>
                    <span className="sync-mobile-binding-copy">
                      <strong>{connection.label}</strong>
                      <span>{renderConnectionSubtitle(connection)}</span>
                    </span>
                    <span className="sync-mobile-binding-meta">
                      <span>{getAvailabilityLabel(availability)}</span>
                      <span>{t("settings.linkedVaultCount", { count: boundCount })}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <footer className="sync-mobile-sheet-actions">
            {syncConnections.length > 0 ? (
              <button type="button" className="sync-mobile-secondary-action" onClick={onAddConnectionFromBinding}>
                {t("settings.addConnection")}
              </button>
            ) : null}
            <button type="button" className="sync-mobile-secondary-action" onClick={onCancelVaultBinding}>
              {t("settings.cancelBindingAction")}
            </button>
          </footer>
        </section>
      </div>
    );
  };

  const renderConnectionDetailSheet = () => {
    if (!isMobilePortrait || !detailConnection) {
      return null;
    }

    const availability = getAvailability(detailConnection);
    const remoteVaults = remoteVaultsByConnectionId[detailConnection.id] ?? [];
    const remoteError = remoteVaultErrors[detailConnection.id] ?? null;
    const isRemoteLoading = remoteVaultLoading[detailConnection.id] ?? false;
    const boundVaults = syncBindings
      .filter((binding) => binding.connectionId === detailConnection.id)
      .map((binding) => ({
        binding,
        vault: localVaults.find((vault) => vault.id === binding.localVaultId) ?? null
      }));
    const canRepair =
      (detailConnection.provider === "selfHosted" ||
        detailConnection.provider === "hosted" ||
        detailConnection.provider === "googleDrive") &&
      availability === "authError";
    const endpointCandidate = selfHostedEndpointCandidates[detailConnection.id] ?? null;

    return renderMobilePortal(
      <div className="sync-mobile-sheet-layer" role="dialog" aria-modal="true">
        <button
          type="button"
          className="sync-mobile-sheet-dim"
          aria-label={t("orbit.closeModal")}
          onClick={() => setDetailConnectionId(null)}
        />
        <section className="sync-mobile-sheet is-connection-detail">
          <div className="sync-mobile-sheet-grabber" aria-hidden="true" />
          <header className="sync-mobile-sheet-head">
            <div>
              <span className="sync-mobile-kicker">{t("settings.mobileConnectionSheetKicker")}</span>
              <h3>{detailConnection.label}</h3>
              <p>{renderConnectionSubtitle(detailConnection)}</p>
            </div>
            <MobileIconButton label={t("orbit.closeModal")} onClick={() => setDetailConnectionId(null)}>
              <CloseGlyph />
            </MobileIconButton>
          </header>

          <div className="sync-mobile-sheet-scroll">
            <div className="sync-mobile-detail-band">
              <div className="sync-mobile-detail-title">
                <span className="sync-mobile-item-icon" style={{ "--sync-mobile-item": providerAccent(detailConnection.provider) } as CSSProperties}>
                  <ProviderIcon provider={detailConnection.provider} />
                </span>
                <div>
                  <strong>{getAvailabilityLabel(availability)}</strong>
                  <span>{renderConnectionMeta(detailConnection)}</span>
                </div>
              </div>
              <div className="sync-mobile-metrics">
                <span>{t("settings.linkedVaultCount", { count: boundVaults.length })}</span>
                <span>{t("settings.remoteVaultCount", { count: remoteVaults.length })}</span>
              </div>
              <div className="sync-mobile-action-row">
                {detailConnection.provider === "selfHosted" ? (
                  <button
                    type="button"
                    className={`sync-mobile-secondary-action ${endpointCandidate ? "is-recovery" : ""}`}
                    disabled={busyKey !== null}
                    onClick={() => {
                      setDetailConnectionId(null);
                      onEditSelfHostedEndpoint(detailConnection, endpointCandidate ?? undefined);
                    }}
                  >
                    {endpointCandidate
                      ? t("settings.selfHostedEndpointFoundAction")
                      : t("settings.selfHostedEndpointAction")}
                  </button>
                ) : null}
                {detailConnection.provider === "selfHosted" && detailConnection.selfHostedRole !== "guest" ? (
                  <button
                    type="button"
                    className="sync-mobile-secondary-action"
                    disabled={busyKey !== null || availability !== "available"}
                    onClick={() => onManageSelfHostedAccess(detailConnection)}
                  >
                    {t("settings.selfHostedManageAccess")}
                  </button>
                ) : null}
                {canRepair ? (
                  <button type="button" className="sync-mobile-primary-action" disabled={busyKey !== null} onClick={() => void onRepairConnection(detailConnection)}>
                    {detailConnection.provider === "googleDrive"
                      ? t("settings.googleDriveReconnect")
                      : detailConnection.provider === "hosted"
                        ? t("settings.hostedReconnect")
                      : t("settings.selfHostedReconnect")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="sync-mobile-secondary-action is-icon-text"
                  disabled={busyKey !== null || isRemoteLoading}
                  onClick={() => void onRefreshRemoteVaults(detailConnection)}
                >
                  <CatalogGlyph />
                  <span>{t("settings.remoteVaultRefreshShort")}</span>
                </button>
                <button
                  type="button"
                  className="sync-mobile-secondary-action"
                  disabled={busyKey !== null}
                  onClick={() => onBindAllVaults(detailConnection)}
                >
                  {t("settings.bindAllVaults")}
                </button>
              </div>
            </div>

            <section className="sync-mobile-detail-section">
              <div className="sync-mobile-section-head">
                <strong>{t("settings.mobileBoundVaultsTitle")}</strong>
                <span>{boundVaults.length}</span>
              </div>
              {boundVaults.length > 0 ? (
                <div className="sync-mobile-compact-list">
                  {boundVaults.map(({ binding, vault }) => (
                    <button
                      type="button"
                      key={binding.localVaultId}
                      className="sync-mobile-compact-row"
                      onClick={() => {
                        onSelectLocalVault(binding.localVaultId);
                        setActiveTab("vaults");
                        setDetailConnectionId(null);
                      }}
                    >
                      <span className="sync-mobile-item-icon">
                        <VaultGlyph />
                      </span>
                      <span>
                        <strong>{vault ? getVaultLabel(vault) : binding.localVaultId}</strong>
                        <small>{`${binding.remoteVaultName} · ${formatTime(binding.lastSyncAt, localeRuntime)}`}</small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="sync-mobile-quiet-empty">{t("settings.mobileNoBoundVaults")}</div>
              )}
            </section>

            <section className="sync-mobile-detail-section">
              <div className="sync-mobile-section-head">
                <strong>{t("settings.remoteVaultsTitle")}</strong>
                <span>{isRemoteLoading ? t("settings.remoteVaultLoading") : remoteVaults.length}</span>
              </div>
              <button
                type="button"
                className="sync-mobile-secondary-action sync-mobile-wide-action"
                disabled={busyKey !== null || isRemoteLoading || remoteVaults.length === 0}
                onClick={() => void onImportAllRemoteVaults(detailConnection)}
              >
                {t("settings.remoteImportAll")}
              </button>
              {remoteError ? (
                <div className="sync-mobile-empty is-error">
                  <strong>{t("settings.remoteVaultLoadFailed")}</strong>
                  <span>{remoteError}</span>
                  {canRepair ? (
                    <button type="button" className="sync-mobile-secondary-action" disabled={busyKey !== null} onClick={() => void onRepairConnection(detailConnection)}>
                      {detailConnection.provider === "googleDrive"
                        ? t("settings.googleDriveReconnect")
                        : detailConnection.provider === "hosted"
                          ? t("settings.hostedReconnect")
                        : t("settings.selfHostedReconnect")}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {!remoteError && remoteVaults.length === 0 && !isRemoteLoading ? (
                <div className="sync-mobile-quiet-empty">{t("sync.remoteVaultEmpty")}</div>
              ) : null}
              {remoteVaults.length > 0 ? (
                <div className="sync-mobile-remote-list">
                  {remoteVaults.map((remoteVault) => renderRemoteVaultCard(detailConnection, remoteVault))}
                </div>
              ) : null}
            </section>
          </div>

          <footer className="sync-mobile-sheet-actions">
            {detailConnection.provider === "googleDrive" ? (
              <button
                type="button"
                className="sync-mobile-secondary-action"
                disabled={busyKey !== null}
                onClick={() => void onRevokeGoogleDriveConnection(detailConnection.id)}
              >
                {t("sync.googleDriveRevoke")}
              </button>
            ) : null}
            <button
              type="button"
              className="sync-mobile-secondary-action is-danger-soft"
              disabled={busyKey !== null}
              onClick={() => {
                void onDeleteConnection(detailConnection.id);
                setDetailConnectionId(null);
              }}
            >
              {t("sync.connectionDelete")}
            </button>
            <button type="button" className="sync-mobile-secondary-action" onClick={() => setDetailConnectionId(null)}>
              {t("dialog.cancel")}
            </button>
          </footer>
        </section>
      </div>
    );
  };

  return (
    <section className="sync-settings-mobile-panel">
      {hostedConnection ? (
        <button
          type="button"
          className="sync-mobile-cloud-cta is-connected"
          onClick={() => onConnectCloud(hostedConnection)}
        >
          <span className="sync-mobile-cloud-icon">
            <HostedGlyph />
          </span>
          <span className="sync-mobile-cloud-copy">
            <strong>{t("settings.legacyHostedConnectionTitle")}</strong>
            <small>
              {`${hostedConnection.userEmail || hostedConnection.label} · ${
                hostedAvailability ? getAvailabilityLabel(hostedAvailability) : t("settings.connectionChecking")
              }`}
            </small>
          </span>
          <span className="sync-mobile-cloud-action">
            {t("settings.cloudWizardManageAction")}
          </span>
        </button>
      ) : null}

      <nav className="sync-mobile-tabs" aria-label={t("settings.mobileSyncTabsLabel")}>
        <button
          type="button"
          className={activeTab === "vaults" ? "is-active" : ""}
          onClick={() => setActiveTab("vaults")}
        >
          <VaultGlyph />
          <span>{t("settings.vaultsTitle")}</span>
          <strong>{localVaults.length}</strong>
        </button>
        <button
          type="button"
          className={activeTab === "connections" ? "is-active" : ""}
          onClick={() => setActiveTab("connections")}
        >
          <LinkGlyph />
          <span>{t("settings.connectionsTitle")}</span>
          <strong>{syncConnections.length}</strong>
        </button>
      </nav>
      <main className="sync-mobile-content">
        <div className="sync-mobile-content-head">
          <div>
            <strong>{activeTab === "vaults" ? t("settings.vaultsTitle") : t("settings.connectionsTitle")}</strong>
            <span>{activeTab === "vaults" ? t("settings.mobileVaultsHint") : t("settings.mobileConnectionsHint")}</span>
          </div>
          <button
            type="button"
            className="sync-mobile-add-button"
            onClick={activeTab === "vaults" ? onCreateVault : onAddConnection}
            title={activeTab === "vaults" ? t("sync.localVaultCreate") : t("settings.addConnection")}
          >
            <PlusGlyph />
          </button>
        </div>
        {activeTab === "vaults" ? renderVaults() : renderConnections()}
      </main>

      {renderBindingSheet()}
      {renderConnectionDetailSheet()}
    </section>
  );
}
