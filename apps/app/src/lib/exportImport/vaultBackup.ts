import type { BinaryFileData, BinaryFiles, DataURL } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, FileId } from "@excalidraw/excalidraw/element/types";
import JSZip from "jszip";

import {
  exportLocalVaultDesktopBackup,
  persistLocalVaultStorage,
  restoreLocalVaultDesktopBackup
} from "../../data/db";
import type {
  AppLanguage,
  DesktopLocalVaultBackup,
  DesktopLocalVaultBackupAsset,
  Folder,
  Note,
  Project
} from "../../types";
import { getDisplayNoteTitle } from "../../localization/displayNames";
import { formatExportTimestamp, sanitizeExportFileName } from "./filenames";
import {
  blocksToMarkdown,
  buildNoteHtmlDocument
} from "./noteSerialization";
import {
  addReadableExportFontPack,
  getReadableExportFontCss
} from "./readableExportFonts";

export type VaultBackupParseResult = {
  backup: DesktopLocalVaultBackup;
  manifest: LocorisBackupManifest | null;
};

type LocorisBackupManifest = {
  format: "locoris-backup";
  formatVersion: 1;
  app: "Locoris";
  exportedAt: number;
  vaultName: string;
  localVaultId: string;
  schemaVersion: number;
};

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function assetToBlob(asset: DesktopLocalVaultBackupAsset) {
  return new Blob([base64ToBytes(asset.data)], { type: asset.mimeType || "application/octet-stream" });
}

function assetToDataUrl(asset: DesktopLocalVaultBackupAsset) {
  return `data:${asset.mimeType || "application/octet-stream"};base64,${asset.data}`;
}

function assertDesktopBackup(value: unknown): DesktopLocalVaultBackup {
  if (!value || typeof value !== "object") {
    throw new Error("VAULT_BACKUP_INVALID");
  }

  const record = value as Partial<DesktopLocalVaultBackup>;

  if (
    record.schemaVersion !== 1 ||
    !Array.isArray(record.projects) ||
    !Array.isArray(record.folders) ||
    !Array.isArray(record.tags) ||
    !Array.isArray(record.notes) ||
    !Array.isArray(record.assets)
  ) {
    throw new Error("VAULT_BACKUP_INVALID");
  }

  return record as DesktopLocalVaultBackup;
}

function createBackupManifest(input: {
  backup: DesktopLocalVaultBackup;
  vaultName: string;
}): LocorisBackupManifest {
  return {
    format: "locoris-backup",
    formatVersion: 1,
    app: "Locoris",
    exportedAt: Date.now(),
    vaultName: input.vaultName,
    localVaultId: input.backup.localVaultId,
    schemaVersion: input.backup.schemaVersion
  };
}

export function getVaultBackupFileName(vaultName: string) {
  return `${sanitizeExportFileName(vaultName, "Locoris Vault")}-${formatExportTimestamp()}.locorisbackup`;
}

export function getReadableVaultZipFileName(vaultName: string) {
  return `${sanitizeExportFileName(vaultName, "Locoris Vault")}-${formatExportTimestamp()}-readable.zip`;
}

export async function createLocorisBackupBlob(input: {
  localVaultId: string;
  vaultName: string;
}) {
  const backup = await exportLocalVaultDesktopBackup(input.localVaultId);

  if (!backup) {
    throw new Error("VAULT_BACKUP_EMPTY");
  }

  const zip = new JSZip();
  const manifest = createBackupManifest({ backup, vaultName: input.vaultName });

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("vault.json", JSON.stringify(backup, null, 2));

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.locoris.backup+zip",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
}

export async function parseLocorisBackupBlob(blob: Blob): Promise<VaultBackupParseResult> {
  try {
    const zip = await JSZip.loadAsync(blob);
    const manifestFile = zip.file("manifest.json");
    const vaultFile = zip.file("vault.json");

    if (!vaultFile) {
      throw new Error("VAULT_BACKUP_INVALID");
    }

    const manifest = manifestFile
      ? (JSON.parse(await manifestFile.async("text")) as LocorisBackupManifest)
      : null;
    const backup = assertDesktopBackup(JSON.parse(await vaultFile.async("text")));

    return { backup, manifest };
  } catch (zipError) {
    try {
      return {
        backup: assertDesktopBackup(JSON.parse(await blob.text())),
        manifest: null
      };
    } catch {
      throw zipError instanceof Error ? zipError : new Error("VAULT_BACKUP_INVALID");
    }
  }
}

export async function restoreLocorisBackupBlob(input: {
  localVaultId: string;
  blob: Blob;
}) {
  const parsed = await parseLocorisBackupBlob(input.blob);

  await restoreLocalVaultDesktopBackup(input.localVaultId, parsed.backup);
  await persistLocalVaultStorage(input.localVaultId);
  return parsed;
}

