import type { LocalVaultProfile } from "./localVaults";
import type { HostedAccountVault, SyncVaultBinding } from "../types";

export type HostedVaultBindingRecoveryCandidate = {
  localVault: LocalVaultProfile;
  remoteVault: HostedAccountVault;
};

export function planExactHostedVaultBindingRecovery(
  localVaults: readonly LocalVaultProfile[],
  currentBindings: readonly Pick<SyncVaultBinding, "localVaultId" | "remoteVaultId">[],
  remoteVaults: readonly HostedAccountVault[]
) {
  const boundLocalVaultIds = new Set(currentBindings.map((binding) => binding.localVaultId));
  const boundRemoteVaultIds = new Set(currentBindings.map((binding) => binding.remoteVaultId));
  const remoteVaultById = new Map(remoteVaults.map((vault) => [vault.id, vault]));
  const localVaultCountByGuid = new Map<string, number>();

  for (const localVault of localVaults) {
    localVaultCountByGuid.set(
      localVault.vaultGuid,
      (localVaultCountByGuid.get(localVault.vaultGuid) ?? 0) + 1
    );
  }

  return localVaults.flatMap((localVault) => {
    if (
      boundLocalVaultIds.has(localVault.id) ||
      boundRemoteVaultIds.has(localVault.vaultGuid) ||
      localVaultCountByGuid.get(localVault.vaultGuid) !== 1
    ) {
      return [];
    }

    const remoteVault = remoteVaultById.get(localVault.vaultGuid);

    return remoteVault ? [{ localVault, remoteVault }] : [];
  }) satisfies HostedVaultBindingRecoveryCandidate[];
}
