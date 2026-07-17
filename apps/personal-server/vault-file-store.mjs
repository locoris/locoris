import { randomUUID } from "node:crypto";
import { readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import {
  createEmptyEnvelope,
  ensureDir,
  fileExists,
  normalizeEncryptedPayload,
  normalizeChangeSet,
  normalizeStoredEnvelope,
  now,
  pruneChangeHistory,
  readJsonFile,
  writeJsonFile
} from "../../packages/sync-core/common.mjs";

const DEFAULT_JOURNAL_MAX_BYTES = 2 * 1024 * 1024;
const MIN_JOURNAL_MAX_BYTES = 64 * 1024;

function parsePositiveInteger(value, fallbackValue) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
}

function normalizeJournalEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const normalized = {
    revision: typeof entry.revision === "string" ? entry.revision : null,
    baseRevision:
      typeof entry.baseRevision === "string" || entry.baseRevision === null
        ? entry.baseRevision ?? null
        : null,
    createdAt: typeof entry.createdAt === "number" ? entry.createdAt : now(),
    changes: entry.encryptedChanges ? null : normalizeChangeSet(entry.changes, "server"),
    encryptedChanges: normalizeEncryptedPayload(entry.encryptedChanges)
  };

  return normalized.revision && (normalized.changes || normalized.encryptedChanges) ? normalized : null;
}

function pruneJournalByBytes(entries, maxBytes) {
  const countPruned = pruneChangeHistory(Array.isArray(entries) ? entries : []);
  const selected = [];
  let byteCount = 2;

  for (let index = countPruned.length - 1; index >= 0; index -= 1) {
    const entry = countPruned[index];
    const entryBytes = Buffer.byteLength(JSON.stringify(entry), "utf8") + (selected.length > 0 ? 1 : 0);

    if (entryBytes + 2 > maxBytes) {
      if (selected.length === 0) {
        return [];
      }
      break;
    }

    if (byteCount + entryBytes > maxBytes) {
      break;
    }

    selected.unshift(entry);
    byteCount += entryBytes;
  }

  return selected;
}

export class VaultFileStore {
  constructor(dataDir, options = {}) {
    this.dataDir = dataDir;
    this.vaultsDir = path.join(dataDir, "vaults");
    this.trashDir = path.join(dataDir, ".trash");
    this.journalMaxBytes = Math.max(
      MIN_JOURNAL_MAX_BYTES,
      parsePositiveInteger(options.journalMaxBytes, DEFAULT_JOURNAL_MAX_BYTES)
    );
    this.locks = new Map();
  }

  async initialize() {
    await ensureDir(this.vaultsDir);
    await ensureDir(this.trashDir);
  }

  getStateFile(vaultId) {
    return path.join(this.vaultsDir, `${vaultId}.json`);
  }

  getJournalFile(vaultId) {
    return path.join(this.vaultsDir, `${vaultId}.journal.json`);
  }

  async withLock(key, operation) {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => gate);
    this.locks.set(key, queued);

    await previous.catch(() => undefined);

    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(key) === queued) {
        this.locks.delete(key);
      }
    }
  }

  withVaultLock(vaultId, operation) {
    return this.withLock(`vault:${vaultId}`, operation);
  }

  withManagementLock(operation) {
    return this.withLock("management", operation);
  }

  async readEnvelope(vaultId) {
    const parsed = await readJsonFile(this.getStateFile(vaultId), createEmptyEnvelope());
    return normalizeStoredEnvelope(parsed);
  }

  async writeEnvelope(vaultId, envelope) {
    await writeJsonFile(this.getStateFile(vaultId), envelope);
  }

  async readJournal(vaultId) {
    const parsed = await readJsonFile(this.getJournalFile(vaultId), []);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map(normalizeJournalEntry).filter(Boolean);
  }

  async writeJournal(vaultId, journal) {
    await writeJsonFile(
      this.getJournalFile(vaultId),
      pruneJournalByBytes(journal, this.journalMaxBytes)
    );
  }

  async appendJournalEntry(vaultId, entry) {
    const journal = await this.readJournal(vaultId);
    await this.writeJournal(vaultId, [...journal, entry]);
  }

  async ensureVault(vaultId) {
    if (!(await fileExists(this.getStateFile(vaultId)))) {
      await this.writeEnvelope(vaultId, createEmptyEnvelope());
    }

    if (!(await fileExists(this.getJournalFile(vaultId)))) {
      await this.writeJournal(vaultId, []);
    }
  }

  async syncEnvelopeName(vaultId, vaultName) {
    const envelope = await this.readEnvelope(vaultId);

    if (!envelope?.metadata) {
      return null;
    }

    const previousEnvelope = envelope;
    const existingVaultDescriptor =
      envelope.metadata.vault && typeof envelope.metadata.vault === "object"
        ? envelope.metadata.vault
        : null;
    const nextEnvelope = {
      ...envelope,
      metadata: {
        ...envelope.metadata,
        vault: {
          localVaultId:
            typeof existingVaultDescriptor?.localVaultId === "string"
              ? existingVaultDescriptor.localVaultId
              : null,
          vaultGuid:
            typeof existingVaultDescriptor?.vaultGuid === "string"
              ? existingVaultDescriptor.vaultGuid
              : vaultId,
          name: vaultName,
          vaultKind:
            existingVaultDescriptor?.vaultKind === "private" ||
            envelope.metadata.payloadMode === "encrypted"
              ? "private"
              : "regular",
          schemaVersion:
            typeof existingVaultDescriptor?.schemaVersion === "number"
              ? existingVaultDescriptor.schemaVersion
              : 1
        }
      }
    };

    await this.writeEnvelope(vaultId, nextEnvelope);
    return previousEnvelope;
  }

  async stageDeletion(vaultId) {
    const operationId = randomUUID();
    const staged = [];
    const candidates = [
      ["state", this.getStateFile(vaultId)],
      ["journal", this.getJournalFile(vaultId)]
    ];

    try {
      for (const [kind, sourcePath] of candidates) {
        if (!(await fileExists(sourcePath))) {
          continue;
        }

        const targetPath = path.join(this.trashDir, `${vaultId}--${operationId}.${kind}.json`);
        await rename(sourcePath, targetPath);
        staged.push({ sourcePath, targetPath });
      }
    } catch (error) {
      await this.restoreDeletion(staged);
      throw error;
    }

    return staged;
  }

  async restoreDeletion(staged) {
    for (const entry of [...staged].reverse()) {
      if (await fileExists(entry.targetPath)) {
        await rename(entry.targetPath, entry.sourcePath);
      }
    }
  }

  async finalizeDeletion(staged) {
    await Promise.all(staged.map((entry) => rm(entry.targetPath, { force: true })));
  }

  async recoverInterruptedDeletions(existingVaultIds) {
    const knownVaultIds = new Set(existingVaultIds);
    const entries = await readdir(this.trashDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const match = entry.name.match(/^([a-z0-9-_]{1,64})--[a-f0-9-]+\.(state|journal)\.json$/i);
      if (!match) {
        continue;
      }

      const vaultId = match[1];
      const kind = match[2];
      const trashPath = path.join(this.trashDir, entry.name);

      if (!knownVaultIds.has(vaultId)) {
        await rm(trashPath, { force: true });
        continue;
      }

      const targetPath = kind === "state" ? this.getStateFile(vaultId) : this.getJournalFile(vaultId);

      if (await fileExists(targetPath)) {
        await rm(trashPath, { force: true });
      } else {
        await rename(trashPath, targetPath);
      }
    }
  }
}

export { pruneJournalByBytes };
