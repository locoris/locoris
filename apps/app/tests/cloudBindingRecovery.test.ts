import assert from "node:assert/strict";
import test from "node:test";

import { planExactHostedVaultBindingRecovery } from "../src/lib/cloudBindingRecovery.ts";
import type { LocalVaultProfile } from "../src/lib/localVaults.ts";
import type { HostedAccountVault, SyncVaultBinding } from "../src/types.ts";

function localVault(id: string, vaultGuid: string, name: string): LocalVaultProfile {
  return {
    id,
    vaultGuid,
    name,
    vaultKind: "regular",
    createdAt: 1,
    updatedAt: 1
  };
}

function remoteVault(id: string, name: string): HostedAccountVault {
  return {
    id,
    name,
    ownerUserId: "user-1",
    ownerName: "User",
    vaultKind: "regular",
    createdAt: 1,
    updatedAt: 1,
    lastRevision: null,
    lastSyncAt: null,
    tokenCount: 0
  };
}

test("restores only vaults with the same stable identity", () => {
  const candidates = planExactHostedVaultBindingRecovery(
    [
      localVault("local-exact", "vault-exact", "Work"),
      localVault("local-name-only", "vault-local", "Shared name")
    ],
    [],
    [remoteVault("vault-exact", "Renamed in Cloud"), remoteVault("vault-remote", "Shared name")]
  );

  assert.deepEqual(
    candidates.map(({ localVault: local, remoteVault: remote }) => [local.id, remote.id]),
    [["local-exact", "vault-exact"]]
  );
});

test("does not replace a binding to another sync provider", () => {
  const existingBinding = {
    localVaultId: "local-exact"
  } satisfies Pick<SyncVaultBinding, "localVaultId">;

  const candidates = planExactHostedVaultBindingRecovery(
    [localVault("local-exact", "vault-exact", "Work")],
    [existingBinding],
    [remoteVault("vault-exact", "Work")]
  );

  assert.equal(candidates.length, 0);
});
