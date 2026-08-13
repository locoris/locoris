import {
  buildExcerpt,
  extractReferencedAssetIds,
  extractPlainText,
  normalizeNoteContent,
  remapReferencedAssetIds
} from "./notes";
import {
  buildCanvasExcerpt,
  extractCanvasPlainText,
  extractCanvasReferencedFileIds,
  normalizeCanvasContent,
  remapCanvasFileIds
} from "./canvas";
import {
  createEncryptionDescriptor,
  createPlainSyncDescriptor,
  decryptSyncPayload,
  encryptSyncPayload
} from "./e2ee";
import { getVaultEncryptionSessionPassphrase } from "./e2eeSession";
import {
  buildGoogleDriveBindingToken,
  buildGoogleDriveConnectionLabel,
  clearGoogleDriveAccountSession as clearGoogleDriveAccountSessionViaApi,
  connectGoogleDriveAccount as connectGoogleDriveAccountViaOAuth,
  createGoogleDriveRemoteVault,
  deleteGoogleDriveRemoteVault,
  GOOGLE_DRIVE_API_BASE_URL,
  GOOGLE_DRIVE_TOKEN_REFRESH_SKEW_MS,
  getGoogleDriveClientId,
  googleDriveOAuthReady as googleDriveOAuthReadyViaApi,
  isGoogleDriveConfigured,
  listGoogleDriveRemoteVaults,
  loadGoogleDriveRemoteBootstrap,
  loadGoogleDriveRemoteChangeFeed,
  loadGoogleDriveRemoteEnvelope,
  prepareGoogleDriveOAuth as prepareGoogleDriveOAuthViaApi,
  pollGoogleDriveRemoteChanges as pollGoogleDriveRemoteChangesViaApi,
  refreshGoogleDriveAccountSession as refreshGoogleDriveAccountSessionViaApi,
  probeGoogleDriveConnection,
  pushGoogleDriveRemoteChanges,
  renameGoogleDriveRemoteVault,
  revokeGoogleDriveAccountAccess as revokeGoogleDriveAccountAccessViaApi,
  saveGoogleDriveRemoteEnvelope
} from "./googleDriveSync";
import { getLocalVaultProfile, type LocalVaultProfile, updateLocalVaultProfile } from "./localVaults";
import { isTauriRuntime } from "./runtime";
import {
  db,
  persistLocalVaultStorage,
  rebuildSyncDirtyEntriesFromCurrentState,
  resetResolvedAssetCache,
  withLocalVaultDatabase,
  writeImportedVaultSnapshot,
  type LocorisDatabase
} from "../data/db";
import type {
  AppLanguage,
  AppSettings,
  Asset,
  Folder,
  Goal,
  Habit,
  HabitLog,
  HostedAccountSession,
  HostedAccountUser,
  HostedAccountDevice,
  HostedAccountVault,
  HostedCloudEntitlement,
  HostedCloudUsage,
  Note,
  Project,
  SyncEnvelope,
  SyncEnvelopeMetadata,
  SyncConnection,
  SyncConnectionProvider,
  SyncChangeFeed,
  SyncChangeSet,
  SyncEncryptedPayload,
  SyncEncryptionDescriptor,
  SyncEntityKind,
  SyncPayloadMode,
  SyncRemoteVault,
  SyncRunStats,
  SyncSecureEnvelope,
  SyncShadow,
  SyncSnapshot,
  SyncStatus,
  SyncTombstone,
  SyncedAssetRecord,
  SyncedNoteRecord,
  SyncVaultDescriptor,
  Tag,
  Task,
  TimeBlock
} from "../types";

type SnapshotEntityState<T> = {
  kind: SyncEntityKind;
  key: string;
  hash: string;
  timestamp: number;
  deleted: boolean;
  record?: T;
  tombstone?: SyncTombstone;
};

type SyncExecutionResult = {
  revision: string;
  stats: SyncRunStats;
  syncMode: "delta" | "encrypted-delta" | "snapshot" | "encrypted-snapshot";
};

type SyncMutationState<T> = {
  local: SnapshotEntityState<T> | null;
  remote: SnapshotEntityState<T> | null;
  shadowHash: string | null;
};

const CONFLICT_SUFFIX = " (Conflict)";
const JSON_HEADERS = {
  "Content-Type": "application/json"
};

export type HostedAccountOverview = {
  user: HostedAccountUser;
  session: Omit<HostedAccountSession, "token">;
  vaults: HostedAccountVault[];
  devices: HostedAccountDevice[];
  usage: HostedCloudUsage;
  entitlement: HostedCloudEntitlement;
};

export type PersonalServerDeviceRole = "owner" | "guest";
export type PersonalServerVaultPermission = "read" | "write";

export type PersonalServerDevice = {
  id: string;
  name: string;
  platform: string;
  role: PersonalServerDeviceRole;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  vaultAccess: Array<{
    vaultId: string;
    permission: PersonalServerVaultPermission;
  }>;
};

export type PersonalServerInvite = {
  id: string;
  kind: "bootstrap" | "owner_device" | "guest";
  role: PersonalServerDeviceRole;
  label: string;
  codeHint: string;
  requiresApproval: boolean;
  maxUses: number;
  useCount: number;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  vaultAccess: Array<{
    vaultId: string;
    permission: PersonalServerVaultPermission;
  }>;
};

export type PersonalServerPairingRequest = {
  id: string;
  inviteId: string;
  deviceName: string;
  platform: string;
  confirmationCode: string;
  status: "pending" | "approved" | "denied" | "expired";
  createdAt: number;
  expiresAt: number;
  resolvedAt: number | null;
  deviceId: string | null;
  vaultAccess: Array<{
    vaultId: string;
    permission: PersonalServerVaultPermission;
  }>;
};

export type PersonalServerAccessOverview = {
  server: {
    id: string;
    name: string;
  };
  currentDeviceId: string | null;
  role: PersonalServerDeviceRole;
  devices: PersonalServerDevice[];
  invites: PersonalServerInvite[];
  requests: PersonalServerPairingRequest[];
};

type RemoteSyncConfig = {
  provider: SyncConnectionProvider;
  serverUrl: string;
  vaultId: string;
  token: string;
  localVaultId?: string | null;
  localVaultName?: string | null;
};

type RemoteEnvelopeRecord = SyncEnvelope | SyncSecureEnvelope;

type ResolvedRemoteEnvelope = {
  revision: string | null;
  snapshot: SyncSnapshot;
  metadata: SyncEnvelopeMetadata | null;
};

type ResolveRemoteEnvelopeOptions = {
  passphraseOverride?: string | null;
  hydrateFromMetadata?: boolean;
  syncVaultNameFromMetadata?: boolean;
};

type CreateOutgoingRemoteEnvelopeOptions = {
  forcePayloadMode?: SyncPayloadMode | null;
  passphraseOverride?: string | null;
  descriptorOverride?: SyncEncryptionDescriptor | null;
};

function getEntityKey(entityType: SyncEntityKind, entityId: string) {
  return `${entityType}:${entityId}`;
}

function normalizeSyncSnapshotPayload(
  value: Partial<SyncSnapshot> | null | undefined,
  fallbackDeviceId = "server"
): SyncSnapshot {
  if (!value || typeof value !== "object") {
    return {
      deviceId: fallbackDeviceId,
      exportedAt: Date.now(),
      projects: [],
      folders: [],
      tags: [],
      notes: [],
      assets: [],
      tasks: [],
      habits: [],
      habitLogs: [],
      goals: [],
      timeBlocks: [],
      tombstones: []
    };
  }

  return {
    deviceId: typeof value.deviceId === "string" ? value.deviceId : fallbackDeviceId,
    exportedAt: typeof value.exportedAt === "number" ? value.exportedAt : Date.now(),
    projects: Array.isArray(value.projects) ? value.projects.filter(Boolean) : [],
    folders: Array.isArray(value.folders) ? value.folders.filter(Boolean) : [],
    tags: Array.isArray(value.tags) ? value.tags.filter(Boolean) : [],
    notes: Array.isArray(value.notes) ? value.notes.filter(Boolean) : [],
    assets: Array.isArray(value.assets) ? value.assets.filter(Boolean) : [],
    tasks: Array.isArray(value.tasks) ? value.tasks.filter(Boolean) : [],
    habits: Array.isArray(value.habits) ? value.habits.filter(Boolean) : [],
    habitLogs: Array.isArray(value.habitLogs) ? value.habitLogs.filter(Boolean) : [],
    goals: Array.isArray(value.goals) ? value.goals.filter(Boolean) : [],
    timeBlocks: Array.isArray(value.timeBlocks) ? value.timeBlocks.filter(Boolean) : [],
    tombstones: Array.isArray(value.tombstones) ? value.tombstones.filter(Boolean) : []
  };
}

function createSyncRevision() {
  return `rev-${Date.now()}-${crypto.randomUUID()}`;
}

function isEncryptedEnvelopeRecord(envelope: RemoteEnvelopeRecord): envelope is SyncSecureEnvelope {
  return (
    envelope &&
    typeof envelope === "object" &&
    "encryptedSnapshot" in envelope &&
    Boolean(envelope.encryptedSnapshot)
  );
}

function buildRemoteVaultDescriptor(remote: RemoteSyncConfig): SyncVaultDescriptor {
  const localVaultProfile = remote.localVaultId ? getLocalVaultProfile(remote.localVaultId) : null;

  return {
    localVaultId: remote.localVaultId ?? localVaultProfile?.id ?? null,
    vaultGuid: localVaultProfile?.vaultGuid ?? remote.vaultId ?? null,
    // Always prefer the latest local profile name (which can be updated from remote metadata during sync).
    name: localVaultProfile?.name ?? remote.localVaultName ?? null,
    vaultKind: localVaultProfile?.vaultKind ?? "regular",
    schemaVersion: 1
  };
}

function normalizeSyncedVaultName(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().slice(0, 120) : "";
  return normalized || null;
}

function reconcileLocalVaultProfileName(
  remote: Pick<RemoteSyncConfig, "localVaultId">,
  vaultName: string | null | undefined
) {
  const localVaultId = remote.localVaultId?.trim() ?? "";
  const normalizedName = normalizeSyncedVaultName(vaultName);

  if (!localVaultId || !normalizedName) {
    return null;
  }

  const localVaultProfile = getLocalVaultProfile(localVaultId);

  if (!localVaultProfile || localVaultProfile.name === normalizedName) {
    return normalizedName;
  }

  updateLocalVaultProfile(localVaultId, {
    name: normalizedName
  });

  return normalizedName;
}

function buildEncryptionDescriptorFromSettings(settings: AppSettings): SyncEncryptionDescriptor {
  if (
    !settings.encryptionEnabled ||
    !settings.encryptionKdf ||
    !settings.encryptionKeyId ||
    !settings.encryptionSalt
  ) {
    throw new Error("VAULT_ENCRYPTION_DISABLED");
  }

  return {
    version: (settings.encryptionVersion ?? 1) as 1,
    state: "locked",
    keyId: settings.encryptionKeyId,
    kdf: settings.encryptionKdf,
    iterations: settings.encryptionIterations,
    salt: settings.encryptionSalt,
    keyCheck: settings.encryptionKeyCheck
  };
}

async function hydrateVaultEncryptionFromMetadata(
  metadata: SyncEnvelopeMetadata | null | undefined,
  database: LocorisDatabase = db
) {
  if (metadata?.payloadMode !== "encrypted" || !metadata.encryption) {
    return;
  }

  const settings = await database.settings.get("app");

  if (!settings) {
    return;
  }

  await database.settings.update("app", {
    encryptionEnabled: true,
    encryptionVersion: metadata.encryption.version ?? settings.encryptionVersion ?? 1,
    encryptionKdf: metadata.encryption.kdf ?? settings.encryptionKdf ?? "pbkdf2-sha256",
    encryptionIterations: metadata.encryption.iterations ?? settings.encryptionIterations ?? null,
    encryptionKeyId: metadata.encryption.keyId ?? settings.encryptionKeyId ?? null,
    encryptionSalt: metadata.encryption.salt ?? settings.encryptionSalt ?? null,
    encryptionKeyCheck: metadata.encryption.keyCheck ?? settings.encryptionKeyCheck ?? null,
    encryptionUpdatedAt: settings.encryptionUpdatedAt ?? Date.now()
  });
}

async function resolveRemoteEnvelopeRecord(
  envelope: RemoteEnvelopeRecord,
  remote: RemoteSyncConfig,
  database: LocorisDatabase = db,
  options?: ResolveRemoteEnvelopeOptions
): Promise<ResolvedRemoteEnvelope> {
  const metadata = envelope.metadata ?? createPlainSyncDescriptor(buildRemoteVaultDescriptor(remote));

  if (options?.syncVaultNameFromMetadata ?? true) {
    reconcileLocalVaultProfileName(remote, metadata.vault?.name ?? null);
  }

  if (options?.hydrateFromMetadata ?? true) {
    await hydrateVaultEncryptionFromMetadata(metadata, database);
  }

  if (metadata.payloadMode === "encrypted" || isEncryptedEnvelopeRecord(envelope)) {
    if (!isEncryptedEnvelopeRecord(envelope) || !metadata.encryption) {
      throw new Error("ENCRYPTED_SYNC_NOT_IMPLEMENTED");
    }

    const localVaultId = remote.localVaultId?.trim() ?? "";
    const passphrase =
      options?.passphraseOverride?.trim() ||
      (localVaultId ? getVaultEncryptionSessionPassphrase(localVaultId) : null);

    if (!passphrase) {
      throw new Error("VAULT_ENCRYPTION_LOCKED");
    }

    const snapshot = await decryptSyncPayload<SyncSnapshot>(
      envelope.encryptedSnapshot,
      passphrase,
      metadata.encryption,
      metadata.vault ?? buildRemoteVaultDescriptor(remote)
    );

    return {
      revision: envelope.revision ?? null,
      snapshot: normalizeSyncSnapshotPayload(snapshot, remote.vaultId || "server"),
      metadata
    };
  }

  return {
    revision: envelope.revision ?? null,
    snapshot: normalizeSyncSnapshotPayload(envelope.snapshot, remote.vaultId || "server"),
    metadata
  };
}

async function createOutgoingRemoteEnvelope(
  snapshot: SyncSnapshot,
  existingEnvelope: RemoteEnvelopeRecord | null,
  remote: RemoteSyncConfig,
  settings: AppSettings,
  options?: CreateOutgoingRemoteEnvelopeOptions
): Promise<RemoteEnvelopeRecord> {
  const vaultDescriptor = buildRemoteVaultDescriptor(remote);
  const nextSnapshot = {
    ...normalizeSyncSnapshotPayload(snapshot, settings.localDeviceId),
    exportedAt: Date.now()
  };
  const localVaultProfile = remote.localVaultId ? getLocalVaultProfile(remote.localVaultId) : null;
  const inferredVaultKind =
    localVaultProfile?.vaultKind ??
    (existingEnvelope?.metadata?.payloadMode === "encrypted" || settings.encryptionEnabled
      ? "private"
      : "regular");
  const payloadMode =
    options?.forcePayloadMode ??
    (inferredVaultKind === "private" ? ("encrypted" as const) : ("plain" as const));

  if (payloadMode === "plain") {
    const existingMetadata =
      existingEnvelope?.metadata && existingEnvelope.metadata.payloadMode !== "encrypted"
        ? existingEnvelope.metadata
        : null;

    return {
      revision: createSyncRevision(),
      snapshot: nextSnapshot,
      metadata: existingMetadata
        ? {
            ...existingMetadata,
            payloadMode: "plain",
            vault: vaultDescriptor,
            encryption: null
          }
        : createPlainSyncDescriptor(vaultDescriptor)
    };
  }

  const localVaultId = remote.localVaultId?.trim() ?? "";
  const passphrase =
    options?.passphraseOverride?.trim() ||
    (localVaultId ? getVaultEncryptionSessionPassphrase(localVaultId) : null);

  if (!passphrase) {
    throw new Error("VAULT_ENCRYPTION_LOCKED");
  }

  const { descriptor, payload } = await encryptSyncPayload(nextSnapshot, passphrase, {
    vault: vaultDescriptor,
    descriptor: options?.descriptorOverride ?? buildEncryptionDescriptorFromSettings(settings)
  });

  return {
    revision: createSyncRevision(),
    metadata: {
      schemaVersion: 1,
      payloadMode: "encrypted",
      vault: vaultDescriptor,
      encryption: {
        ...descriptor,
        state: "locked"
      }
    },
    encryptedSnapshot: payload
  };
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function normalizeVaultId(value: string) {
  return value.trim();
}

function buildVaultStateUrl(serverUrl: string, vaultId: string) {
  return `${normalizeBaseUrl(serverUrl)}/v1/vaults/${encodeURIComponent(normalizeVaultId(vaultId))}/state`;
}

function buildVaultChangesUrl(serverUrl: string, vaultId: string, sinceRevision?: string | null) {
  const baseUrl = `${normalizeBaseUrl(serverUrl)}/v1/vaults/${encodeURIComponent(normalizeVaultId(vaultId))}/changes`;

  if (!sinceRevision) {
    return baseUrl;
  }

  return `${baseUrl}?since=${encodeURIComponent(sinceRevision)}`;
}

function buildAccountUrl(serverUrl: string, path: string) {
  const configuredCloudUrl = import.meta.env.VITE_LOCORIS_CLOUD_URL?.trim() ?? "";

  if (
    !isTauriRuntime() &&
    configuredCloudUrl &&
    normalizeBaseUrl(serverUrl) === normalizeBaseUrl(configuredCloudUrl)
  ) {
    return `/api${path}`;
  }

  return `${normalizeBaseUrl(serverUrl)}${path}`;
}

function buildPersonalUrl(serverUrl: string, path: string) {
  return `${normalizeBaseUrl(serverUrl)}${path}`;
}

function createBearerHeaders(token: string, includeJson = false) {
  return {
    ...(includeJson ? JSON_HEADERS : {}),
    Authorization: `Bearer ${token}`
  };
}

function normalizeRequestError(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "AbortError" || error instanceof TypeError) {
      return "SERVER_UNAVAILABLE";
    }

    if (error.message) {
      return error.message;
    }
  }

  return "SYNC_FAILED";
}

function createNextSyncEnvelope(snapshot: SyncSnapshot, existing: SyncEnvelope | null = null): SyncEnvelope {
  const metadata =
    existing?.metadata ??
    createPlainSyncDescriptor(
      snapshot.projects.length > 0
        ? {
            localVaultId: null,
            vaultGuid: null,
            name: null,
            vaultKind: "regular",
            schemaVersion: 1
          }
        : null
    );

  return {
    revision: `rev-${Date.now()}-${crypto.randomUUID()}`,
    snapshot: {
      ...normalizeSyncSnapshotPayload(snapshot),
      exportedAt: Date.now()
    },
    metadata
  };
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortObjectKeys(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = sortObjectKeys((value as Record<string, unknown>)[key]);
      return result;
    }, {});
}

