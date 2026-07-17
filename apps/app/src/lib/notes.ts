import type { Folder, Note, NoteContent, StoredBlock, Tag } from "../types";
import { formatDateTimeValue, getCurrentLocaleRuntime } from "../localization";

const FILE_BLOCK_TYPES = new Set(["image", "file", "audio", "video"]);
const TEXT_METADATA_KEYS = new Set([
  "type",
  "id",
  "props",
  "styles",
  "href",
  "url",
  "src",
  "name",
  "mimeType",
  "previewWidth",
  "caption"
]);

function normalizeStoredBlock(block: StoredBlock): StoredBlock {
  const normalizedChildren = Array.isArray(block.children)
    ? block.children.map((child) => normalizeStoredBlock(child))
    : [];

  if (!FILE_BLOCK_TYPES.has(block.type ?? "")) {
    return {
      ...block,
      children: normalizedChildren
    };
  }

  const record = block as StoredBlock & {
    url?: unknown;
    name?: unknown;
  };
  const props = {
    ...(record.props ?? {})
  };

  if (typeof props.url !== "string" && typeof record.url === "string") {
    props.url = record.url;
  }

  if (typeof props.name !== "string" && typeof record.name === "string") {
    props.name = record.name;
  }

  const { url: _legacyUrl, name: _legacyName, ...rest } = record;

  return {
    ...rest,
    props,
    children: normalizedChildren
  };
}

export function normalizeNoteContent(blocks: NoteContent): NoteContent {
  return blocks.map((block) => normalizeStoredBlock(block));
}

type ChecklistItemCheckedUpdate = {
  blocks: StoredBlock[];
  changed: boolean;
};

function updateChecklistItemCheckedInternal(
  blocks: StoredBlock[],
  blockId: string,
  checked: boolean
): ChecklistItemCheckedUpdate {
  let changed = false;

  const nextBlocks: StoredBlock[] = blocks.map((block) => {
    const normalizedChildren = Array.isArray(block.children) ? block.children : [];
    const childResult: ChecklistItemCheckedUpdate | null =
      normalizedChildren.length > 0
        ? updateChecklistItemCheckedInternal(normalizedChildren, blockId, checked)
        : null;

    if (block.id === blockId && block.type === "checkListItem") {
      changed = true;
      return {
        ...block,
        props: {
          ...(block.props ?? {}),
          checked
        },
        children: childResult?.blocks ?? normalizedChildren
      };
    }

    if (childResult?.changed) {
      changed = true;
      return {
        ...block,
        children: childResult.blocks
      };
    }

    return block;
  });

  return {
    blocks: changed ? nextBlocks : blocks,
    changed
  };
}

export function updateChecklistItemChecked(
  blocks: NoteContent,
  blockId: string,
  checked: boolean
) {
  return updateChecklistItemCheckedInternal(blocks, blockId, checked);
}

function isCheckedChecklistBlock(block: StoredBlock) {
  return block.type === "checkListItem" && Boolean(block.props?.checked);
}

type ChecklistStableOrderResolver = (block: StoredBlock, fallbackIndex: number) => number | null;

function getBlockId(block: StoredBlock) {
  return typeof block.id === "string" && block.id.length > 0 ? block.id : null;
}

function compareChecklistBlocks(
  left: StoredBlock,
  right: StoredBlock,
  leftStableOrder: number | null,
  rightStableOrder: number | null,
  leftIndex: number,
  rightIndex: number
) {
  const leftChecked = isCheckedChecklistBlock(left);
  const rightChecked = isCheckedChecklistBlock(right);

  if (leftChecked !== rightChecked) {
    return Number(leftChecked) - Number(rightChecked);
  }

  if (
    leftStableOrder !== null &&
    rightStableOrder !== null &&
    leftStableOrder !== rightStableOrder
  ) {
    return leftStableOrder - rightStableOrder;
  }

  if (leftStableOrder !== null && rightStableOrder === null) {
    return -1;
  }

  if (leftStableOrder === null && rightStableOrder !== null) {
    return 1;
  }

  return leftIndex - rightIndex;
}

