import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { getErrorMessage } from "../lib/errors";
import type { LocalVaultKind } from "../lib/localVaults";
import type { LocalVaultSwitcherItem } from "./LocalVaultSwitcher";
import "./OrbitalMobileMoreSheet.css";

type MoreSheetView = "main" | "vaults" | "create";
type MoreTone = "default" | "success" | "warning" | "error";

interface StatusChip {
  tone: MoreTone;
  text: string;
  compactText?: string;
  title?: string;
}

interface TransportChip {
  tone: MoreTone;
  text: string;
  title?: string;
}

interface MoreMetaItem {
  key: string;
  label: string;
  value: string;
  title?: string;
  tone: MoreTone;
  icon: ReactNode;
}

interface OrbitalMobileMoreSheetProps {
  localVaultLabel: string;
  activeLabel: string;
  trashLabel: string;
  activeVaultId: string;
  activeVaultItem: LocalVaultSwitcherItem | null;
  activeVaultDisplayName: string;
  localVaultOptions: LocalVaultSwitcherItem[];
  getVaultDisplayName: (item: LocalVaultSwitcherItem, index: number) => string;
  syncStatusChip?: StatusChip;
  syncTransportChip?: TransportChip | null;
  trashCount: number;
  hasTrash: boolean;
  onSelectLocalVault: (vaultId: string) => void;
  onCreateLocalVault?: (input: {
    name: string;
    vaultKind: LocalVaultKind;
    passphrase?: string;
  }) => string | void | Promise<string | void>;
  onOpenTrash: () => void;
  onClose: () => void;
}

function VaultGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4.6 8.2h14.8v10.1H4.6z" />
      <path d="m4.6 8.2 2.8-2.1h9.2l2.8 2.1" className="orbital-mobile-more-glyph-accent" />
      <path d="M8.5 11.7h7" className="orbital-mobile-more-glyph-accent" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 5.2v13.6M5.2 12h13.6" />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

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

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m6.2 12.4 3.7 3.6 7.9-8" />
    </svg>
  );
}

function TrashGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7.2 8.5h9.6l-.7 10.2H7.9z" />
      <path d="M9.4 8.5V5.9h5.2v2.6M5.6 8.5h12.8M10 11.3v4.7M14 11.3v4.7" />
    </svg>
  );
}

function CloudGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7.3 17.2h9.1a3.9 3.9 0 0 0 .5-7.8 5.1 5.1 0 0 0-9.6-1.6 4.8 4.8 0 0 0 0 9.4z" />
    </svg>
  );
}

function SyncGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M17.5 8.1A6.8 6.8 0 0 0 6.7 7l-1.8 1.8" />
      <path d="M5 5.5v3.3h3.3M6.5 15.9A6.8 6.8 0 0 0 17.3 17l1.8-1.8" />
      <path d="M19 18.5v-3.3h-3.3" />
    </svg>
  );
}

function LockGlyph({ locked }: { locked: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d={
          locked
            ? "M7.6 10.2V8.5a4.4 4.4 0 1 1 8.8 0v1.7M6.3 10.2h11.4v8.5H6.3z"
            : "M7.6 10.2V8.8A4.4 4.4 0 0 1 15.5 6M6.3 10.2h11.4v8.5H6.3z"
        }
      />
      <path d="M12 13v2.4" className="orbital-mobile-more-glyph-accent" />
    </svg>
  );
}

function getEncryptionLabel(item: LocalVaultSwitcherItem | null, t: (key: string) => string) {
  if (!item || item.encryptionState === "disabled") {
    return t("settings.vaultKindRegular");
  }

  return item.encryptionState === "ready"
    ? t("settings.vaultEncryptionReady")
    : t("settings.vaultEncryptionLocked");
}

function getVaultKindLabel(kind: LocalVaultKind, t: (key: string) => string) {
  return kind === "private" ? t("settings.vaultKindPrivate") : t("settings.vaultKindRegular");
}

function moreToneClass(tone: MoreTone | undefined) {
  return `is-${tone ?? "default"}`;
}

