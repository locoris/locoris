import { translateInline } from "../localization/translateInline";
import { getResolvedTimeZone } from "../localization/formatters";
import Dexie, { type EntityTable } from "dexie";

import {
  COLOR_PALETTE,
  DEFAULT_FOLDER_COLOR,
  DEFAULT_NOTE_COLOR,
  DEFAULT_PROJECT_COLOR
} from "../lib/palette";
import {
  buildExcerpt,
  extractPlainText,
  extractReferencedAssetIds,
  getFolderCascade,
  normalizeNoteContent,
  remapReferencedAssetIds
} from "../lib/notes";
import {
  buildCanvasExcerpt,
  createStarterCanvasContent,
  extractCanvasPlainText,
  extractCanvasReferencedFileIds,
  normalizeCanvasContent,
  remapCanvasFileIds
} from "../lib/canvas";
import { buildInitialDemoVault } from "./demoSeed";
import { normalizeTagLookup, normalizeTagName } from "../lib/tags";
import {
  buildLocalVaultDatabaseName,
  DEFAULT_LOCAL_VAULT_ID,
  getStoredActiveLocalVaultId
} from "../lib/localVaults";
import {
  deleteDesktopVaultBackup,
  writeDesktopVaultBackup
} from "../lib/desktopVaultBackups";
import {
  deleteNativeVaultSnapshot,
  readNativeVaultSnapshot,
  writeNativeVaultSnapshot
} from "../lib/nativeVaultStore";
import {
  APP_SETTINGS_SECRET_FIELDS,
  buildAppSettingsSecretKey,
  clearAppSettingsSecrets,
  hydrateAppSettingsSecrets,
  writeSecureSecret
} from "../lib/secureSecretStore";
import type {
  AppLanguage,
  AppSettings,
  Asset,
  AssetKind,
  CanvasContent,
  DesktopLocalVaultBackup,
  DesktopLocalVaultBackupAsset,
  Folder,
  Goal,
  Habit,
  HabitLog,
  LegacyAppSettings,
  Note,
  NoteContent,
  Project,
  SyncDirtyEntry,
  SyncEntityKind,
  SyncShadow,
  SyncSnapshot,
  SyncTombstone,
  SyncProvider,
  SyncedAssetRecord,
  SyncedNoteRecord,
  Tag,
  Task,
  TimeBlock
} from "../types";
import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";

const assetUrlCache = new Map<string, string>();
const NEWLY_UPLOADED_ASSET_PRUNE_GRACE_MS = 12_000;

function getSyncEntityKey(entityType: SyncEntityKind, entityId: string) {
  return `${entityType}:${entityId}`;
}

async function putSyncTombstone(entityType: SyncEntityKind, entityId: string, deletedAt = now()) {
  await db.syncTombstones.put({
    key: getSyncEntityKey(entityType, entityId),
    entityType,
    entityId,
    deletedAt
  });
  await putSyncDirtyEntry(entityType, entityId, deletedAt, true);
}

async function deleteSyncTombstone(entityType: SyncEntityKind, entityId: string) {
  await db.syncTombstones.delete(getSyncEntityKey(entityType, entityId));
}

function now() {
  return Date.now();
}

function createColor(colorPool: string[], seedIndex: number) {
  return colorPool[seedIndex % colorPool.length];
}

const NODE_COLORS = COLOR_PALETTE.map((entry) => entry.hex);
const SORT_ORDER_STEP = 1024;

function createDeviceId() {
  return `device-${crypto.randomUUID()}`;
}

function getSortableOrder(record: { sortOrder?: number; createdAt: number }) {
  return typeof record.sortOrder === "number" ? record.sortOrder : record.createdAt;
}

function getNextSortOrder(records: Array<{ sortOrder?: number; createdAt: number }>) {
  if (records.length === 0) {
    return SORT_ORDER_STEP;
  }

  return Math.max(...records.map((record) => getSortableOrder(record))) + SORT_ORDER_STEP;
}

function nextSyncState(currentSyncState: Note["syncState"] | undefined): Note["syncState"] {
  return currentSyncState === "conflict" ? "conflict" : "dirty";
}

function detectLanguage(): AppLanguage {
  if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("ru")) {
    return "ru";
  }

  return "en";
}

async function dataUrlToBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  return response.blob();
}