function normalizeChecklistRun(
  blocks: StoredBlock[],
  getStableOrder?: ChecklistStableOrderResolver
) {
  if (blocks.length < 2) {
    return {
      blocks,
      changed: false
    };
  }

  const sorted = blocks
    .map((block, index) => ({
      block,
      index,
      stableOrder: getStableOrder?.(block, index) ?? null
    }))
    .sort((left, right) =>
      compareChecklistBlocks(
        left.block,
        right.block,
        left.stableOrder,
        right.stableOrder,
        left.index,
        right.index
      )
    )
    .map((entry) => entry.block);

  if (sorted.every((block, index) => block === blocks[index])) {
    return {
      blocks,
      changed: false
    };
  }

  return {
    blocks: sorted,
    changed: true
  };
}

function normalizeChecklistOrderingInternal(
  blocks: StoredBlock[],
  getStableOrder?: ChecklistStableOrderResolver
) {
  let changed = false;
  const normalizedBlocks = blocks.map((block) => {
    const childResult =
      Array.isArray(block.children) && block.children.length > 0
        ? normalizeChecklistOrderingInternal(block.children, getStableOrder)
        : null;

    if (childResult?.changed) {
      changed = true;
      return {
        ...block,
        children: childResult.blocks
      };
    }

    return block;
  });

  const reordered: StoredBlock[] = [];

  for (let index = 0; index < normalizedBlocks.length; ) {
    const block = normalizedBlocks[index];

    if (block.type !== "checkListItem") {
      reordered.push(block);
      index += 1;
      continue;
    }

    const runStart = index;

    while (index < normalizedBlocks.length && normalizedBlocks[index].type === "checkListItem") {
      index += 1;
    }

    const runResult = normalizeChecklistRun(
      normalizedBlocks.slice(runStart, index),
      getStableOrder
    );

    if (runResult.changed) {
      changed = true;
    }

    reordered.push(...runResult.blocks);
  }

  if (!changed && reordered.every((block, index) => block === blocks[index])) {
    return {
      blocks,
      changed: false
    };
  }

  return {
    blocks: reordered,
    changed
  };
}

export function normalizeChecklistOrdering(
  blocks: NoteContent,
  getStableOrder?: ChecklistStableOrderResolver
) {
  return normalizeChecklistOrderingInternal(blocks, getStableOrder);
}

function seedChecklistStableOrderRun(
  blocks: StoredBlock[],
  stableOrderMap: Map<string, number>
) {
  const ids = blocks.map((block) => getBlockId(block));
  const known = ids.map((id) => (id ? stableOrderMap.get(id) ?? null : null));
  let changed = false;
  let index = 0;

  while (index < blocks.length) {
    if (known[index] !== null) {
      index += 1;
      continue;
    }

    const start = index;

    while (index < blocks.length && known[index] === null) {
      index += 1;
    }

    const end = index - 1;
    const previousKnown = start > 0 ? known[start - 1] : null;
    const nextKnown = index < blocks.length ? known[index] : null;
    const gap = end - start + 1;

    for (let offset = 0; offset < gap; offset += 1) {
      const blockIndex = start + offset;
      const blockId = ids[blockIndex];

      if (!blockId) {
        continue;
      }

      let order: number;

      if (previousKnown !== null && nextKnown !== null) {
        const step = (nextKnown - previousKnown) / (gap + 1);
        order = previousKnown + step * (offset + 1);
      } else if (previousKnown !== null) {
        order = previousKnown + (offset + 1);
      } else if (nextKnown !== null) {
        order = nextKnown - (gap - offset);
      } else {
        order = blockIndex;
      }

      stableOrderMap.set(blockId, order);
      known[blockIndex] = order;
      changed = true;
    }
  }

  return changed;
}

function seedChecklistStableOrderMapInternal(
  blocks: StoredBlock[],
  stableOrderMap: Map<string, number>
) {
  let changed = false;

  for (let index = 0; index < blocks.length; ) {
    const block = blocks[index];

    if (block.type === "checkListItem") {
      const runStart = index;

      while (index < blocks.length && blocks[index].type === "checkListItem") {
        index += 1;
      }

      if (seedChecklistStableOrderRun(blocks.slice(runStart, index), stableOrderMap)) {
        changed = true;
      }

      continue;
    }

    if (Array.isArray(block.children) && block.children.length > 0) {
      if (seedChecklistStableOrderMapInternal(block.children, stableOrderMap)) {
        changed = true;
      }
    }

    index += 1;
  }

  return changed;
}

