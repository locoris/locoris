import { createPlainSyncDescriptor } from "./e2ee";
import {
  connectGoogleDriveDesktopAccount,
  desktopGoogleDriveOAuthReady,
  isDesktopGoogleDriveOauthRuntime,
  prepareGoogleDriveDesktopOAuth,
  refreshGoogleDriveDesktopAccountSession,
  revokeGoogleDriveDesktopAccess
} from "./googleDriveDesktopOAuth";
import {
  androidGoogleDriveOAuthReady,
  clearGoogleDriveAndroidAccessToken,
  isAndroidGoogleDriveOauthRuntime,
  prepareGoogleDriveAndroidOAuth,
  requestGoogleDriveAndroidAccessToken,
  revokeGoogleDriveAndroidAccess
} from "./googleDriveAndroidOAuth";
import {
  buildGoogleDriveV2Cursor,
  buildGoogleDriveV2FileName,
  collectGoogleDriveV2UnappliedCommits,
  GOOGLE_DRIVE_V2_CHECKPOINT_RETENTION_COUNT,
  GOOGLE_DRIVE_V2_FILE_PREFIX,
  parseGoogleDriveV2FileName,
  planGoogleDriveV2CommitRetention,
  selectGoogleDriveV2Checkpoint,
  sortGoogleDriveV2Files,
  type GoogleDriveV2FileMeta
} from "./googleDriveSyncV2";
import type {
  SyncChangeFeed,
  SyncChangeSet,
  SyncConnection,
  SyncEnvelope,
  SyncEncryptedPayload,
  SyncRemoteVault,
  SyncSecureEnvelope,
  SyncSnapshot,
  SyncTombstone,
  SyncVaultDescriptor
} from "../types";

export const GOOGLE_DRIVE_API_BASE_URL = "https://www.googleapis.com";
export const GOOGLE_DRIVE_UPLOAD_BASE_URL = "https://www.googleapis.com/upload/drive/v3/files";
export const GOOGLE_DRIVE_FILES_BASE_URL = "https://www.googleapis.com/drive/v3/files";
export const GOOGLE_DRIVE_ABOUT_URL = "https://www.googleapis.com/drive/v3/about";
export const GOOGLE_DRIVE_APP_DATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
export const GOOGLE_DRIVE_APP_FOLDER = "appDataFolder";
// Legacy Google Drive appDataFolder manifest name. Keep until a dual-read migration exists.
export const GOOGLE_DRIVE_MANIFEST_FILE = "zen-sync-manifest.json";
export const GOOGLE_DRIVE_VAULT_PREFIX = "vault-";
export const GOOGLE_DRIVE_VAULT_JOURNAL_SUFFIX = ".journal.json";
export const GOOGLE_DRIVE_BINDING_TOKEN = "google-drive-session";
export const GOOGLE_DRIVE_TOKEN_REFRESH_SKEW_MS = 3 * 60 * 1000;
const GOOGLE_IDENTITY_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const GOOGLE_IDENTITY_LOAD_TIMEOUT_MS = 10_000;
const GOOGLE_IDENTITY_POLL_INTERVAL_MS = 50;
const GOOGLE_TOKEN_REQUEST_TIMEOUT_MS = 20_000;
const GOOGLE_DRIVE_CHANGE_HISTORY_LIMIT = 240;
const GOOGLE_DRIVE_REQUEST_TIMEOUT_MS = 30_000;
const GOOGLE_DRIVE_MAX_RETRY_ATTEMPTS = 4;
const GOOGLE_DRIVE_MULTIPART_UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024;
const GOOGLE_DRIVE_RESUMABLE_CHUNK_BYTES = 4 * 1024 * 1024;

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

type GoogleTokenClientConfig = {
  client_id: string;
  scope: string;
  callback: (response: GoogleTokenResponse) => void;
  error_callback?: (error: { type?: string }) => void;
  include_granted_scopes?: boolean;
  prompt?: string;
  login_hint?: string;
};

type GoogleTokenClient = {
  requestAccessToken: (config?: {
    prompt?: string;
    login_hint?: string;
    scope?: string;
    include_granted_scopes?: boolean;
  }) => void;
};

type GoogleRevokeResponse = {
  successful?: boolean;
  error?: string;
  error_description?: string;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: GoogleTokenClientConfig) => GoogleTokenClient;
          revoke: (token: string, callback: (response: GoogleRevokeResponse) => void) => void;
        };
      };
    };
  }
}

type GoogleDriveAboutResponse = {
  user?: {
    displayName?: string;
    emailAddress?: string;
    permissionId?: string;
  };
};

type GoogleDriveListResponse = {
  nextPageToken?: string;
  files?: Array<{
    id?: string;
    name?: string;
    createdTime?: string;
    modifiedTime?: string;
    size?: string;
  }>;
};

type GoogleDriveFileMeta = {
  id: string;
  name: string;
  createdTime: string;
  modifiedTime: string;
  size: number;
};

type GoogleDriveChangeListResponse = {
  nextPageToken?: string;
  newStartPageToken?: string;
  changes?: Array<{
    removed?: boolean;
    fileId?: string;
    file?: {
      id?: string;
      name?: string;
      modifiedTime?: string;
    };
  }>;
};

interface GoogleDriveV2CheckpointBlob {
  schemaVersion: 2;
  provider: "googleDrive";
  recordType: "checkpoint";
  checkpointId: string;
  vaultId: string;
  vaultName: string;
  vaultKind: "regular" | "private";
  createdAt: number;
  coveredCommitCount: number;
  appliedCommitIds: string[];
  baseCursor: string | null;
  envelope: SyncEnvelope | SyncSecureEnvelope;
}

interface GoogleDriveV2CommitBlob {
  schemaVersion: 2;
  provider: "googleDrive";
  recordType: "commit";
  commitId: string;
  vaultId: string;
  vaultName: string;
  vaultKind: "regular" | "private";
  baseCursor: string | null;
  createdAt: number;
  changes: SyncChangeSet | null;
  encryptedChanges: SyncEncryptedPayload | null;
  metadata: SyncEnvelope["metadata"];
}

interface GoogleDriveV2CheckpointRecord extends GoogleDriveV2CheckpointBlob {
  file: GoogleDriveFileMeta;
}

interface GoogleDriveV2CommitRecord extends GoogleDriveV2CommitBlob {
  file: GoogleDriveFileMeta;
}

interface GoogleDriveV2VaultState {
  checkpoint: GoogleDriveV2CheckpointRecord;
  checkpoints: GoogleDriveV2CheckpointRecord[];
  commits: GoogleDriveV2CommitRecord[];
  unappliedCommits: GoogleDriveV2CommitRecord[];
  cursor: string;
}

export interface GoogleDriveRemoteBootstrap {
  revision: string;
  checkpointRevision: string | null;
  envelope: SyncEnvelope | SyncSecureEnvelope;
  changes: SyncChangeSet | null;
  encryptedChanges: SyncEncryptedPayload[] | null;
}

type GoogleDriveManifestFileState = {
  fileId: string | null;
  manifest: GoogleDriveManifest;
  files: GoogleDriveFileMeta[];
};

export interface GoogleDriveConnectionDraft {
  provider: "googleDrive";
  accessToken: string;
  expiresAt: number | null;
  refreshToken?: string | null;
}

export interface GoogleDriveRemoteVaultRecord {
  id: string;
  name: string;
  fileId: string;
  journalFileId?: string | null;
  vaultKind: "regular" | "private";
  updatedAt: number;
  revision: string | null;
}

export interface GoogleDriveManifest {
  schemaVersion: 1;
  provider: "googleDrive";
  folder: typeof GOOGLE_DRIVE_APP_FOLDER;
  updatedAt: number;
  vaults: GoogleDriveRemoteVaultRecord[];
}

export interface GoogleDriveVaultBlob {
  schemaVersion: 1;
  provider: "googleDrive";
  vaultId: string;
  updatedAt: number;
  envelope: SyncEnvelope | SyncSecureEnvelope;
}

interface GoogleDriveVaultJournalEntry {
  revision: string;
  baseRevision: string | null;
  createdAt: number;
  changes: SyncChangeSet | null;
  encryptedChanges: SyncEncryptedPayload | null;
}

interface GoogleDriveVaultJournalBlob {
  schemaVersion: 1;
  provider: "googleDrive";
  vaultId: string;
  updatedAt: number;
  entries: GoogleDriveVaultJournalEntry[];
}

export interface GoogleDriveAccountSession {
  accessToken: string;
  expiresAt: number | null;
  refreshToken?: string | null;
  userId: string | null;
  userName: string;
  userEmail: string;
}

let googleIdentityLoadPromise: Promise<NonNullable<Window["google"]>> | null = null;
const googleDriveRefreshPromises = new Map<string, Promise<GoogleDriveAccountSession>>();

function now() {
  return Date.now();
}

function getClientIdFromEnv() {
  const webClientId = import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_ID?.trim() ?? "";
  const desktopClientId = import.meta.env.VITE_GOOGLE_DRIVE_DESKTOP_CLIENT_ID?.trim() ?? "";

  if (isDesktopGoogleDriveOauthRuntime()) {
    return desktopClientId;
  }

  if (isAndroidGoogleDriveOauthRuntime()) {
    return "";
  }

  return webClientId;
}

export function getGoogleDriveClientId() {
  return getClientIdFromEnv();
}

export function isGoogleDriveConfigured() {
  if (isAndroidGoogleDriveOauthRuntime()) {
    return true;
  }

  return Boolean(getClientIdFromEnv());
}

function ensureClientId(clientId?: string) {
  const value = clientId?.trim() || getClientIdFromEnv();

  if (!value) {
    throw new Error("GOOGLE_DRIVE_CLIENT_ID_REQUIRED");
  }

  return value;
}

