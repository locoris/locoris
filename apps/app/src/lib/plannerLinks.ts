import type { Folder, Note, Project, TaskLink } from "../types";
import { deriveDisplayTitleFromText, normalizeDisplayName } from "./displayNames";

export const EDITOR_CREATE_TASK_EVENT = "locoris:editor-create-task";

export interface PlannerContextTaskInput {
  title: string;
  description?: string;
  projectId?: string | null;
  folderId?: string | null;
  noteId?: string | null;
  canvasId?: string | null;
  sourceBlockId?: string | null;
  canvasElementId?: string | null;
  sourceLabel?: string | null;
}

function createTaskLink(input: Omit<TaskLink, "id" | "createdAt">, createdAt: number): TaskLink {
  return {
    id: crypto.randomUUID(),
    createdAt,
    ...input
  };
}

export function normalizePlannerContextTaskTitle(value: string, fallback: string) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return fallback;
  }

  return normalized.length > 140 ? `${normalized.slice(0, 137).trim()}...` : normalized;
}

export function buildPlannerTaskLinks(input: {
  context: PlannerContextTaskInput;
  projects: Project[];
  folders: Folder[];
  notes: Note[];
  createdAt?: number;
}) {
  const { context, projects, folders, notes } = input;
  const createdAt = input.createdAt ?? Date.now();
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
  const noteMap = new Map(notes.map((note) => [note.id, note]));
  const links: TaskLink[] = [];
  const seenKeys = new Set<string>();
  const add = (key: string, link: Omit<TaskLink, "id" | "createdAt">) => {
    if (seenKeys.has(key)) {
      return;
    }

    seenKeys.add(key);
    links.push(createTaskLink(link, createdAt));
  };

  if (context.projectId) {
    const project = projectMap.get(context.projectId);
    add(`project:${context.projectId}`, {
      kind: "project",
      label: normalizeDisplayName(project?.name),
      projectId: context.projectId,
      folderId: null,
      noteId: null,
      canvasId: null,
      sourceBlockId: null,
      canvasElementId: null,
      url: null
    });
  }

  if (context.folderId) {
    const folder = folderMap.get(context.folderId);
    add(`folder:${context.folderId}`, {
      kind: "folder",
      label: normalizeDisplayName(folder?.name),
      projectId: context.projectId ?? folder?.projectId ?? null,
      folderId: context.folderId,
      noteId: null,
      canvasId: null,
      sourceBlockId: null,
      canvasElementId: null,
      url: null
    });
  }

  if (context.noteId) {
    const note = noteMap.get(context.noteId);
    add(`note:${context.noteId}`, {
      kind: "note",
      label: note
        ? normalizeDisplayName(note.title) || deriveDisplayTitleFromText(note.plainText || note.excerpt)
        : "",
      projectId: context.projectId ?? note?.projectId ?? null,
      folderId: context.folderId ?? note?.folderId ?? null,
      noteId: context.noteId,
      canvasId: null,
      sourceBlockId: null,
      canvasElementId: null,
      url: null
    });
  }

  if (context.canvasId) {
    const canvas = noteMap.get(context.canvasId);
    add(`canvas:${context.canvasId}`, {
      kind: "canvas",
      label: canvas
        ? normalizeDisplayName(canvas.title) || deriveDisplayTitleFromText(canvas.plainText || canvas.excerpt)
        : "",
      projectId: context.projectId ?? canvas?.projectId ?? null,
      folderId: context.folderId ?? canvas?.folderId ?? null,
      noteId: null,
      canvasId: context.canvasId,
      sourceBlockId: null,
      canvasElementId: null,
      url: null
    });
  }

  if (context.sourceBlockId) {
    add(`block:${context.sourceBlockId}`, {
      kind: "block",
      label: normalizeDisplayName(context.sourceLabel),
      projectId: context.projectId ?? null,
      folderId: context.folderId ?? null,
      noteId: context.noteId ?? null,
      canvasId: null,
      sourceBlockId: context.sourceBlockId,
      canvasElementId: null,
      url: null
    });
  }

  if (context.canvasElementId) {
    add(`canvasElement:${context.canvasElementId}`, {
      kind: "canvasElement",
      label: normalizeDisplayName(context.sourceLabel),
      projectId: context.projectId ?? null,
      folderId: context.folderId ?? null,
      noteId: null,
      canvasId: context.canvasId ?? null,
      sourceBlockId: null,
      canvasElementId: context.canvasElementId,
      url: null
    });
  }

  return links;
}
