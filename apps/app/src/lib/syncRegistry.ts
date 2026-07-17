import type {
  AppSettings,
  SyncConnection,
  SyncConnectionRole,
  SyncConnectionProvider,
  SelfHostedDeviceRole,
  SyncVaultBinding
} from "../types";
import {
  clearSyncBindingSecrets,
  clearSyncConnectionSecrets,
  buildSyncBindingSecretKey,
  buildSyncConnectionSecretKey,
  hydrateCachedSyncBinding,
  hydrateCachedSyncConnection,
  preloadSecureSecrets,
  readCachedSecureSecret,
  writeSecureSecret
} from "./secureSecretStore";
import {
  readPersistentString,
  writePersistentString
} from "./persistentClientStorage";

// Legacy storage key. Rename only with a migration that preserves existing sync bindings.
const SYNC_REGISTRY_STORAGE_KEY = "zen-notes.sync-registry";
const SYNC_REGISTRY_VERSION = 1;

type PersistedSyncConnection = Omit<SyncConnection, "managementToken" | "sessionToken" | "refreshToken">;
type PersistedSyncVaultBinding = Omit<SyncVaultBinding, "syncToken">;

interface SyncRegistryState {
  version: number;
  connections: PersistedSyncConnection[];
  bindings: PersistedSyncVaultBinding[];
}

function now() {
  return Date.now();
}

function sanitizeProvider(value: unknown): SyncConnectionProvider | null {
  return value === "selfHosted" || value === "hosted" || value === "googleDrive" ? value : null;
}

function sanitizeConnectionRole(value: unknown): SyncConnectionRole {
  return value === "locorisCloud" ? "locorisCloud" : "external";
}

function sanitizeSelfHostedDeviceRole(value: unknown): SelfHostedDeviceRole | null {
  return value === "owner" || value === "guest" ? value : null;
}

function sanitizeText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function createEmptyRegistry(): SyncRegistryState {
  return {
    version: SYNC_REGISTRY_VERSION,
    connections: [],
    bindings: []
  };
}

function normalizeConnection(entry: unknown): PersistedSyncConnection | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const provider = sanitizeProvider(record.provider);
  const id = sanitizeText(record.id, 80);
  const label = sanitizeText(record.label, 120);
  const serverUrl = sanitizeText(record.serverUrl, 512);

  if (!provider || !id || !label || !serverUrl) {
    return null;
  }

  const timestamp = now();

  return {
    id,
    provider,
    role: sanitizeConnectionRole(record.role),
    label,
    serverUrl,
    tokenExpiresAt: typeof record.tokenExpiresAt === "number" ? record.tokenExpiresAt : null,
    userId: sanitizeText(record.userId, 120) || null,
    userName: sanitizeText(record.userName, 160),
    userEmail: sanitizeText(record.userEmail, 160),
    changePageToken: sanitizeText(record.changePageToken, 2048) || null,
    selfHostedDeviceId: sanitizeText(record.selfHostedDeviceId, 120) || null,
    selfHostedRole: sanitizeSelfHostedDeviceRole(record.selfHostedRole),
    selfHostedServerId: sanitizeText(record.selfHostedServerId, 120) || null,
    createdAt: typeof record.createdAt === "number" ? record.createdAt : timestamp,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : timestamp
  };
}

function normalizeBinding(entry: unknown, connectionIds: Set<string>): PersistedSyncVaultBinding | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const id = sanitizeText(record.id, 120);
  const localVaultId = sanitizeText(record.localVaultId, 120);
  const connectionId = sanitizeText(record.connectionId, 120);
  const remoteVaultId = sanitizeText(record.remoteVaultId, 120);

  if (!id || !localVaultId || !connectionId || !remoteVaultId || !connectionIds.has(connectionId)) {
    return null;
  }

  const timestamp = now();
  const status =
    record.syncStatus === "idle" ||
    record.syncStatus === "syncing" ||
    record.syncStatus === "error" ||
    record.syncStatus === "disabled"
      ? record.syncStatus
      : "idle";

  return {
    id,
    localVaultId,
    connectionId,
    remoteVaultId,
    remoteVaultName: sanitizeText(record.remoteVaultName, 160) || remoteVaultId,
    syncStatus: status,
    lastSyncAt: typeof record.lastSyncAt === "number" ? record.lastSyncAt : null,
    syncCursor: sanitizeText(record.syncCursor, 160) || null,
    lastError: sanitizeText(record.lastError, 240) || null,
    createdAt: typeof record.createdAt === "number" ? record.createdAt : timestamp,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : timestamp
  };
}