function getAssetMap(backup: DesktopLocalVaultBackup) {
  const assetMap = new Map<string, DesktopLocalVaultBackupAsset[]>();

  backup.assets.forEach((asset) => {
    const bucket = assetMap.get(asset.noteId) ?? [];
    bucket.push(asset);
    assetMap.set(asset.noteId, bucket);
  });

  return assetMap;
}

function compareReadableRecords(
  left: { sortOrder?: number; createdAt: number; id: string },
  right: { sortOrder?: number; createdAt: number; id: string }
) {
  const leftOrder = typeof left.sortOrder === "number" ? left.sortOrder : left.createdAt;
  const rightOrder = typeof right.sortOrder === "number" ? right.sortOrder : right.createdAt;

  return leftOrder - rightOrder || left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

function uniquePathSegment(value: string, used: Set<string>, fallback = "Untitled") {
  const base = sanitizeExportFileName(value, fallback);
  let candidate = base;
  let suffix = 2;

  while (used.has(candidate.toLowerCase())) {
    candidate = `${base} ${suffix}`;
    suffix += 1;
  }

  used.add(candidate.toLowerCase());
  return candidate;
}

function getScopedUsedSet(scopes: Map<string, Set<string>>, scope: string) {
  const existing = scopes.get(scope);

  if (existing) {
    return existing;
  }

  const next = new Set<string>();
  scopes.set(scope, next);
  return next;
}

function buildProjectReadablePathMap(projects: Project[]) {
  const usedProjectNames = new Set<string>();
  const projectPaths = new Map<string, string>();

  [...projects].sort(compareReadableRecords).forEach((project) => {
    projectPaths.set(project.id, uniquePathSegment(project.name, usedProjectNames, "Project"));
  });

  return projectPaths;
}

function buildFolderReadablePathMap(input: {
  folders: Folder[];
  projectPaths: Map<string, string>;
}) {
  const folderById = new Map(input.folders.map((folder) => [folder.id, folder]));
  const folderPaths = new Map<string, string>();
  const usedFolderNamesByScope = new Map<string, Set<string>>();
  const resolving = new Set<string>();

  const resolveFolderPath = (folder: Folder): string => {
    const cached = folderPaths.get(folder.id);

    if (cached) {
      return cached;
    }

    if (resolving.has(folder.id)) {
      return input.projectPaths.get(folder.projectId) ?? uniquePathSegment(folder.projectId, new Set(), "Project");
    }

    resolving.add(folder.id);

    const parentFolder = folder.parentId ? folderById.get(folder.parentId) ?? null : null;
    const parentPath =
      parentFolder && parentFolder.projectId === folder.projectId
        ? resolveFolderPath(parentFolder)
        : input.projectPaths.get(folder.projectId) ?? uniquePathSegment(folder.projectId, new Set(), "Project");
    const scope = `${folder.projectId}:${folder.parentId ?? "root"}`;
    const segment = uniquePathSegment(folder.name, getScopedUsedSet(usedFolderNamesByScope, scope), "Folder");
    const path = `${parentPath}/${segment}`;

    folderPaths.set(folder.id, path);
    resolving.delete(folder.id);
    return path;
  };

  [...input.folders].sort(compareReadableRecords).forEach((folder) => resolveFolderPath(folder));
  return folderPaths;
}

function buildNoteReadableBasePath(input: {
  note: Note;
  language: AppLanguage;
  projectPaths: Map<string, string>;
  folderPaths: Map<string, string>;
  usedDocumentNamesByScope: Map<string, Set<string>>;
}) {
  const projectPath = input.projectPaths.get(input.note.projectId) ?? "Project";
  const parentPath = input.note.folderId ? input.folderPaths.get(input.note.folderId) ?? projectPath : projectPath;
  const scope = input.note.folderId ? `folder:${input.note.folderId}` : `project:${input.note.projectId}`;
  const title = getDisplayNoteTitle(input.note, input.language);
  const segment = uniquePathSegment(
    title,
    getScopedUsedSet(input.usedDocumentNamesByScope, scope),
    input.note.contentType === "canvas" ? "Canvas" : "Document"
  );

  return `${parentPath}/${segment}`;
}

function addReadableAssets(input: {
  zip: JSZip;
  directory: string;
  assets: DesktopLocalVaultBackupAsset[];
}) {
  if (!input.assets.length) {
    return;
  }

  const usedAssetNames = new Set<string>();

  input.assets.forEach((asset) => {
    input.zip.file(
      `${input.directory}/${uniquePathSegment(asset.name, usedAssetNames, asset.id)}`,
      assetToBlob(asset)
    );
  });
}

function buildCanvasFiles(assets: DesktopLocalVaultBackupAsset[]): BinaryFiles {
  const files: BinaryFiles = {};

  assets.forEach((asset) => {
    files[asset.id] = {
      id: asset.id as FileId,
      dataURL: assetToDataUrl(asset) as DataURL,
      mimeType: asset.mimeType as BinaryFileData["mimeType"],
      created: asset.createdAt,
      lastRetrieved: asset.updatedAt
    };
  });

  return files;
}

function createReadableHtmlNote(input: {
  note: Note;
  assets: DesktopLocalVaultBackupAsset[];
  language: AppLanguage;
  additionalCss?: string;
}) {
  const { note, assets, language, additionalCss } = input;

  if (assets.length === 0) {
    return buildNoteHtmlDocument({ note, language, additionalCss });
  }

  const assetUrlById = new Map(assets.map((asset) => [asset.id, assetToDataUrl(asset)]));
  const content = JSON.parse(JSON.stringify(note.content)) as Note["content"];

  const replaceAssetUrls = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      value.forEach(replaceAssetUrls);
      return value;
    }

    if (!value || typeof value !== "object") {
      return value;
    }

    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      if (typeof entry === "string" && (key === "url" || key === "href") && entry.startsWith("asset://")) {
        const assetId = entry.replace("asset://", "");
        const dataUrl = assetUrlById.get(assetId);

        if (dataUrl) {
          (value as Record<string, unknown>)[key] = dataUrl;
        }
        return;
      }

      replaceAssetUrls(entry);
    });

    return value;
  };

  replaceAssetUrls(content);
  return buildNoteHtmlDocument({
    note: {
      ...note,
      content
    },
    language,
    additionalCss
  });
}

