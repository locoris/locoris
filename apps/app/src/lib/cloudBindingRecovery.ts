import type { LocalVaultProfile } from "./localVaults";
import type { HostedAccountVault, SyncVaultBinding } from "../types";

export type HostedVaultBindingRecoveryCandidate = {
  localVault: LocalVaultProfile;
  remoteVault: HostedAccountVault;
};

export function planExactHostedVaultBindingRecovery(
  localVaults: readonly LocalVaultProfile[],
  currentBindings: readonly Pick<SyncVaultBinding, "localVaultId">[],
  remoteVaults: readonly HostedAccountVault[]
) {
  const boundLocalVaultIds = new Set(currentBindings.map((binding) => binding.localVaultId));
  const remoteVaultById = new Map(remoteVaults.map((vault) => [vault.id, vault]));

  return localVaults.flatMap((localVault) => {
    if (boundLocalVaultIds.has(localVault.id)) {
      return [];
    }

    const remoteVault = remoteVaultById.get(localVault.vaultGuid);

    return remoteVault ? [{ localVault, remoteVault }] : [];
  }) satisfies HostedVaultBindingRecoveryCandidate[];
}