function getCanvasAssetName(fileId: string, mimeType: string) {
  const subtype = mimeType.split("/")[1] ?? "bin";
  return `canvas-${fileId.slice(0, 8)}.${subtype.replace(/[^a-z0-9]/gi, "") || "bin"}`;
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

function createSyncShadowRecord<T extends { id: string }>(
  entityType: SyncEntityKind,
  record: T,
  syncedAt: number,
  revision: string | null
) {
  return {
    key: getSyncEntityKey(entityType, record.id),
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

function buildSyncShadowEntries(snapshot: SyncSnapshot, revision: string | null) {
  const syncedAt = now();
  const shadows: SyncShadow[] = [];

  snapshot.projects.forEach((project) => {
    shadows.push(createSyncShadowRecord("project", project, syncedAt, revision));
  });

  snapshot.folders.forEach((folder) => {
    shadows.push(createSyncShadowRecord("folder", folder, syncedAt, revision));
  });

  snapshot.tags.forEach((tag) => {
    shadows.push(createSyncShadowRecord("tag", tag, syncedAt, revision));
  });

  snapshot.notes.forEach((note) => {
    shadows.push(createSyncShadowRecord("note", note, syncedAt, revision));
  });

  snapshot.assets.forEach((asset) => {
    shadows.push(createSyncShadowRecord("asset", asset, syncedAt, revision));
  });

  (snapshot.tasks ?? []).forEach((task) => {
    shadows.push(createSyncShadowRecord("task", task, syncedAt, revision));
  });

  (snapshot.habits ?? []).forEach((habit) => {
    shadows.push(createSyncShadowRecord("habit", habit, syncedAt, revision));
  });

  (snapshot.habitLogs ?? []).forEach((habitLog) => {
    shadows.push(createSyncShadowRecord("habitLog", habitLog, syncedAt, revision));
  });

  (snapshot.goals ?? []).forEach((goal) => {
    shadows.push(createSyncShadowRecord("goal", goal, syncedAt, revision));
  });

  (snapshot.timeBlocks ?? []).forEach((timeBlock) => {
    shadows.push(createSyncShadowRecord("timeBlock", timeBlock, syncedAt, revision));
  });

  snapshot.tombstones.forEach((tombstone) => {
    shadows.push(createSyncTombstoneShadow(tombstone, syncedAt, revision));
  });

  return shadows;
}

function base64ToBlob(base64: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function hydrateImportedAsset(record: SyncedAssetRecord): Asset {
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

function hydrateFolderRecord(record: Folder): Folder {
  return {
    ...record,
    color: record.color || DEFAULT_FOLDER_COLOR,
    sortOrder: record.sortOrder ?? record.createdAt
  };
}

function hydrateImportedNote(record: SyncedNoteRecord): Note {
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

function hydrateTaskRecord(record: Task): Task {
  return {
    ...record,
    tagIds: Array.isArray(record.tagIds) ? [...record.tagIds] : [],
    links: Array.isArray(record.links) ? [...record.links] : [],
    reminders: Array.isArray(record.reminders) ? [...record.reminders] : [],
    recurrenceExceptionDates: Array.isArray(record.recurrenceExceptionDates)
      ? [...record.recurrenceExceptionDates]
      : [],
    recurrenceCompletedDates: Array.isArray(record.recurrenceCompletedDates)
      ? [...record.recurrenceCompletedDates]
      : [],
    recurrenceOverrides: Array.isArray(record.recurrenceOverrides) ? [...record.recurrenceOverrides] : [],
    spentMinutes: record.spentMinutes ?? 0,
    sortOrder: record.sortOrder ?? record.createdAt
  };
}

function hydrateHabitRecord(record: Habit): Habit {
  return {
    ...record,
    reminders: Array.isArray(record.reminders) ? [...record.reminders] : [],
    targetCount: record.targetCount ?? 1,
    targetUnit: record.targetUnit ?? "count",
    targetPeriod: record.targetPeriod ?? "day",
    pauseRanges: Array.isArray(record.pauseRanges) ? [...record.pauseRanges] : [],
    sortOrder: record.sortOrder ?? record.createdAt
  };
}

function hydrateHabitLogRecord(record: HabitLog): HabitLog {
  return {
    ...record,
    value: record.value ?? 1,
    unit: record.unit ?? "count",
    note: record.note ?? ""
  };
}

function hydrateGoalRecord(record: Goal): Goal {
  return {
    ...record,
    sortOrder: record.sortOrder ?? record.createdAt
  };
}

function hydrateTimeBlockRecord(record: TimeBlock): TimeBlock {
  return {
    ...record,
    actualStartAt: record.actualStartAt ?? null,
    actualEndAt: record.actualEndAt ?? null
  };
}

function sortById<T extends { id: string }>(records: readonly T[]) {
  return [...records].sort((left, right) => left.id.localeCompare(right.id));
}

function sortByKey<T extends { key: string }>(records: readonly T[]) {
  return [...records].sort((left, right) => left.key.localeCompare(right.key));
}

const PLANNER_SYNC_ENTITY_KINDS = new Set<SyncEntityKind>([
  "task",
  "habit",
  "habitLog",
  "goal",
  "timeBlock"
]);

function hasPlannerBackupCollections(backup: DesktopLocalVaultBackup) {
  const candidate = backup as Partial<DesktopLocalVaultBackup>;

  return (
    Array.isArray(candidate.tasks) &&
    Array.isArray(candidate.habits) &&
    Array.isArray(candidate.habitLogs) &&
    Array.isArray(candidate.goals) &&
    Array.isArray(candidate.timeBlocks)
  );
}

function isPlannerSyncRecord(record: { entityType: SyncEntityKind }) {
  return PLANNER_SYNC_ENTITY_KINDS.has(record.entityType);
}

function mergeSyncRecordsByKey<T extends { key: string }>(records: readonly T[]) {
  const map = new Map<string, T>();

  records.forEach((record) => {
    map.set(record.key, record);
  });

  return sortByKey([...map.values()]);
}

async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function serializeDesktopBackupAsset(asset: Asset): Promise<DesktopLocalVaultBackupAsset> {
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

function hydrateDesktopBackupAsset(record: DesktopLocalVaultBackupAsset): Asset {
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

function hydrateDesktopBackupNote(record: Note): Note {
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
    color: record.color || DEFAULT_NOTE_COLOR,
    sortOrder: record.sortOrder ?? record.createdAt,
    content: normalizedContent,
    canvasContent: normalizedCanvas,
    excerpt,
    plainText,
    syncState: record.syncState ?? (record.conflictOriginId ? "conflict" : "local"),
    conflictOriginId: record.conflictOriginId ?? null
  };
}

function buildDefaultAppSettings(lastOpenedNoteId: string | null): AppSettings {
  return {
    id: "app",
    syncEnabled: false,
    syncStatus: "idle",
    syncProvider: "none",
    selfHostedUrl: "",
    selfHostedVaultId: "default",
    selfHostedToken: "",
    hostedUrl: "",
    hostedSessionToken: "",
    hostedUserId: null,
    hostedUserName: "",
    hostedUserEmail: "",
    hostedVaultId: "",
    hostedSyncToken: "",
    conflictStrategy: "duplicate",
    encryptionEnabled: false,
    encryptionVersion: null,
    encryptionKdf: null,
    encryptionIterations: null,
    encryptionKeyId: null,
    encryptionSalt: null,
    encryptionKeyCheck: null,
    encryptionUpdatedAt: null,
    lastSyncAt: null,
    syncCursor: null,
    localDeviceId: createDeviceId(),
    lastOpenedNoteId,
    plannerDefaultSurface: "planner",
    plannerWeekStartsOn: "monday",
    plannerDefaultCalendarView: "week"
  };
}

function normalizeAppSettings(settings: LegacyAppSettings): AppSettings {
  const { language: _legacyLanguage, ...currentSettings } = settings;

  return {
    ...currentSettings,
    plannerDefaultSurface: settings.plannerDefaultSurface ?? "planner",
    plannerWeekStartsOn: settings.plannerWeekStartsOn ?? "monday",
    plannerDefaultCalendarView: settings.plannerDefaultCalendarView ?? "week"
  };
}

function stripAppSettingsSecrets(settings: LegacyAppSettings | null | undefined): AppSettings | null {
  if (!settings) {
    return null;
  }

  return {
    ...normalizeAppSettings(settings),
    selfHostedToken: "",
    hostedSessionToken: "",
    hostedSyncToken: ""
  };
}

function splitAppSettingsSecretPatch(patch: Partial<Omit<AppSettings, "id">>) {
  const persistedPatch: Partial<Omit<AppSettings, "id">> = {
    ...patch
  };
  const secretPatch: Partial<Pick<AppSettings, (typeof APP_SETTINGS_SECRET_FIELDS)[number]>> = {};

  APP_SETTINGS_SECRET_FIELDS.forEach((field) => {
    if (field in persistedPatch) {
      secretPatch[field] = typeof patch[field] === "string" ? patch[field].trim() : "";
      delete persistedPatch[field];
    }
  });

  return {
    persistedPatch,
    secretPatch
  };
}

async function writeAppSettingsSecretPatch(
  localVaultId: string,
  patch: Partial<Pick<AppSettings, (typeof APP_SETTINGS_SECRET_FIELDS)[number]>>
) {
  await Promise.all(
    APP_SETTINGS_SECRET_FIELDS.map((field) =>
      field in patch
        ? writeSecureSecret(buildAppSettingsSecretKey(localVaultId, field), patch[field] ?? "")
        : Promise.resolve()
    )
  );
}

function createSyncDirtyEntry(
  entityType: SyncEntityKind,
  entityId: string,
  updatedAt = now(),
  deleted = false
) {
  return {
    key: getSyncEntityKey(entityType, entityId),
    entityType,
    entityId,
    updatedAt,
    deleted
  } satisfies SyncDirtyEntry;
}

async function putSyncDirtyEntry(
  entityType: SyncEntityKind,
  entityId: string,
  updatedAt = now(),
  deleted = false
) {
  await db.syncDirtyEntries.put(createSyncDirtyEntry(entityType, entityId, updatedAt, deleted));
}

async function putSyncDirtyEntries(entries: readonly SyncDirtyEntry[]) {
  if (entries.length === 0) {
    return;
  }

  await db.syncDirtyEntries.bulkPut([...entries]);
}

function hasStableValueChanged(previous: unknown, next: unknown) {
  return hashStableValue(previous) !== hashStableValue(next);
}

function isEntityPending(updatedAt: number, shadow: SyncShadow | undefined) {
  return !shadow || shadow.deleted || updatedAt > shadow.syncedAt;
}

function isTombstonePending(tombstone: SyncTombstone, shadow: SyncShadow | undefined) {
  return !shadow || !shadow.deleted || tombstone.deletedAt > shadow.syncedAt;
}

function buildSyncDirtyEntriesFromState(input: {
  projects: Project[];
  folders: Folder[];
  tags: Tag[];
  notes: Note[];
  assets: Asset[];
  tasks: Task[];
  habits: Habit[];
  habitLogs: HabitLog[];
  goals: Goal[];
  timeBlocks: TimeBlock[];
  shadows: SyncShadow[];
  tombstones: SyncTombstone[];
}) {
  const shadowsByKey = new Map(input.shadows.map((shadow) => [shadow.key, shadow]));
  const entries: SyncDirtyEntry[] = [];

  input.projects.forEach((project) => {
    if (isEntityPending(project.updatedAt, shadowsByKey.get(getSyncEntityKey("project", project.id)))) {
      entries.push(createSyncDirtyEntry("project", project.id, project.updatedAt));
    }
  });

  input.folders.forEach((folder) => {
    if (isEntityPending(folder.updatedAt, shadowsByKey.get(getSyncEntityKey("folder", folder.id)))) {
      entries.push(createSyncDirtyEntry("folder", folder.id, folder.updatedAt));
    }
  });

  input.tags.forEach((tag) => {
    if (isEntityPending(tag.updatedAt, shadowsByKey.get(getSyncEntityKey("tag", tag.id)))) {
      entries.push(createSyncDirtyEntry("tag", tag.id, tag.updatedAt));
    }
  });

  input.notes.forEach((note) => {
    if (isEntityPending(note.updatedAt, shadowsByKey.get(getSyncEntityKey("note", note.id)))) {
      entries.push(createSyncDirtyEntry("note", note.id, note.updatedAt));
    }
  });

  input.assets.forEach((asset) => {
    if (isEntityPending(asset.updatedAt, shadowsByKey.get(getSyncEntityKey("asset", asset.id)))) {
      entries.push(createSyncDirtyEntry("asset", asset.id, asset.updatedAt));
    }
  });

  input.tasks.forEach((task) => {
    if (isEntityPending(task.updatedAt, shadowsByKey.get(getSyncEntityKey("task", task.id)))) {
      entries.push(createSyncDirtyEntry("task", task.id, task.updatedAt));
    }
  });

  input.habits.forEach((habit) => {
    if (isEntityPending(habit.updatedAt, shadowsByKey.get(getSyncEntityKey("habit", habit.id)))) {
      entries.push(createSyncDirtyEntry("habit", habit.id, habit.updatedAt));
    }
  });

  input.habitLogs.forEach((habitLog) => {
    if (isEntityPending(habitLog.updatedAt, shadowsByKey.get(getSyncEntityKey("habitLog", habitLog.id)))) {
      entries.push(createSyncDirtyEntry("habitLog", habitLog.id, habitLog.updatedAt));
    }
  });

  input.goals.forEach((goal) => {
    if (isEntityPending(goal.updatedAt, shadowsByKey.get(getSyncEntityKey("goal", goal.id)))) {
      entries.push(createSyncDirtyEntry("goal", goal.id, goal.updatedAt));
    }
  });

  input.timeBlocks.forEach((timeBlock) => {
    if (isEntityPending(timeBlock.updatedAt, shadowsByKey.get(getSyncEntityKey("timeBlock", timeBlock.id)))) {
      entries.push(createSyncDirtyEntry("timeBlock", timeBlock.id, timeBlock.updatedAt));
    }
  });

  input.tombstones.forEach((tombstone) => {
    if (isTombstonePending(tombstone, shadowsByKey.get(tombstone.key))) {
      entries.push(createSyncDirtyEntry(tombstone.entityType, tombstone.entityId, tombstone.deletedAt, true));
    }
  });

  return entries.sort((left, right) => left.key.localeCompare(right.key));
}

export async function rebuildSyncDirtyEntriesFromCurrentState(
  database: LocorisDatabase = db
) {
  const [projects, folders, tags, notes, assets, tasks, habits, habitLogs, goals, timeBlocks, shadows, tombstones] =
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
      database.syncShadows.toArray(),
      database.syncTombstones.toArray()
    ]);
  const dirtyEntries = buildSyncDirtyEntriesFromState({
    projects,
    folders,
    tags,
    notes,
    assets,
    tasks,
    habits,
    habitLogs,
    goals,
    timeBlocks,
    shadows,
    tombstones
  });

  await database.transaction("rw", database.syncDirtyEntries, async () => {
    await database.syncDirtyEntries.clear();

    if (dirtyEntries.length > 0) {
      await database.syncDirtyEntries.bulkAdd(dirtyEntries);
    }
  });

  return dirtyEntries;
}

export class LocorisDatabase extends Dexie {
  projects!: EntityTable<Project, "id">;
  folders!: EntityTable<Folder, "id">;
  tags!: EntityTable<Tag, "id">;
  notes!: EntityTable<Note, "id">;
  assets!: EntityTable<Asset, "id">;
  tasks!: EntityTable<Task, "id">;
  habits!: EntityTable<Habit, "id">;
  habitLogs!: EntityTable<HabitLog, "id">;
  goals!: EntityTable<Goal, "id">;
  timeBlocks!: EntityTable<TimeBlock, "id">;
  settings!: EntityTable<AppSettings, "id">;
  syncDirtyEntries!: EntityTable<SyncDirtyEntry, "key">;
  syncShadows!: EntityTable<SyncShadow, "key">;
  syncTombstones!: EntityTable<SyncTombstone, "key">;

  constructor(name: string) {
    super(name);

    this.version(1).stores({
      projects: "id,updatedAt",
      folders: "id,parentId,updatedAt",
      tags: "id,name,updatedAt",
      notes: "id,folderId,*tagIds,updatedAt,createdAt,pinned,archived",
      assets: "id,noteId,updatedAt",
      settings: "id"
    });

    this.version(2)
      .stores({
        projects: "id,updatedAt",
        folders: "id,parentId,updatedAt",
        tags: "id,name,updatedAt",
        notes: "id,folderId,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId",
        assets: "id,noteId,updatedAt",
        settings: "id,syncProvider,syncStatus"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("notes")
          .toCollection()
          .modify((note) => {
            note.favorite ??= false;
            note.trashedAt ??= null;
            note.syncState ??= "local";
            note.conflictOriginId ??= null;
          });

        await transaction
          .table("settings")
          .toCollection()
          .modify((settings) => {
            settings.syncEnabled ??= false;
            settings.syncStatus ??= "disabled";
            settings.selfHostedToken ??= "";
            settings.conflictStrategy ??= "duplicate";
            settings.encryptionEnabled ??= false;
            settings.lastSyncAt ??= null;
            settings.localDeviceId ??= createDeviceId();
          });
      });

    this.version(3)
      .stores({
        projects: "id,updatedAt",
        folders: "id,parentId,updatedAt",
        tags: "id,name,updatedAt",
        notes: "id,folderId,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
        assets: "id,noteId,updatedAt",
        settings: "id,syncProvider,syncStatus"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("notes")
          .toCollection()
          .modify((note) => {
            note.color ??= DEFAULT_NOTE_COLOR;
          });
      });

    this.version(4)
      .stores({
        projects: "id,updatedAt",
        folders: "id,parentId,updatedAt",
        tags: "id,name,updatedAt",
        notes: "id,folderId,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
        assets: "id,noteId,updatedAt",
        settings: "id,syncProvider,syncStatus"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("folders")
          .toCollection()
          .modify((folder) => {
            folder.color ??= DEFAULT_FOLDER_COLOR;
          });

        await transaction
          .table("tags")
          .toCollection()
          .modify((tag) => {
            tag.color = "";
          });

        await transaction
          .table("notes")
          .toCollection()
          .modify((note) => {
            note.color ??= DEFAULT_NOTE_COLOR;
          });
      });

    this.version(5)
      .stores({
        projects: "id,updatedAt",
        folders: "id,projectId,parentId,updatedAt",
        tags: "id,name,updatedAt",
        notes:
          "id,projectId,folderId,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
        assets: "id,noteId,updatedAt",
        settings: "id,syncProvider,syncStatus"
      })
      .upgrade(async (transaction) => {
        const language = detectLanguage();
        const projectId = crypto.randomUUID();
        const timestamp = now();

        await transaction.table("projects").add({
          id: projectId,
          name: translateInline(language, "db.project1"),
          x: 0,
          y: 0,
          createdAt: timestamp,
          updatedAt: timestamp
        });

        await transaction
          .table("folders")
          .toCollection()
          .modify((folder) => {
            folder.projectId ??= projectId;
            folder.color ??= DEFAULT_FOLDER_COLOR;
          });

        await transaction
          .table("notes")
          .toCollection()
          .modify((note) => {
            note.projectId ??= projectId;
            note.color ??= DEFAULT_NOTE_COLOR;
          });
      });

    this.version(6)
      .stores({
        projects: "id,updatedAt",
        folders: "id,projectId,parentId,updatedAt",
        tags: "id,name,updatedAt",
        notes:
          "id,projectId,folderId,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
        assets: "id,noteId,updatedAt",
        settings: "id,syncProvider,syncStatus"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("projects")
          .toCollection()
          .modify((project) => {
            project.color ??= DEFAULT_PROJECT_COLOR;
          });
      });

    this.version(7)
      .stores({
        projects: "id,updatedAt",
        folders: "id,projectId,parentId,updatedAt",
        tags: "id,name,updatedAt",
        notes:
          "id,projectId,contentType,folderId,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
        assets: "id,noteId,updatedAt",
        settings: "id,syncProvider,syncStatus"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("notes")
          .toCollection()
          .modify((note) => {
            note.contentType ??= "note";
            note.canvasContent ??= null;
          });

        await transaction
          .table("assets")
          .toCollection()
          .modify((asset) => {
            asset.version ??= 0;
          });
      });

    this.version(8)
      .stores({
        projects: "id,updatedAt",
        folders: "id,projectId,parentId,updatedAt",
        tags: "id,name,updatedAt",
        notes:
          "id,projectId,contentType,folderId,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
        assets: "id,noteId,updatedAt",
        settings: "id,syncProvider,syncStatus,syncCursor",
        syncShadows: "key,entityType,entityId",
        syncTombstones: "key,entityType,entityId,deletedAt"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("settings")
          .toCollection()
          .modify((settings) => {
            settings.syncCursor ??= null;
          });
      });

    this.version(9)
      .stores({
        projects: "id,updatedAt",
        folders: "id,projectId,parentId,updatedAt",
        tags: "id,name,updatedAt",
        notes:
          "id,projectId,contentType,folderId,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
        assets: "id,noteId,updatedAt",
        settings: "id,syncProvider,syncStatus,syncCursor,selfHostedVaultId",
        syncShadows: "key,entityType,entityId",
        syncTombstones: "key,entityType,entityId,deletedAt"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("settings")
          .toCollection()
          .modify((settings) => {
            settings.selfHostedVaultId ??= "default";
          });
      });

    this.version(10)
      .stores({
        projects: "id,updatedAt",
        folders: "id,projectId,parentId,updatedAt",
        tags: "id,name,updatedAt",
        notes:
          "id,projectId,contentType,folderId,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
        assets: "id,noteId,updatedAt",
        settings:
          "id,syncProvider,syncStatus,syncCursor,selfHostedVaultId,hostedVaultId,hostedUserId",
        syncShadows: "key,entityType,entityId",
        syncTombstones: "key,entityType,entityId,deletedAt"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("settings")
          .toCollection()
          .modify((settings) => {
            settings.hostedUrl ??= "";
            settings.hostedSessionToken ??= "";
            settings.hostedUserId ??= null;
            settings.hostedUserName ??= "";
            settings.hostedUserEmail ??= "";
            settings.hostedVaultId ??= "";
            settings.hostedSyncToken ??= "";
          });
      });

    this.version(11)
      .stores({
        projects: "id,updatedAt",
        folders: "id,projectId,parentId,updatedAt",
        tags: "id,name,updatedAt",
        notes:
          "id,projectId,contentType,folderId,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
        assets: "id,noteId,updatedAt",
        settings:
          "id,syncProvider,syncStatus,syncCursor,selfHostedVaultId,hostedVaultId,hostedUserId",
        syncDirtyEntries: "key,entityType,entityId,updatedAt,deleted",
        syncShadows: "key,entityType,entityId",
        syncTombstones: "key,entityType,entityId,deletedAt"
      })
      .upgrade(async (transaction) => {
        const [projects, folders, tags, notes, assets, shadows, tombstones] = await Promise.all([
          transaction.table("projects").toArray(),
          transaction.table("folders").toArray(),
          transaction.table("tags").toArray(),
          transaction.table("notes").toArray(),
          transaction.table("assets").toArray(),
          transaction.table("syncShadows").toArray(),
          transaction.table("syncTombstones").toArray()
        ]);
        const dirtyEntries = buildSyncDirtyEntriesFromState({
          projects,
          folders,
          tags,
          notes,
          assets,
          tasks: [],
          habits: [],
          habitLogs: [],
          goals: [],
          timeBlocks: [],
          shadows,
          tombstones
        });

        if (dirtyEntries.length > 0) {
          await transaction.table("syncDirtyEntries").bulkPut(dirtyEntries);
        }
      });

    this.version(12)
      .stores({
        projects: "id,updatedAt",
        folders: "id,projectId,parentId,updatedAt",
        tags: "id,name,updatedAt",
        notes:
          "id,projectId,contentType,folderId,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
        assets: "id,noteId,updatedAt",
        settings:
          "id,syncProvider,syncStatus,syncCursor,selfHostedVaultId,hostedVaultId,hostedUserId,encryptionKeyId",
        syncDirtyEntries: "key,entityType,entityId,updatedAt,deleted",
        syncShadows: "key,entityType,entityId",
        syncTombstones: "key,entityType,entityId,deletedAt"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("settings")
          .toCollection()
          .modify((settings) => {
            settings.encryptionVersion ??= null;
            settings.encryptionKdf ??= null;
            settings.encryptionIterations ??= null;
            settings.encryptionKeyId ??= null;
            settings.encryptionSalt ??= null;
            settings.encryptionKeyCheck ??= null;
            settings.encryptionUpdatedAt ??= null;
          });
      });

    this.version(13)
      .stores({
        projects: "id,updatedAt",
        folders: "id,projectId,parentId,updatedAt",
        tags: "id,name,updatedAt",
        notes:
          "id,projectId,contentType,folderId,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
        assets: "id,noteId,updatedAt",
        settings:
          "id,syncProvider,syncStatus,syncCursor,selfHostedVaultId,hostedVaultId,hostedUserId,encryptionKeyId",
        syncDirtyEntries: "key,entityType,entityId,updatedAt,deleted",
        syncShadows: "key,entityType,entityId",
        syncTombstones: "key,entityType,entityId,deletedAt"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("settings")
          .toCollection()
          .modify((settings) => {
            settings.encryptionVersion ??= null;
            settings.encryptionKdf ??= null;
            settings.encryptionIterations ??= null;
            settings.encryptionKeyId ??= null;
            settings.encryptionSalt ??= null;
            settings.encryptionKeyCheck ??= null;
            settings.encryptionUpdatedAt ??= null;
          });
      });

    this.version(14)
      .stores({
        projects: "id,updatedAt",
        folders: "id,projectId,parentId,sortOrder,updatedAt",
        tags: "id,name,updatedAt",
        notes:
          "id,projectId,contentType,folderId,sortOrder,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
        assets: "id,noteId,updatedAt",
        settings:
          "id,syncProvider,syncStatus,syncCursor,selfHostedVaultId,hostedVaultId,hostedUserId,encryptionKeyId",
        syncDirtyEntries: "key,entityType,entityId,updatedAt,deleted",
        syncShadows: "key,entityType,entityId",
        syncTombstones: "key,entityType,entityId,deletedAt"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("folders")
          .toCollection()
          .modify((folder) => {
            folder.sortOrder ??= folder.createdAt ?? now();
          });

        await transaction
          .table("notes")
          .toCollection()
          .modify((note) => {
            note.sortOrder ??= note.createdAt ?? now();
          });
      });

    this.version(15)
      .stores({
        projects: "id,updatedAt",
        folders: "id,projectId,parentId,sortOrder,updatedAt",
        tags: "id,name,updatedAt",
        notes:
          "id,projectId,contentType,folderId,sortOrder,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
        assets: "id,noteId,updatedAt",
        settings:
          "id,syncProvider,syncStatus,syncCursor,selfHostedVaultId,hostedVaultId,hostedUserId,encryptionKeyId",
        syncDirtyEntries: "key,entityType,entityId,updatedAt,deleted",
        syncShadows: "key,entityType,entityId",
        syncTombstones: "key,entityType,entityId,deletedAt"
      })
      .upgrade(async (transaction) => {
        const projects = await transaction.table("projects").toArray();
        const orderedProjects = [...projects].sort(
          (left, right) =>
            (left.createdAt ?? 0) - (right.createdAt ?? 0) ||
            String(left.id).localeCompare(String(right.id))
        );
        const sortOrderById = new Map(
          orderedProjects.map((project, index) => [
            project.id,
            SORT_ORDER_STEP * (index + 1)
          ])
        );

        await transaction
          .table("projects")
          .toCollection()
          .modify((project) => {
            project.sortOrder ??= sortOrderById.get(project.id) ?? project.createdAt ?? SORT_ORDER_STEP;
          });
      });

    const plannerSchema = {
      projects: "id,updatedAt",
      folders: "id,projectId,parentId,sortOrder,updatedAt",
      tags: "id,name,updatedAt",
      notes:
        "id,projectId,contentType,folderId,sortOrder,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
      assets: "id,noteId,updatedAt",
      tasks:
        "id,projectId,folderId,noteId,canvasId,status,kind,priority,dueAt,scheduledStartAt,completedAt,sortOrder,updatedAt,*tagIds",
      habits: "id,projectId,noteId,status,sortOrder,updatedAt",
      habitLogs: "id,habitId,occurredAt,updatedAt",
      goals: "id,projectId,parentGoalId,status,dueAt,sortOrder,updatedAt",
      timeBlocks: "id,taskId,projectId,noteId,canvasId,status,startAt,endAt,updatedAt",
      settings:
        "id,syncProvider,syncStatus,syncCursor,selfHostedVaultId,hostedVaultId,hostedUserId,encryptionKeyId",
      syncDirtyEntries: "key,entityType,entityId,updatedAt,deleted",
      syncShadows: "key,entityType,entityId",
      syncTombstones: "key,entityType,entityId,deletedAt"
    };

    this.version(16).stores(plannerSchema);

    this.version(17)
      .stores(plannerSchema)
      .upgrade(async (transaction) => {
        await transaction
          .table("settings")
          .toCollection()
          .modify((settings) => {
            settings.plannerDefaultSurface ??= "planner";
            settings.plannerWeekStartsOn ??= "monday";
            settings.plannerDefaultCalendarView ??= "week";
          });
      });
  }
}

function createDatabaseForLocalVault(localVaultId: string) {
  return new LocorisDatabase(buildLocalVaultDatabaseName(localVaultId));
}

// Persistent desktop settings are hydrated asynchronously during bootstrap.
// Do not read the vault registry while modules are being evaluated: a fresh
// per-version WebView profile has no LocalStorage state yet, and localized
// fallback names require i18n to be initialized first.
export let db = createDatabaseForLocalVault(DEFAULT_LOCAL_VAULT_ID);

export function switchActiveLocalVaultDatabase(localVaultId: string) {
  db.close();
  db = createDatabaseForLocalVault(localVaultId);
}

export async function withLocalVaultDatabase<T>(
  localVaultId: string,
  callback: (database: LocorisDatabase) => Promise<T>
) {
  const activeLocalVaultId = getStoredActiveLocalVaultId();
  const isActive = localVaultId === activeLocalVaultId;
  const database = isActive ? db : createDatabaseForLocalVault(localVaultId);

  try {
    return await callback(database);
  } finally {
    if (!isActive) {
      database.close();
    }
  }
}

const desktopVaultPersistenceTimers = new Map<string, number>();
const desktopVaultPersistenceTasks = new Map<string, Promise<void>>();

function clearScheduledLocalVaultPersistence(localVaultId: string) {
  const timerId = desktopVaultPersistenceTimers.get(localVaultId);

  if (timerId !== undefined && typeof window !== "undefined") {
    window.clearTimeout(timerId);
  }

  desktopVaultPersistenceTimers.delete(localVaultId);
}

function scheduleLocalVaultPersistence(localVaultId: string, delayMs = 3_000) {
  if (typeof window === "undefined") {
    return;
  }

  clearScheduledLocalVaultPersistence(localVaultId);

  const timerId = window.setTimeout(() => {
    desktopVaultPersistenceTimers.delete(localVaultId);
    void persistLocalVaultStorage(localVaultId);
  }, delayMs);

  desktopVaultPersistenceTimers.set(localVaultId, timerId);
}

function scheduleActiveLocalVaultPersistence() {
  scheduleLocalVaultPersistence(getStoredActiveLocalVaultId());
}

function scheduleLocalVaultDesktopBackup(localVaultId: string) {
  scheduleLocalVaultPersistence(localVaultId);
}

function scheduleActiveLocalVaultDesktopBackup() {
  scheduleActiveLocalVaultPersistence();
}

function cloneSettingsForBackup(settings: LegacyAppSettings | null) {
  const sanitizedSettings = stripAppSettingsSecrets(settings);
  return sanitizedSettings ? { ...sanitizedSettings } : null;
}

export async function hasLocalVaultPersistedState(localVaultId: string) {
  return withLocalVaultDatabase(localVaultId, async (database) => {
    return Boolean(await database.settings.get("app"));
  });
}

export async function exportLocalVaultDesktopBackup(
  localVaultId: string
): Promise<DesktopLocalVaultBackup | null> {
  return withLocalVaultDatabase(localVaultId, async (database) => {
    const [
      projects,
      folders,
      tags,
      notes,
      assets,
      tasks,
      habits,
      habitLogs,
      goals,
      timeBlocks,
      settings,
      syncDirtyEntries,
      syncShadows,
      syncTombstones
    ] = await Promise.all([
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
      database.syncDirtyEntries.toArray(),
      database.syncShadows.toArray(),
      database.syncTombstones.toArray()
    ]);

    if (!settings) {
      return null;
    }

    return {
      schemaVersion: 1,
      localVaultId,
      savedAt: now(),
      projects: sortById(projects),
      folders: sortById(folders),
      tags: sortById(tags),
      notes: sortById(notes).map((note) => ({ ...note, tagIds: [...note.tagIds] })),
      assets: sortById(await Promise.all(assets.map((asset) => serializeDesktopBackupAsset(asset)))),
      tasks: sortById(tasks).map((task) => hydrateTaskRecord(task)),
      habits: sortById(habits).map((habit) => hydrateHabitRecord(habit)),
      habitLogs: sortById(habitLogs).map((habitLog) => hydrateHabitLogRecord(habitLog)),
      goals: sortById(goals).map((goal) => hydrateGoalRecord(goal)),
      timeBlocks: sortById(timeBlocks).map((timeBlock) => hydrateTimeBlockRecord(timeBlock)),
      settings: cloneSettingsForBackup(settings),
      syncDirtyEntries: sortByKey(syncDirtyEntries),
      syncShadows: sortByKey(syncShadows),
      syncTombstones: sortByKey(syncTombstones)
    } satisfies DesktopLocalVaultBackup;
  });
}

export async function restoreLocalVaultDesktopBackup(
  localVaultId: string,
  backup: DesktopLocalVaultBackup,
  options?: {
    preserveMissingPlannerCollections?: boolean;
  }
) {
  return withLocalVaultDatabase(localVaultId, async (database) => {
    const hasPlannerCollections = hasPlannerBackupCollections(backup);
    const shouldPreserveMissingPlannerCollections = Boolean(options?.preserveMissingPlannerCollections);
    const isLegacyNativePlannerSnapshot = !hasPlannerCollections && shouldPreserveMissingPlannerCollections;
    const shouldRestorePlannerCollections = hasPlannerCollections || !shouldPreserveMissingPlannerCollections;
    const folders = sortById(backup.folders).map((folder) => hydrateFolderRecord(folder));
    const notes = sortById(backup.notes).map((note) => hydrateDesktopBackupNote(note));
    const assets = sortById(backup.assets).map((asset) => hydrateDesktopBackupAsset(asset));
    const tasks = shouldRestorePlannerCollections
      ? sortById(backup.tasks ?? []).map((task) => hydrateTaskRecord(task))
      : [];
    const habits = shouldRestorePlannerCollections
      ? sortById(backup.habits ?? []).map((habit) => hydrateHabitRecord(habit))
      : [];
    const habitLogs = shouldRestorePlannerCollections
      ? sortById(backup.habitLogs ?? []).map((habitLog) => hydrateHabitLogRecord(habitLog))
      : [];
    const goals = shouldRestorePlannerCollections
      ? sortById(backup.goals ?? []).map((goal) => hydrateGoalRecord(goal))
      : [];
    const timeBlocks = shouldRestorePlannerCollections
      ? sortById(backup.timeBlocks ?? []).map((timeBlock) => hydrateTimeBlockRecord(timeBlock))
      : [];
    const backupSyncDirtyEntries = sortByKey(backup.syncDirtyEntries ?? []);
    const backupSyncShadows = sortByKey(backup.syncShadows ?? []);
    const backupSyncTombstones = sortByKey(backup.syncTombstones ?? []);
    const backupSettings = stripAppSettingsSecrets(backup.settings);
    const settings =
      backupSettings
        ? {
            ...backupSettings,
            syncCursor: isLegacyNativePlannerSnapshot ? null : backupSettings.syncCursor,
            lastOpenedNoteId:
              backupSettings.lastOpenedNoteId && notes.some((note) => note.id === backupSettings.lastOpenedNoteId)
                ? backupSettings.lastOpenedNoteId
                : notes[0]?.id ?? null
          }
        : buildDefaultAppSettings(notes[0]?.id ?? null);

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
        database.settings,
        database.syncDirtyEntries,
        database.syncShadows,
        database.syncTombstones
      ],
      async () => {
        let preservedPlannerDirtyEntries: SyncDirtyEntry[] = [];
        let preservedPlannerShadows: SyncShadow[] = [];
        let preservedPlannerTombstones: SyncTombstone[] = [];

        if (isLegacyNativePlannerSnapshot) {
          const currentPlannerEntityCounts = await Promise.all([
            database.tasks.count(),
            database.habits.count(),
            database.habitLogs.count(),
            database.goals.count(),
            database.timeBlocks.count()
          ]);
          const hasCurrentPlannerData = currentPlannerEntityCounts.some((count) => count > 0);

          if (!hasCurrentPlannerData) {
            preservedPlannerDirtyEntries = [];
            preservedPlannerShadows = [];
            preservedPlannerTombstones = [];
          } else {
            [preservedPlannerDirtyEntries, preservedPlannerShadows, preservedPlannerTombstones] = await Promise.all([
              database.syncDirtyEntries.filter((entry) => isPlannerSyncRecord(entry)).toArray(),
              database.syncShadows.filter((entry) => isPlannerSyncRecord(entry)).toArray(),
              database.syncTombstones.filter((entry) => isPlannerSyncRecord(entry)).toArray()
            ]);
          }
        }

        await database.projects.clear();
        await database.folders.clear();
        await database.tags.clear();
        await database.notes.clear();
        await database.assets.clear();
        if (shouldRestorePlannerCollections) {
          await database.tasks.clear();
          await database.habits.clear();
          await database.habitLogs.clear();
          await database.goals.clear();
          await database.timeBlocks.clear();
        }
        await database.settings.clear();
        await database.syncDirtyEntries.clear();
        await database.syncShadows.clear();
        await database.syncTombstones.clear();

        if (backup.projects.length > 0) {
          await database.projects.bulkAdd(sortById(backup.projects));
        }

        if (folders.length > 0) {
          await database.folders.bulkAdd(folders);
        }

        if (backup.tags.length > 0) {
          await database.tags.bulkAdd(sortById(backup.tags));
        }

        if (notes.length > 0) {
          await database.notes.bulkAdd(notes);
        }

        if (assets.length > 0) {
          await database.assets.bulkAdd(assets);
        }

        if (shouldRestorePlannerCollections && tasks.length > 0) {
          await database.tasks.bulkAdd(tasks);
        }

        if (shouldRestorePlannerCollections && habits.length > 0) {
          await database.habits.bulkAdd(habits);
        }

        if (shouldRestorePlannerCollections && habitLogs.length > 0) {
          await database.habitLogs.bulkAdd(habitLogs);
        }

        if (shouldRestorePlannerCollections && goals.length > 0) {
          await database.goals.bulkAdd(goals);
        }

        if (shouldRestorePlannerCollections && timeBlocks.length > 0) {
          await database.timeBlocks.bulkAdd(timeBlocks);
        }

        await database.settings.add(settings);

        const restoredSyncDirtyEntries = mergeSyncRecordsByKey([
          ...backupSyncDirtyEntries.filter((entry) => hasPlannerCollections || !isPlannerSyncRecord(entry)),
          ...preservedPlannerDirtyEntries
        ]);
        const restoredSyncShadows = mergeSyncRecordsByKey([
          ...backupSyncShadows.filter((entry) => hasPlannerCollections || !isPlannerSyncRecord(entry)),
          ...preservedPlannerShadows
        ]);
        const restoredSyncTombstones = mergeSyncRecordsByKey([
          ...backupSyncTombstones.filter((entry) => hasPlannerCollections || !isPlannerSyncRecord(entry)),
          ...preservedPlannerTombstones
        ]);

        if (restoredSyncDirtyEntries.length > 0) {
          await database.syncDirtyEntries.bulkAdd(restoredSyncDirtyEntries);
        }

        if (restoredSyncShadows.length > 0) {
          await database.syncShadows.bulkAdd(restoredSyncShadows);
        }

        if (restoredSyncTombstones.length > 0) {
          await database.syncTombstones.bulkAdd(restoredSyncTombstones);
        }
      }
    );

    if (isLegacyNativePlannerSnapshot) {
      scheduleLocalVaultDesktopBackup(localVaultId);
    }
  });
}

export async function persistLocalVaultDesktopBackup(localVaultId: string) {
  const backup = await exportLocalVaultDesktopBackup(localVaultId);

  if (!backup) {
    await deleteDesktopVaultBackup(localVaultId);
    return;
  }

  await writeDesktopVaultBackup(localVaultId, backup);
}

export async function persistAllLocalVaultDesktopBackups(localVaultIds: readonly string[]) {
  for (const localVaultId of localVaultIds) {
    await persistLocalVaultDesktopBackup(localVaultId);
  }
}

export async function readLocalVaultNativeSnapshot(localVaultId: string) {
  return readNativeVaultSnapshot(localVaultId);
}

export async function restoreLocalVaultNativeSnapshot(localVaultId: string) {
  const snapshot = await readNativeVaultSnapshot(localVaultId);

  if (!snapshot) {
    return false;
  }

  await restoreLocalVaultDesktopBackup(localVaultId, snapshot, {
    preserveMissingPlannerCollections: true
  });
  return true;
}

export async function persistLocalVaultNativeSnapshot(localVaultId: string) {
  const backup = await exportLocalVaultDesktopBackup(localVaultId);

  if (!backup) {
    await deleteNativeVaultSnapshot(localVaultId);
    return;
  }

  await writeNativeVaultSnapshot(localVaultId, backup);
}

export async function persistAllLocalVaultNativeSnapshots(localVaultIds: readonly string[]) {
  for (const localVaultId of localVaultIds) {
    await persistLocalVaultNativeSnapshot(localVaultId);
  }
}

export async function persistLocalVaultStorage(localVaultId: string) {
  const previousTask = desktopVaultPersistenceTasks.get(localVaultId) ?? Promise.resolve();
  const nextTask = previousTask
    .catch(() => undefined)
    .then(async () => {
      // IndexedDB is the live query store. The native SQLite copy is a durable
      // recovery checkpoint, while user-visible backups are created explicitly.
      // Avoid serializing every attachment twice after each small edit.
      await persistLocalVaultNativeSnapshot(localVaultId);
    });

  desktopVaultPersistenceTasks.set(localVaultId, nextTask);

  try {
    await nextTask;
  } finally {
    if (desktopVaultPersistenceTasks.get(localVaultId) === nextTask) {
      desktopVaultPersistenceTasks.delete(localVaultId);
    }
  }
}

export async function persistAllLocalVaultStorage(localVaultIds: readonly string[]) {
  for (const localVaultId of localVaultIds) {
    await persistLocalVaultStorage(localVaultId);
  }
}

export async function flushPendingLocalVaultStorage(localVaultIds: readonly string[]) {
  const uniqueLocalVaultIds = [...new Set(localVaultIds)];

  for (const localVaultId of uniqueLocalVaultIds) {
    clearScheduledLocalVaultPersistence(localVaultId);
  }

  await Promise.all(uniqueLocalVaultIds.map((localVaultId) => persistLocalVaultStorage(localVaultId)));
}

export async function ensureSeedData() {
  const existingSettings = await db.settings.get("app");

  if (existingSettings) {
    return;
  }

  const language = detectLanguage();
  const timestamp = now();
  const demoSeed = await buildInitialDemoVault(language, timestamp);

  await db.transaction(
    "rw",
    [
      db.projects,
      db.folders,
      db.tags,
      db.notes,
      db.tasks,
      db.habits,
      db.habitLogs,
      db.goals,
      db.timeBlocks,
      db.settings,
      db.syncDirtyEntries
    ],
    async () => {
      await db.projects.add(demoSeed.project);
      await db.folders.bulkAdd(demoSeed.folders);
      await db.tags.bulkAdd(demoSeed.tags);
      await db.notes.bulkAdd(demoSeed.notes);
      await db.tasks.bulkAdd(demoSeed.tasks);
      await db.habits.bulkAdd(demoSeed.habits);
      await db.habitLogs.bulkAdd(demoSeed.habitLogs);
      await db.goals.bulkAdd(demoSeed.goals);
      await db.timeBlocks.bulkAdd(demoSeed.timeBlocks);
      await putSyncDirtyEntries([
        createSyncDirtyEntry("project", demoSeed.project.id, demoSeed.project.updatedAt),
        ...demoSeed.folders.map((folder) => createSyncDirtyEntry("folder", folder.id, folder.updatedAt)),
        ...demoSeed.tags.map((tag) => createSyncDirtyEntry("tag", tag.id, tag.updatedAt)),
        ...demoSeed.notes.map((note) => createSyncDirtyEntry("note", note.id, note.updatedAt)),
        ...demoSeed.tasks.map((task) => createSyncDirtyEntry("task", task.id, task.updatedAt)),
        ...demoSeed.habits.map((habit) => createSyncDirtyEntry("habit", habit.id, habit.updatedAt)),
        ...demoSeed.habitLogs.map((habitLog) => createSyncDirtyEntry("habitLog", habitLog.id, habitLog.updatedAt)),
        ...demoSeed.goals.map((goal) => createSyncDirtyEntry("goal", goal.id, goal.updatedAt)),
        ...demoSeed.timeBlocks.map((timeBlock) => createSyncDirtyEntry("timeBlock", timeBlock.id, timeBlock.updatedAt))
      ]);
      await db.settings.add({
        ...stripAppSettingsSecrets(buildDefaultAppSettings(demoSeed.activeNoteId))!,
        syncStatus: "disabled"
      });
    }
  );

  scheduleActiveLocalVaultDesktopBackup();
}

export async function repairDerivedNoteText() {
  const notes = await db.notes.toArray();
  const updates = notes
    .map((note) => {
      const normalizedContent = normalizeNoteContent(note.content);
      const normalizedCanvas = note.canvasContent ? normalizeCanvasContent(note.canvasContent) : null;
      const excerpt =
        note.contentType === "canvas"
          ? buildCanvasExcerpt(normalizedCanvas)
          : buildExcerpt(normalizedContent);
      const plainText =
        note.contentType === "canvas"
          ? extractCanvasPlainText(normalizedCanvas)
          : extractPlainText(normalizedContent);

      if (note.excerpt === excerpt && note.plainText === plainText) {
        return null;
      }

      return {
        id: note.id,
        excerpt,
        plainText
      };
    })
    .filter((update): update is { id: string; excerpt: string; plainText: string } => Boolean(update));

  if (updates.length === 0) {
    return false;
  }

  await db.transaction("rw", db.notes, async () => {
    await Promise.all(
      updates.map((update) =>
        db.notes.update(update.id, {
          excerpt: update.excerpt,
          plainText: update.plainText
        })
      )
    );
  });
  scheduleActiveLocalVaultDesktopBackup();
  return true;
}

export async function patchSettings(patch: Partial<Omit<AppSettings, "id">>) {
  const activeLocalVaultId = getStoredActiveLocalVaultId();
  const { persistedPatch, secretPatch } = splitAppSettingsSecretPatch(patch);

  await writeAppSettingsSecretPatch(activeLocalVaultId, secretPatch);

  if (Object.keys(persistedPatch).length > 0) {
    await db.settings.update("app", persistedPatch);
  }

  scheduleActiveLocalVaultDesktopBackup();
}

export async function resetSyncBinding() {
  await db.transaction("rw", [db.syncShadows, db.settings, db.notes], async () => {
    await db.syncShadows.clear();
    await db.settings.update("app", {
      syncCursor: null,
      lastSyncAt: null,
      syncStatus: "idle"
    });

    await db.notes.toCollection().modify((note) => {
      if (note.syncState !== "conflict") {
        note.syncState = "local";
      }
    });
  });

  scheduleActiveLocalVaultDesktopBackup();
}

export async function readLocalVaultSettings(localVaultId: string) {
  return withLocalVaultDatabase(localVaultId, async (database) => {
    return hydrateAppSettingsSecrets(
      localVaultId,
      stripAppSettingsSecrets((await database.settings.get("app")) ?? null)
    );
  });
}

export async function consumeLegacyLocalVaultLanguage(localVaultId: string) {
  return withLocalVaultDatabase(localVaultId, async (database) => {
    const settings = await database.settings.get("app") as LegacyAppSettings | undefined;
    const legacyLanguage = typeof settings?.language === "string" ? settings.language : null;

    if (settings && "language" in settings) {
      await database.settings.put(normalizeAppSettings(settings));
      scheduleLocalVaultDesktopBackup(localVaultId);
    }

    return legacyLanguage;
  });
}

export async function ensureLocalVaultSettingsRecord(
  localVaultId: string,
  options?: {
    lastOpenedNoteId?: string | null;
  }
) {
  return withLocalVaultDatabase(localVaultId, async (database) => {
    const existingSettings = await database.settings.get("app");

    if (existingSettings) {
      return existingSettings;
    }

    const nextSettings = {
      ...stripAppSettingsSecrets(
        buildDefaultAppSettings(options?.lastOpenedNoteId ?? null)
      )!,
      syncStatus: "disabled" as const
    };

    await database.settings.add(nextSettings);
    scheduleLocalVaultDesktopBackup(localVaultId);
    return nextSettings;
  });
}

export async function patchLocalVaultSettings(
  localVaultId: string,
  patch: Partial<Omit<AppSettings, "id">>
) {
  const { persistedPatch, secretPatch } = splitAppSettingsSecretPatch(patch);

  await writeAppSettingsSecretPatch(localVaultId, secretPatch);

  await withLocalVaultDatabase(localVaultId, async (database) => {
    if (Object.keys(persistedPatch).length > 0) {
      await database.settings.update("app", persistedPatch);
    }
  });

  scheduleLocalVaultDesktopBackup(localVaultId);
}

export async function writeImportedVaultSnapshot(
  localVaultId: string,
  input: {
    snapshot: SyncSnapshot;
    revision: string | null;
  }
) {
  await withLocalVaultDatabase(localVaultId, async (database) => {
    const existingSettings = stripAppSettingsSecrets(await database.settings.get("app"));
    const folders = input.snapshot.folders.map((folder) => hydrateFolderRecord(folder));
    const notes = input.snapshot.notes.map((note) => hydrateImportedNote(note));
    const assets = input.snapshot.assets.map((asset) => hydrateImportedAsset(asset));
    const tasks = (input.snapshot.tasks ?? []).map((task) => hydrateTaskRecord(task));
    const habits = (input.snapshot.habits ?? []).map((habit) => hydrateHabitRecord(habit));
    const habitLogs = (input.snapshot.habitLogs ?? []).map((habitLog) => hydrateHabitLogRecord(habitLog));
    const goals = (input.snapshot.goals ?? []).map((goal) => hydrateGoalRecord(goal));
    const timeBlocks = (input.snapshot.timeBlocks ?? []).map((timeBlock) => hydrateTimeBlockRecord(timeBlock));
    const shadows = buildSyncShadowEntries(input.snapshot, input.revision);
    const nextOpenedNoteId =
      existingSettings?.lastOpenedNoteId && notes.some((note) => note.id === existingSettings.lastOpenedNoteId)
        ? existingSettings.lastOpenedNoteId
        : notes[0]?.id ?? null;

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
        database.settings,
        database.syncDirtyEntries,
        database.syncShadows,
        database.syncTombstones
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
        await database.syncDirtyEntries.clear();
        await database.syncShadows.clear();
        await database.syncTombstones.clear();

        if (input.snapshot.projects.length > 0) {
          await database.projects.bulkAdd(input.snapshot.projects);
        }

        if (folders.length > 0) {
          await database.folders.bulkAdd(folders);
        }

        if (input.snapshot.tags.length > 0) {
          await database.tags.bulkAdd(input.snapshot.tags);
        }

        if (notes.length > 0) {
          await database.notes.bulkAdd(notes);
        }

        if (assets.length > 0) {
          await database.assets.bulkAdd(assets);
        }

        if (tasks.length > 0) {
          await database.tasks.bulkAdd(tasks);
        }

        if (habits.length > 0) {
          await database.habits.bulkAdd(habits);
        }

        if (habitLogs.length > 0) {
          await database.habitLogs.bulkAdd(habitLogs);
        }

        if (goals.length > 0) {
          await database.goals.bulkAdd(goals);
        }

        if (timeBlocks.length > 0) {
          await database.timeBlocks.bulkAdd(timeBlocks);
        }

        if (input.snapshot.tombstones.length > 0) {
          await database.syncTombstones.bulkAdd(input.snapshot.tombstones);
        }

        if (shadows.length > 0) {
          await database.syncShadows.bulkAdd(shadows);
        }

        const nextSettings = {
          ...(existingSettings ?? stripAppSettingsSecrets(buildDefaultAppSettings(nextOpenedNoteId))!),
          syncStatus: "idle" as const,
          lastSyncAt: now(),
          syncCursor: input.revision,
          lastOpenedNoteId: nextOpenedNoteId
        };

        if (existingSettings) {
          await database.settings.put(nextSettings);
        } else {
          await database.settings.add(nextSettings);
        }
      }
    );
  });

  scheduleLocalVaultDesktopBackup(localVaultId);
}

export async function resetLocalVaultSyncBinding(localVaultId: string) {
  await clearAppSettingsSecrets(localVaultId);

  await withLocalVaultDatabase(localVaultId, async (database) => {
    await database.transaction("rw", [database.syncShadows, database.settings, database.notes], async () => {
      await database.syncShadows.clear();
      await database.settings.update("app", {
        syncCursor: null,
        lastSyncAt: null,
        syncStatus: "idle",
        syncEnabled: false,
        syncProvider: "none",
        selfHostedUrl: "",
        selfHostedVaultId: "default",
        selfHostedToken: "",
        hostedVaultId: "",
        hostedSyncToken: ""
      });

      await database.notes.toCollection().modify((note) => {
        if (note.syncState !== "conflict") {
          note.syncState = "local";
        }
      });
    });
  });

  scheduleLocalVaultDesktopBackup(localVaultId);
}

export async function sanitizePersistedLocalVaultSecrets(localVaultIds: readonly string[]) {
  const normalizedLocalVaultIds = [...new Set(localVaultIds.map((localVaultId) => localVaultId.trim()).filter(Boolean))];
  const updatedLocalVaultIds: string[] = [];

  for (const localVaultId of normalizedLocalVaultIds) {
    await withLocalVaultDatabase(localVaultId, async (database) => {
      const settings = await database.settings.get("app");

      if (!settings) {
        return;
      }

      if (
        !settings.selfHostedToken &&
        !settings.hostedSessionToken &&
        !settings.hostedSyncToken
      ) {
        return;
      }

      // Older builds stored these fields inside IndexedDB. Move each value to
      // the secure store first; never erase a credential before its protected
      // replacement has been written successfully.
      await Promise.all(
        APP_SETTINGS_SECRET_FIELDS.map((field) => {
          const value = settings[field];
          return value
            ? writeSecureSecret(buildAppSettingsSecretKey(localVaultId, field), value)
            : Promise.resolve();
        })
      );

      await database.settings.update("app", {
        selfHostedToken: "",
        hostedSessionToken: "",
        hostedSyncToken: ""
      });
      updatedLocalVaultIds.push(localVaultId);
    });
  }

  if (updatedLocalVaultIds.length > 0) {
    await persistAllLocalVaultStorage(updatedLocalVaultIds);
  }
}

export async function createProject(name: string, x: number, y: number, color?: string) {
  const timestamp = now();
  const projects = await db.projects.toArray();
  const count = projects.length;
  const project: Project = {
    id: crypto.randomUUID(),
    name,
    color: color ?? createColor(NODE_COLORS, count + 5),
    x,
    y,
    sortOrder: getNextSortOrder(projects),
    createdAt: timestamp,
    updatedAt: timestamp
  };

  await db.transaction("rw", [db.projects, db.syncDirtyEntries], async () => {
    await db.projects.add(project);
    await putSyncDirtyEntry("project", project.id, timestamp);
  });
  scheduleActiveLocalVaultDesktopBackup();
  return project;
}

export async function updateProjectPosition(projectId: string, x: number, y: number) {
  const project = await db.projects.get(projectId);

  if (!project || (project.x === x && project.y === y)) {
    return false;
  }

  const timestamp = now();
  await db.transaction("rw", [db.projects, db.syncDirtyEntries], async () => {
    await db.projects.update(projectId, {
      x,
      y,
      updatedAt: timestamp
    });
    await putSyncDirtyEntry("project", projectId, timestamp);
  });
  scheduleActiveLocalVaultDesktopBackup();
  return true;
}

export async function updateProjectSortOrder(projectId: string, sortOrder: number) {
  const project = await db.projects.get(projectId);

  if (!project || project.sortOrder === sortOrder) {
    return false;
  }

  const timestamp = now();
  await db.transaction("rw", [db.projects, db.syncDirtyEntries], async () => {
    await db.projects.update(projectId, {
      sortOrder,
      updatedAt: timestamp
    });
    await putSyncDirtyEntry("project", projectId, timestamp);
  });
  scheduleActiveLocalVaultDesktopBackup();
  return true;
}

export async function updateProjectColor(projectId: string, color: string) {
  const project = await db.projects.get(projectId);

  if (!project || project.color === color) {
    return false;
  }

  const timestamp = now();
  await db.transaction("rw", [db.projects, db.syncDirtyEntries], async () => {
    await db.projects.update(projectId, {
      color,
      updatedAt: timestamp
    });
    await putSyncDirtyEntry("project", projectId, timestamp);
  });
  scheduleActiveLocalVaultDesktopBackup();
  return true;
}

export async function renameProject(projectId: string, name: string) {
  const project = await db.projects.get(projectId);

  if (!project || project.name === name) {
    return false;
  }

  const timestamp = now();
  await db.transaction("rw", [db.projects, db.syncDirtyEntries], async () => {
    await db.projects.update(projectId, {
      name,
      updatedAt: timestamp
    });
    await putSyncDirtyEntry("project", projectId, timestamp);
  });
  scheduleActiveLocalVaultDesktopBackup();
  return true;
}

export async function removeProject(projectId: string) {
  const [folders, notes, assets] = await Promise.all([
    db.folders.where("projectId").equals(projectId).toArray(),
    db.notes.where("projectId").equals(projectId).toArray(),
    db.assets.toArray()
  ]);
  const timestamp = now();
  const noteIds = new Set(notes.map((note) => note.id));
  const projectAssetIds = assets
    .filter((asset) => noteIds.has(asset.noteId))
    .map((asset) => asset.id);

  await db.transaction(
    "rw",
    [db.projects, db.folders, db.notes, db.assets, db.syncTombstones, db.syncDirtyEntries],
    async () => {
    await db.projects.delete(projectId);
    await putSyncTombstone("project", projectId, timestamp);

    const folderIds = folders.map((folder) => folder.id);

    if (folderIds.length > 0) {
      await db.folders.bulkDelete(folderIds);
      await Promise.all(
        folderIds.map((folderId) => putSyncTombstone("folder", folderId, timestamp))
      );
    }

    if (notes.length > 0) {
      await db.notes.bulkDelete(notes.map((note) => note.id));
      await Promise.all(
        notes.map((note) => putSyncTombstone("note", note.id, timestamp))
      );
    }

    if (projectAssetIds.length > 0) {
      projectAssetIds.forEach((assetId) => {
        const cachedUrl = assetUrlCache.get(assetId);

        if (cachedUrl) {
          URL.revokeObjectURL(cachedUrl);
          assetUrlCache.delete(assetId);
        }
      });

      await db.assets.bulkDelete(projectAssetIds);
      await Promise.all(
        projectAssetIds.map((assetId) => putSyncTombstone("asset", assetId, timestamp))
      );
    }
    }
  );

  scheduleActiveLocalVaultDesktopBackup();
}

async function getNextHierarchySortOrder(projectId: string, parentId: string | null) {
  const [siblingFolders, siblingNotes] = await Promise.all([
    db.folders.toArray(),
    db.notes.toArray()
  ]);
  const scopedSiblings = [
    ...siblingFolders.filter(
      (folder) => folder.projectId === projectId && folder.parentId === parentId
    ),
    ...siblingNotes.filter(
      (note) =>
        note.projectId === projectId && note.folderId === parentId && note.trashedAt === null
    )
  ];

  return getNextSortOrder(scopedSiblings);
}

export async function createFolder(
  name: string,
  parentId: string | null,
  color?: string,
  projectId?: string
) {
  const timestamp = now();
  const count = await db.folders.count();
  let resolvedProjectId = projectId ?? null;

  if (parentId) {
    const parentFolder = await db.folders.get(parentId);

    if (parentFolder?.parentId) {
      throw new Error("FOLDER_DEPTH_LIMIT");
    }

    resolvedProjectId = parentFolder?.projectId ?? null;
  }

  if (!resolvedProjectId) {
    throw new Error("PROJECT_REQUIRED");
  }

  const sortOrder = await getNextHierarchySortOrder(resolvedProjectId, parentId);

  const folder: Folder = {
    id: crypto.randomUUID(),
    projectId: resolvedProjectId,
    name,
    parentId,
    color: color ?? createColor(NODE_COLORS, count),
    sortOrder,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  await db.transaction("rw", [db.folders, db.syncDirtyEntries], async () => {
    await db.folders.add(folder);
    await putSyncDirtyEntry("folder", folder.id, timestamp);
  });
  scheduleActiveLocalVaultDesktopBackup();
  return folder;
}

export async function renameFolder(folderId: string, name: string) {
  const folder = await db.folders.get(folderId);

  if (!folder || folder.name === name) {
    return false;
  }

  const timestamp = now();
  await db.transaction("rw", [db.folders, db.syncDirtyEntries], async () => {
    await db.folders.update(folderId, {
      name,
      updatedAt: timestamp
    });
    await putSyncDirtyEntry("folder", folderId, timestamp);
  });
  scheduleActiveLocalVaultDesktopBackup();
  return true;
}

export async function updateFolderColor(folderId: string, color: string) {
  const folder = await db.folders.get(folderId);

  if (!folder || folder.color === color) {
    return false;
  }

  const timestamp = now();
  await db.transaction("rw", [db.folders, db.syncDirtyEntries], async () => {
    await db.folders.update(folderId, {
      color,
      updatedAt: timestamp
    });
    await putSyncDirtyEntry("folder", folderId, timestamp);
  });
  scheduleActiveLocalVaultDesktopBackup();
  return true;
}

export async function removeFolder(folderId: string) {
  const folders = await db.folders.toArray();
  const notes = await db.notes.toArray();
  const cascade = getFolderCascade(folderId, folders, notes);
  const timestamp = now();

  await db.transaction("rw", db.folders, db.notes, db.syncTombstones, db.syncDirtyEntries, async () => {
    await db.folders.bulkDelete(cascade.folderIds);
    await Promise.all(cascade.folderIds.map((currentFolderId) => putSyncTombstone("folder", currentFolderId, timestamp)));

    await Promise.all(
      cascade.noteIds.map((noteId) =>
        db.notes.update(noteId, {
          folderId: null,
          trashedAt: timestamp,
          archived: false,
          updatedAt: timestamp,
          syncState: "dirty"
        })
      )
    );

    await putSyncDirtyEntries(
      cascade.noteIds.map((noteId) => createSyncDirtyEntry("note", noteId, timestamp))
    );
  });

  scheduleActiveLocalVaultDesktopBackup();
}

export async function inspectFolderRemoval(folderId: string) {
  const folders = await db.folders.toArray();
  const notes = await db.notes.toArray();
  const cascade = getFolderCascade(folderId, folders, notes);

  return {
    folderCount: cascade.folderIds.length,
    noteCount: cascade.noteIds.length
  };
}

function collectDescendantFolderIds(folderId: string, folders: readonly Folder[]) {
  const descendants: string[] = [];
  const visit = (currentFolderId: string) => {
    folders
      .filter((folder) => folder.parentId === currentFolderId)
      .forEach((child) => {
        descendants.push(child.id);
        visit(child.id);
      });
  };

  visit(folderId);
  return descendants;
}

function resolveSiblingSortOrder(
  folders: readonly Folder[],
  notes: readonly Note[],
  projectId: string,
  parentId: string | null,
  excludeEntityIds: readonly string[],
  preferredSortOrder?: number
) {
  if (typeof preferredSortOrder === "number") {
    return preferredSortOrder;
  }

  const excluded = new Set(excludeEntityIds);
  return getNextSortOrder([
    ...folders.filter(
      (folder) =>
        folder.projectId === projectId &&
        folder.parentId === parentId &&
        !excluded.has(`folder:${folder.id}`)
    ),
    ...notes.filter(
      (note) =>
        note.projectId === projectId &&
        note.folderId === parentId &&
        note.trashedAt === null &&
        !excluded.has(`note:${note.id}`)
    )
  ]);
}

export async function moveFolder(
  folderId: string,
  parentId: string | null,
  projectId?: string,
  sortOrder?: number
) {
  const timestamp = now();
  let changed = false;

  await db.transaction("rw", db.folders, db.notes, db.syncDirtyEntries, async () => {
    const [folder, targetParent, folders, notes] = await Promise.all([
      db.folders.get(folderId),
      parentId ? db.folders.get(parentId) : Promise.resolve(null),
      db.folders.toArray(),
      db.notes.toArray()
    ]);

    if (!folder) {
      return;
    }

    if (parentId && !targetParent) {
      throw new Error("TARGET_FOLDER_NOT_FOUND");
    }

    if (parentId === folderId) {
      throw new Error("INVALID_FOLDER_MOVE");
    }

    const descendantFolderIds = collectDescendantFolderIds(folderId, folders);

    if (parentId && descendantFolderIds.includes(parentId)) {
      throw new Error("INVALID_FOLDER_MOVE");
    }

    if (targetParent?.parentId) {
      throw new Error("FOLDER_DEPTH_LIMIT");
    }

    if (parentId && descendantFolderIds.length > 0) {
      throw new Error("FOLDER_DEPTH_LIMIT");
    }

    const nextProjectId = targetParent?.projectId ?? projectId ?? folder.projectId;
    const nextSortOrder = resolveSiblingSortOrder(
      folders,
      notes,
      nextProjectId,
      parentId,
      [`folder:${folderId}`],
      sortOrder
    );

    const cascade = getFolderCascade(folderId, folders, notes);
    const folderIdsToUpdate = new Set(cascade.folderIds);
    const noteIdsToUpdate = new Set(cascade.noteIds);

    await Promise.all(
      [...folderIdsToUpdate].map((currentFolderId) => {
        const patch: Partial<Folder> = {
          projectId: nextProjectId,
          updatedAt: timestamp
        };

        if (currentFolderId === folderId) {
          patch.parentId = parentId;
          patch.sortOrder = nextSortOrder;
        }

        return db.folders.update(currentFolderId, patch);
      })
    );

    await Promise.all(
      [...noteIdsToUpdate].map((noteId) =>
        db.notes.update(noteId, {
          projectId: nextProjectId,
          updatedAt: timestamp,
          syncState: nextSyncState(notes.find((note) => note.id === noteId)?.syncState)
        })
      )
    );

    await putSyncDirtyEntries([
      ...[...folderIdsToUpdate].map((currentFolderId) =>
        createSyncDirtyEntry("folder", currentFolderId, timestamp)
      ),
      ...[...noteIdsToUpdate].map((noteId) => createSyncDirtyEntry("note", noteId, timestamp))
    ]);
    changed = true;
  });

  if (changed) {
    scheduleActiveLocalVaultDesktopBackup();
  }

  return changed;
}

export async function moveNote(
  noteId: string,
  folderId: string | null,
  projectId?: string,
  sortOrder?: number
) {
  const existingNote = await db.notes.get(noteId);
  const targetFolder = folderId ? await db.folders.get(folderId) : null;

  if (!existingNote) {
    return false;
  }

  if (folderId && !targetFolder) {
    throw new Error("TARGET_FOLDER_NOT_FOUND");
  }

  const nextProjectId = targetFolder?.projectId ?? projectId ?? existingNote.projectId;
  const nextSortOrder =
    typeof sortOrder === "number"
      ? sortOrder
      : await getNextHierarchySortOrder(nextProjectId, folderId);

  return updateNoteMeta(noteId, {
    projectId: nextProjectId,
    folderId,
    sortOrder: nextSortOrder
  });
}

function buildDuplicateTitle(title: string, suffix: string) {
  const normalizedTitle = title.trim();
  return normalizedTitle ? `${normalizedTitle} ${suffix}` : title;
}

async function cloneNoteRecord(
  note: Note,
  nextFolderId: string | null,
  nextProjectId: string,
  sortOrder: number,
  duplicateSuffix: string,
  timestamp: number
) {
  const nextNoteId = crypto.randomUUID();
  const sourceAssets = await db.assets.where("noteId").equals(note.id).toArray();
  const sourceAssetsById = new Map(sourceAssets.map((asset) => [asset.id, asset]));
  const referencedAssetIds =
    note.contentType === "canvas"
      ? extractCanvasReferencedFileIds(note.canvasContent)
      : extractReferencedAssetIds(note.content);
  const assetIdMap = new Map<string, string>();
  const clonedAssets: Asset[] = [];

  referencedAssetIds.forEach((assetId) => {
    const sourceAsset = sourceAssetsById.get(assetId);

    if (!sourceAsset) {
      return;
    }

    const nextAssetId = crypto.randomUUID();
    assetIdMap.set(assetId, nextAssetId);
    clonedAssets.push({
      ...sourceAsset,
      id: nextAssetId,
      noteId: nextNoteId,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  });

  const normalizedContent =
    note.contentType === "canvas"
      ? normalizeNoteContent(note.content)
      : remapReferencedAssetIds(normalizeNoteContent(note.content), assetIdMap);
  const normalizedCanvas =
    note.contentType === "canvas"
      ? remapCanvasFileIds(note.canvasContent, assetIdMap)
      : note.canvasContent
        ? normalizeCanvasContent(note.canvasContent)
        : null;
  const plainText =
    note.contentType === "canvas"
      ? extractCanvasPlainText(normalizedCanvas)
      : extractPlainText(normalizedContent);
  const excerpt =
    note.contentType === "canvas"
      ? buildCanvasExcerpt(normalizedCanvas)
      : buildExcerpt(normalizedContent);
  const nextNote: Note = {
    ...note,
    id: nextNoteId,
    title: buildDuplicateTitle(note.title, duplicateSuffix),
    projectId: nextProjectId,
    folderId: nextFolderId,
    sortOrder,
    tagIds: [...note.tagIds],
    content: normalizedContent,
    canvasContent: normalizedCanvas,
    excerpt,
    plainText,
    createdAt: timestamp,
    updatedAt: timestamp,
    pinned: false,
    favorite: false,
    archived: false,
    trashedAt: null,
    syncState: "local",
    conflictOriginId: null
  };

  return {
    note: nextNote,
    assets: clonedAssets
  };
}

export async function duplicateNote(
  noteId: string,
  folderId: string | null,
  projectId?: string,
  sortOrder?: number,
  duplicateSuffix = "copy"
) {
  const timestamp = now();
  const sourceNote = await db.notes.get(noteId);
  const targetFolder = folderId ? await db.folders.get(folderId) : null;

  if (!sourceNote) {
    return null;
  }

  if (folderId && !targetFolder) {
    throw new Error("TARGET_FOLDER_NOT_FOUND");
  }

  const nextProjectId = targetFolder?.projectId ?? projectId ?? sourceNote.projectId;
  const nextSortOrder =
    typeof sortOrder === "number"
      ? sortOrder
      : await getNextHierarchySortOrder(nextProjectId, folderId);
  const cloned = await cloneNoteRecord(
    sourceNote,
    folderId,
    nextProjectId,
    nextSortOrder,
    duplicateSuffix,
    timestamp
  );

  await db.transaction("rw", db.notes, db.assets, db.syncDirtyEntries, async () => {
    await db.notes.add(cloned.note);

    if (cloned.assets.length > 0) {
      await db.assets.bulkAdd(cloned.assets);
    }

    await putSyncDirtyEntries([
      createSyncDirtyEntry("note", cloned.note.id, timestamp),
      ...cloned.assets.map((asset) => createSyncDirtyEntry("asset", asset.id, timestamp))
    ]);
  });
  scheduleActiveLocalVaultDesktopBackup();
  return cloned.note;
}

export async function duplicateFolder(
  folderId: string,
  parentId: string | null,
  projectId?: string,
  sortOrder?: number,
  duplicateSuffix = "copy"
) {
  const timestamp = now();
  const [sourceFolder, targetParent, folders, notes] = await Promise.all([
    db.folders.get(folderId),
    parentId ? db.folders.get(parentId) : Promise.resolve(null),
    db.folders.toArray(),
    db.notes.toArray()
  ]);

  if (!sourceFolder) {
    return null;
  }

  if (parentId && !targetParent) {
    throw new Error("TARGET_FOLDER_NOT_FOUND");
  }

  if (targetParent?.parentId) {
    throw new Error("FOLDER_DEPTH_LIMIT");
  }

  const descendantFolderIds = collectDescendantFolderIds(folderId, folders);

  if (parentId && descendantFolderIds.length > 0) {
    throw new Error("FOLDER_DEPTH_LIMIT");
  }

  const nextProjectId = targetParent?.projectId ?? projectId ?? sourceFolder.projectId;
  const nextSortOrder = resolveSiblingSortOrder(
    folders,
    notes,
    nextProjectId,
    parentId,
    [],
    sortOrder
  );
  const foldersByParent = new Map<string | null, Folder[]>();
  const notesByFolder = new Map<string | null, Note[]>();

  folders.forEach((folder) => {
    const bucket = foldersByParent.get(folder.parentId) ?? [];
    bucket.push(folder);
    foldersByParent.set(folder.parentId, bucket);
  });

  notes
    .filter((note) => note.trashedAt === null)
    .forEach((note) => {
      const bucket = notesByFolder.get(note.folderId) ?? [];
      bucket.push(note);
      notesByFolder.set(note.folderId, bucket);
    });

  const clonedFolders: Folder[] = [];
  const clonedNotes: Note[] = [];
  const clonedAssets: Asset[] = [];

  const cloneFolderTree = async (
    folder: Folder,
    nextParentId: string | null,
    root: boolean
  ): Promise<string> => {
    const nextFolderId = crypto.randomUUID();
    const nextFolder: Folder = {
      ...folder,
      id: nextFolderId,
      projectId: nextProjectId,
      parentId: nextParentId,
      name: root ? buildDuplicateTitle(folder.name, duplicateSuffix) : folder.name,
      sortOrder: root ? nextSortOrder : getSortableOrder(folder),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    clonedFolders.push(nextFolder);

    for (const note of notesByFolder.get(folder.id) ?? []) {
      const clonedNote = await cloneNoteRecord(
        note,
        nextFolderId,
        nextProjectId,
        getSortableOrder(note),
        duplicateSuffix,
        timestamp
      );
      clonedNotes.push(clonedNote.note);
      clonedAssets.push(...clonedNote.assets);
    }

    for (const childFolder of foldersByParent.get(folder.id) ?? []) {
      await cloneFolderTree(childFolder, nextFolderId, false);
    }

    return nextFolderId;
  };

  await cloneFolderTree(sourceFolder, parentId, true);

  await db.transaction("rw", db.folders, db.notes, db.assets, db.syncDirtyEntries, async () => {
    await db.folders.bulkAdd(clonedFolders);

    if (clonedNotes.length > 0) {
      await db.notes.bulkAdd(clonedNotes);
    }

    if (clonedAssets.length > 0) {
      await db.assets.bulkAdd(clonedAssets);
    }

    await putSyncDirtyEntries([
      ...clonedFolders.map((folder) => createSyncDirtyEntry("folder", folder.id, timestamp)),
      ...clonedNotes.map((note) => createSyncDirtyEntry("note", note.id, timestamp)),
      ...clonedAssets.map((asset) => createSyncDirtyEntry("asset", asset.id, timestamp))
    ]);
  });
  scheduleActiveLocalVaultDesktopBackup();
  return clonedFolders[0] ?? null;
}

export async function createTag(name: string) {
  const normalizedName = normalizeTagName(name);

  if (!normalizedName) {
    throw new Error("TAG_NAME_REQUIRED");
  }

  const existingTag = await db.tags.where("name").equalsIgnoreCase(normalizedName).first();

  if (existingTag) {
    return existingTag;
  }

  const timestamp = now();
  const tag: Tag = {
    id: crypto.randomUUID(),
    name: normalizedName,
    color: "",
    createdAt: timestamp,
    updatedAt: timestamp
  };

  await db.transaction("rw", [db.tags, db.syncDirtyEntries], async () => {
    await db.tags.add(tag);
    await putSyncDirtyEntry("tag", tag.id, timestamp);
  });
  scheduleActiveLocalVaultDesktopBackup();
  return tag;
}

export async function renameTag(tagId: string, name: string) {
  const normalizedName = normalizeTagName(name);

  if (!normalizedName) {
    throw new Error("TAG_NAME_REQUIRED");
  }

  await db.transaction("rw", db.tags, db.notes, db.syncTombstones, db.syncDirtyEntries, async () => {
    const existingTag = await db.tags.get(tagId);

    if (!existingTag) {
      return;
    }

    const duplicateTag = await db.tags.where("name").equalsIgnoreCase(normalizedName).first();

    if (duplicateTag && duplicateTag.id !== tagId) {
      const timestamp = now();
      const impactedNotes = await db.notes.where("tagIds").equals(tagId).toArray();

      await Promise.all(
        impactedNotes.map((note) => {
          const nextTagIds = Array.from(
            new Set(
              note.tagIds.map((currentTagId) =>
                currentTagId === tagId ? duplicateTag.id : currentTagId
              )
            )
          );

          return db.notes.update(note.id, {
            tagIds: nextTagIds,
            updatedAt: timestamp,
            syncState: nextSyncState(note.syncState)
          });
        })
      );

      await db.tags.update(duplicateTag.id, {
        updatedAt: timestamp
      });
      await putSyncDirtyEntry("tag", duplicateTag.id, timestamp);
      await putSyncDirtyEntries(
        impactedNotes.map((note) => createSyncDirtyEntry("note", note.id, timestamp))
      );
      await db.tags.delete(tagId);
      await putSyncTombstone("tag", tagId, timestamp);
      return;
    }

    if (normalizeTagLookup(existingTag.name) === normalizeTagLookup(normalizedName)) {
      if (existingTag.name !== normalizedName) {
        const timestamp = now();
        await db.tags.update(tagId, {
          name: normalizedName,
          updatedAt: timestamp
        });
        await putSyncDirtyEntry("tag", tagId, timestamp);
      }
      return;
    }

    const timestamp = now();
    await db.tags.update(tagId, {
      name: normalizedName,
      updatedAt: timestamp
    });
    await putSyncDirtyEntry("tag", tagId, timestamp);
  });

  scheduleActiveLocalVaultDesktopBackup();
}

export async function removeTag(tagId: string) {
  await db.transaction("rw", db.tags, db.notes, db.syncTombstones, db.syncDirtyEntries, async () => {
    await db.tags.delete(tagId);
    await putSyncTombstone("tag", tagId);

    const impactedNotes = await db.notes.where("tagIds").equals(tagId).toArray();
    const timestamp = now();

    await Promise.all(
      impactedNotes.map((note) =>
        db.notes.update(note.id, {
          tagIds: note.tagIds.filter((currentTagId) => currentTagId !== tagId),
          updatedAt: timestamp,
          syncState: nextSyncState(note.syncState)
        })
      )
    );

    await putSyncDirtyEntries(
      impactedNotes.map((note) => createSyncDirtyEntry("note", note.id, timestamp))
    );
  });

  scheduleActiveLocalVaultDesktopBackup();
}

export async function createNote(
  folderId: string | null,
  tagIds: string[],
  projectId?: string
) {
  const timestamp = now();
  const content: NoteContent = [];
  const folder = folderId ? await db.folders.get(folderId) : null;
  const resolvedProjectId = folder?.projectId ?? projectId ?? null;

  if (!resolvedProjectId) {
    throw new Error("PROJECT_REQUIRED");
  }

  const sortOrder = await getNextHierarchySortOrder(resolvedProjectId, folderId);

  const note: Note = {
    id: crypto.randomUUID(),
    title: "",
    contentType: "note",
    projectId: resolvedProjectId,
    folderId,
    color: DEFAULT_NOTE_COLOR,
    sortOrder,
    tagIds,
    content,
    canvasContent: null,
    excerpt: buildExcerpt(content),
    plainText: extractPlainText(content),
    createdAt: timestamp,
    updatedAt: timestamp,
    pinned: false,
    favorite: false,
    archived: false,
    trashedAt: null,
    syncState: "local",
    conflictOriginId: null
  };

  await db.transaction("rw", db.notes, db.settings, db.syncDirtyEntries, async () => {
    await db.notes.add(note);
    await putSyncDirtyEntry("note", note.id, timestamp);
    await db.settings.update("app", {
      lastOpenedNoteId: note.id
    });
  });

  scheduleActiveLocalVaultDesktopBackup();
  return note;
}

export async function createCanvas(
  folderId: string | null,
  tagIds: string[],
  projectId?: string
) {
  const timestamp = now();
  const canvasContent = createStarterCanvasContent();
  const folder = folderId ? await db.folders.get(folderId) : null;
  const resolvedProjectId = folder?.projectId ?? projectId ?? null;

  if (!resolvedProjectId) {
    throw new Error("PROJECT_REQUIRED");
  }

  const sortOrder = await getNextHierarchySortOrder(resolvedProjectId, folderId);

  const note: Note = {
    id: crypto.randomUUID(),
    title: "",
    contentType: "canvas",
    projectId: resolvedProjectId,
    folderId,
    color: DEFAULT_NOTE_COLOR,
    sortOrder,
    tagIds,
    content: [],
    canvasContent,
    excerpt: buildCanvasExcerpt(canvasContent),
    plainText: extractCanvasPlainText(canvasContent),
    createdAt: timestamp,
    updatedAt: timestamp,
    pinned: false,
    favorite: false,
    archived: false,
    trashedAt: null,
    syncState: "local",
    conflictOriginId: null
  };

  await db.transaction("rw", db.notes, db.settings, db.syncDirtyEntries, async () => {
    await db.notes.add(note);
    await putSyncDirtyEntry("note", note.id, timestamp);
    await db.settings.update("app", {
      lastOpenedNoteId: note.id
    });
  });

  scheduleActiveLocalVaultDesktopBackup();
  return note;
}

export async function updateNoteMeta(
  noteId: string,
  patch: Partial<
    Pick<
      Note,
      | "title"
      | "projectId"
      | "folderId"
      | "color"
      | "sortOrder"
      | "tagIds"
      | "pinned"
      | "favorite"
      | "archived"
      | "trashedAt"
    >
  >
) {
  const existingNote = await db.notes.get(noteId);
  const nextFolder = patch.folderId ? await db.folders.get(patch.folderId) : null;
  const nextProjectId =
    patch.folderId !== undefined
      ? nextFolder?.projectId ?? patch.projectId ?? existingNote?.projectId
      : patch.projectId ?? existingNote?.projectId;

  if (!existingNote) {
    return false;
  }

  const nextValues = {
    title: patch.title ?? existingNote.title,
    projectId: nextProjectId,
    folderId: patch.folderId !== undefined ? patch.folderId : existingNote.folderId,
    color: patch.color ?? existingNote.color,
    sortOrder: patch.sortOrder ?? existingNote.sortOrder ?? existingNote.createdAt,
    tagIds: patch.tagIds ?? existingNote.tagIds,
    pinned: patch.pinned ?? existingNote.pinned,
    favorite: patch.favorite ?? existingNote.favorite,
    archived: patch.archived ?? existingNote.archived,
    trashedAt: patch.trashedAt !== undefined ? patch.trashedAt : existingNote.trashedAt
  };

  if (
    existingNote.title === nextValues.title &&
    existingNote.projectId === nextValues.projectId &&
    existingNote.folderId === nextValues.folderId &&
    existingNote.color === nextValues.color &&
    (existingNote.sortOrder ?? existingNote.createdAt) === nextValues.sortOrder &&
    !hasStableValueChanged(existingNote.tagIds, nextValues.tagIds) &&
    existingNote.pinned === nextValues.pinned &&
    existingNote.favorite === nextValues.favorite &&
    existingNote.archived === nextValues.archived &&
    existingNote.trashedAt === nextValues.trashedAt
  ) {
    return false;
  }

  const timestamp = now();
  await db.transaction("rw", db.notes, db.syncDirtyEntries, async () => {
    await db.notes.update(noteId, {
      ...patch,
      projectId: nextProjectId,
      updatedAt: timestamp,
      syncState: nextSyncState(existingNote?.syncState)
    });
    await putSyncDirtyEntry("note", noteId, timestamp);
  });
  scheduleActiveLocalVaultDesktopBackup();
  return true;
}

export async function saveNoteContent(noteId: string, content: NoteContent) {
  const normalizedContent = normalizeNoteContent(content);
  const plainText = extractPlainText(normalizedContent);
  const excerpt = buildExcerpt(normalizedContent);
  const activeAssetIds = new Set(extractReferencedAssetIds(normalizedContent));

  const timestamp = now();
  let didChange = false;
  await db.transaction("rw", db.notes, db.assets, db.syncTombstones, db.syncDirtyEntries, async () => {
    const existingNote = await db.notes.get(noteId);

    if (!existingNote) {
      return;
    }

    const noteAssets = await db.assets.where("noteId").equals(noteId).toArray();
    const staleAssets = noteAssets.filter(
      (asset) =>
        !activeAssetIds.has(asset.id) &&
        timestamp - Math.max(asset.createdAt, asset.updatedAt) > NEWLY_UPLOADED_ASSET_PRUNE_GRACE_MS
    );

    const contentChanged =
      hasStableValueChanged(normalizeNoteContent(existingNote.content), normalizedContent) ||
      existingNote.plainText !== plainText ||
      existingNote.excerpt !== excerpt;

    if (!contentChanged && staleAssets.length === 0) {
      return;
    }

    if (staleAssets.length > 0) {
      staleAssets.forEach((asset) => {
        const cachedUrl = assetUrlCache.get(asset.id);

        if (cachedUrl) {
          URL.revokeObjectURL(cachedUrl);
          assetUrlCache.delete(asset.id);
        }
      });

      await db.assets.bulkDelete(staleAssets.map((asset) => asset.id));
      await Promise.all(staleAssets.map((asset) => putSyncTombstone("asset", asset.id)));
      didChange = true;
    }

    await db.notes.update(noteId, {
      content: normalizedContent,
      plainText,
      excerpt,
      updatedAt: timestamp,
      syncState: nextSyncState(existingNote.syncState)
    });
    await putSyncDirtyEntry("note", noteId, timestamp);
    didChange = true;
  });
  if (didChange) {
    scheduleActiveLocalVaultDesktopBackup();
  }
  return didChange;
}

export async function loadCanvasFiles(noteId: string): Promise<BinaryFiles> {
  const assets = await db.assets.where("noteId").equals(noteId).toArray();
  const files: BinaryFiles = {};

  await Promise.all(
    assets.map(async (asset) => {
      files[asset.id] = {
        id: asset.id as BinaryFileData["id"],
        dataURL: (await getDataUrlFromBlob(asset.blob)) as BinaryFileData["dataURL"],
        mimeType: asset.mimeType as BinaryFileData["mimeType"],
        created: asset.createdAt,
        lastRetrieved: asset.updatedAt,
        version: asset.version ?? 0
      };
    })
  );

  return files;
}

async function getDataUrlFromBlob(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("FILE_READ_FAILED"));
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error("FILE_READ_FAILED"));
    };

    reader.readAsDataURL(blob);
  });
}