export default function OrbitalMobileMoreSheet({
  localVaultLabel,
  activeLabel,
  trashLabel,
  activeVaultId,
  activeVaultItem,
  activeVaultDisplayName,
  localVaultOptions,
  getVaultDisplayName,
  syncStatusChip,
  syncTransportChip,
  trashCount,
  hasTrash,
  onSelectLocalVault,
  onCreateLocalVault,
  onOpenTrash,
  onClose
}: OrbitalMobileMoreSheetProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<MoreSheetView>("main");
  const [createVaultKind, setCreateVaultKind] = useState<LocalVaultKind>("regular");
  const [createName, setCreateName] = useState("");
  const [createPassphrase, setCreatePassphrase] = useState("");
  const [createPassphraseConfirm, setCreatePassphraseConfirm] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);

  const metaItems = useMemo<MoreMetaItem[]>(
    () => [
      {
        key: "storage",
        label: t("orbit.mobileMoreStorageState"),
        value: activeVaultItem?.statusLabel ?? t("sync.localVaultEmpty"),
        tone: activeVaultItem?.statusTone ?? "warning",
        icon: <VaultGlyph />
      },
      {
        key: "cloud",
        label: t("orbit.mobileMoreCloudStatus"),
        value: syncTransportChip?.text ?? activeVaultItem?.providerLabel ?? t("sync.localOnlyShort"),
        title: syncTransportChip?.title ?? activeVaultItem?.providerLabel ?? undefined,
        tone: syncTransportChip?.tone ?? "default",
        icon: <CloudGlyph />
      },
      {
        key: "sync",
        label: t("orbit.mobileMoreSyncStatus"),
        value: syncStatusChip?.compactText ?? syncStatusChip?.text ?? t("orbit.mobileMoreNoStatus"),
        title: syncStatusChip?.title,
        tone: syncStatusChip?.tone ?? "default",
        icon: <SyncGlyph />
      },
      {
        key: "security",
        label: t("orbit.mobileMoreSecurity"),
        value: getEncryptionLabel(activeVaultItem, t),
        tone: activeVaultItem?.encryptionState === "locked" ? "warning" : "default",
        icon: <LockGlyph locked={activeVaultItem?.encryptionState === "locked"} />
      }
    ],
    [activeVaultItem, syncStatusChip, syncTransportChip, t]
  );

  const resetCreateForm = () => {
    setCreateVaultKind("regular");
    setCreateName("");
    setCreatePassphrase("");
    setCreatePassphraseConfirm("");
    setCreateError(null);
    setCreateBusy(false);
  };

  const openCreateView = () => {
    resetCreateForm();
    setView("create");
  };

  const handleCreateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!onCreateLocalVault) {
      return;
    }

    const normalizedName = createName.trim();
    if (!normalizedName) {
      setCreateError(t("settings.createVaultNameRequired"));
      return;
    }

    if (createVaultKind === "private") {
      if (!createPassphrase) {
        setCreateError(t("sync.vaultEncryptionPassphraseRequired"));
        return;
      }

      if (createPassphrase.length < 8) {
        setCreateError(t("sync.vaultEncryptionPassphraseTooShort"));
        return;
      }

      if (createPassphrase !== createPassphraseConfirm) {
        setCreateError(t("sync.vaultEncryptionPassphraseMismatch"));
        return;
      }
    }

    setCreateBusy(true);
    setCreateError(null);

    try {
      const createdVaultId = await onCreateLocalVault({
        name: normalizedName,
        vaultKind: createVaultKind,
        passphrase: createVaultKind === "private" ? createPassphrase : undefined
      });

      if (createdVaultId) {
        onSelectLocalVault(createdVaultId);
      }

      resetCreateForm();
      setView("main");
    } catch (error) {
      setCreateError(getErrorMessage(error, t("sync.failedGeneric")));
      setCreateBusy(false);
    }
  };

  return (
    <section
      className={`orbital-mobile-menu-card orbital-mobile-more-sheet is-${view}`}
      role="dialog"
      aria-modal="true"
      aria-label={t("orbit.mobileMoreTitle")}
    >
      <header className="orbital-mobile-more-header">
        {view === "main" ? (
          <div className="orbital-mobile-more-header-copy">
            <p className="panel-kicker">{t("orbit.mobileMoreKicker")}</p>
            <span>{t("orbit.mobileMoreSubtitle")}</span>
          </div>
        ) : (
          <button
            type="button"
            className="orbital-mobile-more-back"
            onClick={() => setView("main")}
            aria-label={t("orbit.mobileMoreBack")}
          >
            <BackGlyph />
            <span>{t("orbit.mobileMoreBack")}</span>
          </button>
        )}
        <button
          type="button"
          className="orbital-mobile-menu-close"
          onClick={onClose}
          aria-label={t("dialog.cancel")}
        >
          <CloseGlyph />
        </button>
      </header>

      {view === "main" ? (
        <>
          <div className="orbital-mobile-more-vault-hero">
            <div className="orbital-mobile-more-vault-topline">
              <span className="orbital-mobile-more-icon is-vault" aria-hidden="true">
                <VaultGlyph />
              </span>
              <div>
                <span className="orbital-mobile-more-label">{t("orbit.mobileMoreActiveVault")}</span>
                <strong title={activeVaultDisplayName}>{activeVaultDisplayName}</strong>
              </div>
            </div>

            {!activeVaultItem ? (
              <div className="orbital-mobile-more-chiprow">
                <span className="orbital-mobile-more-chip is-warning">{t("sync.localVaultEmpty")}</span>
              </div>
            ) : null}

            <div className="orbital-mobile-more-vault-actions">
              <button type="button" className="is-primary" onClick={() => setView("vaults")}>
                <span className="orbital-mobile-more-action-icon" aria-hidden="true">
                  <VaultGlyph />
                </span>
                <span>
                  <strong>{t("orbit.mobileMoreChooseVault")}</strong>
                  <small>{localVaultLabel}</small>
                </span>
              </button>
              <button
                type="button"
                className="is-secondary"
                onClick={openCreateView}
                disabled={!onCreateLocalVault}
              >
                <span className="orbital-mobile-more-action-icon" aria-hidden="true">
                  <PlusGlyph />
                </span>
                <span>
                  <strong>{t("orbit.mobileMoreCreateVault")}</strong>
                  <small>{t("orbit.mobileMoreCreateVaultHint")}</small>
                </span>
              </button>
            </div>

            <div className="orbital-mobile-more-meta-grid">
              {metaItems.map((item) => (
                <div key={item.key} className={`orbital-mobile-more-meta-card ${moreToneClass(item.tone)}`}>
                  <span className="orbital-mobile-more-meta-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <div>
                    <span>{item.label}</span>
                    <strong title={item.title ?? item.value}>{item.value}</strong>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {hasTrash ? (
            <button type="button" className="orbital-mobile-more-trash" onClick={onOpenTrash}>
              <span className="orbital-mobile-more-action-icon" aria-hidden="true">
                <TrashGlyph />
              </span>
              <span>{trashLabel}</span>
              <strong>{trashCount}</strong>
            </button>
          ) : null}
        </>
      ) : null}

      {view === "vaults" ? (
        <div className="orbital-mobile-more-pane">
          <div className="orbital-mobile-more-pane-heading">
            <p className="panel-kicker">{localVaultLabel}</p>
            <span>{t("orbit.mobileMoreVaultsSubtitle")}</span>
          </div>

          <div className="orbital-mobile-more-vault-list" role="listbox" aria-label={localVaultLabel}>
            {localVaultOptions.length ? (
              localVaultOptions.map((item, index) => {
                const displayName = getVaultDisplayName(item, index);
                const isActive = item.id === activeVaultId;

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`orbital-mobile-more-vault-option ${isActive ? "is-active" : ""}`}
                    onClick={() => {
                      onSelectLocalVault(item.id);
                      setView("main");
                    }}
                    role="option"
                    aria-selected={isActive}
                  >
                    <span className="orbital-mobile-more-option-icon" aria-hidden="true">
                      {item.vaultKind === "private" ? (
                        <LockGlyph locked={item.encryptionState === "locked"} />
                      ) : (
                        <VaultGlyph />
                      )}
                    </span>
                    <span className="orbital-mobile-more-option-copy">
                      <strong title={displayName}>{displayName}</strong>
                      <small title={item.detail}>{item.detail}</small>
                      <span className="orbital-mobile-more-chiprow">
                        {isActive ? <span className="orbital-mobile-more-chip is-success">{activeLabel}</span> : null}
                        <span className={`orbital-mobile-more-chip is-provider-${item.providerTone}`}>
                          {item.providerLabel ?? t("sync.localOnlyShort")}
                        </span>
                        <span className={`orbital-mobile-more-chip ${moreToneClass(item.statusTone)}`}>
                          {item.statusLabel}
                        </span>
                        <span className="orbital-mobile-more-chip">{getVaultKindLabel(item.vaultKind, t)}</span>
                      </span>
                    </span>
                    <span className="orbital-mobile-more-select-mark" aria-hidden="true">
                      {isActive ? <CheckGlyph /> : <ChevronGlyph />}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="orbital-mobile-more-empty">
                <VaultGlyph />
                <strong>{t("sync.localVaultEmpty")}</strong>
              </div>
            )}
          </div>

          <button
            type="button"
            className="orbital-mobile-more-wide-action"
            onClick={openCreateView}
            disabled={!onCreateLocalVault}
          >
            <span className="orbital-mobile-more-action-icon" aria-hidden="true">
              <PlusGlyph />
            </span>
            <span>{t("orbit.mobileMoreCreateVault")}</span>
          </button>
        </div>
      ) : null}

      {view === "create" ? (
        <form className="orbital-mobile-more-pane orbital-mobile-more-create" onSubmit={handleCreateSubmit}>
          <div className="orbital-mobile-more-pane-heading">
            <p className="panel-kicker">{t("settings.createVaultTypeLabel")}</p>
            <h2>{t("orbit.mobileMoreCreateTitle")}</h2>
            <span>{t("orbit.mobileMoreCreateSubtitle")}</span>
          </div>

          <div className="orbital-mobile-more-kind-grid" role="radiogroup" aria-label={t("settings.createVaultTypeLabel")}>
            {(["regular", "private"] as LocalVaultKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                className={createVaultKind === kind ? "is-selected" : ""}
                onClick={() => {
                  setCreateVaultKind(kind);
                  setCreateError(null);
                }}
                role="radio"
                aria-checked={createVaultKind === kind}
              >
                <span className="orbital-mobile-more-kind-icon" aria-hidden="true">
                  {kind === "private" ? <LockGlyph locked={false} /> : <VaultGlyph />}
                </span>
                <strong>{getVaultKindLabel(kind, t)}</strong>
                <small>
                  {kind === "private"
                    ? t("settings.createVaultPrivateDescription")
                    : t("settings.createVaultRegularDescription")}
                </small>
              </button>
            ))}
          </div>

          <label className="orbital-mobile-more-field">
            <span>{t("sync.localVaultCreatePlaceholder")}</span>
            <input
              value={createName}
              onChange={(event) => {
                setCreateName(event.target.value);
                setCreateError(null);
              }}
              autoFocus
              placeholder={t("sync.localVaultCreatePlaceholder")}
            />
          </label>

          {createVaultKind === "private" ? (
            <div className="orbital-mobile-more-private-fields">
              <label className="orbital-mobile-more-field">
                <span>{t("settings.vaultEncryptionPassphrase")}</span>
                <input
                  type="password"
                  value={createPassphrase}
                  onChange={(event) => {
                    setCreatePassphrase(event.target.value);
                    setCreateError(null);
                  }}
                  autoComplete="new-password"
                />
              </label>
              <label className="orbital-mobile-more-field">
                <span>{t("settings.vaultEncryptionConfirmPassphrase")}</span>
                <input
                  type="password"
                  value={createPassphraseConfirm}
                  onChange={(event) => {
                    setCreatePassphraseConfirm(event.target.value);
                    setCreateError(null);
                  }}
                  autoComplete="new-password"
                />
              </label>
              <p className="orbital-mobile-more-note">{t("settings.createVaultPrivateHint")}</p>
            </div>
          ) : null}

          {createError ? <p className="orbital-mobile-more-error">{createError}</p> : null}

          <div className="orbital-mobile-more-create-actions">
            <button type="button" className="is-muted" onClick={() => setView("main")}>
              {t("dialog.cancel")}
            </button>
            <button type="submit" className="is-submit" disabled={!onCreateLocalVault || createBusy}>
              <PlusGlyph />
              <span>{createBusy ? t("status.saving") : t("orbit.mobileMoreCreateVault")}</span>
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
