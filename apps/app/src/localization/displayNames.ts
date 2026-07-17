import type { AppLanguage, Note, Project } from "../types";
import {
  deriveDisplayTitleFromText,
  normalizeDisplayName,
  stripLeadingPreviewPrefix
} from "../lib/displayNames";
import { translateApp } from "./translateInline";

export function getUntitledLabel(language: AppLanguage) {
  return translateApp(language, "note.untitled");
}

export function getEmptyPreviewLabel(language: AppLanguage) {
  return translateApp(language, "note.emptyPreview");
}

export function getDisplayNoteTitle(
  note: Pick<Note, "title" | "plainText" | "excerpt">,
  language: AppLanguage
) {
  const explicitTitle = normalizeDisplayName(note.title);

  if (explicitTitle) {
    return explicitTitle;
  }

  return deriveDisplayTitleFromText(note.plainText || note.excerpt) || getUntitledLabel(language);
}

export function getDisplayNotePreview(
  note: Pick<Note, "title" | "plainText" | "excerpt">,
  language: AppLanguage
) {
  const previewSource = normalizeDisplayName(note.excerpt || note.plainText);

  if (!previewSource) {
    return getEmptyPreviewLabel(language);
  }

  if (normalizeDisplayName(note.title)) {
    return previewSource;
  }

  const derivedTitle = deriveDisplayTitleFromText(previewSource);
  return stripLeadingPreviewPrefix(previewSource, derivedTitle) || getEmptyPreviewLabel(language);
}

export function getDisplayProjectName(
  project: Pick<Project, "name"> | null | undefined,
  language: AppLanguage,
  index?: number
) {
  const explicitName = normalizeDisplayName(project?.name);

  if (explicitName) {
    return explicitName;
  }

  const fallback = translateApp(language, "orbital.project");
  return typeof index === "number" && index >= 0 ? `${fallback} ${index + 1}` : fallback;
}

export function getDisplayVaultName(
  vault: { name: string } | null | undefined,
  language: AppLanguage,
  index?: number
) {
  const explicitName = normalizeDisplayName(vault?.name);

  if (explicitName) {
    return explicitName;
  }

  const fallback = translateApp(language, "app.vault");
  return typeof index === "number" && index >= 0 ? `${fallback} ${index + 1}` : fallback;
}