function stableStringify(value: unknown) {
  return JSON.stringify(sortObjectKeys(value));
}

function hashStableValue(value: unknown) {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `h${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function createTombstoneHash(tombstone: SyncTombstone) {
  return hashStableValue({
    deleted: true,
    deletedAt: tombstone.deletedAt
  });
}

function sortById<T extends { id: string }>(records: readonly T[]) {
  return [...records].sort((left, right) => left.id.localeCompare(right.id));
}

function sortTombstones(records: readonly SyncTombstone[]) {
  return [...records].sort((left, right) => left.key.localeCompare(right.key));
}

function createEmptyChangeSet(deviceId = "server"): SyncChangeSet {
  return {
    deviceId,
    exportedAt: 0,
    projects: [],
    folders: [],
    tags: [],
    notes: [],
    assets: [],
    tasks: [],
    habits: [],
    habitLogs: [],
    goals: [],
    timeBlocks: [],
    tombstones: []
  };
}

function isChangeSetEmpty(changeSet: SyncChangeSet) {
  return (
    changeSet.projects.length === 0 &&
    changeSet.folders.length === 0 &&
    changeSet.tags.length === 0 &&
    changeSet.notes.length === 0 &&
    changeSet.assets.length === 0 &&
    changeSet.tasks.length === 0 &&
    changeSet.habits.length === 0 &&
    changeSet.habitLogs.length === 0 &&
    changeSet.goals.length === 0 &&
    changeSet.timeBlocks.length === 0 &&
    changeSet.tombstones.length === 0
  );
}

function countChangeSetEntries(changeSet: SyncChangeSet) {
  return (
    changeSet.projects.length +
    changeSet.folders.length +
    changeSet.tags.length +
    changeSet.notes.length +
    changeSet.assets.length +
    changeSet.tasks.length +
    changeSet.habits.length +
    changeSet.habitLogs.length +
    changeSet.goals.length +
    changeSet.timeBlocks.length +
    changeSet.tombstones.length
  );
}

function normalizeChangeSetPayload(
  payload: Partial<SyncChangeSet> | null | undefined,
  fallbackDeviceId = "server"
): SyncChangeSet {
  if (!payload || typeof payload !== "object") {
    return createEmptyChangeSet(fallbackDeviceId);
  }

  return {
    deviceId: typeof payload.deviceId === "string" ? payload.deviceId : fallbackDeviceId,
    exportedAt: typeof payload.exportedAt === "number" ? payload.exportedAt : Date.now(),
    projects: Array.isArray(payload.projects) ? payload.projects.filter(Boolean) : [],
    folders: Array.isArray(payload.folders) ? payload.folders.filter(Boolean) : [],
    tags: Array.isArray(payload.tags) ? payload.tags.filter(Boolean) : [],
    notes: Array.isArray(payload.notes) ? payload.notes.filter(Boolean) : [],
    assets: Array.isArray(payload.assets) ? payload.assets.filter(Boolean) : [],
    tasks: Array.isArray(payload.tasks) ? payload.tasks.filter(Boolean) : [],
    habits: Array.isArray(payload.habits) ? payload.habits.filter(Boolean) : [],
    habitLogs: Array.isArray(payload.habitLogs) ? payload.habitLogs.filter(Boolean) : [],
    goals: Array.isArray(payload.goals) ? payload.goals.filter(Boolean) : [],
    timeBlocks: Array.isArray(payload.timeBlocks) ? payload.timeBlocks.filter(Boolean) : [],
    tombstones: Array.isArray(payload.tombstones) ? payload.tombstones.filter(Boolean) : []
  };
}

function applyChangeSetIntoMaps(
  maps: {
    project: Map<string, Project>;
    folder: Map<string, Folder>;
    tag: Map<string, Tag>;
    note: Map<string, SyncedNoteRecord>;
    asset: Map<string, SyncedAssetRecord>;
    task: Map<string, Task>;
    habit: Map<string, Habit>;
    habitLog: Map<string, HabitLog>;
    goal: Map<string, Goal>;
    timeBlock: Map<string, TimeBlock>;
    tombstones: Map<string, SyncTombstone>;
  },
  changeSet: SyncChangeSet
) {
  const applyRecords = <T extends { id: string }>(
    entityType: SyncEntityKind,
    target: Map<string, T>,
    records: readonly T[]
  ) => {
    records.forEach((record) => {
      target.set(record.id, record);
      maps.tombstones.delete(getEntityKey(entityType, record.id));
    });
  };

  applyRecords("project", maps.project, changeSet.projects);
  applyRecords("folder", maps.folder, changeSet.folders);
  applyRecords("tag", maps.tag, changeSet.tags);
  applyRecords("note", maps.note, changeSet.notes);
  applyRecords("asset", maps.asset, changeSet.assets);
  applyRecords("task", maps.task, changeSet.tasks);
  applyRecords("habit", maps.habit, changeSet.habits);
  applyRecords("habitLog", maps.habitLog, changeSet.habitLogs);
  applyRecords("goal", maps.goal, changeSet.goals);
  applyRecords("timeBlock", maps.timeBlock, changeSet.timeBlocks);

  changeSet.tombstones.forEach((tombstone) => {
    switch (tombstone.entityType) {
      case "project":
        maps.project.delete(tombstone.entityId);
        break;
      case "folder":
        maps.folder.delete(tombstone.entityId);
        break;
      case "tag":
        maps.tag.delete(tombstone.entityId);
        break;
      case "note":
        maps.note.delete(tombstone.entityId);
        break;
      case "asset":
        maps.asset.delete(tombstone.entityId);
        break;
      case "task":
        maps.task.delete(tombstone.entityId);
        break;
      case "habit":
        maps.habit.delete(tombstone.entityId);
        break;
      case "habitLog":
        maps.habitLog.delete(tombstone.entityId);
        break;
      case "goal":
        maps.goal.delete(tombstone.entityId);
        break;
      case "timeBlock":
        maps.timeBlock.delete(tombstone.entityId);
        break;
    }

    maps.tombstones.set(tombstone.key, tombstone);
  });
}

function collapseChangeSetBatches(changeSets: readonly SyncChangeSet[]) {
  const maps = {
    project: new Map<string, Project>(),
    folder: new Map<string, Folder>(),
    tag: new Map<string, Tag>(),
    note: new Map<string, SyncedNoteRecord>(),
    asset: new Map<string, SyncedAssetRecord>(),
    task: new Map<string, Task>(),
    habit: new Map<string, Habit>(),
    habitLog: new Map<string, HabitLog>(),
    goal: new Map<string, Goal>(),
    timeBlock: new Map<string, TimeBlock>(),
    tombstones: new Map<string, SyncTombstone>()
  };
  let deviceId = "server";
  let exportedAt = 0;

  changeSets.forEach((rawChangeSet) => {
    const changeSet = normalizeChangeSetPayload(rawChangeSet, deviceId);
    deviceId = changeSet.deviceId || deviceId;
    exportedAt = Math.max(exportedAt, changeSet.exportedAt || 0);
    applyChangeSetIntoMaps(maps, changeSet);
  });

  return {
    deviceId,
    exportedAt,
    projects: sortById([...maps.project.values()]),
    folders: sortById([...maps.folder.values()]),
    tags: sortById([...maps.tag.values()]),
    notes: sortById([...maps.note.values()]),
    assets: sortById([...maps.asset.values()]),
    tasks: sortById([...maps.task.values()]),
    habits: sortById([...maps.habit.values()]),
    habitLogs: sortById([...maps.habitLog.values()]),
    goals: sortById([...maps.goal.values()]),
    timeBlocks: sortById([...maps.timeBlock.values()]),
    tombstones: sortTombstones([...maps.tombstones.values()])
  } satisfies SyncChangeSet;
}

function applyChangeSetsToSnapshot(
  snapshot: SyncSnapshot,
  changeSets: readonly SyncChangeSet[]
) {
  const normalizedSnapshot = normalizeSyncSnapshotPayload(snapshot);
  const maps = {
    project: new Map(normalizedSnapshot.projects.map((record) => [record.id, record])),
    folder: new Map(normalizedSnapshot.folders.map((record) => [record.id, record])),
    tag: new Map(normalizedSnapshot.tags.map((record) => [record.id, record])),
    note: new Map(normalizedSnapshot.notes.map((record) => [record.id, record])),
    asset: new Map(normalizedSnapshot.assets.map((record) => [record.id, record])),
    task: new Map(normalizedSnapshot.tasks.map((record) => [record.id, record])),
    habit: new Map(normalizedSnapshot.habits.map((record) => [record.id, record])),
    habitLog: new Map(normalizedSnapshot.habitLogs.map((record) => [record.id, record])),
    goal: new Map(normalizedSnapshot.goals.map((record) => [record.id, record])),
    timeBlock: new Map(normalizedSnapshot.timeBlocks.map((record) => [record.id, record])),
    tombstones: new Map(normalizedSnapshot.tombstones.map((record) => [record.key, record]))
  };
  let deviceId = normalizedSnapshot.deviceId;
  let exportedAt = normalizedSnapshot.exportedAt;

  changeSets.forEach((rawChangeSet) => {
    const changeSet = normalizeChangeSetPayload(rawChangeSet, deviceId);
    applyChangeSetIntoMaps(maps, changeSet);
    deviceId = changeSet.deviceId || deviceId;
    exportedAt = Math.max(exportedAt, changeSet.exportedAt || 0);
  });

  return {
    deviceId,
    exportedAt,
    projects: sortById([...maps.project.values()]),
    folders: sortById([...maps.folder.values()]),
    tags: sortById([...maps.tag.values()]),
    notes: sortById([...maps.note.values()]),
    assets: sortById([...maps.asset.values()]),
    tasks: sortById([...maps.task.values()]),
    habits: sortById([...maps.habit.values()]),
    habitLogs: sortById([...maps.habitLog.values()]),
    goals: sortById([...maps.goal.values()]),
    timeBlocks: sortById([...maps.timeBlock.values()]),
    tombstones: sortTombstones([...maps.tombstones.values()])
  } satisfies SyncSnapshot;
}

function buildRecordChangeSetFromSnapshot(snapshot: SyncSnapshot, shadows: readonly SyncShadow[]) {
  const normalizedSnapshot = normalizeSyncSnapshotPayload(snapshot);
  const changeSet = createEmptyChangeSet(normalizedSnapshot.deviceId);
  const shadowMap = buildShadowMap(shadows);

  changeSet.exportedAt = normalizedSnapshot.exportedAt;

  normalizedSnapshot.projects.forEach((project) => {
    const state = createRecordState("project", project, project.updatedAt);

    if ((shadowMap.get(state.key)?.hash ?? null) !== state.hash) {
      changeSet.projects.push(project);
    }
  });

  normalizedSnapshot.folders.forEach((folder) => {
    const state = createRecordState("folder", folder, folder.updatedAt);

    if ((shadowMap.get(state.key)?.hash ?? null) !== state.hash) {
      changeSet.folders.push(folder);
    }
  });

  normalizedSnapshot.tags.forEach((tag) => {
    const state = createRecordState("tag", tag, tag.updatedAt);

    if ((shadowMap.get(state.key)?.hash ?? null) !== state.hash) {
      changeSet.tags.push(tag);
    }
  });

  normalizedSnapshot.notes.forEach((note) => {
    const state = createRecordState("note", note, note.updatedAt);

    if ((shadowMap.get(state.key)?.hash ?? null) !== state.hash) {
      changeSet.notes.push(note);
    }
  });

  normalizedSnapshot.assets.forEach((asset) => {
    const state = createRecordState("asset", asset, asset.updatedAt);

    if ((shadowMap.get(state.key)?.hash ?? null) !== state.hash) {
      changeSet.assets.push(asset);
    }
  });

  normalizedSnapshot.tasks.forEach((task) => {
    const state = createRecordState("task", task, task.updatedAt);

    if ((shadowMap.get(state.key)?.hash ?? null) !== state.hash) {
      changeSet.tasks.push(task);
    }
  });

  normalizedSnapshot.habits.forEach((habit) => {
    const state = createRecordState("habit", habit, habit.updatedAt);

    if ((shadowMap.get(state.key)?.hash ?? null) !== state.hash) {
      changeSet.habits.push(habit);
    }
  });

  normalizedSnapshot.habitLogs.forEach((habitLog) => {
    const state = createRecordState("habitLog", habitLog, habitLog.updatedAt);

    if ((shadowMap.get(state.key)?.hash ?? null) !== state.hash) {
      changeSet.habitLogs.push(habitLog);
    }
  });

  normalizedSnapshot.goals.forEach((goal) => {
    const state = createRecordState("goal", goal, goal.updatedAt);

    if ((shadowMap.get(state.key)?.hash ?? null) !== state.hash) {
      changeSet.goals.push(goal);
    }
  });

  normalizedSnapshot.timeBlocks.forEach((timeBlock) => {
    const state = createRecordState("timeBlock", timeBlock, timeBlock.updatedAt);

    if ((shadowMap.get(state.key)?.hash ?? null) !== state.hash) {
      changeSet.timeBlocks.push(timeBlock);
    }
  });

  normalizedSnapshot.tombstones.forEach((tombstone) => {
    const state = createTombstoneState(tombstone);

    if ((shadowMap.get(state.key)?.hash ?? null) !== state.hash) {
      changeSet.tombstones.push(tombstone);
    }
  });

  return {
    ...changeSet,
    projects: sortById(changeSet.projects),
    folders: sortById(changeSet.folders),
    tags: sortById(changeSet.tags),
    notes: sortById(changeSet.notes),
    assets: sortById(changeSet.assets),
    tasks: sortById(changeSet.tasks),
    habits: sortById(changeSet.habits),
    habitLogs: sortById(changeSet.habitLogs),
    goals: sortById(changeSet.goals),
    timeBlocks: sortById(changeSet.timeBlocks),
    tombstones: sortTombstones(changeSet.tombstones)
  };
}

function buildChangeSetBetweenSnapshots(previous: SyncSnapshot, next: SyncSnapshot) {
  const previousSnapshot = normalizeSyncSnapshotPayload(previous);
  const nextSnapshot = normalizeSyncSnapshotPayload(next, previousSnapshot.deviceId);
  const changeSet = createEmptyChangeSet(nextSnapshot.deviceId);
  changeSet.exportedAt = nextSnapshot.exportedAt;

  const appendEntityChanges = <T extends { id: string }>(
    entityType: SyncEntityKind,
    nextRecords: readonly T[],
    previousRecords: readonly T[],
    timestampAccessor: (record: T) => number
  ) => {
    const nextMap = buildStateMap(entityType, nextRecords, next.tombstones, timestampAccessor);
    const previousMap = buildStateMap(entityType, previousRecords, previous.tombstones, timestampAccessor);
    const keys = new Set([...nextMap.keys(), ...previousMap.keys()]);

    keys.forEach((key) => {
      const nextState = nextMap.get(key) ?? null;
      const previousState = previousMap.get(key) ?? null;

      if (!nextState || nextState.hash === previousState?.hash) {
        return;
      }

      appendResolvedStateToChangeSet(entityType, changeSet, nextState);
    });
  };

  appendEntityChanges("project", nextSnapshot.projects, previousSnapshot.projects, (record: Project) => record.updatedAt);
  appendEntityChanges("folder", nextSnapshot.folders, previousSnapshot.folders, (record: Folder) => record.updatedAt);
  appendEntityChanges("tag", nextSnapshot.tags, previousSnapshot.tags, (record: Tag) => record.updatedAt);
  appendEntityChanges("note", nextSnapshot.notes, previousSnapshot.notes, (record: SyncedNoteRecord) => record.updatedAt);
  appendEntityChanges("asset", nextSnapshot.assets, previousSnapshot.assets, (record: SyncedAssetRecord) => record.updatedAt);
  appendEntityChanges("task", nextSnapshot.tasks, previousSnapshot.tasks, (record: Task) => record.updatedAt);
  appendEntityChanges("habit", nextSnapshot.habits, previousSnapshot.habits, (record: Habit) => record.updatedAt);
  appendEntityChanges("habitLog", nextSnapshot.habitLogs, previousSnapshot.habitLogs, (record: HabitLog) => record.updatedAt);
  appendEntityChanges("goal", nextSnapshot.goals, previousSnapshot.goals, (record: Goal) => record.updatedAt);
  appendEntityChanges("timeBlock", nextSnapshot.timeBlocks, previousSnapshot.timeBlocks, (record: TimeBlock) => record.updatedAt);

  return {
    ...changeSet,
    projects: sortById(changeSet.projects),
    folders: sortById(changeSet.folders),
    tags: sortById(changeSet.tags),
    notes: sortById(changeSet.notes),
    assets: sortById(changeSet.assets),
    tasks: sortById(changeSet.tasks),
    habits: sortById(changeSet.habits),
    habitLogs: sortById(changeSet.habitLogs),
    goals: sortById(changeSet.goals),
    timeBlocks: sortById(changeSet.timeBlocks),
    tombstones: sortTombstones(changeSet.tombstones)
  } satisfies SyncChangeSet;
}

function createSyncShadowRecord<T extends { id: string }>(
  entityType: SyncEntityKind,
  record: T,
  syncedAt: number,
  revision: string | null
) {
  return {
    key: getEntityKey(entityType, record.id),
    entityType,
    entityId: record.id,
    hash: hashStableValue(record),
    deleted: false,
    syncedAt,
    revision
  } satisfies SyncShadow;
}

function createSyncTombstoneShadow(tombstone: SyncTombstone, syncedAt: number, revision: string | null) {
  return {
    key: tombstone.key,
    entityType: tombstone.entityType,
    entityId: tombstone.entityId,
    hash: createTombstoneHash(tombstone),
    deleted: true,
    syncedAt,
    revision
  } satisfies SyncShadow;
}

function buildShadowEntries(
  source: Pick<
    SyncChangeSet,
    | "projects"
    | "folders"
    | "tags"
    | "notes"
    | "assets"
    | "tasks"
    | "habits"
    | "habitLogs"
    | "goals"
    | "timeBlocks"
    | "tombstones"
  >,
  syncedAt: number,
  revision: string | null
) {
  const shadows: SyncShadow[] = [];

  source.projects.forEach((project) => {
    shadows.push(createSyncShadowRecord("project", project, syncedAt, revision));
  });

  source.folders.forEach((folder) => {
    shadows.push(createSyncShadowRecord("folder", folder, syncedAt, revision));
  });

  source.tags.forEach((tag) => {
    shadows.push(createSyncShadowRecord("tag", tag, syncedAt, revision));
  });

  source.notes.forEach((note) => {
    shadows.push(createSyncShadowRecord("note", note, syncedAt, revision));
  });

  source.assets.forEach((asset) => {
    shadows.push(createSyncShadowRecord("asset", asset, syncedAt, revision));
  });

  source.tasks.forEach((task) => {
    shadows.push(createSyncShadowRecord("task", task, syncedAt, revision));
  });

  source.habits.forEach((habit) => {
    shadows.push(createSyncShadowRecord("habit", habit, syncedAt, revision));
  });

  source.habitLogs.forEach((habitLog) => {
    shadows.push(createSyncShadowRecord("habitLog", habitLog, syncedAt, revision));
  });

  source.goals.forEach((goal) => {
    shadows.push(createSyncShadowRecord("goal", goal, syncedAt, revision));
  });

  source.timeBlocks.forEach((timeBlock) => {
    shadows.push(createSyncShadowRecord("timeBlock", timeBlock, syncedAt, revision));
  });

  source.tombstones.forEach((tombstone) => {
    shadows.push(createSyncTombstoneShadow(tombstone, syncedAt, revision));
  });

  return shadows;
}

function collectChangeSetKeys(
  source: Pick<
    SyncChangeSet,
    | "projects"
    | "folders"
    | "tags"
    | "notes"
    | "assets"
    | "tasks"
    | "habits"
    | "habitLogs"
    | "goals"
    | "timeBlocks"
    | "tombstones"
  >
) {
  return [
    ...source.projects.map((project) => getEntityKey("project", project.id)),
    ...source.folders.map((folder) => getEntityKey("folder", folder.id)),
    ...source.tags.map((tag) => getEntityKey("tag", tag.id)),
    ...source.notes.map((note) => getEntityKey("note", note.id)),
    ...source.assets.map((asset) => getEntityKey("asset", asset.id)),
    ...source.tasks.map((task) => getEntityKey("task", task.id)),
    ...source.habits.map((habit) => getEntityKey("habit", habit.id)),
    ...source.habitLogs.map((habitLog) => getEntityKey("habitLog", habitLog.id)),
    ...source.goals.map((goal) => getEntityKey("goal", goal.id)),
    ...source.timeBlocks.map((timeBlock) => getEntityKey("timeBlock", timeBlock.id)),
    ...source.tombstones.map((tombstone) => tombstone.key)
  ];
}

function appendResolvedStateToChangeSet<T extends { id: string }>(
  entityType: SyncEntityKind,
  changeSet: SyncChangeSet,
  resolved: SnapshotEntityState<T>
) {
  if (resolved.deleted && resolved.tombstone) {
    changeSet.tombstones.push(resolved.tombstone);
    return;
  }

  if (!resolved.record) {
    return;
  }

  switch (entityType) {
    case "project":
      changeSet.projects.push(resolved.record as unknown as Project);
      break;
    case "folder":
      changeSet.folders.push(resolved.record as unknown as Folder);
      break;
    case "tag":
      changeSet.tags.push(resolved.record as unknown as Tag);
      break;
    case "note":
      changeSet.notes.push(resolved.record as unknown as SyncedNoteRecord);
      break;
    case "asset":
      changeSet.assets.push(resolved.record as unknown as SyncedAssetRecord);
      break;
    case "task":
      changeSet.tasks.push(resolved.record as unknown as Task);
      break;
    case "habit":
      changeSet.habits.push(resolved.record as unknown as Habit);
      break;
    case "habitLog":
      changeSet.habitLogs.push(resolved.record as unknown as HabitLog);
      break;
    case "goal":
      changeSet.goals.push(resolved.record as unknown as Goal);
      break;
    case "timeBlock":
      changeSet.timeBlocks.push(resolved.record as unknown as TimeBlock);
      break;
  }
}

function serializeNote(note: Note): SyncedNoteRecord {
  return {
    id: note.id,
    title: note.title,
    contentType: note.contentType,
    projectId: note.projectId,
    folderId: note.folderId,
    color: note.color,
    sortOrder: note.sortOrder ?? note.createdAt,
    tagIds: [...note.tagIds],
    content: normalizeNoteContent(note.content),
    canvasContent: note.canvasContent ? normalizeCanvasContent(note.canvasContent) : null,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    pinned: note.pinned,
    favorite: note.favorite,
    archived: note.archived,
    trashedAt: note.trashedAt,
    conflictOriginId: note.conflictOriginId
  };
}

function hydrateNote(record: SyncedNoteRecord): Note {
  const normalizedContent = normalizeNoteContent(record.content);
  const normalizedCanvas = record.canvasContent ? normalizeCanvasContent(record.canvasContent) : null;
  const excerpt =
    record.contentType === "canvas"
      ? buildCanvasExcerpt(normalizedCanvas)
      : buildExcerpt(normalizedContent);
  const plainText =
    record.contentType === "canvas"
      ? extractCanvasPlainText(normalizedCanvas)
      : extractPlainText(normalizedContent);

  return {
    ...record,
    sortOrder: record.sortOrder ?? record.createdAt,
    tagIds: [...record.tagIds],
    content: normalizedContent,
    canvasContent: normalizedCanvas,
    excerpt,
    plainText,
    syncState: record.conflictOriginId ? "conflict" : "synced"
  };
}

async function blobToBase64(blob: Blob) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("BLOB_READ_FAILED"));
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error("BLOB_READ_FAILED"));
    };

    reader.readAsDataURL(blob);
  });

  return dataUrl.split(",")[1] ?? "";
}

function base64ToBlob(base64: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

async function serializeAsset(asset: Asset): Promise<SyncedAssetRecord> {
  return {
    id: asset.id,
    noteId: asset.noteId,
    name: asset.name,
    mimeType: asset.mimeType,
    size: asset.size,
    kind: asset.kind,
    data: await blobToBase64(asset.blob),
    version: asset.version,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt
  };
}

function hydrateAsset(record: SyncedAssetRecord): Asset {
  return {
    id: record.id,
    noteId: record.noteId,
    name: record.name,
    mimeType: record.mimeType,
    size: record.size,
    kind: record.kind,
    blob: base64ToBlob(record.data, record.mimeType),
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function createRecordState<T extends { id: string }>(
  entityType: SyncEntityKind,
  record: T,
  timestamp: number
) {
  return {
    kind: entityType,
    key: getEntityKey(entityType, record.id),
    hash: hashStableValue(record),
    timestamp,
    deleted: false,
    record
  } satisfies SnapshotEntityState<T>;
}

function createTombstoneState(tombstone: SyncTombstone) {
  return {
    kind: tombstone.entityType,
    key: tombstone.key,
    hash: createTombstoneHash(tombstone),
    timestamp: tombstone.deletedAt,
    deleted: true,
    tombstone
  } satisfies SnapshotEntityState<never>;
}

function buildStateMap<T extends { id: string }>(
  entityType: SyncEntityKind,
  records: readonly T[],
  tombstones: readonly SyncTombstone[],
  timestampAccessor: (record: T) => number
) {
  const map = new Map<string, SnapshotEntityState<T>>();

  records.forEach((record) => {
    map.set(
      getEntityKey(entityType, record.id),
      createRecordState(entityType, record, timestampAccessor(record))
    );
  });

  tombstones
    .filter((tombstone) => tombstone.entityType === entityType)
    .forEach((tombstone) => {
      map.set(tombstone.key, createTombstoneState(tombstone) as SnapshotEntityState<T>);
    });

  return map;
}

function pickNewerState<T>(
  left: SnapshotEntityState<T> | null,
  right: SnapshotEntityState<T> | null
) {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  if (left.timestamp !== right.timestamp) {
    return left.timestamp > right.timestamp ? left : right;
  }

  return right.hash.localeCompare(left.hash) >= 0 ? right : left;
}

function resolveGenericState<T>(state: SyncMutationState<T>) {
  const localHash = state.local?.hash ?? null;
  const remoteHash = state.remote?.hash ?? null;

  if (localHash === remoteHash) {
    return state.remote ?? state.local;
  }

  if (!state.shadowHash) {
    if (!state.local) {
      return state.remote;
    }

    if (!state.remote) {
      return state.local;
    }

    return pickNewerState(state.local, state.remote);
  }

  if (localHash === state.shadowHash) {
    return state.remote;
  }

  if (remoteHash === state.shadowHash) {
    return state.local;
  }

  return pickNewerState(state.local, state.remote);
}

function normalizeConflictTitle(title: string) {
  const baseTitle = title.trim() || "Untitled";
  return baseTitle.endsWith(CONFLICT_SUFFIX) ? baseTitle : `${baseTitle}${CONFLICT_SUFFIX}`;
}

function sanitizeProjectId(note: SyncedNoteRecord, projects: Map<string, Project>) {
  if (projects.has(note.projectId)) {
    return note.projectId;
  }

  return projects.keys().next().value ?? note.projectId;
}

function sanitizeFolderId(note: SyncedNoteRecord, folders: Map<string, Folder>, projectId: string) {
  if (!note.folderId) {
    return null;
  }

  const folder = folders.get(note.folderId);

  if (!folder || folder.projectId !== projectId) {
    return null;
  }

  return folder.id;
}

function sanitizeTagIds(note: SyncedNoteRecord, tags: Map<string, Tag>) {
  return note.tagIds.filter((tagId) => tags.has(tagId));
}

function createConflictAssetClone(
  asset: SyncedAssetRecord,
  nextNoteId: string,
  nextAssetId: string,
  timestamp: number
) {
  return {
    ...asset,
    id: nextAssetId,
    noteId: nextNoteId,
    updatedAt: timestamp
  } satisfies SyncedAssetRecord;
}

function createConflictNoteClone(
  note: SyncedNoteRecord,
  localAssetsById: Map<string, SyncedAssetRecord>,
  projects: Map<string, Project>,
  folders: Map<string, Folder>,
  tags: Map<string, Tag>
) {
  const timestamp = Date.now();
  const nextNoteId = crypto.randomUUID();
  const assetIdMap = new Map<string, string>();
  const clonedAssets: SyncedAssetRecord[] = [];
  const referencedAssetIds =
    note.contentType === "canvas"
      ? extractCanvasReferencedFileIds(note.canvasContent)
      : extractReferencedAssetIds(note.content);

  referencedAssetIds.forEach((assetId) => {
    const localAsset = localAssetsById.get(assetId);

    if (!localAsset) {
      return;
    }

    const nextAssetId = crypto.randomUUID();
    assetIdMap.set(assetId, nextAssetId);
    clonedAssets.push(createConflictAssetClone(localAsset, nextNoteId, nextAssetId, timestamp));
  });

  const projectId = sanitizeProjectId(note, projects);
  const folderId = sanitizeFolderId(note, folders, projectId);
  const nextNote: SyncedNoteRecord = {
    ...note,
    id: nextNoteId,
    title: normalizeConflictTitle(note.title),
    projectId,
    folderId,
    tagIds: sanitizeTagIds(note, tags),
    content:
      note.contentType === "canvas"
        ? note.content
        : remapReferencedAssetIds(note.content, assetIdMap),
    canvasContent:
      note.contentType === "canvas"
        ? remapCanvasFileIds(note.canvasContent, assetIdMap)
        : note.canvasContent,
    updatedAt: timestamp,
    conflictOriginId: note.id
  };

  return {
    note: nextNote,
    assets: clonedAssets
  };
}

function resolveNoteState(
  state: SyncMutationState<SyncedNoteRecord>,
  localAssetsById: Map<string, SyncedAssetRecord>,
  projects: Map<string, Project>,
  folders: Map<string, Folder>,
  tags: Map<string, Tag>,
  stats: SyncRunStats
) {
  const localHash = state.local?.hash ?? null;
  const remoteHash = state.remote?.hash ?? null;

  if (localHash === remoteHash) {
    return {
      canonical: state.remote ?? state.local,
      conflictClone: null,
      conflictAssets: [] as SyncedAssetRecord[]
    };
  }

  if (!state.shadowHash) {
    if (!state.local) {
      return {
        canonical: state.remote,
        conflictClone: null,
        conflictAssets: [] as SyncedAssetRecord[]
      };
    }

    if (!state.remote) {
      return {
        canonical: state.local,
        conflictClone: null,
        conflictAssets: [] as SyncedAssetRecord[]
      };
    }

    if (!state.local.deleted && !state.remote.deleted) {
      const clone = createConflictNoteClone(
        state.local.record!,
        localAssetsById,
        projects,
        folders,
        tags
      );
      stats.conflicts += 1;

      return {
        canonical: state.remote,
        conflictClone: clone.note,
        conflictAssets: clone.assets
      };
    }

    return {
      canonical: pickNewerState(state.local, state.remote),
      conflictClone: null,
      conflictAssets: [] as SyncedAssetRecord[]
    };
  }

  if (localHash === state.shadowHash) {
    return {
      canonical: state.remote,
      conflictClone: null,
      conflictAssets: [] as SyncedAssetRecord[]
    };
  }

  if (remoteHash === state.shadowHash) {
    return {
      canonical: state.local,
      conflictClone: null,
      conflictAssets: [] as SyncedAssetRecord[]
    };
  }

  if (state.local && state.remote && !state.local.deleted && !state.remote.deleted) {
    const clone = createConflictNoteClone(
      state.local.record!,
      localAssetsById,
      projects,
      folders,
      tags
    );
    stats.conflicts += 1;

    return {
      canonical: state.remote,
      conflictClone: clone.note,
      conflictAssets: clone.assets
    };
  }

  return {
    canonical: pickNewerState(state.local, state.remote),
    conflictClone: null,
    conflictAssets: [] as SyncedAssetRecord[]
  };
}

function collectReferencedAssetIds(notes: readonly SyncedNoteRecord[]) {
  const assetIds = new Set<string>();

  notes.forEach((note) => {
    const ids =
      note.contentType === "canvas"
        ? extractCanvasReferencedFileIds(note.canvasContent)
        : extractReferencedAssetIds(note.content);

    ids.forEach((assetId) => assetIds.add(assetId));
  });

  return assetIds;
}

function pruneUnreferencedAssets(
  assets: readonly SyncedAssetRecord[],
  notes: readonly SyncedNoteRecord[]
) {
  const referencedAssetIds = collectReferencedAssetIds(notes);
  const liveNoteIds = new Set(notes.map((note) => note.id));

  return assets.filter(
    (asset) => liveNoteIds.has(asset.noteId) && referencedAssetIds.has(asset.id)
  );
}

async function requestJson<T>(url: string, init: RequestInit = {}) {
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      credentials: url.startsWith("/api/") ? "include" : init.credentials
    });
  } catch (error) {
    throw new Error(normalizeRequestError(error));
  }

  const payload = (await response.json().catch(() => null)) as
    | T
    | { error?: string; code?: string }
    | null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : payload && typeof payload === "object" && "code" in payload && typeof payload.code === "string"
          ? payload.code
        : `HTTP_${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export async function probeSyncConnectionAvailability(
  connection: Pick<
    SyncConnection,
    "id" | "provider" | "serverUrl" | "managementToken" | "sessionToken" | "tokenExpiresAt"
  >
): Promise<"available" | "unavailable" | "authError"> {
  if (connection.provider === "googleDrive") {
    let sessionToken = connection.sessionToken;

    if (
      connection.tokenExpiresAt &&
      connection.tokenExpiresAt <= Date.now() + GOOGLE_DRIVE_TOKEN_REFRESH_SKEW_MS
    ) {
      try {
        const refreshed = await refreshGoogleDriveAccountSessionViaApi({
          connectionId: connection.id
        });

        sessionToken = refreshed.accessToken;
      } catch {
        return "authError";
      }
    }

    const status = await probeGoogleDriveConnection({
      sessionToken
    });

    if (status === "authError") {
      try {
        const refreshed = await refreshGoogleDriveAccountSessionViaApi({
          connectionId: connection.id
        });

        return probeGoogleDriveConnection({
          sessionToken: refreshed.accessToken
        });
      } catch {
        return "authError";
      }
    }

    return status;
  }

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), 3500);

  try {
    if (connection.provider === "hosted") {
      await requestJson<{
        user: HostedAccountUser;
        session: Omit<HostedAccountSession, "token">;
        vaultCount: number;
      }>(buildAccountUrl(connection.serverUrl, "/v1/auth/me"), {
        method: "GET",
        headers: createBearerHeaders(connection.sessionToken, false),
        signal: controller.signal
      });
    } else {
      await requestJson<{
        vaults: SyncRemoteVault[];
      }>(buildPersonalUrl(connection.serverUrl, "/v1/personal/vaults"), {
        method: "GET",
        headers: createBearerHeaders(connection.managementToken, false),
        signal: controller.signal
      });
    }

    return "available";
  } catch (error) {
    const message = normalizeRequestError(error);

    if (message === "UNAUTHORIZED" || message === "INVALID_CREDENTIALS") {
      return "authError";
    }

    return "unavailable";
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export function googleDriveClientConfigured() {
  return isGoogleDriveConfigured();
}

export function getConfiguredGoogleDriveClientId() {
  return getGoogleDriveClientId();
}

export function googleDriveOAuthReady() {
  return googleDriveOAuthReadyViaApi();
}

export async function prepareGoogleDriveOAuth() {
  return prepareGoogleDriveOAuthViaApi();
}

export async function connectGoogleDriveAccount(options?: {
  clientId?: string;
  loginHint?: string;
  prompt?: string;
  silent?: boolean;
}) {
  return connectGoogleDriveAccountViaOAuth(options);
}

export async function refreshGoogleDriveAccountSession(options: {
  connectionId?: string;
  clientId?: string;
  loginHint?: string;
}) {
  return refreshGoogleDriveAccountSessionViaApi(options);
}

export async function clearGoogleDriveAccountSession(accessToken: string) {
  return clearGoogleDriveAccountSessionViaApi(accessToken);
}

export async function revokeGoogleDriveAccountAccess(
  accessToken: string,
  connectionId?: string
) {
  return revokeGoogleDriveAccountAccessViaApi(accessToken, connectionId);
}

export async function pollGoogleDriveRemoteChanges(
  accessToken: string,
  pageToken?: string | null
) {
  return pollGoogleDriveRemoteChangesViaApi(accessToken, pageToken);
}

export { GOOGLE_DRIVE_TOKEN_REFRESH_SKEW_MS };

export async function registerHostedAccount(
  serverUrl: string,
  payload: {
    name: string;
    email: string;
    password: string;
    deviceId?: string | null;
    deviceName?: string | null;
    clientPlatform?: string | null;
  }
) {
  return requestJson<{
    user: HostedAccountUser;
    session: HostedAccountSession;
    entitlement?: HostedCloudEntitlement;
  }>(buildAccountUrl(serverUrl, "/v1/auth/register"), {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ ...payload, authProtocol: 2 })
  });
}

