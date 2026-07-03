import type { LocalVaultProfile } from "../../lib/localVaults";
import type { HostedAccountVault, SyncVaultBinding } from "../../types";
import "./CloudVaultPickerSheet.css";

type CloudVaultPickerSheetProps = {
  open: boolean;
  title: string;
  caption: string;
  closeLabel: string;
  emptyLabel: string;
  actionLabel: string;
  connectedLabel: string;
  privateLabel: string;
  regularLabel: string;
  busyKey: string | null;
  remoteVaults: HostedAccountVault[];
  localVaults: LocalVaultProfile[];
  cloudBindingByRemoteId: Map<string, SyncVaultBinding>;
  getVaultLabel: (vault: Pick<LocalVaultProfile, "id" | "name"> | null | undefined) => string;
  onClose: () => void;
  onImportRemoteVault: (remoteVault: HostedAccountVault) => void;
};

function CloseGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M5.4 5.4 14.6 14.6M14.6 5.4 5.4 14.6" />
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

export default function CloudVaultPickerSheet({
  open,
  title,
  caption,
  closeLabel,
  emptyLabel,
  actionLabel,
  connectedLabel,
  privateLabel,
  regularLabel,
  busyKey,
  remoteVaults,
  localVaults,
  cloudBindingByRemoteId,
  getVaultLabel,
  onClose,
  onImportRemoteVault
}: CloudVaultPickerSheetProps) {
  if (!open) {
    return null;
  }

  const localVaultsById = new Map(localVaults.map((vault) => [vault.id, vault]));

  return (
    <div className="cloud-vault-picker-layer" role="dialog" aria-modal="true">
      <button className="cloud-vault-picker-dim" type="button" aria-label={closeLabel} onClick={onClose} />
      <section className="cloud-vault-picker-card">
        <header className="cloud-vault-picker-head">
          <div>
            <p>{title}</p>
            <h3>{caption}</h3>
          </div>
          <button type="button" className="cloud-vault-picker-close" onClick={onClose} aria-label={closeLabel}>
            <CloseGlyph />
          </button>
        </header>

        <div className="cloud-vault-picker-list">
          {remoteVaults.length === 0 ? (
            <div className="cloud-vault-picker-empty">{emptyLabel}</div>
          ) : (
            remoteVaults.map((remoteVault) => {
              const binding = cloudBindingByRemoteId.get(remoteVault.id) ?? null;
              const localVault = binding ? localVaultsById.get(binding.localVaultId) ?? null : null;
              const busy = busyKey === `import-cloud:${remoteVault.id}`;

              return (
                <button
                  key={remoteVault.id}
                  type="button"
                  className={`cloud-vault-picker-row ${binding ? "is-connected" : ""}`}
                  disabled={Boolean(busyKey)}
                  onClick={() => onImportRemoteVault(remoteVault)}
                >
                  <span className="cloud-vault-picker-icon" aria-hidden="true">
                    <VaultGlyph />
                  </span>
                  <span className="cloud-vault-picker-copy">
                    <strong>{remoteVault.name}</strong>
                    <small>
                      {binding && localVault
                        ? getVaultLabel(localVault)
                        : remoteVault.vaultKind === "private"
                          ? privateLabel
                          : regularLabel}
                    </small>
                  </span>
                  <span className="cloud-vault-picker-action">
                    {busy ? "..." : binding ? connectedLabel : actionLabel}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