function normalizeRegistryState(value: unknown): SyncRegistryState {
  if (!value || typeof value !== "object") {
    return createEmptyRegistry();
  }

  const record = value as Record<string, unknown>;
  const connections = Array.isArray(record.connections)
    ? record.connections.map(normalizeConnection).filter(Boolean) as PersistedSyncConnection[]
    : [];
  const connectionIds = new Set(connections.map((connection) => connection.id));
  const bindings = Array.isArray(record.bindings)
    ? record.bindings
        .map((entry) => normalizeBinding(entry, connectionIds))
        .filter(Boolean) as PersistedSyncVaultBinding[]
    : [];

  return {
    version: SYNC_REGISTRY_VERSION,
    connections: connections.sort((left, right) => left.createdAt - right.createdAt),
    bindings: bindings.sort((left, right) => left.createdAt - right.createdAt)
  };
}

function readRegistryFromStorage() {
  const raw = readPersistentString(SYNC_REGISTRY_STORAGE_KEY);

  if (!raw) {
    const fallback = createEmptyRegistry();
    writePersistentString(SYNC_REGISTRY_STORAGE_KEY, JSON.stringify(fallback));
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw);
    const normalized = normalizeRegistryState(parsed);
    writePersistentString(SYNC_REGISTRY_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    const fallback = createEmptyRegistry();
    writePersistentString(SYNC_REGISTRY_STORAGE_KEY, JSON.stringify(fallback));
    return fallback;
  }
}

function writeRegistryToStorage(state: SyncRegistryState) {
  writePersistentString(SYNC_REGISTRY_STORAGE_KEY, JSON.stringify(state));
  return state;
}

function writeNormalizedRegistry(state: SyncRegistryState) {
  return writeRegistryToStorage({
    version: SYNC_REGISTRY_VERSION,
    connections: [...state.connections].sort((left, right) => left.createdAt - right.createdAt),
    bindings: [...state.bindings].sort((left, right) => left.createdAt - right.createdAt)
  });
}

function buildConnectionLabel(provider: SyncConnectionProvider, serverUrl: string) {
  try {
    const hostname = new URL(serverUrl).hostname;

    if (provider === "hosted") {
      return `Locoris Cloud · ${hostname}`;
    }

    if (provider === "selfHosted") {
      return `Self-hosted · ${hostname}`;
    }

    return `Google Drive · ${hostname}`;
  } catch {
    return provider === "hosted" ? "Locoris Cloud" : provider === "selfHosted" ? "Self-hosted" : "Google Drive";
  }
}

function toRuntimeConnection(connection: PersistedSyncConnection): SyncConnection {
  return hydrateCachedSyncConnection({
    ...connection,
    managementToken: "",
    sessionToken: "",
    refreshToken: ""
  });
}

function toRuntimeBinding(binding: PersistedSyncVaultBinding): SyncVaultBinding {
  return hydrateCachedSyncBinding({
    ...binding,
    syncToken: ""
  });
}

function toPersistedConnection(connection: SyncConnection): PersistedSyncConnection {
  const {
    managementToken: _managementToken,
    sessionToken: _sessionToken,
    refreshToken: _refreshToken,
    ...persisted
  } = connection;
  return persisted;
}

function toPersistedBinding(binding: SyncVaultBinding): PersistedSyncVaultBinding {
  const { syncToken: _syncToken, ...persisted } = binding;
  return persisted;
}

export function getSyncRegistry() {
  return readRegistryFromStorage();
}

export async function initializeSecureSyncRegistryState() {
  const registry = getSyncRegistry();

  await preloadSecureSecrets([
    ...registry.connections.flatMap((connection) => [
      buildSyncConnectionSecretKey(connection.id, "managementToken"),
      buildSyncConnectionSecretKey(connection.id, "sessionToken"),
      buildSyncConnectionSecretKey(connection.id, "refreshToken")
    ]),
    ...registry.bindings.map((binding) =>
      buildSyncBindingSecretKey(binding.id, "syncToken")
    )
  ]);

  return registry;
}

export function listSyncConnections() {
  return getSyncRegistry().connections.map((connection) => toRuntimeConnection(connection));
}