function normalizeDriveTimestamp(value: string | undefined) {
  if (!value) {
    return now();
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : now();
}

function createDefaultManifest(): GoogleDriveManifest {
  return {
    schemaVersion: 1,
    provider: "googleDrive",
    folder: GOOGLE_DRIVE_APP_FOLDER,
    updatedAt: now(),
    vaults: []
  };
}

function sanitizeText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function createEmptyChangeSet(deviceId = "google-drive"): SyncChangeSet {
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

function normalizeEncryptedPayload(value: unknown): SyncEncryptedPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Partial<SyncEncryptedPayload>;

  if (
    payload.version !== 1 ||
    payload.cipher !== "aes-gcm-256" ||
    typeof payload.iv !== "string" ||
    !payload.iv.trim() ||
    typeof payload.ciphertext !== "string" ||
    !payload.ciphertext.trim()
  ) {
    return null;
  }

  return {
    version: 1,
    cipher: "aes-gcm-256",
    iv: payload.iv.trim(),
    ciphertext: payload.ciphertext.trim()
  };
}

function normalizeChangeSetPayload(
  payload: Partial<SyncChangeSet> | null | undefined,
  fallbackDeviceId = "google-drive"
): SyncChangeSet {
  if (!payload || typeof payload !== "object") {
    return createEmptyChangeSet(fallbackDeviceId);
  }

  return {
    deviceId: typeof payload.deviceId === "string" ? payload.deviceId : fallbackDeviceId,
    exportedAt: typeof payload.exportedAt === "number" ? payload.exportedAt : now(),
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

function sortById<T extends { id: string }>(records: readonly T[]) {
  return [...records].sort((left, right) => left.id.localeCompare(right.id));
}

function sortTombstones(records: readonly SyncTombstone[]) {
  return [...records].sort((left, right) => left.key.localeCompare(right.key));
}

function getEntityKey(
  entityType:
    | "project"
    | "folder"
    | "tag"
    | "note"
    | "asset"
    | "task"
    | "habit"
    | "habitLog"
    | "goal"
    | "timeBlock",
  entityId: string
) {
  return `${entityType}:${entityId}`;
}

function applyChangeSetIntoMaps(
  maps: {
    project: Map<string, SyncChangeSet["projects"][number]>;
    folder: Map<string, SyncChangeSet["folders"][number]>;
    tag: Map<string, SyncChangeSet["tags"][number]>;
    note: Map<string, SyncChangeSet["notes"][number]>;
    asset: Map<string, SyncChangeSet["assets"][number]>;
    task: Map<string, SyncChangeSet["tasks"][number]>;
    habit: Map<string, SyncChangeSet["habits"][number]>;
    habitLog: Map<string, SyncChangeSet["habitLogs"][number]>;
    goal: Map<string, SyncChangeSet["goals"][number]>;
    timeBlock: Map<string, SyncChangeSet["timeBlocks"][number]>;
    tombstones: Map<string, SyncTombstone>;
  },
  changeSet: SyncChangeSet
) {
  const applyRecords = <T extends { id: string }>(
    entityType:
      | "project"
      | "folder"
      | "tag"
      | "note"
      | "asset"
      | "task"
      | "habit"
      | "habitLog"
      | "goal"
      | "timeBlock",
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
    project: new Map<string, SyncChangeSet["projects"][number]>(),
    folder: new Map<string, SyncChangeSet["folders"][number]>(),
    tag: new Map<string, SyncChangeSet["tags"][number]>(),
    note: new Map<string, SyncChangeSet["notes"][number]>(),
    asset: new Map<string, SyncChangeSet["assets"][number]>(),
    task: new Map<string, SyncChangeSet["tasks"][number]>(),
    habit: new Map<string, SyncChangeSet["habits"][number]>(),
    habitLog: new Map<string, SyncChangeSet["habitLogs"][number]>(),
    goal: new Map<string, SyncChangeSet["goals"][number]>(),
    timeBlock: new Map<string, SyncChangeSet["timeBlocks"][number]>(),
    tombstones: new Map<string, SyncTombstone>()
  };
  let deviceId = "google-drive";
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

function pruneJournalEntries(entries: readonly GoogleDriveVaultJournalEntry[]) {
  return entries.slice(-GOOGLE_DRIVE_CHANGE_HISTORY_LIMIT);
}

function buildVaultDescriptor(vaultId: string, vaultName: string): SyncVaultDescriptor {
  return {
    localVaultId: null,
    vaultGuid: vaultId,
    name: vaultName,
    vaultKind: "regular",
    schemaVersion: 1
  };
}

function createEmptyGoogleDriveEnvelope(vaultId: string, vaultName: string): SyncEnvelope {
  const snapshot: SyncSnapshot = {
    deviceId: "google-drive",
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

  return {
    revision: null,
    snapshot,
    metadata: createPlainSyncDescriptor(buildVaultDescriptor(vaultId, vaultName))
  };
}

function createDefaultVaultBlob(vaultId: string, vaultName: string): GoogleDriveVaultBlob {
  return {
    schemaVersion: 1,
    provider: "googleDrive",
    vaultId,
    updatedAt: now(),
    envelope: createEmptyGoogleDriveEnvelope(vaultId, vaultName)
  };
}

function createDefaultVaultJournalBlob(vaultId: string): GoogleDriveVaultJournalBlob {
  return {
    schemaVersion: 1,
    provider: "googleDrive",
    vaultId,
    updatedAt: now(),
    entries: []
  };
}

function buildGoogleDriveVaultStateFileName(vaultId: string) {
  return `${GOOGLE_DRIVE_VAULT_PREFIX}${vaultId}.json`;
}

function buildGoogleDriveVaultJournalFileName(vaultId: string) {
  return `${GOOGLE_DRIVE_VAULT_PREFIX}${vaultId}${GOOGLE_DRIVE_VAULT_JOURNAL_SUFFIX}`;
}

function escapeQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function buildGoogleAuthHeaders(accessToken: string, extra?: HeadersInit) {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...extra
  };
}

type GoogleDriveErrorPayload = {
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{
      reason?: string;
      message?: string;
    }>;
  };
};

class GoogleDriveApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleDriveApiError";
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });
}

function parseRetryAfter(response: Response) {
  const raw = response.headers.get("retry-after")?.trim() ?? "";
  const seconds = Number(raw);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(30_000, seconds * 1000);
  }

  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, Math.min(30_000, date - Date.now())) : null;
}

function getGoogleDriveErrorReason(payload: GoogleDriveErrorPayload | null) {
  return sanitizeText(payload?.error?.errors?.[0]?.reason, "");
}

function isRetryableGoogleDriveResponse(response: Response, payload: GoogleDriveErrorPayload | null) {
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    return true;
  }

  if (response.status !== 403) {
    return false;
  }

  return [
    "rateLimitExceeded",
    "userRateLimitExceeded",
    "dailyLimitExceeded",
    "backendError"
  ].includes(getGoogleDriveErrorReason(payload));
}

function createGoogleDriveHttpError(response: Response, payload: GoogleDriveErrorPayload | null) {
  const reason = getGoogleDriveErrorReason(payload);
  const message = sanitizeText(payload?.error?.message, "");

  if (response.status === 401) {
    return new GoogleDriveApiError("GOOGLE_DRIVE_AUTH_REQUIRED");
  }

  if (response.status === 403) {
    if (reason === "storageQuotaExceeded") {
      return new GoogleDriveApiError("GOOGLE_DRIVE_STORAGE_QUOTA_EXCEEDED");
    }

    if (["rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded"].includes(reason)) {
      return new GoogleDriveApiError("GOOGLE_DRIVE_RATE_LIMITED");
    }

    if (["insufficientPermissions", "insufficientFilePermissions", "forbidden"].includes(reason)) {
      return new GoogleDriveApiError("GOOGLE_DRIVE_PERMISSION_REQUIRED");
    }

    return new GoogleDriveApiError(message || "GOOGLE_DRIVE_PERMISSION_REQUIRED");
  }

  if (response.status === 404) {
    return new GoogleDriveApiError("GOOGLE_DRIVE_FILE_NOT_FOUND");
  }

  if (response.status === 410) {
    return new GoogleDriveApiError("GOOGLE_DRIVE_CHANGE_TOKEN_EXPIRED");
  }

  if (response.status === 413) {
    return new GoogleDriveApiError("GOOGLE_DRIVE_PAYLOAD_TOO_LARGE");
  }

  if (response.status === 429) {
    return new GoogleDriveApiError("GOOGLE_DRIVE_RATE_LIMITED");
  }

  return new GoogleDriveApiError(message || `HTTP_${response.status}`);
}

async function parseGoogleDriveErrorPayload(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return null;
  }

  return response.clone().json().catch(() => null) as Promise<GoogleDriveErrorPayload | null>;
}

async function performGoogleDriveRequest(
  url: string,
  accessToken: string,
  init: RequestInit = {},
  options: {
    idempotent?: boolean;
    acceptedStatuses?: readonly number[];
    timeoutMs?: number;
  } = {}
) {
  const idempotent = options.idempotent ?? ["GET", "HEAD", "PUT", "PATCH", "DELETE"].includes(
    (init.method ?? "GET").toUpperCase()
  );
  const attempts = idempotent ? GOOGLE_DRIVE_MAX_RETRY_ATTEMPTS : 1;
  let lastNetworkError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? GOOGLE_DRIVE_REQUEST_TIMEOUT_MS
    );

    try {
      const response = await fetch(url, {
        ...init,
        headers: buildGoogleAuthHeaders(accessToken, init.headers),
        signal: controller.signal
      });
      const accepted = response.ok || options.acceptedStatuses?.includes(response.status);

      if (accepted) {
        return response;
      }

      const payload = await parseGoogleDriveErrorPayload(response);

      if (attempt + 1 < attempts && isRetryableGoogleDriveResponse(response, payload)) {
        const retryAfter = parseRetryAfter(response);
        const backoff = retryAfter ?? Math.min(8_000, 350 * 2 ** attempt + Math.random() * 250);
        await delay(backoff);
        continue;
      }

      throw createGoogleDriveHttpError(response, payload);
    } catch (error) {
      if (error instanceof GoogleDriveApiError) {
        throw error;
      }

      lastNetworkError = error;

      if (attempt + 1 >= attempts) {
        break;
      }

      await delay(Math.min(8_000, 350 * 2 ** attempt + Math.random() * 250));
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  }

  if (lastNetworkError instanceof DOMException && lastNetworkError.name === "AbortError") {
    throw new Error("GOOGLE_DRIVE_REQUEST_TIMEOUT");
  }

  throw new Error("SERVER_UNAVAILABLE");
}

function getGoogleIdentityApi() {
  return window.google?.accounts?.oauth2 ? window.google : null;
}

export function googleDriveOAuthReady() {
  if (typeof window === "undefined") {
    return false;
  }

  if (isDesktopGoogleDriveOauthRuntime()) {
    return desktopGoogleDriveOAuthReady(getClientIdFromEnv());
  }

  if (isAndroidGoogleDriveOauthRuntime()) {
    return androidGoogleDriveOAuthReady();
  }

  return Boolean(getGoogleIdentityApi());
}

export async function prepareGoogleDriveOAuth() {
  if (isDesktopGoogleDriveOauthRuntime()) {
    return prepareGoogleDriveDesktopOAuth();
  }

  if (isAndroidGoogleDriveOauthRuntime()) {
    return prepareGoogleDriveAndroidOAuth();
  }

  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("GOOGLE_OAUTH_UNAVAILABLE");
  }

  const ready = getGoogleIdentityApi();

  if (ready) {
    return ready;
  }

  if (googleIdentityLoadPromise) {
    return googleIdentityLoadPromise;
  }

  googleIdentityLoadPromise = new Promise<NonNullable<Window["google"]>>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity="true"]');
    let script: HTMLScriptElement | null = existing;
    let timeoutId: number | null = null;
    let pollId: number | null = null;
    let settled = false;

    const cleanup = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      if (pollId !== null) {
        window.clearTimeout(pollId);
      }

      script?.removeEventListener("load", handleLoad);
      script?.removeEventListener("error", handleError);
    };

    const finalizeSuccess = (api: NonNullable<Window["google"]>) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(api);
    };

    const finalizeError = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      googleIdentityLoadPromise = null;
      reject(error);
    };

    const pollUntilReady = () => {
      const api = getGoogleIdentityApi();

      if (api) {
        finalizeSuccess(api);
        return;
      }

      pollId = window.setTimeout(pollUntilReady, GOOGLE_IDENTITY_POLL_INTERVAL_MS);
    };

    const handleLoad = () => {
      script?.setAttribute("data-google-identity-loaded", "true");
      pollUntilReady();
    };

    const handleError = () => {
      finalizeError(new Error("GOOGLE_OAUTH_SCRIPT_FAILED"));
    };

    timeoutId = window.setTimeout(() => {
      finalizeError(new Error("GOOGLE_OAUTH_SCRIPT_FAILED"));
    }, GOOGLE_IDENTITY_LOAD_TIMEOUT_MS);

    script =
      existing ??
      (() => {
        const nextScript = document.createElement("script");
        nextScript.src = GOOGLE_IDENTITY_SCRIPT_SRC;
        nextScript.async = true;
        nextScript.defer = true;
        nextScript.dataset.googleIdentity = "true";
        document.head.appendChild(nextScript);
        return nextScript;
      })();

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });
    pollUntilReady();
  });

  return googleIdentityLoadPromise;
}