export async function saveCanvasContent(
  noteId: string,
  content: CanvasContent,
  files: BinaryFiles,
  fileNames: Record<string, string> = {}
) {
  const normalizedContent = normalizeCanvasContent(content);
  const plainText = extractCanvasPlainText(normalizedContent);
  const excerpt = buildCanvasExcerpt(normalizedContent);
  const activeFileIds = new Set(extractCanvasReferencedFileIds(normalizedContent));

  const timestamp = now();
  let didChange = false;
  await db.transaction("rw", db.notes, db.assets, db.syncTombstones, db.syncDirtyEntries, async () => {
    const existingNote = await db.notes.get(noteId);

    if (!existingNote) {
      return;
    }

    const noteAssets = await db.assets.where("noteId").equals(noteId).toArray();
    const assetsById = new Map(noteAssets.map((asset) => [asset.id, asset]));
    const staleAssets = noteAssets.filter((asset) => !activeFileIds.has(asset.id));
    let assetMutationCount = 0;

    if (staleAssets.length > 0) {
      staleAssets.forEach((asset) => {
        const cachedUrl = assetUrlCache.get(asset.id);

        if (cachedUrl) {
          URL.revokeObjectURL(cachedUrl);
          assetUrlCache.delete(asset.id);
        }
      });

      await db.assets.bulkDelete(staleAssets.map((asset) => asset.id));
      await Promise.all(staleAssets.map((asset) => putSyncTombstone("asset", asset.id)));
      assetMutationCount += staleAssets.length;
      didChange = true;
    }

    for (const fileId of activeFileIds) {
      const file = files[fileId];

      if (!file) {
        continue;
      }

      const existingAsset = assetsById.get(fileId);
      const nextVersion = file.version ?? 0;

      if (existingAsset && (existingAsset.version ?? 0) === nextVersion) {
        continue;
      }

      const blob = await dataUrlToBlob(file.dataURL);
      const nextAsset: Asset = {
        id: fileId,
        noteId,
        name:
          fileNames[fileId] ??
          existingAsset?.name ??
          getCanvasAssetName(fileId, file.mimeType),
        mimeType: file.mimeType,
        size: blob.size,
        kind: file.mimeType.startsWith("image/") ? "image" : "file",
        blob,
        version: nextVersion,
        createdAt: existingAsset?.createdAt ?? file.created ?? timestamp,
        updatedAt: timestamp
      };

      await db.assets.put(nextAsset);
      await putSyncDirtyEntry("asset", nextAsset.id, timestamp);
      assetMutationCount += 1;
      didChange = true;
    }

    const sceneChanged =
      hasStableValueChanged(existingNote.canvasContent ?? { elements: [], appState: null }, normalizedContent) ||
      existingNote.plainText !== plainText ||
      existingNote.excerpt !== excerpt;

    if (!sceneChanged && assetMutationCount === 0) {
      return;
    }

    await db.notes.update(noteId, {
      canvasContent: normalizedContent,
      plainText,
      excerpt,
      updatedAt: timestamp,
      syncState: nextSyncState(existingNote.syncState)
    });
    await putSyncDirtyEntry("note", noteId, timestamp);
    didChange = true;
  });
  if (didChange) {
    scheduleActiveLocalVaultDesktopBackup();
  }
  return didChange;
}

