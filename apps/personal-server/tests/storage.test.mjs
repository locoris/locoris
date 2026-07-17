import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createEmptyEnvelope, fileExists } from "../../../packages/sync-core/common.mjs";
import { PersonalServerStorage, hashToken } from "../personal-server-storage.mjs";
import { VaultFileStore, pruneJournalByBytes } from "../vault-file-store.mjs";

async function createTempDir() {
  return mkdtemp(path.join(os.tmpdir(), "locoris-personal-storage-"));
}

test("fresh SQLite metadata and file payloads survive a restart", async (context) => {
  const dataDir = await createTempDir();
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const managementToken = "management-test-token";
  const storage = new PersonalServerStorage(dataDir, { managementToken });
  const fileStore = new VaultFileStore(dataDir);
  await fileStore.initialize();
  const initialized = await storage.initialize();

  assert.equal(initialized.registry.vaults.length, 0);
  assert.equal(storage.getHealth().backend, "sqlite-files");
  assert.equal(storage.getHealth().journalMode, "wal");
  assert.equal(storage.isManagementTokenAuthorized(managementToken), true);

  await fileStore.ensureVault("primary");
  const created = storage.createVault({ id: "primary", name: "Primary" });
  assert.equal(created.statusCode, 201);

  const vaultToken = "vault-test-token";
  const issued = storage.issueVaultToken("primary", "Mac", vaultToken);
  assert.equal(issued.statusCode, 201);
  await fileStore.writeEnvelope("primary", {
    ...createEmptyEnvelope(),
    revision: "rev-persisted"
  });
  storage.updateVaultMeta("primary", {
    lastRevision: "rev-persisted",
    lastSyncAt: 1234,
    vaultKind: "regular"
  });
  storage.close();

  const restarted = new PersonalServerStorage(dataDir, { managementToken });
  await restarted.initialize();
  assert.equal(restarted.getVault("primary").lastRevision, "rev-persisted");
  assert.equal(restarted.findVaultToken("primary", vaultToken)?.label, "Mac");
  assert.equal((await fileStore.readEnvelope("primary")).revision, "rev-persisted");
  assert.equal(await fileExists(path.join(dataDir, "registry.json")), false);
  restarted.close();
});

test("legacy JSON metadata is imported once, archived, and keeps existing token hashes", async (context) => {
  const dataDir = await createTempDir();
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const legacyManagementToken = "legacy-management-token";
  const legacyVaultToken = "legacy-vault-token";
  const legacyConfig = {
    managementToken: legacyManagementToken,
    defaultVaultId: "legacy-vault",
    defaultVaultName: "Legacy vault",
    createdAt: 100
  };
  const legacyRegistry = {
    schemaVersion: 1,
    vaults: [
      {
        id: "legacy-vault",
        name: "Legacy vault",
        vaultKind: "private",
        createdAt: 100,
        updatedAt: 200,
        lastRevision: "rev-legacy",
        lastSyncAt: 200
      }
    ],
    tokens: [
      {
        id: "legacy-token-id",
        vaultId: "legacy-vault",
        label: "Existing device",
        tokenHash: hashToken(legacyVaultToken),
        createdAt: 100,
        lastUsedAt: 150
      }
    ]
  };

  await writeFile(path.join(dataDir, "personal-config.json"), JSON.stringify(legacyConfig), "utf8");
  await writeFile(path.join(dataDir, "registry.json"), JSON.stringify(legacyRegistry), "utf8");

  const storage = new PersonalServerStorage(dataDir);
  const initialized = await storage.initialize();
  assert.equal(initialized.legacyImport.imported, true);
  assert.equal(initialized.legacyImport.archivedFiles.length, 2);
  assert.equal(storage.isManagementTokenAuthorized(legacyManagementToken), true);
  assert.equal(storage.findVaultToken("legacy-vault", legacyVaultToken)?.id, "legacy-token-id");
  assert.equal(storage.getVault("legacy-vault")?.vaultKind, "private");
  assert.equal(await fileExists(path.join(dataDir, "personal-config.json")), false);
  assert.equal(await fileExists(path.join(dataDir, "registry.json")), false);
  storage.close();

  await writeFile(
    path.join(dataDir, "registry.json"),
    "this is intentionally invalid legacy JSON",
    "utf8"
  );
  const restarted = new PersonalServerStorage(dataDir);
  await restarted.initialize();
  assert.equal(restarted.getRegistry().vaults.length, 1);
  restarted.close();
});

test("interrupted vault deletion is restored or finalized from SQLite state", async (context) => {
  const dataDir = await createTempDir();
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const storage = new PersonalServerStorage(dataDir, { managementToken: "management" });
  const fileStore = new VaultFileStore(dataDir);
  await fileStore.initialize();
  await storage.initialize();

  for (const id of ["first", "second"]) {
    await fileStore.ensureVault(id);
    storage.createVault({ id, name: id });
  }

  await fileStore.stageDeletion("second");
  assert.equal(await fileExists(fileStore.getStateFile("second")), false);
  await fileStore.recoverInterruptedDeletions(storage.getRegistry().vaults.map((vault) => vault.id));
  assert.equal(await fileExists(fileStore.getStateFile("second")), true);

  await fileStore.stageDeletion("second");
  assert.equal(storage.deleteVault("second").statusCode, 200);
  await fileStore.recoverInterruptedDeletions(storage.getRegistry().vaults.map((vault) => vault.id));
  assert.equal(await fileExists(fileStore.getStateFile("second")), false);
  assert.equal(await fileExists(fileStore.getJournalFile("second")), false);
  storage.close();
});

test("journal pruning respects both history count and byte budget", () => {
  const entries = Array.from({ length: 400 }, (_, index) => ({
    revision: `rev-${index}`,
    baseRevision: index > 0 ? `rev-${index - 1}` : null,
    createdAt: index,
    changes: { payload: "x".repeat(400) }
  }));
  const pruned = pruneJournalByBytes(entries, 64 * 1024);
  const serializedBytes = Buffer.byteLength(JSON.stringify(pruned), "utf8");

  assert.ok(pruned.length <= 240);
  assert.ok(pruned.length > 0);
  assert.ok(serializedBytes <= 64 * 1024);
  assert.equal(pruned.at(-1).revision, "rev-399");
  assert.deepEqual(pruneJournalByBytes([{ payload: "x".repeat(100_000) }], 64 * 1024), []);
});

test("generated management token is stored as a protected plain-text secret, not JSON", async (context) => {
  const dataDir = await createTempDir();
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const storage = new PersonalServerStorage(dataDir);
  const initialized = await storage.initialize();
  const secret = (await readFile(path.join(dataDir, "management-token"), "utf8")).trim();

  assert.match(secret, /^zpm_[a-f0-9]{32}$/);
  assert.equal(initialized.managementTokenWasGenerated, true);
  assert.equal(storage.isManagementTokenAuthorized(secret), true);
  storage.close();
});
