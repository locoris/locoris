export const GOOGLE_DRIVE_V2_FILE_PREFIX = "locoris-v2";
export const GOOGLE_DRIVE_V2_COMMIT_RETENTION_COUNT = 96;
export const GOOGLE_DRIVE_V2_COMMIT_RETENTION_BYTES = 12 * 1024 * 1024;
export const GOOGLE_DRIVE_V2_CHECKPOINT_RETENTION_COUNT = 4;

export type GoogleDriveV2FileKind = "checkpoint" | "commit";

export interface GoogleDriveV2FileMeta {
  id: string;
  name: string;
  createdTime: string;
  modifiedTime: string;
  size: number;
}

export interface GoogleDriveV2FileIdentity {
  kind: GoogleDriveV2FileKind;
  vaultId: string;
  recordId: string;
}

export interface GoogleDriveV2CheckpointLike {
  checkpointId: string;
  coveredCommitCount: number;
  appliedCommitIds: string[];
  createdAt: number;
}

export interface GoogleDriveV2CommitLike {
  commitId: string;
  createdAt: number;
}

function encodeFilePart(value: string) {
  return encodeURIComponent(value.trim()).replace(/\./g, "%2E");
}

function decodeFilePart(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

export function buildGoogleDriveV2FileName(
  kind: GoogleDriveV2FileKind,
  vaultId: string,
  recordId: string
) {
  return `${GOOGLE_DRIVE_V2_FILE_PREFIX}.${kind}.${encodeFilePart(vaultId)}.${encodeFilePart(recordId)}.json`;
}

export function parseGoogleDriveV2FileName(fileName: string): GoogleDriveV2FileIdentity | null {
  const prefix = `${GOOGLE_DRIVE_V2_FILE_PREFIX}.`;

  if (!fileName.startsWith(prefix) || !fileName.endsWith(".json")) {
    return null;
  }

  const body = fileName.slice(prefix.length, -".json".length);
  const firstSeparator = body.indexOf(".");
  const lastSeparator = body.lastIndexOf(".");

  if (firstSeparator <= 0 || lastSeparator <= firstSeparator) {
    return null;
  }

  const kind = body.slice(0, firstSeparator);

  if (kind !== "checkpoint" && kind !== "commit") {
    return null;
  }

  const vaultId = decodeFilePart(body.slice(firstSeparator + 1, lastSeparator));
  const recordId = decodeFilePart(body.slice(lastSeparator + 1));

  if (!vaultId || !recordId) {
    return null;
  }

  return {
    kind,
    vaultId,
    recordId
  };
}

export function sortGoogleDriveV2Files<T extends Pick<GoogleDriveV2FileMeta, "id" | "createdTime">>(
  files: readonly T[]
) {
  return [...files].sort((left, right) => {
    const leftTime = Date.parse(left.createdTime) || 0;
    const rightTime = Date.parse(right.createdTime) || 0;
    return leftTime - rightTime || left.id.localeCompare(right.id);
  });
}

export function selectGoogleDriveV2Checkpoint<T extends GoogleDriveV2CheckpointLike>(
  checkpoints: readonly T[]
) {
  return [...checkpoints].sort((left, right) => {
    return (
      right.coveredCommitCount - left.coveredCommitCount ||
      right.appliedCommitIds.length - left.appliedCommitIds.length ||
      right.createdAt - left.createdAt ||
      right.checkpointId.localeCompare(left.checkpointId)
    );
  })[0] ?? null;
}

export function collectGoogleDriveV2UnappliedCommits<T extends GoogleDriveV2CommitLike>(
  checkpoint: GoogleDriveV2CheckpointLike,
  commits: readonly T[]
) {
  const applied = new Set(checkpoint.appliedCommitIds);
  return commits.filter((commit) => !applied.has(commit.commitId));
}

function fnv1a(value: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildGoogleDriveV2Cursor(
  checkpoint: GoogleDriveV2CheckpointLike,
  commits: readonly GoogleDriveV2CommitLike[]
) {
  const identity = [
    checkpoint.checkpointId,
    String(checkpoint.coveredCommitCount),
    ...commits.map((commit) => commit.commitId).sort()
  ].join("|");

  return `gdrive-v2:${checkpoint.coveredCommitCount}:${fnv1a(identity)}`;
}

export function planGoogleDriveV2CommitRetention<T extends GoogleDriveV2FileMeta>(
  files: readonly T[],
  appliedCommitIds: ReadonlySet<string>,
  options: {
    maxCount?: number;
    maxBytes?: number;
  } = {}
) {
  const maxCount = options.maxCount ?? GOOGLE_DRIVE_V2_COMMIT_RETENTION_COUNT;
  const maxBytes = options.maxBytes ?? GOOGLE_DRIVE_V2_COMMIT_RETENTION_BYTES;
  const newestFirst = sortGoogleDriveV2Files(files).reverse();
  const retained = new Set<string>();
  let retainedBytes = 0;

  newestFirst.forEach((file) => {
    const identity = parseGoogleDriveV2FileName(file.name);
    const mustRetain = !identity || !appliedCommitIds.has(identity.recordId);
    const fitsCount = retained.size < maxCount;
    const fitsBytes = retainedBytes + Math.max(0, file.size) <= maxBytes;

    if (mustRetain || (fitsCount && fitsBytes)) {
      retained.add(file.id);
      retainedBytes += Math.max(0, file.size);
    }
  });

  return {
    retainedFileIds: retained,
    deleteFileIds: newestFirst
      .filter((file) => !retained.has(file.id))
      .map((file) => file.id),
    retainedBytes
  };
}