export async function loginHostedAccount(
  serverUrl: string,
  payload: {
    email: string;
    password: string;
    deviceId?: string | null;
    deviceName?: string | null;
    clientPlatform?: string | null;
  }
) {
  return requestJson<{
    user: HostedAccountUser;
    session: HostedAccountSession;
    entitlement?: HostedCloudEntitlement;
  }>(buildAccountUrl(serverUrl, "/v1/auth/login"), {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ ...payload, authProtocol: 2 })
  });
}

export type HostedDeviceLoginStart = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
};

export async function startHostedDeviceLogin(
  serverUrl: string,
  payload: {
    deviceName: string;
    deviceId?: string | null;
    clientPlatform?: string | null;
  }
) {
  return requestJson<HostedDeviceLoginStart>(buildAccountUrl(serverUrl, "/v1/auth/device/start"), {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ ...payload, authProtocol: 2 })
  });
}

export async function pollHostedDeviceLogin(serverUrl: string, deviceCode: string) {
  return requestJson<{
    user: HostedAccountUser;
    session: HostedAccountSession;
    entitlement?: HostedCloudEntitlement;
  }>(buildAccountUrl(serverUrl, "/v1/auth/device/token"), {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      deviceCode
    })
  });
}

export async function refreshHostedAccountSession(
  serverUrl: string,
  payload: {
    refreshToken: string;
    deviceId?: string | null;
    deviceName?: string | null;
    clientPlatform?: string | null;
  }
) {
  return requestJson<{
    user: HostedAccountUser;
    session: HostedAccountSession;
    entitlement?: HostedCloudEntitlement;
  }>(buildAccountUrl(serverUrl, "/v1/auth/refresh"), {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export async function logoutHostedAccount(serverUrl: string, sessionToken: string) {
  return requestJson<{ ok: true }>(buildAccountUrl(serverUrl, "/v1/auth/logout"), {
    method: "POST",
    headers: createBearerHeaders(sessionToken, false)
  });
}

export async function updateHostedAccountProfile(
  serverUrl: string,
  sessionToken: string,
  payload: {
    name: string;
  }
) {
  return requestJson<{
    user: HostedAccountUser;
  }>(buildAccountUrl(serverUrl, "/v1/account/profile"), {
    method: "PATCH",
    headers: createBearerHeaders(sessionToken, true),
    body: JSON.stringify(payload)
  });
}

export async function loadHostedAccountOverview(serverUrl: string, sessionToken: string) {
  const [mePayload, vaultsPayload, devicesPayload] = await Promise.all([
    requestJson<{
      user: HostedAccountUser;
      session: Omit<HostedAccountSession, "token">;
      vaultCount: number;
      usage?: HostedCloudUsage;
      entitlement?: HostedCloudEntitlement;
    }>(buildAccountUrl(serverUrl, "/v1/auth/me"), {
      method: "GET",
      headers: createBearerHeaders(sessionToken, false)
    }),
    requestJson<{
      user: HostedAccountUser;
      vaults: HostedAccountVault[];
    }>(buildAccountUrl(serverUrl, "/v1/account/vaults"), {
      method: "GET",
      headers: createBearerHeaders(sessionToken, false)
    }),
    requestJson<{
      devices: HostedAccountDevice[];
    }>(buildAccountUrl(serverUrl, "/v1/account/devices"), {
      method: "GET",
      headers: createBearerHeaders(sessionToken, false)
    }).catch(() => ({ devices: [] }))
  ]);

  return {
    user: mePayload.user,
    session: mePayload.session,
    vaults: vaultsPayload.vaults,
    devices: devicesPayload.devices,
    usage: mePayload.usage ?? {
      storageBytes: 0,
      vaultCount: mePayload.vaultCount,
      syncTokenCount: 0,
      deviceCount: 0
    },
    entitlement: mePayload.entitlement ?? {
      plan: {
        id: "cloud",
        name: "Locoris Cloud",
        limits: {
          cloudEnabled: true,
          maxVaults: null,
          maxSyncTokens: null,
          storageBytes: null,
          historyDays: null,
          maxUploadBytes: null,
          maxJournalEntriesPerVault: null,
          journalTtlDays: null,
          webAppEnabled: true,
          prioritySupport: false,
          advancedBackupsEnabled: false
        }
      },
      subscription: null,
      accountStatus: "active",
      trialEndsAt: null,
      reason: "OK",
      retention: null,
      limits: {
        cloudEnabled: true,
        maxVaults: null,
        maxSyncTokens: null,
        storageBytes: null,
        historyDays: null,
        maxUploadBytes: null,
        maxJournalEntriesPerVault: null,
        journalTtlDays: null,
        webAppEnabled: true,
        prioritySupport: false,
        advancedBackupsEnabled: false
      },
      capabilities: {
        canUseCloud: true,
        canCreateVault: true,
        canWriteSync: true,
        canReadSync: true,
        canIssueToken: true,
        canDeleteCloudData: true,
        canExportCloudData: true,
        webAppEnabled: true,
        prioritySupport: false,
        advancedBackupsEnabled: false
      }
    }
  } satisfies HostedAccountOverview;
}

export async function createHostedVault(
  serverUrl: string,
  sessionToken: string,
  payload: {
    name: string;
    id?: string;
  }
) {
  return requestJson<{
    vault: HostedAccountVault;
  }>(buildAccountUrl(serverUrl, "/v1/account/vaults"), {
    method: "POST",
    headers: createBearerHeaders(sessionToken, true),
    body: JSON.stringify(payload)
  });
}

export async function deleteHostedVault(serverUrl: string, sessionToken: string, vaultId: string) {
  return requestJson<{
    ok: true;
    vaultId: string;
  }>(buildAccountUrl(serverUrl, `/v1/account/vaults/${encodeURIComponent(vaultId)}`), {
    method: "DELETE",
    headers: createBearerHeaders(sessionToken, false)
  });
}

export async function renameHostedVault(
  serverUrl: string,
  sessionToken: string,
  vaultId: string,
  name: string
) {
  return requestJson<{
    vault: HostedAccountVault | null;
  }>(buildAccountUrl(serverUrl, `/v1/account/vaults/${encodeURIComponent(vaultId)}`), {
    method: "PATCH",
    headers: createBearerHeaders(sessionToken, true),
    body: JSON.stringify({
      name
    })
  });
}

export async function revokeHostedAccountDevice(
  serverUrl: string,
  sessionToken: string,
  deviceId: string
) {
  return requestJson<{
    ok: true;
    device: HostedAccountDevice;
  }>(buildAccountUrl(serverUrl, `/v1/account/devices/${encodeURIComponent(deviceId)}`), {
    method: "DELETE",
    headers: createBearerHeaders(sessionToken, false)
  });
}

export async function registerHostedVaultDevice(
  serverUrl: string,
  sessionToken: string,
  vaultId: string,
  payload: {
    deviceName: string;
    deviceId?: string | null;
    clientPlatform?: string | null;
  }
) {
  return requestJson<{
    token: string;
    tokenMeta: {
      id: string;
      vaultId: string;
      label: string;
      deviceId: string | null;
      deviceName: string;
      clientPlatform: string | null;
      createdAt: number;
      lastUsedAt: number | null;
    };
    device: HostedAccountDevice;
  }>(buildAccountUrl(serverUrl, `/v1/account/vaults/${encodeURIComponent(vaultId)}/devices/register`), {
    method: "POST",
    headers: createBearerHeaders(sessionToken, true),
    body: JSON.stringify(payload)
  });
}

export async function loadPersonalServerVaults(serverUrl: string, managementToken: string) {
  return requestJson<{
    vaults: SyncRemoteVault[];
  }>(buildPersonalUrl(serverUrl, "/v1/personal/vaults"), {
    method: "GET",
    headers: createBearerHeaders(managementToken, false)
  });
}

export async function loadPersonalServerPairingInfo(serverUrl: string) {
  return requestJson<{
    serverId: string;
    product: string;
    ownerConnected: boolean;
    setupAvailable: boolean;
    pairingVersion: number;
  }>(buildPersonalUrl(serverUrl, "/v1/pairing/info"), {
    method: "GET"
  });
}

export async function redeemPersonalServerInvite(
  serverUrl: string,
  payload: {
    code?: string;
    secret?: string;
    deviceSecret: string;
    claimSecret?: string;
    deviceName: string;
    platform: string;
  }
) {
  return requestJson<{
    status: "connected" | "pending";
    device?: PersonalServerDevice;
    request?: PersonalServerPairingRequest;
    server: {
      id: string;
      name: string;
    };
  }>(buildPersonalUrl(serverUrl, "/v1/pairing/redeem"), {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export async function pollPersonalServerPairing(
  serverUrl: string,
  requestId: string,
  claimSecret: string
) {
  return requestJson<{
    status: PersonalServerPairingRequest["status"];
    request: PersonalServerPairingRequest;
    device: PersonalServerDevice | null;
    server: {
      id: string;
      name: string;
    };
  }>(buildPersonalUrl(serverUrl, `/v1/pairing/requests/${encodeURIComponent(requestId)}/status`), {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ claimSecret })
  });
}

export async function loadPersonalServerAccess(
  serverUrl: string,
  deviceCredential: string
) {
  return requestJson<PersonalServerAccessOverview>(buildPersonalUrl(serverUrl, "/v1/personal/access"), {
    method: "GET",
    headers: createBearerHeaders(deviceCredential, false)
  });
}

export async function createPersonalServerInvite(
  serverUrl: string,
  deviceCredential: string,
  payload: {
    kind: "owner_device" | "guest";
    label?: string;
    vaultIds?: string[];
    permission?: PersonalServerVaultPermission;
    expiresInMs?: number;
    serverUrl?: string;
  }
) {
  return requestJson<{
    invite: PersonalServerInvite & {
      code: string;
      secret: string;
    };
    connection: {
      connectionPackage: string;
      url: string;
    };
  }>(buildPersonalUrl(serverUrl, "/v1/personal/invites"), {
    method: "POST",
    headers: createBearerHeaders(deviceCredential, true),
    body: JSON.stringify(payload)
  });
}

export async function decidePersonalServerPairingRequest(
  serverUrl: string,
  deviceCredential: string,
  requestId: string,
  approve: boolean
) {
  return requestJson<{
    request: PersonalServerPairingRequest;
    device?: PersonalServerDevice;
  }>(
    buildPersonalUrl(
      serverUrl,
      `/v1/personal/pairing-requests/${encodeURIComponent(requestId)}/decision`
    ),
    {
      method: "POST",
      headers: createBearerHeaders(deviceCredential, true),
      body: JSON.stringify({ approve })
    }
  );
}

export async function revokePersonalServerDevice(
  serverUrl: string,
  deviceCredential: string,
  deviceId: string
) {
  return requestJson<{
    device: PersonalServerDevice;
  }>(buildPersonalUrl(serverUrl, `/v1/personal/devices/${encodeURIComponent(deviceId)}`), {
    method: "DELETE",
    headers: createBearerHeaders(deviceCredential, false)
  });
}

export async function revokePersonalServerInvite(
  serverUrl: string,
  deviceCredential: string,
  inviteId: string
) {
  return requestJson<{ ok: true }>(
    buildPersonalUrl(serverUrl, `/v1/personal/invites/${encodeURIComponent(inviteId)}`),
    {
      method: "DELETE",
      headers: createBearerHeaders(deviceCredential, false)
    }
  );
}

export async function loadGoogleDriveVaults(sessionToken: string) {
  return {
    vaults: await listGoogleDriveRemoteVaults(sessionToken)
  };
}

export async function createPersonalServerVault(
  serverUrl: string,
  managementToken: string,
  payload: {
    name: string;
    id?: string;
  }
) {
  return requestJson<{
    vault: SyncRemoteVault;
  }>(buildPersonalUrl(serverUrl, "/v1/personal/vaults"), {
    method: "POST",
    headers: createBearerHeaders(managementToken, true),
    body: JSON.stringify(payload)
  });
}

export async function createGoogleDriveVault(
  sessionToken: string,
  payload: {
    name: string;
    id?: string;
  }
) {
  return {
    vault: await createGoogleDriveRemoteVault(sessionToken, payload)
  };
}

export async function deletePersonalServerVault(
  serverUrl: string,
  managementToken: string,
  vaultId: string
) {
  return requestJson<{
    ok: true;
    vaultId: string;
  }>(buildPersonalUrl(serverUrl, `/v1/personal/vaults/${encodeURIComponent(vaultId)}`), {
    method: "DELETE",
    headers: createBearerHeaders(managementToken, false)
  });
}

export async function renamePersonalServerVault(
  serverUrl: string,
  managementToken: string,
  vaultId: string,
  name: string
) {
  return requestJson<{
    vault: SyncRemoteVault | null;
  }>(buildPersonalUrl(serverUrl, `/v1/personal/vaults/${encodeURIComponent(vaultId)}`), {
    method: "PATCH",
    headers: createBearerHeaders(managementToken, true),
    body: JSON.stringify({
      name
    })
  });
}

export async function deleteGoogleDriveVault(sessionToken: string, vaultId: string) {
  await deleteGoogleDriveRemoteVault(sessionToken, vaultId);
  return {
    ok: true as const,
    vaultId
  };
}

export async function renameGoogleDriveVault(sessionToken: string, vaultId: string, name: string) {
  return {
    vault: await renameGoogleDriveRemoteVault(sessionToken, {
      vaultId,
      vaultName: name
    })
  };
}

export async function issuePersonalServerVaultToken(
  serverUrl: string,
  managementToken: string,
  vaultId: string,
  label: string
) {
  return requestJson<{
    token: string;
    tokenMeta: {
      id: string;
      vaultId: string;
      label: string;
      createdAt: number;
      lastUsedAt: number | null;
    };
  }>(buildPersonalUrl(serverUrl, `/v1/personal/vaults/${encodeURIComponent(vaultId)}/tokens`), {
    method: "POST",
    headers: createBearerHeaders(managementToken, true),
    body: JSON.stringify({
      label
    })
  });
}

export async function issueGoogleDriveVaultToken(vaultId: string) {
  return {
    token: buildGoogleDriveBindingToken(),
    tokenMeta: {
      id: `google-drive-${vaultId}`,
      vaultId,
      label: "Google Drive session",
      createdAt: Date.now(),
      lastUsedAt: Date.now()
    }
  };
}

async function pullSelfHostedEnvelope(serverUrl: string, vaultId: string, token: string) {
  return requestJson<RemoteEnvelopeRecord>(buildVaultStateUrl(serverUrl, vaultId), {
    method: "GET",
    headers: createBearerHeaders(token, false)
  });
}

export async function importRemoteVaultIntoLocalVault(input: {
  provider: SyncConnectionProvider;
  localVaultId: string;
  serverUrl: string;
  remoteVaultId: string;
  syncToken: string;
}) {
  const remote = {
    provider: input.provider,
    serverUrl: input.serverUrl,
    vaultId: input.remoteVaultId,
    token: input.syncToken,
    localVaultId: input.localVaultId,
    localVaultName: null
  } satisfies RemoteSyncConfig;
  const envelope = await withLocalVaultDatabase(input.localVaultId, async (database) => {
    if (input.provider === "googleDrive") {
      return (
        await loadResolvedGoogleDriveBootstrap(input.syncToken, remote, database, {
          syncVaultNameFromMetadata: false
        })
      ).envelope;
    }

    const rawEnvelope = await pullSelfHostedEnvelope(
      input.serverUrl,
      input.remoteVaultId,
      input.syncToken
    );
    return resolveRemoteEnvelopeRecord(rawEnvelope, remote, database, {
      syncVaultNameFromMetadata: false
    });
  });

  await writeImportedVaultSnapshot(input.localVaultId, {
    snapshot: envelope.snapshot,
    revision: envelope.revision
  });
  await persistLocalVaultStorage(input.localVaultId);

  return {
    revision: envelope.revision,
    vaultKind: envelope.metadata?.payloadMode === "encrypted" ? "private" : "regular",
    importedBodies:
      envelope.snapshot.projects.length +
      envelope.snapshot.folders.length +
      envelope.snapshot.tags.length +
      envelope.snapshot.notes.length +
      envelope.snapshot.assets.length +
      envelope.snapshot.tasks.length +
      envelope.snapshot.habits.length +
      envelope.snapshot.habitLogs.length +
      envelope.snapshot.goals.length +
      envelope.snapshot.timeBlocks.length
  };
}

export async function primeRemoteVaultEncryptionMetadata(input: {
  provider: SyncConnectionProvider;
  localVaultId: string;
  serverUrl: string;
  remoteVaultId: string;
  syncToken: string;
}) {
  const rawEnvelope =
    input.provider === "googleDrive"
      ? await loadGoogleDriveRemoteEnvelope(input.syncToken, input.remoteVaultId)
      : await pullSelfHostedEnvelope(input.serverUrl, input.remoteVaultId, input.syncToken);

  try {
    const envelope = await withLocalVaultDatabase(input.localVaultId, async (database) =>
      resolveRemoteEnvelopeRecord(
        rawEnvelope,
        {
          provider: input.provider,
          serverUrl: input.serverUrl,
          vaultId: input.remoteVaultId,
          token: input.syncToken,
          localVaultId: input.localVaultId
        },
        database,
        {
          syncVaultNameFromMetadata: false
        }
      )
    );

    return envelope.metadata?.payloadMode === "encrypted" ? "private" : "regular";
  } catch (error) {
    if (error instanceof Error && error.message === "VAULT_ENCRYPTION_LOCKED") {
      return "private" as const;
    }

    throw error;
  }
}

async function pullSelfHostedChanges(
  serverUrl: string,
  vaultId: string,
  token: string,
  sinceRevision: string
) {
  return requestJson<SyncChangeFeed>(buildVaultChangesUrl(serverUrl, vaultId, sinceRevision), {
    method: "GET",
    headers: createBearerHeaders(token, false)
  });
}

async function pushSelfHostedChanges(
  serverUrl: string,
  vaultId: string,
  token: string,
  baseRevision: string | null,
  changes: SyncChangeSet
) {
  let response: Response;

  try {
    response = await fetch(buildVaultChangesUrl(serverUrl, vaultId), {
      method: "POST",
      headers: createBearerHeaders(token, true),
      body: JSON.stringify({
        baseRevision,
        changes
      })
    });
  } catch (error) {
    throw new Error(normalizeRequestError(error));
  }

  const payload = (await response.json().catch(() => null)) as
    | { revision?: string | null; error?: string }
    | null;

  if (response.status === 409) {
    return {
      conflict: true,
      revision:
        payload && typeof payload === "object" && "revision" in payload
          ? payload.revision ?? null
          : null
    };
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && typeof payload.error === "string"
        ? payload.error
        : `HTTP_${response.status}`;
    throw new Error(message);
  }

  return {
    conflict: false,
    revision:
      payload && typeof payload === "object" && typeof payload.revision === "string"
        ? payload.revision
        : null
  };
}

async function pushSelfHostedEncryptedChanges(
  serverUrl: string,
  vaultId: string,
  token: string,
  baseRevision: string | null,
  input: {
    encryptedChanges: SyncEncryptedPayload;
    encryptedSnapshot: SyncEncryptedPayload;
    metadata: SyncEnvelopeMetadata;
  }
) {
  let response: Response;

  try {
    response = await fetch(buildVaultChangesUrl(serverUrl, vaultId), {
      method: "POST",
      headers: createBearerHeaders(token, true),
      body: JSON.stringify({
        baseRevision,
        encryptedChanges: input.encryptedChanges,
        encryptedSnapshot: input.encryptedSnapshot,
        metadata: input.metadata
      })
    });
  } catch (error) {
    throw new Error(normalizeRequestError(error));
  }

  const payload = (await response.json().catch(() => null)) as
    | { revision?: string | null; error?: string }
    | null;

  if (response.status === 409) {
    return {
      conflict: true,
      revision:
        payload && typeof payload === "object" && "revision" in payload
          ? payload.revision ?? null
          : null
    };
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && typeof payload.error === "string"
        ? payload.error
        : `HTTP_${response.status}`;
    throw new Error(message);
  }

  return {
    conflict: false,
    revision:
      payload && typeof payload === "object" && typeof payload.revision === "string"
        ? payload.revision
        : null
  };
}

async function pushSelfHostedEnvelope(
  serverUrl: string,
  vaultId: string,
  token: string,
  baseRevision: string | null,
  envelope: RemoteEnvelopeRecord
) {
  let response: Response;

  try {
    const body = isEncryptedEnvelopeRecord(envelope)
      ? JSON.stringify({
          baseRevision,
          encryptedSnapshot: envelope.encryptedSnapshot,
          metadata: envelope.metadata ?? null
        })
      : JSON.stringify({
          baseRevision,
          snapshot: envelope.snapshot,
          metadata: envelope.metadata ?? null
        });

    response = await fetch(buildVaultStateUrl(serverUrl, vaultId), {
      method: "PUT",
      headers: createBearerHeaders(token, true),
      body
    });
  } catch (error) {
    throw new Error(normalizeRequestError(error));
  }

  const payload = (await response.json().catch(() => null)) as RemoteEnvelopeRecord | { error?: string } | null;

  if (response.status === 409) {
    return {
      conflict: true,
      envelope: payload as RemoteEnvelopeRecord
    };
  }

  if (!response.ok || !payload || typeof payload !== "object" || !("revision" in payload)) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `HTTP_${response.status}`;
    throw new Error(message);
  }

  return {
    conflict: false,
    envelope: payload as RemoteEnvelopeRecord
  };
}

async function loadRemoteEnvelopeRecord(
  remote: RemoteSyncConfig
): Promise<RemoteEnvelopeRecord> {
  if (remote.provider === "googleDrive") {
    return loadGoogleDriveRemoteEnvelope(remote.token, remote.vaultId);
  }

  return pullSelfHostedEnvelope(remote.serverUrl, remote.vaultId, remote.token);
}

async function saveRemoteEnvelopeRecord(
  remote: RemoteSyncConfig,
  baseRevision: string | null,
  envelope: RemoteEnvelopeRecord
) {
  if (remote.provider === "googleDrive") {
    try {
      const record = await saveGoogleDriveRemoteEnvelope(remote.token, {
        vaultId: remote.vaultId,
        vaultName: remote.localVaultName ?? buildRemoteVaultDescriptor(remote).name ?? remote.vaultId,
        envelope,
        baseRevision
      });

      return {
        conflict: false as const,
        envelope: {
          ...envelope,
          revision: record.revision
        }
      };
    } catch (error) {
      if (error instanceof Error && error.message === "SYNC_REVISION_CONFLICT") {
        return {
          conflict: true as const,
          envelope
        };
      }

      throw error;
    }
  }

  return pushSelfHostedEnvelope(
    remote.serverUrl,
    remote.vaultId,
    remote.token,
    baseRevision,
    envelope
  );
}

function resolveVaultPassphraseOrThrow(remote: Pick<RemoteSyncConfig, "localVaultId">) {
  const localVaultId = remote.localVaultId?.trim() ?? "";
  const passphrase = localVaultId ? getVaultEncryptionSessionPassphrase(localVaultId) : null;

  if (!passphrase) {
    throw new Error("VAULT_ENCRYPTION_LOCKED");
  }

  return passphrase;
}

async function decryptEncryptedChangeBatches(
  encryptedChanges: readonly SyncEncryptedPayload[],
  metadata: SyncEnvelopeMetadata | null | undefined,
  remote: RemoteSyncConfig,
  settings: AppSettings,
  options?: {
    passphraseOverride?: string | null;
  }
) {
  if (encryptedChanges.length === 0) {
    return [] as SyncChangeSet[];
  }

  if (metadata?.payloadMode !== "encrypted" || !metadata.encryption) {
    throw new Error("ENCRYPTED_SYNC_NOT_IMPLEMENTED");
  }

  const passphrase = options?.passphraseOverride?.trim() || resolveVaultPassphraseOrThrow(remote);
  const descriptor = metadata.encryption;
  const vaultDescriptor = metadata.vault ?? buildRemoteVaultDescriptor(remote);

  if (!settings.encryptionEnabled) {
    throw new Error("VAULT_ENCRYPTION_LOCKED");
  }

  return Promise.all(
    encryptedChanges.map(async (payload) =>
      normalizeChangeSetPayload(
        await decryptSyncPayload<SyncChangeSet>(payload, passphrase, descriptor, vaultDescriptor),
        remote.localVaultId ?? "server"
      )
    )
  );
}

async function loadResolvedGoogleDriveBootstrap(
  token: string,
  remote: RemoteSyncConfig,
  database: LocorisDatabase,
  options?: ResolveRemoteEnvelopeOptions & {
    passphraseOverride?: string | null;
  }
) {
  const bootstrap = await loadGoogleDriveRemoteBootstrap(token, remote.vaultId);
  const checkpoint = await resolveRemoteEnvelopeRecord(
    bootstrap.envelope,
    remote,
    database,
    options
  );
  const settings = await database.settings.get("app");

  if (!settings) {
    throw new Error("SETTINGS_MISSING");
  }

  const changeSets = bootstrap.encryptedChanges
    ? await decryptEncryptedChangeBatches(
        bootstrap.encryptedChanges,
        checkpoint.metadata,
        remote,
        settings,
        { passphraseOverride: options?.passphraseOverride }
      )
    : bootstrap.changes
      ? [normalizeChangeSetPayload(bootstrap.changes, "google-drive")]
      : [];

  return {
    rawEnvelope: bootstrap.envelope,
    envelope: {
      ...checkpoint,
      revision: bootstrap.revision,
      snapshot: applyChangeSetsToSnapshot(checkpoint.snapshot, changeSets)
    } satisfies ResolvedRemoteEnvelope
  };
}

async function encryptChangeSetBatch(
  changeSet: SyncChangeSet,
  remote: RemoteSyncConfig,
  settings: AppSettings
) {
  const passphrase = resolveVaultPassphraseOrThrow(remote);
  const descriptor = buildEncryptionDescriptorFromSettings(settings);
  const vaultDescriptor = buildRemoteVaultDescriptor(remote);

  const encryptedChanges = await encryptSyncPayload(changeSet, passphrase, {
    vault: vaultDescriptor,
    descriptor
  });

  return {
    descriptor: encryptedChanges.descriptor,
    encryptedChanges: encryptedChanges.payload
  };
}

export async function migrateRemoteVaultEncryption(
  remote: RemoteSyncConfig,
  input:
    | {
        mode: "enable";
        passphrase: string;
      }
    | {
        mode: "changePassphrase";
        currentPassphrase: string;
        nextPassphrase: string;
      }
    | {
        mode: "disable";
        currentPassphrase: string;
      },
  database: LocorisDatabase = db
) {
  const settings = await database.settings.get("app");

  if (!settings) {
    throw new Error("SETTINGS_MISSING");
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [localSnapshot, shadows] = await Promise.all([
      exportLocalSyncSnapshot(database),
      database.syncShadows.toArray()
    ]);
    const resolveOptions = {
      passphraseOverride: input.mode === "enable" ? null : input.currentPassphrase,
      hydrateFromMetadata: input.mode !== "enable"
    } satisfies ResolveRemoteEnvelopeOptions;
    let rawRemoteEnvelope: RemoteEnvelopeRecord;
    let remoteEnvelope: ResolvedRemoteEnvelope;

    if (remote.provider === "googleDrive") {
      const resolved = await loadResolvedGoogleDriveBootstrap(
        remote.token,
        remote,
        database,
        resolveOptions
      );
      rawRemoteEnvelope = resolved.rawEnvelope;
      remoteEnvelope = resolved.envelope;
    } else {
      rawRemoteEnvelope = await loadRemoteEnvelopeRecord(remote);
      remoteEnvelope = await resolveRemoteEnvelopeRecord(
        rawRemoteEnvelope,
        remote,
        database,
        resolveOptions
      );
    }
    const merged = mergeSnapshots(localSnapshot, remoteEnvelope.snapshot, shadows);
    const nextDescriptor =
      input.mode === "disable"
        ? null
        : await createEncryptionDescriptor(
            input.mode === "enable" ? input.passphrase : input.nextPassphrase,
            buildRemoteVaultDescriptor(remote)
          );
    const nextEnvelope = await createOutgoingRemoteEnvelope(
      merged.snapshot,
      rawRemoteEnvelope,
      remote,
      settings,
      {
        forcePayloadMode: input.mode === "disable" ? "plain" : "encrypted",
        passphraseOverride:
          input.mode === "enable"
            ? input.passphrase
            : input.mode === "changePassphrase"
              ? input.nextPassphrase
              : null,
        descriptorOverride: nextDescriptor
      }
    );
    const pushed = await saveRemoteEnvelopeRecord(remote, remoteEnvelope.revision, nextEnvelope);

    if (pushed.conflict) {
      continue;
    }

    await replaceLocalDataFromSnapshot(merged.snapshot, settings, database);
    await persistSyncShadows(merged.snapshot, pushed.envelope.revision, database);
    await rebuildSyncDirtyEntriesFromCurrentState(database);
    await database.settings.update("app", {
      syncStatus: "idle",
      lastSyncAt: Date.now(),
      syncCursor: pushed.envelope.revision
    });

    if (remote.localVaultId) {
      await persistLocalVaultStorage(remote.localVaultId);
    }

    return {
      revision: pushed.envelope.revision ?? "",
      descriptor: nextDescriptor
    };
  }

  throw new Error("SYNC_REVISION_CONFLICT");
}

export async function exportLocalSyncSnapshot(database: LocorisDatabase = db): Promise<SyncSnapshot> {
  const [projects, folders, tags, notes, assets, tasks, habits, habitLogs, goals, timeBlocks, settings, tombstones] =
    await Promise.all([
      database.projects.toArray(),
      database.folders.toArray(),
      database.tags.toArray(),
      database.notes.toArray(),
      database.assets.toArray(),
      database.tasks.toArray(),
      database.habits.toArray(),
      database.habitLogs.toArray(),
      database.goals.toArray(),
      database.timeBlocks.toArray(),
      database.settings.get("app"),
      database.syncTombstones.toArray()
    ]);

  if (!settings) {
    throw new Error("SETTINGS_MISSING");
  }

  const syncedAssets = await Promise.all(sortById(assets).map((asset) => serializeAsset(asset)));

  return {
    deviceId: settings.localDeviceId,
    exportedAt: Date.now(),
    projects: sortById(projects),
    folders: sortById(folders),
    tags: sortById(tags),
    notes: sortById(notes).map((note) => serializeNote(note)),
    assets: sortById(syncedAssets),
    tasks: sortById(tasks),
    habits: sortById(habits),
    habitLogs: sortById(habitLogs),
    goals: sortById(goals),
    timeBlocks: sortById(timeBlocks),
    tombstones: sortTombstones(tombstones)
  };
}

function buildShadowMap(shadows: readonly SyncShadow[]) {
  return new Map(shadows.map((shadow) => [shadow.key, shadow]));
}

function countChangedKeys<T>(
  localMap: Map<string, SnapshotEntityState<T>>,
  remoteMap: Map<string, SnapshotEntityState<T>>,
  shadows: Map<string, SyncShadow>
) {
  const keys = new Set([...localMap.keys(), ...remoteMap.keys()]);
  let pulled = 0;
  let pushed = 0;

  keys.forEach((key) => {
    const shadowHash = shadows.get(key)?.hash ?? null;
    const localHash = localMap.get(key)?.hash ?? null;
    const remoteHash = remoteMap.get(key)?.hash ?? null;

    if (shadowHash !== localHash) {
      pushed += 1;
    }

    if (shadowHash !== remoteHash) {
      pulled += 1;
    }
  });

  return {
    pulled,
    pushed
  };
}

function createChangeStateMaps(changeSet: SyncChangeSet) {
  return {
    projects: buildStateMap("project", changeSet.projects, changeSet.tombstones, (record) => record.updatedAt),
    folders: buildStateMap("folder", changeSet.folders, changeSet.tombstones, (record) => record.updatedAt),
    tags: buildStateMap("tag", changeSet.tags, changeSet.tombstones, (record) => record.updatedAt),
    notes: buildStateMap("note", changeSet.notes, changeSet.tombstones, (record) => record.updatedAt),
    assets: buildStateMap("asset", changeSet.assets, changeSet.tombstones, (record) => record.updatedAt),
    tasks: buildStateMap("task", changeSet.tasks, changeSet.tombstones, (record) => record.updatedAt),
    habits: buildStateMap("habit", changeSet.habits, changeSet.tombstones, (record) => record.updatedAt),
    habitLogs: buildStateMap("habitLog", changeSet.habitLogs, changeSet.tombstones, (record) => record.updatedAt),
    goals: buildStateMap("goal", changeSet.goals, changeSet.tombstones, (record) => record.updatedAt),
    timeBlocks: buildStateMap("timeBlock", changeSet.timeBlocks, changeSet.tombstones, (record) => record.updatedAt)
  };
}

function mergeChangeSetsIntoSnapshot(
  localSnapshot: SyncSnapshot,
  localChanges: SyncChangeSet,
  remoteChanges: SyncChangeSet,
  shadows: readonly SyncShadow[]
) {
  const normalizedLocalSnapshot = normalizeSyncSnapshotPayload(localSnapshot);
  const shadowMap = buildShadowMap(shadows);
  const stats: SyncRunStats = {
    pulled: countChangeSetEntries(remoteChanges),
    pushed: 0,
    conflicts: 0
  };
  const outgoingChanges = createEmptyChangeSet(normalizedLocalSnapshot.deviceId);
  outgoingChanges.exportedAt = Date.now();

  const localStateMaps = createChangeStateMaps(localChanges);
  const remoteStateMaps = createChangeStateMaps(remoteChanges);
  const currentProjectsMap = new Map(normalizedLocalSnapshot.projects.map((project) => [project.id, project]));
  const currentFoldersMap = new Map(normalizedLocalSnapshot.folders.map((folder) => [folder.id, folder]));
  const currentTagsMap = new Map(normalizedLocalSnapshot.tags.map((tag) => [tag.id, tag]));
  const currentNotesMap = new Map(normalizedLocalSnapshot.notes.map((note) => [note.id, note]));
  const currentAssetsMap = new Map(normalizedLocalSnapshot.assets.map((asset) => [asset.id, asset]));
  const currentTasksMap = new Map(normalizedLocalSnapshot.tasks.map((task) => [task.id, task]));
  const currentHabitsMap = new Map(normalizedLocalSnapshot.habits.map((habit) => [habit.id, habit]));
  const currentHabitLogsMap = new Map(normalizedLocalSnapshot.habitLogs.map((habitLog) => [habitLog.id, habitLog]));
  const currentGoalsMap = new Map(normalizedLocalSnapshot.goals.map((goal) => [goal.id, goal]));
  const currentTimeBlocksMap = new Map(
    normalizedLocalSnapshot.timeBlocks.map((timeBlock) => [timeBlock.id, timeBlock])
  );
  const mergedTombstones = new Map(normalizedLocalSnapshot.tombstones.map((tombstone) => [tombstone.key, tombstone]));
  const localAssetsById = new Map(normalizedLocalSnapshot.assets.map((asset) => [asset.id, asset]));
  let localMutationCount = 0;

  const registerResolvedGenericState = <T extends { id: string }>(
    entityType: SyncEntityKind,
    resolved: SnapshotEntityState<T>,
    localState: SnapshotEntityState<T> | null,
    remoteState: SnapshotEntityState<T> | null
  ) => {
    const remoteCurrentHash = remoteState?.hash ?? shadowMap.get(resolved.key)?.hash ?? null;
    const localCurrentHash = localState?.hash ?? shadowMap.get(resolved.key)?.hash ?? null;

    if (resolved.hash !== localCurrentHash) {
      localMutationCount += 1;
    }

    if (resolved.hash !== remoteCurrentHash && resolved.hash === (localState?.hash ?? null)) {
      appendResolvedStateToChangeSet(entityType, outgoingChanges, resolved);
    }
  };

  const projectKeys = new Set([...localStateMaps.projects.keys(), ...remoteStateMaps.projects.keys()]);
  projectKeys.forEach((key) => {
    const localState = localStateMaps.projects.get(key) ?? null;
    const remoteState = remoteStateMaps.projects.get(key) ?? null;
    const resolved = resolveGenericState<Project>({
      local: localState,
      remote: remoteState,
      shadowHash: shadowMap.get(key)?.hash ?? null
    });

    if (!resolved) {
      return;
    }

    registerResolvedGenericState("project", resolved, localState, remoteState);

    if (resolved.deleted && resolved.tombstone) {
      currentProjectsMap.delete(resolved.tombstone.entityId);
      mergedTombstones.set(resolved.tombstone.key, resolved.tombstone);
      return;
    }

    if (resolved.record) {
      currentProjectsMap.set(resolved.record.id, resolved.record);
      mergedTombstones.delete(key);
    }
  });

  const folderKeys = new Set([...localStateMaps.folders.keys(), ...remoteStateMaps.folders.keys()]);
  folderKeys.forEach((key) => {
    const localState = localStateMaps.folders.get(key) ?? null;
    const remoteState = remoteStateMaps.folders.get(key) ?? null;
    const resolved = resolveGenericState<Folder>({
      local: localState,
      remote: remoteState,
      shadowHash: shadowMap.get(key)?.hash ?? null
    });

    if (!resolved) {
      return;
    }

    registerResolvedGenericState("folder", resolved, localState, remoteState);

    if (resolved.deleted && resolved.tombstone) {
      currentFoldersMap.delete(resolved.tombstone.entityId);
      mergedTombstones.set(resolved.tombstone.key, resolved.tombstone);
      return;
    }

    if (resolved.record && currentProjectsMap.has(resolved.record.projectId)) {
      currentFoldersMap.set(resolved.record.id, resolved.record);
      mergedTombstones.delete(key);
    } else if (resolved.record) {
      currentFoldersMap.delete(resolved.record.id);
    }
  });

  const tagKeys = new Set([...localStateMaps.tags.keys(), ...remoteStateMaps.tags.keys()]);
  tagKeys.forEach((key) => {
    const localState = localStateMaps.tags.get(key) ?? null;
    const remoteState = remoteStateMaps.tags.get(key) ?? null;
    const resolved = resolveGenericState<Tag>({
      local: localState,
      remote: remoteState,
      shadowHash: shadowMap.get(key)?.hash ?? null
    });

    if (!resolved) {
      return;
    }

    registerResolvedGenericState("tag", resolved, localState, remoteState);

    if (resolved.deleted && resolved.tombstone) {
      currentTagsMap.delete(resolved.tombstone.entityId);
      mergedTombstones.set(resolved.tombstone.key, resolved.tombstone);
      return;
    }

    if (resolved.record) {
      currentTagsMap.set(resolved.record.id, resolved.record);
      mergedTombstones.delete(key);
    }
  });

  const noteKeys = new Set([...localStateMaps.notes.keys(), ...remoteStateMaps.notes.keys()]);
  const conflictAssets: SyncedAssetRecord[] = [];

  noteKeys.forEach((key) => {
    const localState = localStateMaps.notes.get(key) ?? null;
    const remoteState = remoteStateMaps.notes.get(key) ?? null;
    const resolved = resolveNoteState(
      {
        local: localState,
        remote: remoteState,
        shadowHash: shadowMap.get(key)?.hash ?? null
      },
      localAssetsById,
      currentProjectsMap,
      currentFoldersMap,
      currentTagsMap,
      stats
    );
    const remoteCurrentHash = remoteState?.hash ?? shadowMap.get(key)?.hash ?? null;
    const localCurrentHash = localState?.hash ?? shadowMap.get(key)?.hash ?? null;

    if (resolved.canonical) {
      if (resolved.canonical.hash !== localCurrentHash) {
        localMutationCount += 1;
      }

      if (
        resolved.canonical.hash !== remoteCurrentHash &&
        resolved.canonical.hash === (localState?.hash ?? null)
      ) {
        appendResolvedStateToChangeSet("note", outgoingChanges, resolved.canonical);
      }

      if (resolved.canonical.deleted && resolved.canonical.tombstone) {
        currentNotesMap.delete(resolved.canonical.tombstone.entityId);
        mergedTombstones.set(resolved.canonical.tombstone.key, resolved.canonical.tombstone);
      } else if (resolved.canonical.record) {
        const record = resolved.canonical.record;
        const projectId = sanitizeProjectId(record, currentProjectsMap);
        const folderId = sanitizeFolderId(record, currentFoldersMap, projectId);

        currentNotesMap.set(record.id, {
          ...record,
          projectId,
          folderId,
          tagIds: sanitizeTagIds(record, currentTagsMap)
        });
        mergedTombstones.delete(key);
      }
    }

    if (resolved.conflictClone) {
      currentNotesMap.set(resolved.conflictClone.id, resolved.conflictClone);
      outgoingChanges.notes.push(resolved.conflictClone);
      localMutationCount += 1;
    }

    resolved.conflictAssets.forEach((asset) => {
      conflictAssets.push(asset);
      outgoingChanges.assets.push(asset);
    });
  });

  const assetKeys = new Set([...localStateMaps.assets.keys(), ...remoteStateMaps.assets.keys()]);
  assetKeys.forEach((key) => {
    const localState = localStateMaps.assets.get(key) ?? null;
    const remoteState = remoteStateMaps.assets.get(key) ?? null;
    const resolved = resolveGenericState<SyncedAssetRecord>({
      local: localState,
      remote: remoteState,
      shadowHash: shadowMap.get(key)?.hash ?? null
    });

    if (!resolved) {
      return;
    }

    registerResolvedGenericState("asset", resolved, localState, remoteState);

    if (resolved.deleted && resolved.tombstone) {
      currentAssetsMap.delete(resolved.tombstone.entityId);
      mergedTombstones.set(resolved.tombstone.key, resolved.tombstone);
      return;
    }

    if (resolved.record) {
      currentAssetsMap.set(resolved.record.id, resolved.record);
      mergedTombstones.delete(key);
    }
  });

  conflictAssets.forEach((asset) => {
    currentAssetsMap.set(asset.id, asset);
    mergedTombstones.delete(getEntityKey("asset", asset.id));
  });

  const mergeGenericPlannerEntity = <T extends { id: string }>(
    entityType: SyncEntityKind,
    localMap: Map<string, SnapshotEntityState<T>>,
    remoteMap: Map<string, SnapshotEntityState<T>>,
    currentMap: Map<string, T>
  ) => {
    const keys = new Set([...localMap.keys(), ...remoteMap.keys()]);

    keys.forEach((key) => {
      const localState = localMap.get(key) ?? null;
      const remoteState = remoteMap.get(key) ?? null;
      const resolved = resolveGenericState<T>({
        local: localState,
        remote: remoteState,
        shadowHash: shadowMap.get(key)?.hash ?? null
      });

      if (!resolved) {
        return;
      }

      registerResolvedGenericState(entityType, resolved, localState, remoteState);

      if (resolved.deleted && resolved.tombstone) {
        currentMap.delete(resolved.tombstone.entityId);
        mergedTombstones.set(resolved.tombstone.key, resolved.tombstone);
        return;
      }

      if (resolved.record) {
        currentMap.set(resolved.record.id, resolved.record);
        mergedTombstones.delete(key);
      }
    });
  };

  mergeGenericPlannerEntity("task", localStateMaps.tasks, remoteStateMaps.tasks, currentTasksMap);
  mergeGenericPlannerEntity("habit", localStateMaps.habits, remoteStateMaps.habits, currentHabitsMap);
  mergeGenericPlannerEntity("habitLog", localStateMaps.habitLogs, remoteStateMaps.habitLogs, currentHabitLogsMap);
  mergeGenericPlannerEntity("goal", localStateMaps.goals, remoteStateMaps.goals, currentGoalsMap);
  mergeGenericPlannerEntity("timeBlock", localStateMaps.timeBlocks, remoteStateMaps.timeBlocks, currentTimeBlocksMap);

  const notes = sortById([...currentNotesMap.values()]);
  const assets = sortById(pruneUnreferencedAssets([...currentAssetsMap.values()], notes));
  const liveAssetIds = new Set(assets.map((asset) => asset.id));

  [...mergedTombstones.keys()].forEach((key) => {
    if (key.startsWith("asset:")) {
      const assetId = key.replace("asset:", "");

      if (liveAssetIds.has(assetId)) {
        mergedTombstones.delete(key);
      }
    }
  });

  outgoingChanges.projects = sortById(outgoingChanges.projects);
  outgoingChanges.folders = sortById(outgoingChanges.folders);
  outgoingChanges.tags = sortById(outgoingChanges.tags);
  outgoingChanges.notes = sortById(outgoingChanges.notes);
  outgoingChanges.assets = sortById(outgoingChanges.assets);
  outgoingChanges.tasks = sortById(outgoingChanges.tasks);
  outgoingChanges.habits = sortById(outgoingChanges.habits);
  outgoingChanges.habitLogs = sortById(outgoingChanges.habitLogs);
  outgoingChanges.goals = sortById(outgoingChanges.goals);
  outgoingChanges.timeBlocks = sortById(outgoingChanges.timeBlocks);
  outgoingChanges.tombstones = sortTombstones(outgoingChanges.tombstones);
  stats.pushed = countChangeSetEntries(outgoingChanges);

  return {
    snapshot: {
      deviceId: normalizedLocalSnapshot.deviceId,
      exportedAt: Date.now(),
      projects: sortById([...currentProjectsMap.values()]),
      folders: sortById([...currentFoldersMap.values()]),
      tags: sortById([...currentTagsMap.values()]),
      notes,
      assets,
      tasks: sortById([...currentTasksMap.values()]),
      habits: sortById([...currentHabitsMap.values()]),
      habitLogs: sortById([...currentHabitLogsMap.values()]),
      goals: sortById([...currentGoalsMap.values()]),
      timeBlocks: sortById([...currentTimeBlocksMap.values()]),
      tombstones: sortTombstones([...mergedTombstones.values()])
    } satisfies SyncSnapshot,
    outgoingChanges,
    stats,
    requiresLocalReplace: localMutationCount > 0
  };
}

function mergeSnapshots(
  local: SyncSnapshot,
  remote: SyncSnapshot,
  shadows: readonly SyncShadow[]
) {
  const localSnapshot = normalizeSyncSnapshotPayload(local);
  const remoteSnapshot = normalizeSyncSnapshotPayload(remote, localSnapshot.deviceId);
  const shadowMap = buildShadowMap(shadows);
  const stats: SyncRunStats = {
    pulled: 0,
    pushed: 0,
    conflicts: 0
  };

  const localProjects = buildStateMap("project", localSnapshot.projects, localSnapshot.tombstones, (record) => record.updatedAt);
  const remoteProjects = buildStateMap("project", remoteSnapshot.projects, remoteSnapshot.tombstones, (record) => record.updatedAt);
  const localFolders = buildStateMap("folder", localSnapshot.folders, localSnapshot.tombstones, (record) => record.updatedAt);
  const remoteFolders = buildStateMap("folder", remoteSnapshot.folders, remoteSnapshot.tombstones, (record) => record.updatedAt);
  const localTags = buildStateMap("tag", localSnapshot.tags, localSnapshot.tombstones, (record) => record.updatedAt);
  const remoteTags = buildStateMap("tag", remoteSnapshot.tags, remoteSnapshot.tombstones, (record) => record.updatedAt);
  const localNotes = buildStateMap("note", localSnapshot.notes, localSnapshot.tombstones, (record) => record.updatedAt);
  const remoteNotes = buildStateMap("note", remoteSnapshot.notes, remoteSnapshot.tombstones, (record) => record.updatedAt);
  const localAssets = buildStateMap("asset", localSnapshot.assets, localSnapshot.tombstones, (record) => record.updatedAt);
  const remoteAssets = buildStateMap("asset", remoteSnapshot.assets, remoteSnapshot.tombstones, (record) => record.updatedAt);
  const localTasks = buildStateMap("task", localSnapshot.tasks, localSnapshot.tombstones, (record) => record.updatedAt);
  const remoteTasks = buildStateMap("task", remoteSnapshot.tasks, remoteSnapshot.tombstones, (record) => record.updatedAt);
  const localHabits = buildStateMap("habit", localSnapshot.habits, localSnapshot.tombstones, (record) => record.updatedAt);
  const remoteHabits = buildStateMap("habit", remoteSnapshot.habits, remoteSnapshot.tombstones, (record) => record.updatedAt);
  const localHabitLogs = buildStateMap("habitLog", localSnapshot.habitLogs, localSnapshot.tombstones, (record) => record.updatedAt);
  const remoteHabitLogs = buildStateMap("habitLog", remoteSnapshot.habitLogs, remoteSnapshot.tombstones, (record) => record.updatedAt);
  const localGoals = buildStateMap("goal", localSnapshot.goals, localSnapshot.tombstones, (record) => record.updatedAt);
  const remoteGoals = buildStateMap("goal", remoteSnapshot.goals, remoteSnapshot.tombstones, (record) => record.updatedAt);
  const localTimeBlocks = buildStateMap("timeBlock", localSnapshot.timeBlocks, localSnapshot.tombstones, (record) => record.updatedAt);
  const remoteTimeBlocks = buildStateMap("timeBlock", remoteSnapshot.timeBlocks, remoteSnapshot.tombstones, (record) => record.updatedAt);
  const changeCounts = [
    countChangedKeys(localProjects, remoteProjects, shadowMap),
    countChangedKeys(localFolders, remoteFolders, shadowMap),
    countChangedKeys(localTags, remoteTags, shadowMap),
    countChangedKeys(localNotes, remoteNotes, shadowMap),
    countChangedKeys(localAssets, remoteAssets, shadowMap),
    countChangedKeys(localTasks, remoteTasks, shadowMap),
    countChangedKeys(localHabits, remoteHabits, shadowMap),
    countChangedKeys(localHabitLogs, remoteHabitLogs, shadowMap),
    countChangedKeys(localGoals, remoteGoals, shadowMap),
    countChangedKeys(localTimeBlocks, remoteTimeBlocks, shadowMap)
  ];

  stats.pulled = changeCounts.reduce((sum, entry) => sum + entry.pulled, 0);
  stats.pushed = changeCounts.reduce((sum, entry) => sum + entry.pushed, 0);

  const mergedProjectsMap = new Map<string, Project>();
  const mergedFoldersMap = new Map<string, Folder>();
  const mergedTagsMap = new Map<string, Tag>();
  const mergedTasksMap = new Map<string, Task>();
  const mergedHabitsMap = new Map<string, Habit>();
  const mergedHabitLogsMap = new Map<string, HabitLog>();
  const mergedGoalsMap = new Map<string, Goal>();
  const mergedTimeBlocksMap = new Map<string, TimeBlock>();
  const mergedTombstones = new Map<string, SyncTombstone>();
  const mergedProjectKeys = new Set([...localProjects.keys(), ...remoteProjects.keys()]);
  const mergedFolderKeys = new Set([...localFolders.keys(), ...remoteFolders.keys()]);
  const mergedTagKeys = new Set([...localTags.keys(), ...remoteTags.keys()]);

  mergedProjectKeys.forEach((key) => {
    const resolved = resolveGenericState({
      local: localProjects.get(key) ?? null,
      remote: remoteProjects.get(key) ?? null,
      shadowHash: shadowMap.get(key)?.hash ?? null
    });

    if (!resolved) {
      return;
    }

    if (resolved.deleted && resolved.tombstone) {
      mergedTombstones.set(key, resolved.tombstone);
      return;
    }

    if (resolved.record) {
      mergedProjectsMap.set(resolved.record.id, resolved.record);
    }
  });

  mergedFolderKeys.forEach((key) => {
    const resolved = resolveGenericState({
      local: localFolders.get(key) ?? null,
      remote: remoteFolders.get(key) ?? null,
      shadowHash: shadowMap.get(key)?.hash ?? null
    });

    if (!resolved) {
      return;
    }

    if (resolved.deleted && resolved.tombstone) {
      mergedTombstones.set(key, resolved.tombstone);
      return;
    }

    if (resolved.record && mergedProjectsMap.has(resolved.record.projectId)) {
      mergedFoldersMap.set(resolved.record.id, resolved.record);
    }
  });

  mergedTagKeys.forEach((key) => {
    const resolved = resolveGenericState({
      local: localTags.get(key) ?? null,
      remote: remoteTags.get(key) ?? null,
      shadowHash: shadowMap.get(key)?.hash ?? null
    });

    if (!resolved) {
      return;
    }

    if (resolved.deleted && resolved.tombstone) {
      mergedTombstones.set(key, resolved.tombstone);
      return;
    }

    if (resolved.record) {
      mergedTagsMap.set(resolved.record.id, resolved.record);
    }
  });

  const localAssetsById = new Map(localSnapshot.assets.map((asset) => [asset.id, asset]));
  const mergedNotesMap = new Map<string, SyncedNoteRecord>();
  const conflictAssets: SyncedAssetRecord[] = [];
  const mergedNoteKeys = new Set([...localNotes.keys(), ...remoteNotes.keys()]);

  mergedNoteKeys.forEach((key) => {
    const resolved = resolveNoteState(
      {
        local: localNotes.get(key) ?? null,
        remote: remoteNotes.get(key) ?? null,
        shadowHash: shadowMap.get(key)?.hash ?? null
      },
      localAssetsById,
      mergedProjectsMap,
      mergedFoldersMap,
      mergedTagsMap,
      stats
    );

    if (resolved.canonical?.deleted && resolved.canonical.tombstone) {
      mergedTombstones.set(key, resolved.canonical.tombstone);
    } else if (resolved.canonical?.record) {
      const record = resolved.canonical.record;
      const projectId = sanitizeProjectId(record, mergedProjectsMap);
      const folderId = sanitizeFolderId(record, mergedFoldersMap, projectId);

      mergedNotesMap.set(record.id, {
        ...record,
        projectId,
        folderId,
        tagIds: sanitizeTagIds(record, mergedTagsMap)
      });
    }

    if (resolved.conflictClone) {
      mergedNotesMap.set(resolved.conflictClone.id, resolved.conflictClone);
    }

    resolved.conflictAssets.forEach((asset) => {
      conflictAssets.push(asset);
    });
  });

  const mergedAssetKeys = new Set([...localAssets.keys(), ...remoteAssets.keys()]);
  const mergedAssetsMap = new Map<string, SyncedAssetRecord>();

  mergedAssetKeys.forEach((key) => {
    const resolved = resolveGenericState({
      local: localAssets.get(key) ?? null,
      remote: remoteAssets.get(key) ?? null,
      shadowHash: shadowMap.get(key)?.hash ?? null
    });

    if (!resolved) {
      return;
    }

    if (resolved.deleted && resolved.tombstone) {
      mergedTombstones.set(key, resolved.tombstone);
      return;
    }

    if (resolved.record) {
      mergedAssetsMap.set(resolved.record.id, resolved.record);
    }
  });

  conflictAssets.forEach((asset) => {
    mergedAssetsMap.set(asset.id, asset);
    mergedTombstones.delete(getEntityKey("asset", asset.id));
  });

  const mergeGenericEntity = <T extends { id: string }>(
    localMap: Map<string, SnapshotEntityState<T>>,
    remoteMap: Map<string, SnapshotEntityState<T>>,
    outputMap: Map<string, T>
  ) => {
    const keys = new Set([...localMap.keys(), ...remoteMap.keys()]);

    keys.forEach((key) => {
      const resolved = resolveGenericState<T>({
        local: localMap.get(key) ?? null,
        remote: remoteMap.get(key) ?? null,
        shadowHash: shadowMap.get(key)?.hash ?? null
      });

      if (!resolved) {
        return;
      }

      if (resolved.deleted && resolved.tombstone) {
        mergedTombstones.set(key, resolved.tombstone);
        return;
      }

      if (resolved.record) {
        outputMap.set(resolved.record.id, resolved.record);
        mergedTombstones.delete(key);
      }
    });
  };

  mergeGenericEntity(localTasks, remoteTasks, mergedTasksMap);
  mergeGenericEntity(localHabits, remoteHabits, mergedHabitsMap);
  mergeGenericEntity(localHabitLogs, remoteHabitLogs, mergedHabitLogsMap);
  mergeGenericEntity(localGoals, remoteGoals, mergedGoalsMap);
  mergeGenericEntity(localTimeBlocks, remoteTimeBlocks, mergedTimeBlocksMap);

  const notes = sortById([...mergedNotesMap.values()]);
  const assets = sortById(pruneUnreferencedAssets([...mergedAssetsMap.values()], notes));
  const liveAssetIds = new Set(assets.map((asset) => asset.id));

  [...mergedTombstones.keys()].forEach((key) => {
    if (key.startsWith("asset:")) {
      const assetId = key.replace("asset:", "");

      if (liveAssetIds.has(assetId)) {
        mergedTombstones.delete(key);
      }
    }
  });

  return {
    snapshot: {
      deviceId: localSnapshot.deviceId,
      exportedAt: Date.now(),
      projects: sortById([...mergedProjectsMap.values()]),
      folders: sortById([...mergedFoldersMap.values()]),
      tags: sortById([...mergedTagsMap.values()]),
      notes,
      assets,
      tasks: sortById([...mergedTasksMap.values()]),
      habits: sortById([...mergedHabitsMap.values()]),
      habitLogs: sortById([...mergedHabitLogsMap.values()]),
      goals: sortById([...mergedGoalsMap.values()]),
      timeBlocks: sortById([...mergedTimeBlocksMap.values()]),
      tombstones: sortTombstones([...mergedTombstones.values()])
    } satisfies SyncSnapshot,
    stats
  };
}

async function replaceLocalDataFromSnapshot(
  snapshot: SyncSnapshot,
  settings: AppSettings,
  database: LocorisDatabase = db
) {
  const normalizedSnapshot = normalizeSyncSnapshotPayload(snapshot, settings.localDeviceId);
  const notes = sortById(normalizedSnapshot.notes).map((note) => hydrateNote(note));
  const assets = sortById(normalizedSnapshot.assets).map((asset) => hydrateAsset(asset));
  const nextOpenedNoteId =
    settings.lastOpenedNoteId && notes.some((note) => note.id === settings.lastOpenedNoteId)
      ? settings.lastOpenedNoteId
      : notes[0]?.id ?? null;

  resetResolvedAssetCache();

  await database.transaction(
    "rw",
    [
      database.projects,
      database.folders,
      database.tags,
      database.notes,
      database.assets,
      database.tasks,
      database.habits,
      database.habitLogs,
      database.goals,
      database.timeBlocks,
      database.syncTombstones,
      database.settings
    ],
    async () => {
      await database.projects.clear();
      await database.folders.clear();
      await database.tags.clear();
      await database.notes.clear();
      await database.assets.clear();
      await database.tasks.clear();
      await database.habits.clear();
      await database.habitLogs.clear();
      await database.goals.clear();
      await database.timeBlocks.clear();
      await database.syncTombstones.clear();

      if (normalizedSnapshot.projects.length > 0) {
        await database.projects.bulkAdd(sortById(normalizedSnapshot.projects));
      }

      if (normalizedSnapshot.folders.length > 0) {
        await database.folders.bulkAdd(sortById(normalizedSnapshot.folders));
      }

      if (normalizedSnapshot.tags.length > 0) {
        await database.tags.bulkAdd(sortById(normalizedSnapshot.tags));
      }

      if (notes.length > 0) {
        await database.notes.bulkAdd(notes);
      }

      if (assets.length > 0) {
        await database.assets.bulkAdd(assets);
      }

      if (normalizedSnapshot.tasks.length > 0) {
        await database.tasks.bulkAdd(sortById(normalizedSnapshot.tasks));
      }

      if (normalizedSnapshot.habits.length > 0) {
        await database.habits.bulkAdd(sortById(normalizedSnapshot.habits));
      }

      if (normalizedSnapshot.habitLogs.length > 0) {
        await database.habitLogs.bulkAdd(sortById(normalizedSnapshot.habitLogs));
      }

      if (normalizedSnapshot.goals.length > 0) {
        await database.goals.bulkAdd(sortById(normalizedSnapshot.goals));
      }

      if (normalizedSnapshot.timeBlocks.length > 0) {
        await database.timeBlocks.bulkAdd(sortById(normalizedSnapshot.timeBlocks));
      }

      if (normalizedSnapshot.tombstones.length > 0) {
        await database.syncTombstones.bulkAdd(sortTombstones(normalizedSnapshot.tombstones));
      }

      await database.settings.update("app", {
        lastOpenedNoteId: nextOpenedNoteId
      });
    }
  );
}

async function applySyncChangeSetToLocalData(
  changeSet: SyncChangeSet,
  database: LocorisDatabase = db
) {
  if (isChangeSetEmpty(changeSet)) {
    return;
  }

  const projectIdsToDelete = changeSet.tombstones
    .filter((tombstone) => tombstone.entityType === "project")
    .map((tombstone) => tombstone.entityId);
  const folderIdsToDelete = changeSet.tombstones
    .filter((tombstone) => tombstone.entityType === "folder")
    .map((tombstone) => tombstone.entityId);
  const tagIdsToDelete = changeSet.tombstones
    .filter((tombstone) => tombstone.entityType === "tag")
    .map((tombstone) => tombstone.entityId);
  const noteIdsToDelete = changeSet.tombstones
    .filter((tombstone) => tombstone.entityType === "note")
    .map((tombstone) => tombstone.entityId);
  const assetIdsToDelete = changeSet.tombstones
    .filter((tombstone) => tombstone.entityType === "asset")
    .map((tombstone) => tombstone.entityId);
  const taskIdsToDelete = changeSet.tombstones
    .filter((tombstone) => tombstone.entityType === "task")
    .map((tombstone) => tombstone.entityId);
  const habitIdsToDelete = changeSet.tombstones
    .filter((tombstone) => tombstone.entityType === "habit")
    .map((tombstone) => tombstone.entityId);
  const habitLogIdsToDelete = changeSet.tombstones
    .filter((tombstone) => tombstone.entityType === "habitLog")
    .map((tombstone) => tombstone.entityId);
  const goalIdsToDelete = changeSet.tombstones
    .filter((tombstone) => tombstone.entityType === "goal")
    .map((tombstone) => tombstone.entityId);
  const timeBlockIdsToDelete = changeSet.tombstones
    .filter((tombstone) => tombstone.entityType === "timeBlock")
    .map((tombstone) => tombstone.entityId);
  const restoredTombstoneKeys = [
    ...changeSet.projects.map((project) => getEntityKey("project", project.id)),
    ...changeSet.folders.map((folder) => getEntityKey("folder", folder.id)),
    ...changeSet.tags.map((tag) => getEntityKey("tag", tag.id)),
    ...changeSet.notes.map((note) => getEntityKey("note", note.id)),
    ...changeSet.assets.map((asset) => getEntityKey("asset", asset.id)),
    ...changeSet.tasks.map((task) => getEntityKey("task", task.id)),
    ...changeSet.habits.map((habit) => getEntityKey("habit", habit.id)),
    ...changeSet.habitLogs.map((habitLog) => getEntityKey("habitLog", habitLog.id)),
    ...changeSet.goals.map((goal) => getEntityKey("goal", goal.id)),
    ...changeSet.timeBlocks.map((timeBlock) => getEntityKey("timeBlock", timeBlock.id))
  ];
  const hydratedNotes = sortById(changeSet.notes).map((note) => hydrateNote(note));
  const hydratedAssets = sortById(changeSet.assets).map((asset) => hydrateAsset(asset));
  const needsAssetCacheReset = changeSet.assets.length > 0 || assetIdsToDelete.length > 0;

  await database.transaction(
    "rw",
    [
      database.projects,
      database.folders,
      database.tags,
      database.notes,
      database.assets,
      database.tasks,
      database.habits,
      database.habitLogs,
      database.goals,
      database.timeBlocks,
      database.syncTombstones,
      database.settings
    ],
    async () => {
      if (projectIdsToDelete.length > 0) {
        await database.projects.bulkDelete(projectIdsToDelete);
      }

      if (folderIdsToDelete.length > 0) {
        await database.folders.bulkDelete(folderIdsToDelete);
      }

      if (tagIdsToDelete.length > 0) {
        await database.tags.bulkDelete(tagIdsToDelete);
      }

      if (noteIdsToDelete.length > 0) {
        await database.notes.bulkDelete(noteIdsToDelete);
      }

      if (assetIdsToDelete.length > 0) {
        await database.assets.bulkDelete(assetIdsToDelete);
      }

      if (taskIdsToDelete.length > 0) {
        await database.tasks.bulkDelete(taskIdsToDelete);
      }

      if (habitIdsToDelete.length > 0) {
        await database.habits.bulkDelete(habitIdsToDelete);
      }

      if (habitLogIdsToDelete.length > 0) {
        await database.habitLogs.bulkDelete(habitLogIdsToDelete);
      }

      if (goalIdsToDelete.length > 0) {
        await database.goals.bulkDelete(goalIdsToDelete);
      }

      if (timeBlockIdsToDelete.length > 0) {
        await database.timeBlocks.bulkDelete(timeBlockIdsToDelete);
      }

      if (changeSet.projects.length > 0) {
        await database.projects.bulkPut(sortById(changeSet.projects));
      }

      if (changeSet.folders.length > 0) {
        await database.folders.bulkPut(sortById(changeSet.folders));
      }

      if (changeSet.tags.length > 0) {
        await database.tags.bulkPut(sortById(changeSet.tags));
      }

      if (hydratedNotes.length > 0) {
        await database.notes.bulkPut(hydratedNotes);
      }

      if (hydratedAssets.length > 0) {
        await database.assets.bulkPut(hydratedAssets);
      }

      if (changeSet.tasks.length > 0) {
        await database.tasks.bulkPut(sortById(changeSet.tasks));
      }

      if (changeSet.habits.length > 0) {
        await database.habits.bulkPut(sortById(changeSet.habits));
      }

      if (changeSet.habitLogs.length > 0) {
        await database.habitLogs.bulkPut(sortById(changeSet.habitLogs));
      }

      if (changeSet.goals.length > 0) {
        await database.goals.bulkPut(sortById(changeSet.goals));
      }

      if (changeSet.timeBlocks.length > 0) {
        await database.timeBlocks.bulkPut(sortById(changeSet.timeBlocks));
      }

      if (restoredTombstoneKeys.length > 0) {
        await database.syncTombstones.bulkDelete(restoredTombstoneKeys);
      }

      if (changeSet.tombstones.length > 0) {
        await database.syncTombstones.bulkPut(sortTombstones(changeSet.tombstones));
      }

      const currentSettings = await database.settings.get("app");

      if (!currentSettings) {
        throw new Error("SETTINGS_MISSING");
      }

      const nextOpenedNoteId =
        currentSettings.lastOpenedNoteId &&
        (await database.notes.get(currentSettings.lastOpenedNoteId))
          ? currentSettings.lastOpenedNoteId
          : ((await database.notes.orderBy("id").first())?.id ?? null);

      if (nextOpenedNoteId !== currentSettings.lastOpenedNoteId) {
        await database.settings.update("app", {
          lastOpenedNoteId: nextOpenedNoteId
        });
      }
    }
  );

  if (needsAssetCacheReset) {
    resetResolvedAssetCache();
  }
}

async function persistSyncShadows(
  snapshot: SyncSnapshot,
  revision: string | null,
  database: LocorisDatabase = db
) {
  const syncedAt = Date.now();
  const shadows = buildShadowEntries(snapshot, syncedAt, revision);

  await database.transaction("rw", database.syncShadows, async () => {
    await database.syncShadows.clear();

    if (shadows.length > 0) {
      await database.syncShadows.bulkAdd(shadows);
    }
  });
}

async function persistSyncShadowChanges(
  changeSet: SyncChangeSet,
  revision: string | null,
  database: LocorisDatabase = db
) {
  if (isChangeSetEmpty(changeSet)) {
    return;
  }

  const shadows = buildShadowEntries(changeSet, Date.now(), revision);

  await database.transaction("rw", database.syncShadows, async () => {
    if (shadows.length > 0) {
      await database.syncShadows.bulkPut(shadows);
    }
  });
}

async function clearSyncDirtyEntriesByKeys(
  keys: readonly string[],
  database: LocorisDatabase = db
) {
  if (keys.length === 0) {
    return;
  }

  await database.syncDirtyEntries.bulkDelete([...keys]);
}

function parseSyncError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "SYNC_FAILED";
}

export async function runSelfHostedSync(
  settings: AppSettings,
  options?: {
    onStatusChange?: (status: SyncStatus) => Promise<void> | void;
    localPendingCount?: number;
  }
): Promise<SyncExecutionResult> {
  return runConfiguredSync(
    {
      provider: "selfHosted",
      serverUrl: settings.selfHostedUrl,
      vaultId: settings.selfHostedVaultId,
      token: settings.selfHostedToken
    },
    options
  );
}

export async function runHostedSync(
  settings: AppSettings,
  options?: {
    onStatusChange?: (status: SyncStatus) => Promise<void> | void;
    localPendingCount?: number;
  }
): Promise<SyncExecutionResult> {
  return runConfiguredSync(
    {
      provider: "hosted",
      serverUrl: settings.hostedUrl,
      vaultId: settings.hostedVaultId,
      token: settings.hostedSyncToken
    },
    options
  );
}

function shouldFallbackToSnapshotSync(error: unknown) {
  const message = parseSyncError(error);
  return message === "NOT_FOUND" || message === "HTTP_404";
}

async function runSnapshotSyncCycle(
  serverUrl: string,
  vaultId: string,
  token: string,
  options?: {
    localVaultId?: string | null;
    localVaultName?: string | null;
    provider?: "selfHosted" | "hosted";
  },
  providedEnvelope?: RemoteEnvelopeRecord | null,
  database: LocorisDatabase = db
) {
  const remoteConfig = {
    provider: options?.provider ?? "selfHosted",
    serverUrl,
    vaultId,
    token,
    localVaultId: options?.localVaultId ?? null,
    localVaultName: options?.localVaultName ?? null
  };
  const [rawRemoteEnvelope, localSnapshot, shadows] = await Promise.all([
    providedEnvelope ? Promise.resolve(providedEnvelope) : pullSelfHostedEnvelope(serverUrl, vaultId, token),
    exportLocalSyncSnapshot(database),
    database.syncShadows.toArray()
  ]);
  const remoteEnvelope = await resolveRemoteEnvelopeRecord(rawRemoteEnvelope, remoteConfig, database);
  const merged = mergeSnapshots(localSnapshot, remoteEnvelope.snapshot, shadows);
  const settings = await database.settings.get("app");

  if (!settings) {
    throw new Error("SETTINGS_MISSING");
  }

  const nextEnvelope = await createOutgoingRemoteEnvelope(
    merged.snapshot,
    rawRemoteEnvelope,
    remoteConfig,
    settings
  );
  const pushed = await pushSelfHostedEnvelope(
    serverUrl,
    vaultId,
    token,
    remoteEnvelope.revision,
    nextEnvelope
  );

  if (pushed.conflict) {
    return "retry" as const;
  }

  await replaceLocalDataFromSnapshot(merged.snapshot, settings, database);
  await persistSyncShadows(merged.snapshot, pushed.envelope.revision, database);
  await rebuildSyncDirtyEntriesFromCurrentState(database);
  await database.settings.update("app", {
    syncStatus: "idle",
    lastSyncAt: Date.now(),
    syncCursor: pushed.envelope.revision
  });

  return {
    revision: pushed.envelope.revision ?? "",
    stats: merged.stats,
    syncMode:
      nextEnvelope.metadata?.payloadMode === "encrypted"
        ? "encrypted-snapshot"
        : "snapshot"
  } satisfies SyncExecutionResult;
}

async function runGoogleDriveSyncCycle(
  vaultId: string,
  token: string,
  options?: {
    localVaultId?: string | null;
    localVaultName?: string | null;
  },
  providedEnvelope?: RemoteEnvelopeRecord | null,
  database: LocorisDatabase = db
) {
  const remoteConfig = {
    provider: "googleDrive" as const,
    serverUrl: GOOGLE_DRIVE_API_BASE_URL,
    vaultId,
    token,
    localVaultId: options?.localVaultId ?? null,
    localVaultName: options?.localVaultName ?? null
  };
  const [bootstrap, localSnapshot, shadows] = await Promise.all([
    providedEnvelope
      ? Promise.resolve({
          revision: providedEnvelope.revision ?? "",
          checkpointRevision: providedEnvelope.revision ?? null,
          envelope: providedEnvelope,
          changes: null,
          encryptedChanges: null
        })
      : loadGoogleDriveRemoteBootstrap(token, vaultId),
    exportLocalSyncSnapshot(database),
    database.syncShadows.toArray()
  ]);
  const checkpointEnvelope = await resolveRemoteEnvelopeRecord(
    bootstrap.envelope,
    remoteConfig,
    database
  );
  const settings = await database.settings.get("app");

  if (!settings) {
    throw new Error("SETTINGS_MISSING");
  }

  const remoteChangeSets = bootstrap.encryptedChanges
    ? await decryptEncryptedChangeBatches(
        bootstrap.encryptedChanges,
        checkpointEnvelope.metadata,
        remoteConfig,
        settings
      )
    : bootstrap.changes
      ? [normalizeChangeSetPayload(bootstrap.changes, "google-drive")]
      : [];
  const remoteEnvelope = {
    ...checkpointEnvelope,
    revision: bootstrap.revision,
    snapshot: applyChangeSetsToSnapshot(checkpointEnvelope.snapshot, remoteChangeSets)
  };

  const localVaultProfile =
    options?.localVaultId ? getLocalVaultProfile(options.localVaultId) : null;
  const merged = mergeSnapshots(localSnapshot, remoteEnvelope.snapshot, shadows);
  const nextEnvelope = await createOutgoingRemoteEnvelope(
    merged.snapshot,
    bootstrap.envelope,
    {
      ...remoteConfig,
      localVaultName: localVaultProfile?.name ?? options?.localVaultName ?? null
    },
    settings
  );
  const snapshotJournalChanges = buildChangeSetBetweenSnapshots(
    remoteEnvelope.snapshot,
    merged.snapshot
  );
  const resolvedVaultName =
    localVaultProfile?.name || remoteEnvelope.metadata?.vault?.name || vaultId;
  const pushed =
    nextEnvelope.metadata?.payloadMode === "encrypted"
      ? await (async () => {
          const { encryptedChanges } = await encryptChangeSetBatch(
            snapshotJournalChanges,
            remoteConfig,
            settings
          );

          return pushGoogleDriveRemoteChanges(token, {
            vaultId,
            vaultName: resolvedVaultName,
            baseRevision: bootstrap.revision,
            envelope: nextEnvelope,
            encryptedChanges
          });
        })()
      : await pushGoogleDriveRemoteChanges(token, {
          vaultId,
          vaultName: resolvedVaultName,
          baseRevision: bootstrap.revision,
          envelope: nextEnvelope,
          changes: snapshotJournalChanges
        });

  if (pushed.conflict) {
    return "retry" as const;
  }

  await replaceLocalDataFromSnapshot(merged.snapshot, settings, database);
  await persistSyncShadows(merged.snapshot, pushed.revision, database);
  await rebuildSyncDirtyEntriesFromCurrentState(database);
  await database.settings.update("app", {
    syncStatus: "idle",
    lastSyncAt: Date.now(),
    syncCursor: pushed.revision
  });

  return {
    revision: pushed.revision ?? "",
    stats: merged.stats,
    syncMode:
      nextEnvelope.metadata?.payloadMode === "encrypted"
        ? "encrypted-snapshot"
        : "snapshot"
  } satisfies SyncExecutionResult;
}

async function runGoogleDriveDeltaSyncCycle(
  vaultId: string,
  token: string,
  options?: {
    localPendingCount?: number;
    localVaultId?: string | null;
    localVaultName?: string | null;
  },
  database: LocorisDatabase = db
) {
  let [settings, shadows] = await Promise.all([
    database.settings.get("app"),
    database.syncShadows.toArray()
  ]);

  if (!settings) {
    throw new Error("SETTINGS_MISSING");
  }

  if (!settings.syncCursor || shadows.length === 0) {
    return null;
  }

  const remoteConfig = {
    provider: "googleDrive" as const,
    serverUrl: GOOGLE_DRIVE_API_BASE_URL,
    vaultId,
    token,
    localVaultId: options?.localVaultId ?? null,
    localVaultName: options?.localVaultName ?? null
  } satisfies RemoteSyncConfig;

  let remoteFeed: SyncChangeFeed;

  try {
    remoteFeed = await loadGoogleDriveRemoteChangeFeed(token, vaultId, settings.syncCursor);
  } catch (error) {
    if (shouldFallbackToSnapshotSync(error)) {
      return null;
    }

    throw error;
  }

  if (remoteFeed.metadata?.payloadMode === "encrypted") {
    await hydrateVaultEncryptionFromMetadata(remoteFeed.metadata, database);
    settings = (await database.settings.get("app")) ?? settings;
  }

  reconcileLocalVaultProfileName(remoteConfig, remoteFeed.metadata?.vault?.name ?? null);

  if (remoteFeed.mode === "snapshot") {
    // V2 cursors include immutable concurrent commits. Rebuild from the
    // checkpoint bootstrap instead of deriving a possibly incomplete delta.
    return null;
  }

  const isEncryptedDeltaFeed =
    remoteFeed.metadata?.payloadMode === "encrypted" ||
    Array.isArray(remoteFeed.encryptedChanges);
  const remoteChanges =
    isEncryptedDeltaFeed
      ? collapseChangeSetBatches(
          await decryptEncryptedChangeBatches(
            remoteFeed.encryptedChanges ?? [],
            remoteFeed.metadata ?? null,
            remoteConfig,
            settings
          )
        )
      : normalizeChangeSetPayload(remoteFeed.changes, "google-drive");
  const localPendingCount =
    typeof options?.localPendingCount === "number" ? Math.max(0, options.localPendingCount) : null;

  if (localPendingCount === 0) {
    const finalRevision = remoteFeed.revision ?? settings.syncCursor;

    if (!isChangeSetEmpty(remoteChanges)) {
      await applySyncChangeSetToLocalData(remoteChanges, database);
      await persistSyncShadowChanges(remoteChanges, finalRevision, database);
    }

    await rebuildSyncDirtyEntriesFromCurrentState(database);
    await database.settings.update("app", {
      syncStatus: "idle",
      lastSyncAt: Date.now(),
      syncCursor: finalRevision
    });

    return {
      revision: finalRevision ?? "",
      stats: {
        pulled: countChangeSetEntries(remoteChanges),
        pushed: 0,
        conflicts: 0
      },
      syncMode: isEncryptedDeltaFeed ? "encrypted-delta" : "delta"
    } satisfies SyncExecutionResult;
  }

  const localSnapshot = await exportLocalSyncSnapshot(database);
  const localChanges = buildRecordChangeSetFromSnapshot(localSnapshot, shadows);
  const merged = mergeChangeSetsIntoSnapshot(localSnapshot, localChanges, remoteChanges, shadows);
  const localDeltaToApply = buildChangeSetBetweenSnapshots(localSnapshot, merged.snapshot);
  const shadowChanges = buildRecordChangeSetFromSnapshot(merged.snapshot, shadows);
  let finalRevision = remoteFeed.revision ?? settings.syncCursor;
  const localVaultProfile =
    options?.localVaultId ? getLocalVaultProfile(options.localVaultId) : null;
  const resolvedVaultName =
    localVaultProfile?.name ?? remoteFeed.metadata?.vault?.name ?? options?.localVaultName ?? vaultId;

  if (!isChangeSetEmpty(merged.outgoingChanges)) {
    const pushed =
      isEncryptedDeltaFeed
        ? await (async () => {
            const { descriptor, encryptedChanges } = await encryptChangeSetBatch(
              merged.outgoingChanges,
              remoteConfig,
              settings
            );
            const passphrase = resolveVaultPassphraseOrThrow(remoteConfig);
            const encryptedSnapshot = await encryptSyncPayload(merged.snapshot, passphrase, {
              vault: buildRemoteVaultDescriptor({
                ...remoteConfig,
                localVaultName: resolvedVaultName
              }),
              descriptor
            });
            const revision = createSyncRevision();

            return pushGoogleDriveRemoteChanges(token, {
              vaultId,
              vaultName: resolvedVaultName,
              baseRevision: remoteFeed.revision,
              encryptedChanges,
              envelope: {
                revision,
                metadata: {
                  schemaVersion: 1,
                  payloadMode: "encrypted",
                  vault: buildRemoteVaultDescriptor({
                    ...remoteConfig,
                    localVaultName: resolvedVaultName
                  }),
                  encryption: {
                    ...descriptor,
                    state: "locked"
                  }
                },
                encryptedSnapshot: encryptedSnapshot.payload
              }
            });
          })()
        : await pushGoogleDriveRemoteChanges(token, {
            vaultId,
            vaultName: resolvedVaultName,
            baseRevision: remoteFeed.revision,
            changes: merged.outgoingChanges,
            envelope: {
              revision: createSyncRevision(),
              snapshot: {
                ...merged.snapshot,
                exportedAt: Date.now()
              },
              metadata: createPlainSyncDescriptor(
                buildRemoteVaultDescriptor({
                  ...remoteConfig,
                  localVaultName: resolvedVaultName
                })
              )
            }
          });

    if (pushed.conflict) {
      return "retry" as const;
    }

    finalRevision = pushed.revision ?? finalRevision;
  }

  if (!isChangeSetEmpty(localDeltaToApply)) {
    await applySyncChangeSetToLocalData(localDeltaToApply, database);
  }

  await persistSyncShadowChanges(shadowChanges, finalRevision, database);
  await rebuildSyncDirtyEntriesFromCurrentState(database);
  await database.settings.update("app", {
    syncStatus: "idle",
    lastSyncAt: Date.now(),
    syncCursor: finalRevision
  });

  return {
    revision: finalRevision ?? "",
    stats: merged.stats,
    syncMode: isEncryptedDeltaFeed ? "encrypted-delta" : "delta"
  } satisfies SyncExecutionResult;
}

async function runDeltaSyncCycle(
  serverUrl: string,
  vaultId: string,
  token: string,
  options?: {
    localPendingCount?: number;
    localVaultId?: string | null;
    localVaultName?: string | null;
    provider?: "selfHosted" | "hosted";
  },
  database: LocorisDatabase = db
) {
  let [settings, shadows] = await Promise.all([
    database.settings.get("app"),
    database.syncShadows.toArray()
  ]);

  if (!settings) {
    throw new Error("SETTINGS_MISSING");
  }

  if (!settings.syncCursor || shadows.length === 0) {
    return null;
  }

  const remoteConfig = {
    provider: options?.provider ?? "selfHosted",
    serverUrl,
    vaultId,
    token,
    localVaultId: options?.localVaultId ?? null,
    localVaultName: options?.localVaultName ?? null
  } satisfies RemoteSyncConfig;

  let remoteFeed: SyncChangeFeed;

  try {
    remoteFeed = await pullSelfHostedChanges(serverUrl, vaultId, token, settings.syncCursor);
  } catch (error) {
    if (shouldFallbackToSnapshotSync(error)) {
      return null;
    }

    throw error;
  }

  if (remoteFeed.metadata?.payloadMode === "encrypted") {
    await hydrateVaultEncryptionFromMetadata(remoteFeed.metadata, database);
    settings = (await database.settings.get("app")) ?? settings;
  }

  reconcileLocalVaultProfileName(remoteConfig, remoteFeed.metadata?.vault?.name ?? null);

  if (
    remoteFeed.mode === "snapshot" &&
    remoteFeed.snapshot &&
    settings.syncCursor &&
    shadows.length > 0
  ) {
    remoteFeed = {
      mode: "delta",
      revision: remoteFeed.revision,
      baseRevision: settings.syncCursor,
      changes: buildRecordChangeSetFromSnapshot(remoteFeed.snapshot, shadows),
      encryptedChanges: null,
      snapshot: null,
      metadata: remoteFeed.metadata ?? null
    } satisfies SyncChangeFeed;
  }

  if (remoteFeed.mode === "snapshot") {
    if (remoteFeed.snapshot) {
      return runSnapshotSyncCycle(
        serverUrl,
        vaultId,
        token,
        {
          localVaultId: remoteConfig.localVaultId ?? null,
          localVaultName: remoteConfig.localVaultName ?? null,
          provider: remoteConfig.provider
        },
        {
          revision: remoteFeed.revision,
          snapshot: remoteFeed.snapshot,
          metadata: remoteFeed.metadata ?? null
        },
        database
      );
    }

    return null;
  }

  const isEncryptedDeltaFeed =
    remoteFeed.metadata?.payloadMode === "encrypted" ||
    Array.isArray(remoteFeed.encryptedChanges);
  const remoteChanges =
    isEncryptedDeltaFeed
      ? collapseChangeSetBatches(
          await decryptEncryptedChangeBatches(
            remoteFeed.encryptedChanges ?? [],
            remoteFeed.metadata ?? null,
            remoteConfig,
            settings
          )
        )
      : normalizeChangeSetPayload(remoteFeed.changes, "server");
  const localPendingCount =
    typeof options?.localPendingCount === "number" ? Math.max(0, options.localPendingCount) : null;

  if (localPendingCount === 0) {
    const finalRevision = remoteFeed.revision ?? settings.syncCursor;

    if (!isChangeSetEmpty(remoteChanges)) {
      await applySyncChangeSetToLocalData(remoteChanges, database);
      await persistSyncShadowChanges(remoteChanges, finalRevision, database);
    }

    await rebuildSyncDirtyEntriesFromCurrentState(database);
    await database.settings.update("app", {
      syncStatus: "idle",
      lastSyncAt: Date.now(),
      syncCursor: finalRevision
    });

    return {
      revision: finalRevision ?? "",
      stats: {
        pulled: countChangeSetEntries(remoteChanges),
        pushed: 0,
        conflicts: 0
      },
      syncMode: isEncryptedDeltaFeed ? "encrypted-delta" : "delta"
    } satisfies SyncExecutionResult;
  }

  const localSnapshot = await exportLocalSyncSnapshot(database);
  const localChanges = buildRecordChangeSetFromSnapshot(localSnapshot, shadows);
  const merged = mergeChangeSetsIntoSnapshot(localSnapshot, localChanges, remoteChanges, shadows);
  const localDeltaToApply = buildChangeSetBetweenSnapshots(localSnapshot, merged.snapshot);
  const shadowChanges = buildRecordChangeSetFromSnapshot(merged.snapshot, shadows);
  let finalRevision = remoteFeed.revision ?? settings.syncCursor;

  if (!isChangeSetEmpty(merged.outgoingChanges)) {
    const pushed =
      isEncryptedDeltaFeed
        ? await (async () => {
            const { descriptor, encryptedChanges } = await encryptChangeSetBatch(
              merged.outgoingChanges,
              remoteConfig,
              settings
            );
            const passphrase = resolveVaultPassphraseOrThrow(remoteConfig);
            const encryptedSnapshot = await encryptSyncPayload(merged.snapshot, passphrase, {
              vault: buildRemoteVaultDescriptor(remoteConfig),
              descriptor
            });

            return pushSelfHostedEncryptedChanges(serverUrl, vaultId, token, remoteFeed.revision, {
              encryptedChanges,
              encryptedSnapshot: encryptedSnapshot.payload,
              metadata: {
                schemaVersion: 1,
                payloadMode: "encrypted",
                vault: buildRemoteVaultDescriptor(remoteConfig),
                encryption: {
                  ...descriptor,
                  state: "locked"
                }
              }
            });
          })()
        : await pushSelfHostedChanges(
            serverUrl,
            vaultId,
            token,
            remoteFeed.revision,
            merged.outgoingChanges
          );

    if (pushed.conflict) {
      return "retry" as const;
    }

    finalRevision = pushed.revision ?? finalRevision;
  }

  if (!isChangeSetEmpty(localDeltaToApply)) {
    await applySyncChangeSetToLocalData(localDeltaToApply, database);
  }

  await persistSyncShadowChanges(shadowChanges, finalRevision, database);
  await rebuildSyncDirtyEntriesFromCurrentState(database);
  await database.settings.update("app", {
    syncStatus: "idle",
    lastSyncAt: Date.now(),
    syncCursor: finalRevision
  });

  return {
    revision: finalRevision ?? "",
    stats: merged.stats,
    syncMode: isEncryptedDeltaFeed ? "encrypted-delta" : "delta"
  } satisfies SyncExecutionResult;
}

async function runConfiguredSyncInternal(
  remote: RemoteSyncConfig,
  options?: {
    onStatusChange?: (status: SyncStatus) => Promise<void> | void;
    localPendingCount?: number;
  },
  database: LocorisDatabase = db
): Promise<SyncExecutionResult> {
  const serverUrl = normalizeBaseUrl(remote.serverUrl);
  const vaultId = normalizeVaultId(remote.vaultId);
  const token = remote.token.trim();

  if (!serverUrl && remote.provider !== "googleDrive") {
    throw new Error(remote.provider === "hosted" ? "HOSTED_URL_REQUIRED" : "SELF_HOSTED_URL_REQUIRED");
  }

  if (!token) {
    throw new Error(
      remote.provider === "hosted"
        ? "HOSTED_SYNC_TOKEN_REQUIRED"
        : remote.provider === "googleDrive"
          ? "GOOGLE_DRIVE_AUTH_REQUIRED"
          : "SELF_HOSTED_TOKEN_REQUIRED"
    );
  }

  if (!vaultId) {
    throw new Error(
      remote.provider === "hosted"
        ? "HOSTED_VAULT_REQUIRED"
        : remote.provider === "googleDrive"
          ? "VAULT_NOT_FOUND"
          : "SELF_HOSTED_VAULT_REQUIRED"
    );
  }

  await options?.onStatusChange?.("syncing");

  try {
    if (remote.provider === "googleDrive") {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const deltaResult = await runGoogleDriveDeltaSyncCycle(
          vaultId,
          token,
          {
            localPendingCount: options?.localPendingCount,
            localVaultId: remote.localVaultId ?? null,
            localVaultName: remote.localVaultName ?? null
          },
          database
        );

        if (deltaResult === "retry") {
          continue;
        }

        if (deltaResult) {
          await options?.onStatusChange?.("idle");
          return deltaResult;
        }

        const snapshotResult = await runGoogleDriveSyncCycle(
          vaultId,
          token,
          {
            localVaultId: remote.localVaultId ?? null,
            localVaultName: remote.localVaultName ?? null
          },
          undefined,
          database
        );

        if (snapshotResult === "retry") {
          continue;
        }

        await options?.onStatusChange?.("idle");
        return snapshotResult;
      }

      throw new Error("SYNC_REVISION_CONFLICT");
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const deltaResult = await runDeltaSyncCycle(serverUrl, vaultId, token, {
        localPendingCount: options?.localPendingCount,
        localVaultId: remote.localVaultId ?? null,
        localVaultName: remote.localVaultName ?? null,
        provider: remote.provider === "hosted" ? "hosted" : "selfHosted"
      }, database);

      if (deltaResult === "retry") {
        continue;
      }

      if (deltaResult) {
        await options?.onStatusChange?.("idle");
        return deltaResult;
      }

      const snapshotResult = await runSnapshotSyncCycle(
        serverUrl,
        vaultId,
        token,
        {
          localVaultId: remote.localVaultId ?? null,
          localVaultName: remote.localVaultName ?? null,
          provider: remote.provider === "hosted" ? "hosted" : "selfHosted"
        },
        undefined,
        database
      );

      if (snapshotResult === "retry") {
        continue;
      }

      await options?.onStatusChange?.("idle");
      return snapshotResult;
    }

    throw new Error("SYNC_REVISION_CONFLICT");
  } catch (error) {
    await database.settings.update("app", {
      syncStatus: "error"
    });
    await options?.onStatusChange?.("error");
    throw new Error(parseSyncError(error));
  }
}

export async function runConfiguredSync(
  remote: RemoteSyncConfig,
  options?: {
    onStatusChange?: (status: SyncStatus) => Promise<void> | void;
    localPendingCount?: number;
    localVaultId?: string;
  }
): Promise<SyncExecutionResult> {
  if (options?.localVaultId) {
    const result = await withLocalVaultDatabase(options.localVaultId, async (database) =>
      runConfiguredSyncInternal(
        {
          ...remote,
          localVaultId: options.localVaultId
        },
        options,
        database
      )
    );

    await persistLocalVaultStorage(options.localVaultId);
    return result;
  }

  const result = await runConfiguredSyncInternal(
    {
      ...remote,
      localVaultId: remote.localVaultId ?? null
    },
    options,
    db
  );

  if (remote.localVaultId) {
    await persistLocalVaultStorage(remote.localVaultId);
  }

  return result;
}