function requestGoogleDriveAccessToken(options?: {
  clientId?: string;
  prompt?: string;
  loginHint?: string;
  silent?: boolean;
}) {
  if (isAndroidGoogleDriveOauthRuntime()) {
    return requestGoogleDriveAndroidAccessToken({
      scopes: [GOOGLE_DRIVE_APP_DATA_SCOPE],
      silent: options?.silent === true
    });
  }

  const google = getGoogleIdentityApi();
  const clientId = ensureClientId(options?.clientId);
  const silent = options?.silent === true;
  const prompt = options?.prompt ?? (silent ? "none" : "consent select_account");

  if (!google?.accounts?.oauth2) {
    throw new Error("GOOGLE_OAUTH_NOT_READY");
  }

  return new Promise<GoogleTokenResponse>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      callback();
    };
    const timeoutId = window.setTimeout(() => {
      settle(() => reject(new Error(silent ? "GOOGLE_DRIVE_AUTH_REQUIRED" : "GOOGLE_OAUTH_FAILED")));
    }, GOOGLE_TOKEN_REQUEST_TIMEOUT_MS);
    const tokenClient = google.accounts?.oauth2?.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_DRIVE_APP_DATA_SCOPE,
      include_granted_scopes: true,
      prompt,
      login_hint: options?.loginHint,
      callback: (response) => {
        if (response.error) {
          settle(() => reject(new Error(silent ? "GOOGLE_DRIVE_AUTH_REQUIRED" : response.error)));
          return;
        }

        settle(() => resolve(response));
      },
      error_callback: (error) => {
        if (silent) {
          settle(() => reject(new Error("GOOGLE_DRIVE_AUTH_REQUIRED")));
          return;
        }

        if (error.type === "popup_closed") {
          settle(() => reject(new Error("GOOGLE_OAUTH_POPUP_CLOSED")));
          return;
        }

        if (error.type === "popup_failed_to_open") {
          settle(() => reject(new Error("GOOGLE_OAUTH_POPUP_FAILED")));
          return;
        }

        settle(() => reject(new Error("GOOGLE_OAUTH_FAILED")));
      }
    });

    if (!tokenClient) {
      settle(() => reject(new Error("GOOGLE_OAUTH_UNAVAILABLE")));
      return;
    }

    tokenClient.requestAccessToken({
      prompt,
      login_hint: options?.loginHint
    });
  });
}

async function googleDriveJsonRequest<T>(
  url: string,
  accessToken: string,
  init: RequestInit = {}
) {
  const response = await performGoogleDriveRequest(url, accessToken, init);

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? ((await response.json().catch(() => null)) as T | { error?: { message?: string } } | null)
    : null;

  return payload as T;
}

async function googleDriveTextRequest(url: string, accessToken: string) {
  const response = await performGoogleDriveRequest(url, accessToken, { method: "GET" });

  return response.text();
}

async function googleDriveDeleteRequest(url: string, accessToken: string) {
  await performGoogleDriveRequest(url, accessToken, { method: "DELETE" }, { acceptedStatuses: [404] });
}

async function uploadGoogleDriveJsonFileResumable<T extends object>(input: {
  accessToken: string;
  fileId?: string | null;
  name: string;
  payload: T;
  payloadBytes: Uint8Array;
  parents?: string[];
}) {
  const metadata = {
    name: input.name,
    mimeType: "application/json",
    ...(input.parents?.length ? { parents: input.parents } : {})
  };
  const sessionUrl = input.fileId
    ? `${GOOGLE_DRIVE_UPLOAD_BASE_URL}/${encodeURIComponent(input.fileId)}?uploadType=resumable&fields=id,name,createdTime,modifiedTime,size`
    : `${GOOGLE_DRIVE_UPLOAD_BASE_URL}?uploadType=resumable&fields=id,name,createdTime,modifiedTime,size`;
  const sessionResponse = await performGoogleDriveRequest(
    sessionUrl,
    input.accessToken,
    {
      method: input.fileId ? "PATCH" : "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(input.payloadBytes.byteLength)
      },
      body: JSON.stringify(metadata)
    },
    { idempotent: Boolean(input.fileId) }
  );
  const uploadUrl = sessionResponse.headers.get("location")?.trim() ?? "";

  if (!uploadUrl) {
    throw new Error("GOOGLE_DRIVE_RESUMABLE_UPLOAD_FAILED");
  }

  let offset = 0;

  while (offset < input.payloadBytes.byteLength) {
    const end = Math.min(offset + GOOGLE_DRIVE_RESUMABLE_CHUNK_BYTES, input.payloadBytes.byteLength);
    const chunk = input.payloadBytes.slice(offset, end);
    const response = await performGoogleDriveRequest(
      uploadUrl,
      input.accessToken,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "Content-Length": String(chunk.byteLength),
          "Content-Range": `bytes ${offset}-${end - 1}/${input.payloadBytes.byteLength}`
        },
        body: chunk
      },
      {
        idempotent: true,
        acceptedStatuses: [308],
        timeoutMs: 60_000
      }
    );

    if (response.status === 308) {
      const acknowledged = response.headers.get("range")?.match(/bytes=0-(\d+)/i)?.[1];
      offset = acknowledged ? Number(acknowledged) + 1 : end;
      continue;
    }

    return (await response.json().catch(() => null)) as {
      id?: string;
      name?: string;
      createdTime?: string;
      modifiedTime?: string;
      size?: string;
    };
  }

  throw new Error("GOOGLE_DRIVE_RESUMABLE_UPLOAD_FAILED");
}

async function uploadGoogleDriveJsonFile<T extends object>(input: {
  accessToken: string;
  fileId?: string | null;
  name: string;
  payload: T;
  parents?: string[];
}) {
  const payloadJson = JSON.stringify(input.payload);
  const payloadBytes = new TextEncoder().encode(payloadJson);

  if (payloadBytes.byteLength > GOOGLE_DRIVE_MULTIPART_UPLOAD_LIMIT_BYTES) {
    return uploadGoogleDriveJsonFileResumable({
      ...input,
      payloadBytes
    });
  }

  const boundary = `locoris-${crypto.randomUUID()}`;
  const metadata = {
    name: input.name,
    ...(input.parents?.length ? { parents: input.parents } : {})
  };
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    payloadJson,
    `--${boundary}--`
  ].join("\r\n");
  const url = input.fileId
    ? `${GOOGLE_DRIVE_UPLOAD_BASE_URL}/${encodeURIComponent(input.fileId)}?uploadType=multipart&fields=id,name,createdTime,modifiedTime,size`
    : `${GOOGLE_DRIVE_UPLOAD_BASE_URL}?uploadType=multipart&fields=id,name,createdTime,modifiedTime,size`;

  return googleDriveJsonRequest<{
    id?: string;
    name?: string;
    createdTime?: string;
    modifiedTime?: string;
    size?: string;
  }>(url, input.accessToken, {
    method: input.fileId ? "PATCH" : "POST",
    headers: {
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body
  });
}

async function listGoogleDriveAppDataFiles(accessToken: string) {
  const files: NonNullable<GoogleDriveListResponse["files"]> = [];
  let pageToken = "";

  do {
    const params = new URLSearchParams({
      spaces: GOOGLE_DRIVE_APP_FOLDER,
      fields: "nextPageToken,files(id,name,createdTime,modifiedTime,size)",
      pageSize: "1000"
    });

    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const payload = await googleDriveJsonRequest<GoogleDriveListResponse>(
      `${GOOGLE_DRIVE_FILES_BASE_URL}?${params.toString()}`,
      accessToken,
      { method: "GET" }
    );
    files.push(...(payload.files ?? []));
    pageToken = sanitizeText(payload.nextPageToken, "");
  } while (pageToken);

  return files
    .map((file) => ({
      id: sanitizeText(file.id),
      name: sanitizeText(file.name),
      createdTime: sanitizeText(file.createdTime),
      modifiedTime: sanitizeText(file.modifiedTime),
      size: Math.max(0, Number(file.size) || 0)
    }))
    .filter((file) => file.id && file.name);
}

async function readDriveFileJson<T>(accessToken: string, fileId: string) {
  const text = await googleDriveTextRequest(
    `${GOOGLE_DRIVE_FILES_BASE_URL}/${encodeURIComponent(fileId)}?alt=media`,
    accessToken
  );

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("GOOGLE_DRIVE_INVALID_PAYLOAD");
  }
}

async function readGoogleDriveManifestState(accessToken: string): Promise<GoogleDriveManifestFileState> {
  const files = await listGoogleDriveAppDataFiles(accessToken);
  const manifestMeta = files.find((file) => file.name === GOOGLE_DRIVE_MANIFEST_FILE) ?? null;

  if (!manifestMeta) {
    return {
      fileId: null,
      manifest: createDefaultManifest(),
      files
    };
  }

  const payload = await readDriveFileJson<GoogleDriveManifest>(accessToken, manifestMeta.id).catch(
    (error) => {
      if (error instanceof Error && error.message === "GOOGLE_DRIVE_INVALID_PAYLOAD") {
        throw new Error("GOOGLE_DRIVE_MANIFEST_CORRUPT");
      }

      throw error;
    }
  );

  if (payload.provider !== "googleDrive" || !Array.isArray(payload.vaults)) {
    throw new Error("GOOGLE_DRIVE_MANIFEST_CORRUPT");
  }

  const manifest = payload;

  return {
    fileId: manifestMeta.id,
    manifest: {
      ...createDefaultManifest(),
      ...manifest,
      vaults: Array.isArray(manifest.vaults)
        ? manifest.vaults.map((entry) => ({
            ...entry,
            journalFileId: sanitizeText(entry?.journalFileId, "") || null,
            vaultKind: entry?.vaultKind === "private" ? "private" : "regular"
          }))
        : []
    },
    files
  };
}

async function writeGoogleDriveManifest(accessToken: string, state: GoogleDriveManifestFileState) {
  const payload: GoogleDriveManifest = {
    ...state.manifest,
    updatedAt: now(),
    vaults: [...state.manifest.vaults].sort((left, right) => left.name.localeCompare(right.name))
  };

  const response = await uploadGoogleDriveJsonFile({
    accessToken,
    fileId: state.fileId,
    name: GOOGLE_DRIVE_MANIFEST_FILE,
    parents: state.fileId ? undefined : [GOOGLE_DRIVE_APP_FOLDER],
    payload
  });

  return {
    fileId: sanitizeText(response.id) || state.fileId,
    manifest: payload
  };
}

