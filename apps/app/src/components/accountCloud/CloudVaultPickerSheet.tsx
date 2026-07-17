import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

import type { LocalVaultProfile } from "../../lib/localVaults";
import type { HostedAccountVault, SyncVaultBinding } from "../../types";
import "./CloudVaultPickerSheet.css";

type CloudVaultPickerSheetProps = {
  open: boolean;
  title: string;
  caption: string;
  accountLabel: string;
  closeLabel: string;
  emptyLabel: string;
  emptyDescription: string;
  actionLabel: string;
  busyLabel: string;
  connectedLabel: string;
  openLocalLabel: string;
  privateLabel: string;
  regularLabel: string;
  loadingLabel: string;
  offlineLabel: string;
  refreshLabel: string;
  busyKey: string | null;
  loading: boolean;
  refreshing: boolean;
  online: boolean;
  remoteVaults: HostedAccountVault[];
  localVaults: LocalVaultProfile[];
  cloudBindingByRemoteId: Map<string, SyncVaultBinding>;
  getVaultLabel: (vault: Pick<LocalVaultProfile, "id" | "name"> | null | undefined) => string;
  onClose: () => void;
  onRefresh: () => void;
  onOpenLocalVault: (localVaultId: string) => void;
  onImportRemoteVault: (remoteVault: HostedAccountVault) => void;
};

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

function RefreshGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M15.3 7.5a5.2 5.2 0 0 0-9.1-2.1L4.7 7" />
      <path d="M4.6 4.2V7h2.8" />
      <path d="M4.7 12.5a5.2 5.2 0 0 0 9.1 2.1l1.5-1.6" />
      <path d="M15.4 15.8V13h-2.8" />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M7.6 5.6 12.1 10l-4.5 4.4" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M5.5 5.5 14.5 14.5M14.5 5.5 5.5 14.5" />
    </svg>
  );
}

export default function CloudVaultPickerSheet({
  open,
  title,
  caption,
  accountLabel,
  closeLabel,
  emptyLabel,
  emptyDescription,
  actionLabel,
  busyLabel,
  connectedLabel,
  openLocalLabel,
  privateLabel,
  regularLabel,
  loadingLabel,
  offlineLabel,
  refreshLabel,
  busyKey,
  loading,
  refreshing,
  online,
  remoteVaults,
  localVaults,
  cloudBindingByRemoteId,
  getVaultLabel,
  onClose,
  onRefresh,
  onOpenLocalVault,
  onImportRemoteVault
}: CloudVaultPickerSheetProps) {
  const titleId = useId();
  const sheetRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return undefined;
    }

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus({ preventScroll: true }), 0);
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = Array.from(
        sheetRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex='-1'])"
        ) ?? []
      );

      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const localVaultsById = new Map(localVaults.map((vault) => [vault.id, vault]));

  const sheet = (
    <div className="cloud-vault-picker-layer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button type="button" className="cloud-vault-picker-dim" aria-label={closeLabel} onClick={onClose} />

      <section ref={sheetRef} className="cloud-vault-picker-card">
        <header className="cloud-vault-picker-head">
          <div className="cloud-vault-picker-heading">
            <p>{title}</p>
            <h3 id={titleId}>{caption}</h3>
            <span>{accountLabel}</span>
          </div>

          <div className="cloud-vault-picker-head-actions">
            <button
              type="button"
              className="cloud-vault-picker-refresh"
              disabled={refreshing || Boolean(busyKey && busyKey !== "overview") || !online}
              onClick={onRefresh}
            >
              <RefreshGlyph />
              <span>{refreshing ? busyLabel : refreshLabel}</span>
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              className="cloud-vault-picker-close"
              onClick={onClose}
              aria-label={closeLabel}
            >
              <CloseGlyph />
            </button>
          </div>
        </header>

        <div className="cloud-vault-picker-body">
          {!online ? (
            <div className="cloud-vault-picker-notice is-warning" role="status">
              {offlineLabel}
            </div>
          ) : null}

          {loading ? (
            <div className="cloud-vault-picker-loading" role="status" aria-label={loadingLabel}>
              <span>{loadingLabel}</span>
              <div className="cloud-vault-picker-skeleton" />
              <div className="cloud-vault-picker-skeleton" />
            </div>
          ) : remoteVaults.length === 0 ? (
            <div className="cloud-vault-picker-empty">
              <span className="cloud-vault-picker-empty-icon" aria-hidden="true">
                <CloudGlyph />
              </span>
              <strong>{emptyLabel}</strong>
              <p>{emptyDescription}</p>
            </div>
          ) : (
            <div className="cloud-vault-picker-list">
              {remoteVaults.map((remoteVault) => {
                const binding = cloudBindingByRemoteId.get(remoteVault.id) ?? null;
                const localVault = binding ? localVaultsById.get(binding.localVaultId) ?? null : null;
                const busy = busyKey === `import-cloud:${remoteVault.id}`;
                const imported = Boolean(binding);
                const kindLabel = remoteVault.vaultKind === "private" ? privateLabel : regularLabel;

                return (
                  <article
                    key={remoteVault.id}
                    className={`cloud-vault-picker-row ${imported ? "is-connected" : ""}`}
                  >
                    <span className="cloud-vault-picker-icon" aria-hidden="true">
                      <VaultGlyph />
                    </span>
                    <span className="cloud-vault-picker-copy">
                      <strong>{remoteVault.name}</strong>
                      <span className="cloud-vault-picker-chip-row">
                        <small>{kindLabel}</small>
                        {imported ? <small className="is-ready">{connectedLabel}</small> : null}
                      </span>
                      {localVault ? <em>{getVaultLabel(localVault)}</em> : null}
                    </span>
                    {localVault ? (
                      <button
                        type="button"
                        className="cloud-vault-picker-action is-secondary"
                        disabled={Boolean(busyKey)}
                        onClick={() => onOpenLocalVault(localVault.id)}
                      >
                        <span>{openLocalLabel}</span>
                        <ChevronGlyph />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="cloud-vault-picker-action"
                        disabled={Boolean(busyKey) || !online}
                        onClick={() => onImportRemoteVault(remoteVault)}
                      >
                        {busy ? busyLabel : actionLabel}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );

  if (typeof document === "undefined") {
    return sheet;
  }

  return createPortal(sheet, document.body);
}