export async function moveNoteToTrash(noteId: string) {
  return updateNoteMeta(noteId, {
    trashedAt: now(),
    archived: false
  });
}

export async function restoreNoteFromTrash(noteId: string) {
  return updateNoteMeta(noteId, {
    trashedAt: null
  });
}

export async function removeNote(noteId: string) {
  await db.transaction("rw", db.notes, db.assets, db.syncTombstones, db.syncDirtyEntries, async () => {
    await db.notes.delete(noteId);
    await putSyncTombstone("note", noteId);
    const assetIds = await db.assets.where("noteId").equals(noteId).primaryKeys();
    const normalizedIds = assetIds.map((id) => String(id));

    normalizedIds.forEach((assetId) => {
      const cachedUrl = assetUrlCache.get(assetId);

      if (cachedUrl) {
        URL.revokeObjectURL(cachedUrl);
        assetUrlCache.delete(assetId);
      }
    });

    await db.assets.bulkDelete(normalizedIds);
    await Promise.all(normalizedIds.map((assetId) => putSyncTombstone("asset", assetId)));
  });

  scheduleActiveLocalVaultDesktopBackup();
}

export async function clearTrash() {
  const trashedNoteIds = (await db.notes.toArray())
    .filter((note) => note.trashedAt !== null)
    .map((note) => note.id);

  if (trashedNoteIds.length === 0) {
    return 0;
  }

  await db.transaction("rw", db.notes, db.assets, db.syncTombstones, db.syncDirtyEntries, async () => {
    for (const noteId of trashedNoteIds) {
      await db.notes.delete(noteId);
      await putSyncTombstone("note", noteId);

      const assetIds = await db.assets.where("noteId").equals(noteId).primaryKeys();
      const normalizedIds = assetIds.map((id) => String(id));

      normalizedIds.forEach((assetId) => {
        const cachedUrl = assetUrlCache.get(assetId);

        if (cachedUrl) {
          URL.revokeObjectURL(cachedUrl);
          assetUrlCache.delete(assetId);
        }
      });

      await db.assets.bulkDelete(normalizedIds);
      await Promise.all(normalizedIds.map((assetId) => putSyncTombstone("asset", assetId)));
    }
  });

  scheduleActiveLocalVaultDesktopBackup();
  return trashedNoteIds.length;
}

