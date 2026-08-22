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
    localVaultId: "local-exact",
    remoteVaultId: "another-remote-vault"
  } satisfies Pick<SyncVaultBinding, "localVaultId" | "remoteVaultId">;

  const candidates = planExactHostedVaultBindingRecovery(
    [localVault("local-exact", "vault-exact", "Work")],
    [existingBinding],
    [remoteVault("vault-exact", "Work")]
  );

  assert.equal(candidates.length, 0);
});

test("does not create a second local binding for an already connected remote vault", () => {
  const existingBinding = {
    localVaultId: "local-connected",
    remoteVaultId: "vault-exact"
  } satisfies Pick<SyncVaultBinding, "localVaultId" | "remoteVaultId">;

  const candidates = planExactHostedVaultBindingRecovery(
    [
      localVault("local-connected", "vault-connected", "Connected"),
      localVault("local-candidate", "vault-exact", "Work")
    ],
    [existingBinding],
    [remoteVault("vault-exact", "Work")]
  );

  assert.equal(candidates.length, 0);
});

test("leaves duplicate local identities for explicit user resolution", () => {
  const candidates = planExactHostedVaultBindingRecovery(
    [
      localVault("local-first", "vault-exact", "Work"),
      localVault("local-second", "vault-exact", "Work copy")
    ],
    [],
    [remoteVault("vault-exact", "Work")]
  );

  assert.equal(candidates.length, 0);
});