function formatPlannerDate(value: number | null | undefined) {
  return typeof value === "number" ? new Date(value).toISOString() : "";
}

function addReadablePlannerFiles(zip: JSZip, backup: DesktopLocalVaultBackup) {
  const planner = {
    tasks: backup.tasks ?? [],
    habits: backup.habits ?? [],
    habitLogs: backup.habitLogs ?? [],
    goals: backup.goals ?? [],
    timeBlocks: backup.timeBlocks ?? []
  };

  zip.folder("Planner");
  zip.file("Planner/planner.json", JSON.stringify(planner, null, 2));

  const tasksMarkdown = [...planner.tasks]
    .sort(compareReadableRecords)
    .map((task) =>
      [
        `- [${task.status === "done" ? "x" : " "}] ${task.title || "Untitled task"}`,
        `  - status: ${task.status}`,
        `  - kind: ${task.kind}`,
        `  - priority: ${task.priority}`,
        task.projectId ? `  - projectId: ${task.projectId}` : "",
        task.noteId ? `  - noteId: ${task.noteId}` : "",
        task.canvasId ? `  - canvasId: ${task.canvasId}` : "",
        task.sourceBlockId ? `  - sourceBlockId: ${task.sourceBlockId}` : "",
        task.dueAt ? `  - due: ${formatPlannerDate(task.dueAt)}` : "",
        task.scheduledStartAt ? `  - scheduled: ${formatPlannerDate(task.scheduledStartAt)}` : "",
        task.recurrenceRule ? `  - recurrence: ${task.recurrenceRule}` : "",
        task.description ? `  - description: ${task.description.replace(/\n/g, " ")}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");

  const habitsMarkdown = [...planner.habits]
    .sort(compareReadableRecords)
    .map((habit) =>
      [
        `- ${habit.title || "Untitled habit"}`,
        `  - status: ${habit.status}`,
        `  - frequency: ${habit.frequencyRule}`,
        `  - target: ${habit.targetCount} ${habit.targetUnit} / ${habit.targetPeriod}`,
        habit.projectId ? `  - projectId: ${habit.projectId}` : "",
        habit.description ? `  - description: ${habit.description.replace(/\n/g, " ")}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");

  const goalsMarkdown = [...planner.goals]
    .sort(compareReadableRecords)
    .map((goal) =>
      [
        `- ${goal.title || "Untitled goal"}`,
        `  - status: ${goal.status}`,
        goal.projectId ? `  - projectId: ${goal.projectId}` : "",
        goal.dueAt ? `  - due: ${formatPlannerDate(goal.dueAt)}` : "",
        goal.metricLabel ? `  - metric: ${goal.metricLabel}` : "",
        goal.targetValue !== null ? `  - targetValue: ${goal.targetValue}` : "",
        goal.currentValue !== null ? `  - currentValue: ${goal.currentValue}` : "",
        goal.description ? `  - description: ${goal.description.replace(/\n/g, " ")}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");

  const timeBlocksMarkdown = [...planner.timeBlocks]
    .sort((left, right) => left.startAt - right.startAt || left.id.localeCompare(right.id))
    .map((timeBlock) =>
      [
        `- ${timeBlock.title || "Untitled time block"}`,
        `  - status: ${timeBlock.status}`,
        `  - start: ${formatPlannerDate(timeBlock.startAt)}`,
        `  - end: ${formatPlannerDate(timeBlock.endAt)}`,
        timeBlock.taskId ? `  - taskId: ${timeBlock.taskId}` : "",
        timeBlock.projectId ? `  - projectId: ${timeBlock.projectId}` : "",
        timeBlock.noteId ? `  - noteId: ${timeBlock.noteId}` : "",
        timeBlock.canvasId ? `  - canvasId: ${timeBlock.canvasId}` : "",
        timeBlock.description ? `  - description: ${timeBlock.description.replace(/\n/g, " ")}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");

  zip.file("Planner/tasks.md", tasksMarkdown || "No tasks.");
  zip.file("Planner/habits.md", habitsMarkdown || "No habits.");
  zip.file("Planner/goals.md", goalsMarkdown || "No goals.");
  zip.file("Planner/time-blocks.md", timeBlocksMarkdown || "No time blocks.");
}

async function addCanvasReadableFiles(input: {
  zip: JSZip;
  basePath: string;
  note: Note;
  assets: DesktopLocalVaultBackupAsset[];
}) {
  const content = input.note.canvasContent;

  input.zip.file(`${input.basePath}.canvas.json`, JSON.stringify(content ?? { elements: [], appState: null }, null, 2));

  if (!content?.elements?.some((element) => !element.isDeleted)) {
    return;
  }

  try {
    const { exportToBlob } = await import("@excalidraw/excalidraw");
    const blob = await exportToBlob({
      elements: content.elements.filter((element) => !element.isDeleted) as unknown as ExcalidrawElement[],
      appState: {
        ...(content.appState ?? {}),
        exportBackground: true,
        exportWithDarkMode: false
      },
      files: buildCanvasFiles(input.assets),
      mimeType: "image/png",
      exportPadding: 32
    });

    input.zip.file(`${input.basePath}.png`, blob);
  } catch {
    input.zip.file(`${input.basePath}.canvas-preview-error.txt`, "Canvas preview could not be rendered during export.");
  }
}

export async function createReadableVaultZipBlob(input: {
  localVaultId: string;
  vaultName: string;
  language: AppLanguage;
}) {
  const backup = await exportLocalVaultDesktopBackup(input.localVaultId);

  if (!backup) {
    throw new Error("VAULT_BACKUP_EMPTY");
  }

  const zip = new JSZip();
  const projectPaths = buildProjectReadablePathMap(backup.projects);
  const folderPaths = buildFolderReadablePathMap({
    folders: backup.folders,
    projectPaths
  });
  const assetsByNote = getAssetMap(backup);
  const usedDocumentNamesByScope = new Map<string, Set<string>>();

  zip.file(
    "README.txt",
    [
      `Locoris readable export: ${input.vaultName}`,
      `Exported: ${new Date().toISOString()}`,
      "",
      "This archive is optimized for reading outside Locoris. Use .locorisbackup for exact restore.",
      "HTML notes use local fonts from _locoris/fonts. Font licenses are stored in _locoris/licenses/fonts."
    ].join("\n")
  );

  zip.file("manifest.json", JSON.stringify(createBackupManifest({ backup, vaultName: input.vaultName }), null, 2));
  const hasReadableFontPack = await addReadableExportFontPack(zip);
  addReadablePlannerFiles(zip, backup);

  [...projectPaths.values()].forEach((projectPath) => zip.folder(projectPath));
  [...folderPaths.values()].forEach((folderPath) => zip.folder(folderPath));

  for (const note of backup.notes.filter((entry) => !entry.trashedAt).sort(compareReadableRecords)) {
    const basePath = buildNoteReadableBasePath({
      note,
      language: input.language,
      projectPaths,
      folderPaths,
      usedDocumentNamesByScope
    });
    const assets = assetsByNote.get(note.id) ?? [];

    if (note.contentType === "canvas") {
      await addCanvasReadableFiles({
        zip,
        basePath,
        note,
        assets
      });
    } else {
      zip.file(`${basePath}.md`, blocksToMarkdown(note.content));
      zip.file(`${basePath}.html`, createReadableHtmlNote({
        note,
        assets,
        language: input.language,
        additionalCss: hasReadableFontPack ? getReadableExportFontCss(`${basePath}.html`) : undefined
      }));
    }

    addReadableAssets({
      zip,
      directory: `${basePath} assets`,
      assets
    });
  }

  return zip.generateAsync({
    type: "blob",
    mimeType: "application/zip",
    compression: "DEFLATE",
    compressionOptions: { level: 5 }
  });
}