export function seedChecklistStableOrderMap(
  blocks: NoteContent,
  stableOrderMap: Map<string, number>
) {
  return seedChecklistStableOrderMapInternal(blocks, stableOrderMap);
}

export function sortChecklistBlocksForDisplay(blocks: StoredBlock[]) {
  if (blocks.length < 2 || blocks.some((block) => block.type !== "checkListItem")) {
    return blocks;
  }

  const hasChecked = blocks.some((block) => isCheckedChecklistBlock(block));
  const hasUnchecked = blocks.some((block) => !isCheckedChecklistBlock(block));

  if (!hasChecked || !hasUnchecked) {
    return blocks;
  }

  return [...blocks]
    .map((block, index) => ({ block, index }))
    .sort((left, right) =>
      compareChecklistBlocks(left.block, right.block, null, null, left.index, right.index)
    )
    .map((entry) => entry.block);
}

function collectText(value: unknown, parts: string[]) {
  if (typeof value === "string") {
    parts.push(value);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectText(entry, parts));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.text === "string") {
    parts.push(record.text);
  }

  Object.entries(record).forEach(([key, nestedValue]) => {
    if (key !== "text" && !TEXT_METADATA_KEYS.has(key)) {
      collectText(nestedValue, parts);
    }
  });
}

function walkBlocks(blocks: StoredBlock[], callback: (block: StoredBlock) => void) {
  blocks.forEach((block) => {
    callback(block);

    if (Array.isArray(block.children) && block.children.length > 0) {
      walkBlocks(block.children, callback);
    }
  });
}