export type PlannerTaskCreateInput = {
  title: string;
  description?: string;
  kind?: Task["kind"];
  status?: Task["status"];
  priority?: Task["priority"];
  projectId?: string | null;
  folderId?: string | null;
  noteId?: string | null;
  canvasId?: string | null;
  sourceBlockId?: string | null;
  canvasElementId?: string | null;
  tagIds?: string[];
  links?: Task["links"];
  reminders?: Task["reminders"];
  startAt?: number | null;
  dueAt?: number | null;
  scheduledStartAt?: number | null;
  scheduledEndAt?: number | null;
  recurrenceRule?: string | null;
  recurrenceTimezone?: string | null;
  recurrenceAnchorAt?: number | null;
  recurrenceUntilAt?: number | null;
  recurrenceExceptionDates?: number[];
  recurrenceCompletedDates?: number[];
  recurrenceOverrides?: Task["recurrenceOverrides"];
  estimateMinutes?: number | null;
  sortOrder?: number;
};

export type PlannerTaskUpdateInput = Partial<
  Pick<
    Task,
    | "title"
    | "description"
    | "kind"
    | "status"
    | "priority"
    | "projectId"
    | "folderId"
    | "noteId"
    | "canvasId"
    | "sourceBlockId"
    | "canvasElementId"
    | "tagIds"
    | "links"
    | "reminders"
    | "startAt"
    | "dueAt"
    | "scheduledStartAt"
    | "scheduledEndAt"
    | "completedAt"
    | "canceledAt"
    | "recurrenceRule"
    | "recurrenceTimezone"
    | "recurrenceAnchorAt"
    | "recurrenceUntilAt"
    | "recurrenceExceptionDates"
    | "recurrenceCompletedDates"
    | "recurrenceOverrides"
    | "estimateMinutes"
    | "spentMinutes"
    | "sortOrder"
  >