export function listSyncBindings() {
  return getSyncRegistry().bindings.map((binding) => toRuntimeBinding(binding));
}

export function getSyncBindingForVault(localVaultId: string) {
  return listSyncBindings().find((binding) => binding.localVaultId === localVaultId) ?? null;
}

export async function createSyncConnection(input: {
  provider: SyncConnectionProvider;
  role?: SyncConnectionRole;
  serverUrl: string;
  label?: string;
  managementToken?: string;
  sessionToken?: string;
  refreshToken?: string | null;
  tokenExpiresAt?: number | null;
  userId?: string | null;
  userName?: string;
  userEmail?: string;
  changePageToken?: string | null;
  selfHostedDeviceId?: string | null;
  selfHostedRole?: SelfHostedDeviceRole | null;
  selfHostedServerId?: string | null;
}) {
  const serverUrl = sanitizeText(input.serverUrl, 512);

  if (!serverUrl) {
    throw new Error("SYNC_SERVER_URL_REQUIRED");
  }

  const registry = getSyncRegistry();
  const timestamp = now();
  const connection: SyncConnection = {
    id: crypto.randomUUID(),
    provider: input.provider,
    role: input.role ?? "external",
    label: sanitizeText(input.label, 120) || buildConnectionLabel(input.provider, serverUrl),
    serverUrl,
    managementToken: sanitizeText(input.managementToken, 512),
    sessionToken: sanitizeText(input.sessionToken, 1024),
    refreshToken: sanitizeText(input.refreshToken, 2048),
    tokenExpiresAt: typeof input.tokenExpiresAt === "number" ? input.tokenExpiresAt : null,
    userId: sanitizeText(input.userId, 120) || null,
    userName: sanitizeText(input.userName, 160),
    userEmail: sanitizeText(input.userEmail, 160),
    changePageToken: sanitizeText(input.changePageToken, 2048) || null,
    selfHostedDeviceId: sanitizeText(input.selfHostedDeviceId, 120) || null,
    selfHostedRole: sanitizeSelfHostedDeviceRole(input.selfHostedRole),
    selfHostedServerId: sanitizeText(input.selfHostedServerId, 120) || null,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  await Promise.all([
    writeSecureSecret(
      buildSyncConnectionSecretKey(connection.id, "managementToken"),
      connection.managementToken
    ),
    writeSecureSecret(
      buildSyncConnectionSecretKey(connection.id, "sessionToken"),
      connection.sessionToken
    ),
    writeSecureSecret(
      buildSyncConnectionSecretKey(connection.id, "refreshToken"),
      sanitizeText(input.refreshToken, 2048)
    )
  ]);

  writeNormalizedRegistry({
    ...registry,
    connections: [...registry.connections, toPersistedConnection(connection)]
  });

  return connection;
}

export async function updateSyncConnection(
  connectionId: string,
  patch: Partial<Omit<SyncConnection, "id" | "provider" | "createdAt" | "refreshToken">> & {
    refreshToken?: string | null;
  }
) {
  const registry = getSyncRegistry();
  const currentConnection = registry.connections.find((connection) => connection.id === connectionId) ?? null;

  if (!currentConnection) {
    return null;
  }

  const nextConnection: SyncConnection = {
    ...toRuntimeConnection(currentConnection),
    label:
      typeof patch.label === "string"
        ? sanitizeText(patch.label, 120) || currentConnection.label
        : currentConnection.label,
    serverUrl:
      typeof patch.serverUrl === "string"
        ? sanitizeText(patch.serverUrl, 512) || currentConnection.serverUrl
        : currentConnection.serverUrl,
    managementToken:
      typeof patch.managementToken === "string"
        ? sanitizeText(patch.managementToken, 512)
        : readCachedSecureSecret(buildSyncConnectionSecretKey(connectionId, "managementToken")),
    sessionToken:
      typeof patch.sessionToken === "string"
        ? sanitizeText(patch.sessionToken, 1024)
        : readCachedSecureSecret(buildSyncConnectionSecretKey(connectionId, "sessionToken")),
    refreshToken:
      typeof patch.refreshToken === "string" || patch.refreshToken === null
        ? sanitizeText(patch.refreshToken, 2048)
        : readCachedSecureSecret(buildSyncConnectionSecretKey(connectionId, "refreshToken")),
    tokenExpiresAt:
      typeof patch.tokenExpiresAt === "number" || patch.tokenExpiresAt === null
        ? patch.tokenExpiresAt ?? null
        : currentConnection.tokenExpiresAt,
    userId:
      typeof patch.userId === "string" || patch.userId === null
        ? sanitizeText(patch.userId, 120) || null
        : currentConnection.userId,
    userName:
      typeof patch.userName === "string"
        ? sanitizeText(patch.userName, 160)
        : currentConnection.userName,
    userEmail:
      typeof patch.userEmail === "string"
        ? sanitizeText(patch.userEmail, 160)
        : currentConnection.userEmail,
    changePageToken:
      typeof patch.changePageToken === "string" || patch.changePageToken === null
        ? sanitizeText(patch.changePageToken, 2048) || null
        : currentConnection.changePageToken ?? null,
    selfHostedDeviceId:
      typeof patch.selfHostedDeviceId === "string" || patch.selfHostedDeviceId === null
        ? sanitizeText(patch.selfHostedDeviceId, 120) || null
        : currentConnection.selfHostedDeviceId ?? null,
    selfHostedRole:
      patch.selfHostedRole === "owner" || patch.selfHostedRole === "guest" || patch.selfHostedRole === null
        ? patch.selfHostedRole
        : currentConnection.selfHostedRole ?? null,
    selfHostedServerId:
      typeof patch.selfHostedServerId === "string" || patch.selfHostedServerId === null
        ? sanitizeText(patch.selfHostedServerId, 120) || null
        : currentConnection.selfHostedServerId ?? null,
    role: patch.role ?? currentConnection.role ?? "external",
    updatedAt: now()
  };

  await Promise.all([
    typeof patch.managementToken === "string"
      ? writeSecureSecret(
          buildSyncConnectionSecretKey(connectionId, "managementToken"),
          nextConnection.managementToken
        )
      : Promise.resolve(),
    typeof patch.sessionToken === "string"
      ? writeSecureSecret(
          buildSyncConnectionSecretKey(connectionId, "sessionToken"),
          nextConnection.sessionToken
        )
      : Promise.resolve(),
    typeof patch.refreshToken === "string" || patch.refreshToken === null
      ? writeSecureSecret(
          buildSyncConnectionSecretKey(connectionId, "refreshToken"),
          sanitizeText(patch.refreshToken, 2048)
        )
      : Promise.resolve()
  ]);

  writeNormalizedRegistry({
    ...registry,
    connections: registry.connections.map((connection) =>
      connection.id === connectionId ? toPersistedConnection(nextConnection) : connection
    )
  });

  return nextConnection;
}

export async function removeSyncConnection(connectionId: string) {
  const registry = getSyncRegistry();
  const removedBindings = registry.bindings.filter((binding) => binding.connectionId === connectionId);
  const nextRegistry = {
    ...registry,
    connections: registry.connections.filter((connection) => connection.id !== connectionId),
    bindings: registry.bindings.filter((binding) => binding.connectionId !== connectionId)
  };

  await Promise.all([
    clearSyncConnectionSecrets(connectionId),
    ...removedBindings.map((binding) => clearSyncBindingSecrets(binding.id))
  ]);

  writeNormalizedRegistry(nextRegistry);
  return nextRegistry;
}

export async function upsertSyncBinding(input: {
  localVaultId: string;
  connectionId: string;
  remoteVaultId: string;
  remoteVaultName?: string;
  syncToken: string;
  syncStatus?: SyncVaultBinding["syncStatus"];
  lastSyncAt?: number | null;
  syncCursor?: string | null;
  lastError?: string | null;
}) {
  const registry = getSyncRegistry();
  const existingBinding = registry.bindings.find((binding) => binding.localVaultId === input.localVaultId) ?? null;
  const timestamp = now();

  const binding: SyncVaultBinding = {
    id: existingBinding?.id ?? crypto.randomUUID(),
    localVaultId: sanitizeText(input.localVaultId, 120),
    connectionId: sanitizeText(input.connectionId, 120),
    remoteVaultId: sanitizeText(input.remoteVaultId, 120),
    remoteVaultName: sanitizeText(input.remoteVaultName, 160) || sanitizeText(input.remoteVaultId, 120),
    syncToken: sanitizeText(input.syncToken, 1024),
    syncStatus: input.syncStatus ?? existingBinding?.syncStatus ?? "idle",
    lastSyncAt:
      typeof input.lastSyncAt === "number" || input.lastSyncAt === null
        ? input.lastSyncAt ?? null
        : existingBinding?.lastSyncAt ?? null,
    syncCursor:
      typeof input.syncCursor === "string" || input.syncCursor === null
        ? sanitizeText(input.syncCursor, 160) || null
        : existingBinding?.syncCursor ?? null,
    lastError:
      typeof input.lastError === "string" || input.lastError === null
        ? sanitizeText(input.lastError, 240) || null
        : existingBinding?.lastError ?? null,
    createdAt: existingBinding?.createdAt ?? timestamp,
    updatedAt: timestamp
  };

  if (!binding.localVaultId || !binding.connectionId || !binding.remoteVaultId || !binding.syncToken) {
    throw new Error("SYNC_BINDING_REQUIRED");
  }

  await writeSecureSecret(
    buildSyncBindingSecretKey(binding.id, "syncToken"),
    binding.syncToken
  );

  const nextBindings = existingBinding
    ? registry.bindings.map((entry) => (entry.id === existingBinding.id ? toPersistedBinding(binding) : entry))
    : [...registry.bindings, toPersistedBinding(binding)];

  writeNormalizedRegistry({
    ...registry,
    bindings: nextBindings
  });

  return binding;
}

export async function clearSyncBinding(localVaultId: string) {
  const registry = getSyncRegistry();
  const removedBindings = registry.bindings.filter((binding) => binding.localVaultId === localVaultId);
  const nextRegistry = {
    ...registry,
    bindings: registry.bindings.filter((binding) => binding.localVaultId !== localVaultId)
  };

  await Promise.all(removedBindings.map((binding) => clearSyncBindingSecrets(binding.id)));

  writeNormalizedRegistry(nextRegistry);
  return nextRegistry;
}

export function updateSyncBindingState(
  localVaultId: string,
  patch: Partial<Pick<SyncVaultBinding, "syncStatus" | "lastSyncAt" | "syncCursor" | "lastError">>
) {
  const registry = getSyncRegistry();
  const nextBindings = registry.bindings.map((binding) =>
    binding.localVaultId === localVaultId
      ? {
          ...binding,
          syncStatus: patch.syncStatus ?? binding.syncStatus,
          lastSyncAt:
            typeof patch.lastSyncAt === "number" || patch.lastSyncAt === null
              ? patch.lastSyncAt ?? null
              : binding.lastSyncAt,
          syncCursor:
            typeof patch.syncCursor === "string" || patch.syncCursor === null
              ? sanitizeText(patch.syncCursor, 160) || null
              : binding.syncCursor,
          lastError:
            typeof patch.lastError === "string" || patch.lastError === null
              ? sanitizeText(patch.lastError, 240) || null
              : binding.lastError,
          updatedAt: now()
        }
      : binding
  );

  writeNormalizedRegistry({
    ...registry,
    bindings: nextBindings
  });

  const nextBinding = nextBindings.find((binding) => binding.localVaultId === localVaultId) ?? null;
  return nextBinding ? toRuntimeBinding(nextBinding) : null;
}

export function updateSyncBindingRemoteName(localVaultId: string, remoteVaultName: string) {
  const registry = getSyncRegistry();
  const normalizedRemoteVaultName = sanitizeText(remoteVaultName, 160);

  const nextBindings = registry.bindings.map((binding) =>
    binding.localVaultId === localVaultId
      ? {
          ...binding,
          remoteVaultName: normalizedRemoteVaultName || binding.remoteVaultId,
          updatedAt: now()
        }
      : binding
  );

  writeNormalizedRegistry({
    ...registry,
    bindings: nextBindings
  });

  const nextBinding = nextBindings.find((binding) => binding.localVaultId === localVaultId) ?? null;
  return nextBinding ? toRuntimeBinding(nextBinding) : null;
}

export async function removeBindingsForLocalVault(localVaultId: string) {
  return clearSyncBinding(localVaultId);
}

export async function migrateSyncRegistryFromLegacyVaultSettings(
  localVaultIds: string[],
  readSettings: (localVaultId: string) => Promise<AppSettings | null>
) {
  const existing = getSyncRegistry();

  if (existing.connections.length > 0 || existing.bindings.length > 0) {
    return {
      connections: existing.connections.map((connection) => toRuntimeConnection(connection)),
      bindings: existing.bindings.map((binding) => toRuntimeBinding(binding)),
      version: existing.version
    };
  }

  const timestamp = now();
  const connections: SyncConnection[] = [];
  const bindings: SyncVaultBinding[] = [];
  const selfHostedConnectionMap = new Map<string, SyncConnection>();
  const hostedConnectionMap = new Map<string, SyncConnection>();

  for (const localVaultId of localVaultIds) {
    const settings = await readSettings(localVaultId);

    if (!settings) {
      continue;
    }

    if (
      settings.syncProvider === "selfHosted" &&
      settings.selfHostedUrl.trim() &&
      settings.selfHostedVaultId.trim() &&
      settings.selfHostedToken.trim()
    ) {
      const key = settings.selfHostedUrl.trim();
      let connection = selfHostedConnectionMap.get(key) ?? null;

      if (!connection) {
        connection = {
          id: crypto.randomUUID(),
          provider: "selfHosted",
          role: "external",
          label: buildConnectionLabel("selfHosted", settings.selfHostedUrl),
          serverUrl: settings.selfHostedUrl.trim(),
          managementToken: "",
          sessionToken: "",
          tokenExpiresAt: null,
          userId: null,
          userName: "",
          userEmail: "",
          selfHostedDeviceId: null,
          selfHostedRole: null,
          selfHostedServerId: null,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        selfHostedConnectionMap.set(key, connection);
        connections.push(connection);
      }

      bindings.push({
        id: crypto.randomUUID(),
        localVaultId,
        connectionId: connection.id,
        remoteVaultId: settings.selfHostedVaultId.trim(),
        remoteVaultName: settings.selfHostedVaultId.trim(),
        syncToken: settings.selfHostedToken.trim(),
        syncStatus: settings.syncStatus,
        lastSyncAt: settings.lastSyncAt,
        syncCursor: settings.syncCursor,
        lastError: null,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }

    if (
      settings.syncProvider === "hosted" &&
      settings.hostedUrl.trim() &&
      settings.hostedVaultId.trim() &&
      settings.hostedSyncToken.trim()
    ) {
      const key = `${settings.hostedUrl.trim()}::${settings.hostedUserId ?? "anon"}`;
      let connection = hostedConnectionMap.get(key) ?? null;

      if (!connection) {
        connection = {
          id: crypto.randomUUID(),
          provider: "hosted",
          role: "external",
          label:
            settings.hostedUserName.trim() ||
            buildConnectionLabel("hosted", settings.hostedUrl),
          serverUrl: settings.hostedUrl.trim(),
          managementToken: "",
          sessionToken: settings.hostedSessionToken.trim(),
          tokenExpiresAt: null,
          userId: settings.hostedUserId,
          userName: settings.hostedUserName.trim(),
          userEmail: settings.hostedUserEmail.trim(),
          selfHostedDeviceId: null,
          selfHostedRole: null,
          selfHostedServerId: null,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        hostedConnectionMap.set(key, connection);
        connections.push(connection);
      }

      bindings.push({
        id: crypto.randomUUID(),
        localVaultId,
        connectionId: connection.id,
        remoteVaultId: settings.hostedVaultId.trim(),
        remoteVaultName: settings.hostedVaultId.trim(),
        syncToken: settings.hostedSyncToken.trim(),
        syncStatus: settings.syncStatus,
        lastSyncAt: settings.lastSyncAt,
        syncCursor: settings.syncCursor,
        lastError: null,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }
  }

  await Promise.all([
    ...connections.map((connection) =>
      Promise.all([
        writeSecureSecret(
          buildSyncConnectionSecretKey(connection.id, "managementToken"),
          connection.managementToken
        ),
        writeSecureSecret(
          buildSyncConnectionSecretKey(connection.id, "sessionToken"),
          connection.sessionToken
        )
      ])
    ),
    ...bindings.map((binding) =>
      writeSecureSecret(
        buildSyncBindingSecretKey(binding.id, "syncToken"),
        binding.syncToken
      )
    )
  ]);

  const migrated = {
    version: SYNC_REGISTRY_VERSION,
    connections: connections.map((connection) => toPersistedConnection(connection)),
    bindings: bindings.map((binding) => toPersistedBinding(binding))
  } satisfies SyncRegistryState;

  writeNormalizedRegistry(migrated);
  await initializeSecureSyncRegistryState();

  return {
    version: migrated.version,
    connections,
    bindings
  };
}
