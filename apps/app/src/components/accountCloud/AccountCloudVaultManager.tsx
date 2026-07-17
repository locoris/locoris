import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import type { LocalVaultProfile } from "../../lib/localVaults";
import { formatDateTimeValue, getCurrentLocaleRuntime } from "../../localization";
import type {
  HostedAccountVault,
  SyncVaultBinding,
  VaultEncryptionSummary
} from "../../types";
import "./AccountCloudVaultManager.css";

type VaultScope = "local" | "cloud";

type EditingVault = {
  scope: VaultScope;
  id: string;
} | null;

type AccountCloudVaultManagerProps = {
  localVaults: LocalVaultProfile[];
  remoteVaults: HostedAccountVault[];
  activeLocalVaultId: string;
  cloudConnected: boolean;
  cloudCanWrite: boolean;
  cloudCanDelete: boolean;
  online: boolean;
  busyKey: string | null;
  language: string;
  vaultEncryptionById: Record<string, VaultEncryptionSummary>;
  cloudBindingByLocalId: Map<string, SyncVaultBinding>;
  cloudBindingByRemoteId: Map<string, SyncVaultBinding>;
  getVaultLabel: (vault: Pick<LocalVaultProfile, "id" | "name"> | null | undefined) => string;
  onOpenLocalVault: (localVaultId: string) => void;
  onConnectLocalVault: (vault: LocalVaultProfile) => void;
  onDisconnectLocalVault: (localVaultId: string) => void;
  onRunVaultSync: (localVaultId: string) => void;
  onImportRemoteVault: (remoteVault: HostedAccountVault) => void;
  onRenameLocalVault: (localVaultId: string, name: string) => void | Promise<void>;
  onRenameRemoteVault: (remoteVault: HostedAccountVault, name: string) => void | Promise<void>;
  onRequestDeleteLocalVault: (vault: LocalVaultProfile) => void;
  onRequestDeleteRemoteVault: (remoteVault: HostedAccountVault) => void;
  onRequestCloudSignIn: () => void;
};

function VaultGlyph({ cloud = false }: { cloud?: boolean }) {
  return cloud ? (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6.3 18h11.1a3.7 3.7 0 0 0 .4-7.4 6.1 6.1 0 0 0-11.9-1.8A4.7 4.7 0 0 0 6.3 18Z" />
      <path d="M9 14h6M12 11v6" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 7.5h16v11H4z" />
      <path d="m4 7.5 3-2.2h10l3 2.2M8.5 11.2h7" />
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

function TrashGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M6.4 6.8v8M10 6.8v8M13.6 6.8v8M4.3 4.7h11.4M7.2 4.7V3.5h5.6v1.2M5.3 4.7l.7 12h8l.7-12" />
    </svg>
  );
}

function OpenGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M7.2 4.8h8v8" />
      <path d="m15.2 4.8-9.9 9.9M13.5 15.2H4.8V6.5" />
    </svg>
  );
}

function SyncGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M15.3 7.4A5.5 5.5 0 0 0 5.6 5.3L4.3 7" />
      <path d="M4.2 4.2V7h2.9M4.7 12.6a5.5 5.5 0 0 0 9.7 2.1l1.3-1.7M15.8 15.8V13h-2.9" />
    </svg>
  );
}