>;

function normalizePlannerTaskTitle(title: string) {
  const normalized = title.trim();
  return normalized.length > 0 ? normalized : "Untitled task";
}

export async function createPlannerTask(input: PlannerTaskCreateInput) {
  const timestamp = now();
  let task: Task | null = null;

  await db.transaction("rw", db.tasks, db.syncDirtyEntries, async () => {
    const tasks = await db.tasks.toArray();
    task = {
      id: crypto.randomUUID(),
      title: normalizePlannerTaskTitle(input.title),
      description: input.description?.trim() ?? "",
      kind: input.kind ?? "task",
      status: input.status ?? "inbox",
      priority: input.priority ?? "none",
      projectId: input.projectId ?? null,
      folderId: input.folderId ?? null,
      noteId: input.noteId ?? null,
      canvasId: input.canvasId ?? null,
      sourceBlockId: input.sourceBlockId ?? null,
      canvasElementId: input.canvasElementId ?? null,
      tagIds: Array.isArray(input.tagIds) ? [...input.tagIds] : [],
      links: Array.isArray(input.links) ? [...input.links] : [],
      reminders: Array.isArray(input.reminders) ? [...input.reminders] : [],
      startAt: input.startAt ?? null,
      dueAt: input.dueAt ?? null,
      scheduledStartAt: input.scheduledStartAt ?? null,
      scheduledEndAt: input.scheduledEndAt ?? null,
      completedAt: null,
      canceledAt: null,
      recurrenceRule: input.recurrenceRule ?? null,
      recurrenceTimezone: input.recurrenceTimezone ?? null,
      recurrenceAnchorAt: input.recurrenceAnchorAt ?? null,
      recurrenceUntilAt: input.recurrenceUntilAt ?? null,
      recurrenceExceptionDates: Array.isArray(input.recurrenceExceptionDates)
        ? [...input.recurrenceExceptionDates]
        : [],
      recurrenceCompletedDates: Array.isArray(input.recurrenceCompletedDates)
        ? [...input.recurrenceCompletedDates]
        : [],
      recurrenceOverrides: Array.isArray(input.recurrenceOverrides) ? [...input.recurrenceOverrides] : [],
      estimateMinutes: input.estimateMinutes ?? null,
      spentMinutes: 0,
      sortOrder: input.sortOrder ?? getNextSortOrder(tasks),
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await db.tasks.add(task);
    await putSyncDirtyEntry("task", task.id, timestamp);
  });

  scheduleActiveLocalVaultDesktopBackup();

  if (!task) {
    throw new Error("Task was not created.");
  }

  return task;
}

export async function updatePlannerTask(taskId: string, patch: PlannerTaskUpdateInput) {
  const timestamp = now();
  let updatedTask: Task | null = null;

  await db.transaction("rw", db.tasks, db.syncDirtyEntries, async () => {
    const existingTask = await db.tasks.get(taskId);

    if (!existingTask) {
      return;
    }

    const nextPatch: PlannerTaskUpdateInput = {
      ...patch,
      updatedAt: timestamp
    } as PlannerTaskUpdateInput;

    if (typeof patch.title === "string") {
      nextPatch.title = normalizePlannerTaskTitle(patch.title);
    }

    if (typeof patch.description === "string") {
      nextPatch.description = patch.description.trim();
    }

    if (Array.isArray(patch.tagIds)) {
      nextPatch.tagIds = [...patch.tagIds];
    }

    if (Array.isArray(patch.links)) {
      nextPatch.links = [...patch.links];
    }

    if (Array.isArray(patch.reminders)) {
      nextPatch.reminders = [...patch.reminders];
    }

    if (Array.isArray(patch.recurrenceExceptionDates)) {
      nextPatch.recurrenceExceptionDates = [...patch.recurrenceExceptionDates];
    }

    if (Array.isArray(patch.recurrenceCompletedDates)) {
      nextPatch.recurrenceCompletedDates = [...patch.recurrenceCompletedDates];
    }

    if (Array.isArray(patch.recurrenceOverrides)) {
      nextPatch.recurrenceOverrides = [...patch.recurrenceOverrides];
    }

    await db.tasks.update(taskId, nextPatch);
    updatedTask = hydrateTaskRecord({
      ...existingTask,
      ...nextPatch,
      updatedAt: timestamp
    });
    await putSyncDirtyEntry("task", taskId, timestamp);
  });

  if (updatedTask) {
    scheduleActiveLocalVaultDesktopBackup();
  }

  return updatedTask;
}

export async function setPlannerTaskDone(taskId: string, done: boolean) {
  const existingTask = await db.tasks.get(taskId);

  if (!existingTask) {
    return null;
  }

  const timestamp = now();
  return updatePlannerTask(taskId, {
    status: done ? "done" : existingTask.status === "done" ? "todo" : existingTask.status,
    completedAt: done ? timestamp : null,
    canceledAt: done ? null : existingTask.canceledAt
  });
}

export async function removePlannerTask(taskId: string) {
  const timestamp = now();

  await db.transaction("rw", db.tasks, db.timeBlocks, db.syncTombstones, db.syncDirtyEntries, async () => {
    await db.tasks.delete(taskId);
    const linkedTimeBlocks = await db.timeBlocks.where("taskId").equals(taskId).toArray();

    if (linkedTimeBlocks.length > 0) {
      await Promise.all(
        linkedTimeBlocks.map((timeBlock) =>
          db.timeBlocks.update(timeBlock.id, {
            taskId: null,
            updatedAt: timestamp
          })
        )
      );
      await Promise.all(linkedTimeBlocks.map((timeBlock) => putSyncDirtyEntry("timeBlock", timeBlock.id, timestamp)));
    }

    await putSyncTombstone("task", taskId, timestamp);
  });

  scheduleActiveLocalVaultDesktopBackup();
}

export type PlannerHabitCreateInput = {
  title: string;
  description?: string;
  status?: Habit["status"];
  projectId?: string | null;
  noteId?: string | null;
  color?: string;
  icon?: string;
  frequencyRule?: string;
  frequencyTimezone?: string | null;
  targetCount?: number;
  targetUnit?: string;
  targetPeriod?: Habit["targetPeriod"];
  reminders?: Habit["reminders"];
  sortOrder?: number;
};

export type PlannerHabitUpdateInput = Partial<
  Pick<
    Habit,
    | "title"
    | "description"
    | "status"
    | "projectId"
    | "noteId"
    | "color"
    | "icon"
    | "frequencyRule"
    | "frequencyTimezone"
    | "targetCount"
    | "targetUnit"
    | "targetPeriod"
    | "reminders"
    | "sortOrder"
    | "pausedAt"
    | "archivedAt"
    | "pauseRanges"
  >
>;

function normalizePlannerHabitTitle(title: string) {
  const normalized = title.trim();
  return normalized.length > 0 ? normalized : "Untitled habit";
}

function normalizePlannerHabitTargetCount(value: number | null | undefined) {
  return Math.max(1, Math.min(999, Math.round(value ?? 1)));
}

function normalizePlannerHabitTargetUnit(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 24) : "count";
}