function deriveVaultIdFromFileName(fileName: string) {
  if (
    !fileName.startsWith(GOOGLE_DRIVE_VAULT_PREFIX) ||
    !fileName.endsWith(".json") ||
    fileName.endsWith(GOOGLE_DRIVE_VAULT_JOURNAL_SUFFIX)
  ) {
    return null;
  }

  return fileName.slice(GOOGLE_DRIVE_VAULT_PREFIX.length, -".json".length).trim() || null;
}

function deriveVaultIdFromJournalFileName(fileName: string) {
  if (
    !fileName.startsWith(GOOGLE_DRIVE_VAULT_PREFIX) ||
    !fileName.endsWith(GOOGLE_DRIVE_VAULT_JOURNAL_SUFFIX)
  ) {
    return null;
  }

  return fileName
    .slice(GOOGLE_DRIVE_VAULT_PREFIX.length, -GOOGLE_DRIVE_VAULT_JOURNAL_SUFFIX.length)
    .trim() || null;
}

function normalizeRemoteVaultRecord(record: GoogleDriveRemoteVaultRecord): SyncRemoteVault {
  return {
    id: record.id,
    name: record.name,
    vaultKind: record.vaultKind,
    createdAt: record.updatedAt,
    updatedAt: record.updatedAt,
    lastRevision: record.revision ?? null,
    lastSyncAt: record.updatedAt,
    tokenCount: 1
  };
}

async function parseVaultFileForCatalog(accessToken: string, file: GoogleDriveFileMeta) {
  const blob = await readDriveFileJson<GoogleDriveVaultBlob | SyncEnvelope>(accessToken, file.id).catch(() => null);
  const derivedId = deriveVaultIdFromFileName(file.name);

  if (!blob) {
    if (!derivedId) {
      return null;
    }

    return {
      id: derivedId,
      name: derivedId,
      fileId: file.id,
      vaultKind: "regular",
      updatedAt: normalizeDriveTimestamp(file.modifiedTime),
      revision: null
    } satisfies GoogleDriveRemoteVaultRecord;
  }

  if ("envelope" in blob && blob.envelope && typeof blob.envelope === "object") {
    const envelope = blob.envelope;
    const vaultId = sanitizeText(blob.vaultId, derivedId ?? "");
    const vaultName =
      sanitizeText(
        envelope.metadata?.vault?.name,
        sanitizeText(blob.vaultId, derivedId ?? "")
      ) || vaultId;

    if (!vaultId) {
      return null;
    }

    return {
      id: vaultId,
      name: vaultName,
      fileId: file.id,
      vaultKind: envelope.metadata?.payloadMode === "encrypted" ? "private" : "regular",
      updatedAt: normalizeDriveTimestamp(file.modifiedTime),
      revision: envelope.revision ?? null
    } satisfies GoogleDriveRemoteVaultRecord;
  }

  if ("snapshot" in blob && derivedId) {
    return {
      id: derivedId,
      name: sanitizeText(blob.metadata?.vault?.name, derivedId),
      fileId: file.id,
      vaultKind: blob.metadata?.payloadMode === "encrypted" ? "private" : "regular",
      updatedAt: normalizeDriveTimestamp(file.modifiedTime),
      revision: blob.revision ?? null
    } satisfies GoogleDriveRemoteVaultRecord;
  }

  return null;
}

async function resolveGoogleDriveCatalog(accessToken: string) {
  const state = await readGoogleDriveManifestState(accessToken);
  const vaultFiles = state.files.filter(
    (file) => file.name !== GOOGLE_DRIVE_MANIFEST_FILE && deriveVaultIdFromFileName(file.name)
  );
  const journalFilesByVaultId = new Map(
    state.files
      .map((file) => [deriveVaultIdFromJournalFileName(file.name), file] as const)
      .filter((entry): entry is [string, GoogleDriveFileMeta] => Boolean(entry[0]))
  );
  const manifestById = new Map(state.manifest.vaults.map((entry) => [entry.id, entry]));
  const resolvedRecords: GoogleDriveRemoteVaultRecord[] = [];

  for (const file of vaultFiles) {
    const parsed = await parseVaultFileForCatalog(accessToken, file);

    if (!parsed) {
      continue;
    }

    const manifestEntry = manifestById.get(parsed.id);
    const journalMeta = journalFilesByVaultId.get(parsed.id) ?? null;
    resolvedRecords.push({
      ...parsed,
      journalFileId:
        sanitizeText(manifestEntry?.journalFileId, "") ||
        sanitizeText(journalMeta?.id, "") ||
        null,
      name: manifestEntry?.name || parsed.name,
      updatedAt: Math.max(parsed.updatedAt, manifestEntry?.updatedAt ?? 0),
      revision: manifestEntry?.revision ?? parsed.revision
    });
  }

  const v2VaultIds = [...new Set(
    state.files
      .map((file) => parseGoogleDriveV2FileName(file.name)?.vaultId ?? "")
      .filter(Boolean)
  )];

  for (const vaultId of v2VaultIds) {
    const v2State = await readGoogleDriveV2VaultState(accessToken, vaultId, {
      files: state.files,
      migrateLegacy: false
    });

    if (!v2State) {
      continue;
    }

    const currentIndex = resolvedRecords.findIndex((record) => record.id === vaultId);
    const current = currentIndex >= 0 ? resolvedRecords[currentIndex] : null;
    const latestCommit = v2State.commits[v2State.commits.length - 1] ?? null;
    const envelope = v2State.checkpoint.envelope;
    const nextRecord: GoogleDriveRemoteVaultRecord = {
      id: vaultId,
      name:
        latestCommit?.vaultName ||
        v2State.checkpoint.vaultName ||
        sanitizeText(envelope.metadata?.vault?.name, vaultId),
      fileId: current?.fileId ?? v2State.checkpoint.file.id,
      journalFileId: current?.journalFileId ?? null,
      vaultKind: envelope.metadata?.payloadMode === "encrypted" ? "private" : "regular",
      updatedAt: Math.max(
        v2State.checkpoint.createdAt,
        ...v2State.commits.map((commit) => commit.createdAt)
      ),
      revision: v2State.cursor
    };

    if (currentIndex >= 0) {
      resolvedRecords[currentIndex] = nextRecord;
    } else {
      resolvedRecords.push(nextRecord);
    }
  }

  const manifestNeedsUpdate =
    resolvedRecords.length !== state.manifest.vaults.length ||
    resolvedRecords.some((record) => {
      const current = manifestById.get(record.id);
      return (
        !current ||
        current.fileId !== record.fileId ||
        (current.journalFileId ?? null) !== (record.journalFileId ?? null) ||
        current.name !== record.name ||
        current.vaultKind !== record.vaultKind ||
        current.revision !== record.revision
      );
    });

  if (manifestNeedsUpdate) {
    await writeGoogleDriveManifest(accessToken, {
      ...state,
      manifest: {
        ...state.manifest,
        updatedAt: now(),
        vaults: resolvedRecords
      }
    });
  }

  return resolvedRecords.sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name));
}

async function getRemoteVaultRecord(accessToken: string, vaultId: string) {
  const catalog = await resolveGoogleDriveCatalog(accessToken);
  return catalog.find((entry) => entry.id === vaultId) ?? null;
}

function normalizeEnvelopePayload(
  value: GoogleDriveVaultBlob | SyncEnvelope | SyncSecureEnvelope
): SyncEnvelope | SyncSecureEnvelope {
  const candidate =
    value && typeof value === "object" && "envelope" in value && value.envelope
      ? value.envelope
      : value;

  if (
    !candidate ||
    typeof candidate !== "object" ||
    (!("snapshot" in candidate) || !candidate.snapshot) &&
      (!("encryptedSnapshot" in candidate) || !candidate.encryptedSnapshot)
  ) {
    throw new Error("GOOGLE_DRIVE_INVALID_PAYLOAD");
  }

  return candidate as SyncEnvelope | SyncSecureEnvelope;
}

function isEncryptedEnvelope(
  envelope: SyncEnvelope | SyncSecureEnvelope
): envelope is SyncSecureEnvelope {
  return Boolean(
    envelope &&
      typeof envelope === "object" &&
      "encryptedSnapshot" in envelope &&
      envelope.encryptedSnapshot
  );
}

function buildSnapshotFallbackFeed(
  envelope: SyncEnvelope | SyncSecureEnvelope
): SyncChangeFeed {
  return {
    mode: "snapshot",
    revision: envelope.revision ?? null,
    baseRevision: null,
    changes: null,
    encryptedChanges: null,
    snapshot: isEncryptedEnvelope(envelope) ? null : envelope.snapshot,
    metadata: envelope.metadata ?? null
  };
}

function normalizeJournalEntry(
  entry: unknown,
  fallbackDeviceId = "google-drive"
): GoogleDriveVaultJournalEntry | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const payload = entry as Record<string, unknown>;
  const revision = sanitizeText(payload.revision, "");

  if (!revision) {
    return null;
  }

  const changes = payload.encryptedChanges
    ? null
    : normalizeChangeSetPayload(payload.changes as Partial<SyncChangeSet> | null, fallbackDeviceId);
  const encryptedChanges = normalizeEncryptedPayload(payload.encryptedChanges);

  if (!changes && !encryptedChanges) {
    return null;
  }

  return {
    revision,
    baseRevision:
      typeof payload.baseRevision === "string" || payload.baseRevision === null
        ? (payload.baseRevision ?? null)
        : null,
    createdAt: typeof payload.createdAt === "number" ? payload.createdAt : now(),
    changes,
    encryptedChanges
  };
}

async function readGoogleDriveJournalState(
  accessToken: string,
  record: Pick<GoogleDriveRemoteVaultRecord, "id" | "journalFileId">
) {
  let journalFileId = sanitizeText(record.journalFileId, "") || null;

  if (!journalFileId) {
    const files = await listGoogleDriveAppDataFiles(accessToken);
    const journalMeta =
      files.find((file) => file.name === buildGoogleDriveVaultJournalFileName(record.id)) ?? null;
    journalFileId = journalMeta?.id ?? null;
  }

  if (!journalFileId) {
    return {
      fileId: null,
      blob: createDefaultVaultJournalBlob(record.id)
    };
  }

  const payload = await readDriveFileJson<GoogleDriveVaultJournalBlob>(accessToken, journalFileId).catch(
    (error) => {
      if (error instanceof Error && error.message === "GOOGLE_DRIVE_INVALID_PAYLOAD") {
        throw new Error("GOOGLE_DRIVE_JOURNAL_CORRUPT");
      }

      throw error;
    }
  );

  if (!payload || payload.provider !== "googleDrive" || !Array.isArray(payload.entries)) {
    throw new Error("GOOGLE_DRIVE_JOURNAL_CORRUPT");
  }

  return {
    fileId: journalFileId,
    blob: {
      schemaVersion: 1,
      provider: "googleDrive" as const,
      vaultId: sanitizeText(payload.vaultId, record.id) || record.id,
      updatedAt: typeof payload.updatedAt === "number" ? payload.updatedAt : now(),
      entries: payload.entries
        .map((entry) => normalizeJournalEntry(entry))
        .filter((entry): entry is GoogleDriveVaultJournalEntry => Boolean(entry))
    }
  };
}

