import { createHash, randomUUID } from "node:crypto";
import { chmod, open, readFile, rename } from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";

import { ensureDir, fileExists, now } from "../../packages/sync-core/common.mjs";

const DATABASE_FILE_NAME = "locoris-personal.sqlite3";
const MANAGEMENT_TOKEN_FILE_NAME = "management-token";
const LEGACY_CONFIG_FILE_NAME = "personal-config.json";
const LEGACY_REGISTRY_FILE_NAME = "registry.json";
const LEGACY_IMPORT_NAME = "legacy-json-v1";

function sanitizeVaultId(rawValue) {
  return String(rawValue ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function sanitizeDisplayName(rawValue, fallbackValue) {
  const candidate = String(rawValue ?? "").trim().slice(0, 120);
  return candidate || fallbackValue;
}

function normalizeVaultKind(value) {
  return value === "private" ? "private" : "regular";
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function createManagementToken() {
  return `zpm_${randomUUID().replace(/-/g, "")}`;
}

function mapVaultRow(row) {
  return {
    id: row.id,
    name: row.name,
    vaultKind: row.vault_kind,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRevision: row.last_revision ?? null,
    lastSyncAt: row.last_sync_at ?? null
  };
}

function mapTokenRow(row) {
  return {
    id: row.id,
    vaultId: row.vault_id,
    label: row.label,
    tokenHash: row.token_hash,
    deviceId: row.device_id ?? null,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at ?? null
  };
}

function mapDeviceRow(row, vaultAccess = []) {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    role: row.role,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at ?? null,
    revokedAt: row.revoked_at ?? null,
    vaultAccess
  };
}

function mapInviteRow(row, vaultAccess = []) {
  return {
    id: row.id,
    kind: row.kind,
    role: row.role,
    label: row.label,
    codeHint: row.code_hint,
    requiresApproval: Boolean(row.requires_approval),
    maxUses: row.max_uses,
    useCount: row.use_count,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at ?? null,
    vaultAccess
  };
}

function mapPairingRequestRow(row, vaultAccess = []) {
  return {
    id: row.id,
    inviteId: row.invite_id,
    deviceName: row.device_name,
    platform: row.platform,
    confirmationCode: row.confirmation_code,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at ?? null,
    deviceId: row.device_id ?? null,
    vaultAccess
  };
}

async function readJsonIfPresent(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }

  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readSecret(filePath) {
  if (!(await fileExists(filePath))) {
    return "";
  }

  return String(await readFile(filePath, "utf8")).trim();
}

async function writeSecret(filePath, value) {
  await ensureDir(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "w", 0o600);

  try {
    await handle.writeFile(`${value}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  await rename(temporaryPath, filePath);
  await chmod(filePath, 0o600).catch(() => undefined);
}

function normalizeLegacyRegistry(parsed) {
  const timestamp = now();
  const seenVaultIds = new Set();
  const seenTokenIds = new Set();
  const vaults = [];
  const tokens = [];

  for (const entry of Array.isArray(parsed?.vaults) ? parsed.vaults : []) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const id = sanitizeVaultId(entry.id);
    const name = sanitizeDisplayName(entry.name, "");

    if (!id || !name || seenVaultIds.has(id)) {
      continue;
    }

    seenVaultIds.add(id);
    vaults.push({
      id,
      name,
      vaultKind: normalizeVaultKind(entry.vaultKind),
      createdAt: typeof entry.createdAt === "number" ? entry.createdAt : timestamp,
      updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : timestamp,
      lastRevision: typeof entry.lastRevision === "string" ? entry.lastRevision : null,
      lastSyncAt: typeof entry.lastSyncAt === "number" ? entry.lastSyncAt : null
    });
  }

  for (const entry of Array.isArray(parsed?.tokens) ? parsed.tokens : []) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    const vaultId = sanitizeVaultId(entry.vaultId);
    const tokenHash = typeof entry.tokenHash === "string" ? entry.tokenHash.trim() : "";

    if (
      !id ||
      !vaultId ||
      !tokenHash ||
      !seenVaultIds.has(vaultId) ||
      seenTokenIds.has(id)
    ) {
      continue;
    }

    seenTokenIds.add(id);
    tokens.push({
      id,
      vaultId,
      label: sanitizeDisplayName(entry.label, "Client token"),
      tokenHash,
      createdAt: typeof entry.createdAt === "number" ? entry.createdAt : timestamp,
      lastUsedAt: typeof entry.lastUsedAt === "number" ? entry.lastUsedAt : null
    });
  }

  return { vaults, tokens };
}

export class PersonalServerStorage {
  constructor(dataDir, options = {}) {
    this.dataDir = dataDir;
    this.databaseFile = path.join(dataDir, DATABASE_FILE_NAME);
    this.managementTokenFile = path.join(dataDir, MANAGEMENT_TOKEN_FILE_NAME);
    this.legacyConfigFile = path.join(dataDir, LEGACY_CONFIG_FILE_NAME);
    this.legacyRegistryFile = path.join(dataDir, LEGACY_REGISTRY_FILE_NAME);
    this.envManagementToken = String(options.managementToken ?? "").trim();
    this.legacySyncToken = String(options.legacySyncToken ?? "").trim();
    this.database = null;
    this.managementToken = "";
    this.managementTokenWasGenerated = false;
    this.legacyImport = { imported: false, archivedFiles: [], warnings: [] };
  }

  async initialize() {
    await ensureDir(this.dataDir);
    this.database = new Database(this.databaseFile);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("busy_timeout = 5000");
    this.database.pragma("synchronous = NORMAL");
    this.createSchema();

    const integrity = this.database.pragma("quick_check", { simple: true });
    if (integrity !== "ok") {
      throw new Error(`SQLITE_INTEGRITY_CHECK_FAILED: ${integrity}`);
    }

    const legacyAlreadyImported = Boolean(
      this.database
        .prepare("SELECT 1 AS found FROM data_migrations WHERE name = ?")
        .get(LEGACY_IMPORT_NAME)
    );
    const legacyConfig = legacyAlreadyImported ? null : await readJsonIfPresent(this.legacyConfigFile);
    const legacyRegistry = legacyAlreadyImported ? null : await readJsonIfPresent(this.legacyRegistryFile);
    let persistedManagementToken = await readSecret(this.managementTokenFile);

    if (!persistedManagementToken) {
      const legacyManagementToken =
        legacyConfig && typeof legacyConfig.managementToken === "string"
          ? String(legacyConfig.managementToken).trim()
          : "";
      const storedManagementHash = this.getConfigValue("management_token_hash");

      if (legacyAlreadyImported && storedManagementHash && !this.envManagementToken) {
        throw new Error(
          "MANAGEMENT_TOKEN_SECRET_MISSING: restore management-token from the data-volume backup or set SYNC_MANAGEMENT_TOKEN"
        );
      }

      persistedManagementToken = this.envManagementToken || legacyManagementToken || createManagementToken();
      this.managementTokenWasGenerated = !this.envManagementToken && !legacyManagementToken;
      await writeSecret(this.managementTokenFile, persistedManagementToken);
    }

    this.managementToken = this.envManagementToken || persistedManagementToken;

    await this.importLegacyJsonOnce(legacyConfig, legacyRegistry, persistedManagementToken);
    this.ensureConfiguration(persistedManagementToken);

    return {
      config: this.getConfig(),
      registry: this.getRegistry(),
      databaseFile: this.databaseFile,
      managementTokenFile: this.managementTokenFile,
      managementTokenWasGenerated: this.managementTokenWasGenerated,
      legacyImport: this.legacyImport
    };
  }

  createSchema() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS data_migrations (
        name TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS server_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS vaults (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        vault_kind TEXT NOT NULL CHECK (vault_kind IN ('regular', 'private')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_revision TEXT,
        last_sync_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS vault_tokens (
        id TEXT PRIMARY KEY,
        vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS vault_tokens_vault_id_idx ON vault_tokens(vault_id);
      CREATE INDEX IF NOT EXISTS vault_tokens_last_used_at_idx ON vault_tokens(last_used_at);

      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'guest')),
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        revoked_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS device_vault_access (
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
        permission TEXT NOT NULL CHECK (permission IN ('read', 'write')),
        PRIMARY KEY(device_id, vault_id)
      );

      CREATE TABLE IF NOT EXISTS device_vault_tokens (
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        token_id TEXT NOT NULL REFERENCES vault_tokens(id) ON DELETE CASCADE,
        PRIMARY KEY(device_id, token_id)
      );

      CREATE TABLE IF NOT EXISTS pairing_invites (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('bootstrap', 'owner_device', 'guest')),
        role TEXT NOT NULL CHECK (role IN ('owner', 'guest')),
        label TEXT NOT NULL,
        code_hash TEXT NOT NULL UNIQUE,
        code_hint TEXT NOT NULL,
        secret_hash TEXT NOT NULL UNIQUE,
        requires_approval INTEGER NOT NULL DEFAULT 0,
        max_uses INTEGER NOT NULL DEFAULT 1,
        use_count INTEGER NOT NULL DEFAULT 0,
        created_by_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS pairing_invite_vaults (
        invite_id TEXT NOT NULL REFERENCES pairing_invites(id) ON DELETE CASCADE,
        vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
        permission TEXT NOT NULL CHECK (permission IN ('read', 'write')),
        PRIMARY KEY(invite_id, vault_id)
      );

      CREATE TABLE IF NOT EXISTS pairing_requests (
        id TEXT PRIMARY KEY,
        invite_id TEXT NOT NULL REFERENCES pairing_invites(id) ON DELETE CASCADE,
        claim_hash TEXT NOT NULL UNIQUE,
        device_token_hash TEXT NOT NULL UNIQUE,
        device_name TEXT NOT NULL,
        platform TEXT NOT NULL,
        confirmation_code TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'claimed', 'expired')),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        resolved_at INTEGER,
        device_id TEXT REFERENCES devices(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS devices_token_hash_idx ON devices(token_hash);
      CREATE INDEX IF NOT EXISTS devices_last_used_at_idx ON devices(last_used_at);
      CREATE INDEX IF NOT EXISTS pairing_invites_expiry_idx ON pairing_invites(expires_at, revoked_at);
      CREATE INDEX IF NOT EXISTS pairing_requests_status_idx ON pairing_requests(status, expires_at);
    `);

    this.database
      .prepare("INSERT OR IGNORE INTO schema_migrations(version, name, applied_at) VALUES(1, ?, ?)")
      .run("sqlite-metadata-v1", now());
    this.database
      .prepare("INSERT OR IGNORE INTO schema_migrations(version, name, applied_at) VALUES(2, ?, ?)")
      .run("device-pairing-v2", now());
  }

  async importLegacyJsonOnce(legacyConfig, legacyRegistry, persistedManagementToken) {
    const alreadyImported = this.database
      .prepare("SELECT 1 AS found FROM data_migrations WHERE name = ?")
      .get(LEGACY_IMPORT_NAME);

    if (alreadyImported) {
      return;
    }

    const timestamp = now();
    const normalizedRegistry = normalizeLegacyRegistry(legacyRegistry);
    const storedDefaultVaultId =
      legacyConfig && typeof legacyConfig.defaultVaultId === "string"
        ? sanitizeVaultId(legacyConfig.defaultVaultId)
        : "";
    const legacyVaultId =
      legacyConfig && typeof legacyConfig.vaultId === "string"
        ? sanitizeVaultId(legacyConfig.vaultId)
        : "";
    const requestedDefaultVaultId = storedDefaultVaultId || legacyVaultId;
    const storedDefaultVaultName =
      legacyConfig && typeof legacyConfig.defaultVaultName === "string"
        ? sanitizeDisplayName(legacyConfig.defaultVaultName, "Default vault")
        : "";
    const legacyVaultToken =
      this.legacySyncToken ||
      (legacyConfig && typeof legacyConfig.token === "string"
        ? String(legacyConfig.token).trim()
        : "");
    const vaults = [...normalizedRegistry.vaults];
    const tokens = [...normalizedRegistry.tokens];

    if (requestedDefaultVaultId && !vaults.some((vault) => vault.id === requestedDefaultVaultId)) {
      vaults.push({
        id: requestedDefaultVaultId,
        name: storedDefaultVaultName || "Default vault",
        vaultKind: "regular",
        createdAt: timestamp,
        updatedAt: timestamp,
        lastRevision: null,
        lastSyncAt: null
      });
    }

    const defaultVaultId =
      (storedDefaultVaultId && vaults.some((vault) => vault.id === storedDefaultVaultId)
        ? storedDefaultVaultId
        : "") ||
      (requestedDefaultVaultId && vaults.some((vault) => vault.id === requestedDefaultVaultId)
        ? requestedDefaultVaultId
        : "") ||
      (vaults[0]?.id ?? "");

    if (legacyVaultToken && defaultVaultId) {
      const tokenHash = hashToken(legacyVaultToken);
      if (!tokens.some((token) => token.tokenHash === tokenHash)) {
        tokens.push({
          id: `legacy-${defaultVaultId}`,
          vaultId: defaultVaultId,
          label: "Legacy default token",
          tokenHash,
          createdAt: timestamp,
          lastUsedAt: null
        });
      }
    }

    const insertVault = this.database.prepare(`
      INSERT OR IGNORE INTO vaults(
        id, name, vault_kind, created_at, updated_at, last_revision, last_sync_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?)
    `);
    const insertToken = this.database.prepare(`
      INSERT OR IGNORE INTO vault_tokens(
        id, vault_id, label, token_hash, created_at, last_used_at
      ) VALUES(?, ?, ?, ?, ?, ?)
    `);
    const setConfig = this.database.prepare(`
      INSERT INTO server_config(key, value, updated_at) VALUES(?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    const migrate = this.database.transaction(() => {
      for (const vault of vaults) {
        insertVault.run(
          vault.id,
          vault.name,
          vault.vaultKind,
          vault.createdAt,
          vault.updatedAt,
          vault.lastRevision,
          vault.lastSyncAt
        );
      }

      for (const token of tokens) {
        insertToken.run(
          token.id,
          token.vaultId,
          token.label,
          token.tokenHash,
          token.createdAt,
          token.lastUsedAt
        );
      }

      setConfig.run("default_vault_id", defaultVaultId, timestamp);
      setConfig.run(
        "created_at",
        String(
          legacyConfig && typeof legacyConfig.createdAt === "number"
            ? legacyConfig.createdAt
            : timestamp
        ),
        timestamp
      );
      setConfig.run("management_token_hash", hashToken(persistedManagementToken), timestamp);
      this.database
        .prepare("INSERT INTO data_migrations(name, applied_at) VALUES(?, ?)")
        .run(LEGACY_IMPORT_NAME, timestamp);
    });

    migrate();
    const legacyFiles = [];
    if (legacyConfig) legacyFiles.push(this.legacyConfigFile);
    if (legacyRegistry) legacyFiles.push(this.legacyRegistryFile);

    this.legacyImport.imported = legacyFiles.length > 0;
    this.legacyImport.archivedFiles = await this.archiveLegacyFiles(legacyFiles, timestamp);
  }

  async archiveLegacyFiles(filePaths, timestamp) {
    if (filePaths.length === 0) {
      return [];
    }

    const archiveDir = path.join(this.dataDir, "legacy-json", String(timestamp));
    await ensureDir(archiveDir);
    const archivedFiles = [];

    for (const sourcePath of filePaths) {
      const targetPath = path.join(archiveDir, path.basename(sourcePath));
      try {
        await rename(sourcePath, targetPath);
        archivedFiles.push(targetPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.legacyImport.warnings.push(`Could not archive ${sourcePath}: ${message}`);
      }
    }

    return archivedFiles;
  }

  ensureConfiguration(persistedManagementToken) {
    const timestamp = now();
    const setConfig = this.database.prepare(`
      INSERT INTO server_config(key, value, updated_at) VALUES(?, ?, ?)
      ON CONFLICT(key) DO NOTHING
    `);
    setConfig.run("default_vault_id", this.getRegistry().vaults[0]?.id ?? "", timestamp);
    setConfig.run("created_at", String(timestamp), timestamp);
    setConfig.run("management_token_hash", hashToken(persistedManagementToken), timestamp);
    setConfig.run("server_id", randomUUID(), timestamp);
  }

  getConfigValue(key, fallbackValue = "") {
    const row = this.database.prepare("SELECT value FROM server_config WHERE key = ?").get(key);
    return row ? row.value : fallbackValue;
  }

  setConfigValue(key, value) {
    this.database
      .prepare(`
        INSERT INTO server_config(key, value, updated_at) VALUES(?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `)
      .run(key, String(value), now());
  }

  getConfig() {
    const registry = this.getRegistry();
    const storedDefaultVaultId = sanitizeVaultId(this.getConfigValue("default_vault_id"));
    const defaultVault =
      registry.vaults.find((vault) => vault.id === storedDefaultVaultId) ?? registry.vaults[0] ?? null;

    if ((defaultVault?.id ?? "") !== storedDefaultVaultId) {
      this.setConfigValue("default_vault_id", defaultVault?.id ?? "");
    }

    return {
      mode: "personal",
      managementToken: this.managementToken,
      serverId: this.getConfigValue("server_id"),
      defaultVaultId: defaultVault?.id ?? "",
      defaultVaultName: defaultVault?.name ?? "",
      createdAt: Number.parseInt(this.getConfigValue("created_at", String(now())), 10),
      updatedAt: now()
    };
  }

  isManagementTokenAuthorized(tokenValue) {
    return Boolean(this.findManagementPrincipal(tokenValue));
  }

  getVaultAccessForDevice(deviceId) {
    return this.database
      .prepare(`
        SELECT vault_id AS vaultId, permission
        FROM device_vault_access
        WHERE device_id = ?
        ORDER BY vault_id ASC
      `)
      .all(deviceId);
  }

  findManagementPrincipal(tokenValue) {
    if (!tokenValue) {
      return null;
    }

    if (hashToken(tokenValue) === hashToken(this.managementToken)) {
      return {
        type: "legacy",
        role: "owner",
        deviceId: null,
        vaultAccess: []
      };
    }

    const row = this.database
      .prepare("SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL")
      .get(hashToken(tokenValue));

    if (!row) {
      return null;
    }

    this.database
      .prepare(`
        UPDATE devices
        SET last_used_at = ?
        WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)
      `)
      .run(now(), row.id, now() - 60_000);

    return {
      type: "device",
      role: row.role,
      deviceId: row.id,
      vaultAccess: this.getVaultAccessForDevice(row.id)
    };
  }

  canPrincipalManageServer(principal) {
    return principal?.role === "owner";
  }

  canPrincipalAccessVault(principal, vaultId, permission = "read") {
    if (!principal) {
      return false;
    }

    if (principal.role === "owner") {
      return true;
    }

    const access = principal.vaultAccess.find((entry) => entry.vaultId === vaultId);
    return Boolean(access && (permission === "read" || access.permission === "write"));
  }

  listVaultsForPrincipal(principal) {
    const vaults = this.getRegistry().vaults;
    return principal?.role === "owner"
      ? vaults
      : vaults.filter((vault) => this.canPrincipalAccessVault(principal, vault.id));
  }

  getRegistry() {
    return {
      schemaVersion: 2,
      vaults: this.database
        .prepare("SELECT * FROM vaults ORDER BY created_at ASC, id ASC")
        .all()
        .map(mapVaultRow),
      tokens: this.database
        .prepare("SELECT * FROM vault_tokens ORDER BY created_at ASC, id ASC")
        .all()
        .map(mapTokenRow)
    };
  }

  getVault(vaultId) {
    const row = this.database.prepare("SELECT * FROM vaults WHERE id = ?").get(vaultId);
    return row ? mapVaultRow(row) : null;
  }

  findVaultToken(vaultId, tokenValue) {
    if (!tokenValue) {
      return null;
    }

    const row = this.database
      .prepare(`
        SELECT vault_tokens.*, device_vault_tokens.device_id
        FROM vault_tokens
        LEFT JOIN device_vault_tokens ON device_vault_tokens.token_id = vault_tokens.id
        WHERE vault_tokens.vault_id = ? AND vault_tokens.token_hash = ?
      `)
      .get(vaultId, hashToken(tokenValue));
    return row ? mapTokenRow(row) : null;
  }

  canVaultTokenWrite(tokenRecord) {
    if (!tokenRecord?.deviceId) {
      return true;
    }

    const device = this.database
      .prepare("SELECT role, revoked_at FROM devices WHERE id = ?")
      .get(tokenRecord.deviceId);

    if (!device || device.revoked_at) {
      return false;
    }

    if (device.role === "owner") {
      return true;
    }

    const access = this.database
      .prepare("SELECT permission FROM device_vault_access WHERE device_id = ? AND vault_id = ?")
      .get(tokenRecord.deviceId, tokenRecord.vaultId);
    return access?.permission === "write";
  }

  markTokenUsed(tokenId, timestamp = now()) {
    this.database
      .prepare(`
        UPDATE vault_tokens
        SET last_used_at = ?
        WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)
      `)
      .run(timestamp, tokenId, timestamp - 60_000);
  }

  createVault({ id, name, vaultKind = "regular" }) {
    const timestamp = now();

    try {
      this.database
        .prepare(`
          INSERT INTO vaults(
            id, name, vault_kind, created_at, updated_at, last_revision, last_sync_at
          ) VALUES(?, ?, ?, ?, ?, NULL, NULL)
        `)
        .run(id, name, normalizeVaultKind(vaultKind), timestamp, timestamp);

      if (!this.getConfigValue("default_vault_id")) {
        this.setConfigValue("default_vault_id", id);
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
        return { statusCode: 409, error: "VAULT_ALREADY_EXISTS" };
      }
      throw error;
    }

    return { statusCode: 201, vault: this.getVault(id) };
  }

  renameVault(vaultId, name) {
    const result = this.database
      .prepare("UPDATE vaults SET name = ?, updated_at = ? WHERE id = ?")
      .run(name, now(), vaultId);
    return result.changes > 0 ? this.getVault(vaultId) : null;
  }

  deleteVault(vaultId) {
    const remove = this.database.transaction(() => {
      const vault = this.getVault(vaultId);
      if (!vault) {
        return { statusCode: 404, error: "VAULT_NOT_FOUND" };
      }

      const vaultCount = this.database.prepare("SELECT COUNT(*) AS count FROM vaults").get().count;
      if (vaultCount <= 1) {
        return { statusCode: 409, error: "LAST_VAULT_REQUIRED" };
      }

      this.database.prepare("DELETE FROM vaults WHERE id = ?").run(vaultId);

      if (this.getConfigValue("default_vault_id") === vaultId) {
        const nextVault = this.database
          .prepare("SELECT id FROM vaults ORDER BY created_at ASC, id ASC LIMIT 1")
          .get();
        this.setConfigValue("default_vault_id", nextVault?.id ?? "");
      }

      return { statusCode: 200, vaultId };
    });

    return remove();
  }

  issueVaultToken(vaultId, label, tokenValue, deviceId = null) {
    if (!this.getVault(vaultId)) {
      return { statusCode: 404, error: "VAULT_NOT_FOUND" };
    }

    const token = {
      id: randomUUID(),
      vaultId,
      label,
      tokenHash: hashToken(tokenValue),
      createdAt: now(),
      lastUsedAt: null
    };
    const issue = this.database.transaction(() => {
      this.database
        .prepare(`
          INSERT INTO vault_tokens(id, vault_id, label, token_hash, created_at, last_used_at)
          VALUES(?, ?, ?, ?, ?, NULL)
        `)
        .run(token.id, token.vaultId, token.label, token.tokenHash, token.createdAt);

      if (deviceId) {
        this.database
          .prepare("INSERT INTO device_vault_tokens(device_id, token_id) VALUES(?, ?)")
          .run(deviceId, token.id);
      }
    });
    issue();
    return { statusCode: 201, tokenRecord: token };
  }

  countActiveOwnerDevices() {
    return this.database
      .prepare("SELECT COUNT(*) AS count FROM devices WHERE role = 'owner' AND revoked_at IS NULL")
      .get().count;
  }

  createPairingInvite(input) {
    const invite = {
      id: input.id ?? randomUUID(),
      kind: input.kind,
      role: input.role,
      label: input.label,
      codeHash: hashToken(input.code),
      codeHint: input.code.slice(-4),
      secretHash: hashToken(input.secret),
      requiresApproval: input.requiresApproval ? 1 : 0,
      maxUses: Math.max(1, input.maxUses ?? 1),
      createdByDeviceId: input.createdByDeviceId ?? null,
      createdAt: input.createdAt ?? now(),
      expiresAt: input.expiresAt,
      vaultAccess: input.vaultAccess ?? []
    };

    const insert = this.database.transaction(() => {
      if (invite.kind === "bootstrap") {
        this.database
          .prepare("UPDATE pairing_invites SET revoked_at = ? WHERE kind = 'bootstrap' AND revoked_at IS NULL")
          .run(now());
      }

      this.database
        .prepare(`
          INSERT INTO pairing_invites(
            id, kind, role, label, code_hash, code_hint, secret_hash, requires_approval,
            max_uses, use_count, created_by_device_id, created_at, expires_at, revoked_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL)
        `)
        .run(
          invite.id,
          invite.kind,
          invite.role,
          invite.label,
          invite.codeHash,
          invite.codeHint,
          invite.secretHash,
          invite.requiresApproval,
          invite.maxUses,
          invite.createdByDeviceId,
          invite.createdAt,
          invite.expiresAt
        );

      const insertAccess = this.database.prepare(`
        INSERT INTO pairing_invite_vaults(invite_id, vault_id, permission)
        VALUES(?, ?, ?)
      `);
      for (const access of invite.vaultAccess) {
        insertAccess.run(invite.id, access.vaultId, access.permission === "read" ? "read" : "write");
      }
    });
    insert();
    return this.getPairingInvite(invite.id);
  }

  getInviteVaultAccess(inviteId) {
    return this.database
      .prepare(`
        SELECT vault_id AS vaultId, permission
        FROM pairing_invite_vaults
        WHERE invite_id = ?
        ORDER BY vault_id ASC
      `)
      .all(inviteId);
  }

  getPairingInvite(inviteId) {
    const row = this.database.prepare("SELECT * FROM pairing_invites WHERE id = ?").get(inviteId);
    return row ? mapInviteRow(row, this.getInviteVaultAccess(row.id)) : null;
  }

  findActivePairingInvite({ code = "", secret = "" }) {
    const timestamp = now();
    const normalizedCode = String(code).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const normalizedSecret = String(secret).trim();

    if (!normalizedCode && !normalizedSecret) {
      return null;
    }

    const row = normalizedSecret
      ? this.database
          .prepare(`
            SELECT * FROM pairing_invites
            WHERE secret_hash = ? AND revoked_at IS NULL AND expires_at > ? AND use_count < max_uses
          `)
          .get(hashToken(normalizedSecret), timestamp)
      : this.database
          .prepare(`
            SELECT * FROM pairing_invites
            WHERE code_hash = ? AND revoked_at IS NULL AND expires_at > ? AND use_count < max_uses
          `)
          .get(hashToken(normalizedCode), timestamp);

    return row ? mapInviteRow(row, this.getInviteVaultAccess(row.id)) : null;
  }

  createDeviceFromInvite(invite, input) {
    const timestamp = now();
    const deviceId = input.deviceId ?? randomUUID();
    const create = this.database.transaction(() => {
      const consumed = this.database
        .prepare(`
          UPDATE pairing_invites
          SET use_count = use_count + 1
          WHERE id = ? AND revoked_at IS NULL AND expires_at > ? AND use_count < max_uses
        `)
        .run(invite.id, timestamp);

      if (consumed.changes === 0) {
        throw new Error("PAIRING_INVITE_UNAVAILABLE");
      }

      this.database
        .prepare(`
          INSERT INTO devices(id, name, platform, role, token_hash, created_at, last_used_at, revoked_at)
          VALUES(?, ?, ?, ?, ?, ?, NULL, NULL)
        `)
        .run(
          deviceId,
          input.deviceName,
          input.platform,
          invite.role,
          input.deviceTokenHash,
          timestamp
        );

      const grant = this.database.prepare(`
        INSERT INTO device_vault_access(device_id, vault_id, permission)
        VALUES(?, ?, ?)
      `);
      for (const access of invite.vaultAccess) {
        grant.run(deviceId, access.vaultId, access.permission);
      }
    });
    create();
    return this.getDevice(deviceId);
  }

  createPairingRequest(invite, input) {
    const timestamp = now();
    const request = {
      id: randomUUID(),
      inviteId: invite.id,
      claimHash: hashToken(input.claimSecret),
      deviceTokenHash: hashToken(input.deviceSecret),
      deviceName: input.deviceName,
      platform: input.platform,
      confirmationCode: input.confirmationCode,
      status: "pending",
      createdAt: timestamp,
      expiresAt: Math.min(invite.expiresAt, timestamp + 24 * 60 * 60 * 1000)
    };

    const create = this.database.transaction(() => {
      const consumed = this.database
        .prepare(`
          UPDATE pairing_invites
          SET use_count = use_count + 1
          WHERE id = ? AND revoked_at IS NULL AND expires_at > ? AND use_count < max_uses
        `)
        .run(invite.id, timestamp);
      if (consumed.changes === 0) {
        throw new Error("PAIRING_INVITE_UNAVAILABLE");
      }

      this.database
        .prepare(`
          INSERT INTO pairing_requests(
            id, invite_id, claim_hash, device_token_hash, device_name, platform,
            confirmation_code, status, created_at, expires_at, resolved_at, device_id
          ) VALUES(?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL)
        `)
        .run(
          request.id,
          request.inviteId,
          request.claimHash,
          request.deviceTokenHash,
          request.deviceName,
          request.platform,
          request.confirmationCode,
          request.createdAt,
          request.expiresAt
        );
    });
    create();
    return this.getPairingRequest(request.id);
  }

  getPairingRequest(requestId) {
    const row = this.database.prepare("SELECT * FROM pairing_requests WHERE id = ?").get(requestId);
    return row ? mapPairingRequestRow(row, this.getInviteVaultAccess(row.invite_id)) : null;
  }

  getPairingRequestByClaim(requestId, claimSecret) {
    const row = this.database
      .prepare("SELECT * FROM pairing_requests WHERE id = ? AND claim_hash = ?")
      .get(requestId, hashToken(claimSecret));
    if (!row) {
      return null;
    }

    if (row.status === "pending" && row.expires_at <= now()) {
      this.database
        .prepare("UPDATE pairing_requests SET status = 'expired', resolved_at = ? WHERE id = ?")
        .run(now(), row.id);
      row.status = "expired";
      row.resolved_at = now();
    }

    return mapPairingRequestRow(row, this.getInviteVaultAccess(row.invite_id));
  }

  decidePairingRequest(requestId, approve) {
    const resolve = this.database.transaction(() => {
      const row = this.database.prepare("SELECT * FROM pairing_requests WHERE id = ?").get(requestId);
      if (!row) {
        return { error: "PAIRING_REQUEST_NOT_FOUND" };
      }
      if (row.status !== "pending") {
        return { error: "PAIRING_REQUEST_ALREADY_RESOLVED" };
      }
      if (row.expires_at <= now()) {
        this.database
          .prepare("UPDATE pairing_requests SET status = 'expired', resolved_at = ? WHERE id = ?")
          .run(now(), row.id);
        return { error: "PAIRING_REQUEST_EXPIRED" };
      }

      if (!approve) {
        this.database
          .prepare("UPDATE pairing_requests SET status = 'denied', resolved_at = ? WHERE id = ?")
          .run(now(), row.id);
        return { request: this.getPairingRequest(row.id) };
      }

      const invite = this.getPairingInvite(row.invite_id);
      const deviceId = randomUUID();
      this.database
        .prepare(`
          INSERT INTO devices(id, name, platform, role, token_hash, created_at, last_used_at, revoked_at)
          VALUES(?, ?, ?, ?, ?, ?, NULL, NULL)
        `)
        .run(deviceId, row.device_name, row.platform, invite.role, row.device_token_hash, now());
      const grant = this.database.prepare(`
        INSERT INTO device_vault_access(device_id, vault_id, permission)
        VALUES(?, ?, ?)
      `);
      for (const access of invite.vaultAccess) {
        grant.run(deviceId, access.vaultId, access.permission);
      }
      this.database
        .prepare(`
          UPDATE pairing_requests
          SET status = 'approved', resolved_at = ?, device_id = ?
          WHERE id = ?
        `)
        .run(now(), deviceId, row.id);
      return { request: this.getPairingRequest(row.id), device: this.getDevice(deviceId) };
    });

    return resolve();
  }

  listPairingRequests() {
    const timestamp = now();
    this.database
      .prepare(`
        UPDATE pairing_requests
        SET status = 'expired', resolved_at = ?
        WHERE status = 'pending' AND expires_at <= ?
      `)
      .run(timestamp, timestamp);
    return this.database
      .prepare("SELECT * FROM pairing_requests ORDER BY created_at DESC")
      .all()
      .map((row) => mapPairingRequestRow(row, this.getInviteVaultAccess(row.invite_id)));
  }

  listPairingInvites() {
    return this.database
      .prepare("SELECT * FROM pairing_invites ORDER BY created_at DESC")
      .all()
      .map((row) => mapInviteRow(row, this.getInviteVaultAccess(row.id)));
  }

  revokePairingInvite(inviteId) {
    const result = this.database
      .prepare("UPDATE pairing_invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(now(), inviteId);
    return result.changes > 0;
  }

  getDevice(deviceId) {
    const row = this.database.prepare("SELECT * FROM devices WHERE id = ?").get(deviceId);
    return row ? mapDeviceRow(row, this.getVaultAccessForDevice(row.id)) : null;
  }

  listDevices() {
    return this.database
      .prepare("SELECT * FROM devices ORDER BY created_at ASC")
      .all()
      .map((row) => mapDeviceRow(row, this.getVaultAccessForDevice(row.id)));
  }

  revokeDevice(deviceId, currentDeviceId = null) {
    if (deviceId === currentDeviceId) {
      return { error: "CURRENT_DEVICE_REVOKE_FORBIDDEN" };
    }

    const device = this.getDevice(deviceId);
    if (!device) {
      return { error: "DEVICE_NOT_FOUND" };
    }
    if (device.revokedAt) {
      return { device };
    }
    if (device.role === "owner" && this.countActiveOwnerDevices() <= 1) {
      return { error: "LAST_OWNER_DEVICE_REQUIRED" };
    }

    const revoke = this.database.transaction(() => {
      this.database.prepare("UPDATE devices SET revoked_at = ? WHERE id = ?").run(now(), deviceId);
      this.database
        .prepare(`
          DELETE FROM vault_tokens
          WHERE id IN (SELECT token_id FROM device_vault_tokens WHERE device_id = ?)
        `)
        .run(deviceId);
    });
    revoke();
    return { device: this.getDevice(deviceId) };
  }

  updateVaultMeta(vaultId, patch) {
    const current = this.getVault(vaultId);
    if (!current) {
      return null;
    }

    this.database
      .prepare(`
        UPDATE vaults
        SET vault_kind = ?, last_revision = ?, last_sync_at = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        normalizeVaultKind(patch.vaultKind ?? current.vaultKind),
        Object.hasOwn(patch, "lastRevision") ? patch.lastRevision : current.lastRevision,
        Object.hasOwn(patch, "lastSyncAt") ? patch.lastSyncAt : current.lastSyncAt,
        now(),
        vaultId
      );
    return this.getVault(vaultId);
  }

  getHealth() {
    return {
      backend: "sqlite-files",
      schemaVersion: 2,
      journalMode: this.database.pragma("journal_mode", { simple: true })
    };
  }

  close() {
    if (!this.database?.open) {
      return;
    }

    this.database.pragma("wal_checkpoint(TRUNCATE)");
    this.database.close();
  }
}

export {
  DATABASE_FILE_NAME,
  MANAGEMENT_TOKEN_FILE_NAME,
  hashToken,
  sanitizeDisplayName,
  sanitizeVaultId
};