function buildPausedHabitRanges(existingHabit: Habit, nextStatus: Habit["status"], timestamp: number) {
  const previousRanges = Array.isArray(existingHabit.pauseRanges) ? [...existingHabit.pauseRanges] : [];

  if (nextStatus === "paused" && existingHabit.status !== "paused") {
    return [
      ...previousRanges,
      {
        id: crypto.randomUUID(),
        startAt: timestamp,
        endAt: null,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ];
  }

  if (nextStatus === "active" && existingHabit.status === "paused") {
    let openRangeIndex = -1;

    for (let index = previousRanges.length - 1; index >= 0; index -= 1) {
      if (previousRanges[index].endAt === null) {
        openRangeIndex = index;
        break;
      }
    }

    if (openRangeIndex >= 0) {
      previousRanges[openRangeIndex] = {
        ...previousRanges[openRangeIndex],
        endAt: timestamp,
        updatedAt: timestamp
      };
    }
  }

  return previousRanges;
}

export async function createPlannerHabit(input: PlannerHabitCreateInput) {
  const timestamp = now();
  let habit: Habit | null = null;

  await db.transaction("rw", db.habits, db.syncDirtyEntries, async () => {
    const habits = await db.habits.toArray();
    const status = input.status ?? "active";
    habit = {
      id: crypto.randomUUID(),
      title: normalizePlannerHabitTitle(input.title),
      description: input.description?.trim() ?? "",
      status,
      projectId: input.projectId ?? null,
      noteId: input.noteId ?? null,
      color: input.color ?? DEFAULT_PROJECT_COLOR,
      icon: input.icon?.trim() || "spark",
      frequencyRule: input.frequencyRule?.trim() || "FREQ=DAILY;INTERVAL=1",
      frequencyTimezone: input.frequencyTimezone ?? getResolvedTimeZone(),
      targetCount: normalizePlannerHabitTargetCount(input.targetCount),
      targetUnit: normalizePlannerHabitTargetUnit(input.targetUnit),
      targetPeriod: input.targetPeriod ?? "day",
      reminders: Array.isArray(input.reminders) ? [...input.reminders] : [],
      sortOrder: input.sortOrder ?? getNextSortOrder(habits),
      createdAt: timestamp,
      updatedAt: timestamp,
      pausedAt: status === "paused" ? timestamp : null,
      archivedAt: status === "archived" ? timestamp : null,
      pauseRanges:
        status === "paused"
          ? [
              {
                id: crypto.randomUUID(),
                startAt: timestamp,
                endAt: null,
                createdAt: timestamp,
                updatedAt: timestamp
              }
            ]
          : []
    };

    await db.habits.add(habit);
    await putSyncDirtyEntry("habit", habit.id, timestamp);
  });

  scheduleActiveLocalVaultDesktopBackup();

  if (!habit) {
    throw new Error("Habit was not created.");
  }

  return habit;
}

export async function updatePlannerHabit(habitId: string, patch: PlannerHabitUpdateInput) {
  const timestamp = now();
  let updatedHabit: Habit | null = null;

  await db.transaction("rw", db.habits, db.syncDirtyEntries, async () => {
    const existingHabit = await db.habits.get(habitId);

    if (!existingHabit) {
      return;
    }

    const nextPatch: PlannerHabitUpdateInput & { updatedAt: number } = {
      ...patch,
      updatedAt: timestamp
    };

    if (typeof patch.title === "string") {
      nextPatch.title = normalizePlannerHabitTitle(patch.title);
    }

    if (typeof patch.description === "string") {
      nextPatch.description = patch.description.trim();
    }

    if (typeof patch.icon === "string") {
      nextPatch.icon = patch.icon.trim() || "spark";
    }

    if (typeof patch.frequencyRule === "string") {
      nextPatch.frequencyRule = patch.frequencyRule.trim() || existingHabit.frequencyRule;
    }

    if (typeof patch.targetCount === "number") {
      nextPatch.targetCount = normalizePlannerHabitTargetCount(patch.targetCount);
    }

    if (typeof patch.targetUnit === "string") {
      nextPatch.targetUnit = normalizePlannerHabitTargetUnit(patch.targetUnit);
    }

    if (Array.isArray(patch.reminders)) {
      nextPatch.reminders = [...patch.reminders];
    }

    if (Array.isArray(patch.pauseRanges)) {
      nextPatch.pauseRanges = [...patch.pauseRanges];
    }

    if (patch.status) {
      nextPatch.pauseRanges = buildPausedHabitRanges(existingHabit, patch.status, timestamp);
      nextPatch.pausedAt = patch.status === "paused" ? existingHabit.pausedAt ?? timestamp : null;
      nextPatch.archivedAt = patch.status === "archived" ? existingHabit.archivedAt ?? timestamp : null;
    }

    await db.habits.update(habitId, nextPatch);
    updatedHabit = hydrateHabitRecord({
      ...existingHabit,
      ...nextPatch,
      updatedAt: timestamp
    });
    await putSyncDirtyEntry("habit", habitId, timestamp);
  });

  if (updatedHabit) {
    scheduleActiveLocalVaultDesktopBackup();
  }

  return updatedHabit;
}

export async function removePlannerHabit(habitId: string) {
  const timestamp = now();

  await db.transaction("rw", db.habits, db.habitLogs, db.syncTombstones, db.syncDirtyEntries, async () => {
    const linkedLogs = await db.habitLogs.where("habitId").equals(habitId).toArray();
    await db.habits.delete(habitId);

    if (linkedLogs.length > 0) {
      await Promise.all(linkedLogs.map((log) => db.habitLogs.delete(log.id)));
      await Promise.all(linkedLogs.map((log) => putSyncTombstone("habitLog", log.id, timestamp)));
    }

    await putSyncTombstone("habit", habitId, timestamp);
  });

  scheduleActiveLocalVaultDesktopBackup();
}

export type PlannerHabitLogCreateInput = {
  habitId: string;
  occurredAt?: number;
  value?: number;
  unit?: string;
  note?: string;
};

export async function createPlannerHabitLog(input: PlannerHabitLogCreateInput) {
  const timestamp = now();
  let habitLog: HabitLog | null = null;

  await db.transaction("rw", db.habitLogs, db.syncDirtyEntries, async () => {
    habitLog = {
      id: crypto.randomUUID(),
      habitId: input.habitId,
      occurredAt: input.occurredAt ?? timestamp,
      value: Math.max(1, input.value ?? 1),
      unit: normalizePlannerHabitTargetUnit(input.unit),
      note: input.note?.trim() ?? "",
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await db.habitLogs.add(habitLog);
    await putSyncDirtyEntry("habitLog", habitLog.id, timestamp);
  });

  scheduleActiveLocalVaultDesktopBackup();

  if (!habitLog) {
    throw new Error("Habit log was not created.");
  }

  return habitLog;
}

export async function removePlannerHabitLog(habitLogId: string) {
  const timestamp = now();

  await db.transaction("rw", db.habitLogs, db.syncTombstones, db.syncDirtyEntries, async () => {
    await db.habitLogs.delete(habitLogId);
    await putSyncTombstone("habitLog", habitLogId, timestamp);
  });

  scheduleActiveLocalVaultDesktopBackup();
}

export async function togglePlannerHabitLogForDay(habitId: string, dayAt?: number, value = 1) {
  const timestamp = now();
  const targetAt = dayAt ?? timestamp;
  const day = new Date(targetAt);
  day.setHours(0, 0, 0, 0);
  const rangeStart = day.getTime();
  day.setHours(23, 59, 59, 999);
  const rangeEnd = day.getTime();
  const occurredAt = timestamp >= rangeStart && timestamp <= rangeEnd ? timestamp : Math.min(rangeEnd, Math.max(rangeStart, targetAt));
  let nextHabitLog: HabitLog | null = null;

  await db.transaction("rw", db.habitLogs, db.syncDirtyEntries, db.syncTombstones, async () => {
    const existingLogs = await db.habitLogs
      .where("habitId")
      .equals(habitId)
      .filter((log) => log.occurredAt >= rangeStart && log.occurredAt <= rangeEnd)
      .toArray();

    if (existingLogs.length > 0) {
      await Promise.all(existingLogs.map((log) => db.habitLogs.delete(log.id)));
      await Promise.all(existingLogs.map((log) => putSyncTombstone("habitLog", log.id, timestamp)));
      return;
    }

    nextHabitLog = {
      id: crypto.randomUUID(),
      habitId,
      occurredAt,
      value: Math.max(1, value),
      unit: "count",
      note: "",
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await db.habitLogs.add(nextHabitLog);
    await putSyncDirtyEntry("habitLog", nextHabitLog.id, timestamp);
  });

  scheduleActiveLocalVaultDesktopBackup();
  return nextHabitLog;
}

export type PlannerTimeBlockCreateInput = {
  title: string;
  description?: string;
  status?: TimeBlock["status"];
  taskId?: string | null;
  projectId?: string | null;
  noteId?: string | null;
  canvasId?: string | null;
  startAt: number;
  endAt: number;
  actualStartAt?: number | null;
  actualEndAt?: number | null;
  color?: string;
};

export type PlannerTimeBlockUpdateInput = Partial<
  Pick<
    TimeBlock,
    | "title"
    | "description"
    | "status"
    | "taskId"
    | "projectId"
    | "noteId"
    | "canvasId"
    | "startAt"
    | "endAt"
    | "actualStartAt"
    | "actualEndAt"
    | "color"
  >
>;

function normalizeTimeBlockTitle(title: string) {
  const normalized = title.trim();
  return normalized.length > 0 ? normalized : "Focus block";
}

function normalizeTimeBlockRange(startAt: number, endAt: number) {
  const normalizedStartAt = Number.isFinite(startAt) ? startAt : now();
  const fallbackEndAt = normalizedStartAt + 30 * 60 * 1000;
  const normalizedEndAt =
    Number.isFinite(endAt) && endAt > normalizedStartAt
      ? endAt
      : fallbackEndAt;

  return {
    startAt: normalizedStartAt,
    endAt: normalizedEndAt
  };
}

export async function createPlannerTimeBlock(input: PlannerTimeBlockCreateInput) {
  const timestamp = now();
  const range = normalizeTimeBlockRange(input.startAt, input.endAt);
  let timeBlock: TimeBlock | null = null;

  await db.transaction("rw", db.timeBlocks, db.tasks, db.syncDirtyEntries, async () => {
    const linkedTask = input.taskId ? await db.tasks.get(input.taskId) : null;

    timeBlock = {
      id: crypto.randomUUID(),
      title: normalizeTimeBlockTitle(input.title || linkedTask?.title || ""),
      description: input.description?.trim() ?? "",
      status: input.status ?? "planned",
      taskId: input.taskId ?? null,
      projectId: input.projectId ?? linkedTask?.projectId ?? null,
      noteId: input.noteId ?? linkedTask?.noteId ?? null,
      canvasId: input.canvasId ?? linkedTask?.canvasId ?? null,
      startAt: range.startAt,
      endAt: range.endAt,
      actualStartAt: input.actualStartAt ?? null,
      actualEndAt: input.actualEndAt ?? null,
      color: input.color ?? "#8edcff",
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await db.timeBlocks.add(timeBlock);
    await putSyncDirtyEntry("timeBlock", timeBlock.id, timestamp);

    if (linkedTask) {
      await db.tasks.update(linkedTask.id, {
        status: linkedTask.status === "inbox" || linkedTask.status === "todo" ? "scheduled" : linkedTask.status,
        scheduledStartAt: range.startAt,
        scheduledEndAt: range.endAt,
        updatedAt: timestamp
      });
      await putSyncDirtyEntry("task", linkedTask.id, timestamp);
    }
  });

  scheduleActiveLocalVaultDesktopBackup();

  if (!timeBlock) {
    throw new Error("Time block was not created.");
  }

  return timeBlock;
}

export async function updatePlannerTimeBlock(timeBlockId: string, patch: PlannerTimeBlockUpdateInput) {
  const timestamp = now();
  let updatedTimeBlock: TimeBlock | null = null;

  await db.transaction("rw", db.timeBlocks, db.tasks, db.syncDirtyEntries, async () => {
    const existingTimeBlock = await db.timeBlocks.get(timeBlockId);

    if (!existingTimeBlock) {
      return;
    }

    const range =
      typeof patch.startAt === "number" || typeof patch.endAt === "number"
        ? normalizeTimeBlockRange(patch.startAt ?? existingTimeBlock.startAt, patch.endAt ?? existingTimeBlock.endAt)
        : null;
    const nextPatch: PlannerTimeBlockUpdateInput & { updatedAt: number } = {
      ...patch,
      ...(range ?? {}),
      updatedAt: timestamp
    };

    if (typeof patch.title === "string") {
      nextPatch.title = normalizeTimeBlockTitle(patch.title);
    }

    if (typeof patch.description === "string") {
      nextPatch.description = patch.description.trim();
    }

    await db.timeBlocks.update(timeBlockId, nextPatch);
    updatedTimeBlock = hydrateTimeBlockRecord({
      ...existingTimeBlock,
      ...nextPatch,
      updatedAt: timestamp
    });
    await putSyncDirtyEntry("timeBlock", timeBlockId, timestamp);

    const nextTaskId = nextPatch.taskId ?? existingTimeBlock.taskId;

    if (existingTimeBlock.taskId && nextTaskId !== existingTimeBlock.taskId) {
      const previousTask = await db.tasks.get(existingTimeBlock.taskId);

      if (
        previousTask &&
        previousTask.scheduledStartAt === existingTimeBlock.startAt &&
        previousTask.scheduledEndAt === existingTimeBlock.endAt
      ) {
        await db.tasks.update(previousTask.id, {
          status: previousTask.status === "scheduled" ? "todo" : previousTask.status,
          scheduledStartAt: null,
          scheduledEndAt: null,
          updatedAt: timestamp
        });
        await putSyncDirtyEntry("task", previousTask.id, timestamp);
      }
    }

    const effectiveRange =
      range ??
      (nextTaskId !== existingTimeBlock.taskId
        ? {
            startAt: existingTimeBlock.startAt,
            endAt: existingTimeBlock.endAt
          }
        : null);

    if (nextTaskId && effectiveRange) {
      const linkedTask = await db.tasks.get(nextTaskId);

      if (linkedTask) {
        await db.tasks.update(nextTaskId, {
          status: linkedTask.status === "inbox" || linkedTask.status === "todo" ? "scheduled" : linkedTask.status,
          scheduledStartAt: effectiveRange.startAt,
          scheduledEndAt: effectiveRange.endAt,
          updatedAt: timestamp
        });
        await putSyncDirtyEntry("task", nextTaskId, timestamp);
      }
    }
  });

  if (updatedTimeBlock) {
    scheduleActiveLocalVaultDesktopBackup();
  }

  return updatedTimeBlock;
}

export async function removePlannerTimeBlock(timeBlockId: string) {
  const timestamp = now();

  await db.transaction("rw", db.timeBlocks, db.tasks, db.syncTombstones, db.syncDirtyEntries, async () => {
    const existingTimeBlock = await db.timeBlocks.get(timeBlockId);
    await db.timeBlocks.delete(timeBlockId);

    if (existingTimeBlock?.taskId) {
      const linkedTask = await db.tasks.get(existingTimeBlock.taskId);

      if (
        linkedTask &&
        linkedTask.scheduledStartAt === existingTimeBlock.startAt &&
        linkedTask.scheduledEndAt === existingTimeBlock.endAt
      ) {
        await db.tasks.update(linkedTask.id, {
          status: linkedTask.status === "scheduled" ? "todo" : linkedTask.status,
          scheduledStartAt: null,
          scheduledEndAt: null,
          updatedAt: timestamp
        });
        await putSyncDirtyEntry("task", linkedTask.id, timestamp);
      }
    }

    await putSyncTombstone("timeBlock", timeBlockId, timestamp);
  });

  scheduleActiveLocalVaultDesktopBackup();
}

export type PlannerDataClearResult = {
  tasks: number;
  habits: number;
  habitLogs: number;
  goals: number;
  timeBlocks: number;
  total: number;
};

export async function clearPlannerData(): Promise<PlannerDataClearResult> {
  const timestamp = now();
  const result: PlannerDataClearResult = {
    tasks: 0,
    habits: 0,
    habitLogs: 0,
    goals: 0,
    timeBlocks: 0,
    total: 0
  };

  await db.transaction(
    "rw",
    [
      db.tasks,
      db.habits,
      db.habitLogs,
      db.goals,
      db.timeBlocks,
      db.syncTombstones,
      db.syncDirtyEntries
    ],
    async () => {
      const [tasks, habits, habitLogs, goals, timeBlocks] = await Promise.all([
        db.tasks.toArray(),
        db.habits.toArray(),
        db.habitLogs.toArray(),
        db.goals.toArray(),
        db.timeBlocks.toArray()
      ]);
      const taskIds = tasks.map((task) => task.id);
      const habitIds = habits.map((habit) => habit.id);
      const habitLogIds = habitLogs.map((habitLog) => habitLog.id);
      const goalIds = goals.map((goal) => goal.id);
      const timeBlockIds = timeBlocks.map((timeBlock) => timeBlock.id);
      const tombstones: SyncTombstone[] = [
        ...taskIds.map((entityId) => ({
          key: getSyncEntityKey("task", entityId),
          entityType: "task" as const,
          entityId,
          deletedAt: timestamp
        })),
        ...habitIds.map((entityId) => ({
          key: getSyncEntityKey("habit", entityId),
          entityType: "habit" as const,
          entityId,
          deletedAt: timestamp
        })),
        ...habitLogIds.map((entityId) => ({
          key: getSyncEntityKey("habitLog", entityId),
          entityType: "habitLog" as const,
          entityId,
          deletedAt: timestamp
        })),
        ...goalIds.map((entityId) => ({
          key: getSyncEntityKey("goal", entityId),
          entityType: "goal" as const,
          entityId,
          deletedAt: timestamp
        })),
        ...timeBlockIds.map((entityId) => ({
          key: getSyncEntityKey("timeBlock", entityId),
          entityType: "timeBlock" as const,
          entityId,
          deletedAt: timestamp
        }))
      ];

      result.tasks = taskIds.length;
      result.habits = habitIds.length;
      result.habitLogs = habitLogIds.length;
      result.goals = goalIds.length;
      result.timeBlocks = timeBlockIds.length;
      result.total = tombstones.length;

      if (result.total === 0) {
        return;
      }

      await Promise.all([
        taskIds.length > 0 ? db.tasks.bulkDelete(taskIds) : Promise.resolve(),
        habitIds.length > 0 ? db.habits.bulkDelete(habitIds) : Promise.resolve(),
        habitLogIds.length > 0 ? db.habitLogs.bulkDelete(habitLogIds) : Promise.resolve(),
        goalIds.length > 0 ? db.goals.bulkDelete(goalIds) : Promise.resolve(),
        timeBlockIds.length > 0 ? db.timeBlocks.bulkDelete(timeBlockIds) : Promise.resolve()
      ]);
      await db.syncTombstones.bulkPut(tombstones);
      await putSyncDirtyEntries(
        tombstones.map((tombstone) =>
          createSyncDirtyEntry(tombstone.entityType, tombstone.entityId, tombstone.deletedAt, true)
        )
      );
    }
  );

  if (result.total > 0) {
    scheduleActiveLocalVaultDesktopBackup();
  }

  return result;
}

function detectAssetKind(file: File): AssetKind {
  if (file.type.startsWith("image/")) {
    return "image";
  }

  if (file.type.startsWith("audio/")) {
    return "audio";
  }

  if (file.type.startsWith("video/")) {
    return "video";
  }

  return "file";
}

export async function storeAsset(noteId: string, file: File) {
  const timestamp = now();
  const asset: Asset = {
    id: crypto.randomUUID(),
    noteId,
    name: file.name,
    mimeType: file.type,
    size: file.size,
    kind: detectAssetKind(file),
    blob: file,
    version: 0,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  await db.transaction("rw", db.assets, db.syncDirtyEntries, async () => {
    await db.assets.add(asset);
    await putSyncDirtyEntry("asset", asset.id, timestamp);
  });
  scheduleActiveLocalVaultDesktopBackup();
  return `asset://${asset.id}`;
}

export function resetResolvedAssetCache() {
  assetUrlCache.forEach((objectUrl) => {
    URL.revokeObjectURL(objectUrl);
  });

  assetUrlCache.clear();
}

export async function resolveAssetUrl(url: string) {
  if (!url.startsWith("asset://")) {
    return url;
  }

  const assetId = url.replace("asset://", "");
  const cachedUrl = assetUrlCache.get(assetId);

  if (cachedUrl) {
    return cachedUrl;
  }

  const asset = await db.assets.get(assetId);

  if (!asset) {
    return url;
  }

  const objectUrl = URL.createObjectURL(asset.blob);
  assetUrlCache.set(assetId, objectUrl);
  return objectUrl;
}

export function isSyncProvider(value: string): value is SyncProvider {
  return value === "none" || value === "googleDrive" || value === "selfHosted" || value === "hosted";
}

export async function clearSyncTombstone(entityType: SyncEntityKind, entityId: string) {
  await deleteSyncTombstone(entityType, entityId);
  scheduleActiveLocalVaultDesktopBackup();
}