export function extractPlainText(blocks: NoteContent) {
  const parts: string[] = [];

  walkBlocks(blocks, (block) => {
    collectText(block.content, parts);
  });

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function hasMeaningfulNoteContent(blocks: NoteContent) {
  let meaningful = false;

  walkBlocks(blocks, (block) => {
    if (meaningful) {
      return;
    }

    if (FILE_BLOCK_TYPES.has(block.type ?? "")) {
      meaningful = true;
      return;
    }

    const parts: string[] = [];
    collectText(block.content, parts);

    if (parts.join(" ").replace(/\s+/g, " ").trim().length > 0) {
      meaningful = true;
    }
  });

  return meaningful;
}

export function buildExcerpt(blocks: NoteContent, maxLength = 180) {
  const plainText = extractPlainText(blocks);

  if (!plainText) {
    return "";
  }

  if (plainText.length <= maxLength) {
    return plainText;
  }

  return `${plainText.slice(0, maxLength).trim()}...`;
}

export function countBlocks(blocks: NoteContent) {
  let total = 0;

  walkBlocks(blocks, () => {
    total += 1;
  });

  return total;
}

export function extractReferencedAssetIds(blocks: NoteContent) {
  const assetIds = new Set<string>();

  walkBlocks(blocks, (block) => {
    const url =
      typeof block.props?.url === "string"
        ? block.props.url
        : typeof (block as StoredBlock & { url?: unknown }).url === "string"
          ? (block as StoredBlock & { url: string }).url
          : null;

    if (url?.startsWith("asset://")) {
      assetIds.add(url.replace("asset://", ""));
    }
  });

  return [...assetIds];
}

export function remapReferencedAssetIds(
  blocks: NoteContent,
  assetIdMap: ReadonlyMap<string, string>
): NoteContent {
  const rewriteBlock = (block: StoredBlock): StoredBlock => {
    const nextChildren = Array.isArray(block.children)
      ? block.children.map((child) => rewriteBlock(child))
      : [];
    const nextProps = block.props ? { ...block.props } : undefined;
    const currentUrl =
      typeof nextProps?.url === "string"
        ? nextProps.url
        : typeof (block as StoredBlock & { url?: unknown }).url === "string"
          ? ((block as StoredBlock & { url: string }).url ?? "")
          : "";

    if (currentUrl.startsWith("asset://")) {
      const currentAssetId = currentUrl.replace("asset://", "");
      const nextAssetId = assetIdMap.get(currentAssetId);

      if (nextAssetId) {
        if (nextProps) {
          nextProps.url = `asset://${nextAssetId}`;
        }
      }
    }

    return {
      ...block,
      props: nextProps,
      children: nextChildren
    };
  };

  return blocks.map((block) => rewriteBlock(block));
}

export function buildFolderDepthMap(folders: Folder[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const depthMap = new Map<string, number>();

  const getDepth = (folderId: string): number => {
    if (depthMap.has(folderId)) {
      return depthMap.get(folderId)!;
    }

    const folder = byId.get(folderId);

    if (!folder || !folder.parentId) {
      depthMap.set(folderId, 0);
      return 0;
    }

    const depth = getDepth(folder.parentId) + 1;
    depthMap.set(folderId, depth);
    return depth;
  };

  folders.forEach((folder) => {
    getDepth(folder.id);
  });

  return depthMap;
}

export function flattenFolderOptions(folders: Folder[]) {
  const childrenByParent = new Map<string | null, Folder[]>();

  folders.forEach((folder) => {
    const bucket = childrenByParent.get(folder.parentId) ?? [];
    bucket.push(folder);
    childrenByParent.set(folder.parentId, bucket);
  });

  childrenByParent.forEach((bucket) => {
    bucket.sort((left, right) => left.name.localeCompare(right.name));
  });

  const result: Array<Folder & { depth: number }> = [];

  const visit = (parentId: string | null, depth: number) => {
    const bucket = childrenByParent.get(parentId) ?? [];

    bucket.forEach((folder) => {
      result.push({
        ...folder,
        depth
      });
      visit(folder.id, depth + 1);
    });
  };

  visit(null, 0);
  return result;
}

export function getDescendantFolderIds(folderId: string, folders: Folder[]) {
  const childrenByParent = new Map<string | null, string[]>();

  folders.forEach((folder) => {
    const bucket = childrenByParent.get(folder.parentId) ?? [];
    bucket.push(folder.id);
    childrenByParent.set(folder.parentId, bucket);
  });

  const visited = new Set<string>();
  const queue = [folderId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;

    if (visited.has(currentId)) {
      continue;
    }

    visited.add(currentId);
    (childrenByParent.get(currentId) ?? []).forEach((childId) => {
      queue.push(childId);
    });
  }

  return visited;
}

export function buildFolderPathMap(folders: Folder[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const pathMap = new Map<string, string>();

  const getPath = (folderId: string | null): string => {
    if (!folderId) {
      return "";
    }

    if (pathMap.has(folderId)) {
      return pathMap.get(folderId)!;
    }

    const folder = byId.get(folderId);

    if (!folder) {
      return "";
    }

    const parentPath = getPath(folder.parentId);
    const path = parentPath ? `${parentPath} / ${folder.name}` : folder.name;
    pathMap.set(folderId, path);
    return path;
  };

  folders.forEach((folder) => {
    getPath(folder.id);
  });

  return pathMap;
}

export function buildFolderCounts(notes: Note[], folders: Folder[]) {
  const counts = new Map<string, number>();

  folders.forEach((folder) => {
    const folderIds = getDescendantFolderIds(folder.id, folders);
    const count = notes.filter((note) => note.folderId && folderIds.has(note.folderId)).length;
    counts.set(folder.id, count);
  });

  return counts;
}

export function getFolderCascade(folderId: string, folders: Folder[], notes: Note[]) {
  const folderIds = getDescendantFolderIds(folderId, folders);
  const noteIds = notes
    .filter((note) => note.folderId && folderIds.has(note.folderId))
    .map((note) => note.id);

  return {
    folderIds: [...folderIds],
    noteIds
  };
}

export function buildTagCounts(notes: Note[], tags: Tag[]) {
  const counts = new Map<string, number>();

  tags.forEach((tag) => {
    counts.set(
      tag.id,
      notes.filter((note) => note.tagIds.includes(tag.id)).length
    );
  });

  return counts;
}

export function formatTimestamp(timestamp: number) {
  return formatDateTimeValue(timestamp, getCurrentLocaleRuntime(), {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function matchSearch(note: Note, search: string, tagMap: Map<string, Tag>) {
  const query = search.trim().toLowerCase();

  if (!query) {
    return true;
  }

  const tagNames = note.tagIds
    .map((tagId) => tagMap.get(tagId)?.name.toLowerCase() ?? "")
    .join(" ");

  return [note.title, note.excerpt, note.plainText, tagNames]
    .join(" ")
    .toLowerCase()
    .includes(query);
}
