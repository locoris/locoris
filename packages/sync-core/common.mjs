import { randomUUID } from "node:crypto";
import { access, mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";

const MAX_BODY_BYTES = 128 * 1024 * 1024;
const CHANGE_HISTORY_LIMIT = 240;

export function now() {
  return Date.now();
}

export function createEmptySnapshot() {
  return {
    deviceId: "server",
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

export function createEmptyEnvelope() {
  return {
    revision: null,
    snapshot: createEmptySnapshot(),
    metadata: null
  };
}

export function isEncryptedEnvelope(envelope) {
  return Boolean(
    envelope &&
      typeof envelope === "object" &&
      "encryptedSnapshot" in envelope &&
      envelope.encryptedSnapshot &&
      typeof envelope.encryptedSnapshot === "object"
  );
}

export function normalizeEncryptedPayload(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value;
  const version = typeof payload.version === "number" ? payload.version : 1;
  const cipher = payload.cipher === "aes-gcm-256" ? payload.cipher : null;
  const iv = typeof payload.iv === "string" ? payload.iv.trim() : "";
  const ciphertext = typeof payload.ciphertext === "string" ? payload.ciphertext.trim() : "";

  if (!cipher || !iv || !ciphertext) {
    return null;
  }

  return {
    version,
    cipher,
    iv,
    ciphertext
  };
}

export function createEmptyChangeSet(deviceId = "server") {
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

function normalizeEnvelopeMetadata(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const metadata = value;

  return {
    schemaVersion: typeof metadata.schemaVersion === "number" ? metadata.schemaVersion : 1,
    payloadMode: metadata.payloadMode === "encrypted" ? "encrypted" : "plain",
    vault: metadata.vault && typeof metadata.vault === "object" ? metadata.vault : null,
    encryption:
      metadata.encryption && typeof metadata.encryption === "object" ? metadata.encryption : null
  };
}

export function normalizeStoredEnvelope(value) {
  if (!value || typeof value !== "object") {
    return createEmptyEnvelope();
  }

  const revision = typeof value.revision === "string" ? value.revision : null;
  const metadata = normalizeEnvelopeMetadata(value.metadata);

  if (
    "encryptedSnapshot" in value &&
    value.encryptedSnapshot &&
    typeof value.encryptedSnapshot === "object"
  ) {
    return {
      revision,
      encryptedSnapshot: value.encryptedSnapshot,
      metadata
    };
  }

  return {
    revision,
    snapshot:
      value.snapshot && typeof value.snapshot === "object"
        ? value.snapshot
        : createEmptyEnvelope().snapshot,
    metadata
  };
}

export function buildNextEnvelope(snapshot, metadata = null) {
  return {
    revision: `rev-${Date.now()}-${randomUUID()}`,
    snapshot: {
      ...snapshot,
      exportedAt: Date.now()
    },
    metadata: normalizeEnvelopeMetadata(metadata)
  };
}

export async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

export async function readJsonFile(filePath, fallbackValue) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return fallbackValue;
    }

    throw error;
  }
}

export async function writeJsonFile(filePath, value) {
  await ensureDir(path.dirname(filePath));
  const directory = path.dirname(filePath);
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "w", 0o600);

  try {
    await handle.writeFile(JSON.stringify(value, null, 2), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  await rename(temporaryPath, filePath);

  // Best-effort directory sync makes the rename durable on filesystems that
  // support it, while keeping the personal server usable on constrained hosts.
  try {
    const directoryHandle = await open(directory, "r");
    await directoryHandle.sync();
    await directoryHandle.close();
  } catch {
    // The atomic rename above remains the safety boundary when directory fsync
    // is unavailable (for example on some Windows filesystems).
  }
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortObjectKeys(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = sortObjectKeys(value[key]);
      return result;
    }, {});
}

function stableStringify(value) {
  return JSON.stringify(sortObjectKeys(value));
}

function hashStableValue(value) {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `h${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function sortById(records) {
  return [...records].sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function sortTombstones(records) {
  return [...records].sort((left, right) => String(left.key).localeCompare(String(right.key)));
}

function getEntityKey(entityType, entityId) {
  return `${entityType}:${entityId}`;
}

function buildStateMap(entityType, records, tombstones, timestampAccessor) {
  const map = new Map();

  records.forEach((record) => {
    map.set(getEntityKey(entityType, record.id), {
      key: getEntityKey(entityType, record.id),
      hash: hashStableValue(record),
      deleted: false,
      timestamp: timestampAccessor(record),
      record
    });
  });

  tombstones
    .filter((tombstone) => tombstone.entityType === entityType)
    .forEach((tombstone) => {
      map.set(tombstone.key, {
        key: tombstone.key,
        hash: hashStableValue({
          deleted: true,
          deletedAt: tombstone.deletedAt
        }),
        deleted: true,
        timestamp: tombstone.deletedAt,
        tombstone
      });
    });

  return map;
}

export function isChangeSetEmpty(changeSet) {
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

export function normalizeChangeSet(payload, fallbackDeviceId = "server") {
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

function applyRecordsAndTombstones(maps, entityType, records, tombstones) {
  const recordMap = maps[entityType];

  records.forEach((record) => {
    recordMap.set(String(record.id), record);
    maps.tombstones.delete(getEntityKey(entityType, record.id));
  });

  tombstones
    .filter((tombstone) => tombstone.entityType === entityType)
    .forEach((tombstone) => {
      recordMap.delete(String(tombstone.entityId));
      maps.tombstones.set(tombstone.key, tombstone);
    });
}

export function applyChangeSetToSnapshot(snapshot, rawChangeSet) {
  const changeSet = normalizeChangeSet(rawChangeSet, snapshot?.deviceId ?? "server");
  const nextSnapshot = snapshot && typeof snapshot === "object" ? snapshot : createEmptySnapshot();
  const maps = {
    project: new Map((nextSnapshot.projects ?? []).map((record) => [String(record.id), record])),
    folder: new Map((nextSnapshot.folders ?? []).map((record) => [String(record.id), record])),
    tag: new Map((nextSnapshot.tags ?? []).map((record) => [String(record.id), record])),
    note: new Map((nextSnapshot.notes ?? []).map((record) => [String(record.id), record])),
    asset: new Map((nextSnapshot.assets ?? []).map((record) => [String(record.id), record])),
    task: new Map((nextSnapshot.tasks ?? []).map((record) => [String(record.id), record])),
    habit: new Map((nextSnapshot.habits ?? []).map((record) => [String(record.id), record])),
    habitLog: new Map((nextSnapshot.habitLogs ?? []).map((record) => [String(record.id), record])),
    goal: new Map((nextSnapshot.goals ?? []).map((record) => [String(record.id), record])),
    timeBlock: new Map((nextSnapshot.timeBlocks ?? []).map((record) => [String(record.id), record])),
    tombstones: new Map((nextSnapshot.tombstones ?? []).map((record) => [String(record.key), record]))
  };

  applyRecordsAndTombstones(maps, "project", changeSet.projects, changeSet.tombstones);
  applyRecordsAndTombstones(maps, "folder", changeSet.folders, changeSet.tombstones);
  applyRecordsAndTombstones(maps, "tag", changeSet.tags, changeSet.tombstones);
  applyRecordsAndTombstones(maps, "note", changeSet.notes, changeSet.tombstones);
  applyRecordsAndTombstones(maps, "asset", changeSet.assets, changeSet.tombstones);
  applyRecordsAndTombstones(maps, "task", changeSet.tasks, changeSet.tombstones);
  applyRecordsAndTombstones(maps, "habit", changeSet.habits, changeSet.tombstones);
  applyRecordsAndTombstones(maps, "habitLog", changeSet.habitLogs, changeSet.tombstones);
  applyRecordsAndTombstones(maps, "goal", changeSet.goals, changeSet.tombstones);
  applyRecordsAndTombstones(maps, "timeBlock", changeSet.timeBlocks, changeSet.tombstones);

  return {
    deviceId: changeSet.deviceId || nextSnapshot.deviceId || "server",
    exportedAt: changeSet.exportedAt || now(),
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
  };
}

export function buildChangeSetFromSnapshots(previousSnapshot, nextSnapshot) {
  const previous = previousSnapshot && typeof previousSnapshot === "object" ? previousSnapshot : createEmptySnapshot();
  const next = nextSnapshot && typeof nextSnapshot === "object" ? nextSnapshot : createEmptySnapshot();
  const changeSet = createEmptyChangeSet(next.deviceId || previous.deviceId || "server");

  changeSet.exportedAt = next.exportedAt || now();

  const entitySpecs = [
    ["project", next.projects ?? [], previous.projects ?? [], (record) => record.updatedAt],
    ["folder", next.folders ?? [], previous.folders ?? [], (record) => record.updatedAt],
    ["tag", next.tags ?? [], previous.tags ?? [], (record) => record.updatedAt],
    ["note", next.notes ?? [], previous.notes ?? [], (record) => record.updatedAt],
    ["asset", next.assets ?? [], previous.assets ?? [], (record) => record.updatedAt],
    ["task", next.tasks ?? [], previous.tasks ?? [], (record) => record.updatedAt],
    ["habit", next.habits ?? [], previous.habits ?? [], (record) => record.updatedAt],
    ["habitLog", next.habitLogs ?? [], previous.habitLogs ?? [], (record) => record.updatedAt],
    ["goal", next.goals ?? [], previous.goals ?? [], (record) => record.updatedAt],
    ["timeBlock", next.timeBlocks ?? [], previous.timeBlocks ?? [], (record) => record.updatedAt]
  ];

  entitySpecs.forEach(([entityType, nextRecords, previousRecords, timestampAccessor]) => {
    const nextMap = buildStateMap(entityType, nextRecords, next.tombstones ?? [], timestampAccessor);
    const previousMap = buildStateMap(entityType, previousRecords, previous.tombstones ?? [], timestampAccessor);
    const keys = new Set([...nextMap.keys(), ...previousMap.keys()]);

    keys.forEach((key) => {
      const nextState = nextMap.get(key) ?? null;
      const previousState = previousMap.get(key) ?? null;

      if (!nextState) {
        return;
      }

      if ((nextState?.hash ?? null) === (previousState?.hash ?? null)) {
        return;
      }

      if (nextState.deleted && nextState.tombstone) {
        changeSet.tombstones.push(nextState.tombstone);
        return;
      }

      if (nextState.record) {
        switch (entityType) {
          case "project":
            changeSet.projects.push(nextState.record);
            break;
          case "folder":
            changeSet.folders.push(nextState.record);
            break;
          case "tag":
            changeSet.tags.push(nextState.record);
            break;
          case "note":
            changeSet.notes.push(nextState.record);
            break;
          case "asset":
            changeSet.assets.push(nextState.record);
            break;
          case "task":
            changeSet.tasks.push(nextState.record);
            break;
          case "habit":
            changeSet.habits.push(nextState.record);
            break;
          case "habitLog":
            changeSet.habitLogs.push(nextState.record);
            break;
          case "goal":
            changeSet.goals.push(nextState.record);
            break;
          case "timeBlock":
            changeSet.timeBlocks.push(nextState.record);
            break;
        }
      }
    });
  });

  changeSet.projects = sortById(changeSet.projects);
  changeSet.folders = sortById(changeSet.folders);
  changeSet.tags = sortById(changeSet.tags);
  changeSet.notes = sortById(changeSet.notes);
  changeSet.assets = sortById(changeSet.assets);
  changeSet.tasks = sortById(changeSet.tasks);
  changeSet.habits = sortById(changeSet.habits);
  changeSet.habitLogs = sortById(changeSet.habitLogs);
  changeSet.goals = sortById(changeSet.goals);
  changeSet.timeBlocks = sortById(changeSet.timeBlocks);
  changeSet.tombstones = sortTombstones(changeSet.tombstones);

  return changeSet;
}

export function collapseChangeSets(changeSets) {
  const normalizedSets = Array.isArray(changeSets) ? changeSets.filter(Boolean) : [];
  const maps = {
    project: new Map(),
    folder: new Map(),
    tag: new Map(),
    note: new Map(),
    asset: new Map(),
    task: new Map(),
    habit: new Map(),
    habitLog: new Map(),
    goal: new Map(),
    timeBlock: new Map(),
    tombstones: new Map()
  };
  let deviceId = "server";
  let exportedAt = 0;

  normalizedSets.forEach((rawSet) => {
    const changeSet = normalizeChangeSet(rawSet, deviceId);
    deviceId = changeSet.deviceId || deviceId;
    exportedAt = Math.max(exportedAt, changeSet.exportedAt || 0);

    applyRecordsAndTombstones(maps, "project", changeSet.projects, changeSet.tombstones);
    applyRecordsAndTombstones(maps, "folder", changeSet.folders, changeSet.tombstones);
    applyRecordsAndTombstones(maps, "tag", changeSet.tags, changeSet.tombstones);
    applyRecordsAndTombstones(maps, "note", changeSet.notes, changeSet.tombstones);
    applyRecordsAndTombstones(maps, "asset", changeSet.assets, changeSet.tombstones);
    applyRecordsAndTombstones(maps, "task", changeSet.tasks, changeSet.tombstones);
    applyRecordsAndTombstones(maps, "habit", changeSet.habits, changeSet.tombstones);
    applyRecordsAndTombstones(maps, "habitLog", changeSet.habitLogs, changeSet.tombstones);
    applyRecordsAndTombstones(maps, "goal", changeSet.goals, changeSet.tombstones);
    applyRecordsAndTombstones(maps, "timeBlock", changeSet.timeBlocks, changeSet.tombstones);
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
  };
}

export function pruneChangeHistory(entries, limit = CHANGE_HISTORY_LIMIT) {
  if (!Array.isArray(entries) || entries.length <= limit) {
    return Array.isArray(entries) ? entries : [];
  }

  return entries.slice(entries.length - limit);
}

export function getBearerToken(request) {
  const authHeader = request.headers.authorization ?? "";

  if (!authHeader.startsWith("Bearer ")) {
    return "";
  }

  return authHeader.slice("Bearer ".length).trim();
}

export function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, PUT, POST, PATCH, DELETE, OPTIONS"
  });
  response.end(JSON.stringify(payload));
}

export function sendText(response, statusCode, contentType, payload) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*"
  });
  response.end(payload);
}

export async function collectBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;

      if (size > MAX_BODY_BYTES) {
        reject(new Error("PAYLOAD_TOO_LARGE"));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

export async function serveStaticAsset(response, baseDir, relativePath, contentType) {
  const payload = await readFile(path.join(baseDir, relativePath), "utf8");
  sendText(response, 200, contentType, payload);
}

export async function handleOptimisticSyncRoute({
  request,
  response,
  readEnvelope,
  writeEnvelope,
  onAfterWrite
}) {
  if (request.method === "GET") {
    sendJson(response, 200, await readEnvelope());
    return true;
  }

  const currentEnvelope = await readEnvelope();
  const payload = await collectBody(request);
  const baseRevision =
    payload && typeof payload === "object" && "baseRevision" in payload
      ? payload.baseRevision ?? null
      : null;
  const snapshot =
    payload && typeof payload === "object" && "snapshot" in payload && payload.snapshot
      ? payload.snapshot
      : null;
  const encryptedSnapshot =
    payload && typeof payload === "object" && "encryptedSnapshot" in payload && payload.encryptedSnapshot
      ? payload.encryptedSnapshot
      : null;
  const metadata =
    payload && typeof payload === "object" && "metadata" in payload ? normalizeEnvelopeMetadata(payload.metadata) : null;

  if (
    (!snapshot || typeof snapshot !== "object") &&
    (!encryptedSnapshot || typeof encryptedSnapshot !== "object")
  ) {
    sendJson(response, 400, { error: "SNAPSHOT_REQUIRED" });
    return true;
  }

  if (encryptedSnapshot && (!metadata || metadata.payloadMode !== "encrypted")) {
    sendJson(response, 400, { error: "ENCRYPTION_METADATA_REQUIRED" });
    return true;
  }

  if (snapshot && metadata?.payloadMode === "encrypted") {
    sendJson(response, 400, { error: "ENCRYPTED_SNAPSHOT_REQUIRED" });
    return true;
  }

  if (currentEnvelope.revision !== baseRevision) {
    sendJson(response, 409, currentEnvelope);
    return true;
  }

  const nextEnvelope =
    encryptedSnapshot && typeof encryptedSnapshot === "object"
      ? {
          revision: `rev-${Date.now()}-${randomUUID()}`,
          encryptedSnapshot,
          metadata
        }
      : buildNextEnvelope(snapshot, metadata);
  await writeEnvelope(nextEnvelope);
  await onAfterWrite?.(nextEnvelope, currentEnvelope);

  sendJson(response, 200, nextEnvelope);
  return true;
}

export function sendCorsNoContent(response) {
  response.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, PUT, POST, PATCH, DELETE, OPTIONS"
  });
  response.end();
}
