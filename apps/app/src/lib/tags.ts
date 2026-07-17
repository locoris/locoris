import { createLocaleCollator, getCurrentLocaleRuntime } from "../localization";
import type { AppLanguage, Tag } from "../types";

export function normalizeTagName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeTagLookup(value: string) {
  return normalizeTagName(value).toLocaleLowerCase();
}

export function uniqueTagNames(values: string[]) {
  const uniqueValues: string[] = [];
  const seen = new Set<string>();

  values.forEach((value) => {
    const normalized = normalizeTagName(value);

    if (!normalized) {
      return;
    }

    const lookup = normalizeTagLookup(normalized);

    if (seen.has(lookup)) {
      return;
    }

    seen.add(lookup);
    uniqueValues.push(normalized);
  });

  return uniqueValues;
}

export function uniqueTagsByName(tags: Tag[]) {
  const uniqueTags: Tag[] = [];
  const seen = new Set<string>();

  tags.forEach((tag) => {
    const normalizedName = normalizeTagName(tag.name);

    if (!normalizedName) {
      return;
    }

    const lookup = normalizeTagLookup(normalizedName);

    if (seen.has(lookup)) {
      return;
    }

    seen.add(lookup);
    uniqueTags.push({
      ...tag,
      name: normalizedName
    });
  });

  return uniqueTags;
}

export function sortTagsByName(tags: Tag[], language: AppLanguage) {
  void language;
  const collator = createLocaleCollator(getCurrentLocaleRuntime(), {
    sensitivity: "base",
    numeric: true
  });

  return [...tags].sort((left, right) => collator.compare(left.name, right.name));
}