async function writeGoogleDriveJournalState(
  accessToken: string,
  record: Pick<GoogleDriveRemoteVaultRecord, "id" | "journalFileId">,
  entries: readonly GoogleDriveVaultJournalEntry[]
) {
  const response = await uploadGoogleDriveJsonFile({
    accessToken,
    fileId: record.journalFileId ?? null,
    name: buildGoogleDriveVaultJournalFileName(record.id),
    parents: record.journalFileId ? undefined : [GOOGLE_DRIVE_APP_FOLDER],
    payload: {
      schemaVersion: 1,
      provider: "googleDrive",
      vaultId: record.id,
      updatedAt: now(),
      entries: pruneJournalEntries(entries)
    } satisfies GoogleDriveVaultJournalBlob
  });

  return sanitizeText(response.id, record.journalFileId ?? "") || null;
}

async function ensureGoogleDriveJournalState(
  accessToken: string,
  record: Pick<GoogleDriveRemoteVaultRecord, "id" | "journalFileId">
) {
  const journalState = await readGoogleDriveJournalState(accessToken, record);

  if (journalState.fileId) {
    return {
      journalFileId: journalState.fileId,
      entries: journalState.blob.entries
    };
  }

  const journalFileId = await writeGoogleDriveJournalState(
    accessToken,
    {
      id: record.id,
      journalFileId: null
    },
    journalState.blob.entries
  );

  return {
    journalFileId,
    entries: journalState.blob.entries
  };
}

function applyGoogleDriveChangeSetsToSnapshot(
  snapshot: SyncSnapshot,
  changeSets: readonly SyncChangeSet[]
) {
  const maps = {
    project: new Map(snapshot.projects.map((record) => [record.id, record])),
    folder: new Map(snapshot.folders.map((record) => [record.id, record])),
    tag: new Map(snapshot.tags.map((record) => [record.id, record])),
    note: new Map(snapshot.notes.map((record) => [record.id, record])),
    asset: new Map(snapshot.assets.map((record) => [record.id, record])),
    task: new Map(snapshot.tasks.map((record) => [record.id, record])),
    habit: new Map(snapshot.habits.map((record) => [record.id, record])),
    habitLog: new Map(snapshot.habitLogs.map((record) => [record.id, record])),
    goal: new Map(snapshot.goals.map((record) => [record.id, record])),
    timeBlock: new Map(snapshot.timeBlocks.map((record) => [record.id, record])),
    tombstones: new Map(snapshot.tombstones.map((record) => [record.key, record]))
  };
  let deviceId = snapshot.deviceId;
  let exportedAt = snapshot.exportedAt;

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

function normalizeGoogleDriveV2Checkpoint(
  payload: unknown,
  file: GoogleDriveFileMeta,
  expectedVaultId: string
): GoogleDriveV2CheckpointRecord | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Partial<GoogleDriveV2CheckpointBlob>;
  const checkpointId = sanitizeText(record.checkpointId, "");
  const vaultId = sanitizeText(record.vaultId, "");

  if (
    record.schemaVersion !== 2 ||
    record.provider !== "googleDrive" ||
    record.recordType !== "checkpoint" ||
    !checkpointId ||
    vaultId !== expectedVaultId ||
    !record.envelope
  ) {
    return null;
  }

  let envelope: SyncEnvelope | SyncSecureEnvelope;

  try {
    envelope = normalizeEnvelopePayload(record.envelope);
  } catch {
    return null;
  }

  return {
    schemaVersion: 2,
    provider: "googleDrive",
    recordType: "checkpoint",
    checkpointId,
    vaultId,
    vaultName: sanitizeText(record.vaultName, vaultId),
    vaultKind: record.vaultKind === "private" ? "private" : "regular",
    createdAt:
      typeof record.createdAt === "number"
        ? record.createdAt
        : normalizeDriveTimestamp(file.createdTime || file.modifiedTime),
    coveredCommitCount:
      typeof record.coveredCommitCount === "number"
        ? Math.max(0, Math.floor(record.coveredCommitCount))
        : 0,
    appliedCommitIds: Array.isArray(record.appliedCommitIds)
      ? [...new Set(record.appliedCommitIds.map((value) => sanitizeText(value, "")).filter(Boolean))]
      : [],
    baseCursor: typeof record.baseCursor === "string" ? record.baseCursor : null,
    envelope,
    file
  };
}

function normalizeGoogleDriveV2Commit(
  payload: unknown,
  file: GoogleDriveFileMeta,
  expectedVaultId: string
): GoogleDriveV2CommitRecord | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Partial<GoogleDriveV2CommitBlob>;
  const commitId = sanitizeText(record.commitId, "");
  const vaultId = sanitizeText(record.vaultId, "");
  const encryptedChanges = normalizeEncryptedPayload(record.encryptedChanges);
  const hasPlainChanges = Boolean(record.changes && typeof record.changes === "object");
  const changes = encryptedChanges || !hasPlainChanges
    ? null
    : normalizeChangeSetPayload(record.changes, "google-drive");

  if (
    record.schemaVersion !== 2 ||
    record.provider !== "googleDrive" ||
    record.recordType !== "commit" ||
    !commitId ||
    vaultId !== expectedVaultId ||
    (!changes && !encryptedChanges)
  ) {
    return null;
  }

  return {
    schemaVersion: 2,
    provider: "googleDrive",
    recordType: "commit",
    commitId,
    vaultId,
    vaultName: sanitizeText(record.vaultName, vaultId),
    vaultKind: record.vaultKind === "private" ? "private" : "regular",
    baseCursor: typeof record.baseCursor === "string" ? record.baseCursor : null,
    createdAt:
      typeof record.createdAt === "number"
        ? record.createdAt
        : normalizeDriveTimestamp(file.createdTime || file.modifiedTime),
    changes,
    encryptedChanges,
    metadata: record.metadata ?? null,
    file
  };
}

async function uploadGoogleDriveV2Checkpoint(
  accessToken: string,
  payload: GoogleDriveV2CheckpointBlob
) {
  const response = await uploadGoogleDriveJsonFile({
    accessToken,
    name: buildGoogleDriveV2FileName("checkpoint", payload.vaultId, payload.checkpointId),
    parents: [GOOGLE_DRIVE_APP_FOLDER],
    payload
  });

  return {
    ...payload,
    file: {
      id: sanitizeText(response.id, ""),
      name: sanitizeText(
        response.name,
        buildGoogleDriveV2FileName("checkpoint", payload.vaultId, payload.checkpointId)
      ),
      createdTime: sanitizeText(response.createdTime, new Date(payload.createdAt).toISOString()),
      modifiedTime: sanitizeText(response.modifiedTime, new Date(payload.createdAt).toISOString()),
      size: Math.max(0, Number(response.size) || JSON.stringify(payload).length)
    }
  } satisfies GoogleDriveV2CheckpointRecord;
}

async function uploadGoogleDriveV2Commit(
  accessToken: string,
  payload: GoogleDriveV2CommitBlob
) {
  const response = await uploadGoogleDriveJsonFile({
    accessToken,
    name: buildGoogleDriveV2FileName("commit", payload.vaultId, payload.commitId),
    parents: [GOOGLE_DRIVE_APP_FOLDER],
    payload
  });

  return {
    ...payload,
    file: {
      id: sanitizeText(response.id, ""),
      name: sanitizeText(
        response.name,
        buildGoogleDriveV2FileName("commit", payload.vaultId, payload.commitId)
      ),
      createdTime: sanitizeText(response.createdTime, new Date(payload.createdAt).toISOString()),
      modifiedTime: sanitizeText(response.modifiedTime, new Date(payload.createdAt).toISOString()),
      size: Math.max(0, Number(response.size) || JSON.stringify(payload).length)
    }
  } satisfies GoogleDriveV2CommitRecord;
}

async function createGoogleDriveV2MigrationCheckpoint(
  accessToken: string,
  vaultId: string,
  files: GoogleDriveFileMeta[]
) {
  const legacyFile = files.find((file) => deriveVaultIdFromFileName(file.name) === vaultId) ?? null;

  if (!legacyFile) {
    return null;
  }

  const legacyPayload = await readDriveFileJson<GoogleDriveVaultBlob | SyncEnvelope | SyncSecureEnvelope>(
    accessToken,
    legacyFile.id
  );
  const envelope = normalizeEnvelopePayload(legacyPayload);
  const checkpointId = crypto.randomUUID();

  return uploadGoogleDriveV2Checkpoint(accessToken, {
    schemaVersion: 2,
    provider: "googleDrive",
    recordType: "checkpoint",
    checkpointId,
    vaultId,
    vaultName: sanitizeText(envelope.metadata?.vault?.name, vaultId),
    vaultKind: envelope.metadata?.payloadMode === "encrypted" ? "private" : "regular",
    createdAt: now(),
    coveredCommitCount: 0,
    appliedCommitIds: [],
    baseCursor: null,
    envelope
  });
}

async function promoteChangedGoogleDriveLegacyMirror(
  accessToken: string,
  vaultId: string,
  files: GoogleDriveFileMeta[],
  checkpoint: GoogleDriveV2CheckpointRecord
) {
  const legacyFile = files.find((file) => deriveVaultIdFromFileName(file.name) === vaultId) ?? null;

  if (!legacyFile) {
    return checkpoint;
  }

  const legacyModifiedAt = normalizeDriveTimestamp(legacyFile.modifiedTime);
  const checkpointCreatedAt = normalizeDriveTimestamp(
    checkpoint.file.createdTime || checkpoint.file.modifiedTime
  );

  if (legacyModifiedAt < checkpointCreatedAt) {
    return checkpoint;
  }

  const legacyPayload = await readDriveFileJson<
    GoogleDriveVaultBlob | SyncEnvelope | SyncSecureEnvelope
  >(accessToken, legacyFile.id).catch(() => null);

  if (!legacyPayload) {
    // A healthy v2 checkpoint remains recoverable even if its compatibility
    // mirror was damaged. Do not replace good data with an empty fallback.
    return checkpoint;
  }

  let legacyEnvelope: SyncEnvelope | SyncSecureEnvelope;

  try {
    legacyEnvelope = normalizeEnvelopePayload(legacyPayload);
  } catch {
    return checkpoint;
  }

  if (JSON.stringify(legacyEnvelope) === JSON.stringify(checkpoint.envelope)) {
    return checkpoint;
  }

  return uploadGoogleDriveV2Checkpoint(accessToken, {
    schemaVersion: 2,
    provider: "googleDrive",
    recordType: "checkpoint",
    checkpointId: crypto.randomUUID(),
    vaultId,
    vaultName: sanitizeText(legacyEnvelope.metadata?.vault?.name, checkpoint.vaultName),
    vaultKind: legacyEnvelope.metadata?.payloadMode === "encrypted" ? "private" : "regular",
    createdAt: now(),
    // Treat a write from a legacy client as a new branch generation. Existing
    // v2 commits stay unapplied and are merged by the next normal sync.
    coveredCommitCount: checkpoint.coveredCommitCount + 1,
    appliedCommitIds: checkpoint.appliedCommitIds,
    baseCursor: buildGoogleDriveV2Cursor(checkpoint, []),
    envelope: legacyEnvelope
  });
}