function formatVaultActivity(timestamp: number | null, language: string) {
  if (!timestamp) {
    return null;
  }

  void language;
  return formatDateTimeValue(timestamp, getCurrentLocaleRuntime(), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export default function AccountCloudVaultManager({
  localVaults,
  remoteVaults,
  activeLocalVaultId,
  cloudConnected,
  cloudCanWrite,
  cloudCanDelete,
  online,
  busyKey,
  language,
  vaultEncryptionById,
  cloudBindingByLocalId,
  cloudBindingByRemoteId,
  getVaultLabel,
  onOpenLocalVault,
  onConnectLocalVault,
  onDisconnectLocalVault,
  onRunVaultSync,
  onImportRemoteVault,
  onRenameLocalVault,
  onRenameRemoteVault,
  onRequestDeleteLocalVault,
  onRequestDeleteRemoteVault,
  onRequestCloudSignIn
}: AccountCloudVaultManagerProps) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<VaultScope>("local");
  const [editingVault, setEditingVault] = useState<EditingVault>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [renameError, setRenameError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editingVault) {
      return;
    }

    const timer = window.setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [editingVault]);

  const beginRename = (nextScope: VaultScope, id: string, name: string) => {
    if (busyKey) {
      return;
    }

    setEditingVault({ scope: nextScope, id });
    setNameDraft(name);
    setRenameError("");
  };

  const cancelRename = () => {
    setEditingVault(null);
    setNameDraft("");
    setRenameError("");
  };

  const submitRename = async (event: FormEvent, currentName: string) => {
    event.preventDefault();

    if (!editingVault || busyKey) {
      return;
    }

    const nextName = nameDraft.trim().slice(0, 80);

    if (!nextName) {
      setRenameError(t("settings.accountCloudVaultNameRequired"));
      return;
    }

    if (nextName === currentName.trim()) {
      cancelRename();
      return;
    }

    try {
      if (editingVault.scope === "local") {
        await Promise.resolve(onRenameLocalVault(editingVault.id, nextName));
      } else {
        const remoteVault = remoteVaults.find((vault) => vault.id === editingVault.id);

        if (!remoteVault) {
          cancelRename();
          return;
        }

        await Promise.resolve(onRenameRemoteVault(remoteVault, nextName));
      }
      cancelRename();
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : t("sync.hostedFailedGeneric"));
    }
  };

  return (
    <div className="account-cloud-vault-manager">
      <div className="account-cloud-vault-tabs" role="tablist" aria-label={t("settings.accountCloudVaultScopeLabel")}>
        <button
          type="button"
          role="tab"
          aria-selected={scope === "local"}
          className={scope === "local" ? "is-active" : ""}
          onClick={() => {
            setScope("local");
            cancelRename();
          }}
        >
          <VaultGlyph />
          <span>{t("settings.accountCloudLocalVaultsTab")}</span>
          <small>{localVaults.length}</small>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={scope === "cloud"}
          className={scope === "cloud" ? "is-active" : ""}
          onClick={() => {
            setScope("cloud");
            cancelRename();
          }}
        >
          <VaultGlyph cloud />
          <span>{t("settings.accountCloudCloudVaultsTab")}</span>
          <small>{cloudConnected ? remoteVaults.length : "—"}</small>
        </button>
      </div>

      {scope === "local" ? (
        <div className="account-cloud-managed-list" role="tabpanel">
          {localVaults.map((vault) => {
            const binding = cloudBindingByLocalId.get(vault.id) ?? null;
            const encryption = vaultEncryptionById[vault.id];
            const locked = vault.vaultKind === "private" && encryption?.enabled && encryption.state === "locked";
            const active = vault.id === activeLocalVaultId;
            const busy = busyKey?.endsWith(`:${vault.id}`) ?? false;
            const editing = editingVault?.scope === "local" && editingVault.id === vault.id;
            const name = getVaultLabel(vault);

            return (
              <article key={vault.id} className={`account-cloud-managed-row ${binding ? "is-connected" : ""}`}>
                <span className="account-cloud-managed-icon" aria-hidden="true">
                  <VaultGlyph />
                </span>
                <div className="account-cloud-managed-copy">
                  <div className="account-cloud-managed-chips">
                    {active ? <span className="is-accent">{t("sync.localVaultActive")}</span> : null}
                    <span>{vault.vaultKind === "private" ? t("settings.vaultKindPrivate") : t("settings.vaultKindRegular")}</span>
                    <span className={binding ? "is-ready" : ""}>
                      {binding ? t("settings.accountCloudConnected") : t("settings.accountCloudNotConnected")}
                    </span>
                    {locked ? <span className="is-warning">{t("settings.vaultEncryptionLocked")}</span> : null}
                  </div>

                  {editing ? (
                    <form className="account-cloud-inline-rename" onSubmit={(event) => void submitRename(event, name)}>
                      <input
                        ref={inputRef}
                        value={nameDraft}
                        maxLength={80}
                        aria-label={t("settings.accountCloudRenameLocalVault")}
                        onChange={(event) => {
                          setNameDraft(event.target.value);
                          setRenameError("");
                        }}
                      />
                      <button type="submit" aria-label={t("dialog.ok")} title={t("dialog.ok")}>
                        <CheckGlyph />
                      </button>
                      <button type="button" aria-label={t("dialog.cancel")} title={t("dialog.cancel")} onClick={cancelRename}>
                        <CloseGlyph />
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="account-cloud-managed-title"
                      disabled={Boolean(busyKey) || Boolean(binding && (!online || !cloudCanWrite))}
                      onClick={() => beginRename("local", vault.id, name)}
                      aria-label={t("settings.accountCloudRenameVaultLabel", { vault: name })}
                    >
                      <strong>{name}</strong>
                      <EditGlyph />
                    </button>
                  )}

                  {renameError && editing ? <small className="account-cloud-rename-error">{renameError}</small> : null}
                  <p>
                    {binding
                      ? t("settings.accountCloudLocalVaultConnectedTo", {
                          vault: binding.remoteVaultName,
                          date: formatVaultActivity(binding.lastSyncAt, language) ?? t("settings.accountCloudNeverSynced")
                        })
                      : t("settings.accountCloudLocalVaultOnlyDescription")}
                  </p>
                </div>

                <div className="account-cloud-managed-actions">
                  {!active ? (
                    <button
                      type="button"
                      className="account-cloud-icon-action"
                      onClick={() => onOpenLocalVault(vault.id)}
                      aria-label={t("settings.accountCloudOpenVaultLabel", { vault: name })}
                      title={t("settings.accountCloudOpenVault")}
                    >
                      <OpenGlyph />
                    </button>
                  ) : null}
                  {binding ? (
                    <>
                      <button
                        type="button"
                        className="account-cloud-compact-action"
                        disabled={Boolean(busyKey) || !online}
                        onClick={() => onRunVaultSync(vault.id)}
                      >
                        <SyncGlyph />
                        <span>{t("sync.syncNow")}</span>
                      </button>
                      <button
                        type="button"
                        className="account-cloud-compact-action is-secondary"
                        disabled={Boolean(busyKey)}
                        onClick={() => onDisconnectLocalVault(vault.id)}
                      >
                        {busy ? t("sync.syncing") : t("settings.accountCloudDisconnect")}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="account-cloud-compact-action"
                      disabled={!cloudConnected || !cloudCanWrite || locked || Boolean(busyKey) || !online}
                      onClick={() => onConnectLocalVault(vault)}
                    >
                      {busy ? t("sync.syncing") : t("settings.accountCloudConnectVault")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="account-cloud-icon-action is-danger"
                    disabled={localVaults.length <= 1 || Boolean(busyKey)}
                    onClick={() => onRequestDeleteLocalVault(vault)}
                    aria-label={t("settings.accountCloudDeleteLocalVaultLabel", { vault: name })}
                    title={
                      localVaults.length <= 1
                        ? t("sync.localVaultCannotDeleteLast")
                        : t("settings.accountCloudDeleteLocalVault")
                    }
                  >
                    <TrashGlyph />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : !cloudConnected ? (
        <div className="account-cloud-manager-empty" role="tabpanel">
          <span className="account-cloud-manager-empty-icon" aria-hidden="true">
            <VaultGlyph cloud />
          </span>
          <strong>{t("settings.accountCloudCloudVaultsSignedOutTitle")}</strong>
          <p>{t("settings.accountCloudCloudVaultsSignedOutDescription")}</p>
          <button type="button" className="account-cloud-compact-action" onClick={onRequestCloudSignIn}>
            {t("settings.accountCloudSignIn")}
          </button>
        </div>
      ) : remoteVaults.length === 0 ? (
        <div className="account-cloud-manager-empty" role="tabpanel">
          <span className="account-cloud-manager-empty-icon" aria-hidden="true">
            <VaultGlyph cloud />
          </span>
          <strong>{t("settings.accountCloudNoRemoteVaults")}</strong>
          <p>{t("settings.accountCloudImportEmptyDescription")}</p>
        </div>
      ) : (
        <div className="account-cloud-managed-list" role="tabpanel">
          {remoteVaults.map((remoteVault) => {
            const binding = cloudBindingByRemoteId.get(remoteVault.id) ?? null;
            const localVault = binding ? localVaults.find((vault) => vault.id === binding.localVaultId) ?? null : null;
            const editing = editingVault?.scope === "cloud" && editingVault.id === remoteVault.id;
            const busy = busyKey?.endsWith(`:${remoteVault.id}`) ?? false;
            const activity = formatVaultActivity(remoteVault.lastSyncAt ?? remoteVault.updatedAt, language);

            return (
              <article key={remoteVault.id} className={`account-cloud-managed-row is-cloud ${binding ? "is-connected" : ""}`}>
                <span className="account-cloud-managed-icon" aria-hidden="true">
                  <VaultGlyph cloud />
                </span>
                <div className="account-cloud-managed-copy">
                  <div className="account-cloud-managed-chips">
                    <span>{remoteVault.vaultKind === "private" ? t("settings.vaultKindPrivate") : t("settings.vaultKindRegular")}</span>
                    <span className={binding ? "is-ready" : ""}>
                      {binding ? t("settings.accountCloudImportedOnDevice") : t("settings.accountCloudOnly")}
                    </span>
                    <span>{t("settings.accountCloudDeviceVaultCount", { count: remoteVault.deviceCount ?? remoteVault.tokenCount })}</span>
                  </div>

                  {editing ? (
                    <form
                      className="account-cloud-inline-rename"
                      onSubmit={(event) => void submitRename(event, remoteVault.name)}
                    >
                      <input
                        ref={inputRef}
                        value={nameDraft}
                        maxLength={80}
                        aria-label={t("settings.accountCloudRenameRemoteVault")}
                        onChange={(event) => {
                          setNameDraft(event.target.value);
                          setRenameError("");
                        }}
                      />
                      <button type="submit" aria-label={t("dialog.ok")} title={t("dialog.ok")}>
                        <CheckGlyph />
                      </button>
                      <button type="button" aria-label={t("dialog.cancel")} title={t("dialog.cancel")} onClick={cancelRename}>
                        <CloseGlyph />
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="account-cloud-managed-title"
                      disabled={!online || !cloudCanWrite || Boolean(busyKey)}
                      onClick={() => beginRename("cloud", remoteVault.id, remoteVault.name)}
                      aria-label={t("settings.accountCloudRenameVaultLabel", { vault: remoteVault.name })}
                    >
                      <strong>{remoteVault.name}</strong>
                      <EditGlyph />
                    </button>
                  )}

                  {renameError && editing ? <small className="account-cloud-rename-error">{renameError}</small> : null}
                  <p>
                    {localVault
                      ? t("settings.accountCloudRemoteVaultLocalCopy", { vault: getVaultLabel(localVault) })
                      : activity
                        ? t("settings.accountCloudRemoteVaultActivity", { date: activity })
                        : t("settings.accountCloudNeverSynced")}
                  </p>
                </div>

                <div className="account-cloud-managed-actions">
                  {localVault ? (
                    <button
                      type="button"
                      className="account-cloud-compact-action"
                      disabled={Boolean(busyKey)}
                      onClick={() => onOpenLocalVault(localVault.id)}
                    >
                      <OpenGlyph />
                      <span>{t("settings.accountCloudImportOpenLocal")}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="account-cloud-compact-action"
                      disabled={Boolean(busyKey) || !online}
                      onClick={() => onImportRemoteVault(remoteVault)}
                    >
                      {busy ? t("sync.syncing") : t("settings.accountCloudImportAction")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="account-cloud-icon-action is-danger"
                    disabled={!online || !cloudCanDelete || Boolean(busyKey)}
                    onClick={() => onRequestDeleteRemoteVault(remoteVault)}
                    aria-label={t("settings.accountCloudDeleteRemoteVaultLabel", { vault: remoteVault.name })}
                    title={t("settings.accountCloudDeleteRemoteVault")}
                  >
                    <TrashGlyph />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