async function readGoogleDriveV2VaultState(
  accessToken: string,
  vaultId: string,
  options: {
    files?: GoogleDriveFileMeta[];
    migrateLegacy?: boolean;
  } = {}
): Promise<GoogleDriveV2VaultState | null> {
  const files = options.files ?? (await listGoogleDriveAppDataFiles(accessToken));
  const v2Files = files.filter((file) => parseGoogleDriveV2FileName(file.name)?.vaultId === vaultId);
  const checkpointFiles = sortGoogleDriveV2Files(
    v2Files.filter((file) => parseGoogleDriveV2FileName(file.name)?.kind === "checkpoint")
  );
  let checkpoints = (
    await Promise.all(
      checkpointFiles.map(async (file) => {
        const checkpoint = normalizeGoogleDriveV2Checkpoint(
          await readDriveFileJson<GoogleDriveV2CheckpointBlob>(accessToken, file.id),
          file,
          vaultId
        );

        if (!checkpoint) {
          throw new Error("GOOGLE_DRIVE_V2_DATA_CORRUPT");
        }

        return checkpoint;
      })
    )
  ).filter((entry): entry is GoogleDriveV2CheckpointRecord => Boolean(entry));

  if (checkpoints.length === 0 && options.migrateLegacy !== false) {
    const migrated = await createGoogleDriveV2MigrationCheckpoint(accessToken, vaultId, files);

    if (migrated) {
      checkpoints = [migrated];
    }
  }

  let checkpoint = selectGoogleDriveV2Checkpoint(checkpoints);

  if (!checkpoint) {
    return null;
  }

  const promotedCheckpoint = await promoteChangedGoogleDriveLegacyMirror(
    accessToken,
    vaultId,
    files,
    checkpoint
  );

  if (promotedCheckpoint.checkpointId !== checkpoint.checkpointId) {
    checkpoint = promotedCheckpoint;
    checkpoints = [...checkpoints, promotedCheckpoint];
  }

  const commitFiles = sortGoogleDriveV2Files(
    v2Files.filter((file) => parseGoogleDriveV2FileName(file.name)?.kind === "commit")
  );
  const commits = (
    await Promise.all(
      commitFiles.map(async (file) => {
        const commit = normalizeGoogleDriveV2Commit(
          await readDriveFileJson<GoogleDriveV2CommitBlob>(accessToken, file.id),
          file,
          vaultId
        );

        if (!commit) {
          throw new Error("GOOGLE_DRIVE_V2_DATA_CORRUPT");
        }

        return commit;
      })
    )
  ).filter((entry): entry is GoogleDriveV2CommitRecord => Boolean(entry));
  const orderedCommitFiles = sortGoogleDriveV2Files(commits.map((entry) => entry.file));
  const commitByFileId = new Map(commits.map((entry) => [entry.file.id, entry]));
  const orderedCommits = orderedCommitFiles
    .map((file) => commitByFileId.get(file.id) ?? null)
    .filter((entry): entry is GoogleDriveV2CommitRecord => Boolean(entry));
  const unappliedCommits = collectGoogleDriveV2UnappliedCommits(checkpoint, orderedCommits);

  return {
    checkpoint,
    checkpoints,
    commits: orderedCommits,
    unappliedCommits,
    cursor: buildGoogleDriveV2Cursor(checkpoint, orderedCommits)
  };
}

async function cleanupGoogleDriveV2History(
  accessToken: string,
  state: GoogleDriveV2VaultState,
  activeCheckpoint: GoogleDriveV2CheckpointRecord
) {
  const appliedCommitIds = new Set(activeCheckpoint.appliedCommitIds);
  const retention = planGoogleDriveV2CommitRetention(
    state.commits.map((commit) => commit.file as GoogleDriveV2FileMeta),
    appliedCommitIds
  );
  const obsoleteCheckpointFileIds = sortGoogleDriveV2Files(
    state.checkpoints
      .filter((checkpoint) => checkpoint.checkpointId !== activeCheckpoint.checkpointId)
      .map((checkpoint) => checkpoint.file)
  )
    .slice(0, -Math.max(0, GOOGLE_DRIVE_V2_CHECKPOINT_RETENTION_COUNT - 1))
    .map((file) => file.id);

  const deletionResults = await Promise.all(
    [...retention.deleteFileIds, ...obsoleteCheckpointFileIds].map(async (fileId) => {
      try {
        await googleDriveDeleteRequest(
          `${GOOGLE_DRIVE_FILES_BASE_URL}/${encodeURIComponent(fileId)}`,
          accessToken
        );
        return fileId;
      } catch {
        return null;
      }
    })
  );
  const deletedFileIds = new Set(deletionResults.filter((fileId): fileId is string => Boolean(fileId)));

  return state.commits.filter((commit) => !deletedFileIds.has(commit.file.id));
}

export async function loadGoogleDriveRemoteBootstrap(
  accessToken: string,
  vaultId: string
): Promise<GoogleDriveRemoteBootstrap> {
  const state = await readGoogleDriveV2VaultState(accessToken, vaultId, { migrateLegacy: true });

  if (!state) {
    const envelope = await loadGoogleDriveRemoteEnvelope(accessToken, vaultId);
    return {
      revision: envelope.revision ?? "",
      checkpointRevision: envelope.revision ?? null,
      envelope,
      changes: null,
      encryptedChanges: null
    };
  }

  const plainChanges = state.unappliedCommits
    .map((commit) => commit.changes)
    .filter((entry): entry is SyncChangeSet => Boolean(entry));
  const encryptedChanges = state.unappliedCommits
    .map((commit) => commit.encryptedChanges)
    .filter((entry): entry is SyncEncryptedPayload => Boolean(entry));

  return {
    revision: state.cursor,
    checkpointRevision: state.checkpoint.envelope.revision ?? null,
    envelope: state.checkpoint.envelope,
    changes: plainChanges.length > 0 ? collapseChangeSetBatches(plainChanges) : null,
    encryptedChanges: encryptedChanges.length > 0 ? encryptedChanges : null
  };
}

export async function connectGoogleDriveAccount(options?: {
  clientId?: string;
  loginHint?: string;
  prompt?: string;
  silent?: boolean;
}) {
  if (isDesktopGoogleDriveOauthRuntime()) {
    if (options?.silent) {
      throw new Error("GOOGLE_DRIVE_AUTH_REQUIRED");
    }

    return connectGoogleDriveDesktopAccount({
      clientId: ensureClientId(options?.clientId),
      loginHint: options?.loginHint,
      prompt: options?.prompt
    });
  }

  if (!googleDriveOAuthReady()) {
    await prepareGoogleDriveOAuth();
  }

  const token = await requestGoogleDriveAccessToken({
    clientId: options?.clientId,
    loginHint: options?.loginHint,
    prompt: options?.prompt,
    silent: options?.silent
  });

  if (!token.access_token) {
    throw new Error("GOOGLE_DRIVE_AUTH_REQUIRED");
  }

  const about = await googleDriveJsonRequest<GoogleDriveAboutResponse>(
    `${GOOGLE_DRIVE_ABOUT_URL}?fields=user(displayName,emailAddress,permissionId)`,
    token.access_token,
    {
      method: "GET"
    }
  );

  return {
    accessToken: token.access_token,
    expiresAt:
      typeof token.expires_in === "number" ? now() + Math.max(30, token.expires_in) * 1000 : null,
    refreshToken: null,
    userId: sanitizeText(about.user?.permissionId) || null,
    userName: sanitizeText(about.user?.displayName),
    userEmail: sanitizeText(about.user?.emailAddress)
  } satisfies GoogleDriveAccountSession;
}

async function refreshGoogleDriveAccountSessionInternal(options: {
  connectionId?: string;
  clientId?: string;
  loginHint?: string;
}) {
  if (isDesktopGoogleDriveOauthRuntime()) {
    const connectionId = sanitizeText(options.connectionId);

    if (!connectionId) {
      throw new Error("GOOGLE_DRIVE_AUTH_REQUIRED");
    }

    return refreshGoogleDriveDesktopAccountSession({
      clientId: ensureClientId(options.clientId),
      connectionId
    });
  }

  if (!googleDriveOAuthReady()) {
    await prepareGoogleDriveOAuth();
  }

  const token = await requestGoogleDriveAccessToken({
    clientId: options.clientId,
    loginHint: options.loginHint,
    silent: true,
    prompt: "none"
  });

  if (!token.access_token) {
    throw new Error("GOOGLE_DRIVE_AUTH_REQUIRED");
  }

  const about = await googleDriveJsonRequest<GoogleDriveAboutResponse>(
    `${GOOGLE_DRIVE_ABOUT_URL}?fields=user(displayName,emailAddress,permissionId)`,
    token.access_token,
    {
      method: "GET"
    }
  );

  return {
    accessToken: token.access_token,
    expiresAt:
      typeof token.expires_in === "number" ? now() + Math.max(30, token.expires_in) * 1000 : null,
    refreshToken: null,
    userId: sanitizeText(about.user?.permissionId) || null,
    userName: sanitizeText(about.user?.displayName),
    userEmail: sanitizeText(about.user?.emailAddress)
  } satisfies GoogleDriveAccountSession;
}

export function refreshGoogleDriveAccountSession(options: {
  connectionId?: string;
  clientId?: string;
  loginHint?: string;
}) {
  const refreshKey = [
    isDesktopGoogleDriveOauthRuntime() ? "desktop" : isAndroidGoogleDriveOauthRuntime() ? "android" : "web",
    sanitizeText(options.connectionId, "anonymous"),
    sanitizeText(options.loginHint, "account")
  ].join(":");
  const current = googleDriveRefreshPromises.get(refreshKey);

  if (current) {
    return current;
  }

  const pending = refreshGoogleDriveAccountSessionInternal(options).finally(() => {
    if (googleDriveRefreshPromises.get(refreshKey) === pending) {
      googleDriveRefreshPromises.delete(refreshKey);
    }
  });

  googleDriveRefreshPromises.set(refreshKey, pending);
  return pending;
}

export async function clearGoogleDriveAccountSession(accessToken: string) {
  const token = accessToken.trim();

  if (!token) {
    return;
  }

  if (isAndroidGoogleDriveOauthRuntime()) {
    await clearGoogleDriveAndroidAccessToken(token);
  }
}

export async function revokeGoogleDriveAccountAccess(
  accessToken: string,
  connectionId?: string
) {
  const token = accessToken.trim();

  if (isDesktopGoogleDriveOauthRuntime()) {
    await revokeGoogleDriveDesktopAccess(token, connectionId);
    return;
  }

  if (isAndroidGoogleDriveOauthRuntime()) {
    await revokeGoogleDriveAndroidAccess();
    return;
  }

  if (!token) {
    return;
  }

  const google = getGoogleIdentityApi();

  if (!google?.accounts?.oauth2?.revoke) {
    throw new Error("GOOGLE_OAUTH_NOT_READY");
  }

  await new Promise<void>((resolve, reject) => {
    google.accounts?.oauth2?.revoke(token, (response) => {
      if (response.error || response.successful === false) {
        reject(new Error("GOOGLE_OAUTH_REVOKE_FAILED"));
        return;
      }

      resolve();
    });
  });
}

export async function pollGoogleDriveRemoteChanges(
  accessToken: string,
  pageToken?: string | null
) {
  let cursor = sanitizeText(pageToken, "");

  const loadStartPageToken = async () => {
    const payload = await googleDriveJsonRequest<{ startPageToken?: string }>(
      `${GOOGLE_DRIVE_API_BASE_URL}/drive/v3/changes/startPageToken`,
      accessToken,
      { method: "GET" }
    );

    return sanitizeText(payload.startPageToken, "") || null;
  };

  if (!cursor) {
    return {
      changed: false,
      nextPageToken: await loadStartPageToken()
    };
  }

  let changed = false;
  let nextPageToken: string | null = null;

  do {
    const params = new URLSearchParams({
      pageToken: cursor,
      spaces: GOOGLE_DRIVE_APP_FOLDER,
      pageSize: "1000",
      fields: "nextPageToken,newStartPageToken,changes(removed,fileId,file(id,name,modifiedTime))"
    });
    let payload: GoogleDriveChangeListResponse;

    try {
      payload = await googleDriveJsonRequest<GoogleDriveChangeListResponse>(
        `${GOOGLE_DRIVE_API_BASE_URL}/drive/v3/changes?${params.toString()}`,
        accessToken,
        { method: "GET" }
      );
    } catch (error) {
      if (error instanceof Error && error.message === "GOOGLE_DRIVE_CHANGE_TOKEN_EXPIRED") {
        return {
          // A pruned change history cannot be replayed safely. Force the
          // normal snapshot reconciliation and continue from a fresh cursor.
          changed: true,
          nextPageToken: await loadStartPageToken()
        };
      }

      throw error;
    }

    changed ||= (payload.changes ?? []).some((change) => {
      const name = sanitizeText(change.file?.name, "");
      return (
        change.removed === true ||
        name === GOOGLE_DRIVE_MANIFEST_FILE ||
        name.startsWith(GOOGLE_DRIVE_VAULT_PREFIX) ||
        name.startsWith(`${GOOGLE_DRIVE_V2_FILE_PREFIX}.`)
      );
    });
    cursor = sanitizeText(payload.nextPageToken, "");
    nextPageToken = sanitizeText(payload.newStartPageToken, "") || nextPageToken;
  } while (cursor);

  return {
    changed,
    nextPageToken
  };
}

export async function listGoogleDriveRemoteVaults(accessToken: string) {
  const records = await resolveGoogleDriveCatalog(accessToken);
  return records.map(normalizeRemoteVaultRecord);
}

export async function createGoogleDriveRemoteVault(
  accessToken: string,
  payload: {
    name: string;
    id?: string;
  }
) {
  const vaultId = sanitizeText(payload.id, "") || crypto.randomUUID();
  const vaultName = sanitizeText(payload.name, "New vault");
  const existing = await getRemoteVaultRecord(accessToken, vaultId);

  if (existing) {
    return normalizeRemoteVaultRecord(existing);
  }

  const fileName = `${GOOGLE_DRIVE_VAULT_PREFIX}${vaultId}.json`;
  const blob = createDefaultVaultBlob(vaultId, vaultName);
  const created = await uploadGoogleDriveJsonFile({
    accessToken,
    name: fileName,
    parents: [GOOGLE_DRIVE_APP_FOLDER],
    payload: blob
  });
  const journalCreated = await uploadGoogleDriveJsonFile({
    accessToken,
    name: buildGoogleDriveVaultJournalFileName(vaultId),
    parents: [GOOGLE_DRIVE_APP_FOLDER],
    payload: createDefaultVaultJournalBlob(vaultId)
  });
  const state = await readGoogleDriveManifestState(accessToken);
  const record: GoogleDriveRemoteVaultRecord = {
    id: vaultId,
    name: vaultName,
    fileId: sanitizeText(created.id),
    journalFileId: sanitizeText(journalCreated.id) || null,
    vaultKind: "regular",
    updatedAt: normalizeDriveTimestamp(created.modifiedTime),
    revision: blob.envelope.revision ?? null
  };

  await writeGoogleDriveManifest(accessToken, {
    ...state,
    manifest: {
      ...state.manifest,
      updatedAt: now(),
      vaults: [...state.manifest.vaults.filter((entry) => entry.id !== vaultId), record]
    }
  });

  const checkpoint = await uploadGoogleDriveV2Checkpoint(accessToken, {
    schemaVersion: 2,
    provider: "googleDrive",
    recordType: "checkpoint",
    checkpointId: crypto.randomUUID(),
    vaultId,
    vaultName,
    vaultKind: "regular",
    createdAt: now(),
    coveredCommitCount: 0,
    appliedCommitIds: [],
    baseCursor: null,
    envelope: blob.envelope
  });

  return normalizeRemoteVaultRecord({
    ...record,
    revision: buildGoogleDriveV2Cursor(checkpoint, [])
  });
}

export async function deleteGoogleDriveRemoteVault(accessToken: string, vaultId: string) {
  const files = await listGoogleDriveAppDataFiles(accessToken);
  const fileIds = files
    .filter((file) => {
      const v2Identity = parseGoogleDriveV2FileName(file.name);
      return (
        v2Identity?.vaultId === vaultId ||
        deriveVaultIdFromFileName(file.name) === vaultId ||
        deriveVaultIdFromJournalFileName(file.name) === vaultId
      );
    })
    .map((file) => file.id);

  if (fileIds.length === 0) {
    throw new Error("VAULT_NOT_FOUND");
  }

  await Promise.all(
    [...new Set(fileIds)].map((fileId) =>
      googleDriveDeleteRequest(
        `${GOOGLE_DRIVE_FILES_BASE_URL}/${encodeURIComponent(fileId)}`,
        accessToken
      )
    )
  );

  const state = await readGoogleDriveManifestState(accessToken);
  await writeGoogleDriveManifest(accessToken, {
    ...state,
    manifest: {
      ...state.manifest,
      updatedAt: now(),
      vaults: state.manifest.vaults.filter((entry) => entry.id !== vaultId)
    }
  });
}

export async function renameGoogleDriveRemoteVault(
  accessToken: string,
  input: {
    vaultId: string;
    vaultName: string;
  }
) {
  const record = await getRemoteVaultRecord(accessToken, input.vaultId);

  if (!record) {
    throw new Error("VAULT_NOT_FOUND");
  }

  const nextName = sanitizeText(input.vaultName, record.name || input.vaultId);

  if (!nextName) {
    throw new Error("VAULT_NAME_REQUIRED");
  }

  const state = await readGoogleDriveV2VaultState(accessToken, input.vaultId, {
    migrateLegacy: true
  });
  const envelope = state?.checkpoint.envelope ?? await loadGoogleDriveRemoteEnvelope(accessToken, input.vaultId);
  const nextEnvelope =
    envelope.metadata
      ? {
          ...envelope,
          metadata: {
            ...envelope.metadata,
            vault: {
              ...(envelope.metadata.vault ?? buildVaultDescriptor(input.vaultId, nextName)),
              name: nextName
            }
          }
        }
      : {
          ...envelope,
          metadata: createPlainSyncDescriptor(buildVaultDescriptor(input.vaultId, nextName))
        };

  if (!state) {
    const nextRecord = await saveGoogleDriveRemoteEnvelope(accessToken, {
      vaultId: input.vaultId,
      vaultName: nextName,
      envelope: nextEnvelope
    });

    return normalizeRemoteVaultRecord(nextRecord);
  }

  const checkpoint = await uploadGoogleDriveV2Checkpoint(accessToken, {
    schemaVersion: 2,
    provider: "googleDrive",
    recordType: "checkpoint",
    checkpointId: crypto.randomUUID(),
    vaultId: input.vaultId,
    vaultName: nextName,
    vaultKind: state.checkpoint.vaultKind,
    createdAt: now(),
    coveredCommitCount: state.checkpoint.coveredCommitCount,
    appliedCommitIds: state.checkpoint.appliedCommitIds,
    baseCursor: state.cursor,
    envelope: nextEnvelope
  });
  const legacyRecord = await saveGoogleDriveLegacyRemoteEnvelope(accessToken, {
    vaultId: input.vaultId,
    vaultName: nextName,
    envelope: nextEnvelope
  });
  const retainedCommits = await cleanupGoogleDriveV2History(
    accessToken,
    {
      ...state,
      checkpoint,
      checkpoints: [...state.checkpoints, checkpoint]
    },
    checkpoint
  );
  const nextRecord = {
    ...legacyRecord,
    name: nextName,
    updatedAt: checkpoint.createdAt,
    revision: buildGoogleDriveV2Cursor(checkpoint, retainedCommits)
  };

  return normalizeRemoteVaultRecord(nextRecord);
}

export async function loadGoogleDriveRemoteEnvelope(accessToken: string, vaultId: string) {
  const v2State = await readGoogleDriveV2VaultState(accessToken, vaultId, { migrateLegacy: true });

  if (v2State) {
    const checkpointEnvelope = v2State.checkpoint.envelope;

    if (!isEncryptedEnvelope(checkpointEnvelope)) {
      const plainChanges = v2State.unappliedCommits
        .map((commit) => commit.changes)
        .filter((entry): entry is SyncChangeSet => Boolean(entry));

      return {
        ...checkpointEnvelope,
        revision: v2State.cursor,
        snapshot: applyGoogleDriveChangeSetsToSnapshot(checkpointEnvelope.snapshot, plainChanges)
      } satisfies SyncEnvelope;
    }

    return {
      ...checkpointEnvelope,
      revision: v2State.cursor
    } satisfies SyncSecureEnvelope;
  }

  const record = await getRemoteVaultRecord(accessToken, vaultId);

  if (!record) {
    throw new Error("VAULT_NOT_FOUND");
  }

  const payload = await readDriveFileJson<GoogleDriveVaultBlob | SyncEnvelope | SyncSecureEnvelope>(
    accessToken,
    record.fileId
  );

  return normalizeEnvelopePayload(payload);
}

async function saveGoogleDriveLegacyRemoteEnvelope(
  accessToken: string,
  input: {
    vaultId: string;
    vaultName: string;
    envelope: SyncEnvelope | SyncSecureEnvelope;
  }
) {
  const existing = await getRemoteVaultRecord(accessToken, input.vaultId);
  const blob: GoogleDriveVaultBlob = {
    schemaVersion: 1,
    provider: "googleDrive",
    vaultId: input.vaultId,
    updatedAt: now(),
    envelope: input.envelope
  };
  const response = await uploadGoogleDriveJsonFile({
    accessToken,
    fileId: existing?.fileId ?? null,
    name: buildGoogleDriveVaultStateFileName(input.vaultId),
    parents: existing ? undefined : [GOOGLE_DRIVE_APP_FOLDER],
    payload: blob
  });
  const { journalFileId } = await ensureGoogleDriveJournalState(accessToken, {
    id: input.vaultId,
    journalFileId: existing?.journalFileId ?? null
  });
  const record: GoogleDriveRemoteVaultRecord = {
    id: input.vaultId,
    name: sanitizeText(input.vaultName, input.vaultId),
    fileId: sanitizeText(response.id, existing?.fileId ?? ""),
    journalFileId,
    vaultKind: input.envelope.metadata?.payloadMode === "encrypted" ? "private" : "regular",
    updatedAt: normalizeDriveTimestamp(response.modifiedTime),
    revision: input.envelope.revision ?? null
  };
  const state = await readGoogleDriveManifestState(accessToken);

  await writeGoogleDriveManifest(accessToken, {
    ...state,
    manifest: {
      ...state.manifest,
      updatedAt: now(),
      vaults: [...state.manifest.vaults.filter((entry) => entry.id !== input.vaultId), record]
    }
  });

  return record;
}

export async function saveGoogleDriveRemoteEnvelope(
  accessToken: string,
  input: {
    vaultId: string;
    vaultName: string;
    envelope: SyncEnvelope | SyncSecureEnvelope;
    baseRevision?: string | null;
  }
) {
  let state = await readGoogleDriveV2VaultState(accessToken, input.vaultId, {
    migrateLegacy: true
  });

  if (
    Object.prototype.hasOwnProperty.call(input, "baseRevision") &&
    (state?.cursor ?? null) !== (input.baseRevision ?? null)
  ) {
    throw new Error("SYNC_REVISION_CONFLICT");
  }

  if (state) {
    const refreshedState = await readGoogleDriveV2VaultState(accessToken, input.vaultId, {
      migrateLegacy: true
    });

    if (!refreshedState || refreshedState.cursor !== state.cursor) {
      throw new Error("SYNC_REVISION_CONFLICT");
    }

    state = refreshedState;
  }
  const appliedCommitIds = state
    ? [...new Set(state.commits.map((commit) => commit.commitId))]
    : [];
  const checkpoint = await uploadGoogleDriveV2Checkpoint(accessToken, {
    schemaVersion: 2,
    provider: "googleDrive",
    recordType: "checkpoint",
    checkpointId: crypto.randomUUID(),
    vaultId: input.vaultId,
    vaultName: sanitizeText(input.vaultName, input.vaultId),
    vaultKind: input.envelope.metadata?.payloadMode === "encrypted" ? "private" : "regular",
    createdAt: now(),
    coveredCommitCount:
      (state?.checkpoint.coveredCommitCount ?? 0) + (state?.unappliedCommits.length ?? 0),
    appliedCommitIds,
    baseCursor: state?.cursor ?? null,
    envelope: input.envelope
  });
  const legacyRecord = await saveGoogleDriveLegacyRemoteEnvelope(accessToken, input);
  const commits = state?.commits ?? [];
  let revision = buildGoogleDriveV2Cursor(checkpoint, commits);

  if (state) {
    const retainedCommits = await cleanupGoogleDriveV2History(
      accessToken,
      {
        ...state,
        checkpoint,
        checkpoints: [...state.checkpoints, checkpoint],
        cursor: revision,
        unappliedCommits: []
      },
      checkpoint
    );
    revision = buildGoogleDriveV2Cursor(checkpoint, retainedCommits);
  }

  return {
    ...legacyRecord,
    updatedAt: checkpoint.createdAt,
    revision
  };
}

export async function appendGoogleDriveJournalEntry(
  accessToken: string,
  input: {
    vaultId: string;
    revision: string;
    baseRevision: string | null;
    changes?: SyncChangeSet | null;
    encryptedChanges?: SyncEncryptedPayload | null;
    fallbackDeviceId?: string;
  }
) {
  const record = await getRemoteVaultRecord(accessToken, input.vaultId);

  if (!record) {
    throw new Error("VAULT_NOT_FOUND");
  }

  const { journalFileId, entries } = await ensureGoogleDriveJournalState(accessToken, {
    id: input.vaultId,
    journalFileId: record.journalFileId ?? null
  });
  const nextEntry: GoogleDriveVaultJournalEntry = input.encryptedChanges
    ? {
        revision: input.revision,
        baseRevision: input.baseRevision,
        createdAt: now(),
        changes: null,
        encryptedChanges: input.encryptedChanges
      }
    : {
        revision: input.revision,
        baseRevision: input.baseRevision,
        createdAt: now(),
        changes: normalizeChangeSetPayload(
          input.changes,
          input.fallbackDeviceId ?? "google-drive"
        ),
        encryptedChanges: null
      };
  const nextJournal = [...entries.filter((entry) => entry.revision !== input.revision), nextEntry];
  const nextJournalFileId = await writeGoogleDriveJournalState(
    accessToken,
    {
      id: input.vaultId,
      journalFileId
    },
    nextJournal
  );

  if ((record.journalFileId ?? null) !== (nextJournalFileId ?? null)) {
    const state = await readGoogleDriveManifestState(accessToken);

    await writeGoogleDriveManifest(accessToken, {
      ...state,
      manifest: {
        ...state.manifest,
        updatedAt: now(),
        vaults: state.manifest.vaults.map((entry) =>
          entry.id === input.vaultId
            ? {
                ...entry,
                journalFileId: nextJournalFileId
              }
            : entry
        )
      }
    });
  }

  return nextJournalFileId;
}

export async function loadGoogleDriveRemoteChangeFeed(
  accessToken: string,
  vaultId: string,
  sinceRevision: string
) {
  const state = await readGoogleDriveV2VaultState(accessToken, vaultId, { migrateLegacy: true });

  if (!state) {
    throw new Error("VAULT_NOT_FOUND");
  }

  const envelope = await loadGoogleDriveRemoteEnvelope(accessToken, vaultId);

  if (!sinceRevision.trim()) {
    return buildSnapshotFallbackFeed(envelope);
  }

  if (sinceRevision === state.cursor) {
    return {
      mode: "delta",
      revision: state.cursor,
      baseRevision: sinceRevision,
      changes: envelope.metadata?.payloadMode === "encrypted" ? null : createEmptyChangeSet("google-drive"),
      encryptedChanges: envelope.metadata?.payloadMode === "encrypted" ? [] : null,
      snapshot: null,
      metadata: envelope.metadata ?? null
    } satisfies SyncChangeFeed;
  }

  // A cursor is a digest of the active checkpoint and all immutable commits.
  // If it differs, returning a complete snapshot is safer than guessing a
  // journal slice after retention or a concurrent-device branch.
  return buildSnapshotFallbackFeed(envelope);
}

export async function pushGoogleDriveRemoteChanges(
  accessToken: string,
  input: {
    vaultId: string;
    vaultName: string;
    baseRevision: string | null;
    envelope: SyncEnvelope | SyncSecureEnvelope;
    changes?: SyncChangeSet | null;
    encryptedChanges?: SyncEncryptedPayload | null;
  }
) {
  const state = await readGoogleDriveV2VaultState(accessToken, input.vaultId, {
    migrateLegacy: true
  });

  if (!state) {
    throw new Error("VAULT_NOT_FOUND");
  }

  const commitId = sanitizeText(
    input.envelope.revision,
    `rev-${now()}-${crypto.randomUUID()}`
  );
  const existingCommit = state.commits.find((commit) => commit.commitId === commitId) ?? null;

  if (state.cursor !== input.baseRevision && !existingCommit) {
    return {
      conflict: true as const,
      revision: state.cursor
    };
  }

  if (isEncryptedEnvelope(state.checkpoint.envelope)) {
    if (!input.encryptedChanges || !isEncryptedEnvelope(input.envelope)) {
      throw new Error("ENCRYPTED_DELTA_PAYLOAD_REQUIRED");
    }
  } else if (!input.changes || isEncryptedEnvelope(input.envelope)) {
    throw new Error("GOOGLE_DRIVE_DELTA_PAYLOAD_REQUIRED");
  }

  const commit = existingCommit ?? await uploadGoogleDriveV2Commit(accessToken, {
    schemaVersion: 2,
    provider: "googleDrive",
    recordType: "commit",
    commitId,
    vaultId: input.vaultId,
    vaultName: sanitizeText(input.vaultName, input.vaultId),
    vaultKind: isEncryptedEnvelope(input.envelope) ? "private" : "regular",
    baseCursor: input.baseRevision,
    createdAt: now(),
    changes: input.encryptedChanges ? null : normalizeChangeSetPayload(input.changes, "google-drive"),
    encryptedChanges: input.encryptedChanges ?? null,
    metadata: input.envelope.metadata ?? null
  });
  const refreshedState = await readGoogleDriveV2VaultState(accessToken, input.vaultId, {
    migrateLegacy: true
  });
  const expectedCommitIds = new Set([
    ...state.commits.map((entry) => entry.commitId),
    commit.commitId
  ]);
  const hasUnexpectedCommit = refreshedState?.commits.some(
    (entry) => !expectedCommitIds.has(entry.commitId)
  );

  if (
    !refreshedState ||
    refreshedState.checkpoint.checkpointId !== state.checkpoint.checkpointId ||
    hasUnexpectedCommit
  ) {
    return {
      conflict: true as const,
      revision: refreshedState?.cursor ?? state.cursor
    };
  }

  const commits = refreshedState.commits;
  const appliedCommitIds = [...new Set(commits.map((entry) => entry.commitId))];
  const checkpoint = await uploadGoogleDriveV2Checkpoint(accessToken, {
    schemaVersion: 2,
    provider: "googleDrive",
    recordType: "checkpoint",
    checkpointId: crypto.randomUUID(),
    vaultId: input.vaultId,
    vaultName: sanitizeText(input.vaultName, input.vaultId),
    vaultKind: isEncryptedEnvelope(input.envelope) ? "private" : "regular",
    createdAt: now(),
    coveredCommitCount:
      state.checkpoint.coveredCommitCount + state.unappliedCommits.length + (existingCommit ? 0 : 1),
    appliedCommitIds,
    baseCursor: input.baseRevision,
    envelope: input.envelope
  });
  let revision = buildGoogleDriveV2Cursor(checkpoint, commits);

  // Keep a readable legacy mirror during the migration window. New clients do
  // not use it for conflict resolution.
  await saveGoogleDriveLegacyRemoteEnvelope(accessToken, input);
  const retainedCommits = await cleanupGoogleDriveV2History(
    accessToken,
    {
      checkpoint,
      checkpoints: [...state.checkpoints, checkpoint],
      commits,
      unappliedCommits: [],
      cursor: revision
    },
    checkpoint
  );
  revision = buildGoogleDriveV2Cursor(checkpoint, retainedCommits);

  return {
    conflict: false as const,
    revision
  };
}

export function buildGoogleDriveConnectionLabel(session: Pick<GoogleDriveAccountSession, "userEmail" | "userName">) {
  return session.userEmail || session.userName || "Google Drive";
}

export function buildGoogleDriveBindingToken() {
  return GOOGLE_DRIVE_BINDING_TOKEN;
}

export async function probeGoogleDriveConnection(connection: Pick<SyncConnection, "sessionToken">) {
  if (!connection.sessionToken.trim()) {
    return "authError" as const;
  }

  try {
    await listGoogleDriveRemoteVaults(connection.sessionToken.trim());
    return "available" as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : "GOOGLE_DRIVE_AUTH_REQUIRED";
    return ["GOOGLE_DRIVE_AUTH_REQUIRED", "GOOGLE_DRIVE_INTERACTION_REQUIRED"].includes(message)
      ? ("authError" as const)
      : ("unavailable" as const);
  }
}
