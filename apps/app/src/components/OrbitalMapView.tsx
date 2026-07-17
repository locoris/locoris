import {
  cloneElement,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent
} from "react";
import { useTranslation } from "react-i18next";

import EntryStaticPreview from "./EntryStaticPreview";
import EditorSurfaceTransition from "./EditorSurfaceTransition";
import type { LocalVaultSwitcherItem } from "./LocalVaultSwitcher";
import OrbitalInspectorOverviewCard, {
  type OrbitalOverviewLinkId,
  type OrbitalOverviewLinkItem,
  type OrbitalOverviewProjectItem,
  type OrbitalOverviewRecentItem
} from "./OrbitalInspectorOverviewCard";
import OrbitalInspectorContextMenu, {
  type OrbitalInspectorContextMenuAction
} from "./OrbitalInspectorContextMenu";
import OrbitalInspectorSubviewHeader from "./OrbitalInspectorSubviewHeader";
import OrbitalMobileAccountSheet from "./OrbitalMobileAccountSheet";
import OrbitalMobileMoreSheet from "./OrbitalMobileMoreSheet";
import OrbitalCommandBar from "./orbital/OrbitalCommandBar";
import OrbitalMapControls from "./orbital/OrbitalMapControls";
import TemporalMapLayer, {
  type TemporalMapProjectNode
} from "./orbital/TemporalMapLayer";
import "./OrbitalChrome.css";
import "./OrbitalMobileShell.css";
import {
  getDisplayNoteTitle,
  getDisplayProjectName,
  getDisplayVaultName
} from "../localization/displayNames";
import { hasExplicitDisplayName } from "../lib/displayNames";
import {
  COLOR_PALETTE,
  DEFAULT_FOLDER_COLOR,
  DEFAULT_NOTE_COLOR,
  DEFAULT_PROJECT_COLOR
} from "../lib/palette";
import type { LocalVaultKind } from "../lib/localVaults";
import { getCanvasMetrics } from "../lib/canvas";
import { buildFolderPathMap, formatTimestamp } from "../lib/notes";
import { normalizeTagLookup, sortTagsByName, uniqueTagsByName } from "../lib/tags";
import type { AppRuntimeLayoutSnapshot } from "../lib/runtime";
import type {
  OrbitalAnimationMode,
  OrbitalTemporalSignalsMode
} from "../lib/interfacePreferences";
import { buildPlannerMapSignals } from "../lib/plannerMapSignals";
import type { PlannerViewId } from "../lib/planner";
import { useAndroidBackHandler } from "../lib/useAndroidBackHandler";
import type { AppLanguage, Asset, Folder, Note, Project, Tag, Task } from "../types";

type SceneNodeKind = "core" | "folder" | "note";
type OrbitalChild = { folder?: FolderBranch; note?: Note };
type InspectorMenu = "overview" | "notes" | "folders" | "tags" | "files" | "pinned" | "colors";
type InspectorHierarchyScope = "project" | "vault";
type OrbitalMobileSection = "vault" | "planner" | "map" | "pinned";
type OrbitalMobileNavSection = OrbitalMobileSection | "settings" | "account" | "more";
type OrbitalSurfaceMode = "map" | "planner";
type InspectorHierarchyItemKind = "core" | "folder" | "note" | "canvas";
type InspectorCompactIconKind =
  | InspectorHierarchyItemKind
  | "subfolder"
  | "tag"
  | "file"
  | "color"
  | "core";
type InspectorDocumentKindFilter = "note" | "canvas";

const PROJECT_DRAG_THRESHOLD_PX = 5;
const ORBITAL_NODE_POSITION_EASE_MS = 180;
const ORBITAL_NODE_POSITION_SNAP_DISTANCE = 0.18;
const LOW_DENSITY_DPR_THRESHOLD = 1.5;
const HIERARCHY_SORT_ORDER_STEP = 1024;
const DEFAULT_INTERFACE_ACCENT = "var(--accent-theme-primary, var(--gold))";

type SettingsOpenRequest = {
  view: "accountCloud" | "sync";
  requestId: number;
};

type WebAccessStatus = {
  tone: "default" | "success" | "warning" | "error";
  text: string;
  compactText?: string;
  title: string;
  description: string;
  primaryActionLabel: string;
  secondaryActionLabel?: string;
  metaItems?: Array<{
    label: string;
    value: string;
    tone?: "default" | "success" | "warning" | "error";
  }>;
  meters?: Array<{
    label: string;
    valueLabel: string;
    ratio: number | null;
    tone?: "default" | "success" | "warning" | "error";
  }>;
  notice?: string;
};

interface OrbitalMapViewProps {
  projects: Project[];
  folders: Folder[];
  notes: Note[];
  tags: Tag[];
  assets: Asset[];
  tasks: Task[];
  assetCount: number;
  language: AppLanguage;
  adaptiveLayout: AppRuntimeLayoutSnapshot;
  orbitalAnimationMode: OrbitalAnimationMode;
  orbitalTemporalSignalsMode: OrbitalTemporalSignalsMode;
  projectFocusRequest?: {
    projectId: string;
    requestId: number;
  } | null;
  activeLocalVaultId: string;
  localVaultOptions: LocalVaultSwitcherItem[];
  syncStatusChip?: {
    tone: "default" | "success" | "warning" | "error";
    text: string;
    compactText?: string;
    title?: string;
  };
  syncTransportChip?: {
    tone: "default" | "success" | "warning" | "error";
    text: string;
    title?: string;
  } | null;
  webAccessStatus?: WebAccessStatus | null;
  updateChip?: {
    text: string;
    title?: string;
  } | null;
  editorOpen: boolean;
  editorMode?: Note["contentType"] | null;
  editorContentKey?: string | null;
  editorSlot: ReactNode;
  plannerSlot?: ReactNode;
  editorTitle?: string;
  editorAccentColor?: string | null;
  settingsModalSlot?: ReactNode;
  settingsOpenRequest?: SettingsOpenRequest | null;
  onSettingsOpenRequestHandled?: () => void;
  trashModalSlot?: ReactNode;
  showClose?: boolean;
  onClose: () => void;
  onOrbitalAnimationModeChange: (mode: OrbitalAnimationMode) => void;
  onSelectLocalVault: (localVaultId: string) => void;
  onCreateLocalVault?: (input: {
    name: string;
    vaultKind: LocalVaultKind;
    passphrase?: string;
  }) => string | void | Promise<string | void>;
  onRenameLocalVault?: (localVaultId: string, name: string) => Promise<void> | void;
  onCloseEditor: () => void;
  onCreateProject: (x: number, y: number, name?: string) => Promise<Project>;
  onRenameProject: (projectId: string, name: string) => Promise<void> | void;
  onUpdateProjectPosition: (projectId: string, x: number, y: number) => void;
  onUpdateProjectSortOrder: (projectId: string, sortOrder: number) => void;
  onUpdateProjectColor: (projectId: string, color: string) => void;
  onDeleteProject: (projectId: string) => Promise<boolean | void> | boolean | void;
  onCreateFolder: (
    name: string,
    parentId: string | null,
    color?: string,
    projectId?: string
  ) => Promise<Folder>;
  onRenameFolder: (folderId: string, name: string) => Promise<void> | void;
  onUpdateFolderColor: (folderId: string, color: string) => void;
  onDeleteFolder: (folderId: string) => Promise<boolean | void> | boolean | void;
  onMoveFolder: (
    folderId: string,
    parentId: string | null,
    projectId?: string,
    sortOrder?: number
  ) => Promise<void> | void;
  onMoveNote: (
    noteId: string,
    folderId: string | null,
    projectId?: string,
    sortOrder?: number
  ) => Promise<void> | void;
  onDuplicateFolder: (
    folderId: string,
    parentId: string | null,
    projectId?: string,
    sortOrder?: number
  ) => Promise<Folder | null> | Folder | null;
  onDuplicateNote: (
    noteId: string,
    folderId: string | null,
    projectId?: string,
    sortOrder?: number
  ) => Promise<Note | null> | Note | null;
  onRenameNote: (noteId: string, name: string) => Promise<void> | void;
  onUpdateNoteColor: (noteId: string, color: string) => void;
  onSetNotePinned: (noteId: string, pinned: boolean) => Promise<void> | void;
  onDeleteNote: (noteId: string) => Promise<boolean | void> | boolean | void;
  onCreateNote: (folderId: string | null, projectId?: string) => Promise<Note>;
  onCreateCanvas: (folderId: string | null, projectId?: string) => Promise<Note>;
  onOpenNote: (noteId: string) => void;
  onOpenProjectPlan?: (projectId: string) => void;
  onOpenPlannerView?: (viewId: PlannerViewId) => void;
  onOpenWebAccess?: () => void;
  onExportWebVault?: () => void | Promise<void>;
  onToggleNoteChecklistItem?: (
    noteId: string,
    blockId: string,
    checked: boolean
  ) => Promise<void> | void;
  onResolveFileUrl?: (url: string) => Promise<string>;
  labels: {
    title: string;
    subtitle: string;
    close: string;
    mapMode: string;
    plannerMode: string;
    pause: string;
    resume: string;
    zoomIn: string;
    zoomOut: string;
    resetView: string;
    centerSelection: string;
    focusMode: string;
    showAll: string;
    autoFocus: string;
    visibleBodies: string;
    hiddenBodies: string;
    focusedSystem: string;
    openNote: string;
    openCanvas: string;
    enterFullscreen: string;
    exitFullscreen: string;
    closeEditor: string;
    addRootFolder: string;
    addChildFolder: string;
    addNote: string;
    addCanvas: string;
    openProjectPlan: string;
    addProject: string;
    create: string;
    cancel: string;
    folderNamePlaceholder: string;
    previousProject: string;
    nextProject: string;
    project: string;
    system: string;
    core: string;
    folder: string;
    note: string;
    canvas: string;
    uncategorized: string;
    rootFolders: string;
    directNotes: string;
    subfolders: string;
    descendants: string;
    updated: string;
    empty: string;
    emptyCanvas: string;
    canvasPreviewHint: string;
    hints: string;
    settings: string;
    trash: string;
    closeModal: string;
    overview: string;
    vaultOverview: string;
    activeSystem: string;
    vaultProfile: string;
    vaultSync: string;
    vaultActivity: string;
    vaultStructure: string;
    overviewSections: string;
    lastUpdated: string;
    trashStat: string;
    vaultRegular: string;
    vaultPrivate: string;
    searchPlaceholder: string;
    clearFilters: string;
    back: string;
    documentsMenu: string;
    notesMenu: string;
    foldersMenu: string;
    hierarchyScopeVault: string;
    hierarchyScopeProject: string;
    expandHierarchy: string;
    collapseHierarchy: string;
    tagsMenu: string;
    filesMenu: string;
    pinnedMenu: string;
    colorsMenu: string;
    maxDepthReached: string;
    projectColor: string;
    folderColor: string;
    noteColor: string;
    chooseColor: string;
    customColor: string;
    copyAction: string;
    pasteAction: string;
    duplicateAction: string;
    goToLocationAction: string;
    selectedCount: string;
    clipboardEmpty: string;
    moveBlockedDepth: string;
    moveBlockedInvalid: string;
    moveBlockedMissingTarget: string;
    deleteSelection: string;
    deleteSystem: string;
    deleteFolder: string;
    moveToTrash: string;
    notesStat: string;
    elementsStat: string;
    foldersStat: string;
    tagsStat: string;
    assetsStat: string;
    pinnedStat: string;
    colorsStat: string;
    projectsStat: string;
    localVault: string;
    renameAction: string;
    totalBodies: string;
  };
}

interface FolderBranch {
  folder: Folder;
  children: FolderBranch[];
  notes: Note[];
  directNoteCount: number;
  descendantNoteCount: number;
  descendantFolderCount: number;
  mass: number;
  depth: number;
}

interface OrbitalData {
  projects: Project[];
  rootFoldersByProject: Map<string, FolderBranch[]>;
  looseNotesByProject: Map<string, Note[]>;
  visibleNoteCount: number;
  totalEntities: number;
  folderMeta: Map<
    string,
    {
      directNoteCount: number;
      descendantNoteCount: number;
      descendantFolderCount: number;
      depth: number;
      mass: number;
    }
  >;
  foldersByParent: Map<string | null, Folder[]>;
  notesByFolder: Map<string | null, Note[]>;
  projectById: Map<string, Project>;
  folderById: Map<string, Folder>;
  noteById: Map<string, Note>;
}

interface OrbitalSceneOrbit {
  id: string;
  entityId: string;
  parentEntityId: string;
  color: string;
  x: number;
  y: number;
  rx: number;
  ry: number;
  rotation: number;
  depth: number;
  kind: Exclude<SceneNodeKind, "core">;
}

interface OrbitalSceneLink {
  id: string;
  entityId: string;
  parentEntityId: string;
  color: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  depth: number;
  kind: Exclude<SceneNodeKind, "core">;
}

interface OrbitalSceneNode {
  id: string;
  entityId: string;
  parentEntityId: string | null;
  kind: SceneNodeKind;
  label: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  depth: number;
  note?: Note;
  folder?: Folder;
  project?: Project;
  mass: number;
  favorite?: boolean;
  pinned?: boolean;
  orbit?: Omit<OrbitalSceneOrbit, "id" | "entityId" | "kind" | "parentEntityId" | "depth">;
}

interface OrbitalScene {
  nodes: OrbitalSceneNode[];
  orbits: OrbitalSceneOrbit[];
  links: OrbitalSceneLink[];
  entityMap: Map<string, OrbitalSceneNode>;
}

type OrbitalScenePosition = {
  x: number;
  y: number;
};

type OrbitalVisualTone = "primary" | "direct" | "secondary" | "muted";

interface InspectorHierarchyItem {
  id: string;
  entityId: string;
  kind: InspectorHierarchyItemKind;
  label: string;
  color: string;
  project?: Project;
  folder?: Folder;
  note?: Note;
  searchText: string;
  children: InspectorHierarchyItem[];
}

interface OrbitalLayoutOrbit {
  color: string;
  rx: number;
  ry: number;
  rotation: number;
  rotationCos: number;
  rotationSin: number;
  speed: number;
  direction: 1 | -1;
  baseAngle: number;
  wobble: number;
}

interface OrbitalLayoutNode {
  id: string;
  entityId: string;
  parentEntityId: string | null;
  kind: SceneNodeKind;
  label: string;
  radius: number;
  color: string;
  depth: number;
  note?: Note;
  folder?: Folder;
  project?: Project;
  mass: number;
  favorite?: boolean;
  pinned?: boolean;
  x?: number;
  y?: number;
  orbit?: OrbitalLayoutOrbit;
  children: OrbitalLayoutNode[];
}

interface OrbitalLayout {
  roots: OrbitalLayoutNode[];
  entityMap: Map<string, OrbitalLayoutNode>;
}

type HoverPreviewAnchorRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

type HoverPreviewAnchorSource = "scene" | "inspector";
type OrbitalChildKind = "folder" | "canvas" | "note";
type InspectorContextMenuTarget =
  | {
      kind: "core";
      project: Project;
      label: string;
      color: string;
    }
  | {
      kind: "folder";
      folder: Folder;
      label: string;
      color: string;
      canCreateFolder: boolean;
    }
  | {
      kind: "note" | "canvas";
      note: Note;
      label: string;
      color: string;
      pinned: boolean;
    };

type InspectorContextMenuState = {
  target: InspectorContextMenuTarget;
  presentation: "popover" | "sheet";
  position?: {
    x: number;
    y: number;
  } | null;
};

type InspectorRenameState = {
  kind: InspectorContextMenuTarget["kind"];
  id: string;
};

type InspectorSelectableTarget = Extract<
  InspectorContextMenuTarget,
  { kind: "folder" | "note" | "canvas" }
>;

type InspectorClipboardItem =
  | { kind: "folder"; id: string }
  | { kind: "note" | "canvas"; id: string };

type InspectorDropPlacement = "inside" | "before" | "after";
type MobileMoveDestination = {
  entityId: string;
  kind: "project" | "folder";
  projectId: string;
  parentId: string | null;
  label: string;
  color: string;
  issue?: string | null;
};

type MobileMoveConflict = {
  item: InspectorClipboardItem;
  currentName: string;
  suggestedName: string;
};

type MobileMoveConflictState = {
  destination: MobileMoveDestination;
  conflicts: MobileMoveConflict[];
};

type InspectorDropIntent = {
  targetEntityId: string;
  placement: InspectorDropPlacement;
};

const VIEWBOX = {
  minX: -980,
  minY: -720,
  width: 1960,
  height: 1440
};

const CAMERA_MIN_SCALE = 0.45;
const CAMERA_MAX_SCALE = 2.2;
const ORBITAL_SCENE_BODY_BUDGET = 70;
const PROJECT_MIN_DISTANCE = 430;
const ORBIT_INTERACTION_WINDOW_MS = 1800;
const ORBIT_ACTIVE_FRAME_MS = 1000 / 25;
const ORBIT_IDLE_FRAME_MS = 1000 / 10;
const ORBIT_ACTIVE_FRAME_MS_LARGE = 1000 / 15;
const ORBIT_IDLE_FRAME_MS_LARGE = 1000 / 7;
const ORBIT_ANDROID_ACTIVE_FRAME_MS = 1000 / 24;
const ORBIT_ANDROID_IDLE_FRAME_MS = 1000 / 20;
const ORBIT_ANDROID_ACTIVE_FRAME_MS_LARGE = 1000 / 18;
const ORBIT_ANDROID_IDLE_FRAME_MS_LARGE = 1000 / 14;
const INSPECTOR_LONG_PRESS_MS = 460;
const INSPECTOR_LONG_PRESS_MOVE_TOLERANCE = 12;
const GENERATED_CANVAS_ASSET_NAME_RE = /^canvas-[a-f0-9]{8}\.[a-z0-9]+$/i;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toHoverPreviewAnchorRect(
  rect: Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">
): HoverPreviewAnchorRect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
    centerX: rect.left + rect.width / 2,
    centerY: rect.top + rect.height / 2
  };
}

function hashString(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function getAssetBlobFileName(blob: Blob) {
  if (typeof File === "undefined" || !(blob instanceof File)) {
    return null;
  }

  const trimmed = blob.name.trim();

  if (!trimmed || trimmed.toLowerCase() === "blob") {
    return null;
  }

  return trimmed;
}

function getAssetDisplayName(asset: Asset) {
  const storedName = asset.name.trim();
  const blobFileName = getAssetBlobFileName(asset.blob);

  if (blobFileName && (storedName.length === 0 || GENERATED_CANVAS_ASSET_NAME_RE.test(storedName))) {
    return blobFileName;
  }

  if (storedName.length > 0) {
    return storedName;
  }

  return blobFileName ?? "file";
}

function formatAssetSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) {
    return "";
  }

  if (size < 1024) {
    return `${Math.round(size)} B`;
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${Math.round((size / (1024 * 1024)) * 10) / 10} MB`;
}

function seededUnit(seed: number, shift: number) {
  return ((seed >>> shift) % 1024) / 1023;
}

function isEditableTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;

  if (!element) {
    return false;
  }

  const tagName = element.tagName.toLowerCase();
  return (
    element.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    Boolean(element.closest("[contenteditable='true']"))
  );
}

function isEntryFavorite(entry: { favorite?: boolean; pinned?: boolean }) {
  return Boolean(entry.pinned || entry.favorite);
}

function noteSorter(left: Note, right: Note) {
  const leftFavorite = isEntryFavorite(left);
  const rightFavorite = isEntryFavorite(right);

  if (leftFavorite !== rightFavorite) {
    return leftFavorite ? -1 : 1;
  }

  if (left.pinned !== right.pinned) {
    return left.pinned ? -1 : 1;
  }

  return right.updatedAt - left.updatedAt;
}

function getHierarchySortOrder(record: { sortOrder?: number; createdAt: number }) {
  return typeof record.sortOrder === "number" ? record.sortOrder : record.createdAt;
}

function compareHierarchyRecords(
  left: { sortOrder?: number; createdAt: number; id: string },
  right: { sortOrder?: number; createdAt: number; id: string }
) {
  const sortDelta = getHierarchySortOrder(left) - getHierarchySortOrder(right);

  if (sortDelta !== 0) {
    return sortDelta;
  }

  const createdDelta = left.createdAt - right.createdAt;

  if (createdDelta !== 0) {
    return createdDelta;
  }

  return left.id.localeCompare(right.id);
}

function getHierarchyItemSortOrder(item: InspectorHierarchyItem) {
  if (item.folder) {
    return getHierarchySortOrder(item.folder);
  }

  if (item.note) {
    return getHierarchySortOrder(item.note);
  }

  return item.project ? getHierarchySortOrder(item.project) : 0;
}

function getNoteMass(note: Note) {
  const favoriteWeight = isEntryFavorite(note) ? 0.45 : 0;

  if (note.contentType === "canvas") {
    const metrics = getCanvasMetrics(note.canvasContent, { includePlainText: false });
    return (
      1.18 +
      metrics.activeElementCount / 18 +
      metrics.imageCount * 0.28 +
      favoriteWeight
    );
  }

  return 1.08 + note.plainText.length / 240 + favoriteWeight;
}

function getOrbitalEntryRadius(note: Note, depth: number) {
  if (note.contentType === "canvas") {
    const metrics = getCanvasMetrics(note.canvasContent, { includePlainText: false });
    const depthOffset = depth === 0 ? 1.8 : depth === 1 ? 0.6 : -0.3;
    return clamp(
      10 + Math.min(metrics.activeElementCount / 6, 7.2) + (isEntryFavorite(note) ? 1.2 : 0) + depthOffset,
      9.6,
      depth === 0 ? 20 : 17.4
    );
  }

  const depthOffset = depth === 0 ? 1.5 : depth === 1 ? 0.45 : -0.2;
  return clamp(
    9 + Math.min(note.plainText.length / 180, 6.4) + (isEntryFavorite(note) ? 1.2 : 0) + depthOffset,
    8.8,
    depth === 0 ? 18.6 : 16.8
  );
}

function truncateLabel(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function estimateLabelWidth(value: string) {
  return clamp(value.length * 7.3 + 24, 72, 198);
}

function buildStarburstPoints(innerRadius: number, outerRadius: number, points: number) {
  return Array.from({ length: points * 2 }, (_, index) => {
    const angle = (Math.PI / points) * index - Math.PI / 2;
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    return `${Math.cos(angle) * radius},${Math.sin(angle) * radius}`;
  }).join(" ");
}

function getChildEntityId(child: OrbitalChild) {
  return child.folder ? `folder:${child.folder.folder.id}` : `note:${child.note!.id}`;
}

function getOrbitalChildKind(child: OrbitalChild): OrbitalChildKind {
  if (child.folder) {
    return "folder";
  }

  return child.note?.contentType === "canvas" ? "canvas" : "note";
}

function getOrbitalChildCreatedAt(child: OrbitalChild) {
  return child.folder?.folder.createdAt ?? child.note?.createdAt ?? 0;
}

function getOrbitalChildSortOrder(child: OrbitalChild) {
  return child.folder
    ? getHierarchySortOrder(child.folder.folder)
    : child.note
      ? getHierarchySortOrder(child.note)
      : 0;
}

function getOrbitalChildStableId(child: OrbitalChild) {
  return child.folder?.folder.id ?? child.note?.id ?? "";
}

function getOrbitalChildGroupOrder(kind: OrbitalChildKind) {
  if (kind === "folder") {
    return 0;
  }

  if (kind === "canvas") {
    return 1;
  }

  return 2;
}

function compareOrbitalChildren(left: OrbitalChild, right: OrbitalChild) {
  const sortDelta = getOrbitalChildSortOrder(left) - getOrbitalChildSortOrder(right);

  if (sortDelta !== 0) {
    return sortDelta;
  }

  const leftKind = getOrbitalChildKind(left);
  const rightKind = getOrbitalChildKind(right);
  const groupDelta = getOrbitalChildGroupOrder(leftKind) - getOrbitalChildGroupOrder(rightKind);

  if (groupDelta !== 0) {
    return groupDelta;
  }

  const createdAtDelta = getOrbitalChildCreatedAt(left) - getOrbitalChildCreatedAt(right);

  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return getOrbitalChildStableId(left).localeCompare(getOrbitalChildStableId(right));
}

type OrbitPlanningProfile = {
  innerPadding: number;
  laneGap: number;
  planeRatio: number;
  rotationRange: number;
  wobbleRange: number;
  kindBandOffset: Record<OrbitalChildKind, number>;
  transitionGap: {
    folderToCanvas: number;
    folderToNote: number;
    canvasToNote: number;
  };
  speedRange: {
    min: number;
    max: number;
  };
};

function getOrbitPlanningProfile(
  parentKind: SceneNodeKind,
  depth: number
): OrbitPlanningProfile {
  if (parentKind === "core") {
    return {
      innerPadding: 188,
      laneGap: 28,
      planeRatio: 0.64,
      rotationRange: 8,
      wobbleRange: 0.022,
      kindBandOffset: {
        folder: 0,
        canvas: 42,
        note: 82
      },
      transitionGap: {
        folderToCanvas: 34,
        folderToNote: 58,
        canvasToNote: 24
      },
      speedRange: {
        min: 0.000014,
        max: 0.00003
      }
    };
  }

  if (depth <= 1) {
    return {
      innerPadding: 126,
      laneGap: 18,
      planeRatio: 0.76,
      rotationRange: 5,
      wobbleRange: 0.014,
      kindBandOffset: {
        folder: 0,
        canvas: 30,
        note: 58
      },
      transitionGap: {
        folderToCanvas: 24,
        folderToNote: 40,
        canvasToNote: 18
      },
      speedRange: {
        min: 0.000006,
        max: 0.000015
      }
    };
  }

  return {
    innerPadding: 108,
    laneGap: 14,
    planeRatio: 0.82,
    rotationRange: 3.5,
    wobbleRange: 0.008,
    kindBandOffset: {
      folder: 0,
      canvas: 24,
      note: 46
    },
    transitionGap: {
      folderToCanvas: 18,
      folderToNote: 30,
      canvasToNote: 14
    },
    speedRange: {
      min: 0.0000024,
      max: 0.0000072
    }
  };
}

function getOrbitTransitionGap(
  previousKind: OrbitalChildKind | null,
  nextKind: OrbitalChildKind,
  profile: OrbitPlanningProfile
) {
  if (!previousKind || previousKind === nextKind) {
    return 0;
  }

  if (previousKind === "folder" && nextKind === "canvas") {
    return profile.transitionGap.folderToCanvas;
  }

  if (previousKind === "folder" && nextKind === "note") {
    return profile.transitionGap.folderToNote;
  }

  if (previousKind === "canvas" && nextKind === "note") {
    return profile.transitionGap.canvasToNote;
  }

  return profile.transitionGap.canvasToNote;
}

function getProjectEntityId(projectId: string) {
  return `project:${projectId}`;
}

function getFolderVisualKind(folder: Folder | undefined | null) {
  return folder?.parentId ? "subfolder" : "folder";
}

function buildOrbitalData(projects: Project[], folders: Folder[], notes: Note[]): OrbitalData {
  const visibleNotes = notes
    .filter((note) => note.trashedAt === null)
    .sort(noteSorter);
  const orderedProjects = [...projects].sort(compareHierarchyRecords);
  const rootFoldersByProject = new Map<string, FolderBranch[]>();
  const looseNotesByProject = new Map<string, Note[]>();
  const foldersByParent = new Map<string | null, Folder[]>();
  const notesByFolder = new Map<string | null, Note[]>();
  const projectById = new Map<string, Project>();
  const folderById = new Map<string, Folder>();
  const noteById = new Map<string, Note>();
  const folderMeta = new Map<
    string,
    {
      directNoteCount: number;
      descendantNoteCount: number;
      descendantFolderCount: number;
      depth: number;
      mass: number;
    }
  >();

  orderedProjects.forEach((project) => {
    projectById.set(project.id, project);
  });

  folders.forEach((folder) => {
    folderById.set(folder.id, folder);
    const bucket = foldersByParent.get(folder.parentId) ?? [];
    bucket.push(folder);
    foldersByParent.set(folder.parentId, bucket);
  });

  visibleNotes.forEach((note) => {
    noteById.set(note.id, note);
    const bucket = notesByFolder.get(note.folderId) ?? [];
    bucket.push(note);
    notesByFolder.set(note.folderId, bucket);
  });

  foldersByParent.forEach((bucket) => {
    bucket.sort(compareHierarchyRecords);
  });

  notesByFolder.forEach((bucket) => {
    bucket.sort(compareHierarchyRecords);
  });

  const buildBranch = (folder: Folder, depth: number): FolderBranch => {
    const children = (foldersByParent.get(folder.id) ?? []).map((child) => buildBranch(child, depth + 1));
    const directNotes = notesByFolder.get(folder.id) ?? [];
    const descendantNoteCount =
      directNotes.length + children.reduce((sum, child) => sum + child.descendantNoteCount, 0);
    const descendantFolderCount =
      children.length + children.reduce((sum, child) => sum + child.descendantFolderCount, 0);
    const mass =
      1 +
      directNotes.length * 0.8 +
      descendantNoteCount * 0.38 +
      descendantFolderCount * 0.72;

    folderMeta.set(folder.id, {
      directNoteCount: directNotes.length,
      descendantNoteCount,
      descendantFolderCount,
      depth,
      mass
    });

    return {
      folder,
      children,
      notes: directNotes,
      directNoteCount: directNotes.length,
      descendantNoteCount,
      descendantFolderCount,
      mass,
      depth
    };
  };

  orderedProjects.forEach((project) => {
    rootFoldersByProject.set(
      project.id,
      (foldersByParent.get(null) ?? [])
        .filter((folder) => folder.projectId === project.id)
        .map((folder) => buildBranch(folder, 0))
    );

    looseNotesByProject.set(
      project.id,
      (notesByFolder.get(null) ?? []).filter((note) => note.projectId === project.id)
    );
  });

  return {
    projects: orderedProjects,
    rootFoldersByProject,
    looseNotesByProject,
    visibleNoteCount: visibleNotes.length,
    totalEntities: folders.length + visibleNotes.length + orderedProjects.length,
    folderMeta,
    foldersByParent,
    notesByFolder,
    projectById,
    folderById,
    noteById
  };
}

function collectFolderSubtreeEntityIds(folderId: string, data: OrbitalData) {
  const related = new Set<string>();

  const visit = (currentFolderId: string) => {
    const currentFolder = data.folderById.get(currentFolderId);

    if (!currentFolder) {
      return;
    }

    related.add(`folder:${currentFolder.id}`);

    (data.notesByFolder.get(currentFolder.id) ?? []).forEach((note) => {
      related.add(`note:${note.id}`);
    });

    (data.foldersByParent.get(currentFolder.id) ?? []).forEach((childFolder) => {
      visit(childFolder.id);
    });
  };

  visit(folderId);
  return related;
}

function collectProjectEntityIds(projectId: string, data: OrbitalData) {
  const related = new Set<string>();

  if (!data.projectById.has(projectId)) {
    return related;
  }

  related.add(`project:${projectId}`);

  (data.rootFoldersByProject.get(projectId) ?? []).forEach((branch) => {
    collectFolderSubtreeEntityIds(branch.folder.id, data).forEach((entityId) => {
      related.add(entityId);
    });
  });

  (data.looseNotesByProject.get(projectId) ?? []).forEach((note) => {
    related.add(`note:${note.id}`);
  });

  return related;
}

function collectFolderAncestryEntityIds(folderId: string, data: OrbitalData) {
  const chain: string[] = [];
  let currentFolder = data.folderById.get(folderId) ?? null;

  while (currentFolder) {
    chain.unshift(`folder:${currentFolder.id}`);
    currentFolder = currentFolder.parentId
      ? data.folderById.get(currentFolder.parentId) ?? null
      : null;
  }

  return chain;
}

function buildVisualContextSets(
  selectedEntityId: string | null,
  currentProjectEntityId: string | null,
  data: OrbitalData
) {
  const primary = new Set<string>();
  const direct = new Set<string>();
  const secondary = new Set<string>();

  if (!selectedEntityId) {
    if (currentProjectEntityId) {
      primary.add(currentProjectEntityId);
      const currentProjectId = currentProjectEntityId.slice("project:".length);

      (data.rootFoldersByProject.get(currentProjectId) ?? []).forEach((branch) => {
        direct.add(`folder:${branch.folder.id}`);
      });

      (data.looseNotesByProject.get(currentProjectId) ?? []).forEach((note) => {
        direct.add(`note:${note.id}`);
      });
    }

    return { primary, direct, secondary };
  }

  primary.add(selectedEntityId);

  if (selectedEntityId.startsWith("project:")) {
    const projectId = selectedEntityId.slice("project:".length);

    (data.rootFoldersByProject.get(projectId) ?? []).forEach((branch) => {
      direct.add(`folder:${branch.folder.id}`);
    });

    (data.looseNotesByProject.get(projectId) ?? []).forEach((note) => {
      direct.add(`note:${note.id}`);
    });

    data.folderById.forEach((folder) => {
      const entityId = `folder:${folder.id}`;
      if (folder.projectId === projectId && !direct.has(entityId)) {
        secondary.add(entityId);
      }
    });

    data.noteById.forEach((note) => {
      const entityId = `note:${note.id}`;
      if (note.projectId === projectId && !direct.has(entityId)) {
        secondary.add(entityId);
      }
    });

    return { primary, direct, secondary };
  }

  if (selectedEntityId.startsWith("folder:")) {
    const folderId = selectedEntityId.slice("folder:".length);
    const folder = data.folderById.get(folderId);

    if (!folder) {
      return { primary, direct, secondary };
    }

    const projectEntityId = getProjectEntityId(folder.projectId);
    secondary.add(projectEntityId);

    collectFolderAncestryEntityIds(folderId, data).forEach((entityId) => {
      if (entityId !== selectedEntityId) {
        secondary.add(entityId);
      }
    });

    (data.foldersByParent.get(folderId) ?? []).forEach((childFolder) => {
      direct.add(`folder:${childFolder.id}`);
    });

    (data.notesByFolder.get(folderId) ?? []).forEach((note) => {
      direct.add(`note:${note.id}`);
    });

    collectFolderSubtreeEntityIds(folderId, data).forEach((entityId) => {
      if (entityId !== selectedEntityId && !direct.has(entityId)) {
        secondary.add(entityId);
      }
    });

    return { primary, direct, secondary };
  }

  if (selectedEntityId.startsWith("note:")) {
    const noteId = selectedEntityId.slice("note:".length);
    const note = data.noteById.get(noteId);

    if (!note) {
      return { primary, direct, secondary };
    }

    const projectEntityId = getProjectEntityId(note.projectId);
    secondary.add(projectEntityId);

    if (note.folderId) {
      direct.add(`folder:${note.folderId}`);

      collectFolderAncestryEntityIds(note.folderId, data).forEach((entityId) => {
        if (!direct.has(entityId) && entityId !== selectedEntityId) {
          secondary.add(entityId);
        }
      });
    }

    return { primary, direct, secondary };
  }

  return { primary, direct, secondary };
}

function getEntityVisibilityChain(entityId: string, data: OrbitalData) {
  const projectId = getEntityProjectId(entityId, data);

  if (!projectId || !data.projectById.has(projectId)) {
    return [];
  }

  const chain = [getProjectEntityId(projectId)];

  if (entityId.startsWith("project:")) {
    return chain;
  }

  if (entityId.startsWith("folder:")) {
    const folderId = entityId.slice("folder:".length);

    if (!data.folderById.has(folderId)) {
      return chain;
    }

    return [...chain, ...collectFolderAncestryEntityIds(folderId, data)];
  }

  if (entityId.startsWith("note:")) {
    const noteId = entityId.slice("note:".length);
    const note = data.noteById.get(noteId);

    if (!note) {
      return chain;
    }

    return note.folderId
      ? [...chain, ...collectFolderAncestryEntityIds(note.folderId, data), `note:${note.id}`]
      : [...chain, `note:${note.id}`];
  }

  return chain;
}

function getVisibilityChainAdditionalCost(chain: string[], visibleEntityIds: Set<string>) {
  return chain.reduce((total, entityId) => {
    if (entityId.startsWith("project:") || visibleEntityIds.has(entityId)) {
      return total;
    }

    return total + 1;
  }, 0);
}

function addVisibilityChain(chain: string[], visibleEntityIds: Set<string>) {
  let addedBodies = 0;

  chain.forEach((entityId) => {
    if (visibleEntityIds.has(entityId)) {
      return;
    }

    visibleEntityIds.add(entityId);

    if (!entityId.startsWith("project:")) {
      addedBodies += 1;
    }
  });

  return addedBodies;
}

function buildAdaptiveVisibilitySet({
  data,
  budget,
  currentProjectId,
  priorityProjectId,
  selectedEntityId,
  filterPrimaryEntityIds,
  filterSecondaryEntityIds
}: {
  data: OrbitalData;
  budget: number;
  currentProjectId: string | null;
  priorityProjectId: string | null;
  selectedEntityId: string | null;
  filterPrimaryEntityIds: Set<string>;
  filterSecondaryEntityIds: Set<string>;
}) {
  const visibleEntityIds = new Set<string>();
  const totalBodyCount = Math.max(data.totalEntities - data.projects.length, 0);
  let remainingBudget = Math.min(budget, totalBodyCount);

  data.projects.forEach((project) => {
    visibleEntityIds.add(getProjectEntityId(project.id));
  });

  const selectedAncestryEntityIds = new Set<string>();
  const selectedSubtreeEntityIds = new Set<string>();
  const selectedDirectChildEntityIds = new Set<string>();

  if (selectedEntityId?.startsWith("project:")) {
    const selectedProjectId = selectedEntityId.slice("project:".length);

    data.rootFoldersByProject.get(selectedProjectId)?.forEach((branch) => {
      selectedDirectChildEntityIds.add(`folder:${branch.folder.id}`);
    });

    data.looseNotesByProject.get(selectedProjectId)?.forEach((note) => {
      selectedDirectChildEntityIds.add(`note:${note.id}`);
    });

    data.folderById.forEach((folder) => {
      if (folder.projectId === selectedProjectId) {
        selectedSubtreeEntityIds.add(`folder:${folder.id}`);
      }
    });

    data.noteById.forEach((note) => {
      if (note.projectId === selectedProjectId) {
        selectedSubtreeEntityIds.add(`note:${note.id}`);
      }
    });
  }

  if (selectedEntityId?.startsWith("folder:")) {
    const selectedFolderId = selectedEntityId.slice("folder:".length);

    collectFolderAncestryEntityIds(selectedFolderId, data).forEach((entityId) => {
      selectedAncestryEntityIds.add(entityId);
    });

    collectFolderSubtreeEntityIds(selectedFolderId, data).forEach((entityId) => {
      selectedSubtreeEntityIds.add(entityId);
    });

    (data.foldersByParent.get(selectedFolderId) ?? []).forEach((folder) => {
      selectedDirectChildEntityIds.add(`folder:${folder.id}`);
    });

    (data.notesByFolder.get(selectedFolderId) ?? []).forEach((note) => {
      selectedDirectChildEntityIds.add(`note:${note.id}`);
    });
  }

  if (selectedEntityId?.startsWith("note:")) {
    const selectedNoteId = selectedEntityId.slice("note:".length);
    const selectedNote = data.noteById.get(selectedNoteId);

    if (selectedNote?.folderId) {
      collectFolderAncestryEntityIds(selectedNote.folderId, data).forEach((entityId) => {
        selectedAncestryEntityIds.add(entityId);
      });
    }
  }

  const tryAddEntity = (entityId: string) => {
    if (visibleEntityIds.has(entityId)) {
      return 0;
    }

    const chain = getEntityVisibilityChain(entityId, data);
    const additionalCost = getVisibilityChainAdditionalCost(chain, visibleEntityIds);

    if (additionalCost === 0) {
      return 0;
    }

    if (additionalCost > remainingBudget) {
      return -1;
    }

    remainingBudget -= additionalCost;
    return addVisibilityChain(chain, visibleEntityIds);
  };

  if (selectedEntityId) {
    tryAddEntity(selectedEntityId);
  }

  const updatedAtValues = [
    ...Array.from(data.folderById.values(), (folder) => folder.updatedAt),
    ...Array.from(data.noteById.values(), (note) => note.updatedAt)
  ];
  const minUpdatedAt = updatedAtValues.length > 0 ? Math.min(...updatedAtValues) : 0;
  const maxUpdatedAt = updatedAtValues.length > 0 ? Math.max(...updatedAtValues) : 0;
  const updatedAtRange = Math.max(maxUpdatedAt - minUpdatedAt, 1);
  const hasActiveFilter = filterPrimaryEntityIds.size > 0 || filterSecondaryEntityIds.size > 0;
  const filterMatchedProjectIds = new Set<string>();

  filterPrimaryEntityIds.forEach((entityId) => {
    const projectId = getEntityProjectId(entityId, data);

    if (projectId) {
      filterMatchedProjectIds.add(projectId);
    }
  });

  type VisibilityCandidate = {
    entityId: string;
    projectId: string;
    score: number;
    isRootLevel: boolean;
  };

  const candidates: VisibilityCandidate[] = [];
  const rootCandidatesByProject = new Map<string, VisibilityCandidate[]>();

  const registerCandidate = (candidate: VisibilityCandidate) => {
    candidates.push(candidate);

    if (!candidate.isRootLevel) {
      return;
    }

    const queue = rootCandidatesByProject.get(candidate.projectId) ?? [];
    queue.push(candidate);
    rootCandidatesByProject.set(candidate.projectId, queue);
  };

  data.folderById.forEach((folder) => {
    const entityId = `folder:${folder.id}`;
    const meta = data.folderMeta.get(folder.id);
    const isRootLevel = folder.parentId === null;
    const recencyScore = ((folder.updatedAt - minUpdatedAt) / updatedAtRange) * 180;
    let score =
      recencyScore +
      Math.min(360, (meta?.mass ?? 1) * 42) +
      Math.min(
        280,
        (meta?.descendantNoteCount ?? 0) * 24 + (meta?.descendantFolderCount ?? 0) * 30
      ) +
      (isRootLevel ? 540 : 0);

    if (currentProjectId && folder.projectId === currentProjectId) {
      score += 180;
    }

    if (priorityProjectId && folder.projectId === priorityProjectId) {
      score += isRootLevel ? 1460 : 980;
    }

    if (selectedEntityId === entityId) {
      score += 8400;
    }

    if (selectedAncestryEntityIds.has(entityId)) {
      score += 3200;
    }

    if (selectedDirectChildEntityIds.has(entityId)) {
      score += 3000;
    } else if (selectedSubtreeEntityIds.has(entityId)) {
      score += 2480;
    }

    if (filterPrimaryEntityIds.has(entityId)) {
      score += 7200;
    }

    if (filterSecondaryEntityIds.has(entityId)) {
      score += 4400;
    }

    if (filterMatchedProjectIds.has(folder.projectId)) {
      score += isRootLevel ? 1400 : 420;
    }

    registerCandidate({
      entityId,
      projectId: folder.projectId,
      score,
      isRootLevel
    });
  });

  data.noteById.forEach((note) => {
    const entityId = `note:${note.id}`;
    const isRootLevel = note.folderId === null;
    const recencyScore = ((note.updatedAt - minUpdatedAt) / updatedAtRange) * 190;
    let score =
      recencyScore +
      Math.min(160, note.plainText.length / 24) +
      (isEntryFavorite(note) ? 760 : 0) +
      (note.contentType === "canvas" ? 120 : 0) +
      (isRootLevel ? 510 : 0);

    if (currentProjectId && note.projectId === currentProjectId) {
      score += 190;
    }

    if (priorityProjectId && note.projectId === priorityProjectId) {
      score += isRootLevel ? 1340 : 920;
    }

    if (selectedEntityId === entityId) {
      score += 8600;
    }

    if (selectedDirectChildEntityIds.has(entityId)) {
      score += 2900;
    } else if (selectedSubtreeEntityIds.has(entityId)) {
      score += 2380;
    }

    if (filterPrimaryEntityIds.has(entityId)) {
      score += 7200;
    }

    if (filterSecondaryEntityIds.has(entityId)) {
      score += 4400;
    }

    if (filterMatchedProjectIds.has(note.projectId)) {
      score += isRootLevel ? 1400 : 420;
    }

    registerCandidate({
      entityId,
      projectId: note.projectId,
      score,
      isRootLevel
    });
  });

  rootCandidatesByProject.forEach((queue) => {
    queue.sort((left, right) => right.score - left.score);
  });

  const orderedProjectIds = [...data.projects]
    .sort((left, right) => {
      const leftPriority = left.id === priorityProjectId ? 1 : 0;
      const rightPriority = right.id === priorityProjectId ? 1 : 0;

      if (leftPriority !== rightPriority) {
        return rightPriority - leftPriority;
      }

      const leftCurrent = left.id === currentProjectId ? 1 : 0;
      const rightCurrent = right.id === currentProjectId ? 1 : 0;

      if (leftCurrent !== rightCurrent) {
        return rightCurrent - leftCurrent;
      }

      return right.updatedAt - left.updatedAt;
    })
    .map((project) => project.id);

  const takeNextRootCandidate = (projectId: string) => {
    const queue = rootCandidatesByProject.get(projectId);

    while (queue && queue.length > 0) {
      const candidate = queue.shift()!;

      if (!visibleEntityIds.has(candidate.entityId)) {
        return candidate;
      }
    }

    return null;
  };

  const globalCandidates = [...candidates].sort((left, right) => right.score - left.score);

  if (!hasActiveFilter) {
    if (priorityProjectId) {
      let seededPriorityRoots = 0;

      while (seededPriorityRoots < 4 && remainingBudget > 0) {
        const candidate = takeNextRootCandidate(priorityProjectId);

        if (!candidate) {
          break;
        }

        if (tryAddEntity(candidate.entityId) > 0) {
          seededPriorityRoots += 1;
        }
      }

      orderedProjectIds.forEach((projectId) => {
        if (projectId === priorityProjectId || remainingBudget <= 0) {
          return;
        }

        const candidate = takeNextRootCandidate(projectId);

        if (candidate) {
          tryAddEntity(candidate.entityId);
        }
      });
    } else {
      const rootPasses =
        data.projects.length <= 3 ? 3 : data.projects.length <= 8 ? 2 : 1;

      for (let pass = 0; pass < rootPasses && remainingBudget > 0; pass += 1) {
        orderedProjectIds.forEach((projectId) => {
          if (remainingBudget <= 0) {
            return;
          }

          const candidate = takeNextRootCandidate(projectId);

          if (candidate) {
            tryAddEntity(candidate.entityId);
          }
        });
      }
    }
  }

  if (priorityProjectId && remainingBudget > 0) {
    let priorityBodiesAdded = 0;
    const priorityBodyBudget = Math.min(
      Math.round(budget * 0.62),
      Math.max(24, budget - Math.min(data.projects.length, 10))
    );

    for (const candidate of globalCandidates) {
      if (candidate.projectId !== priorityProjectId || remainingBudget <= 0) {
        continue;
      }

      if (priorityBodiesAdded >= priorityBodyBudget) {
        break;
      }

      const addedBodies = tryAddEntity(candidate.entityId);

      if (addedBodies > 0) {
        priorityBodiesAdded += addedBodies;
      }
    }
  }

  for (const candidate of globalCandidates) {
    if (remainingBudget <= 0) {
      break;
    }

    tryAddEntity(candidate.entityId);
  }

  return visibleEntityIds;
}

function buildOrbitalLayout(
  data: OrbitalData,
  visibleEntityIds: Set<string> | null,
  language: AppLanguage
): OrbitalLayout {
  const roots: OrbitalLayoutNode[] = [];
  const entityMap = new Map<string, OrbitalLayoutNode>();

  const renderChildren = (
    parent: Pick<OrbitalLayoutNode, "entityId" | "kind" | "radius">,
    children: OrbitalChild[],
    depth: number
  ) => {
    const orderedChildren = [...children].sort(compareOrbitalChildren);
    const visibleChildren = visibleEntityIds
      ? orderedChildren.filter((child) => visibleEntityIds.has(getChildEntityId(child)))
      : orderedChildren;

    if (visibleChildren.length === 0) {
      return [];
    }

    const profile = getOrbitPlanningProfile(parent.kind, depth);
    const planeSeed = hashString(`${parent.entityId}:plane`);
    const planeRotation =
      ((((planeSeed >> 3) % 1000) / 999) * 2 - 1) * profile.rotationRange;
    const planeRatio =
      profile.planeRatio + ((((planeSeed >> 12) % 9) - 4) * 0.0045);
    const rotationRad = (planeRotation * Math.PI) / 180;
    const parentPhase = ((hashString(`${parent.entityId}:phase`) % 360) * Math.PI) / 180;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const orbitPlanByEntityId = new Map<
      string,
      {
        mass: number;
        radius: number;
        color: string;
        label: string;
        kind: SceneNodeKind;
        orbit: OrbitalLayoutOrbit;
      }
    >();

    let orbitRadius = 0;
    let previousChildKind: OrbitalChildKind | null = null;
    let previousChildRadius = 0;

    orderedChildren.forEach((child, orderIndex) => {
      const entityId = getChildEntityId(child);
      const childKind = getOrbitalChildKind(child);
      const seed = hashString(entityId);
      const mass = child.folder?.mass ?? getNoteMass(child.note!);
      const kind: SceneNodeKind = child.folder ? "folder" : "note";
      const label = child.folder?.folder.name ?? (child.note ? getDisplayNoteTitle(child.note, language) : "");
      const radius = child.folder
        ? depth === 0
          ? clamp(16 + child.folder.mass * 1.65, 18, 44)
          : clamp(12.5 + child.folder.mass * 1.24, 13.5, 33)
        : getOrbitalEntryRadius(child.note!, depth);
      const color = child.folder?.folder.color ?? child.note?.color ?? DEFAULT_NOTE_COLOR;

      if (orderIndex === 0) {
        orbitRadius =
          parent.radius + profile.innerPadding + profile.kindBandOffset[childKind] + radius;
      } else {
        orbitRadius +=
          previousChildRadius +
          radius +
          profile.laneGap +
          getOrbitTransitionGap(previousChildKind, childKind, profile);
      }

      const speedSeed = seededUnit(seed, 11);
      const speed =
        profile.speedRange.min + (profile.speedRange.max - profile.speedRange.min) * speedSeed;
      const direction = (seed % 2 === 0 ? 1 : -1) as 1 | -1;
      const baseAngle =
        parentPhase +
        orderIndex * goldenAngle +
        ((((seed >> 17) % 120) - 60) / 60) * 0.08;

      orbitPlanByEntityId.set(entityId, {
        mass,
        radius,
        color,
        label,
        kind,
        orbit: {
          color,
          rx: orbitRadius,
          ry: Math.max(parent.radius + profile.innerPadding * 0.58, orbitRadius * planeRatio),
          rotation: planeRotation,
          rotationCos: Math.cos(rotationRad),
          rotationSin: Math.sin(rotationRad),
          speed,
          direction,
          baseAngle,
          wobble: ((((seed >> 14) % 240) - 120) / 120) * profile.wobbleRange
        }
      });

      previousChildKind = childKind;
      previousChildRadius = radius;
    });

    const nodes: OrbitalLayoutNode[] = [];
    visibleChildren.forEach((child) => {
      const entityId = getChildEntityId(child);
      const orbitPlan = orbitPlanByEntityId.get(entityId);

      if (!orbitPlan) {
        return;
      }

      const node: OrbitalLayoutNode = {
        id: entityId,
        entityId,
        parentEntityId: parent.entityId,
        kind: orbitPlan.kind,
        label: orbitPlan.label,
        radius: orbitPlan.radius,
        color: orbitPlan.color,
        depth,
        folder: child.folder?.folder,
        note: child.note,
        mass: orbitPlan.mass,
        favorite: child.note?.favorite,
        pinned: child.note?.pinned,
        orbit: orbitPlan.orbit,
        children: []
      };

      entityMap.set(entityId, node);

      if (child.folder) {
        node.children = renderChildren(
          node,
          [
            ...child.folder.children.map((branch) => ({ folder: branch })),
            ...child.folder.notes.map((note) => ({ note }))
          ],
          depth + 1
        );
      }

      nodes.push(node);
    });

    return nodes;
  };

  data.projects.forEach((project) => {
    const coreEntityId = getProjectEntityId(project.id);

    if (visibleEntityIds && !visibleEntityIds.has(coreEntityId)) {
      return;
    }

    const coreNode: OrbitalLayoutNode = {
      id: coreEntityId,
      entityId: coreEntityId,
      parentEntityId: null,
      kind: "core",
      label: getDisplayProjectName(project, language, data.projects.findIndex((entry) => entry.id === project.id)),
      x: project.x,
      y: project.y,
      radius: 58,
      color: project.color ?? DEFAULT_PROJECT_COLOR,
      depth: 0,
      project,
      mass: 10,
      children: []
    };

    entityMap.set(coreEntityId, coreNode);
    coreNode.children = renderChildren(
      coreNode,
      [
        ...(data.rootFoldersByProject.get(project.id) ?? []).map((folder) => ({ folder })),
        ...(data.looseNotesByProject.get(project.id) ?? []).map((note) => ({ note }))
      ],
      0
    );
    roots.push(coreNode);
  });

  return {
    roots,
    entityMap
  };
}

function materializeOrbitalScene(
  layout: OrbitalLayout,
  timeMs: number,
  toneByEntityId?: Map<string, OrbitalVisualTone>,
  motionCalmFactor = 1,
  movingEntityIds?: ReadonlySet<string>
): OrbitalScene {
  const nodes: OrbitalSceneNode[] = [];
  const orbits: OrbitalSceneOrbit[] = [];
  const links: OrbitalSceneLink[] = [];
  const entityMap = new Map<string, OrbitalSceneNode>();

  const visit = (
    layoutNode: OrbitalLayoutNode,
    parent: OrbitalSceneNode | null
  ) => {
    let x = layoutNode.x ?? 0;
    let y = layoutNode.y ?? 0;
    let orbit:
      | Omit<OrbitalSceneOrbit, "id" | "entityId" | "kind" | "parentEntityId" | "depth">
      | undefined;

    if (parent && layoutNode.orbit) {
      const tone = toneByEntityId?.get(layoutNode.entityId) ?? "muted";
      const isMotionEnabled = !movingEntityIds || movingEntityIds.has(layoutNode.entityId);
      const nodeTimeMs = isMotionEnabled ? timeMs : 0;
      const nodeMotionCalmFactor = isMotionEnabled ? motionCalmFactor : 0;
      const presentationMotionAmplitude =
        tone === "primary"
          ? 3.4
          : tone === "direct"
            ? 1.8
            : tone === "secondary"
              ? 0.82
              : 0.12;
      const orbitExpansion =
        tone === "primary" ? 16 : tone === "direct" ? 9 : tone === "secondary" ? 4 : 0;
      const angle =
        layoutNode.orbit.baseAngle +
        nodeTimeMs * layoutNode.orbit.speed * layoutNode.orbit.direction * nodeMotionCalmFactor +
        layoutNode.orbit.wobble;
      const localX = Math.cos(angle) * layoutNode.orbit.rx;
      const localY = Math.sin(angle) * layoutNode.orbit.ry;

      const orbitalX =
        parent.x +
        localX * layoutNode.orbit.rotationCos -
        localY * layoutNode.orbit.rotationSin;
      const orbitalY =
        parent.y +
        localX * layoutNode.orbit.rotationSin +
        localY * layoutNode.orbit.rotationCos;
      const orbitVectorX = orbitalX - parent.x;
      const orbitVectorY = orbitalY - parent.y;
      const orbitVectorLength = Math.hypot(orbitVectorX, orbitVectorY) || 1;
      const radialUnitX = orbitVectorX / orbitVectorLength;
      const radialUnitY = orbitVectorY / orbitVectorLength;
      const tangentUnitX = -radialUnitY;
      const tangentUnitY = radialUnitX;
      const motionPhase =
        nodeTimeMs * (layoutNode.orbit.speed * 26 + 0.00042) +
        layoutNode.orbit.baseAngle * 1.85 +
        layoutNode.depth * 0.38;
      const radialLift = orbitExpansion * 0.56 * nodeMotionCalmFactor;
      const radialOffset =
        radialLift + Math.sin(motionPhase) * presentationMotionAmplitude * nodeMotionCalmFactor;
      const tangentOffset =
        Math.cos(motionPhase * 0.72) *
        presentationMotionAmplitude *
        0.16 *
        nodeMotionCalmFactor;

      x = orbitalX + radialUnitX * radialOffset + tangentUnitX * tangentOffset;
      y = orbitalY + radialUnitY * radialOffset + tangentUnitY * tangentOffset;
      orbit = {
        x: parent.x,
        y: parent.y,
        rx: layoutNode.orbit.rx + orbitExpansion,
        ry: layoutNode.orbit.ry + orbitExpansion * 0.68,
        rotation: layoutNode.orbit.rotation,
        color: layoutNode.orbit.color
      };
    }

    const sceneNode: OrbitalSceneNode = {
      id: layoutNode.id,
      entityId: layoutNode.entityId,
      parentEntityId: layoutNode.parentEntityId,
      kind: layoutNode.kind,
      label: layoutNode.label,
      x,
      y,
      radius: layoutNode.radius,
      color: layoutNode.color,
      depth: layoutNode.depth,
      note: layoutNode.note,
      folder: layoutNode.folder,
      project: layoutNode.project,
      mass: layoutNode.mass,
      favorite: layoutNode.favorite,
      pinned: layoutNode.pinned,
      orbit
    };

    nodes.push(sceneNode);
    entityMap.set(sceneNode.entityId, sceneNode);

    if (parent && orbit) {
      orbits.push({
        id: `${sceneNode.entityId}:orbit`,
        entityId: sceneNode.entityId,
        parentEntityId: parent.entityId,
        color: orbit.color,
        x: orbit.x,
        y: orbit.y,
        rx: orbit.rx,
        ry: orbit.ry,
        rotation: orbit.rotation,
        depth: sceneNode.depth,
        kind: sceneNode.kind === "note" ? "note" : "folder"
      });
      links.push({
        id: `${parent.entityId}->${sceneNode.entityId}`,
        entityId: sceneNode.entityId,
        parentEntityId: parent.entityId,
        color: orbit.color,
        x1: parent.x,
        y1: parent.y,
        x2: sceneNode.x,
        y2: sceneNode.y,
        depth: sceneNode.depth,
        kind: sceneNode.kind === "note" ? "note" : "folder"
      });
    }

    layoutNode.children.forEach((child) => {
      visit(child, sceneNode);
    });
  };

  layout.roots.forEach((root) => {
    visit(root, null);
  });

  return {
    nodes,
    orbits,
    links,
    entityMap
  };
}

function buildRenderedOrbitalScene(
  scene: OrbitalScene,
  positionByEntityId: Map<string, OrbitalScenePosition>
): OrbitalScene {
  if (positionByEntityId.size === 0) {
    return scene;
  }

  const nodes = scene.nodes.map((node) => {
    const animatedPosition = positionByEntityId.get(node.entityId);

    if (!animatedPosition) {
      return node;
    }

    const orbit = node.orbit
      ? {
          ...node.orbit,
          x: positionByEntityId.get(node.parentEntityId ?? "")?.x ?? node.orbit.x,
          y: positionByEntityId.get(node.parentEntityId ?? "")?.y ?? node.orbit.y
        }
      : undefined;

    return {
      ...node,
      x: animatedPosition.x,
      y: animatedPosition.y,
      orbit
    };
  });

  const entityMap = new Map(nodes.map((node) => [node.entityId, node]));
  const orbits = scene.orbits.map((orbit) => {
    const parentPosition = entityMap.get(orbit.parentEntityId);

    if (!parentPosition) {
      return orbit;
    }

    return {
      ...orbit,
      x: parentPosition.x,
      y: parentPosition.y
    };
  });
  const links = scene.links.map((link) => {
    const parentPosition = entityMap.get(link.parentEntityId);
    const nodePosition = entityMap.get(link.entityId);

    if (!parentPosition || !nodePosition) {
      return link;
    }

    return {
      ...link,
      x1: parentPosition.x,
      y1: parentPosition.y,
      x2: nodePosition.x,
      y2: nodePosition.y
    };
  });

  return {
    nodes,
    orbits,
    links,
    entityMap
  };
}

function filterInspectorHierarchy(
  items: InspectorHierarchyItem[],
  query: string
): InspectorHierarchyItem[] {
  if (!query) {
    return items;
  }

  return items.flatMap((item) => {
    const filteredChildren = filterInspectorHierarchy(item.children, query);
    const matchesSelf = item.searchText.includes(query);

    if (!matchesSelf && filteredChildren.length === 0) {
      return [];
    }

    return [
      {
        ...item,
        children: filteredChildren
      }
    ];
  });
}

function countInspectorHierarchyItems(items: InspectorHierarchyItem[]): number {
  return items.reduce((total, item) => total + 1 + countInspectorHierarchyItems(item.children), 0);
}

function collectInspectorHierarchyExpandableIds(items: InspectorHierarchyItem[]) {
  const projectIds: string[] = [];
  const folderIds: string[] = [];

  const visit = (item: InspectorHierarchyItem) => {
    if (item.children.length > 0) {
      if (item.kind === "core") {
        projectIds.push(item.id);
      } else if (item.kind === "folder") {
        folderIds.push(item.id);
      }
    }

    item.children.forEach(visit);
  };

  items.forEach(visit);
  return { projectIds, folderIds };
}

function getEntityProjectId(entityId: string | null, data: OrbitalData) {
  if (!entityId) {
    return null;
  }

  if (entityId.startsWith("project:")) {
    return entityId.slice("project:".length);
  }

  if (entityId.startsWith("folder:")) {
    return data.folderById.get(entityId.slice("folder:".length))?.projectId ?? null;
  }

  if (entityId.startsWith("note:")) {
    return data.noteById.get(entityId.slice("note:".length))?.projectId ?? null;
  }

  return null;
}

function findOpenProjectPosition(projects: Project[]) {
  const horizontalPadding = 180;
  const verticalPadding = 180;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const x =
      VIEWBOX.minX +
      horizontalPadding +
      Math.random() * (VIEWBOX.width - horizontalPadding * 2);
    const y =
      VIEWBOX.minY +
      verticalPadding +
      Math.random() * (VIEWBOX.height - verticalPadding * 2);

    const isOpen = projects.every((project) => {
      const dx = project.x - x;
      const dy = project.y - y;
      return Math.sqrt(dx * dx + dy * dy) >= PROJECT_MIN_DISTANCE;
    });

    if (isOpen) {
      return { x, y };
    }
  }

  const fallbackIndex = projects.length;
  return {
    x: VIEWBOX.minX + 260 + (fallbackIndex % 4) * 360,
    y: VIEWBOX.minY + 240 + Math.floor(fallbackIndex / 4) * 320
  };
}

export default function OrbitalMapView({
  projects,
  folders,
  notes,
  tags,
  assets,
  tasks,
  assetCount,
  language,
  adaptiveLayout,
  orbitalAnimationMode,
  orbitalTemporalSignalsMode,
  projectFocusRequest = null,
  activeLocalVaultId,
  localVaultOptions,
  syncStatusChip,
  syncTransportChip,
  webAccessStatus,
  updateChip,
  editorOpen,
  editorMode = null,
  editorContentKey = null,
  editorSlot,
  plannerSlot,
  editorTitle,
  editorAccentColor,
  settingsModalSlot,
  settingsOpenRequest = null,
  onSettingsOpenRequestHandled,
  trashModalSlot,
  showClose = true,
  onClose,
  onOrbitalAnimationModeChange,
  onSelectLocalVault,
  onCreateLocalVault,
  onRenameLocalVault,
  onCloseEditor,
  onCreateProject,
  onRenameProject,
  onUpdateProjectPosition,
  onUpdateProjectSortOrder,
  onUpdateProjectColor,
  onDeleteProject,
  onCreateFolder,
  onRenameFolder,
  onUpdateFolderColor,
  onRenameNote,
  onUpdateNoteColor,
  onSetNotePinned,
  onDeleteFolder,
  onMoveFolder,
  onMoveNote,
  onDuplicateFolder,
  onDuplicateNote,
  onDeleteNote,
  onCreateNote,
  onCreateCanvas,
  onOpenNote,
  onOpenProjectPlan,
  onOpenPlannerView,
  onOpenWebAccess,
  onExportWebVault,
  onToggleNoteChecklistItem,
  onResolveFileUrl,
  labels
}: OrbitalMapViewProps) {
  const { t } = useTranslation();
  const tagMap = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const [isPaused, setIsPaused] = useState(false);
  const [isTemporalLayerQuickHidden, setIsTemporalLayerQuickHidden] = useState(false);
  const [surfaceMode, setSurfaceMode] = useState<OrbitalSurfaceMode>("map");
  const [timeMs, setTimeMs] = useState(0);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });
  const [isFolderDraftOpen, setIsFolderDraftOpen] = useState(false);
  const [folderDraftParentId, setFolderDraftParentId] = useState<string | null>(null);
  const [folderDraftProjectId, setFolderDraftProjectId] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState("");
  const [folderDraftColor, setFolderDraftColor] = useState<string>(DEFAULT_FOLDER_COLOR);
  const [folderDraftError, setFolderDraftError] = useState<string | null>(null);
  const [projectPositionDrafts, setProjectPositionDrafts] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [activeModal, setActiveModal] = useState<"settings" | "trash" | null>(null);
  const [settingsPanelOpenRequest, setSettingsPanelOpenRequest] =
    useState<SettingsOpenRequest | null>(null);
  const closeUtilityModal = () => {
    setActiveModal(null);
    setSettingsPanelOpenRequest(null);
  };
  const resolvedSettingsModalSlot =
    settingsModalSlot && isValidElement(settingsModalSlot)
      ? cloneElement(settingsModalSlot, {
          onClose: closeUtilityModal,
          openViewRequest: settingsPanelOpenRequest
        } as { onClose: () => void; openViewRequest: SettingsOpenRequest | null })
      : settingsModalSlot;
  const resolvedTrashModalSlot =
    trashModalSlot && isValidElement(trashModalSlot)
      ? cloneElement(trashModalSlot, {
          onClose: closeUtilityModal
        } as { onClose: () => void })
      : trashModalSlot;

  useEffect(() => {
    if (!settingsOpenRequest) {
      return;
    }

    setSettingsPanelOpenRequest(settingsOpenRequest);
    setActiveModal("settings");
    onSettingsOpenRequestHandled?.();
  }, [onSettingsOpenRequestHandled, settingsOpenRequest?.requestId, settingsOpenRequest?.view]);

  const [isCanvasEditorFullscreen, setIsCanvasEditorFullscreen] = useState(false);
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState !== "hidden"
  );
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    typeof window === "undefined"
      ? false
      : window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const [devicePixelRatio, setDevicePixelRatio] = useState(
    typeof window === "undefined" ? 1 : window.devicePixelRatio || 1
  );
  const [isOrbitInteractionActive, setIsOrbitInteractionActive] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [activeColorFilters, setActiveColorFilters] = useState<string[]>([]);
  const editorModalRef = useRef<HTMLDivElement | null>(null);

  const toggleCanvasEditorFullscreen = async () => {
    if (typeof document === "undefined") {
      setIsCanvasEditorFullscreen((current) => !current);
      return;
    }

    try {
      const fullscreenTarget = document.documentElement;

      if (document.fullscreenElement === fullscreenTarget) {
        await document.exitFullscreen();
        setIsCanvasEditorFullscreen(false);
        return;
      }

      if (fullscreenTarget.requestFullscreen) {
        await fullscreenTarget.requestFullscreen();
      }

      setIsCanvasEditorFullscreen(true);
    } catch {
      setIsCanvasEditorFullscreen((current) => !current);
    }
  };
  const [activeTagFilters, setActiveTagFilters] = useState<string[]>([]);
  const [activeFolderFilters, setActiveFolderFilters] = useState<string[]>([]);
  const [activeNoteFilters, setActiveNoteFilters] = useState<string[]>([]);
  const [activeAssetFilters, setActiveAssetFilters] = useState<string[]>([]);
  const [hierarchySelectionAnchorEntityId, setHierarchySelectionAnchorEntityId] = useState<string | null>(null);
  const [inspectorClipboard, setInspectorClipboard] = useState<InspectorClipboardItem[]>([]);
  const [inspectorDropIntent, setInspectorDropIntent] = useState<InspectorDropIntent | null>(null);
  const [inspectorToast, setInspectorToast] = useState<string | null>(null);
  const [activeInspectorDocumentKinds, setActiveInspectorDocumentKinds] = useState<
    InspectorDocumentKindFilter[]
  >([]);
  const [collapsedInspectorFolders, setCollapsedInspectorFolders] = useState<string[]>([]);
  const [expandedInspectorProjects, setExpandedInspectorProjects] = useState<string[]>([]);
  const [isInspectorHierarchyAutoExpandSuppressed, setIsInspectorHierarchyAutoExpandSuppressed] =
    useState(false);
  const [inspectorHierarchyAutoScrollRequestId, setInspectorHierarchyAutoScrollRequestId] = useState(0);
  const [inspectorMenu, setInspectorMenu] = useState<InspectorMenu>("overview");
  const [inspectorHierarchyScope, setInspectorHierarchyScope] =
    useState<InspectorHierarchyScope>("vault");
  const [mobileSection, setMobileSection] = useState<OrbitalMobileSection>("vault");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobileAccountOpen, setIsMobileAccountOpen] = useState(false);
  const [isMobileSelectionMode, setIsMobileSelectionMode] = useState(false);
  const [mobileMoveItems, setMobileMoveItems] = useState<InspectorClipboardItem[]>([]);
  const [mobileMoveDestination, setMobileMoveDestination] = useState<MobileMoveDestination | null>(null);
  const [mobileMoveConflictState, setMobileMoveConflictState] =
    useState<MobileMoveConflictState | null>(null);
  const [inspectorQuery, setInspectorQuery] = useState("");
  const [hierarchyFocusedEntityId, setHierarchyFocusedEntityId] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [isEditingVaultTitle, setIsEditingVaultTitle] = useState(false);
  const [vaultNameDraft, setVaultNameDraft] = useState("");
  const [vaultRenameError, setVaultRenameError] = useState<string | null>(null);
  const [inspectorRenameState, setInspectorRenameState] = useState<InspectorRenameState | null>(null);
  const [inspectorRenameDraft, setInspectorRenameDraft] = useState("");
  const [contextMenuState, setContextMenuState] = useState<InspectorContextMenuState | null>(null);
  const [isOverviewColorPanelOpen, setIsOverviewColorPanelOpen] = useState(false);
  const [overviewColorPanelStyle, setOverviewColorPanelStyle] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
    placement: "right" | "left" | "bottom" | "top";
  } | null>(null);
  const [hoveredSelectionNoteId, setHoveredSelectionNoteId] = useState<string | null>(null);
  const [hoveredAssetId, setHoveredAssetId] = useState<string | null>(null);
  const [hoverPreviewAnchorSource, setHoverPreviewAnchorSource] =
    useState<HoverPreviewAnchorSource | null>(null);
  const [hoverPreviewFallbackRect, setHoverPreviewFallbackRect] =
    useState<HoverPreviewAnchorRect | null>(null);
  const [hoverPreviewCursor, setHoverPreviewCursor] = useState({ x: 0, y: 0 });
  const [hoverPreviewAssetUrl, setHoverPreviewAssetUrl] = useState<string | null>(null);
  const [animatedSceneVersion, setAnimatedSceneVersion] = useState(0);
  const timeRef = useRef(0);
  const cameraRef = useRef({ x: 0, y: 0, scale: 1 });
  const cameraAnimationFrameRef = useRef<number | null>(null);
  const sceneAnimationFrameRef = useRef<number | null>(null);
  const sceneAnimationLastTimeRef = useRef<number | null>(null);
  const sceneWrapRef = useRef<HTMLDivElement | null>(null);
  const sceneTouchPointersRef = useRef(new Map<number, { clientX: number; clientY: number }>());
  const scenePinchRef = useRef<{
    startDistance: number;
    anchorWorldX: number;
    anchorWorldY: number;
    hasPinched: boolean;
  } | null>(null);
  const animatedNodePositionsRef = useRef(new Map<string, OrbitalScenePosition>());
  const targetNodePositionsRef = useRef(new Map<string, OrbitalScenePosition>());
  const projectPositionDraftsRef = useRef<Record<string, { x: number; y: number }>>({});
  const noteHoverPreviewScrollRef = useRef<HTMLDivElement | null>(null);
  const hoverPreviewCardRef = useRef<HTMLDivElement | null>(null);
  const hoverPreviewCloseTimeoutRef = useRef<number | null>(null);
  const hoverPreviewCursorRef = useRef({ x: 0, y: 0 });
  const hoverPreviewSceneAnchorRef = useRef<SVGGElement | null>(null);
  const folderDraftRowRef = useRef<HTMLDivElement | null>(null);
  const folderDraftInputRef = useRef<HTMLInputElement | null>(null);
  const inspectorPanelRef = useRef<HTMLElement | null>(null);
  const inspectorMenuListRef = useRef<HTMLDivElement | null>(null);
  const inspectorHierarchyItemRefs = useRef(new Map<string, HTMLElement>());
  const lastInspectorHierarchyAutoScrollKeyRef = useRef<string | null>(null);
  const overviewColorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const overviewColorPanelRef = useRef<HTMLDivElement | null>(null);
  const suppressSceneBackgroundClickRef = useRef(false);
  const orbitInteractionTimeoutRef = useRef<number | null>(null);
  const orbitInteractionActiveRef = useRef(false);
  const vaultRenameErrorTimeoutRef = useRef<number | null>(null);
  const inspectorToastTimeoutRef = useRef<number | null>(null);
  const inspectorDragItemsRef = useRef<InspectorClipboardItem[]>([]);
  const inspectorPointerDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    items: InspectorClipboardItem[];
    active: boolean;
  } | null>(null);
  const suppressInspectorClickRef = useRef(false);
  const pendingInspectorCenterRef = useRef<{
    entityId: string;
    projectId: string | null;
  } | null>(null);
  const inspectorLongPressRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    timeoutId: number;
  } | null>(null);
  const mobilePreviewLongPressRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    timeoutId: number;
    onPreview: () => void;
  } | null>(null);
  const dragRef = useRef<
    | {
        mode: "camera";
        pointerId: number;
        startX: number;
        startY: number;
        originX: number;
        originY: number;
        hasMoved: boolean;
      }
    | {
        mode: "project";
        pointerId: number;
        projectId: string;
        startX: number;
        startY: number;
        originProjectX: number;
        originProjectY: number;
        hasMoved: boolean;
      }
    | null
  >(null);
  const isAndroidLayout = adaptiveLayout.runtimeKind === "android";
  const isAndroidTouchLayout =
    isAndroidLayout || adaptiveLayout.pointer === "coarse" || adaptiveLayout.isMobileShell;
  const isAndroidMobileShell = adaptiveLayout.isMobileShell;
  const isMobilePreviewMode = adaptiveLayout.isMobileShell;
  const isAndroidPhoneShell = isAndroidMobileShell && adaptiveLayout.device === "phone";
  const isAndroidTabletPortraitShell =
    isAndroidMobileShell &&
    adaptiveLayout.device === "tablet" &&
    adaptiveLayout.orientation === "portrait";
  const isAndroidTabletLandscapeShell =
    isAndroidTouchLayout &&
    adaptiveLayout.device === "tablet" &&
    adaptiveLayout.orientation === "landscape";
  const canShowHoverPreview = !isAndroidTouchLayout && !isMobilePreviewMode;
  const isOrbitalMotionEnabled = orbitalAnimationMode === "full";
  const isPlannerSurfaceVisible =
    Boolean(plannerSlot) && (isAndroidMobileShell ? mobileSection === "planner" : surfaceMode === "planner");
  const isMapSurfaceVisible = !isPlannerSurfaceVisible;
  const isMobileMapVisible = !isAndroidMobileShell || mobileSection === "map";
  const openPlannerView = (viewId: PlannerViewId) => {
    onOpenPlannerView?.(viewId);
    setSurfaceMode("planner");
    setMobileSection("planner");
  };

  useEffect(() => {
    if (!isAndroidMobileShell) {
      return;
    }

    if (surfaceMode === "planner" && plannerSlot && mobileSection !== "planner") {
      setMobileSection("planner");
    }

    if (surfaceMode === "map" && mobileSection === "planner") {
      setMobileSection("map");
    }
  }, [isAndroidMobileShell, mobileSection, plannerSlot, surfaceMode]);

  useEffect(() => {
    setIsTemporalLayerQuickHidden(false);
  }, [activeLocalVaultId, orbitalTemporalSignalsMode]);

  const stopScenePositionAnimation = () => {
    if (sceneAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(sceneAnimationFrameRef.current);
      sceneAnimationFrameRef.current = null;
    }

    sceneAnimationLastTimeRef.current = null;
  };

  const startScenePositionAnimation = () => {
    if (typeof window === "undefined" || sceneAnimationFrameRef.current !== null) {
      return;
    }

    const step = (now: number) => {
      const lastTime = sceneAnimationLastTimeRef.current ?? now;
      const deltaMs = Math.min(48, Math.max(0, now - lastTime));
      const interpolation = 1 - Math.exp(-deltaMs / ORBITAL_NODE_POSITION_EASE_MS);
      sceneAnimationLastTimeRef.current = now;

      const currentPositions = animatedNodePositionsRef.current;
      const targetPositions = targetNodePositionsRef.current;
      let hasAnimatedChange = false;
      let needsAnotherFrame = false;

      targetPositions.forEach((targetPosition, entityId) => {
        const currentPosition = currentPositions.get(entityId) ?? {
          x: targetPosition.x,
          y: targetPosition.y
        };
        const deltaX = targetPosition.x - currentPosition.x;
        const deltaY = targetPosition.y - currentPosition.y;

        if (
          Math.abs(deltaX) <= ORBITAL_NODE_POSITION_SNAP_DISTANCE &&
          Math.abs(deltaY) <= ORBITAL_NODE_POSITION_SNAP_DISTANCE
        ) {
          if (currentPosition.x !== targetPosition.x || currentPosition.y !== targetPosition.y) {
            currentPositions.set(entityId, {
              x: targetPosition.x,
              y: targetPosition.y
            });
            hasAnimatedChange = true;
          }
          return;
        }

        currentPositions.set(entityId, {
          x: currentPosition.x + deltaX * interpolation,
          y: currentPosition.y + deltaY * interpolation
        });
        hasAnimatedChange = true;
        needsAnotherFrame = true;
      });

      if (hasAnimatedChange) {
        setAnimatedSceneVersion((current) => current + 1);
      }

      if (needsAnotherFrame) {
        sceneAnimationFrameRef.current = window.requestAnimationFrame(step);
        return;
      }

      stopScenePositionAnimation();
    };

    sceneAnimationFrameRef.current = window.requestAnimationFrame(step);
  };

  useEffect(() => {
    if (isAndroidMobileShell) {
      return;
    }

    setIsMobileMenuOpen(false);
    setIsMobileAccountOpen(false);
    setIsMobileSelectionMode(false);
    setMobileMoveItems([]);
  }, [isAndroidMobileShell]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncReducedMotion = () => {
      setPrefersReducedMotion(mediaQuery.matches);
    };

    syncReducedMotion();
    mediaQuery.addEventListener("change", syncReducedMotion);

    return () => {
      mediaQuery.removeEventListener("change", syncReducedMotion);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const syncDevicePixelRatio = () => {
      setDevicePixelRatio(window.devicePixelRatio || 1);
    };

    syncDevicePixelRatio();
    window.addEventListener("resize", syncDevicePixelRatio);
    window.visualViewport?.addEventListener("resize", syncDevicePixelRatio);

    return () => {
      window.removeEventListener("resize", syncDevicePixelRatio);
      window.visualViewport?.removeEventListener("resize", syncDevicePixelRatio);
    };
  }, []);
  const folderPathMap = useMemo(() => buildFolderPathMap(folders), [folders]);
  const projectsWithDraftPositions = useMemo(
    () =>
      projects.map((project) => {
        const draft = projectPositionDrafts[project.id];
        return draft ? { ...project, x: draft.x, y: draft.y } : project;
      }),
    [projectPositionDrafts, projects]
  );
  const orbitalData = useMemo(
    () => buildOrbitalData(projectsWithDraftPositions, folders, notes),
    [folders, notes, projectsWithDraftPositions]
  );
  const normalizedFilterQuery = filterQuery.trim().toLowerCase();
  const normalizedInspectorQuery = inspectorQuery.trim().toLowerCase();
  const activeColorFilterSet = useMemo(() => new Set(activeColorFilters), [activeColorFilters]);
  const activeTagFilterSet = useMemo(() => new Set(activeTagFilters), [activeTagFilters]);
  const activeFolderFilterSet = useMemo(() => new Set(activeFolderFilters), [activeFolderFilters]);
  const activeNoteFilterSet = useMemo(() => new Set(activeNoteFilters), [activeNoteFilters]);
  const activeAssetFilterSet = useMemo(() => new Set(activeAssetFilters), [activeAssetFilters]);
  const activeInspectorDocumentKindSet = useMemo(
    () => new Set(activeInspectorDocumentKinds),
    [activeInspectorDocumentKinds]
  );
  const collapsedInspectorFolderSet = useMemo(
    () => new Set(collapsedInspectorFolders),
    [collapsedInspectorFolders]
  );
  const expandedInspectorProjectSet = useMemo(
    () => new Set(expandedInspectorProjects),
    [expandedInspectorProjects]
  );
  const searchableFolders = useMemo(
    () =>
      [...folders].sort((left, right) =>
        (folderPathMap.get(left.id) ?? left.name).localeCompare(folderPathMap.get(right.id) ?? right.name)
      ),
    [folderPathMap, folders]
  );
  const assetDisplayNamesById = useMemo(
    () => new Map(assets.map((asset) => [asset.id, getAssetDisplayName(asset)])),
    [assets]
  );
  const assetById = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset])),
    [assets]
  );
  const assetNamesByNoteId = useMemo(() => {
    const namesByNoteId = new Map<string, string[]>();

    assets.forEach((asset) => {
      const bucket = namesByNoteId.get(asset.noteId) ?? [];
      bucket.push(assetDisplayNamesById.get(asset.id) ?? getAssetDisplayName(asset));
      namesByNoteId.set(asset.noteId, bucket);
    });

    return namesByNoteId;
  }, [assetDisplayNamesById, assets]);
  const visibleNotes = useMemo(() => [...orbitalData.noteById.values()].sort(noteSorter), [orbitalData.noteById]);
  const activeLocalVaultItem = useMemo(
    () => localVaultOptions.find((item) => item.id === activeLocalVaultId) ?? localVaultOptions[0] ?? null,
    [activeLocalVaultId, localVaultOptions]
  );
  const activeLocalVaultIndex = useMemo(
    () => localVaultOptions.findIndex((item) => item.id === activeLocalVaultId),
    [activeLocalVaultId, localVaultOptions]
  );
  const currentProjectId =
    activeProjectId && orbitalData.projectById.has(activeProjectId) ? activeProjectId : null;
  const currentProjectEntityId = currentProjectId ? getProjectEntityId(currentProjectId) : null;
  const currentProject = currentProjectId
    ? orbitalData.projectById.get(currentProjectId) ?? null
    : null;
  const selectedEntityProjectId = selectedEntityId
    ? getEntityProjectId(selectedEntityId, orbitalData)
    : null;
  const inspectorScopeProjectId = currentProjectId ?? selectedEntityProjectId;
  useEffect(() => {
    if (!currentProjectId && inspectorHierarchyScope !== "vault") {
      setInspectorHierarchyScope("vault");
    }
  }, [currentProjectId, inspectorHierarchyScope]);
  const currentProjectFolders = useMemo(
    () => (currentProjectId ? folders.filter((folder) => folder.projectId === currentProjectId) : []),
    [currentProjectId, folders]
  );
  const currentProjectNotes = useMemo(
    () => (currentProjectId ? visibleNotes.filter((note) => note.projectId === currentProjectId) : []),
    [currentProjectId, visibleNotes]
  );
  const currentProjectAssets = useMemo(
    () =>
      currentProjectId
        ? assets.filter((asset) => orbitalData.noteById.get(asset.noteId)?.projectId === currentProjectId)
        : [],
    [assets, currentProjectId, orbitalData.noteById]
  );
  const currentProjectTagCounts = useMemo(() => {
    const counts = new Map<string, number>();

    currentProjectNotes.forEach((note) => {
      const noteTagLookups = new Set(
        note.tagIds
          .map((tagId) => tagMap.get(tagId)?.name ?? "")
          .map((name) => normalizeTagLookup(name))
          .filter(Boolean)
      );

      noteTagLookups.forEach((lookup) => {
        counts.set(lookup, (counts.get(lookup) ?? 0) + 1);
      });
    });

    return counts;
  }, [currentProjectNotes, tagMap]);
  const vaultTagCounts = useMemo(() => {
    const counts = new Map<string, number>();

    visibleNotes.forEach((note) => {
      const noteTagLookups = new Set(
        note.tagIds
          .map((tagId) => tagMap.get(tagId)?.name ?? "")
          .map((name) => normalizeTagLookup(name))
          .filter(Boolean)
      );

      noteTagLookups.forEach((lookup) => {
        counts.set(lookup, (counts.get(lookup) ?? 0) + 1);
      });
    });

    return counts;
  }, [tagMap, visibleNotes]);
  const vaultVisibleAssets = useMemo(
    () => assets.filter((asset) => orbitalData.noteById.has(asset.noteId)),
    [assets, orbitalData.noteById]
  );
  const vaultPinnedCount = useMemo(
    () => visibleNotes.filter((note) => isEntryFavorite(note)).length,
    [visibleNotes]
  );
  const trashedNoteCount = useMemo(
    () => notes.filter((note) => note.trashedAt !== null).length,
    [notes]
  );
  const isVaultInspectorScope = inspectorHierarchyScope === "vault";
  const inspectorContextAccent = isVaultInspectorScope
    ? DEFAULT_INTERFACE_ACCENT
    : currentProject?.color ?? DEFAULT_INTERFACE_ACCENT;
  const colorCounts = useMemo(() => {
    const counts = new Map<string, number>();

    if (currentProject?.color) {
      counts.set(currentProject.color, (counts.get(currentProject.color) ?? 0) + 1);
    }

    currentProjectFolders.forEach((folder) => {
      counts.set(folder.color, (counts.get(folder.color) ?? 0) + 1);
    });

    currentProjectNotes.forEach((note) => {
      const color = note.color || DEFAULT_NOTE_COLOR;
      counts.set(color, (counts.get(color) ?? 0) + 1);
    });

    return counts;
  }, [currentProject, currentProjectFolders, currentProjectNotes]);
  const vaultColorCounts = useMemo(() => {
    const counts = new Map<string, number>();

    orbitalData.projects.forEach((project) => {
      counts.set(project.color, (counts.get(project.color) ?? 0) + 1);
    });

    folders.forEach((folder) => {
      counts.set(folder.color, (counts.get(folder.color) ?? 0) + 1);
    });

    visibleNotes.forEach((note) => {
      const color = note.color || DEFAULT_NOTE_COLOR;
      counts.set(color, (counts.get(color) ?? 0) + 1);
    });

    return counts;
  }, [folders, orbitalData.projects, visibleNotes]);
  const totalSceneBodyCount = Math.max(orbitalData.totalEntities - orbitalData.projects.length, 0);
  const sceneBodyBudget = isMobilePreviewMode ? Math.min(54, ORBITAL_SCENE_BODY_BUDGET) : ORBITAL_SCENE_BODY_BUDGET;
  const isSceneBudgetConstrained = totalSceneBodyCount > sceneBodyBudget;
  const selectionVisualContext = useMemo(
    () => buildVisualContextSets(selectedEntityId, currentProjectEntityId, orbitalData),
    [currentProjectEntityId, orbitalData, selectedEntityId]
  );
  const ambientFavoriteEntityIds = useMemo(() => {
    const filterActive =
      normalizedFilterQuery.length > 0 ||
      activeColorFilters.length > 0 ||
      activeTagFilters.length > 0 ||
      activeFolderFilters.length > 0 ||
      activeNoteFilters.length > 0 ||
      activeAssetFilters.length > 0;

    if (selectedEntityId || filterActive) {
      return new Set<string>();
    }

    const related = new Set<string>();

    orbitalData.noteById.forEach((note) => {
      if (isEntryFavorite(note)) {
        related.add(`note:${note.id}`);
      }
    });

    return related;
  }, [
    activeAssetFilters.length,
    activeColorFilters.length,
    activeFolderFilters.length,
    activeNoteFilters.length,
    activeTagFilters.length,
    normalizedFilterQuery.length,
    orbitalData.noteById,
    selectedEntityId
  ]);
  const isPriorityFocusMode = false;
  const searchMatchedEntityIds = useMemo(() => {
    const matches = new Set<string>();

    if (!normalizedFilterQuery) {
      return matches;
    }

    orbitalData.projects.forEach((project) => {
      const projectLabel = getDisplayProjectName(
        project,
        language,
        orbitalData.projects.findIndex((entry) => entry.id === project.id)
      );

      if (projectLabel.toLowerCase().includes(normalizedFilterQuery)) {
        matches.add(getProjectEntityId(project.id));
      }
    });

    folders.forEach((folder) => {
      const path = folderPathMap.get(folder.id) ?? folder.name;
      const haystack = `${folder.name} ${path}`.toLowerCase();

      if (haystack.includes(normalizedFilterQuery)) {
        matches.add(`folder:${folder.id}`);
      }
    });

    orbitalData.noteById.forEach((note) => {
      const tagNames = note.tagIds
        .map((tagId) => tagMap.get(tagId)?.name ?? "")
        .join(" ");
      const folderPath = note.folderId ? folderPathMap.get(note.folderId) ?? "" : "";
      const assetNames = (assetNamesByNoteId.get(note.id) ?? []).join(" ");
      const haystack = [note.title, note.excerpt, note.plainText, tagNames, folderPath, assetNames]
        .join(" ")
        .toLowerCase();

      if (haystack.includes(normalizedFilterQuery)) {
        matches.add(`note:${note.id}`);
      }
    });

    return matches;
  }, [assetNamesByNoteId, folderPathMap, folders, normalizedFilterQuery, orbitalData.noteById, tagMap]);
  const tagFilteredEntityIds = useMemo(() => {
    const matches = new Set<string>();
    const scopedNotes = isVaultInspectorScope ? visibleNotes : currentProjectNotes;

    if (activeTagFilterSet.size === 0) {
      return matches;
    }

    scopedNotes.forEach((note) => {
      const noteTagLookups = new Set(
        note.tagIds
          .map((tagId) => tagMap.get(tagId)?.name ?? "")
          .map((name) => normalizeTagLookup(name))
          .filter(Boolean)
      );

      for (const lookup of noteTagLookups) {
        if (activeTagFilterSet.has(lookup)) {
          matches.add(`note:${note.id}`);
          break;
        }
      }
    });

    return matches;
  }, [activeTagFilterSet, currentProjectNotes, isVaultInspectorScope, tagMap, visibleNotes]);
  const colorFilteredEntityIds = useMemo(() => {
    const matches = new Set<string>();

    if (activeColorFilterSet.size === 0) {
      return matches;
    }

    if (isVaultInspectorScope) {
      orbitalData.projects.forEach((project) => {
        if (activeColorFilterSet.has(project.color)) {
          matches.add(getProjectEntityId(project.id));
        }
      });

      folders.forEach((folder) => {
        if (activeColorFilterSet.has(folder.color)) {
          matches.add(`folder:${folder.id}`);
        }
      });

      visibleNotes.forEach((note) => {
        if (activeColorFilterSet.has(note.color || DEFAULT_NOTE_COLOR)) {
          matches.add(`note:${note.id}`);
        }
      });

      return matches;
    }

    if (currentProject && activeColorFilterSet.has(currentProject.color)) {
      matches.add(getProjectEntityId(currentProject.id));
    }

    currentProjectFolders.forEach((folder) => {
      if (activeColorFilterSet.has(folder.color)) {
        matches.add(`folder:${folder.id}`);
      }
    });

    currentProjectNotes.forEach((note) => {
      if (activeColorFilterSet.has(note.color || DEFAULT_NOTE_COLOR)) {
        matches.add(`note:${note.id}`);
      }
    });

    return matches;
  }, [
    activeColorFilterSet,
    currentProject,
    currentProjectFolders,
    currentProjectNotes,
    folders,
    isVaultInspectorScope,
    orbitalData.projects,
    visibleNotes
  ]);
  const folderPrimaryFilteredEntityIds = useMemo(() => {
    const matches = new Set<string>();

    activeFolderFilterSet.forEach((folderId) => {
      if (orbitalData.folderById.has(folderId)) {
        matches.add(`folder:${folderId}`);
      }
    });

    return matches;
  }, [activeFolderFilterSet, orbitalData.folderById]);
  const folderDescendantFilteredEntityIds = useMemo(() => {
    const matches = new Set<string>();

    activeFolderFilterSet.forEach((folderId) => {
      if (!orbitalData.folderById.has(folderId)) {
        return;
      }

      collectFolderSubtreeEntityIds(folderId, orbitalData).forEach((entityId) => {
        if (entityId === `folder:${folderId}`) {
          return;
        }

        if (
          entityId.startsWith("folder:") &&
          activeFolderFilterSet.has(entityId.slice("folder:".length))
        ) {
          return;
        }

        matches.add(entityId);
      });
    });

    return matches;
  }, [activeFolderFilterSet, orbitalData]);
  const noteFilteredEntityIds = useMemo(() => {
    const matches = new Set<string>();

    activeNoteFilterSet.forEach((noteId) => {
      if (orbitalData.noteById.has(noteId)) {
        matches.add(`note:${noteId}`);
      }
    });

    return matches;
  }, [activeNoteFilterSet, orbitalData.noteById]);
  const assetFilteredEntityIds = useMemo(() => {
    const matches = new Set<string>();

    assets.forEach((asset) => {
      if (activeAssetFilterSet.has(asset.id) && orbitalData.noteById.has(asset.noteId)) {
        matches.add(`note:${asset.noteId}`);
      }
    });

    return matches;
  }, [activeAssetFilterSet, assets, orbitalData.noteById]);
  const hasActiveFilter =
    normalizedFilterQuery.length > 0 ||
    activeColorFilters.length > 0 ||
    activeTagFilters.length > 0 ||
    activeFolderFilters.length > 0 ||
    activeNoteFilters.length > 0 ||
    activeAssetFilters.length > 0;
  const filterPrimaryEntityIds = useMemo(() => {
    const matches = new Set<string>();

    searchMatchedEntityIds.forEach((entityId) => matches.add(entityId));
    colorFilteredEntityIds.forEach((entityId) => matches.add(entityId));
    tagFilteredEntityIds.forEach((entityId) => matches.add(entityId));
    folderPrimaryFilteredEntityIds.forEach((entityId) => matches.add(entityId));
    noteFilteredEntityIds.forEach((entityId) => matches.add(entityId));
    assetFilteredEntityIds.forEach((entityId) => matches.add(entityId));

    return matches;
  }, [
    assetFilteredEntityIds,
    colorFilteredEntityIds,
    folderPrimaryFilteredEntityIds,
    noteFilteredEntityIds,
    searchMatchedEntityIds,
    tagFilteredEntityIds
  ]);
  const filterSecondaryEntityIds = useMemo(() => {
    const matches = new Set<string>();

    folderDescendantFilteredEntityIds.forEach((entityId) => {
      if (!filterPrimaryEntityIds.has(entityId)) {
        matches.add(entityId);
      }
    });

    return matches;
  }, [filterPrimaryEntityIds, folderDescendantFilteredEntityIds]);
  const sceneToneByEntityId = useMemo(() => {
    const toneMap = new Map<string, OrbitalVisualTone>();

    const applyTone = (entityId: string, tone: OrbitalVisualTone) => {
      const current = toneMap.get(entityId);
      const rank =
        tone === "primary" ? 4 : tone === "direct" ? 3 : tone === "secondary" ? 2 : 1;
      const currentRank =
        current === "primary" ? 4 : current === "direct" ? 3 : current === "secondary" ? 2 : current === "muted" ? 1 : 0;

      if (rank > currentRank) {
        toneMap.set(entityId, tone);
      }
    };

    orbitalData.projects.forEach((project) => {
      applyTone(getProjectEntityId(project.id), "muted");
    });
    orbitalData.folderById.forEach((folder) => {
      applyTone(`folder:${folder.id}`, "muted");
    });
    orbitalData.noteById.forEach((note) => {
      applyTone(`note:${note.id}`, "muted");
    });

    const selectionActive = Boolean(selectedEntityId);
    const filterActive = hasActiveFilter;

    if (selectionActive && !filterActive) {
      selectionVisualContext.primary.forEach((entityId) => applyTone(entityId, "primary"));
      selectionVisualContext.direct.forEach((entityId) => applyTone(entityId, "direct"));
      selectionVisualContext.secondary.forEach((entityId) => applyTone(entityId, "secondary"));
    }

    if (filterActive) {
      filterPrimaryEntityIds.forEach((entityId) => applyTone(entityId, "primary"));
      filterSecondaryEntityIds.forEach((entityId) => applyTone(entityId, "secondary"));
    }

    ambientFavoriteEntityIds.forEach((entityId) => applyTone(entityId, "direct"));

    return toneMap;
  }, [
    ambientFavoriteEntityIds,
    filterPrimaryEntityIds,
    filterSecondaryEntityIds,
    hasActiveFilter,
    orbitalData.folderById,
    orbitalData.noteById,
    orbitalData.projects,
    selectedEntityId,
    selectionVisualContext
  ]);
  const sceneVisibleEntityIds = useMemo(() => {
    if (!isSceneBudgetConstrained) {
      return null;
    }

    return buildAdaptiveVisibilitySet({
      data: orbitalData,
      budget: sceneBodyBudget,
      currentProjectId,
      priorityProjectId: isPriorityFocusMode
        ? selectedEntityId
          ? getEntityProjectId(selectedEntityId, orbitalData)
          : currentProjectId
        : null,
      selectedEntityId,
      filterPrimaryEntityIds,
      filterSecondaryEntityIds
    });
  }, [
    currentProjectId,
    filterPrimaryEntityIds,
    filterSecondaryEntityIds,
    isPriorityFocusMode,
    isSceneBudgetConstrained,
    orbitalData,
    sceneBodyBudget,
    selectedEntityId
  ]);
  const sceneLayout = useMemo(
    () => buildOrbitalLayout(orbitalData, sceneVisibleEntityIds, language),
    [language, orbitalData, sceneVisibleEntityIds]
  );
  const sceneMovingEntityIds = useMemo(() => {
    const movingEntityIds = new Set<string>();

    if (!isOrbitalMotionEnabled) {
      return movingEntityIds;
    }

    const selectedProjectId = getEntityProjectId(selectedEntityId, orbitalData);

    const addProject = (projectId: string | null | undefined) => {
      if (!projectId) {
        return;
      }

      collectProjectEntityIds(projectId, orbitalData).forEach((entityId) => {
        movingEntityIds.add(entityId);
      });
    };

    addProject(currentProjectId);
    addProject(selectedProjectId);

    orbitalData.noteById.forEach((note) => {
      if (isEntryFavorite(note)) {
        movingEntityIds.add(`note:${note.id}`);
      }
    });

    return movingEntityIds;
  }, [currentProjectId, isOrbitalMotionEnabled, orbitalData, selectedEntityId]);
  const scene = useMemo(
    () =>
      materializeOrbitalScene(
        sceneLayout,
        timeMs,
        sceneToneByEntityId,
        isMobilePreviewMode ? 0.82 : 1,
        sceneMovingEntityIds
      ),
    [isMobilePreviewMode, sceneLayout, sceneMovingEntityIds, sceneToneByEntityId, timeMs]
  );
  const isLowDensityDisplay = devicePixelRatio < LOW_DENSITY_DPR_THRESHOLD;

  const renderedScene = useMemo(
    () => buildRenderedOrbitalScene(scene, animatedNodePositionsRef.current),
    [animatedSceneVersion, scene]
  );
  const getSceneTone = (entityId: string): OrbitalVisualTone => sceneToneByEntityId.get(entityId) ?? "muted";
  const isTemporalSignalsGloballyEnabled = orbitalTemporalSignalsMode === "enabled";
  const isTemporalLayerVisible = isTemporalSignalsGloballyEnabled && !isTemporalLayerQuickHidden;
  const temporalMapSignals = useMemo(
    () =>
      buildPlannerMapSignals({
        projects: orbitalData.projects,
        tasks
      }),
    [orbitalData.projects, tasks]
  );
  const temporalLayerProjectNodes = useMemo<TemporalMapProjectNode[]>(
    () =>
      renderedScene.nodes
        .filter((node) => node.kind === "core" && node.project)
        .map((node) => ({
          projectId: node.project!.id,
          x: node.x,
          y: node.y,
          radius: node.radius,
          color: node.project!.color || node.color,
          isSelected: node.entityId === selectedEntityId,
          isPrimary:
            node.entityId === currentProjectEntityId ||
            getSceneTone(node.entityId) === "primary" ||
            getSceneTone(node.entityId) === "direct"
        })),
    [currentProjectEntityId, renderedScene.nodes, sceneToneByEntityId, selectedEntityId]
  );
  const selectedNode = selectedEntityId ? renderedScene.entityMap.get(selectedEntityId) ?? null : null;
  const selectedProjectTemporalSignal =
    selectedNode?.kind === "core" && selectedNode.project
      ? temporalMapSignals.byProjectId.get(selectedNode.project.id) ?? null
      : null;
  const selectedProjectPlanLabel = selectedNode?.project
    ? `${t("orbit.timeLayer")} “${selectedNode.project.name}”`
    : t("orbit.timeLayerOpenPlan");
  const shouldShowHierarchyInspector =
    inspectorMenu === "folders" && (selectedNode?.kind === "folder" || selectedNode?.kind === "note");
  const effectiveInspectorMenu = shouldShowHierarchyInspector ? "folders" : inspectorMenu;
  const selectedHierarchyExpandedProjectSet = useMemo(() => {
    const expandedProjects = new Set<string>();
    const entityIds = [
      selectedEntityId?.startsWith("project:") ? null : selectedEntityId,
      hierarchyFocusedEntityId?.startsWith("project:") ? null : hierarchyFocusedEntityId,
      ...activeFolderFilters.map((id) => `folder:${id}`),
      ...activeNoteFilters.map((id) => `note:${id}`)
    ].filter((value): value is string => Boolean(value));

    entityIds.forEach((entityId) => {
      const projectId = getEntityProjectId(entityId, orbitalData);
      if (projectId) {
        expandedProjects.add(projectId);
      }
    });

    return expandedProjects;
  }, [
    activeFolderFilters,
    activeNoteFilters,
    hierarchyFocusedEntityId,
    orbitalData,
    selectedEntityId
  ]);
  const selectedHierarchyExpandedFolderSet = useMemo(() => {
    const expandedFolders = new Set<string>();

    if (!selectedNode || selectedNode.kind === "core") {
      return expandedFolders;
    }

    let currentFolderId =
      selectedNode.kind === "folder"
        ? selectedNode.folder?.parentId ?? null
        : selectedNode.note?.folderId ?? null;

    while (currentFolderId) {
      expandedFolders.add(currentFolderId);
      currentFolderId = orbitalData.folderById.get(currentFolderId)?.parentId ?? null;
    }

    return expandedFolders;
  }, [orbitalData.folderById, selectedNode]);
  const registerInspectorHierarchyItemRef = (entityId: string, node: HTMLElement | null) => {
    if (node) {
      inspectorHierarchyItemRefs.current.set(entityId, node);
      return;
    }

    inspectorHierarchyItemRefs.current.delete(entityId);
  };
  const requestInspectorHierarchyAutoScroll = () => {
    lastInspectorHierarchyAutoScrollKeyRef.current = null;
    setInspectorHierarchyAutoScrollRequestId((current) => current + 1);
  };
  const currentProjectNode = currentProjectEntityId
    ? renderedScene.entityMap.get(currentProjectEntityId)
    : undefined;
  const hoverPreviewNote = hoveredSelectionNoteId
    ? orbitalData.noteById.get(hoveredSelectionNoteId) ?? null
    : null;
  const hoverPreviewAsset = hoveredAssetId ? assetById.get(hoveredAssetId) ?? null : null;
  const hoverPreviewAssetNote = hoverPreviewAsset
    ? orbitalData.noteById.get(hoverPreviewAsset.noteId) ?? null
    : null;
  const clearHoverPreviewCloseTimeout = () => {
    if (hoverPreviewCloseTimeoutRef.current !== null) {
      window.clearTimeout(hoverPreviewCloseTimeoutRef.current);
      hoverPreviewCloseTimeoutRef.current = null;
    }
  };

  const closeSelectionHoverPreview = () => {
    clearHoverPreviewCloseTimeout();
    setHoveredSelectionNoteId(null);
    setHoveredAssetId(null);
    setHoverPreviewAnchorSource(null);
    setHoverPreviewFallbackRect(null);
    hoverPreviewSceneAnchorRef.current = null;
  };

  const isPointerInsideHoverPreviewCard = () => {
    const card = hoverPreviewCardRef.current;

    if (!card) {
      return false;
    }

    const { x, y } = hoverPreviewCursorRef.current;
    const element = document.elementFromPoint(x, y);
    return Boolean(element && card.contains(element));
  };

  const scheduleSelectionHoverPreviewClose = () => {
    clearHoverPreviewCloseTimeout();
    hoverPreviewCloseTimeoutRef.current = window.setTimeout(() => {
      if (isPointerInsideHoverPreviewCard()) {
        hoverPreviewCloseTimeoutRef.current = null;
        return;
      }

      setHoveredSelectionNoteId(null);
      setHoveredAssetId(null);
      hoverPreviewCloseTimeoutRef.current = null;
    }, 180);
  };

  const openSelectionHoverPreview = (
    noteId: string,
    clientX: number,
    clientY: number,
    source: HoverPreviewAnchorSource,
    options?: {
      anchorRect?: HoverPreviewAnchorRect | null;
      sceneAnchorElement?: SVGGElement | null;
    }
  ) => {
    if (!canShowHoverPreview) {
      return;
    }

    clearHoverPreviewCloseTimeout();
    markOrbitInteraction();
    setHoveredSelectionNoteId(noteId);
    setHoveredAssetId(null);
    setHoverPreviewAnchorSource(source);
    setHoverPreviewFallbackRect(options?.anchorRect ?? null);
    hoverPreviewSceneAnchorRef.current = options?.sceneAnchorElement ?? null;
    hoverPreviewCursorRef.current = { x: clientX, y: clientY };
    setHoverPreviewCursor({ x: clientX, y: clientY });
  };

  const openAssetHoverPreview = (
    assetId: string,
    clientX: number,
    clientY: number,
    source: HoverPreviewAnchorSource,
    options?: {
      anchorRect?: HoverPreviewAnchorRect | null;
    }
  ) => {
    if (!canShowHoverPreview) {
      return;
    }

    clearHoverPreviewCloseTimeout();
    markOrbitInteraction();
    setHoveredSelectionNoteId(null);
    setHoveredAssetId(assetId);
    setHoverPreviewAnchorSource(source);
    setHoverPreviewFallbackRect(options?.anchorRect ?? null);
    hoverPreviewSceneAnchorRef.current = null;
    hoverPreviewCursorRef.current = { x: clientX, y: clientY };
    setHoverPreviewCursor({ x: clientX, y: clientY });
  };

  const openMobileNotePreview = (noteId: string) => {
    if (!isAndroidTouchLayout) {
      return;
    }

    closeInspectorContextMenu();
    clearHoverPreviewCloseTimeout();
    markOrbitInteraction();
    setHoveredSelectionNoteId(noteId);
    setHoveredAssetId(null);
    setHoverPreviewAnchorSource("inspector");
    setHoverPreviewFallbackRect(null);
    hoverPreviewSceneAnchorRef.current = null;
  };

  const openMobileAssetPreview = (assetId: string) => {
    if (!isAndroidTouchLayout) {
      return;
    }

    closeInspectorContextMenu();
    clearHoverPreviewCloseTimeout();
    markOrbitInteraction();
    setHoveredSelectionNoteId(null);
    setHoveredAssetId(assetId);
    setHoverPreviewAnchorSource("inspector");
    setHoverPreviewFallbackRect(null);
    hoverPreviewSceneAnchorRef.current = null;
  };

  const clearMobilePreviewLongPress = () => {
    if (mobilePreviewLongPressRef.current) {
      window.clearTimeout(mobilePreviewLongPressRef.current.timeoutId);
      mobilePreviewLongPressRef.current = null;
    }
  };

  const startMobilePreviewLongPress = (
    onPreview: () => void,
    event: ReactPointerEvent<HTMLElement>
  ) => {
    if (!isAndroidTouchLayout || event.pointerType === "mouse") {
      return;
    }

    clearMobilePreviewLongPress();
    mobilePreviewLongPressRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      onPreview,
      timeoutId: window.setTimeout(() => {
        suppressInspectorClickRef.current = true;
        mobilePreviewLongPressRef.current = null;
        onPreview();
      }, INSPECTOR_LONG_PRESS_MS)
    };
  };

  const updateMobilePreviewLongPress = (event: ReactPointerEvent<HTMLElement>) => {
    const pending = mobilePreviewLongPressRef.current;

    if (!pending || pending.pointerId !== event.pointerId) {
      return;
    }

    if (
      Math.abs(event.clientX - pending.startX) > INSPECTOR_LONG_PRESS_MOVE_TOLERANCE ||
      Math.abs(event.clientY - pending.startY) > INSPECTOR_LONG_PRESS_MOVE_TOLERANCE
    ) {
      clearMobilePreviewLongPress();
    }
  };

  const endMobilePreviewLongPress = (pointerId: number) => {
    if (mobilePreviewLongPressRef.current?.pointerId === pointerId) {
      clearMobilePreviewLongPress();
    }
  };

  const updateSelectionHoverPreviewCursor = (
    clientX: number,
    clientY: number,
    options?: {
      anchorRect?: HoverPreviewAnchorRect | null;
      sceneAnchorElement?: SVGGElement | null;
    }
  ) => {
    if (!canShowHoverPreview) {
      return;
    }

    markOrbitInteraction();

    if (typeof options?.anchorRect !== "undefined") {
      setHoverPreviewFallbackRect(options.anchorRect);
    }

    if (typeof options?.sceneAnchorElement !== "undefined") {
      hoverPreviewSceneAnchorRef.current = options.sceneAnchorElement ?? null;
    }

    hoverPreviewCursorRef.current = { x: clientX, y: clientY };
    setHoverPreviewCursor({ x: clientX, y: clientY });
  };

  const markOrbitInteraction = () => {
    if (!orbitInteractionActiveRef.current) {
      orbitInteractionActiveRef.current = true;
      setIsOrbitInteractionActive(true);
    }

    if (orbitInteractionTimeoutRef.current !== null) {
      window.clearTimeout(orbitInteractionTimeoutRef.current);
    }

    orbitInteractionTimeoutRef.current = window.setTimeout(() => {
      orbitInteractionActiveRef.current = false;
      setIsOrbitInteractionActive(false);
      orbitInteractionTimeoutRef.current = null;
    }, ORBIT_INTERACTION_WINDOW_MS);
  };

  useEffect(() => {
    if (
      editorOpen ||
      (hoveredSelectionNoteId && !hoverPreviewNote) ||
      (hoveredAssetId && !hoverPreviewAsset)
    ) {
      closeSelectionHoverPreview();
    }
  }, [editorOpen, hoverPreviewAsset, hoverPreviewNote, hoveredAssetId, hoveredSelectionNoteId]);

  useEffect(() => {
    if (!editorOpen || editorMode !== "canvas") {
      setIsCanvasEditorFullscreen(false);
    }
  }, [editorMode, editorOpen]);

  useEffect(() => {
    if (
      hoverPreviewAnchorSource === "inspector" &&
      effectiveInspectorMenu !== "overview" &&
      effectiveInspectorMenu !== "notes" &&
      effectiveInspectorMenu !== "folders" &&
      effectiveInspectorMenu !== "files" &&
      effectiveInspectorMenu !== "pinned"
    ) {
      closeSelectionHoverPreview();
    }
  }, [effectiveInspectorMenu, hoverPreviewAnchorSource]);

  useEffect(() => {
    if ((hoveredSelectionNoteId || hoveredAssetId) && noteHoverPreviewScrollRef.current) {
      noteHoverPreviewScrollRef.current.scrollTop = 0;
    }
  }, [hoveredAssetId, hoveredSelectionNoteId]);

  useEffect(() => {
    if (!hoverPreviewAsset) {
      setHoverPreviewAssetUrl(null);
      return undefined;
    }

    const objectUrl = URL.createObjectURL(hoverPreviewAsset.blob);
    setHoverPreviewAssetUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [hoverPreviewAsset]);

  useEffect(() => {
    const targetEntityId = hierarchyFocusedEntityId ?? selectedEntityId;

    if (effectiveInspectorMenu !== "folders" || !targetEntityId) {
      lastInspectorHierarchyAutoScrollKeyRef.current = null;
      return;
    }

    const scrollKey = [
      effectiveInspectorMenu,
      inspectorHierarchyScope,
      normalizedInspectorQuery,
      targetEntityId,
      inspectorHierarchyAutoScrollRequestId
    ].join(":");

    if (lastInspectorHierarchyAutoScrollKeyRef.current === scrollKey) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const scroller = inspectorPanelRef.current;
      const list = inspectorMenuListRef.current;
      const target = inspectorHierarchyItemRefs.current.get(targetEntityId);

      if (!scroller || !list || !target) {
        return;
      }

      const scrollerRect = scroller.getBoundingClientRect();
      const header = scroller.querySelector(
        ".orbital-inspector-subview-top.orbital-inspector-subview-card"
      ) as HTMLElement | null;
      const headerRect = header?.getBoundingClientRect() ?? null;
      const targetRect = target.getBoundingClientRect();
      const topBoundary = Math.max(
        scrollerRect.top + 8,
        headerRect ? headerRect.bottom + 10 : scrollerRect.top + 8
      );
      const bottomBoundary = scrollerRect.bottom - 12;
      const isVisible =
        targetRect.top >= topBoundary &&
        targetRect.bottom <= bottomBoundary;

      if (!isVisible) {
        const nextScrollTop =
          targetRect.top < topBoundary
            ? scroller.scrollTop + targetRect.top - topBoundary
            : scroller.scrollTop + targetRect.bottom - bottomBoundary;

        scroller.scrollTo({
          top: Math.max(0, nextScrollTop),
          behavior: "smooth"
        });
      }

      lastInspectorHierarchyAutoScrollKeyRef.current = scrollKey;
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    effectiveInspectorMenu,
    hierarchyFocusedEntityId,
    inspectorHierarchyAutoScrollRequestId,
    inspectorHierarchyScope,
    normalizedInspectorQuery,
    selectedEntityId
  ]);

  useEffect(() => {
    return () => {
      clearHoverPreviewCloseTimeout();
      clearInspectorLongPress();
      clearHierarchyPointerDrag();
      if (vaultRenameErrorTimeoutRef.current) {
        window.clearTimeout(vaultRenameErrorTimeoutRef.current);
        vaultRenameErrorTimeoutRef.current = null;
      }
      if (inspectorToastTimeoutRef.current) {
        window.clearTimeout(inspectorToastTimeoutRef.current);
        inspectorToastTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setCollapsedInspectorFolders((current) =>
      current.filter((folderId) => orbitalData.folderById.has(folderId))
    );
  }, [orbitalData.folderById]);

  useEffect(() => {
    setExpandedInspectorProjects((current) =>
      current.filter((projectId) => orbitalData.projectById.has(projectId))
    );
  }, [orbitalData.projectById]);

  useEffect(() => {
    if (editingProjectId && !orbitalData.projectById.has(editingProjectId)) {
      setEditingProjectId(null);
      setProjectNameDraft("");
    }
  }, [editingProjectId, orbitalData.projectById]);

  useEffect(() => {
    if (isEditingVaultTitle && !activeLocalVaultItem) {
      cancelVaultRename();
    }
  }, [activeLocalVaultItem, isEditingVaultTitle]);

  useEffect(() => {
    if (!inspectorRenameState) {
      return;
    }

    const exists =
      inspectorRenameState.kind === "core"
        ? orbitalData.projectById.has(inspectorRenameState.id)
        : inspectorRenameState.kind === "folder"
          ? orbitalData.folderById.has(inspectorRenameState.id)
          : orbitalData.noteById.has(inspectorRenameState.id);

    if (!exists) {
      cancelInspectorRename();
    }
  }, [inspectorRenameState, orbitalData.folderById, orbitalData.noteById, orbitalData.projectById]);

  useEffect(() => {
    if (!contextMenuState) {
      return;
    }

    const exists =
      contextMenuState.target.kind === "core"
        ? orbitalData.projectById.has(contextMenuState.target.project.id)
        : contextMenuState.target.kind === "folder"
        ? orbitalData.folderById.has(contextMenuState.target.folder.id)
        : orbitalData.noteById.has(contextMenuState.target.note.id);

    if (!exists) {
      closeInspectorContextMenu();
    }
  }, [contextMenuState, orbitalData.folderById, orbitalData.noteById, orbitalData.projectById]);

  useEffect(() => {
    closeInspectorContextMenu();
  }, [inspectorMenu]);

  useEffect(() => {
    if (editorOpen || activeModal) {
      closeInspectorContextMenu();
    }
  }, [activeModal, editorOpen]);

  useEffect(() => {
    if (editorOpen || activeModal || effectiveInspectorMenu !== "folders") {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      const isShortcut = event.metaKey || event.ctrlKey;

      if (isShortcut && event.key.toLowerCase() === "c") {
        const targets = getCurrentInspectorSelectionTargets();

        if (targets.length === 0) {
          return;
        }

        event.preventDefault();
        setInspectorClipboard(getClipboardItemsFromTargets(targets));
        return;
      }

      if (isShortcut && event.key.toLowerCase() === "v") {
        event.preventDefault();
        void pasteInspectorClipboard(null);
        return;
      }

      if (event.key === "Delete") {
        const targets = getCurrentInspectorSelectionTargets();

        if (targets.length === 0) {
          return;
        }

        event.preventDefault();
        void deleteInspectorTargets(targets);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    activeFolderFilters,
    activeModal,
    activeNoteFilters,
    currentProjectId,
    editorOpen,
    effectiveInspectorMenu,
    inspectorClipboard,
    orbitalData.folderById,
    orbitalData.folderMeta,
    orbitalData.noteById,
    selectedNode
  ]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState !== "hidden");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    markOrbitInteraction();

    return () => {
      if (orbitInteractionTimeoutRef.current !== null) {
        window.clearTimeout(orbitInteractionTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOverviewColorPanelOpen) {
      return undefined;
    }

    const updatePosition = () => {
      if (!overviewColorTriggerRef.current) {
        return;
      }

      const rect = overviewColorTriggerRef.current.getBoundingClientRect();
      const viewportWidth = typeof window === "undefined" ? 1440 : window.innerWidth;
      const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
      const viewportPadding = 12;
      const gap = 16;
      const width = Math.min(252, viewportWidth - viewportPadding * 2);
      const height = Math.min(212, viewportHeight - viewportPadding * 2);
      const room = {
        right: viewportWidth - viewportPadding - (rect.right + gap),
        left: rect.left - viewportPadding - gap,
        bottom: viewportHeight - viewportPadding - (rect.bottom + gap),
        top: rect.top - viewportPadding - gap
      };

      const candidates = [
        {
          placement: "right" as const,
          fits: room.right >= width,
          score: room.right,
          left: rect.right + gap,
          top: clamp(rect.top - 6, viewportPadding, viewportHeight - height - viewportPadding)
        },
        {
          placement: "left" as const,
          fits: room.left >= width,
          score: room.left,
          left: rect.left - gap - width,
          top: clamp(rect.top - 6, viewportPadding, viewportHeight - height - viewportPadding)
        },
        {
          placement: "bottom" as const,
          fits: room.bottom >= height,
          score: room.bottom,
          left: clamp(rect.left, viewportPadding, viewportWidth - width - viewportPadding),
          top: rect.bottom + gap
        },
        {
          placement: "top" as const,
          fits: room.top >= height,
          score: room.top,
          left: clamp(rect.left, viewportPadding, viewportWidth - width - viewportPadding),
          top: rect.top - gap - height
        }
      ];

      const chosen =
        candidates.find((candidate) => candidate.placement === "right" && candidate.fits) ??
        candidates.find((candidate) => candidate.placement === "left" && candidate.fits) ??
        candidates.find((candidate) => candidate.placement === "bottom" && candidate.fits) ??
        candidates.find((candidate) => candidate.placement === "top" && candidate.fits) ??
        [...candidates].sort((left, right) => right.score - left.score)[0];

      setOverviewColorPanelStyle({
        left: clamp(chosen.left, viewportPadding, viewportWidth - width - viewportPadding),
        top: clamp(chosen.top, viewportPadding, viewportHeight - height - viewportPadding),
        width,
        maxHeight: height,
        placement: chosen.placement
      });
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;

      if (
        target &&
        (overviewColorTriggerRef.current?.contains(target) ||
          overviewColorPanelRef.current?.contains(target))
      ) {
        return;
      }

      setIsOverviewColorPanelOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsOverviewColorPanelOpen(false);
      }
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOverviewColorPanelOpen]);

  useEffect(() => {
    setIsOverviewColorPanelOpen(false);
  }, [contextMenuState, currentProjectId]);

  const anchorNode =
    selectedNode || currentProjectNode || renderedScene.nodes.find((node) => node.kind === "core");
  const visibleBodies = Math.max(renderedScene.nodes.filter((node) => node.kind !== "core").length, 0);
  const hiddenBodies = Math.max(orbitalData.totalEntities - renderedScene.nodes.length, 0);
  const handleFilterChipWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    const chipRow = event.currentTarget;

    if (chipRow.scrollWidth <= chipRow.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      return;
    }

    event.preventDefault();
    chipRow.scrollLeft += event.deltaY;
  };
  const pinnedCount = useMemo(
    () => currentProjectNotes.filter((note) => isEntryFavorite(note)).length,
    [currentProjectNotes]
  );
  const autoFocusEnabled = isSceneBudgetConstrained && !isPriorityFocusMode;
  const isSceneFocusActive = isSceneBudgetConstrained && isPriorityFocusMode;
  const isDenseOrbitalScene = orbitalData.totalEntities > 80;
  const orbitFrameInterval = isAndroidMobileShell
    ? isOrbitInteractionActive
      ? isDenseOrbitalScene
        ? ORBIT_ANDROID_ACTIVE_FRAME_MS_LARGE
        : ORBIT_ANDROID_ACTIVE_FRAME_MS
      : isDenseOrbitalScene
        ? ORBIT_ANDROID_IDLE_FRAME_MS_LARGE
        : ORBIT_ANDROID_IDLE_FRAME_MS
    : isOrbitInteractionActive
      ? isDenseOrbitalScene
        ? ORBIT_ACTIVE_FRAME_MS_LARGE
        : ORBIT_ACTIVE_FRAME_MS
      : isDenseOrbitalScene
        ? ORBIT_IDLE_FRAME_MS_LARGE
        : ORBIT_IDLE_FRAME_MS;
  const isOrbitAnimationSuspended =
    !isOrbitalMotionEnabled ||
    !isMapSurfaceVisible ||
    !isMobileMapVisible ||
    isPaused ||
    editorOpen ||
    activeModal !== null ||
    !isDocumentVisible ||
    prefersReducedMotion ||
    sceneMovingEntityIds.size === 0;
  useEffect(() => {
    if (!isOrbitAnimationSuspended) {
      // Continuous orbit motion already arrives through `scene`; the position-easing loop is
      // reserved for static states so it does not chase a moving target every animation frame.
      targetNodePositionsRef.current = new Map();
      stopScenePositionAnimation();

      if (animatedNodePositionsRef.current.size > 0) {
        animatedNodePositionsRef.current = new Map();
        setAnimatedSceneVersion((current) => current + 1);
      }

      return;
    }

    const shouldSnapImmediately =
      prefersReducedMotion ||
      isOrbitAnimationSuspended ||
      dragRef.current?.mode === "project";
    const nextTargetPositions = new Map<string, OrbitalScenePosition>(
      scene.nodes.map((node) => [node.entityId, { x: node.x, y: node.y }])
    );

    targetNodePositionsRef.current = nextTargetPositions;

    if (shouldSnapImmediately) {
      animatedNodePositionsRef.current = new Map(nextTargetPositions);
      stopScenePositionAnimation();
      setAnimatedSceneVersion((current) => current + 1);
      return;
    }

    const currentPositions = animatedNodePositionsRef.current;
    let changed = false;

    nextTargetPositions.forEach((targetPosition, entityId) => {
      if (!currentPositions.has(entityId)) {
        currentPositions.set(entityId, {
          x: targetPosition.x,
          y: targetPosition.y
        });
        changed = true;
      }
    });

    Array.from(currentPositions.keys()).forEach((entityId) => {
      if (!nextTargetPositions.has(entityId)) {
        currentPositions.delete(entityId);
        changed = true;
      }
    });

    if (changed) {
      setAnimatedSceneVersion((current) => current + 1);
    }

    startScenePositionAnimation();
  }, [isOrbitAnimationSuspended, prefersReducedMotion, scene.nodes]);
  const focusSystemLabel =
    !anchorNode
      ? labels.core
      : anchorNode.kind === "core" && anchorNode.project
        ? getDisplayProjectName(
            anchorNode.project,
            language,
            orbitalData.projects.findIndex((entry) => entry.id === anchorNode.project!.id)
          )
      : anchorNode.kind === "folder" && anchorNode.folder
        ? folderPathMap.get(anchorNode.folder.id) ?? anchorNode.folder.name
        : anchorNode.kind === "note" && anchorNode.note?.folderId
          ? folderPathMap.get(anchorNode.note.folderId) ?? labels.uncategorized
          : getDisplayProjectName(
              currentProject,
              language,
              orbitalData.projects.findIndex((entry) => entry.id === currentProject?.id)
            );

  useEffect(() => {
    timeRef.current = timeMs;
  }, [timeMs]);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useEffect(() => {
    projectPositionDraftsRef.current = projectPositionDrafts;
  }, [projectPositionDrafts]);

  useEffect(() => {
    if (!orbitalData.projects.length) {
      if (activeProjectId !== null) {
        setActiveProjectId(null);
      }
      return;
    }

    if (activeProjectId && !orbitalData.projectById.has(activeProjectId)) {
      setActiveProjectId(null);
    }
  }, [activeProjectId, orbitalData.projectById, orbitalData.projects]);

  useEffect(() => {
    if (inspectorMenu !== "folders" || inspectorHierarchyScope === "vault") {
      return;
    }

    const selectedProjectId = getEntityProjectId(selectedEntityId, orbitalData);

    if (selectedProjectId && selectedProjectId !== activeProjectId) {
      setActiveProjectId(selectedProjectId);
    }
  }, [activeProjectId, inspectorHierarchyScope, inspectorMenu, orbitalData, selectedEntityId]);

  useEffect(() => {
    if (isVaultInspectorScope) {
      return;
    }

    if (!currentProjectEntityId) {
      setHierarchyFocusedEntityId(null);
      return;
    }

    if (!hierarchyFocusedEntityId) {
      setHierarchyFocusedEntityId(currentProjectEntityId);
      return;
    }

    const focusedProjectId = getEntityProjectId(hierarchyFocusedEntityId, orbitalData);

    if (!focusedProjectId || focusedProjectId !== currentProjectId) {
      setHierarchyFocusedEntityId(currentProjectEntityId);
    }
  }, [
    currentProjectEntityId,
    currentProjectId,
    hierarchyFocusedEntityId,
    isVaultInspectorScope,
    orbitalData
  ]);

  useEffect(() => {
    if (!selectedEntityId || effectiveInspectorMenu !== "folders") {
      return;
    }

    const selectedProjectId = getEntityProjectId(selectedEntityId, orbitalData);

    if (selectedProjectId && selectedProjectId === currentProjectId) {
      setHierarchyFocusedEntityId(selectedEntityId);
    }
  }, [currentProjectId, effectiveInspectorMenu, orbitalData, selectedEntityId]);

  useEffect(() => {
    if (!isFolderDraftOpen) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      folderDraftRowRef.current?.scrollIntoView({
        block: "nearest",
        behavior: "smooth"
      });
      folderDraftInputRef.current?.focus();
      folderDraftInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isFolderDraftOpen]);

  useEffect(() => {
    setProjectPositionDrafts((current) => {
      let changed = false;
      const next = { ...current };

      Object.entries(current).forEach(([projectId, draft]) => {
        const project = projects.find((entry) => entry.id === projectId);

        if (!project) {
          delete next[projectId];
          changed = true;
          return;
        }

        if (project.x === draft.x && project.y === draft.y) {
          delete next[projectId];
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [projects]);

  useEffect(() => {
    let frameId = 0;
    let timeoutId = 0;

    if (isOrbitAnimationSuspended) {
      return undefined;
    }

    const startedAt = performance.now() - timeRef.current;

    const tick = (now: number) => {
      setTimeMs(now - startedAt);
      timeoutId = window.setTimeout(() => {
        frameId = window.requestAnimationFrame(tick);
      }, orbitFrameInterval);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [isOrbitAnimationSuspended, orbitFrameInterval]);

  useEffect(
    () => () => {
      stopScenePositionAnimation();

      if (cameraAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(cameraAnimationFrameRef.current);
      }

      if (orbitInteractionTimeoutRef.current !== null) {
        window.clearTimeout(orbitInteractionTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!selectedEntityId || sceneLayout.entityMap.has(selectedEntityId)) {
      return;
    }

    setSelectedEntityId(null);
  }, [sceneLayout.entityMap, selectedEntityId]);

  useEffect(() => {
    setFolderDraftError(null);
  }, [selectedEntityId, inspectorMenu]);

  useEffect(() => {
    const availableColors = isVaultInspectorScope ? vaultColorCounts : colorCounts;

    setActiveColorFilters((current) =>
      current.filter((color) => availableColors.has(color))
    );
  }, [colorCounts, isVaultInspectorScope, vaultColorCounts]);

  useEffect(() => {
    const availableTags = isVaultInspectorScope ? vaultTagCounts : currentProjectTagCounts;

    setActiveTagFilters((current) =>
      current.filter((tagLookup) => availableTags.has(tagLookup))
    );
  }, [currentProjectTagCounts, isVaultInspectorScope, vaultTagCounts]);

  const stopCameraAnimation = () => {
    if (cameraAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(cameraAnimationFrameRef.current);
      cameraAnimationFrameRef.current = null;
    }
  };

  const animateCameraTo = (
    target: Partial<{ x: number; y: number; scale: number }>,
    duration = 620
  ) => {
    const from = cameraRef.current;
    const to = {
      x: target.x ?? from.x,
      y: target.y ?? from.y,
      scale: target.scale ?? from.scale
    };

    if (
      Math.abs(from.x - to.x) < 0.1 &&
      Math.abs(from.y - to.y) < 0.1 &&
      Math.abs(from.scale - to.scale) < 0.001
    ) {
      return;
    }

    stopCameraAnimation();

    if (prefersReducedMotion) {
      cameraRef.current = to;
      setCamera(to);
      return;
    }

    const startedAt = performance.now();
    const easeInOutCubic = (value: number) =>
      value < 0.5
        ? 4 * value * value * value
        : 1 - Math.pow(-2 * value + 2, 3) / 2;

    const step = (frameTime: number) => {
      const progress = clamp((frameTime - startedAt) / duration, 0, 1);
      const eased = easeInOutCubic(progress);
      const next = {
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased,
        scale: from.scale + (to.scale - from.scale) * eased
      };

      cameraRef.current = next;
      setCamera(next);

      if (progress < 1) {
        cameraAnimationFrameRef.current = window.requestAnimationFrame(step);
      } else {
        cameraRef.current = to;
        setCamera(to);
        cameraAnimationFrameRef.current = null;
      }
    };

    cameraAnimationFrameRef.current = window.requestAnimationFrame(step);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      markOrbitInteraction();

      if (event.key === " " && !isEditableTarget(event.target)) {
        event.preventDefault();
        setIsPaused((current) => !current);
        return;
      }

      if (
        event.key.toLowerCase() === "f" &&
        editorOpen &&
        editorMode === "canvas" &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        void toggleCanvasEditorFullscreen();
        return;
      }

      if (event.key === "Escape") {
        if (activeModal) {
          closeUtilityModal();
        } else if (editorOpen && editorMode === "canvas" && isCanvasEditorFullscreen) {
          void toggleCanvasEditorFullscreen();
        } else if (editorOpen) {
          onCloseEditor();
        } else if (selectedEntityId) {
          setSelectedEntityId(null);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    activeModal,
    editorMode,
    editorOpen,
    isCanvasEditorFullscreen,
    onClose,
    onCloseEditor,
    selectedEntityId
  ]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const handleFullscreenChange = () => {
      setIsCanvasEditorFullscreen(document.fullscreenElement === document.documentElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined" || editorOpen) {
      return;
    }

    if (document.fullscreenElement === document.documentElement) {
      void document.exitFullscreen();
    }

    setIsCanvasEditorFullscreen(false);
  }, [editorOpen]);

  const handleCenterSelection = () => {
    if (orbitalData.projects.length === 0) {
      return;
    }

    const center = orbitalData.projects.reduce(
      (result, project) => ({
        x: result.x + project.x,
        y: result.y + project.y
      }),
      { x: 0, y: 0 }
    );
    const divisor = orbitalData.projects.length;

    animateCameraTo({
      x: -(center.x / divisor),
      y: -(center.y / divisor)
    });
  };

  const handleResetCamera = () => {
    animateCameraTo({
      x: 0,
      y: 0,
      scale: 1
    });
  };

  const centerOnProject = (projectId: string, duration = 620) => {
    const project = orbitalData.projectById.get(projectId);

    if (!project) {
      return;
    }

    animateCameraTo({
      x: -project.x,
      y: -project.y
    }, duration);
  };

  useEffect(() => {
    if (!projectFocusRequest || !orbitalData.projectById.has(projectFocusRequest.projectId)) {
      return;
    }

    setSurfaceMode("map");
    setMobileSection("map");
    setSelectedEntityId(getProjectEntityId(projectFocusRequest.projectId));
    setActiveProjectId(null);
    setInspectorHierarchyScope("vault");
    setActiveFolderFilters([]);
    setActiveNoteFilters([]);
    setInspectorMenu("overview");
    centerOnProject(projectFocusRequest.projectId, 760);
  }, [orbitalData.projectById, projectFocusRequest?.projectId, projectFocusRequest?.requestId]);

  const getScenePointFromClient = (
    svg: SVGSVGElement,
    clientX: number,
    clientY: number
  ) => {
    const rect = svg.getBoundingClientRect();
    const width = rect.width || 1;
    const height = rect.height || 1;

    return {
      x: VIEWBOX.minX + ((clientX - rect.left) / width) * VIEWBOX.width,
      y: VIEWBOX.minY + ((clientY - rect.top) / height) * VIEWBOX.height
    };
  };

  const getSceneTouchPair = () => {
    const pointers = Array.from(sceneTouchPointersRef.current.values());

    if (pointers.length < 2) {
      return null;
    }

    const [first, second] = pointers;
    const distance = Math.hypot(
      second.clientX - first.clientX,
      second.clientY - first.clientY
    );

    return {
      first,
      second,
      distance,
      centerX: (first.clientX + second.clientX) / 2,
      centerY: (first.clientY + second.clientY) / 2
    };
  };

  const beginScenePinch = (svg: SVGSVGElement) => {
    const pair = getSceneTouchPair();

    if (!pair || pair.distance < 8) {
      return false;
    }

    const currentCamera = cameraRef.current;
    const center = getScenePointFromClient(svg, pair.centerX, pair.centerY);
    scenePinchRef.current = {
      startDistance: pair.distance,
      anchorWorldX: (center.x - currentCamera.x) / currentCamera.scale,
      anchorWorldY: (center.y - currentCamera.y) / currentCamera.scale,
      hasPinched: false
    };
    dragRef.current = null;
    suppressSceneBackgroundClickRef.current = true;
    closeSelectionHoverPreview();
    stopCameraAnimation();
    return true;
  };

  const updateScenePinch = (svg: SVGSVGElement) => {
    const pair = getSceneTouchPair();

    if (!pair) {
      scenePinchRef.current = null;
      return false;
    }

    if (!scenePinchRef.current && !beginScenePinch(svg)) {
      return false;
    }

    const pinch = scenePinchRef.current;

    if (!pinch || pinch.startDistance < 8) {
      return false;
    }

    const currentCamera = cameraRef.current;
    const nextScale = clamp(
      currentCamera.scale * (pair.distance / pinch.startDistance),
      CAMERA_MIN_SCALE,
      CAMERA_MAX_SCALE
    );
    const center = getScenePointFromClient(svg, pair.centerX, pair.centerY);
    const nextCamera = {
      x: center.x - pinch.anchorWorldX * nextScale,
      y: center.y - pinch.anchorWorldY * nextScale,
      scale: nextScale
    };

    pinch.startDistance = pair.distance;
    pinch.anchorWorldX = (center.x - nextCamera.x) / nextScale;
    pinch.anchorWorldY = (center.y - nextCamera.y) / nextScale;
    pinch.hasPinched = true;
    suppressSceneBackgroundClickRef.current = true;
    cameraRef.current = nextCamera;
    setCamera(nextCamera);
    return true;
  };

  useEffect(() => {
    const pendingCenterTarget = pendingInspectorCenterRef.current;

    if (!pendingCenterTarget) {
      return;
    }

    if (selectedEntityId !== pendingCenterTarget.entityId) {
      pendingInspectorCenterRef.current = null;
      return;
    }

    const sceneNode = scene.entityMap.get(pendingCenterTarget.entityId);

    if (sceneNode) {
      animateCameraTo(
        {
          x: -sceneNode.x,
          y: -sceneNode.y
        },
        560
      );
      pendingInspectorCenterRef.current = null;
      return;
    }

    if (
      pendingCenterTarget.projectId &&
      pendingCenterTarget.entityId === getProjectEntityId(pendingCenterTarget.projectId)
    ) {
      centerOnProject(pendingCenterTarget.projectId, 560);
      pendingInspectorCenterRef.current = null;
    }
  }, [scene.entityMap, selectedEntityId]);

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    markOrbitInteraction();
    const isNodeTarget = Boolean((event.target as HTMLElement).closest("[data-orbital-node='true']"));

    if (event.pointerType === "touch") {
      sceneTouchPointersRef.current.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY
      });

      if (sceneTouchPointersRef.current.size >= 2) {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        beginScenePinch(event.currentTarget);
        return;
      }

      if (isNodeTarget) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    if (isNodeTarget) {
      return;
    }

    stopCameraAnimation();
    closeSelectionHoverPreview();
    suppressSceneBackgroundClickRef.current = false;
    dragRef.current = {
      mode: "camera",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: camera.x,
      originY: camera.y,
      hasMoved: false
    };

    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    markOrbitInteraction();

    if (event.pointerType === "touch" && sceneTouchPointersRef.current.has(event.pointerId)) {
      sceneTouchPointersRef.current.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY
      });

      if (sceneTouchPointersRef.current.size >= 2) {
        event.preventDefault();
        updateScenePinch(event.currentTarget);
        return;
      }
    }

    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) {
      return;
    }

    if (dragRef.current.mode === "camera") {
      const deltaX = (event.clientX - dragRef.current.startX) / camera.scale;
      const deltaY = (event.clientY - dragRef.current.startY) / camera.scale;
      const pointerDistance = Math.hypot(
        event.clientX - dragRef.current.startX,
        event.clientY - dragRef.current.startY
      );

      if (!dragRef.current.hasMoved && pointerDistance >= PROJECT_DRAG_THRESHOLD_PX) {
        dragRef.current.hasMoved = true;
        suppressSceneBackgroundClickRef.current = true;
      }

      setCamera((current) => ({
        ...current,
        x: dragRef.current?.mode === "camera" ? dragRef.current.originX + deltaX : current.x,
        y: dragRef.current?.mode === "camera" ? dragRef.current.originY + deltaY : current.y
      }));
      return;
    }

    const projectDrag = dragRef.current;

    if (!projectDrag || projectDrag.mode !== "project") {
      return;
    }

    const deltaX = (event.clientX - projectDrag.startX) / camera.scale;
    const deltaY = (event.clientY - projectDrag.startY) / camera.scale;
    const pointerDistance = Math.hypot(event.clientX - projectDrag.startX, event.clientY - projectDrag.startY);

    if (!projectDrag.hasMoved && pointerDistance < PROJECT_DRAG_THRESHOLD_PX) {
      return;
    }

    projectDrag.hasMoved = true;

    setProjectPositionDrafts((current) => {
      const next = {
        ...current,
        [projectDrag.projectId]: {
          x: projectDrag.originProjectX + deltaX,
          y: projectDrag.originProjectY + deltaY
        }
      };
      projectPositionDraftsRef.current = next;
      return next;
    });
  };

  const releaseDrag = (pointerId: number) => {
    if (dragRef.current?.pointerId !== pointerId) {
      return;
    }

    if (dragRef.current.mode === "project") {
      if (!dragRef.current.hasMoved) {
        dragRef.current = null;
        return;
      }

      const projectId = dragRef.current.projectId;
      const draft = projectPositionDraftsRef.current[projectId];
      const persisted = orbitalData.projectById.get(projectId);
      const nextPosition = draft ?? (persisted ? { x: persisted.x, y: persisted.y } : null);

      if (nextPosition) {
        onUpdateProjectPosition(projectId, nextPosition.x, nextPosition.y);
      }
    }

    dragRef.current = null;
  };

  const handleScenePointerEnd = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType === "touch") {
      if (scenePinchRef.current?.hasPinched) {
        suppressSceneBackgroundClickRef.current = true;
      }

      sceneTouchPointersRef.current.delete(event.pointerId);

      if (sceneTouchPointersRef.current.size < 2) {
        scenePinchRef.current = null;
      }

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }

    releaseDrag(event.pointerId);
  };

  const handleSceneClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if ((event.target as HTMLElement).closest("[data-orbital-node='true']")) {
      return;
    }

    if (suppressSceneBackgroundClickRef.current) {
      suppressSceneBackgroundClickRef.current = false;
      return;
    }

    closeSelectionHoverPreview();
    setSelectedEntityId(null);
    setActiveFolderFilters([]);
    setActiveNoteFilters([]);

    if (effectiveInspectorMenu !== "overview") {
      if (isVaultInspectorScope) {
        setActiveProjectId(null);
        setInspectorHierarchyScope("vault");
      }

      return;
    }

    setActiveProjectId(null);
    setInspectorHierarchyScope("vault");
    openInspectorMenu("overview");
  };

  useEffect(() => {
    const sceneWrap = sceneWrapRef.current;

    if (!sceneWrap) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      markOrbitInteraction();

      if (
        hoverPreviewAnchorSource === "scene" &&
        hoveredSelectionNoteId &&
        noteHoverPreviewScrollRef.current
      ) {
        event.preventDefault();
        event.stopPropagation();
        noteHoverPreviewScrollRef.current.scrollTop += event.deltaY;
        return;
      }

      event.preventDefault();
      stopCameraAnimation();
      const multiplier = event.deltaY > 0 ? 0.92 : 1.08;

      setCamera((current) => ({
        ...current,
        scale: clamp(current.scale * multiplier, CAMERA_MIN_SCALE, CAMERA_MAX_SCALE)
      }));
    };

    sceneWrap.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      sceneWrap.removeEventListener("wheel", handleWheel);
    };
  }, [
    hoveredSelectionNoteId,
    hoverPreviewAnchorSource,
    markOrbitInteraction,
    stopCameraAnimation
  ]);

  const handleCreateFolder = async () => {
    const name = folderDraft.trim();

    if (!folderDraftProjectId) {
      return;
    }

    if (!name) {
      resetFolderDraft();
      return;
    }

    try {
      const createdFolder = await onCreateFolder(
        name,
        folderDraftParentId,
        folderDraftColor,
        folderDraftProjectId
      );
      resetFolderDraft();
      setFolderDraftError(null);
      setSelectedEntityId(`folder:${createdFolder.id}`);
      setActiveProjectId(createdFolder.projectId);
      setHierarchyFocusedEntityId(`folder:${createdFolder.id}`);
      setHierarchySelectionAnchorEntityId(`folder:${createdFolder.id}`);
    } catch (error) {
      if (error instanceof Error && error.message === "FOLDER_DEPTH_LIMIT") {
        setFolderDraftError(labels.maxDepthReached);
        return;
      }

      throw error;
    }
  };

  const handleCreateNote = async (folderId: string | null, projectId?: string) => {
    resetFolderDraft();
    const createdNote = await onCreateNote(folderId, projectId);
    setSelectedEntityId(`note:${createdNote.id}`);
    setActiveProjectId(createdNote.projectId);
    onOpenNote(createdNote.id);
  };

  const handleCreateCanvas = async (folderId: string | null, projectId?: string) => {
    resetFolderDraft();
    const createdCanvas = await onCreateCanvas(folderId, projectId);
    setSelectedEntityId(`note:${createdCanvas.id}`);
    setActiveProjectId(createdCanvas.projectId);
    onOpenNote(createdCanvas.id);
  };

  const handleCreateProject = async (name: string) => {
    const normalizedName = name.trim();

    if (!normalizedName) {
      return;
    }

    const position = findOpenProjectPosition(projectsWithDraftPositions);
    const project = await onCreateProject(position.x, position.y, normalizedName);
    setActiveProjectId(null);
    setSelectedEntityId(getProjectEntityId(project.id));
    setInspectorHierarchyScope("vault");
    setInspectorMenu("overview");
    animateCameraTo({
      x: -position.x,
      y: -position.y
    }, 760);
  };

  const toggleTagFilter = (tagLookup: string) => {
    setActiveTagFilters((current) =>
      current.includes(tagLookup)
        ? current.filter((lookup) => lookup !== tagLookup)
        : [...current, tagLookup]
    );
  };

  const toggleColorFilter = (color: string) => {
    setActiveColorFilters((current) =>
      current.includes(color) ? current.filter((value) => value !== color) : [...current, color]
    );
  };

  const toggleFolderFilter = (folderId: string) => {
    setActiveFolderFilters((current) =>
      current.includes(folderId) ? current.filter((id) => id !== folderId) : [...current, folderId]
    );
  };

  const toggleNoteFilter = (noteId: string) => {
    setActiveNoteFilters((current) =>
      current.includes(noteId) ? current.filter((id) => id !== noteId) : [...current, noteId]
    );
  };

  const toggleInspectorDocumentKind = (kind: InspectorDocumentKindFilter) => {
    setActiveInspectorDocumentKinds((current) => {
      if (current.length === 1 && current[0] === kind) {
        return [];
      }

      return [kind];
    });
  };

  const beginProjectRename = (project: Project) => {
    setEditingProjectId(project.id);
    setProjectNameDraft(project.name);
  };

  const beginVaultRename = () => {
    if (!activeLocalVaultItem) {
      return;
    }

    if (vaultRenameErrorTimeoutRef.current) {
      window.clearTimeout(vaultRenameErrorTimeoutRef.current);
      vaultRenameErrorTimeoutRef.current = null;
    }

    setVaultRenameError(null);
    setIsEditingVaultTitle(true);
    setVaultNameDraft(activeLocalVaultItem.name);
  };

  const cancelProjectRename = () => {
    setEditingProjectId(null);
    setProjectNameDraft("");
  };

  const cancelVaultRename = () => {
    setIsEditingVaultTitle(false);
    setVaultNameDraft("");
  };

  const showVaultRenameError = (message: string) => {
    if (vaultRenameErrorTimeoutRef.current) {
      window.clearTimeout(vaultRenameErrorTimeoutRef.current);
    }

    setVaultRenameError(message);
    vaultRenameErrorTimeoutRef.current = window.setTimeout(() => {
      setVaultRenameError(null);
      vaultRenameErrorTimeoutRef.current = null;
    }, 2600);
  };

  const submitProjectRename = async () => {
    if (!editingProjectId) {
      return;
    }

    const project = orbitalData.projectById.get(editingProjectId);

    if (!project) {
      cancelProjectRename();
      return;
    }

    const normalizedName = projectNameDraft.trim();

    if (normalizedName === project.name) {
      cancelProjectRename();
      return;
    }

    await onRenameProject(editingProjectId, normalizedName);
    cancelProjectRename();
  };

  const submitVaultRename = async () => {
    if (!activeLocalVaultItem || !onRenameLocalVault) {
      cancelVaultRename();
      return;
    }

    const normalizedName = vaultNameDraft.trim();

    if (!normalizedName) {
      cancelVaultRename();
      showVaultRenameError(t("settings.renameVaultNameRequired"));
      return;
    }

    if (normalizedName === activeLocalVaultItem.name) {
      cancelVaultRename();
      return;
    }

    await onRenameLocalVault(activeLocalVaultItem.id, normalizedName);
    cancelVaultRename();
  };

  const clearInspectorLongPress = () => {
    if (inspectorLongPressRef.current) {
      window.clearTimeout(inspectorLongPressRef.current.timeoutId);
      inspectorLongPressRef.current = null;
    }
  };

  const closeInspectorContextMenu = () => {
    setContextMenuState(null);
  };

  const consumeSuppressedInspectorClick = () => {
    if (!suppressInspectorClickRef.current) {
      return false;
    }

    suppressInspectorClickRef.current = false;
    return true;
  };

  const applySingleInspectorTargetSelection = (target: InspectorContextMenuTarget) => {
    if (target.kind === "core") {
      setActiveProjectId(target.project.id);
      setActiveFolderFilters([]);
      setActiveNoteFilters([]);
      setActiveAssetFilters([]);
      return;
    }

    if (target.kind === "folder") {
      setActiveFolderFilters([target.folder.id]);
      setActiveNoteFilters([]);
      setActiveAssetFilters([]);
      return;
    }

    setActiveNoteFilters([target.note.id]);
    setActiveFolderFilters([]);
    setActiveAssetFilters([]);
  };

  const openInspectorContextMenu = (
    target: InspectorContextMenuTarget,
    presentation: "popover" | "sheet",
    position?: { x: number; y: number } | null,
    options?: {
      selectTarget?: boolean;
    }
  ) => {
    clearInspectorLongPress();
    closeSelectionHoverPreview();

    const shouldPreserveMultiSelection =
      target.kind !== "core" &&
      isInspectorTargetInMultiSelection(target) &&
      (activeFolderFilterSet.size + activeNoteFilterSet.size) > 1;

    if (options?.selectTarget !== false && !shouldPreserveMultiSelection) {
      applySingleInspectorTargetSelection(target);
    }

    setContextMenuState({
      target,
      presentation,
      position
    });
  };

  const handleInspectorContextPointerDown = (
    target: InspectorContextMenuTarget,
    event: ReactPointerEvent<Element>
  ) => {
    if (event.pointerType !== "touch") {
      return;
    }

    clearInspectorLongPress();
    inspectorLongPressRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      timeoutId: window.setTimeout(() => {
        suppressInspectorClickRef.current = true;
        inspectorLongPressRef.current = null;
        openInspectorContextMenu(target, "sheet", null);
      }, INSPECTOR_LONG_PRESS_MS)
    };
  };

  const handleInspectorContextPointerMove = (event: ReactPointerEvent<Element>) => {
    const activeLongPress = inspectorLongPressRef.current;

    if (!activeLongPress || activeLongPress.pointerId !== event.pointerId) {
      return;
    }

    if (
      Math.abs(event.clientX - activeLongPress.startX) > INSPECTOR_LONG_PRESS_MOVE_TOLERANCE ||
      Math.abs(event.clientY - activeLongPress.startY) > INSPECTOR_LONG_PRESS_MOVE_TOLERANCE
    ) {
      clearInspectorLongPress();
    }
  };

  const handleInspectorContextPointerEnd = (pointerId: number) => {
    if (inspectorLongPressRef.current?.pointerId === pointerId) {
      clearInspectorLongPress();
    }
  };

  const beginInspectorRename = (target: InspectorContextMenuTarget) => {
    closeInspectorContextMenu();
    setInspectorRenameState({
      kind: target.kind,
      id:
        target.kind === "core"
          ? target.project.id
          : target.kind === "folder"
            ? target.folder.id
            : target.note.id
    });
    setInspectorRenameDraft(target.label);
  };

  const cancelInspectorRename = () => {
    setInspectorRenameState(null);
    setInspectorRenameDraft("");
  };

  const submitInspectorRename = async () => {
    if (!inspectorRenameState) {
      return;
    }

    const normalizedName = inspectorRenameDraft.trim();

    if (!normalizedName) {
      cancelInspectorRename();
      return;
    }

    if (inspectorRenameState.kind === "core") {
      const project = orbitalData.projectById.get(inspectorRenameState.id);

      if (!project || normalizedName === project.name.trim()) {
        cancelInspectorRename();
        return;
      }

      await onRenameProject(project.id, normalizedName);
      cancelInspectorRename();
      return;
    }

    if (inspectorRenameState.kind === "folder") {
      const folder = orbitalData.folderById.get(inspectorRenameState.id);

      if (!folder || normalizedName === folder.name) {
        cancelInspectorRename();
        return;
      }

      await onRenameFolder(folder.id, normalizedName);
      cancelInspectorRename();
      return;
    }

    const note = orbitalData.noteById.get(inspectorRenameState.id);

    if (!note || normalizedName === note.title.trim()) {
      cancelInspectorRename();
      return;
    }

    await onRenameNote(note.id, normalizedName);
    cancelInspectorRename();
  };

  const toggleInspectorFolderCollapse = (folderId: string) => {
    setCollapsedInspectorFolders((current) =>
      current.includes(folderId)
        ? current.filter((id) => id !== folderId)
        : [...current, folderId]
    );
  };

  const toggleInspectorProjectExpansion = (projectId: string) => {
    setExpandedInspectorProjects((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId]
    );
  };

  const selectInspectorEntity = (
    entityId: string,
    projectId: string | null,
    options?: { centerInScene?: boolean; preserveProjectContext?: boolean }
  ) => {
    setIsInspectorHierarchyAutoExpandSuppressed(false);

    if (options?.centerInScene) {
      pendingInspectorCenterRef.current = {
        entityId,
        projectId
      };
    } else if (pendingInspectorCenterRef.current?.entityId === entityId) {
      pendingInspectorCenterRef.current = null;
    }

    setSelectedEntityId(entityId);
    if (!options?.preserveProjectContext) {
      setActiveProjectId(projectId);
    }
    setActiveFolderFilters([]);
    setActiveNoteFilters([]);
    setActiveAssetFilters([]);
    closeSelectionHoverPreview();
  };

  const goToInspectorTargetLocation = (target: InspectorContextMenuTarget) => {
    if (target.kind === "core") {
      closeInspectorContextMenu();
      setActiveProjectId(target.project.id);
      setSelectedEntityId(getProjectEntityId(target.project.id));
      setInspectorHierarchyScope("project");
      setHierarchyFocusedEntityId(getProjectEntityId(target.project.id));
      setHierarchySelectionAnchorEntityId(getProjectEntityId(target.project.id));
      setActiveAssetFilters([]);
      openInspectorMenu("folders");
      return;
    }

    const entityId = getInspectorTargetEntityId(target);
    const projectId = target.kind === "folder" ? target.folder.projectId : target.note.projectId;

    closeInspectorContextMenu();
    setActiveProjectId(projectId);
    setSelectedEntityId(entityId);
    setInspectorHierarchyScope("project");
    setHierarchyFocusedEntityId(entityId);
    setHierarchySelectionAnchorEntityId(entityId);
    setActiveFolderFilters([]);
    setActiveNoteFilters([]);
    setActiveAssetFilters([]);
    openInspectorMenu("folders");
  };

  const handleInspectorHierarchySelection = (
    item: InspectorHierarchyItem,
    event: ReactMouseEvent<HTMLElement>
  ) => {
    setIsInspectorHierarchyAutoExpandSuppressed(false);
    const isAdditiveSelection =
      event.metaKey || event.ctrlKey || (isMobileSelectionMode && item.kind !== "core");
    const isRangeSelection = event.shiftKey;
    setHierarchyFocusedEntityId(item.entityId);

    if (isRangeSelection && item.kind !== "core") {
      const anchorEntityId =
        hierarchySelectionAnchorEntityId &&
        flattenedSelectableHierarchy.some((entry) => entry.entityId === hierarchySelectionAnchorEntityId)
          ? hierarchySelectionAnchorEntityId
          : flattenedSelectableHierarchy.find((entry) => entry.kind !== "core")?.entityId ?? item.entityId;
      const anchorIndex = flattenedSelectableHierarchy.findIndex(
        (entry) => entry.entityId === anchorEntityId
      );
      const currentIndex = flattenedSelectableHierarchy.findIndex(
        (entry) => entry.entityId === item.entityId
      );

      if (anchorIndex >= 0 && currentIndex >= 0) {
        const [from, to] =
          anchorIndex < currentIndex
            ? [anchorIndex, currentIndex]
            : [currentIndex, anchorIndex];
        const range = flattenedSelectableHierarchy.slice(from, to + 1);

        setActiveFolderFilters(
          range
            .filter((entry) => entry.kind === "folder")
            .map((entry) => entry.id)
        );
        setActiveNoteFilters(
          range
            .filter((entry) => entry.kind === "note" || entry.kind === "canvas")
            .map((entry) => entry.id)
        );
        setSelectedEntityId(item.entityId);
        setActiveProjectId(item.folder?.projectId ?? item.note?.projectId ?? currentProjectId);
        closeSelectionHoverPreview();
        return;
      }
    }

    if (item.kind === "core") {
      setHierarchySelectionAnchorEntityId(item.entityId);
      selectInspectorEntity(item.entityId, item.project?.id ?? currentProjectId ?? null, {
        centerInScene: true
      });
      return;
    }

    if (!isAdditiveSelection) {
      setHierarchySelectionAnchorEntityId(item.entityId);
      if (item.kind === "folder") {
        selectInspectorEntity(item.entityId, item.folder?.projectId ?? currentProjectId ?? null, {
          centerInScene: true
        });
      } else if (item.note) {
        selectInspectorEntity(item.entityId, item.note.projectId, {
          centerInScene: true
        });
      }
    }

    if (item.kind === "folder") {
      if (isAdditiveSelection) {
        setHierarchySelectionAnchorEntityId(item.entityId);
        toggleFolderFilter(item.id);
      }

      return;
    }

    if (isMobilePreviewMode && !isAndroidTouchLayout && item.note) {
      selectInspectorEntity(item.entityId, item.note.projectId, {
        centerInScene: true
      });
      onOpenNote(item.note.id);
      return;
    }

    if (isAdditiveSelection) {
      setHierarchySelectionAnchorEntityId(item.entityId);
      toggleNoteFilter(item.id);
    }
  };

  const switchInspectorHierarchyScope = (scope: InspectorHierarchyScope) => {
    setIsInspectorHierarchyAutoExpandSuppressed(false);
    setInspectorHierarchyScope(scope);

    if (scope === "project" && inspectorScopeProjectId) {
      if (currentProjectId !== inspectorScopeProjectId) {
        setActiveProjectId(inspectorScopeProjectId);
      }

      const selectedProjectId = getEntityProjectId(selectedEntityId, orbitalData);
      const fallbackEntityId = getProjectEntityId(inspectorScopeProjectId);

      if (!selectedProjectId || selectedProjectId !== inspectorScopeProjectId) {
        setSelectedEntityId(fallbackEntityId);
        setHierarchyFocusedEntityId(fallbackEntityId);
      }
    }
  };

  const openInspectorMenu = (menu: InspectorMenu) => {
    if (menu !== "folders") {
      resetFolderDraft();
    }

    setInspectorMenu(menu);
    setInspectorQuery("");
  };

  const openMobileSection = (section: OrbitalMobileSection) => {
    if (editorOpen) {
      onCloseEditor();
    }

    setMobileSection(section);
    setIsMobileMenuOpen(false);
    setIsMobileAccountOpen(false);
    closeUtilityModal();

    if (section === "vault") {
      setSurfaceMode("map");
      setInspectorHierarchyScope("vault");
      openInspectorMenu("folders");
      return;
    }

    if (section === "planner") {
      setSurfaceMode("planner");
      setIsMobileSelectionMode(false);
      setMobileMoveItems([]);
      setMobileMoveDestination(null);
      setMobileMoveConflictState(null);
      return;
    }

    if (section === "map") {
      setSurfaceMode("map");
      return;
    }

    if (section === "pinned") {
      setSurfaceMode("map");
      openInspectorMenu("pinned");
      return;
    }
  };

  const openMobileSettings = () => {
    if (editorOpen) {
      onCloseEditor();
    }

    setIsMobileMenuOpen(false);
    setIsMobileAccountOpen(false);
    setSettingsPanelOpenRequest(null);
    setActiveModal("settings");
  };

  const openMobileMore = () => {
    if (editorOpen) {
      onCloseEditor();
    }

    closeUtilityModal();
    setIsMobileAccountOpen(false);
    setIsMobileMenuOpen(true);
  };

  const openMobileAccount = () => {
    if (editorOpen) {
      onCloseEditor();
    }

    closeUtilityModal();
    setIsMobileMenuOpen(false);
    setIsMobileAccountOpen(true);
  };

  const mobileNavActiveSection: OrbitalMobileNavSection =
    isMobileMenuOpen || activeModal === "trash"
      ? "more"
      : activeModal === "settings"
        ? "settings"
        : isMobileAccountOpen
          ? "account"
          : mobileSection === "pinned"
            ? "vault"
            : mobileSection;
  const mobileNavActiveIndex =
    mobileNavActiveSection === "planner"
      ? 1
      : mobileNavActiveSection === "map"
        ? 2
        : mobileNavActiveSection === "more"
          ? 3
          : mobileNavActiveSection === "account"
            ? 4
            : mobileNavActiveSection === "settings"
              ? 5
              : 0;

  const handleInspectorNavigationScopeChange = (scope: "vault" | "project" | "documents") => {
    if (scope === "documents") {
      setMobileSection("vault");
      setSurfaceMode("map");
      openInspectorMenu("notes");
      return;
    }

    if (effectiveInspectorMenu === "notes") {
      openInspectorMenu("folders");
    }

    switchInspectorHierarchyScope(scope);
  };

  const openSelectedMobileEntry = () => {
    if (selectedNode?.note) {
      closeSelectionHoverPreview();
      onOpenNote(selectedNode.note.id);
    }
  };

  const handleInspectorBack = () => {
    if (inspectorHierarchyScope === "project" && currentProjectId) {
      setSelectedEntityId(getProjectEntityId(currentProjectId));
    } else if (shouldShowHierarchyInspector || selectedEntityId) {
      setSelectedEntityId(null);
    }

    openInspectorMenu("overview");
  };

  const clearFilters = () => {
    setFilterQuery("");
    setActiveColorFilters([]);
    setActiveTagFilters([]);
    setActiveFolderFilters([]);
    setActiveNoteFilters([]);
    setActiveAssetFilters([]);
  };

  const resetFolderDraft = () => {
    setFolderDraft("");
    setFolderDraftError(null);
    setFolderDraftColor(DEFAULT_FOLDER_COLOR);
    setIsFolderDraftOpen(false);
    setFolderDraftParentId(null);
    setFolderDraftProjectId(null);
  };

  const beginFolderDraft = (parentId: string | null, projectId?: string) => {
    if (parentId) {
      const parentMeta = orbitalData.folderMeta.get(parentId);

      if ((parentMeta?.depth ?? 0) >= 1) {
        setFolderDraftError(labels.maxDepthReached);
        setIsFolderDraftOpen(false);
        setFolderDraftParentId(null);
        setFolderDraftProjectId(null);
        return;
      }

      setCollapsedInspectorFolders((current) => current.filter((entry) => entry !== parentId));
    }

    setInspectorMenu("folders");
    setInspectorQuery("");
    setIsFolderDraftOpen(true);
    setFolderDraftParentId(parentId);
    setFolderDraftProjectId(
      parentId ? orbitalData.folderById.get(parentId)?.projectId ?? null : projectId ?? currentProjectId
    );
    setFolderDraft("");
    setFolderDraftColor(
      parentId ? orbitalData.folderById.get(parentId)?.color ?? DEFAULT_FOLDER_COLOR : DEFAULT_FOLDER_COLOR
    );
    setFolderDraftError(null);
    setHierarchyFocusedEntityId(
      parentId
        ? `folder:${parentId}`
        : projectId
          ? getProjectEntityId(projectId)
          : currentProjectEntityId
    );
  };

  const selectedFolderMeta =
    selectedNode?.folder ? orbitalData.folderMeta.get(selectedNode.folder.id) ?? null : null;
  const selectedNoteFolder =
    selectedNode?.kind === "note" && selectedNode.note?.folderId
      ? folderPathMap.get(selectedNode.note.folderId) ?? labels.uncategorized
      : labels.uncategorized;
  const selectedFolderLocation =
    selectedNode?.kind === "folder" && selectedNode.folder
      ? selectedNode.folder.parentId
        ? folderPathMap.get(selectedNode.folder.parentId) ?? focusSystemLabel
        : focusSystemLabel
      : focusSystemLabel;
  const selectedNoteTagNames =
    selectedNode?.kind === "note" && selectedNode.note
      ? selectedNode.note.tagIds
          .map((tagId) => tagMap.get(tagId)?.name ?? "")
          .filter((value) => value.length > 0)
      : [];
  const selectedEntryIsCanvas =
    selectedNode?.kind === "note" && selectedNode.note?.contentType === "canvas";
  const selectedCanvasMetrics =
    selectedNode?.kind === "note" && selectedNode.note?.contentType === "canvas"
      ? getCanvasMetrics(selectedNode.note.canvasContent, { includePlainText: false })
      : null;
  const selectedNoteVisibleTags = selectedNoteTagNames.slice(0, 3);
  const selectedNoteHiddenTagCount = Math.max(0, selectedNoteTagNames.length - selectedNoteVisibleTags.length);
  const selectedNoteAssetCount =
    selectedNode?.kind === "note" && selectedNode.note
      ? (assetNamesByNoteId.get(selectedNode.note.id) ?? []).length
      : 0;
  const selectedInspectorAccent =
    selectedNode?.kind === "core"
      ? selectedNode.project?.color ?? DEFAULT_INTERFACE_ACCENT
      : selectedNode?.kind === "folder"
        ? selectedNode.folder?.color ?? DEFAULT_FOLDER_COLOR
        : selectedNode?.note?.color ?? DEFAULT_NOTE_COLOR;
  const hoverPreviewAccent =
    hoverPreviewNote?.color ?? hoverPreviewAssetNote?.color ?? DEFAULT_NOTE_COLOR;
  const hoverPreviewFolder = hoverPreviewNote?.folderId
    ? folderPathMap.get(hoverPreviewNote.folderId) ?? labels.uncategorized
    : labels.uncategorized;
  const hoverPreviewAssetDisplayName = hoverPreviewAsset
    ? assetDisplayNamesById.get(hoverPreviewAsset.id) ?? getAssetDisplayName(hoverPreviewAsset)
    : "";
  const hoverPreviewAssetMeta = hoverPreviewAsset
    ? [hoverPreviewAsset.mimeType || null, formatAssetSize(hoverPreviewAsset.size) || null]
        .filter(Boolean)
        .join(" - ")
    : "";
  const liveHoverPreviewAnchorRect =
    hoverPreviewAnchorSource === "scene" && hoverPreviewSceneAnchorRef.current
      ? toHoverPreviewAnchorRect(hoverPreviewSceneAnchorRef.current.getBoundingClientRect())
      : hoverPreviewFallbackRect;
  const hoverPreviewPosition = useMemo(() => {
    if (!hoveredSelectionNoteId && !hoveredAssetId) {
      return null;
    }

    const viewportWidth = typeof window === "undefined" ? 1440 : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
    const cardWidth = Math.max(280, Math.min(400, viewportWidth - 32));
    const cardHeight = Math.max(240, Math.min(420, viewportHeight - 32));
    const viewportPadding = 16;
    const gap = hoverPreviewAnchorSource === "scene" ? 22 : 18;
    const anchor =
      liveHoverPreviewAnchorRect ?? {
        left: hoverPreviewCursor.x,
        top: hoverPreviewCursor.y,
        right: hoverPreviewCursor.x,
        bottom: hoverPreviewCursor.y,
        width: 0,
        height: 0,
        centerX: hoverPreviewCursor.x,
        centerY: hoverPreviewCursor.y
      };
    const inspectorRect =
      hoverPreviewAnchorSource === "inspector" && inspectorPanelRef.current
        ? toHoverPreviewAnchorRect(inspectorPanelRef.current.getBoundingClientRect())
        : null;

    if (hoverPreviewAnchorSource === "inspector" && inspectorRect) {
      const rightRoom = viewportWidth - viewportPadding - (inspectorRect.right + gap);
      const leftRoom = inspectorRect.left - viewportPadding - gap;
      const anchoredTop = clamp(
        anchor.centerY - cardHeight * 0.22,
        viewportPadding,
        viewportHeight - cardHeight - viewportPadding
      );

      if (rightRoom >= Math.min(cardWidth, 240) || rightRoom >= leftRoom) {
        const width = Math.min(cardWidth, Math.max(220, rightRoom));

        return {
          left: clamp(inspectorRect.right + gap, viewportPadding, viewportWidth - width - viewportPadding),
          top: anchoredTop,
          width,
          height: cardHeight,
          placement: "right" as const
        };
      }

      if (leftRoom >= Math.min(cardWidth, 220)) {
        return {
          left: clamp(
            inspectorRect.left - gap - cardWidth,
            viewportPadding,
            viewportWidth - cardWidth - viewportPadding
          ),
          top: anchoredTop,
          width: cardWidth,
          height: cardHeight,
          placement: "left" as const
        };
      }
    }

    const available = {
      right: viewportWidth - viewportPadding - (anchor.right + gap),
      left: anchor.left - viewportPadding - gap,
      bottom: viewportHeight - viewportPadding - (anchor.bottom + gap),
      top: anchor.top - viewportPadding - gap
    };

    const candidates = {
      right: {
        side: "right" as const,
        room: available.right,
        fits: available.right >= cardWidth,
        left: anchor.right + gap,
        top: clamp(
          hoverPreviewCursor.y - cardHeight * 0.22,
          viewportPadding,
          viewportHeight - cardHeight - viewportPadding
        )
      },
      left: {
        side: "left" as const,
        room: available.left,
        fits: available.left >= cardWidth,
        left: anchor.left - gap - cardWidth,
        top: clamp(
          hoverPreviewCursor.y - cardHeight * 0.22,
          viewportPadding,
          viewportHeight - cardHeight - viewportPadding
        )
      },
      bottom: {
        side: "bottom" as const,
        room: available.bottom,
        fits: available.bottom >= cardHeight,
        left: clamp(
          hoverPreviewCursor.x - cardWidth * 0.18,
          viewportPadding,
          viewportWidth - cardWidth - viewportPadding
        ),
        top: anchor.bottom + gap
      },
      top: {
        side: "top" as const,
        room: available.top,
        fits: available.top >= cardHeight,
        left: clamp(
          hoverPreviewCursor.x - cardWidth * 0.18,
          viewportPadding,
          viewportWidth - cardWidth - viewportPadding
        ),
        top: anchor.top - gap - cardHeight
      }
    };

    const horizontalChoices = [candidates.right, candidates.left].filter((candidate) => candidate.fits);
    const verticalChoices = [candidates.bottom, candidates.top].filter((candidate) => candidate.fits);
    const chosen =
      horizontalChoices.sort((left, right) => right.room - left.room)[0] ??
      verticalChoices.sort((left, right) => right.room - left.room)[0] ??
      [candidates.right, candidates.left, candidates.bottom, candidates.top].sort(
        (left, right) => right.room - left.room
      )[0];

    return {
      left: clamp(chosen.left, viewportPadding, viewportWidth - cardWidth - viewportPadding),
      top: clamp(chosen.top, viewportPadding, viewportHeight - cardHeight - viewportPadding),
      width: cardWidth,
      height: cardHeight,
      placement: chosen.side
    };
  }, [
    hoverPreviewAnchorSource,
    hoverPreviewCursor.x,
    hoverPreviewCursor.y,
    hoveredAssetId,
    hoveredSelectionNoteId,
    liveHoverPreviewAnchorRect,
    timeMs
  ]);
  const createHierarchyNoteItem = (note: Note): InspectorHierarchyItem => ({
    id: note.id,
    entityId: `note:${note.id}`,
    kind: note.contentType === "canvas" ? "canvas" : "note",
    label: getDisplayNoteTitle(note, language),
    color: note.color || DEFAULT_NOTE_COLOR,
    note,
    searchText: [
      note.title,
      note.excerpt,
      note.plainText,
      note.folderId ? folderPathMap.get(note.folderId) ?? "" : labels.uncategorized
    ]
      .join(" ")
      .toLowerCase(),
    children: []
  });

  function createHierarchyFolderItem(branch: FolderBranch): InspectorHierarchyItem {
    const folderPath = folderPathMap.get(branch.folder.id) ?? branch.folder.name;
    const children = [
      ...branch.children.map((childBranch) => createHierarchyFolderItem(childBranch)),
      ...branch.notes.map((note) => createHierarchyNoteItem(note))
    ].sort((left, right) => {
      const sortDelta = getHierarchyItemSortOrder(left) - getHierarchyItemSortOrder(right);

      if (sortDelta !== 0) {
        return sortDelta;
      }

      return left.id.localeCompare(right.id);
    });

    return {
      id: branch.folder.id,
      entityId: `folder:${branch.folder.id}`,
      kind: "folder",
      label: branch.folder.name,
      color: branch.folder.color || DEFAULT_FOLDER_COLOR,
      folder: branch.folder,
      searchText: `${branch.folder.name} ${folderPath}`.toLowerCase(),
      children
    };
  }

  const createHierarchyProjectItem = (project: Project): InspectorHierarchyItem => ({
    id: project.id,
    entityId: getProjectEntityId(project.id),
    kind: "core",
    label: getDisplayProjectName(
      project,
      language,
      orbitalData.projects.findIndex((entry) => entry.id === project.id)
    ),
    color: project.color || DEFAULT_PROJECT_COLOR,
    project,
    searchText: `${getDisplayProjectName(
      project,
      language,
      orbitalData.projects.findIndex((entry) => entry.id === project.id)
    )} ${labels.system} ${labels.core}`.toLowerCase(),
    children: [
      ...(orbitalData.rootFoldersByProject.get(project.id) ?? []).map((branch) =>
        createHierarchyFolderItem(branch)
      ),
      ...(orbitalData.looseNotesByProject.get(project.id) ?? []).map((note) =>
        createHierarchyNoteItem(note)
      )
    ].sort((left, right) => {
      const sortDelta = getHierarchyItemSortOrder(left) - getHierarchyItemSortOrder(right);

      if (sortDelta !== 0) {
        return sortDelta;
      }

      return left.id.localeCompare(right.id);
    })
  });

  const currentProjectHierarchyTree = useMemo(() => {
    if (!currentProjectId) {
      return [];
    }

    const project = orbitalData.projectById.get(currentProjectId);
    return project ? [createHierarchyProjectItem(project)] : [];
  }, [currentProjectId, orbitalData.projectById, createHierarchyProjectItem]);

  const vaultHierarchyTree = useMemo(
    () => orbitalData.projects.map((project) => createHierarchyProjectItem(project)),
    [createHierarchyProjectItem, orbitalData.projects]
  );

  const inspectorHierarchyTree = isVaultInspectorScope
    ? vaultHierarchyTree
    : currentProjectHierarchyTree;
  const inspectorNotesMenu = isVaultInspectorScope ? visibleNotes : currentProjectNotes;
  const inspectorAssetsMenu = isVaultInspectorScope ? vaultVisibleAssets : currentProjectAssets;
  const inspectorTagCounts = isVaultInspectorScope ? vaultTagCounts : currentProjectTagCounts;
  const inspectorColorCounts = isVaultInspectorScope ? vaultColorCounts : colorCounts;
  const inspectorScopedTags = useMemo(
    () =>
      uniqueTagsByName(sortTagsByName(tags, language)).filter((tag) =>
        inspectorTagCounts.has(normalizeTagLookup(tag.name))
      ),
    [inspectorTagCounts, language, tags]
  );
  const inspectorDocumentTypeCounts = useMemo(
    () =>
      inspectorNotesMenu.reduce(
        (counts, note) => {
          if (note.contentType === "canvas") {
            counts.canvas += 1;
          } else {
            counts.note += 1;
          }

          return counts;
        },
        { note: 0, canvas: 0 }
      ),
    [inspectorNotesMenu]
  );
  const filteredNotesMenu = useMemo(
    () =>
      inspectorNotesMenu.filter((note) => {
        const noteKind = note.contentType === "canvas" ? "canvas" : "note";

        if (
          activeInspectorDocumentKindSet.size > 0 &&
          !activeInspectorDocumentKindSet.has(noteKind)
        ) {
          return false;
        }

        return [note.title, note.excerpt, note.plainText]
          .join(" ")
          .toLowerCase()
          .includes(normalizedInspectorQuery);
      }),
    [activeInspectorDocumentKindSet, inspectorNotesMenu, normalizedInspectorQuery]
  );
  const filteredPinnedMenu = useMemo(
    () => filteredNotesMenu.filter((note) => isEntryFavorite(note)),
    [filteredNotesMenu]
  );
  const filteredTagsMenu = useMemo(
    () =>
      inspectorScopedTags.filter((tag) =>
        tag.name.toLowerCase().includes(normalizedInspectorQuery)
      ),
    [inspectorScopedTags, normalizedInspectorQuery]
  );
  const filteredFoldersMenu = useMemo(
    () => filterInspectorHierarchy(inspectorHierarchyTree, normalizedInspectorQuery),
    [inspectorHierarchyTree, normalizedInspectorQuery]
  );
  const inspectorHierarchyExpandableIds = useMemo(
    () => collectInspectorHierarchyExpandableIds(inspectorHierarchyTree),
    [inspectorHierarchyTree]
  );
  const activeExpandableProjectIds = isVaultInspectorScope
    ? inspectorHierarchyExpandableIds.projectIds
    : [];
  const activeExpandableFolderIds = inspectorHierarchyExpandableIds.folderIds;
  const hasExpandableInspectorHierarchyItems =
    activeExpandableProjectIds.length > 0 || activeExpandableFolderIds.length > 0;
  const isInspectorHierarchyFullyExpanded = useMemo(() => {
    if (!hasExpandableInspectorHierarchyItems) {
      return false;
    }

    if (normalizedInspectorQuery.length > 0) {
      return true;
    }

    const areProjectsExpanded = activeExpandableProjectIds.every(
      (projectId) =>
        expandedInspectorProjectSet.has(projectId) ||
        (!isInspectorHierarchyAutoExpandSuppressed &&
          selectedHierarchyExpandedProjectSet.has(projectId))
    );
    const areFoldersExpanded = activeExpandableFolderIds.every(
      (folderId) =>
        !collapsedInspectorFolderSet.has(folderId) ||
        (!isInspectorHierarchyAutoExpandSuppressed &&
          selectedHierarchyExpandedFolderSet.has(folderId))
    );

    return areProjectsExpanded && areFoldersExpanded;
  }, [
    activeExpandableFolderIds,
    activeExpandableProjectIds,
    collapsedInspectorFolderSet,
    expandedInspectorProjectSet,
    hasExpandableInspectorHierarchyItems,
    isInspectorHierarchyAutoExpandSuppressed,
    normalizedInspectorQuery.length,
    selectedHierarchyExpandedFolderSet,
    selectedHierarchyExpandedProjectSet
  ]);
  const flattenedInspectorHierarchy = useMemo(() => {
    const items: InspectorHierarchyItem[] = [];
    const visit = (item: InspectorHierarchyItem) => {
      items.push(item);
      item.children.forEach(visit);
    };

    filteredFoldersMenu.forEach(visit);
    return items;
  }, [filteredFoldersMenu]);
  const flattenedSelectableHierarchy = useMemo(
    () => flattenedInspectorHierarchy.filter((item) => item.kind !== "core"),
    [flattenedInspectorHierarchy]
  );
  const filteredFilesMenu = useMemo(
    () =>
      inspectorAssetsMenu.filter((asset) => {
        const note = orbitalData.noteById.get(asset.noteId);
        const assetName = assetDisplayNamesById.get(asset.id) ?? getAssetDisplayName(asset);
        const haystack = `${assetName} ${note?.title ?? ""}`.toLowerCase();
        return haystack.includes(normalizedInspectorQuery);
      }),
    [assetDisplayNamesById, inspectorAssetsMenu, normalizedInspectorQuery, orbitalData.noteById]
  );
  const colorMenuEntries = useMemo(
    () => {
      const paletteEntriesByHex = new Map<
        string,
        {
          id: string;
          hex: string;
          label: string;
          count: number;
          order: number;
        }
      >(
        COLOR_PALETTE.map((entry, index) => [
          entry.hex,
          {
            id: entry.id,
            hex: entry.hex,
            label: t(entry.labelKey),
            count: inspectorColorCounts.get(entry.hex) ?? 0,
            order: index
          }
        ])
      );

      return [...inspectorColorCounts.entries()]
        .map(([hex, count], index) => {
          const paletteEntry = paletteEntriesByHex.get(hex);

          if (paletteEntry) {
            return paletteEntry;
          }

          return {
            id: `custom-${hex.toLowerCase()}`,
            hex,
            label: hex.toUpperCase(),
            count,
            order: COLOR_PALETTE.length + index
          };
        })
        .sort((left, right) => left.order - right.order);
    },
    [inspectorColorCounts, t]
  );
  const filteredColorsMenu = useMemo(
    () =>
      colorMenuEntries.filter((entry) =>
        `${entry.label} ${entry.hex}`.toLowerCase().includes(normalizedInspectorQuery)
      ),
    [colorMenuEntries, normalizedInspectorQuery]
  );
  const inspectorMenuTitle =
    effectiveInspectorMenu === "notes"
      ? labels.documentsMenu
      : effectiveInspectorMenu === "folders"
        ? labels.foldersMenu
        : effectiveInspectorMenu === "tags"
          ? labels.tagsMenu
          : effectiveInspectorMenu === "files"
            ? labels.filesMenu
            : effectiveInspectorMenu === "colors"
              ? labels.colorsMenu
              : labels.pinnedMenu;
  const inspectorMenuCount =
    effectiveInspectorMenu === "notes"
      ? filteredNotesMenu.length
      : effectiveInspectorMenu === "folders"
        ? countInspectorHierarchyItems(filteredFoldersMenu)
        : effectiveInspectorMenu === "tags"
          ? filteredTagsMenu.length
          : effectiveInspectorMenu === "files"
            ? filteredFilesMenu.length
            : effectiveInspectorMenu === "colors"
              ? filteredColorsMenu.length
              : filteredPinnedMenu.length;
  const showInspectorHierarchyQuickActions =
    effectiveInspectorMenu === "folders" && Boolean(currentProjectId);
  const showInspectorScopeSwitch =
    effectiveInspectorMenu === "notes" ||
    effectiveInspectorMenu === "folders" ||
    effectiveInspectorMenu === "tags" ||
    effectiveInspectorMenu === "files" ||
    effectiveInspectorMenu === "colors" ||
    effectiveInspectorMenu === "pinned";
  const activeProjectIndex = currentProjectId
    ? orbitalData.projects.findIndex((project) => project.id === currentProjectId)
    : -1;
  const canNavigateProjects = orbitalData.projects.length > 1;
  const isSystemOverview = effectiveInspectorMenu === "overview" && Boolean(currentProjectId);
  const isVaultOverview = effectiveInspectorMenu === "overview" && !currentProjectId;
  const overviewProjectItems = useMemo<OrbitalOverviewProjectItem[]>(() => {
    const folderCounts = new Map<string, number>();
    const documentCounts = new Map<string, number>();
    const updatedAtByProject = new Map<string, number>();

    orbitalData.projects.forEach((project) => {
      folderCounts.set(project.id, 0);
      documentCounts.set(project.id, 0);
      updatedAtByProject.set(project.id, project.updatedAt);
    });

    folders.forEach((folder) => {
      folderCounts.set(folder.projectId, (folderCounts.get(folder.projectId) ?? 0) + 1);
      updatedAtByProject.set(
        folder.projectId,
        Math.max(updatedAtByProject.get(folder.projectId) ?? 0, folder.updatedAt)
      );
    });

    visibleNotes.forEach((note) => {
      documentCounts.set(note.projectId, (documentCounts.get(note.projectId) ?? 0) + 1);
      updatedAtByProject.set(
        note.projectId,
        Math.max(updatedAtByProject.get(note.projectId) ?? 0, note.updatedAt)
      );
    });

    return orbitalData.projects.map((project, index) => ({
      id: project.id,
      name: getDisplayProjectName(project, language, index),
      color: project.color || DEFAULT_PROJECT_COLOR,
      documentCount: documentCounts.get(project.id) ?? 0,
      folderCount: folderCounts.get(project.id) ?? 0,
      updatedAt: updatedAtByProject.get(project.id) ?? project.updatedAt,
      isActive: project.id === currentProjectId || selectedEntityId === getProjectEntityId(project.id)
    }));
  }, [currentProjectId, folders, language, orbitalData.projects, selectedEntityId, visibleNotes]);
  const vaultOverviewRecentItems = useMemo<OrbitalOverviewRecentItem[]>(() => {
    const folderItems = folders.map((folder) => ({
      id: folder.id,
      entityId: `folder:${folder.id}`,
      kind: "folder" as const,
      title: folder.name || labels.folder,
      color: folder.color || DEFAULT_FOLDER_COLOR,
      meta: formatTimestamp(folder.updatedAt),
      updatedAt: folder.updatedAt
    }));
    const noteItems = visibleNotes.map((note) => ({
      id: note.id,
      entityId: `note:${note.id}`,
      kind: note.contentType,
      title: getDisplayNoteTitle(note, language),
      color: note.color || DEFAULT_NOTE_COLOR,
      meta: formatTimestamp(note.updatedAt),
      updatedAt: note.updatedAt
    }));

    return [...folderItems, ...noteItems].sort((left, right) => right.updatedAt - left.updatedAt);
  }, [folders, labels.folder, language, visibleNotes]);
  const projectOverviewRecentItems = useMemo<OrbitalOverviewRecentItem[]>(() => {
    const folderItems = currentProjectFolders.map((folder) => ({
      id: folder.id,
      entityId: `folder:${folder.id}`,
      kind: "folder" as const,
      title: folder.name || labels.folder,
      color: folder.color || DEFAULT_FOLDER_COLOR,
      meta: formatTimestamp(folder.updatedAt),
      updatedAt: folder.updatedAt
    }));
    const noteItems = currentProjectNotes.map((note) => ({
      id: note.id,
      entityId: `note:${note.id}`,
      kind: note.contentType,
      title: getDisplayNoteTitle(note, language),
      color: note.color || DEFAULT_NOTE_COLOR,
      meta: formatTimestamp(note.updatedAt),
      updatedAt: note.updatedAt
    }));

    return [...folderItems, ...noteItems].sort((left, right) => right.updatedAt - left.updatedAt);
  }, [currentProjectFolders, currentProjectNotes, labels.folder, language]);
  const overviewRecentItems = isVaultOverview ? vaultOverviewRecentItems : projectOverviewRecentItems;
  const overviewUpdatedLabel = overviewRecentItems[0]
    ? formatTimestamp(overviewRecentItems[0].updatedAt)
    : labels.empty;
  const currentSystemOverviewLinks: OrbitalOverviewLinkItem[] = [
    {
      id: "folders",
      label: labels.foldersStat,
      count: currentProjectFolders.length,
      icon: "folder",
      color: DEFAULT_FOLDER_COLOR
    },
    {
      id: "notes",
      label: labels.documentsMenu,
      count: currentProjectNotes.length,
      icon: "note",
      color: DEFAULT_NOTE_COLOR
    },
    {
      id: "tags",
      label: labels.tagsStat,
      count: currentProjectTagCounts.size,
      icon: "tag",
      color: "#73f7ff"
    },
    {
      id: "files",
      label: labels.assetsStat,
      count: currentProjectAssets.length,
      icon: "file",
      color: "#74f1b6"
    },
    {
      id: "colors",
      label: labels.colorsStat,
      count: colorCounts.size,
      icon: "color",
      color: "#ffd57e"
    },
    {
      id: "pinned",
      label: labels.pinnedStat,
      count: pinnedCount,
      icon: "note",
      color: "#ffd57e"
    }
  ];
  const vaultOverviewLinks: OrbitalOverviewLinkItem[] = [
    {
      id: "folders",
      label: labels.foldersStat,
      count: folders.length,
      icon: "folder",
      color: DEFAULT_FOLDER_COLOR
    },
    {
      id: "notes",
      label: labels.documentsMenu,
      count: visibleNotes.length,
      icon: "note",
      color: DEFAULT_NOTE_COLOR
    },
    {
      id: "tags",
      label: labels.tagsStat,
      count: vaultTagCounts.size,
      icon: "tag",
      color: "#73f7ff"
    },
    {
      id: "files",
      label: labels.assetsStat,
      count: vaultVisibleAssets.length,
      icon: "file",
      color: "#74f1b6"
    },
    {
      id: "colors",
      label: labels.colorsStat,
      count: vaultColorCounts.size,
      icon: "color",
      color: "#ffd57e"
    },
    {
      id: "pinned",
      label: labels.pinnedStat,
      count: vaultPinnedCount,
      icon: "note",
      color: "#ffd57e"
    }
  ];
  const preferredHierarchyContextEntityId = useMemo(() => {
    if (
      hierarchyFocusedEntityId &&
      getEntityProjectId(hierarchyFocusedEntityId, orbitalData) === currentProjectId
    ) {
      return hierarchyFocusedEntityId;
    }

    if (selectedEntityId && getEntityProjectId(selectedEntityId, orbitalData) === currentProjectId) {
      return selectedEntityId;
    }

    if (activeFolderFilters.length === 1) {
      return `folder:${activeFolderFilters[0]}`;
    }

    if (activeNoteFilters.length === 1) {
      return `note:${activeNoteFilters[0]}`;
    }

    return currentProjectEntityId;
  }, [
    activeFolderFilters,
    activeNoteFilters,
    currentProjectEntityId,
    currentProjectId,
    hierarchyFocusedEntityId,
    orbitalData,
    selectedEntityId
  ]);
  const inspectorCreateContext = useMemo(() => {
    if (!currentProjectId || !preferredHierarchyContextEntityId) {
      return null;
    }

    if (preferredHierarchyContextEntityId.startsWith("project:")) {
      const project = orbitalData.projectById.get(
        preferredHierarchyContextEntityId.slice("project:".length)
      );

      if (!project) {
        return null;
      }

      return {
        kind: "core" as const,
        entityId: preferredHierarchyContextEntityId,
        project
      };
    }

    if (preferredHierarchyContextEntityId.startsWith("folder:")) {
      const folder = orbitalData.folderById.get(
        preferredHierarchyContextEntityId.slice("folder:".length)
      );

      if (!folder) {
        return null;
      }

      return {
        kind: "folder" as const,
        entityId: preferredHierarchyContextEntityId,
        folder,
        depth: orbitalData.folderMeta.get(folder.id)?.depth ?? 0
      };
    }

    if (preferredHierarchyContextEntityId.startsWith("note:")) {
      const note = orbitalData.noteById.get(
        preferredHierarchyContextEntityId.slice("note:".length)
      );

      if (!note) {
        return null;
      }

      return {
        kind: "note" as const,
        entityId: preferredHierarchyContextEntityId,
        note,
        folderDepth: note.folderId
          ? orbitalData.folderMeta.get(note.folderId)?.depth ?? null
          : null
      };
    }

    return null;
  }, [
    currentProjectId,
    orbitalData.folderById,
    orbitalData.folderMeta,
    orbitalData.noteById,
    orbitalData.projectById,
    preferredHierarchyContextEntityId
  ]);
  const inspectorQuickCreateTargets = useMemo(() => {
    if (!inspectorCreateContext) {
      return {
        folder: null,
        note: null,
        canvas: null
      };
    }

    if (inspectorCreateContext.kind === "core") {
      return {
        folder: {
          parentId: null,
          projectId: inspectorCreateContext.project.id,
          mode: "root" as const
        },
        note: {
          folderId: null,
          projectId: inspectorCreateContext.project.id
        },
        canvas: {
          folderId: null,
          projectId: inspectorCreateContext.project.id
        }
      };
    }

    if (inspectorCreateContext.kind === "folder") {
      return {
        folder:
          inspectorCreateContext.depth < 1
            ? {
                parentId: inspectorCreateContext.folder.id,
                projectId: inspectorCreateContext.folder.projectId,
                mode: "child" as const
              }
            : null,
        note: {
          folderId: inspectorCreateContext.folder.id,
          projectId: inspectorCreateContext.folder.projectId
        },
        canvas: {
          folderId: inspectorCreateContext.folder.id,
          projectId: inspectorCreateContext.folder.projectId
        }
      };
    }

    return {
      folder:
        inspectorCreateContext.note.folderId === null
          ? {
              parentId: null,
              projectId: inspectorCreateContext.note.projectId,
              mode: "root" as const
            }
          : (inspectorCreateContext.folderDepth ?? 99) < 1
            ? {
                parentId: inspectorCreateContext.note.folderId,
                projectId: inspectorCreateContext.note.projectId,
                mode: "child" as const
              }
            : null,
      note: {
        folderId: inspectorCreateContext.note.folderId,
        projectId: inspectorCreateContext.note.projectId
      },
      canvas: {
        folderId: inspectorCreateContext.note.folderId,
        projectId: inspectorCreateContext.note.projectId
      }
    };
  }, [inspectorCreateContext]);
  const inspectorFolderActionTitle =
    inspectorQuickCreateTargets.folder?.mode === "child"
      ? labels.addChildFolder
      : inspectorQuickCreateTargets.folder
        ? labels.addRootFolder
        : inspectorCreateContext?.kind === "folder" && inspectorCreateContext.depth >= 1
          ? labels.maxDepthReached
          : inspectorCreateContext?.kind === "note" && inspectorCreateContext.note.folderId !== null
            ? labels.maxDepthReached
            : labels.addRootFolder;

  const contextMenuColorOptions = useMemo(
    () =>
      COLOR_PALETTE.map((entry) => ({
        id: entry.id,
        hex: entry.hex,
        label: t(entry.labelKey)
      })),
    [t]
  );

  const buildInspectorNoteContextTarget = (note: Note): InspectorContextMenuTarget => ({
    kind: note.contentType === "canvas" ? "canvas" : "note",
    note,
    label: getNoteInspectorTitle(note),
    color: note.color || DEFAULT_NOTE_COLOR,
    pinned: isEntryFavorite(note)
  });

  const buildInspectorHierarchyContextTarget = (
    item: InspectorHierarchyItem
  ): InspectorContextMenuTarget => {
    if (item.kind === "core") {
      return {
        kind: "core",
        project: item.project!,
        label: item.label,
        color: item.color
      };
    }

    if (item.kind === "folder") {
      return {
        kind: "folder",
        folder: item.folder!,
        label: item.label,
        color: item.color,
        canCreateFolder: (orbitalData.folderMeta.get(item.id)?.depth ?? 0) < 1
      };
    }

    return {
      kind: item.kind,
      note: item.note!,
      label: item.label,
      color: item.color,
      pinned: item.note ? isEntryFavorite(item.note) : false
    };
  };

  const buildSceneNodeContextTarget = (
    node: OrbitalSceneNode | null | undefined
  ): InspectorContextMenuTarget | null => {
    if (!node) {
      return null;
    }

    if (node.kind === "core" && node.project) {
      return {
        kind: "core",
        project: node.project,
        label: node.label,
        color: node.color
      };
    }

    if (node.kind === "folder" && node.folder) {
      return {
        kind: "folder",
        folder: node.folder,
        label: node.label,
        color: node.color,
        canCreateFolder: (orbitalData.folderMeta.get(node.folder.id)?.depth ?? 0) < 1
      };
    }

    if (node.kind === "note" && node.note) {
      return buildInspectorNoteContextTarget(node.note);
    }

    return null;
  };

  const isEditingInspectorTarget = (target: InspectorContextMenuTarget) =>
    Boolean(
      inspectorRenameState &&
        inspectorRenameState.kind === target.kind &&
        inspectorRenameState.id ===
          (target.kind === "core"
            ? target.project.id
            : target.kind === "folder"
              ? target.folder.id
              : target.note.id)
    );

  const getInspectorTargetEntityId = (target: InspectorContextMenuTarget) =>
    target.kind === "core"
      ? getProjectEntityId(target.project.id)
      : target.kind === "folder"
        ? `folder:${target.folder.id}`
        : `note:${target.note.id}`;

  const getSelectableTargetEntityId = (target: InspectorSelectableTarget) =>
    target.kind === "folder" ? `folder:${target.folder.id}` : `note:${target.note.id}`;

  const isInspectorTargetInMultiSelection = (target: InspectorContextMenuTarget) => {
    if (target.kind === "core") {
      return false;
    }

    if (target.kind === "folder") {
      return activeFolderFilterSet.has(target.folder.id);
    }

    return activeNoteFilterSet.has(target.note.id);
  };

  const getCurrentInspectorSelectionTargets = (): InspectorSelectableTarget[] => {
    const targets: InspectorSelectableTarget[] = [];

    activeFolderFilters.forEach((folderId) => {
      const folder = orbitalData.folderById.get(folderId);

      if (!folder) {
        return;
      }

      targets.push({
        kind: "folder",
        folder,
        label: folder.name,
        color: folder.color || DEFAULT_FOLDER_COLOR,
        canCreateFolder: (orbitalData.folderMeta.get(folder.id)?.depth ?? 0) < 1
      });
    });

    activeNoteFilters.forEach((noteId) => {
      const note = orbitalData.noteById.get(noteId);

      if (!note) {
        return;
      }

      targets.push(buildInspectorNoteContextTarget(note) as InspectorSelectableTarget);
    });

    if (targets.length > 0) {
      return targets;
    }

    if (selectedNode?.kind === "folder" && selectedNode.folder) {
      return [
        {
          kind: "folder",
          folder: selectedNode.folder,
          label: selectedNode.label,
          color: selectedNode.folder.color || DEFAULT_FOLDER_COLOR,
          canCreateFolder: (orbitalData.folderMeta.get(selectedNode.folder.id)?.depth ?? 0) < 1
        }
      ];
    }

    if (selectedNode?.kind === "note" && selectedNode.note) {
      return [buildInspectorNoteContextTarget(selectedNode.note) as InspectorSelectableTarget];
    }

    return [];
  };

  const getContextOperationTargets = (
    target: InspectorContextMenuTarget | null
  ): InspectorSelectableTarget[] => {
    if (target && target.kind !== "core" && isInspectorTargetInMultiSelection(target)) {
      return getCurrentInspectorSelectionTargets();
    }

    if (target && target.kind !== "core") {
      return [target];
    }

    return getCurrentInspectorSelectionTargets();
  };

  const showInspectorToast = (message: string) => {
    if (inspectorToastTimeoutRef.current) {
      window.clearTimeout(inspectorToastTimeoutRef.current);
    }

    setInspectorToast(message);
    inspectorToastTimeoutRef.current = window.setTimeout(() => {
      setInspectorToast(null);
      inspectorToastTimeoutRef.current = null;
    }, 2600);
  };

  const getMoveErrorMessage = (error: unknown) => {
    if (!(error instanceof Error)) {
      return labels.moveBlockedInvalid;
    }

    if (error.message === "FOLDER_DEPTH_LIMIT") {
      return labels.moveBlockedDepth;
    }

    if (error.message === "TARGET_FOLDER_NOT_FOUND") {
      return labels.moveBlockedMissingTarget;
    }

    return labels.moveBlockedInvalid;
  };

  const getClipboardItemsFromTargets = (targets: InspectorSelectableTarget[]) => {
    const selectedFolderIds = new Set(
      targets
        .filter((target) => target.kind === "folder")
        .map((target) => target.folder.id)
    );

    const orderByEntityId = new Map(
      flattenedSelectableHierarchy.map((item, index) => [item.entityId, index])
    );

    return targets
      .filter((target) => {
        if (target.kind === "folder") {
          let parentId = target.folder.parentId;

          while (parentId) {
            if (selectedFolderIds.has(parentId)) {
              return false;
            }

            parentId = orbitalData.folderById.get(parentId)?.parentId ?? null;
          }

          return true;
        }

        let parentId = target.note.folderId;

        while (parentId) {
          if (selectedFolderIds.has(parentId)) {
            return false;
          }

          parentId = orbitalData.folderById.get(parentId)?.parentId ?? null;
        }

        return true;
      })
      .sort((left, right) => {
        const leftEntityId = getSelectableTargetEntityId(left);
        const rightEntityId = getSelectableTargetEntityId(right);
        return (
          (orderByEntityId.get(leftEntityId) ?? Number.MAX_SAFE_INTEGER) -
          (orderByEntityId.get(rightEntityId) ?? Number.MAX_SAFE_INTEGER)
        );
      })
      .map<InspectorClipboardItem>((target) =>
        target.kind === "folder"
          ? { kind: "folder", id: target.folder.id }
          : { kind: target.kind, id: target.note.id }
      );
  };

  const copyInspectorSelection = (target: InspectorContextMenuTarget | null = contextMenuTarget) => {
    const targets = getContextOperationTargets(target);
    const items = getClipboardItemsFromTargets(targets);

    if (items.length === 0) {
      return;
    }

    setInspectorClipboard(items);
  };

  const getPasteDestination = (target: InspectorContextMenuTarget | null) => {
    if (target?.kind === "core") {
      return {
        parentId: null,
        projectId: target.project.id
      };
    }

    if (target?.kind === "folder") {
      return {
        parentId: target.folder.id,
        projectId: target.folder.projectId
      };
    }

    if (target) {
      return {
        parentId: target.note.folderId,
        projectId: target.note.projectId
      };
    }

    const targets = getCurrentInspectorSelectionTargets();
    const onlyTarget = targets.length === 1 ? targets[0] : null;

    if (onlyTarget?.kind === "folder") {
      return {
        parentId: onlyTarget.folder.id,
        projectId: onlyTarget.folder.projectId
      };
    }

    if (onlyTarget) {
      return {
        parentId: onlyTarget.note.folderId,
        projectId: onlyTarget.note.projectId
      };
    }

    return {
      parentId: null,
      projectId: currentProjectId ?? undefined
    };
  };

  const pasteInspectorClipboard = async (
    target: InspectorContextMenuTarget | null = contextMenuTarget
  ) => {
    if (inspectorClipboard.length === 0) {
      showInspectorToast(labels.clipboardEmpty);
      return;
    }

    const destination = getPasteDestination(target);

    if (!destination.projectId) {
      return;
    }

    closeInspectorContextMenu();

    try {
      let lastCreated: Folder | Note | null = null;

      for (const item of inspectorClipboard) {
        if (item.kind === "folder") {
          lastCreated = await onDuplicateFolder(
            item.id,
            destination.parentId,
            destination.projectId
          );
        } else {
          lastCreated = await onDuplicateNote(
            item.id,
            destination.parentId,
            destination.projectId
          );
        }
      }

      if (lastCreated) {
        const entityId =
          "parentId" in lastCreated
            ? `folder:${lastCreated.id}`
            : `note:${lastCreated.id}`;
        setSelectedEntityId(entityId);
        setHierarchyFocusedEntityId(entityId);
        setActiveProjectId(lastCreated.projectId);
      }
    } catch (error) {
      showInspectorToast(getMoveErrorMessage(error));
    }
  };

  const duplicateInspectorSelection = async (
    target: InspectorContextMenuTarget | null = contextMenuTarget
  ) => {
    const targets = getContextOperationTargets(target);
    const items = getClipboardItemsFromTargets(targets);

    if (items.length === 0) {
      return;
    }

    closeInspectorContextMenu();

    try {
      let lastCreated: Folder | Note | null = null;

      for (const item of items) {
        if (item.kind === "folder") {
          const folder = orbitalData.folderById.get(item.id);

          if (!folder) {
            continue;
          }

          lastCreated = await onDuplicateFolder(
            folder.id,
            folder.parentId,
            folder.projectId,
            getHierarchySortOrder(folder) + HIERARCHY_SORT_ORDER_STEP / 2
          );
        } else {
          const note = orbitalData.noteById.get(item.id);

          if (!note) {
            continue;
          }

          lastCreated = await onDuplicateNote(
            note.id,
            note.folderId,
            note.projectId,
            getHierarchySortOrder(note) + HIERARCHY_SORT_ORDER_STEP / 2
          );
        }
      }

      if (lastCreated) {
        const entityId =
          "parentId" in lastCreated
            ? `folder:${lastCreated.id}`
            : `note:${lastCreated.id}`;
        setSelectedEntityId(entityId);
        setHierarchyFocusedEntityId(entityId);
        setActiveProjectId(lastCreated.projectId);
      }
    } catch (error) {
      showInspectorToast(getMoveErrorMessage(error));
    }
  };

  const deleteInspectorTargets = async (targets: InspectorSelectableTarget[]) => {
    const items = getClipboardItemsFromTargets(targets);

    if (items.length === 0) {
      return;
    }

    closeInspectorContextMenu();
    let hasCompletedDelete = false;

    for (const item of items) {
      let result: boolean | void;

      if (item.kind === "folder") {
        result = await onDeleteFolder(item.id);
      } else {
        result = await onDeleteNote(item.id);
      }

      if (result === false) {
        break;
      }

      hasCompletedDelete = true;
    }

    if (!hasCompletedDelete) {
      return;
    }

    setActiveFolderFilters([]);
    setActiveNoteFilters([]);
    setHierarchySelectionAnchorEntityId(null);
  };

  const getHierarchyItemParent = (item: InspectorHierarchyItem) => {
    if (item.kind === "folder" && item.folder) {
      return {
        parentId: item.folder.parentId,
        projectId: item.folder.projectId
      };
    }

    if (item.note) {
      return {
        parentId: item.note.folderId,
        projectId: item.note.projectId
      };
    }

    return {
      parentId: null,
      projectId: item.project?.id ?? currentProjectId ?? null
    };
  };

  const getSiblingHierarchyItems = (projectId: string, parentId: string | null) =>
    flattenedSelectableHierarchy
      .filter((item) => {
        const itemParent = getHierarchyItemParent(item);
        return itemParent.projectId === projectId && itemParent.parentId === parentId;
      })
      .sort((left, right) => {
        const sortDelta = getHierarchyItemSortOrder(left) - getHierarchyItemSortOrder(right);

        if (sortDelta !== 0) {
          return sortDelta;
        }

        return left.id.localeCompare(right.id);
      });

  const getDropSortOrders = (
    previousOrder: number | null,
    nextOrder: number | null,
    count: number
  ) => {
    if (count <= 0) {
      return [];
    }

    if (previousOrder !== null && nextOrder !== null) {
      const step = (nextOrder - previousOrder) / (count + 1);
      return Array.from({ length: count }, (_, index) => previousOrder + step * (index + 1));
    }

    if (previousOrder !== null) {
      return Array.from(
        { length: count },
        (_, index) => previousOrder + HIERARCHY_SORT_ORDER_STEP * (index + 1)
      );
    }

    if (nextOrder !== null) {
      return Array.from(
        { length: count },
        (_, index) => nextOrder - HIERARCHY_SORT_ORDER_STEP * (count - index)
      );
    }

    return Array.from(
      { length: count },
      (_, index) => HIERARCHY_SORT_ORDER_STEP * (index + 1)
    );
  };

  const getDragItemsForHierarchyItem = (item: InspectorHierarchyItem) => {
    const target = buildInspectorHierarchyContextTarget(item);

    if (target.kind === "core") {
      return [];
    }

    if (isInspectorTargetInMultiSelection(target)) {
      const selectedItems = getClipboardItemsFromTargets(getCurrentInspectorSelectionTargets());
      return selectedItems.length > 0 ? selectedItems : getClipboardItemsFromTargets([target]);
    }

    return getClipboardItemsFromTargets([target]);
  };

  const resolveDropPlacementFromRect = (
    item: InspectorHierarchyItem,
    rect: DOMRect,
    clientY: number
  ): InspectorDropPlacement => {
    if (item.kind === "core") {
      return "inside";
    }

    const ratio = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;

    if (item.kind === "folder") {
      if (ratio < 0.24) {
        return "before";
      }

      if (ratio > 0.76) {
        return "after";
      }

      return "inside";
    }

    return ratio < 0.5 ? "before" : "after";
  };

  const moveInspectorDragItems = async (
    items: InspectorClipboardItem[],
    targetItem: InspectorHierarchyItem,
    placement: InspectorDropPlacement
  ) => {
    if (items.length === 0) {
      return;
    }

    const draggedEntityIds = new Set(
      items.map((item) => (item.kind === "folder" ? `folder:${item.id}` : `note:${item.id}`))
    );

    if (draggedEntityIds.has(targetItem.entityId)) {
      return;
    }

    let destinationParentId: string | null = null;
    let destinationProjectId: string | null = null;
    let sortOrders: number[] = [];

    if (placement === "inside") {
      if (targetItem.kind === "core") {
        destinationParentId = null;
        destinationProjectId = targetItem.project?.id ?? currentProjectId;
      } else if (targetItem.kind === "folder" && targetItem.folder) {
        destinationParentId = targetItem.folder.id;
        destinationProjectId = targetItem.folder.projectId;
      } else {
        const parent = getHierarchyItemParent(targetItem);
        destinationParentId = parent.parentId;
        destinationProjectId = parent.projectId;
      }
    } else {
      const parent = getHierarchyItemParent(targetItem);
      destinationParentId = parent.parentId;
      destinationProjectId = parent.projectId;
      const siblings = getSiblingHierarchyItems(parent.projectId ?? "", parent.parentId).filter(
        (item) => !draggedEntityIds.has(item.entityId)
      );
      const targetIndex = siblings.findIndex((item) => item.entityId === targetItem.entityId);
      const previous =
        placement === "before"
          ? siblings[targetIndex - 1] ?? null
          : siblings[targetIndex] ?? null;
      const next =
        placement === "before"
          ? siblings[targetIndex] ?? null
          : siblings[targetIndex + 1] ?? null;
      sortOrders = getDropSortOrders(
        previous ? getHierarchyItemSortOrder(previous) : null,
        next ? getHierarchyItemSortOrder(next) : null,
        items.length
      );
    }

    if (!destinationProjectId) {
      return;
    }

    try {
      for (const [index, item] of items.entries()) {
        const sortOrder = sortOrders[index];

        if (item.kind === "folder") {
          await onMoveFolder(item.id, destinationParentId, destinationProjectId, sortOrder);
        } else {
          await onMoveNote(item.id, destinationParentId, destinationProjectId, sortOrder);
        }
      }
    } catch (error) {
      showInspectorToast(getMoveErrorMessage(error));
    }
  };

  const getMobileMoveItemEntityId = (item: InspectorClipboardItem) =>
    item.kind === "folder" ? `folder:${item.id}` : `note:${item.id}`;

  const getMobileMoveItemName = (item: InspectorClipboardItem) => {
    if (item.kind === "folder") {
      return orbitalData.folderById.get(item.id)?.name ?? "";
    }

    const note = orbitalData.noteById.get(item.id);
    return note ? getNoteInspectorTitle(note) : "";
  };

  const normalizeMoveName = (value: string) => value.trim().toLocaleLowerCase(language);

  const makeUniqueMoveName = (baseName: string, blockedNames: Set<string>) => {
    const fallback = baseName.trim() || labels.note;
    const copySuffix = t("orbit.duplicateSuffix");
    let index = 2;
    let candidate = `${fallback} ${copySuffix}`;

    while (blockedNames.has(normalizeMoveName(candidate))) {
      candidate = `${fallback} ${copySuffix} ${index}`;
      index += 1;
    }

    blockedNames.add(normalizeMoveName(candidate));
    return candidate;
  };

  const folderHasDescendantFolders = (folderId: string) => {
    const stack = [...(orbitalData.foldersByParent.get(folderId) ?? [])];

    while (stack.length > 0) {
      const folder = stack.pop();

      if (!folder) {
        continue;
      }

      return true;
    }

    return false;
  };

  const isFolderMoveIntoSelfOrDescendant = (folderId: string, destinationParentId: string | null) => {
    let cursor = destinationParentId;

    while (cursor) {
      if (cursor === folderId) {
        return true;
      }

      cursor = orbitalData.folderById.get(cursor)?.parentId ?? null;
    }

    return false;
  };

  const buildMobileMoveDestination = (
    item: InspectorHierarchyItem
  ): MobileMoveDestination | null => {
    if (item.kind === "core" && item.project) {
      return {
        entityId: item.entityId,
        kind: "project",
        projectId: item.project.id,
        parentId: null,
        label: item.label,
        color: item.color,
        issue: null
      };
    }

    if (item.kind === "folder" && item.folder) {
      return {
        entityId: item.entityId,
        kind: "folder",
        projectId: item.folder.projectId,
        parentId: item.folder.id,
        label: item.label,
        color: item.color,
        issue: null
      };
    }

    return null;
  };

  const getMobileMoveDestinationIssue = (
    items: InspectorClipboardItem[],
    destination: MobileMoveDestination
  ) => {
    if (!orbitalData.projectById.has(destination.projectId)) {
      return labels.moveBlockedMissingTarget;
    }

    const destinationFolder = destination.parentId
      ? orbitalData.folderById.get(destination.parentId) ?? null
      : null;

    if (destination.parentId && !destinationFolder) {
      return labels.moveBlockedMissingTarget;
    }

    for (const item of items) {
      if (item.kind !== "folder") {
        continue;
      }

      if (!orbitalData.folderById.has(item.id)) {
        return labels.moveBlockedInvalid;
      }

      if (isFolderMoveIntoSelfOrDescendant(item.id, destination.parentId)) {
        return labels.moveBlockedInvalid;
      }

      if (destinationFolder?.parentId) {
        return labels.moveBlockedDepth;
      }

      if (destination.parentId && folderHasDescendantFolders(item.id)) {
        return labels.moveBlockedDepth;
      }
    }

    return null;
  };

  const getMobileMoveConflicts = (
    items: InspectorClipboardItem[],
    destination: MobileMoveDestination
  ) => {
    const draggedEntityIds = new Set(items.map(getMobileMoveItemEntityId));
    const folderNames = new Set(
      folders
        .filter(
          (folder) =>
            folder.projectId === destination.projectId &&
            folder.parentId === destination.parentId &&
            !draggedEntityIds.has(`folder:${folder.id}`)
        )
        .map((folder) => normalizeMoveName(folder.name))
    );
    const noteNames = new Set(
      notes
        .filter(
          (note) =>
            note.projectId === destination.projectId &&
            note.folderId === destination.parentId &&
            !note.trashedAt &&
            !draggedEntityIds.has(`note:${note.id}`)
        )
        .map((note) => normalizeMoveName(getNoteInspectorTitle(note)))
    );
    const conflicts: MobileMoveConflict[] = [];

    for (const item of items) {
      const currentName = getMobileMoveItemName(item);
      const normalizedName = normalizeMoveName(currentName);
      const blockedNames = item.kind === "folder" ? folderNames : noteNames;

      if (!normalizedName) {
        continue;
      }

      if (blockedNames.has(normalizedName)) {
        conflicts.push({
          item,
          currentName,
          suggestedName: makeUniqueMoveName(currentName, blockedNames)
        });
      } else {
        blockedNames.add(normalizedName);
      }
    }

    return conflicts;
  };

  const getMobileMoveSortOrders = (
    destination: MobileMoveDestination,
    items: InspectorClipboardItem[]
  ) => {
    const draggedEntityIds = new Set(items.map(getMobileMoveItemEntityId));
    const siblingOrders = [
      ...folders
        .filter(
          (folder) =>
            folder.projectId === destination.projectId &&
            folder.parentId === destination.parentId &&
            !draggedEntityIds.has(`folder:${folder.id}`)
        )
        .map(getHierarchySortOrder),
      ...notes
        .filter(
          (note) =>
            note.projectId === destination.projectId &&
            note.folderId === destination.parentId &&
            !note.trashedAt &&
            !draggedEntityIds.has(`note:${note.id}`)
        )
        .map(getHierarchySortOrder)
    ].sort((left, right) => left - right);
    const previousOrder = siblingOrders.length > 0 ? siblingOrders[siblingOrders.length - 1] : null;

    return getDropSortOrders(previousOrder, null, items.length);
  };

  const clearMobileMoveState = () => {
    setMobileMoveItems([]);
    setMobileMoveDestination(null);
    setMobileMoveConflictState(null);
    setInspectorDropIntent(null);
  };

  const performMobileMove = async (
    destination: MobileMoveDestination,
    conflictMode: "move" | "rename" | "copy" = "move"
  ) => {
    if (mobileMoveItems.length === 0) {
      return;
    }

    const issue = getMobileMoveDestinationIssue(mobileMoveItems, destination);

    if (issue) {
      setMobileMoveDestination({ ...destination, issue });
      showInspectorToast(issue);
      return;
    }

    const conflicts = getMobileMoveConflicts(mobileMoveItems, destination);

    if (conflicts.length > 0 && conflictMode === "move") {
      setMobileMoveConflictState({ destination, conflicts });
      return;
    }

    closeInspectorContextMenu();

    try {
      const sortOrders = getMobileMoveSortOrders(destination, mobileMoveItems);
      const conflictsByEntityId = new Map(
        conflicts.map((conflict) => [getMobileMoveItemEntityId(conflict.item), conflict])
      );

      if (conflictMode === "rename") {
        for (const conflict of conflicts) {
          if (conflict.item.kind === "folder") {
            await onRenameFolder(conflict.item.id, conflict.suggestedName);
          } else {
            await onRenameNote(conflict.item.id, conflict.suggestedName);
          }
        }
      }

      for (const [index, item] of mobileMoveItems.entries()) {
        const sortOrder = sortOrders[index];

        if (conflictMode === "copy") {
          if (item.kind === "folder") {
            const copy = await onDuplicateFolder(
              item.id,
              destination.parentId,
              destination.projectId,
              sortOrder
            );
            const conflict = conflictsByEntityId.get(getMobileMoveItemEntityId(item));

            if (copy && conflict) {
              await onRenameFolder(copy.id, conflict.suggestedName);
            }
          } else {
            const copy = await onDuplicateNote(
              item.id,
              destination.parentId,
              destination.projectId,
              sortOrder
            );
            const conflict = conflictsByEntityId.get(getMobileMoveItemEntityId(item));

            if (copy && conflict) {
              await onRenameNote(copy.id, conflict.suggestedName);
            }
          }

          continue;
        }

        if (item.kind === "folder") {
          await onMoveFolder(item.id, destination.parentId, destination.projectId, sortOrder);
        } else {
          await onMoveNote(item.id, destination.parentId, destination.projectId, sortOrder);
        }
      }

      clearMobileMoveState();
      setHierarchyFocusedEntityId(destination.entityId);
    } catch (error) {
      showInspectorToast(getMoveErrorMessage(error));
    }
  };

  const beginMobileMoveSelection = (
    target: InspectorContextMenuTarget | null = contextMenuTarget
  ) => {
    const items = getClipboardItemsFromTargets(getContextOperationTargets(target));

    if (items.length === 0) {
      return;
    }

    closeInspectorContextMenu();
    setMobileMoveItems(items);
    setMobileMoveDestination(null);
    setMobileMoveConflictState(null);
    setIsMobileSelectionMode(false);
    setMobileSection("vault");
    openInspectorMenu("folders");
    showInspectorToast(t("orbit.mobileMoveChooseDestination"));
  };

  const cancelMobileMoveSelection = () => {
    clearMobileMoveState();
  };

  const handleMobileMoveDestination = (item: InspectorHierarchyItem) => {
    if (mobileMoveItems.length === 0) {
      return false;
    }

    const destination = buildMobileMoveDestination(item);

    if (!destination) {
      showInspectorToast(t("orbit.mobileMovePickDestination"));
      return true;
    }

    const issue = getMobileMoveDestinationIssue(mobileMoveItems, destination);
    const nextDestination = { ...destination, issue };
    setMobileMoveDestination(nextDestination);
    setMobileMoveConflictState(null);
    setHierarchyFocusedEntityId(item.entityId);

    if (issue) {
      showInspectorToast(issue);
    }

    return true;
  };

  const getHierarchyDropCandidate = (clientX: number, clientY: number) => {
    if (typeof document === "undefined") {
      return null;
    }

    const element = document.elementFromPoint(clientX, clientY);
    const targetElement = element?.closest("[data-orbital-hierarchy-entity-id]") as
      | HTMLElement
      | null;
    const entityId = targetElement?.dataset.orbitalHierarchyEntityId;

    if (!entityId) {
      return null;
    }

    const item = flattenedInspectorHierarchy.find((entry) => entry.entityId === entityId);
    const itemElement = inspectorHierarchyItemRefs.current.get(entityId);

    if (!item || !itemElement) {
      return null;
    }

    return {
      item,
      element: itemElement
    };
  };

  const updateHierarchyPointerDropIntent = (clientX: number, clientY: number) => {
    const candidate = getHierarchyDropCandidate(clientX, clientY);

    if (!candidate) {
      setInspectorDropIntent(null);
      return null;
    }

    const placement = resolveDropPlacementFromRect(
      candidate.item,
      candidate.element.getBoundingClientRect(),
      clientY
    );

    setInspectorDropIntent({
      targetEntityId: candidate.item.entityId,
      placement
    });

    return {
      ...candidate,
      placement
    };
  };

  const clearHierarchyPointerDrag = () => {
    inspectorPointerDragRef.current = null;
    inspectorDragItemsRef.current = [];
    setInspectorDropIntent(null);
  };

  const handleHierarchyPointerDragStart = (
    item: InspectorHierarchyItem,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    if (
      event.button !== 0 ||
      isAndroidTouchLayout ||
      event.pointerType === "touch" ||
      item.kind === "core"
    ) {
      return;
    }

    const items = getDragItemsForHierarchyItem(item);

    if (items.length === 0) {
      return;
    }

    inspectorPointerDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      items,
      active: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleHierarchyPointerDragMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragState = inspectorPointerDragRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const distance = Math.hypot(
      event.clientX - dragState.startX,
      event.clientY - dragState.startY
    );

    if (!dragState.active && distance < PROJECT_DRAG_THRESHOLD_PX) {
      return;
    }

    if (!dragState.active) {
      dragState.active = true;
      inspectorDragItemsRef.current = dragState.items;
      suppressInspectorClickRef.current = true;
      clearInspectorLongPress();
      closeSelectionHoverPreview();
    }

    event.preventDefault();
    updateHierarchyPointerDropIntent(event.clientX, event.clientY);
  };

  const handleHierarchyPointerDragEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragState = inspectorPointerDragRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      handleInspectorContextPointerEnd(event.pointerId);
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!dragState.active) {
      clearHierarchyPointerDrag();
      handleInspectorContextPointerEnd(event.pointerId);
      return;
    }

    event.preventDefault();
    suppressInspectorClickRef.current = true;
    const candidate = updateHierarchyPointerDropIntent(event.clientX, event.clientY);
    const items = dragState.items;
    clearHierarchyPointerDrag();

    if (candidate) {
      void moveInspectorDragItems(items, candidate.item, candidate.placement);
    }
  };

  const handleHierarchyPointerDragCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const dragState = inspectorPointerDragRef.current;

    if (dragState?.pointerId === event.pointerId) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      clearHierarchyPointerDrag();
    }

    handleInspectorContextPointerEnd(event.pointerId);
  };

  const renderInspectorRenameField = (
    target: InspectorContextMenuTarget,
    className: string
  ) => {
    const renameLabel = t("folders.rename");
    const placeholder =
      target.kind === "core"
        ? labels.system
        : target.kind === "folder"
        ? t("folders.createPlaceholder")
        : target.kind === "canvas"
          ? t("canvas.titlePlaceholder")
          : t("note.titlePlaceholder");

    return (
      <input
        autoFocus
        value={inspectorRenameDraft}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setInspectorRenameDraft(event.target.value)}
        onBlur={() => {
          void submitInspectorRename();
        }}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();

          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }

          if (event.key === "Escape") {
            event.preventDefault();
            cancelInspectorRename();
          }
        }}
        className={className}
        placeholder={placeholder}
        aria-label={`${renameLabel}: ${target.label}`}
      />
    );
  };

  const contextMenuActions = useMemo<OrbitalInspectorContextMenuAction[]>(() => {
    if (!contextMenuState) {
      return [];
    }

    const target = contextMenuState.target;
    const operationTargets = getContextOperationTargets(target);
    const isMultiTargetAction = operationTargets.length > 1;
    const actions: OrbitalInspectorContextMenuAction[] = isMultiTargetAction
      ? []
      : [
          {
            id: "rename",
            label: labels.renameAction,
            icon: "rename",
            onSelect: () => beginInspectorRename(target)
          }
        ];

      if (isAndroidTouchLayout && operationTargets.length > 0) {
        actions.push({
          id: "move",
          label: t("orbit.moveAction"),
          icon: "location",
          tone: "accent",
          onSelect: () => beginMobileMoveSelection(target)
        });
      }

      if (isMultiTargetAction) {
        actions.push({
          id: "delete-selection",
        label: labels.deleteSelection,
        icon: "trash",
        tone: "danger",
        onSelect: () => {
          void deleteInspectorTargets(operationTargets);
        }
      });

        return actions;
      }

      if (isAndroidTouchLayout && (target.kind === "note" || target.kind === "canvas")) {
        actions.push({
          id: "preview",
          label: t("orbit.mobilePreviewAction"),
          icon: "note",
          onSelect: () => openMobileNotePreview(target.note.id)
        });
      }

      if (
        (effectiveInspectorMenu === "notes" &&
          (target.kind === "note" || target.kind === "canvas")) ||
        (effectiveInspectorMenu === "overview" && target.kind !== "core")
      ) {
        actions.push({
          id: "go-to-location",
          label: labels.goToLocationAction,
          icon: "location",
          onSelect: () => goToInspectorTargetLocation(target)
        });
      }

      if (target.kind === "core") {
        actions.push(
        {
          id: "create-folder",
          label: labels.addRootFolder,
          icon: "folder",
          tone: "accent",
          onSelect: () => {
            closeInspectorContextMenu();
            beginFolderDraft(null, target.project.id);
          }
        },
        {
          id: "create-note",
          label: labels.addNote,
          icon: "note",
          tone: "accent",
          onSelect: () => {
            closeInspectorContextMenu();
            void handleCreateNote(null, target.project.id);
          }
        },
        {
          id: "create-canvas",
          label: labels.addCanvas,
          icon: "canvas",
          tone: "accent",
          onSelect: () => {
            closeInspectorContextMenu();
            void handleCreateCanvas(null, target.project.id);
          }
        },
        {
          id: "delete-project",
          label: labels.deleteSystem,
          icon: "trash",
          tone: "danger",
          onSelect: () => {
            closeInspectorContextMenu();
            void onDeleteProject(target.project.id);
          }
        }
      );

      return actions;
    }

    if (target.kind === "folder") {
      if (target.canCreateFolder) {
        actions.push({
          id: "create-folder",
          label: labels.addChildFolder,
          icon: "folder",
          tone: "accent",
          onSelect: () => {
            closeInspectorContextMenu();
            beginFolderDraft(target.folder.id, target.folder.projectId);
          }
        });
      }

      actions.push(
        {
          id: "create-note",
          label: labels.addNote,
          icon: "note",
          tone: "accent",
          onSelect: () => {
            closeInspectorContextMenu();
            void handleCreateNote(target.folder.id, target.folder.projectId);
          }
        },
        {
          id: "create-canvas",
          label: labels.addCanvas,
          icon: "canvas",
          tone: "accent",
          onSelect: () => {
            closeInspectorContextMenu();
            void handleCreateCanvas(target.folder.id, target.folder.projectId);
          }
        },
        {
          id: "delete-folder",
          label: labels.deleteFolder,
          icon: "trash",
          tone: "danger",
          onSelect: () => {
            void deleteInspectorTargets([target]);
          }
        }
      );

      return actions;
    }

    actions.push(
      {
        id: "toggle-pin",
        label: target.pinned ? t("note.unpin") : t("note.pin"),
        icon: target.pinned ? "unpin" : "pin",
        onSelect: () => {
          closeInspectorContextMenu();
          void onSetNotePinned(target.note.id, !target.pinned);
        }
      },
      {
        id: "delete-note",
        label: labels.moveToTrash,
        icon: "trash",
        tone: "danger",
        onSelect: () => {
          void deleteInspectorTargets([target]);
        }
      }
    );

    return actions;
  }, [
    beginInspectorRename,
    beginFolderDraft,
    closeInspectorContextMenu,
    contextMenuState,
    handleCreateCanvas,
    handleCreateNote,
    labels.addCanvas,
    labels.addChildFolder,
    labels.addNote,
    labels.addRootFolder,
    labels.deleteFolder,
      labels.deleteSelection,
      labels.deleteSystem,
    labels.goToLocationAction,
      labels.moveToTrash,
      labels.renameAction,
      isAndroidTouchLayout,
      effectiveInspectorMenu,
      onDeleteProject,
    onDeleteFolder,
    onDeleteNote,
    activeFolderFilters,
    activeNoteFilters,
    orbitalData.folderById,
    orbitalData.folderMeta,
    orbitalData.noteById,
    onRenameProject,
    onSetNotePinned,
    openMobileNotePreview,
    t
  ]);

  const contextMenuQuickActions = useMemo<OrbitalInspectorContextMenuAction[]>(() => {
    if (!contextMenuState) {
      return [];
    }

    const target = contextMenuState.target;
    const operationTargets = getContextOperationTargets(target);
    const canCopy = target.kind !== "core" || operationTargets.length > 0;

    return [
      {
        id: "copy",
        label: labels.copyAction,
        icon: "copy",
        disabled: !canCopy,
        onSelect: () => copyInspectorSelection(target)
      },
      {
        id: "paste",
        label: labels.pasteAction,
        icon: "paste",
        tone: "accent",
        disabled: inspectorClipboard.length === 0,
        onSelect: () => {
          void pasteInspectorClipboard(target);
        }
      },
      {
        id: "duplicate",
        label: labels.duplicateAction,
        icon: "duplicate",
        disabled: operationTargets.length === 0,
        onSelect: () => {
          void duplicateInspectorSelection(target);
        }
      }
    ];
  }, [
    activeFolderFilters,
    activeNoteFilters,
    contextMenuState,
    inspectorClipboard.length,
    labels.copyAction,
    labels.duplicateAction,
    labels.pasteAction,
    orbitalData.folderById,
    orbitalData.folderMeta,
    orbitalData.noteById
  ]);

  function renderInspectorItemIcon(kind: InspectorCompactIconKind, color: string) {
    const style = { "--item-color": color } as CSSProperties;

    if (kind === "folder") {
      return (
        <span
          className="orbital-tree-icon is-folder"
          style={style}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M3.5 8.4c0-1.5 1.2-2.7 2.7-2.7h3.4l1.6 1.7h6.6c1.5 0 2.7 1.2 2.7 2.7v5.7c0 1.5-1.2 2.7-2.7 2.7H6.2c-1.5 0-2.7-1.2-2.7-2.7V8.4Z" />
            <path d="M3.9 10.1h16.2" className="orbital-tree-icon-accent" />
          </svg>
        </span>
      );
    }

    if (kind === "subfolder") {
      return (
        <span
          className="orbital-tree-icon is-subfolder"
          style={style}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M4 8.3c0-1.4 1.1-2.6 2.6-2.6h3l1.4 1.6h5.4c1.4 0 2.6 1.2 2.6 2.6v5.5c0 1.4-1.2 2.6-2.6 2.6H6.6c-1.5 0-2.6-1.2-2.6-2.6V8.3Z" />
            <path d="M7.2 9.9h8.1" className="orbital-tree-icon-accent" />
            <circle cx="17.4" cy="7.3" r="1.65" className="orbital-tree-icon-dot" />
          </svg>
        </span>
      );
    }

    if (kind === "canvas") {
      return (
        <span
          className="orbital-tree-icon is-canvas"
          style={style}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" focusable="false">
            <rect x="4.2" y="5" width="15.6" height="14" rx="3.2" />
            <path d="M8.2 9.2h7.6M8.2 12h5.8M8.2 14.8h6.8" className="orbital-tree-icon-accent" />
          </svg>
        </span>
      );
    }

    if (kind === "tag") {
      return (
        <span
          className="orbital-tree-icon is-tag"
          style={style}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M5.3 8.8c0-1.3 1.1-2.4 2.4-2.4h5.2l5.8 5.8a1.8 1.8 0 0 1 0 2.5l-3.8 3.8a1.8 1.8 0 0 1-2.5 0L6.6 12.7V8.8Z" />
            <circle cx="9.1" cy="9.4" r="1.15" className="orbital-tree-icon-dot" />
          </svg>
        </span>
      );
    }

    if (kind === "file") {
      return (
        <span
          className="orbital-tree-icon is-file"
          style={style}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M8 5.2h6.4l3.2 3.3v8.8c0 1.3-1.1 2.4-2.4 2.4H8c-1.3 0-2.4-1.1-2.4-2.4V7.6c0-1.3 1.1-2.4 2.4-2.4Z" />
            <path d="M14.4 5.5v3.4h3.2" className="orbital-tree-icon-accent" />
            <path d="M8.7 12h6.6M8.7 14.9h5.1" className="orbital-tree-icon-accent" />
          </svg>
        </span>
      );
    }

    if (kind === "color") {
      return (
        <span
          className="orbital-tree-icon is-color"
          style={style}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" focusable="false">
            <circle cx="12" cy="12" r="7.3" />
            <circle cx="12" cy="12" r="3.1" className="orbital-tree-icon-corefill" />
          </svg>
        </span>
      );
    }

    if (kind === "core") {
      return (
        <span
          className="orbital-tree-icon is-core"
          style={style}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" focusable="false">
            <circle cx="12" cy="12" r="7.2" />
            <circle cx="12" cy="12" r="3.2" className="orbital-tree-icon-corefill" />
            <path d="M12 2.9v2.2M12 18.9v2.2M2.9 12h2.2M18.9 12h2.2" className="orbital-tree-icon-accent" />
          </svg>
        </span>
      );
    }

    return (
      <span
        className="orbital-tree-icon is-note"
        style={style}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M7.1 4.5h6.7l4.1 4.1v9.3c0 1.4-1.1 2.5-2.5 2.5H7.1c-1.4 0-2.5-1.1-2.5-2.5V7c0-1.4 1.1-2.5 2.5-2.5Z" />
          <path d="M13.8 4.7V8.8h4.1" className="orbital-tree-icon-accent" />
          <path d="M8.2 11h7.2M8.2 14h6.1M8.2 17h4.8" className="orbital-tree-icon-accent" />
        </svg>
      </span>
    );
  }

  function getInspectorItemIconKind(item: Pick<InspectorHierarchyItem, "kind" | "folder">) {
    if (item.kind === "folder") {
      return item.folder?.parentId ? "subfolder" : "folder";
    }

    return item.kind === "core" ? "core" : item.kind;
  }

  function renderPreviewActionIcon(kind: "open" | "pin" | "unpin" | "trash") {
    if (kind === "open") {
      return (
        <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
          <path
            d="M6.2 3.2h4.6v1.4H8.6l4.2 4.2-1 1-4.2-4.2v2.2H6.2V3.2Z"
            fill="currentColor"
          />
          <path
            d="M3.4 4.6A1.2 1.2 0 0 1 4.6 3.4h3v1.2h-3v6.8h6.8v-3h1.2v3a1.2 1.2 0 0 1-1.2 1.2H4.6a1.2 1.2 0 0 1-1.2-1.2V4.6Z"
            fill="currentColor"
          />
        </svg>
      );
    }

    if (kind === "trash") {
      return (
        <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
          <path
            d="M6.2 2.8h3.6l.5 1.2H13v1.2h-1l-.4 7A1.6 1.6 0 0 1 10 13.8H6A1.6 1.6 0 0 1 4.4 12.2l-.4-7H3V4h2.7l.5-1.2Zm.8 1.2-.3.7h2.6L9 4H7Zm-1.4 1.9.4 6.2c.02.28.25.5.54.5H10c.29 0 .52-.22.54-.5l.4-6.2H5.6Zm1.2 1.1h1.1v4.3H6.8V7Zm2.3 0h1.1v4.3H9.1V7Z"
            fill="currentColor"
          />
        </svg>
      );
    }

    return (
      <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
        <path
          d="M8 2.2l1.55 3.14 3.47.5-2.51 2.45.6 3.46L8 10.1l-3.11 1.65.6-3.46L2.98 5.84l3.47-.5L8 2.2Z"
          fill="currentColor"
        />
        {kind === "unpin" ? (
          <path
            d="M3.1 12.1 12.9 2.3"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        ) : null}
      </svg>
    );
  }

  function renderMobileOpenGlyph() {
    return (
      <svg viewBox="0 0 18 18" focusable="false" aria-hidden="true">
        <path d="M6.8 4.4h6.8v6.8" />
        <path d="m13.2 4.8-8.4 8.4" />
        <path d="M4.4 5.8V4.4h1.4M12.2 13.6h1.4v-1.4" className="orbital-mobile-action-glyph-accent" />
      </svg>
    );
  }

  function renderMobileActionGlyph(kind: "select" | "preview" | "more") {
    if (kind === "select") {
      return (
        <svg viewBox="0 0 18 18" focusable="false" aria-hidden="true">
          <rect x="3.1" y="3.2" width="11.8" height="11.6" rx="3" />
          <path d="m6 9.1 2 2 4-4.4" className="orbital-mobile-action-glyph-accent" />
        </svg>
      );
    }

    if (kind === "preview") {
      return (
        <svg viewBox="0 0 18 18" focusable="false" aria-hidden="true">
          <path d="M2.6 9s2.1-4.1 6.4-4.1S15.4 9 15.4 9 13.3 13.1 9 13.1 2.6 9 2.6 9Z" />
          <circle cx="9" cy="9" r="1.9" className="orbital-mobile-action-glyph-accent" />
        </svg>
      );
    }

    return (
      <svg viewBox="0 0 18 18" focusable="false" aria-hidden="true">
        <circle cx="4.5" cy="9" r="1.25" />
        <circle cx="9" cy="9" r="1.25" className="orbital-mobile-action-glyph-accent" />
        <circle cx="13.5" cy="9" r="1.25" />
      </svg>
    );
  }

  function renderMobileNavGlyph(section: OrbitalMobileNavSection) {
    if (section === "vault") {
      return (
        <svg className="orbital-mobile-nav-glyph is-vault" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4.4 7.2h15.2v11.1H4.4z" />
          <path d="M4.4 7.2 7.1 5.1h9.8l2.7 2.1" className="orbital-mobile-nav-glyph-accent" />
          <path d="M8 11.1h8M8 14.5h5.7" className="orbital-mobile-nav-glyph-accent" />
        </svg>
      );
    }

    if (section === "more") {
      return (
        <svg className="orbital-mobile-nav-glyph is-more" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="7.2" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" className="orbital-mobile-nav-glyph-dot" />
          <circle cx="16.8" cy="12" r="1.8" />
          <path d="M5.2 7.2h13.6M5.2 16.8h13.6" className="orbital-mobile-nav-glyph-accent" />
        </svg>
      );
    }

    if (section === "planner") {
      return (
        <svg className="orbital-mobile-nav-glyph is-planner" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5.3 5.2h13.4v13.6H5.3z" />
          <path d="M8.2 9h7.6M8.2 12.1h5.2M8.2 15.2h6.7" className="orbital-mobile-nav-glyph-accent" />
          <path d="m15.7 5.2 1.1 2.1 2 .3-1.5 1.5.4 2.1-2-1-1.9 1 .4-2.1-1.5-1.5 2-.3z" className="orbital-mobile-nav-glyph-dot" />
        </svg>
      );
    }

    if (section === "map") {
      return (
        <svg className="orbital-mobile-nav-glyph is-map" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="2.25" />
          <path d="M5.2 14.8c2.6 4.2 9.2 4.8 13.6 1.1" className="orbital-mobile-nav-glyph-accent" />
          <path d="M18.7 9.2C16.1 5 9.5 4.4 5.1 8.1" className="orbital-mobile-nav-glyph-accent" />
          <circle cx="5.2" cy="8.1" r="1.35" className="orbital-mobile-nav-glyph-dot" />
          <circle cx="18.8" cy="15.9" r="1.35" className="orbital-mobile-nav-glyph-dot" />
        </svg>
      );
    }

    if (section === "pinned") {
      return (
        <svg className="orbital-mobile-nav-glyph is-pinned" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m12 4.7 2.1 4.25 4.7.68-3.4 3.31.8 4.68L12 15.4l-4.2 2.22.8-4.68-3.4-3.31 4.7-.68z" />
          <path d="M12 7.8v5.4" className="orbital-mobile-nav-glyph-accent" />
        </svg>
      );
    }

    if (section === "account") {
      return (
        <svg className="orbital-mobile-nav-glyph is-account" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="8.2" r="3" />
          <path d="M5.8 18.5a6.35 6.35 0 0 1 12.4 0" />
          <path d="M18.2 6.6a3.8 3.8 0 0 1 .3 7.5h-2.7" className="orbital-mobile-nav-glyph-accent" />
        </svg>
      );
    }

    return (
      <svg className="orbital-mobile-nav-glyph is-settings" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="2.65" />
        <path
          d="M12 4.8v2.1M12 17.1v2.1M6.9 6.9l1.5 1.5M15.6 15.6l1.5 1.5M4.8 12h2.1M17.1 12h2.1M6.9 17.1l1.5-1.5M15.6 8.4l1.5-1.5"
          className="orbital-mobile-nav-glyph-accent"
        />
      </svg>
    );
  }

  function renderEntryPreviewActions(
    note: Note,
    options?: {
      className?: string;
      closeHoverPreviewOnAction?: boolean;
    }
  ) {
    const isPinned = isEntryFavorite(note);
    const openLabel = note.contentType === "canvas" ? labels.openCanvas : labels.openNote;
    const pinLabel = isPinned ? t("note.unpin") : t("note.pin");

    const runAction = (callback: () => void, closeHoverPreview = false) => {
      if (closeHoverPreview || options?.closeHoverPreviewOnAction) {
        closeSelectionHoverPreview();
      }

      callback();
    };

    return (
      <div className={["orbital-preview-actions", options?.className ?? ""].filter(Boolean).join(" ")}>
        <button
          type="button"
          className="orbital-preview-action"
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            runAction(() => onOpenNote(note.id), true);
          }}
          aria-label={openLabel}
          title={openLabel}
        >
          {renderPreviewActionIcon("open")}
        </button>
        <button
          type="button"
          className={`orbital-preview-action ${isPinned ? "is-active" : ""}`}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            runAction(() => {
              void onSetNotePinned(note.id, !isPinned);
            });
          }}
          aria-label={pinLabel}
          title={pinLabel}
        >
          {renderPreviewActionIcon(isPinned ? "unpin" : "pin")}
        </button>
        <button
          type="button"
          className="orbital-preview-action is-danger"
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            runAction(() => {
              void onDeleteNote(note.id);
            }, true);
          }}
          aria-label={labels.moveToTrash}
          title={labels.moveToTrash}
        >
          {renderPreviewActionIcon("trash")}
        </button>
      </div>
    );
  }

  function renderInspectorCompactRow({
    isActive,
    onClick,
    title,
    meta,
    kindLabel,
    count,
    icon,
    contextMenuTarget,
    onPreview,
    previewLabel,
    openLabel,
    onDoubleClick,
    onPointerEnter,
    onPointerMove,
    onPointerLeave,
    onPointerCancel
  }: {
    isActive: boolean;
    onClick: () => void;
    title: string;
    meta?: string | null;
    kindLabel?: string | null;
    count?: number;
    icon: ReactNode;
    contextMenuTarget?: InspectorContextMenuTarget;
    onPreview?: () => void;
    previewLabel?: string;
    openLabel?: string;
    onDoubleClick?: () => void;
    onPointerEnter?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerMove?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerLeave?: () => void;
    onPointerCancel?: () => void;
  }) {
    const showMobilePreviewHint = isAndroidTouchLayout && Boolean(onPreview);
    const showMobileOpenHint = isAndroidTouchLayout && Boolean(onDoubleClick);
    const hasSide = Boolean(kindLabel || typeof count === "number" || showMobilePreviewHint || showMobileOpenHint);

    if (contextMenuTarget && isEditingInspectorTarget(contextMenuTarget)) {
      return (
        <div className="orbital-tree-item orbital-menu-compact-item is-editing">
          {icon}
          <span className="orbital-menu-compact-main">
            <span className="orbital-menu-compact-copy">
              {renderInspectorRenameField(contextMenuTarget, "orbital-menu-inline-input")}
              {meta ? <span className="orbital-menu-compact-meta">{meta}</span> : null}
            </span>
          </span>
        </div>
      );
    }

    return (
      <button
        type="button"
        className={`orbital-tree-item orbital-menu-compact-item ${isActive ? "is-active" : ""}`}
        onClick={(event) => {
          const openTarget = (event.target as HTMLElement | null)?.closest(
            "[data-mobile-open-action]"
          );
          const previewTarget = (event.target as HTMLElement | null)?.closest(
            "[data-mobile-preview-action]"
          );

          if (openTarget && onDoubleClick) {
            event.preventDefault();
            event.stopPropagation();
            onDoubleClick();
            return;
          }

          if (previewTarget && onPreview) {
            event.preventDefault();
            event.stopPropagation();
            onPreview();
            return;
          }

          if (consumeSuppressedInspectorClick()) {
            event.preventDefault();
            return;
          }

          onClick();
        }}
        onDoubleClick={isAndroidTouchLayout ? undefined : onDoubleClick}
        onContextMenu={
          contextMenuTarget
            ? (event) => {
                event.preventDefault();
                openInspectorContextMenu(contextMenuTarget, "popover", {
                  x: event.clientX,
                  y: event.clientY
                });
              }
            : undefined
        }
        onPointerDown={
          contextMenuTarget || onPreview
            ? (event) => {
                const mobileActionTarget = (event.target as HTMLElement | null)?.closest(
                  "[data-mobile-open-action], [data-mobile-preview-action]"
                );

                if (mobileActionTarget) {
                  return;
                }

                if (contextMenuTarget) {
                  handleInspectorContextPointerDown(contextMenuTarget, event);
                  return;
                }

                if (onPreview) {
                  startMobilePreviewLongPress(onPreview, event);
                }
              }
            : undefined
        }
        onPointerEnter={onPointerEnter}
        onPointerMove={(event) => {
          onPointerMove?.(event);
          if (contextMenuTarget) {
            handleInspectorContextPointerMove(event);
          } else if (onPreview) {
            updateMobilePreviewLongPress(event);
          }
        }}
        onPointerUp={
          contextMenuTarget || onPreview
            ? (event) => {
                if (contextMenuTarget) {
                  handleInspectorContextPointerEnd(event.pointerId);
                } else {
                  endMobilePreviewLongPress(event.pointerId);
                }
              }
            : undefined
        }
        onPointerLeave={(event) => {
          onPointerLeave?.();
          if (contextMenuTarget) {
            handleInspectorContextPointerEnd(event.pointerId);
          } else if (onPreview) {
            endMobilePreviewLongPress(event.pointerId);
          }
        }}
        onPointerCancel={(event) => {
          onPointerCancel?.();
          if (contextMenuTarget) {
            handleInspectorContextPointerEnd(event.pointerId);
          } else if (onPreview) {
            endMobilePreviewLongPress(event.pointerId);
          }
        }}
      >
        {icon}
        <span className="orbital-menu-compact-main">
          <span className="orbital-menu-compact-copy">
            <span className="orbital-menu-compact-title">{title}</span>
            {meta ? <span className="orbital-menu-compact-meta">{meta}</span> : null}
          </span>

          {hasSide ? (
            <span className="orbital-menu-compact-side">
              {kindLabel ? <span className="orbital-tree-kind">{kindLabel}</span> : null}
              {typeof count === "number" ? (
                <span className="orbital-menu-compact-count">{count}</span>
              ) : null}
              {showMobileOpenHint ? (
                <span
                  className="orbital-menu-compact-preview-mark is-open"
                  data-mobile-open-action="true"
                  aria-label={openLabel ?? title}
                  title={openLabel ?? title}
                >
                  {renderMobileOpenGlyph()}
                </span>
              ) : null}
              {showMobilePreviewHint ? (
                <span
                  className="orbital-menu-compact-preview-mark"
                  data-mobile-preview-action="true"
                  aria-label={previewLabel ?? t("orbit.mobilePreviewAction")}
                  title={previewLabel ?? t("orbit.mobilePreviewAction")}
                >
                  i
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      </button>
    );
  }

  function renderInspectorStaticCompactRow({
    title,
    meta,
    kindLabel,
    count,
    icon,
    className
  }: {
    title: string;
    meta?: string | null;
    kindLabel?: string | null;
    count?: number;
    icon: ReactNode;
    className?: string;
  }) {
    return (
      <div className={`orbital-tree-item orbital-menu-compact-item orbital-inspector-static-row ${className ?? ""}`.trim()}>
        {icon}
        <span className="orbital-menu-compact-main">
          <span className="orbital-menu-compact-copy">
            <span className="orbital-menu-compact-title">{title}</span>
            {meta ? <span className="orbital-menu-compact-meta">{meta}</span> : null}
          </span>

          {kindLabel || typeof count === "number" ? (
            <span className="orbital-menu-compact-side">
              {kindLabel ? <span className="orbital-tree-kind">{kindLabel}</span> : null}
              {typeof count === "number" ? (
                <span className="orbital-menu-compact-count">{count}</span>
              ) : null}
            </span>
          ) : null}
        </span>
      </div>
    );
  }

  function getNoteInspectorTitle(note: Note) {
    return getDisplayNoteTitle(note, language);
  }

  function renderFolderDraftNode(depth: number) {
    return (
      <div className="orbital-tree-node" key={`folder-draft:${folderDraftParentId ?? folderDraftProjectId ?? "root"}`}>
        <div className="orbital-tree-row" style={{ "--tree-depth": depth } as CSSProperties}>
          <span className="orbital-tree-toggle-spacer" aria-hidden="true" />
          <div
            className="orbital-tree-item is-editing is-draft"
            ref={folderDraftRowRef}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
          >
            {renderInspectorItemIcon("folder", folderDraftColor)}
            <span className="orbital-tree-item-main">
              <input
                ref={folderDraftInputRef}
                value={folderDraft}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  setFolderDraft(event.target.value);
                  if (folderDraftError) {
                    setFolderDraftError(null);
                  }
                }}
                onBlur={() => {
                  void handleCreateFolder();
                }}
                onClick={(event) => event.stopPropagation()}
                onContextMenu={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  event.stopPropagation();

                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    resetFolderDraft();
                  }
                }}
                className="orbital-menu-inline-input"
                placeholder={labels.folderNamePlaceholder}
                aria-label={labels.folderNamePlaceholder}
              />
              <span className="orbital-tree-kind">{labels.folder}</span>
            </span>
          </div>
        </div>
      </div>
    );
  }

  function renderInspectorHierarchyNode(item: InspectorHierarchyItem, depth = 0): ReactNode {
    const hasChildren = item.children.length > 0;
    const hasDraftChild =
      isFolderDraftOpen &&
      folderDraftProjectId === currentProjectId &&
      ((item.kind === "core" &&
        folderDraftParentId === null &&
        item.project?.id === folderDraftProjectId) ||
        (item.kind === "folder" && folderDraftParentId === item.id));
    const isCoreCollapsible = item.kind === "core" && isVaultInspectorScope;
    const isExpandable =
      (item.kind === "folder" || isCoreCollapsible) && (hasChildren || hasDraftChild);
    const isExpanded =
      item.kind === "core"
        ? isCoreCollapsible
          ? hasDraftChild ||
            normalizedInspectorQuery.length > 0 ||
            (!isInspectorHierarchyAutoExpandSuppressed &&
              selectedHierarchyExpandedProjectSet.has(item.id)) ||
            expandedInspectorProjectSet.has(item.id)
          : true
        : isExpandable
          ? hasDraftChild ||
            normalizedInspectorQuery.length > 0 ||
            (!isInspectorHierarchyAutoExpandSuppressed &&
              selectedHierarchyExpandedFolderSet.has(item.id)) ||
            !collapsedInspectorFolderSet.has(item.id)
          : false;
    const isSceneSelected = selectedEntityId === item.entityId;
    const isHierarchyFocused = hierarchyFocusedEntityId === item.entityId;
    const dropPlacement =
      inspectorDropIntent?.targetEntityId === item.entityId
        ? inspectorDropIntent.placement
        : null;
    const isActive =
      (item.kind === "core"
        ? false
        : item.kind === "folder"
          ? activeFolderFilterSet.has(item.id)
          : activeNoteFilterSet.has(item.id)) ||
      isSceneSelected ||
      isHierarchyFocused;
    const metaLabel =
      item.kind === "core"
        ? `${labels.system}: ${item.label}`
        : item.kind === "folder"
        ? folderPathMap.get(item.id) ?? item.label
        : item.note?.folderId
          ? folderPathMap.get(item.note.folderId) ?? labels.uncategorized
          : labels.uncategorized;
    const contextMenuTarget = buildInspectorHierarchyContextTarget(item);
    const isEditing = contextMenuTarget ? isEditingInspectorTarget(contextMenuTarget) : false;
    const kindLabel =
      item.kind === "core"
        ? labels.system
        : item.kind === "folder"
          ? labels.folder
          : item.kind === "canvas"
            ? labels.canvas
            : labels.note;

    return (
      <div className="orbital-tree-node" key={item.entityId}>
        <div
          className="orbital-tree-row"
          data-orbital-hierarchy-entity-id={item.entityId}
          style={{ "--tree-depth": depth } as CSSProperties}
          role="treeitem"
          aria-expanded={isExpandable ? isExpanded : undefined}
          aria-selected={isActive}
          aria-level={depth + 1}
        >
          {isExpandable ? (
            <button
              type="button"
              className={`orbital-tree-toggle ${isExpanded ? "is-expanded" : ""}`}
              aria-label={item.label}
              aria-expanded={isExpanded}
              disabled={normalizedInspectorQuery.length > 0}
              onClick={(event) => {
                event.stopPropagation();
                if (item.kind === "core") {
                  toggleInspectorProjectExpansion(item.id);
                } else {
                  toggleInspectorFolderCollapse(item.id);
                }
              }}
            >
              <span aria-hidden="true">›</span>
            </button>
          ) : (
            <span className="orbital-tree-toggle-spacer" aria-hidden="true" />
          )}

          {isEditing ? (
            <div
              className="orbital-tree-item is-editing"
              ref={(node) => registerInspectorHierarchyItemRef(item.entityId, node)}
            >
              {renderInspectorItemIcon(getInspectorItemIconKind(item), item.color)}
              <span className="orbital-tree-item-main">
                {renderInspectorRenameField(contextMenuTarget!, "orbital-menu-inline-input")}
                <span className="orbital-tree-kind">{kindLabel}</span>
              </span>
            </div>
          ) : (
            <button
              type="button"
              className={`orbital-tree-item ${isActive ? "is-active" : ""} ${
                isSceneSelected ? "is-scene-selected" : ""
              } ${item.kind !== "core" ? "is-draggable" : ""} ${
                dropPlacement ? `is-drop-target is-drop-${dropPlacement}` : ""
              }`}
              ref={(node) => registerInspectorHierarchyItemRef(item.entityId, node)}
              title={metaLabel}
              onClick={(event) => {
                const openTarget = (event.target as HTMLElement | null)?.closest(
                  "[data-mobile-open-action]"
                );
                const previewTarget = (event.target as HTMLElement | null)?.closest(
                  "[data-mobile-preview-action]"
                );

                if (openTarget && item.note && isAndroidTouchLayout) {
                  event.preventDefault();
                  event.stopPropagation();
                  closeSelectionHoverPreview();
                  onOpenNote(item.note.id);
                  return;
                }

                if (previewTarget && item.note && isAndroidTouchLayout) {
                  event.preventDefault();
                  event.stopPropagation();
                  openMobileNotePreview(item.note.id);
                  return;
                }

                if (consumeSuppressedInspectorClick()) {
                  event.preventDefault();
                  return;
                }

                if (handleMobileMoveDestination(item)) {
                  event.preventDefault();
                  return;
                }

                handleInspectorHierarchySelection(item, event);
              }}
              onDoubleClick={
                isAndroidTouchLayout
                  ? undefined
                  : item.kind === "core"
                  ? () => {
                      if (item.project) {
                        centerOnProject(item.project.id);
                      }
                    }
                  : item.note
                  ? () => {
                      closeSelectionHoverPreview();
                      onOpenNote(item.note!.id);
                    }
                  : undefined
              }
              onContextMenu={(event) => {
                if (!contextMenuTarget) {
                  return;
                }

                event.preventDefault();
                openInspectorContextMenu(contextMenuTarget, "popover", {
                  x: event.clientX,
                  y: event.clientY
                });
              }}
              onPointerDown={(event) => {
                const mobileActionTarget = (event.target as HTMLElement | null)?.closest(
                  "[data-mobile-open-action], [data-mobile-preview-action]"
                );

                if (mobileActionTarget) {
                  return;
                }

                handleHierarchyPointerDragStart(item, event);

                if (!contextMenuTarget) {
                  return;
                }

                handleInspectorContextPointerDown(contextMenuTarget, event);
              }}
              onPointerEnter={
                item.note && canShowHoverPreview
                  ? (event) => {
                      openSelectionHoverPreview(
                        item.note!.id,
                        event.clientX,
                        event.clientY,
                        "inspector",
                        {
                          anchorRect: toHoverPreviewAnchorRect(
                            event.currentTarget.getBoundingClientRect()
                          )
                        }
                      );
                    }
                  : undefined
              }
              onPointerMove={(event) => {
                handleHierarchyPointerDragMove(event);

                if (inspectorPointerDragRef.current?.active) {
                  return;
                }

                if (item.note && canShowHoverPreview) {
                  updateSelectionHoverPreviewCursor(event.clientX, event.clientY, {
                    anchorRect: toHoverPreviewAnchorRect(
                      event.currentTarget.getBoundingClientRect()
                    )
                  });
                }

                if (contextMenuTarget) {
                  handleInspectorContextPointerMove(event);
                }
              }}
              onPointerUp={(event) => {
                handleHierarchyPointerDragEnd(event);
              }}
              onPointerLeave={(event) => {
                if (item.note && canShowHoverPreview) {
                  scheduleSelectionHoverPreviewClose();
                }

                if (contextMenuTarget) {
                  handleInspectorContextPointerEnd(event.pointerId);
                }
              }}
              onPointerCancel={(event) => {
                if (item.note && canShowHoverPreview) {
                  scheduleSelectionHoverPreviewClose();
                }

                handleHierarchyPointerDragCancel(event);
              }}
            >
              {renderInspectorItemIcon(getInspectorItemIconKind(item), item.color)}
              <span className="orbital-tree-item-main">
                <span className="orbital-tree-label">{item.label}</span>
                <span className="orbital-tree-kind">{kindLabel}</span>
                {isAndroidTouchLayout && item.note ? (
                  <span className="orbital-tree-touch-actions">
                    <span
                      className="orbital-menu-compact-preview-mark is-open"
                      data-mobile-open-action="true"
                      aria-label={item.note.contentType === "canvas" ? labels.openCanvas : labels.openNote}
                      title={item.note.contentType === "canvas" ? labels.openCanvas : labels.openNote}
                    >
                      {renderMobileOpenGlyph()}
                    </span>
                    <span
                      className="orbital-menu-compact-preview-mark"
                      data-mobile-preview-action="true"
                      aria-label={t("orbit.mobilePreviewAction")}
                      title={t("orbit.mobilePreviewAction")}
                    >
                      i
                    </span>
                  </span>
                ) : null}
              </span>
            </button>
          )}
        </div>

        {((item.kind === "core" && (!isCoreCollapsible || isExpanded)) ||
          (item.kind !== "core" && isExpandable && isExpanded)) &&
        (item.children.length > 0 || hasDraftChild) ? (
          <div className="orbital-tree-children" role="group">
            {item.children.map((child) => renderInspectorHierarchyNode(child, depth + 1))}
            {hasDraftChild ? renderFolderDraftNode(depth + 1) : null}
          </div>
        ) : null}
      </div>
    );
  }

  function renderEditableProjectTitle(
    project: Project | null | undefined,
    fallbackTitle: string,
    className: string
  ) {
    const renameLabel = t("folders.rename");

    if (!project) {
      return <h2 className={className}>{fallbackTitle}</h2>;
    }

    if (editingProjectId === project.id) {
      const displayName = getDisplayProjectName(
        project,
        language,
        orbitalData.projects.findIndex((entry) => entry.id === project.id)
      );

      return (
        <div className="orbital-inline-title-shell is-editing">
          <input
            autoFocus
            value={projectNameDraft}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setProjectNameDraft(event.target.value)}
            onBlur={() => {
              void submitProjectRename();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }

              if (event.key === "Escape") {
                event.preventDefault();
                cancelProjectRename();
              }
            }}
            className={`orbital-inline-title-input ${className}`}
            placeholder={labels.system}
            aria-label={`${renameLabel}: ${displayName}`}
          />
        </div>
      );
    }

    const displayName = getDisplayProjectName(
      project,
      language,
      orbitalData.projects.findIndex((entry) => entry.id === project.id)
    );
    const isPlaceholder = !hasExplicitDisplayName(project.name);

    return (
      <div className="orbital-inline-title-shell">
        <button
          type="button"
          className={`orbital-inline-title-button ${className} ${isPlaceholder ? "is-placeholder" : ""}`}
          onClick={() => beginProjectRename(project)}
          title={displayName}
        >
          {displayName}
        </button>
        <button
          type="button"
          className="orbital-inline-title-edit"
          onClick={() => beginProjectRename(project)}
          aria-label={`${renameLabel}: ${displayName}`}
          title={renameLabel}
        >
          ✎
        </button>
      </div>
    );
  }

  function renderEditableVaultTitle(className: string) {
    const renameLabel = t("settings.localVaultRename");

    if (!activeLocalVaultItem) {
      return <h2 className={className}>{labels.localVault}</h2>;
    }

    if (isEditingVaultTitle) {
      const displayName = getDisplayVaultName(
        activeLocalVaultItem,
        language,
        activeLocalVaultIndex >= 0 ? activeLocalVaultIndex : undefined
      );

      return (
        <div className="orbital-inline-title-stack">
          <div className="orbital-inline-title-shell is-editing">
            <input
              autoFocus
              value={vaultNameDraft}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => {
                setVaultNameDraft(event.target.value);
                if (vaultRenameError) {
                  setVaultRenameError(null);
                }
              }}
              onBlur={() => {
                void submitVaultRename();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }

                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelVaultRename();
                }
              }}
              className={`orbital-inline-title-input ${className}`}
              placeholder={t("sync.localVaultCreatePlaceholder")}
              aria-label={`${renameLabel}: ${displayName}`}
            />
          </div>
          {vaultRenameError ? (
            <p className="orbital-draft-error orbital-inline-error">{vaultRenameError}</p>
          ) : null}
        </div>
      );
    }

    const displayName = getDisplayVaultName(
      activeLocalVaultItem,
      language,
      activeLocalVaultIndex >= 0 ? activeLocalVaultIndex : undefined
    );
    const isPlaceholder = !hasExplicitDisplayName(activeLocalVaultItem.name);

    return (
      <div className="orbital-inline-title-stack">
        <div className="orbital-inline-title-shell">
          <button
            type="button"
            className={`orbital-inline-title-button ${className} ${isPlaceholder ? "is-placeholder" : ""}`}
            onClick={beginVaultRename}
            title={displayName}
          >
            {displayName}
          </button>
          <button
            type="button"
            className="orbital-inline-title-edit"
            onClick={beginVaultRename}
            aria-label={`${renameLabel}: ${displayName}`}
            title={renameLabel}
          >
            ✎
          </button>
        </div>
        {vaultRenameError ? (
          <p className="orbital-draft-error orbital-inline-error">{vaultRenameError}</p>
        ) : null}
      </div>
    );
  }

  const cycleProject = (direction: -1 | 1) => {
    if (!orbitalData.projects.length) {
      return;
    }

    const baseIndex = activeProjectIndex >= 0 ? activeProjectIndex : 0;
    const nextIndex =
      (baseIndex + direction + orbitalData.projects.length) % orbitalData.projects.length;
    const project = orbitalData.projects[nextIndex];

    if (!project) {
      return;
    }

    setSelectedEntityId(
      isSystemOverview ? getProjectEntityId(project.id) : null
    );
    setActiveProjectId(project.id);
    setInspectorMenu("overview");
    centerOnProject(project.id, 760);
  };
  const coreFlareRotation = (timeMs * 0.0045) % 360;
  const overviewTitle = isVaultOverview
    ? getDisplayVaultName(
        activeLocalVaultItem,
        language,
        activeLocalVaultIndex >= 0 ? activeLocalVaultIndex : undefined
      )
    : getDisplayProjectName(
        currentProject,
        language,
        orbitalData.projects.findIndex((entry) => entry.id === currentProject?.id)
      );
  const overviewKicker = isVaultOverview ? labels.vaultOverview : labels.overview;
  const overviewLinks = isVaultOverview ? vaultOverviewLinks : currentSystemOverviewLinks;
  const openOverviewMenu = (menu: OrbitalOverviewLinkId) => {
    setInspectorHierarchyScope(isVaultOverview ? "vault" : "project");
    openInspectorMenu(menu);
  };
  const handleToggleInspectorHierarchyExpansion = () => {
    if (!hasExpandableInspectorHierarchyItems || normalizedInspectorQuery.length > 0) {
      return;
    }

    const projectIdSet = new Set(activeExpandableProjectIds);
    const folderIdSet = new Set(activeExpandableFolderIds);
    lastInspectorHierarchyAutoScrollKeyRef.current = null;

    if (isInspectorHierarchyFullyExpanded) {
      setIsInspectorHierarchyAutoExpandSuppressed(true);
      setExpandedInspectorProjects((current) => current.filter((projectId) => !projectIdSet.has(projectId)));
      setCollapsedInspectorFolders((current) =>
        Array.from(new Set([...current, ...activeExpandableFolderIds]))
      );
      return;
    }

    setIsInspectorHierarchyAutoExpandSuppressed(false);
    setExpandedInspectorProjects((current) =>
      Array.from(new Set([...current, ...activeExpandableProjectIds]))
    );
    setCollapsedInspectorFolders((current) => current.filter((folderId) => !folderIdSet.has(folderId)));
  };
  const handleOverviewFocusProject = (projectId: string) => {
    setSelectedEntityId(getProjectEntityId(projectId));
    setActiveProjectId(null);
    setInspectorHierarchyScope("vault");
    setActiveFolderFilters([]);
    setActiveNoteFilters([]);
    openInspectorMenu("overview");
    centerOnProject(projectId, 760);
  };
  const handleOverviewOpenProject = (projectId: string) => {
    setActiveProjectId(projectId);
    setSelectedEntityId(getProjectEntityId(projectId));
    setInspectorHierarchyScope("project");
    setActiveFolderFilters([]);
    setActiveNoteFilters([]);
    openInspectorMenu("overview");
    centerOnProject(projectId, 760);
  };
  const handleOverviewMoveProject = (
    draggedProjectId: string,
    targetProjectId: string,
    placement: "before" | "after"
  ) => {
    if (draggedProjectId === targetProjectId) {
      return;
    }

    const reorderedProjects = orbitalData.projects.filter((project) => project.id !== draggedProjectId);
    const targetIndex = reorderedProjects.findIndex((project) => project.id === targetProjectId);

    if (targetIndex < 0) {
      return;
    }

    const previousProject =
      placement === "before"
        ? reorderedProjects[targetIndex - 1] ?? null
        : reorderedProjects[targetIndex] ?? null;
    const nextProject =
      placement === "before"
        ? reorderedProjects[targetIndex] ?? null
        : reorderedProjects[targetIndex + 1] ?? null;
    const [sortOrder] = getDropSortOrders(
      previousProject ? getHierarchySortOrder(previousProject) : null,
      nextProject ? getHierarchySortOrder(nextProject) : null,
      1
    );

    if (typeof sortOrder === "number") {
      onUpdateProjectSortOrder(draggedProjectId, sortOrder);
    }
  };
  const buildOverviewProjectContextTarget = (
    projectId: string
  ): InspectorContextMenuTarget | null => {
    const project = orbitalData.projectById.get(projectId);

    if (!project) {
      return null;
    }

    return {
      kind: "core",
      project,
      label: getDisplayProjectName(
        project,
        language,
        orbitalData.projects.findIndex((entry) => entry.id === project.id)
      ),
      color: project.color || DEFAULT_PROJECT_COLOR
    };
  };
  const handleOverviewProjectContextMenu = (
    projectId: string,
    event: ReactMouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
    const target = buildOverviewProjectContextTarget(projectId);

    if (!target) {
      return;
    }

    setSelectedEntityId(getProjectEntityId(projectId));
    setActiveProjectId(null);
    setInspectorHierarchyScope("vault");
    setActiveFolderFilters([]);
    setActiveNoteFilters([]);
    openInspectorMenu("overview");
    openInspectorContextMenu(
      target,
      "popover",
      {
        x: event.clientX,
        y: event.clientY
      },
      {
        selectTarget: false
      }
    );
  };
  const renderOverviewProjectRenameField = (project: OrbitalOverviewProjectItem) => {
    const target = buildOverviewProjectContextTarget(project.id);

    return target
      ? renderInspectorRenameField(target, "orbital-inspector-overview-project-input")
      : null;
  };
  const handleOverviewBackToVault = () => {
    setSelectedEntityId(null);
    setActiveProjectId(null);
    setInspectorHierarchyScope("vault");
    setActiveFolderFilters([]);
    setActiveNoteFilters([]);
    openInspectorMenu("overview");
    handleCenterSelection();
  };
  const handleOverviewRecentItemSelect = (item: OrbitalOverviewRecentItem) => {
    const projectId = getEntityProjectId(item.entityId, orbitalData);

    selectInspectorEntity(item.entityId, projectId, {
      centerInScene: true,
      preserveProjectContext: isVaultOverview
    });
  };
  const buildOverviewRecentContextTarget = (
    item: OrbitalOverviewRecentItem
  ): InspectorContextMenuTarget | null => {
    if (item.kind === "folder") {
      const folder = orbitalData.folderById.get(item.id);

      if (!folder) {
        return null;
      }

      return {
        kind: "folder",
        folder,
        label: item.title,
        color: item.color,
        canCreateFolder: (orbitalData.folderMeta.get(folder.id)?.depth ?? 0) < 1
      };
    }

    const note = orbitalData.noteById.get(item.id);

    return note ? buildInspectorNoteContextTarget(note) : null;
  };
  const handleOverviewRecentItemOpen = (item: OrbitalOverviewRecentItem) => {
    if (item.kind === "folder") {
      const target = buildOverviewRecentContextTarget(item);

      if (target) {
        goToInspectorTargetLocation(target);
      }

      return;
    }

    const note = orbitalData.noteById.get(item.id);

    if (!note) {
      return;
    }

    closeSelectionHoverPreview();
    onOpenNote(note.id);
  };
  const handleOverviewRecentItemPreview = (item: OrbitalOverviewRecentItem) => {
    if (item.kind === "folder") {
      return;
    }

    openMobileNotePreview(item.id);
  };
  const handleOverviewRecentItemContextMenu = (
    item: OrbitalOverviewRecentItem,
    event: ReactMouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
    const target = buildOverviewRecentContextTarget(item);

    if (!target) {
      return;
    }

    openInspectorContextMenu(target, "popover", {
      x: event.clientX,
      y: event.clientY
    });
  };
  const handleOverviewRecentItemPointerEnter = (
    item: OrbitalOverviewRecentItem,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    if (!canShowHoverPreview) {
      return;
    }

    if (item.kind === "folder") {
      return;
    }

    const note = orbitalData.noteById.get(item.id);

    if (!note) {
      return;
    }

    openSelectionHoverPreview(note.id, event.clientX, event.clientY, "inspector", {
      anchorRect: toHoverPreviewAnchorRect(event.currentTarget.getBoundingClientRect())
    });
  };
  const handleOverviewRecentItemPointerMove = (
    item: OrbitalOverviewRecentItem,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    if (!canShowHoverPreview) {
      return;
    }

    if (item.kind === "folder" || !orbitalData.noteById.has(item.id)) {
      return;
    }

    updateSelectionHoverPreviewCursor(event.clientX, event.clientY, {
      anchorRect: toHoverPreviewAnchorRect(event.currentTarget.getBoundingClientRect())
    });
  };
  const handleOverviewRecentItemPointerLeave = (item: OrbitalOverviewRecentItem) => {
    if (!canShowHoverPreview) {
      return;
    }

    if (item.kind !== "folder") {
      scheduleSelectionHoverPreviewClose();
    }
  };
  const overviewBody = (
    <>
      <OrbitalInspectorOverviewCard
        mode={isVaultOverview ? "vault" : "project"}
        title={overviewTitle}
        titleNode={
          isVaultOverview
            ? renderEditableVaultTitle("orbital-inspector-overview-title-text")
            : renderEditableProjectTitle(
                currentProject,
                labels.title,
                "orbital-inspector-overview-title-text"
              )
        }
        kicker={overviewKicker}
        accentColor={isVaultOverview ? DEFAULT_INTERFACE_ACCENT : currentProject?.color ?? DEFAULT_INTERFACE_ACCENT}
        activeProjectId={currentProjectId}
        activeProjectIndex={activeProjectIndex}
        projectCount={orbitalData.projects.length}
        canNavigateProjects={canNavigateProjects}
        projects={overviewProjectItems}
        links={overviewLinks}
        recentItems={overviewRecentItems}
        lastUpdatedLabel={labels.lastUpdated}
        updatedLabel={overviewUpdatedLabel}
        emptyLabel={labels.empty}
        labels={labels}
        colorButtonRef={overviewColorTriggerRef}
        isColorPanelOpen={isOverviewColorPanelOpen}
        editingProjectId={inspectorRenameState?.kind === "core" ? inspectorRenameState.id : null}
        renderProjectRenameField={renderOverviewProjectRenameField}
        onAddProject={(name) => void handleCreateProject(name)}
        onAddFolder={() => {
          if (!currentProjectId) {
            return;
          }

          beginFolderDraft(null, currentProjectId);
        }}
        onAddNote={() => {
          if (!currentProjectId) {
            return;
          }

          void handleCreateNote(null, currentProjectId);
        }}
        onAddCanvas={() => {
          if (!currentProjectId) {
            return;
          }

          void handleCreateCanvas(null, currentProjectId);
        }}
        onOpenProjectPlan={() => {
          if (!currentProjectId) {
            return;
          }

          onOpenProjectPlan?.(currentProjectId);
          setSurfaceMode("planner");
          setMobileSection("planner");
        }}
        onBackToVault={handleOverviewBackToVault}
        onCycleProject={cycleProject}
        onDeleteProject={() => {
          if (!currentProjectId) {
            return;
          }

          void onDeleteProject(currentProjectId);
        }}
        onOpenLink={openOverviewMenu}
        onFocusProject={handleOverviewFocusProject}
        onOpenProject={handleOverviewOpenProject}
        onMoveProject={handleOverviewMoveProject}
        onProjectContextMenu={handleOverviewProjectContextMenu}
        onSelectRecentItem={handleOverviewRecentItemSelect}
        onOpenRecentItem={handleOverviewRecentItemOpen}
        onRecentContextMenu={handleOverviewRecentItemContextMenu}
        onRecentPointerEnter={handleOverviewRecentItemPointerEnter}
        onRecentPointerMove={handleOverviewRecentItemPointerMove}
        onRecentPointerLeave={handleOverviewRecentItemPointerLeave}
        onRecentPointerCancel={handleOverviewRecentItemPointerLeave}
        isTouchLayout={isAndroidTouchLayout}
        previewLabel={t("orbit.mobilePreviewAction")}
        onPreviewRecentItem={handleOverviewRecentItemPreview}
        onToggleColorPanel={() => {
          if (!currentProjectId) {
            return;
          }

          setIsOverviewColorPanelOpen((current) => !current);
        }}
      />
    </>
  );
  const selectedInspectorContextTarget =
    selectedNode?.kind === "folder" && selectedNode.folder
      ? ({
          kind: "folder",
          folder: selectedNode.folder,
          label: selectedNode.label,
          color: selectedNode.folder.color || DEFAULT_FOLDER_COLOR,
          canCreateFolder: (selectedFolderMeta?.depth ?? 0) < 1
        } satisfies InspectorContextMenuTarget)
      : selectedNode?.kind === "note" && selectedNode.note
        ? buildInspectorNoteContextTarget(selectedNode.note)
        : null;
  const mobileSelectedContextTarget = buildSceneNodeContextTarget(selectedNode) ?? selectedInspectorContextTarget;
  const mobileSelectedTitle = selectedNode?.label ?? t("orbit.mobileNothingSelected");
  const mobileSelectedKindLabel =
    selectedNode?.kind === "core"
      ? labels.system
      : selectedNode?.kind === "folder"
        ? labels.folder
        : selectedNode?.note?.contentType === "canvas"
          ? labels.canvas
          : selectedNode?.kind === "note"
            ? labels.note
            : labels.vaultOverview;
  const mobileSelectedCount =
    activeFolderFilterSet.size + activeNoteFilterSet.size + activeAssetFilterSet.size;
  const mobileMoveDestinationKindLabel =
    mobileMoveDestination?.kind === "project"
      ? labels.project
      : mobileMoveDestination?.kind === "folder"
        ? labels.folder
        : null;
  const shouldShowMobileInspectorActionBar =
    isAndroidMobileShell &&
    !editorOpen &&
    !activeModal &&
    !contextMenuState &&
    !mobileMoveConflictState &&
    !hoverPreviewNote &&
    !hoverPreviewAsset &&
    mobileSection !== "map" &&
    mobileSection !== "planner" &&
    effectiveInspectorMenu !== "overview" &&
    (mobileMoveItems.length > 0 ||
      isMobileSelectionMode ||
      Boolean(selectedNode) ||
      mobileSelectedCount > 0);
  const mobileInspectorActionAccent =
    mobileMoveDestination?.color ?? selectedNode?.color ?? inspectorContextAccent;
  const mobileInspectorSummaryKicker =
    mobileSelectedCount > 1
      ? t("orbit.mobileSelect")
      : mobileSelectedKindLabel;
  const mobileInspectorSummaryTitle =
    mobileSelectedCount > 1
      ? t("orbit.selectedCount", { count: mobileSelectedCount })
      : mobileSelectedTitle;

  const renderMobileInspectorActionBar = () => {
    if (!shouldShowMobileInspectorActionBar) {
      return null;
    }

    return (
      <section
        className={`orbital-mobile-inspector-actions ${
          mobileMoveItems.length > 0 ? "is-move-mode" : ""
        } ${isMobileSelectionMode ? "is-select-mode" : ""}`}
        style={{ "--mobile-inspector-accent": mobileInspectorActionAccent } as CSSProperties}
        aria-label={t("orbit.mobileActions")}
      >
        {mobileMoveItems.length > 0 ? (
          <div className="orbital-mobile-move-panel">
            <div className="orbital-mobile-move-copy">
              <span className="orbital-mobile-inspector-status">
                {t("orbit.mobileMoveActive", { count: mobileMoveItems.length })}
              </span>
              <strong>{t("orbit.mobileMoveTitle")}</strong>
              <small>{t("orbit.mobileMovePickDestination")}</small>
            </div>
            <div
              className={`orbital-mobile-move-destination ${
                mobileMoveDestination?.issue ? "is-invalid" : ""
              }`}
              style={
                mobileMoveDestination
                  ? ({ "--mobile-move-accent": mobileMoveDestination.color } as CSSProperties)
                  : undefined
              }
            >
              <span>{t("orbit.mobileMoveDestination")}</span>
              <strong>
                {mobileMoveDestination
                  ? `${mobileMoveDestination.label} · ${mobileMoveDestinationKindLabel ?? ""}`
                  : t("orbit.mobileMoveNoDestination")}
              </strong>
              {mobileMoveDestination?.issue ? <small>{mobileMoveDestination.issue}</small> : null}
            </div>
            <div className="orbital-mobile-move-actions">
              <button type="button" onClick={cancelMobileMoveSelection}>
                {labels.cancel}
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={!mobileMoveDestination || Boolean(mobileMoveDestination.issue)}
                onClick={() => {
                  if (!mobileMoveDestination) {
                    return;
                  }

                  void performMobileMove(mobileMoveDestination);
                }}
              >
                {t("orbit.mobileMoveConfirm")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="orbital-mobile-inspector-summary">
              <span>{mobileInspectorSummaryKicker}</span>
              <strong>{mobileInspectorSummaryTitle}</strong>
            </div>
            <div className="orbital-mobile-inspector-actionstrip">
              {selectedNode?.note ? (
                <button
                  type="button"
                  className="is-primary"
                  onClick={openSelectedMobileEntry}
                  aria-label={selectedNode.note.contentType === "canvas" ? labels.openCanvas : labels.openNote}
                  title={selectedNode.note.contentType === "canvas" ? labels.openCanvas : labels.openNote}
                >
                  <span className="orbital-mobile-inspector-action-icon">
                    {renderMobileOpenGlyph()}
                  </span>
                  <small>
                    {selectedNode.note.contentType === "canvas" ? labels.openCanvas : labels.openNote}
                  </small>
                </button>
              ) : null}
              {selectedNode?.note ? (
                <button
                  type="button"
                  onClick={() => openMobileNotePreview(selectedNode.note!.id)}
                  aria-label={t("orbit.mobilePreviewAction")}
                  title={t("orbit.mobilePreviewAction")}
                >
                  <span className="orbital-mobile-inspector-action-icon">
                    {renderMobileActionGlyph("preview")}
                  </span>
                  <small>{t("orbit.mobilePreviewAction")}</small>
                </button>
              ) : null}
              {mobileSelectedContextTarget ? (
                <button
                  type="button"
                  onClick={() => openInspectorContextMenu(mobileSelectedContextTarget, "sheet", null)}
                  aria-label={t("orbit.mobileActions")}
                  title={t("orbit.mobileActions")}
                >
                  <span className="orbital-mobile-inspector-action-icon">
                    {renderMobileActionGlyph("more")}
                  </span>
                  <small>{t("orbit.mobileActions")}</small>
                </button>
              ) : null}
            </div>
          </>
        )}
      </section>
    );
  };
  const inspectorMenuBody =
    effectiveInspectorMenu === "overview" ? null : (
      <>
        <OrbitalInspectorSubviewHeader
          title={inspectorMenuTitle}
          count={inspectorMenuCount}
          accentColor={inspectorContextAccent}
          backLabel={labels.back}
          searchLabel={labels.searchPlaceholder}
          searchPlaceholder={labels.searchPlaceholder}
          query={inspectorQuery}
          onBack={handleInspectorBack}
          onQueryChange={setInspectorQuery}
          hierarchyToggle={
            effectiveInspectorMenu === "folders"
              ? {
                  label: isInspectorHierarchyFullyExpanded
                    ? labels.collapseHierarchy
                    : labels.expandHierarchy,
                  expanded: isInspectorHierarchyFullyExpanded,
                  disabled:
                    !hasExpandableInspectorHierarchyItems ||
                    normalizedInspectorQuery.length > 0,
                  onToggle: handleToggleInspectorHierarchyExpansion
                }
              : null
          }
          quickActions={
            showInspectorHierarchyQuickActions
              ? {
                  folder: {
                    label: inspectorFolderActionTitle,
                    disabled: !inspectorQuickCreateTargets.folder,
                    onClick: () => {
                      if (!inspectorQuickCreateTargets.folder) {
                        return;
                      }

                      beginFolderDraft(
                        inspectorQuickCreateTargets.folder.parentId,
                        inspectorQuickCreateTargets.folder.projectId
                      );
                    }
                  },
                  note: {
                    label: labels.addNote,
                    disabled: !inspectorQuickCreateTargets.note,
                    onClick: () => {
                      if (!inspectorQuickCreateTargets.note) {
                        return;
                      }

                      void handleCreateNote(
                        inspectorQuickCreateTargets.note.folderId,
                        inspectorQuickCreateTargets.note.projectId
                      );
                    }
                  },
                  canvas: {
                    label: labels.addCanvas,
                    disabled: !inspectorQuickCreateTargets.canvas,
                    onClick: () => {
                      if (!inspectorQuickCreateTargets.canvas) {
                        return;
                      }

                      void handleCreateCanvas(
                        inspectorQuickCreateTargets.canvas.folderId,
                        inspectorQuickCreateTargets.canvas.projectId
                      );
                    }
                  }
                }
              : null
          }
          scopeSwitch={
            showInspectorScopeSwitch
              ? {
                  value:
                    isAndroidMobileShell && effectiveInspectorMenu === "notes"
                      ? "documents"
                      : isVaultInspectorScope
                        ? "vault"
                        : "project",
                  label: labels.vaultStructure,
                  vaultLabel: labels.hierarchyScopeVault,
                  projectLabel: labels.hierarchyScopeProject,
                  documentsLabel:
                    isAndroidMobileShell &&
                    (effectiveInspectorMenu === "folders" || effectiveInspectorMenu === "notes")
                      ? labels.documentsMenu
                      : undefined,
                  projectDisabled: !inspectorScopeProjectId,
                  onChange: handleInspectorNavigationScopeChange
                }
              : null
          }
          documentFilters={
            effectiveInspectorMenu === "notes"
              ? {
                  note: {
                    label: labels.note,
                    count: inspectorDocumentTypeCounts.note,
                    active: activeInspectorDocumentKindSet.has("note"),
                    onToggle: () => toggleInspectorDocumentKind("note")
                  },
                  canvas: {
                    label: labels.canvas,
                    count: inspectorDocumentTypeCounts.canvas,
                    active: activeInspectorDocumentKindSet.has("canvas"),
                    onToggle: () => toggleInspectorDocumentKind("canvas")
                  }
                }
              : null
          }
        />

        {renderFolderDraftErrorMessage()}

        <div
          ref={effectiveInspectorMenu === "folders" ? inspectorMenuListRef : null}
          className={`orbital-menu-list ${effectiveInspectorMenu === "folders" ? "is-tree" : "is-compact"}`}
          role={effectiveInspectorMenu === "folders" ? "tree" : undefined}
        >
          {effectiveInspectorMenu === "notes"
            ? filteredNotesMenu.map((note) => (
                <div key={note.id}>
                  {renderInspectorCompactRow({
                    isActive: activeNoteFilterSet.has(note.id) || selectedEntityId === `note:${note.id}`,
                    onClick: () => {
                      selectInspectorEntity(`note:${note.id}`, note.projectId, {
                        centerInScene: true,
                        preserveProjectContext: true
                      });
                      setHierarchyFocusedEntityId(`note:${note.id}`);
                    },
                    onDoubleClick: () => {
                      closeSelectionHoverPreview();
                      onOpenNote(note.id);
                    },
                    onPointerEnter: !canShowHoverPreview
                      ? undefined
                      : (event) => {
                          openSelectionHoverPreview(
                            note.id,
                            event.clientX,
                            event.clientY,
                            "inspector",
                            {
                              anchorRect: toHoverPreviewAnchorRect(event.currentTarget.getBoundingClientRect())
                            }
                          );
                        },
                    onPointerMove: !canShowHoverPreview
                      ? undefined
                      : (event) => {
                          updateSelectionHoverPreviewCursor(event.clientX, event.clientY, {
                            anchorRect: toHoverPreviewAnchorRect(event.currentTarget.getBoundingClientRect())
                          });
                        },
                    onPointerLeave: !canShowHoverPreview ? undefined : scheduleSelectionHoverPreviewClose,
                    onPointerCancel: !canShowHoverPreview ? undefined : scheduleSelectionHoverPreviewClose,
                    title: getNoteInspectorTitle(note),
                    kindLabel: note.contentType === "canvas" ? labels.canvas : labels.note,
                    contextMenuTarget: buildInspectorNoteContextTarget(note),
                    onPreview: () => openMobileNotePreview(note.id),
                    previewLabel: t("orbit.mobilePreviewAction"),
                    openLabel: note.contentType === "canvas" ? labels.openCanvas : labels.openNote,
                    icon: renderInspectorItemIcon(
                      note.contentType === "canvas" ? "canvas" : "note",
                      note.color || DEFAULT_NOTE_COLOR
                    )
                  })}
                </div>
              ))
            : null}

          {effectiveInspectorMenu === "pinned"
            ? filteredPinnedMenu.map((note) => (
                <div key={note.id}>
                  {renderInspectorCompactRow({
                    isActive: activeNoteFilterSet.has(note.id) || selectedEntityId === `note:${note.id}`,
                    onClick: () => {
                      selectInspectorEntity(`note:${note.id}`, note.projectId, {
                        centerInScene: true,
                        preserveProjectContext: true
                      });

                      if (isMobilePreviewMode && !isAndroidTouchLayout) {
                        onOpenNote(note.id);
                        return;
                      }

                      setHierarchyFocusedEntityId(`note:${note.id}`);
                    },
                    onDoubleClick: isMobilePreviewMode && !isAndroidTouchLayout
                      ? undefined
                      : () => {
                          closeSelectionHoverPreview();
                          onOpenNote(note.id);
                        },
                    onPointerEnter: !canShowHoverPreview
                      ? undefined
                      : (event) => {
                          openSelectionHoverPreview(
                            note.id,
                            event.clientX,
                            event.clientY,
                            "inspector",
                            {
                              anchorRect: toHoverPreviewAnchorRect(event.currentTarget.getBoundingClientRect())
                            }
                          );
                        },
                    onPointerMove: !canShowHoverPreview
                      ? undefined
                      : (event) => {
                          updateSelectionHoverPreviewCursor(event.clientX, event.clientY, {
                            anchorRect: toHoverPreviewAnchorRect(event.currentTarget.getBoundingClientRect())
                          });
                        },
                    onPointerLeave: !canShowHoverPreview ? undefined : scheduleSelectionHoverPreviewClose,
                    onPointerCancel: !canShowHoverPreview ? undefined : scheduleSelectionHoverPreviewClose,
                    title: getNoteInspectorTitle(note),
                    kindLabel: note.contentType === "canvas" ? labels.canvas : labels.note,
                    contextMenuTarget: buildInspectorNoteContextTarget(note),
                    onPreview: () => openMobileNotePreview(note.id),
                    previewLabel: t("orbit.mobilePreviewAction"),
                    openLabel: note.contentType === "canvas" ? labels.openCanvas : labels.openNote,
                    icon: renderInspectorItemIcon(
                      note.contentType === "canvas" ? "canvas" : "note",
                      note.color || DEFAULT_NOTE_COLOR
                    )
                  })}
                </div>
              ))
            : null}

          {effectiveInspectorMenu === "tags"
            ? filteredTagsMenu.map((tag) => (
                <div key={tag.id}>
                  {renderInspectorCompactRow({
                    isActive: activeTagFilterSet.has(normalizeTagLookup(tag.name)),
                    onClick: () => toggleTagFilter(normalizeTagLookup(tag.name)),
                    title: tag.name,
                    kindLabel: labels.tagsMenu,
                    count: inspectorTagCounts.get(normalizeTagLookup(tag.name)) ?? 0,
                    icon: renderInspectorItemIcon("tag", inspectorContextAccent)
                  })}
                </div>
              ))
            : null}

          {effectiveInspectorMenu === "files"
            ? filteredFilesMenu.map((asset) => (
                <div key={asset.id}>
                  {renderInspectorCompactRow({
                    isActive: activeAssetFilterSet.has(asset.id),
                    onClick: () => {
                      const note = orbitalData.noteById.get(asset.noteId);

                      if (!note) {
                        return;
                      }

                      selectInspectorEntity(`note:${note.id}`, note.projectId, {
                        centerInScene: true,
                        preserveProjectContext: true
                      });
                      setActiveAssetFilters([asset.id]);
                      setHierarchyFocusedEntityId(`note:${note.id}`);
                    },
                    onDoubleClick: () => {
                      closeSelectionHoverPreview();
                      onOpenNote(asset.noteId);
                    },
                    onPointerEnter: !canShowHoverPreview
                      ? undefined
                      : (event) => {
                          openAssetHoverPreview(
                            asset.id,
                            event.clientX,
                            event.clientY,
                            "inspector",
                            {
                              anchorRect: toHoverPreviewAnchorRect(event.currentTarget.getBoundingClientRect())
                            }
                          );
                        },
                    onPointerMove: !canShowHoverPreview
                      ? undefined
                      : (event) => {
                          updateSelectionHoverPreviewCursor(event.clientX, event.clientY, {
                            anchorRect: toHoverPreviewAnchorRect(event.currentTarget.getBoundingClientRect())
                          });
                        },
                    onPointerLeave: !canShowHoverPreview ? undefined : scheduleSelectionHoverPreviewClose,
                    onPointerCancel: !canShowHoverPreview ? undefined : scheduleSelectionHoverPreviewClose,
                    title: assetDisplayNamesById.get(asset.id) ?? getAssetDisplayName(asset),
                    meta: orbitalData.noteById.get(asset.noteId)?.title ?? null,
                    onPreview: () => openMobileAssetPreview(asset.id),
                    previewLabel: t("orbit.mobilePreviewAction"),
                    openLabel: labels.openNote,
                    icon: renderInspectorItemIcon(
                      "file",
                      orbitalData.noteById.get(asset.noteId)?.color || DEFAULT_NOTE_COLOR
                    )
                  })}
                </div>
              ))
            : null}

          {effectiveInspectorMenu === "folders"
            ? filteredFoldersMenu.map((item) => renderInspectorHierarchyNode(item))
            : null}

          {effectiveInspectorMenu === "colors"
            ? filteredColorsMenu.map((entry) => (
                <div key={entry.id}>
                  {renderInspectorCompactRow({
                    isActive: activeColorFilterSet.has(entry.hex),
                    onClick: () => toggleColorFilter(entry.hex),
                    title: entry.label,
                    meta: entry.hex.toUpperCase(),
                    count: entry.count,
                    icon: renderInspectorItemIcon("color", entry.hex)
                  })}
                </div>
              ))
            : null}

          {((effectiveInspectorMenu === "notes" && filteredNotesMenu.length === 0) ||
            (effectiveInspectorMenu === "pinned" && filteredPinnedMenu.length === 0) ||
            (effectiveInspectorMenu === "tags" && filteredTagsMenu.length === 0) ||
            (effectiveInspectorMenu === "files" && filteredFilesMenu.length === 0) ||
            (effectiveInspectorMenu === "folders" && filteredFoldersMenu.length === 0) ||
            (effectiveInspectorMenu === "colors" && filteredColorsMenu.length === 0)) ? (
            <div className="empty-card orbital-menu-empty">
              <strong>{labels.empty}</strong>
            </div>
          ) : null}
        </div>
      </>
    );
  const contextMenuTarget = contextMenuState?.target ?? null;
  const contextMenuOperationTargets = contextMenuTarget
    ? getContextOperationTargets(contextMenuTarget)
    : [];
  const contextMenuTitle =
    contextMenuOperationTargets.length > 1
      ? t("orbit.selectedCount", { count: contextMenuOperationTargets.length })
      : contextMenuTarget?.label ?? "";
  const contextMenuKindLabel = !contextMenuTarget
    ? ""
    : contextMenuTarget.kind === "core"
      ? labels.system
      : contextMenuTarget.kind === "folder"
      ? labels.folder
      : contextMenuTarget.kind === "canvas"
        ? labels.canvas
        : labels.note;
  const handleContextMenuColorChange = contextMenuTarget
    ? (color: string) => {
        if (contextMenuTarget.kind === "core") {
          onUpdateProjectColor(contextMenuTarget.project.id, color);
          return;
        }

        if (contextMenuTarget.kind === "folder") {
          onUpdateFolderColor(contextMenuTarget.folder.id, color);
          return;
        }

        onUpdateNoteColor(contextMenuTarget.note.id, color);
      }
    : undefined;
  const androidBackLayer = mobileMoveConflictState
    ? "mobile-move-conflict"
    : isAndroidTouchLayout && (hoverPreviewNote || hoverPreviewAsset)
      ? "mobile-preview"
      : mobileMoveItems.length > 0
        ? "mobile-move"
        : contextMenuState
    ? "context-menu"
    : isOverviewColorPanelOpen
      ? "color-panel"
      : isMobileAccountOpen
        ? "mobile-account"
      : isMobileMenuOpen
        ? "mobile-menu"
        : activeModal
          ? "utility-modal"
          : editorOpen
            ? "editor"
            : isAndroidMobileShell && selectedEntityId
              ? "map-selection"
              : isAndroidMobileShell && mobileSection !== "vault"
                ? "mobile-section"
                : null;

  useAndroidBackHandler(Boolean(androidBackLayer), () => {
    if (androidBackLayer === "mobile-move-conflict") {
      setMobileMoveConflictState(null);
      return;
    }

    if (androidBackLayer === "mobile-preview") {
      closeSelectionHoverPreview();
      return;
    }

    if (androidBackLayer === "mobile-move") {
      cancelMobileMoveSelection();
      return;
    }

    if (androidBackLayer === "context-menu") {
      closeInspectorContextMenu();
      return;
    }

    if (androidBackLayer === "color-panel") {
      setIsOverviewColorPanelOpen(false);
      return;
    }

    if (androidBackLayer === "mobile-account") {
      setIsMobileAccountOpen(false);
      return;
    }

    if (androidBackLayer === "mobile-menu") {
      setIsMobileMenuOpen(false);
      return;
    }

    if (androidBackLayer === "utility-modal") {
      closeUtilityModal();
      return;
    }

    if (androidBackLayer === "editor") {
      onCloseEditor();
      return;
    }

    if (androidBackLayer === "map-selection") {
      setSelectedEntityId(null);
      return;
    }

    if (androidBackLayer === "mobile-section") {
      setMobileSection("vault");
      return;
    }

    onClose();
  });

  function renderFolderDraftErrorMessage() {
    if (isFolderDraftOpen || !folderDraftError) {
      return null;
    }

    return <p className="orbital-draft-error orbital-inline-error">{folderDraftError}</p>;
  }

  return (
    <section
      className={`orbital-overlay ${isAndroidLayout ? "is-android-runtime" : ""} ${
        isAndroidMobileShell ? "is-android-mobile-shell" : ""
      } ${isAndroidPhoneShell ? "is-android-phone-shell" : ""} ${
        isAndroidTabletPortraitShell ? "is-android-tablet-portrait-shell" : ""
      } ${isAndroidTabletLandscapeShell ? "is-android-tablet-landscape-shell" : ""} ${
        isAndroidMobileShell ? `is-mobile-section-${mobileSection}` : ""
      } ${!isOrbitalMotionEnabled || isPaused ? "is-orbital-motion-reduced" : ""} ${
        isMobileMenuOpen ? "is-mobile-menu-open" : ""
      } ${
        isMobileAccountOpen ? "is-mobile-account-open" : ""
      } ${isPlannerSurfaceVisible ? "is-planner-mode" : ""} ${
        surfaceMode === "planner" ? "is-desktop-planner-mode" : "is-desktop-map-mode"
      } ${
        mobileMoveItems.length > 0 ? "is-mobile-move-mode" : ""
      } ${isMobileSelectionMode ? "is-mobile-select-mode" : ""} ${
        shouldShowMobileInspectorActionBar ? "has-mobile-inspector-actionbar" : ""
      }`}
      role="dialog"
      aria-modal="true"
      onPointerDown={markOrbitInteraction}
      onWheel={markOrbitInteraction}
    >
      <div className="orbital-backdrop" aria-hidden="true" />

      {isAndroidMobileShell && isMobileMenuOpen ? (
        <div className="orbital-mobile-menu-layer">
          <button
            type="button"
            className="orbital-mobile-menu-backdrop"
            aria-label={labels.cancel}
            onClick={() => setIsMobileMenuOpen(false)}
          />
          <OrbitalMobileMoreSheet
            localVaultLabel={labels.localVault}
            activeLabel={t("sync.localVaultActive")}
            trashLabel={labels.trash}
            activeVaultId={activeLocalVaultId}
            activeVaultItem={activeLocalVaultItem}
            activeVaultDisplayName={
              activeLocalVaultItem
                ? getDisplayVaultName(
                    activeLocalVaultItem,
                    language,
                    activeLocalVaultIndex >= 0 ? activeLocalVaultIndex : undefined
                  )
                : labels.localVault
            }
            localVaultOptions={localVaultOptions}
            getVaultDisplayName={(item, index) => getDisplayVaultName(item, language, index)}
            syncStatusChip={syncStatusChip}
            syncTransportChip={syncTransportChip}
            trashCount={trashedNoteCount}
            hasTrash={Boolean(trashModalSlot)}
            onSelectLocalVault={onSelectLocalVault}
            onCreateLocalVault={onCreateLocalVault}
            onOpenTrash={() => {
              setIsMobileMenuOpen(false);
              setSettingsPanelOpenRequest(null);
              setActiveModal("trash");
            }}
            onClose={() => setIsMobileMenuOpen(false)}
          />
        </div>
      ) : null}

      {isAndroidMobileShell && isMobileAccountOpen ? (
        <div className="orbital-mobile-menu-layer orbital-mobile-account-layer">
          <button
            type="button"
            className="orbital-mobile-menu-backdrop"
            aria-label={labels.cancel}
            onClick={() => setIsMobileAccountOpen(false)}
          />
          <OrbitalMobileAccountSheet
            status={webAccessStatus}
            onOpenAccount={onOpenWebAccess}
            onExportVault={onExportWebVault}
            onClose={() => setIsMobileAccountOpen(false)}
          />
        </div>
      ) : null}

      <OrbitalCommandBar
        labels={labels}
        surfaceMode={surfaceMode}
        plannerAvailable={Boolean(plannerSlot)}
        activeVaultLabel={t("sync.localVaultActive")}
        localVaultOptions={localVaultOptions}
        activeLocalVaultId={activeLocalVaultId}
        autoFocusEnabled={autoFocusEnabled}
        sceneFocusActive={isSceneFocusActive}
        syncStatusChip={syncStatusChip}
        syncTransportChip={syncTransportChip}
        webAccessChip={webAccessStatus}
        updateChip={updateChip}
        hasTrash={Boolean(trashModalSlot)}
        hasSettings={Boolean(settingsModalSlot)}
        showClose={Boolean(showClose)}
        onSurfaceModeChange={setSurfaceMode}
        onSelectLocalVault={onSelectLocalVault}
        onCreateLocalVault={onCreateLocalVault}
        onOpenTrash={() => {
          setSettingsPanelOpenRequest(null);
          setActiveModal("trash");
        }}
        onOpenSettings={() => {
          setSettingsPanelOpenRequest(null);
          setActiveModal("settings");
        }}
        onOpenWebAccess={onOpenWebAccess}
        onClose={onClose}
      />

      {plannerSlot ? (
        <div
          className={`orbital-planner-slot ${isPlannerSurfaceVisible ? "is-active" : ""}`}
          aria-hidden={!isPlannerSurfaceVisible}
        >
          {plannerSlot}
        </div>
      ) : null}

      <div className="orbital-layout" aria-hidden={!isMapSurfaceVisible}>
        <aside className="orbital-inspector panel" ref={inspectorPanelRef}>
          {effectiveInspectorMenu === "overview" ? (
            overviewBody
          ) : !selectedNode ||
            selectedNode.kind === "core" ||
            shouldShowHierarchyInspector ||
            effectiveInspectorMenu === "notes" ||
            effectiveInspectorMenu === "tags" ||
            effectiveInspectorMenu === "files" ||
            effectiveInspectorMenu === "pinned" ||
            effectiveInspectorMenu === "colors" ? (
            inspectorMenuBody
          ) : (
            <>
              <section
                className={`orbital-selection-shell orbital-selection-shell-${selectedNode.kind} ${
                  selectedEntryIsCanvas ? "is-canvas" : ""
                }`}
                style={{ "--selection-accent": selectedInspectorAccent } as CSSProperties}
                onContextMenu={
                  selectedInspectorContextTarget
                    ? (event) => {
                        event.preventDefault();
                            openInspectorContextMenu(selectedInspectorContextTarget, "popover", {
                              x: event.clientX,
                              y: event.clientY
                            });
                          }
                        : undefined
                    }
                    onPointerDown={
                      selectedInspectorContextTarget
                        ? (event) => {
                            handleInspectorContextPointerDown(selectedInspectorContextTarget, event);
                          }
                        : undefined
                    }
                    onPointerMove={
                      selectedInspectorContextTarget
                        ? (event) => {
                            handleInspectorContextPointerMove(event);
                          }
                        : undefined
                    }
                    onPointerUp={
                      selectedInspectorContextTarget
                        ? (event) => {
                            handleInspectorContextPointerEnd(event.pointerId);
                          }
                        : undefined
                    }
                    onPointerLeave={
                      selectedInspectorContextTarget
                        ? (event) => {
                            handleInspectorContextPointerEnd(event.pointerId);
                          }
                        : undefined
                    }
                    onPointerCancel={
                      selectedInspectorContextTarget
                        ? (event) => {
                            handleInspectorContextPointerEnd(event.pointerId);
                          }
                        : undefined
                    }
                    onDoubleClick={
                      selectedNode.kind === "note"
                        ? () => {
                            closeSelectionHoverPreview();
                            onOpenNote(selectedNode.note!.id);
                          }
                        : undefined
                    }
                  >
                    <div className="orbital-selection-head">
                      <div className="orbital-selection-eyebrow-row">
                        <span className="orbital-selection-kindchip">
                          {selectedNode.kind === "folder"
                            ? labels.folder
                            : selectedEntryIsCanvas
                              ? labels.canvas
                              : labels.note}
                        </span>
                        {selectedNode.kind === "folder" ? (
                          <span className="orbital-selection-systemchip">{focusSystemLabel}</span>
                        ) : null}
                      </div>
                      {selectedInspectorContextTarget &&
                      isEditingInspectorTarget(selectedInspectorContextTarget) ? (
                        renderInspectorRenameField(
                          selectedInspectorContextTarget,
                          "orbital-menu-inline-input orbital-selection-title-input"
                        )
                      ) : (
                        <h2 className="orbital-selection-title">{selectedNode.label}</h2>
                      )}
                      <div className="orbital-selection-context-row">
                        {selectedNode.kind === "folder" ? (
                          <span className="orbital-path-chip orbital-path-chip-soft">
                            {selectedFolderLocation}
                          </span>
                        ) : (
                          <span className="orbital-selection-context-text">{selectedNoteFolder}</span>
                        )}
                        {selectedNode.kind === "note" && selectedNode.note ? (
                          <span className="orbital-selection-updated">
                            {labels.updated}: {formatTimestamp(selectedNode.note.updatedAt)}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {selectedNode.kind === "note" && selectedNode.note && canShowHoverPreview ? (
                      <>
                        <div className="orbital-selection-preview orbital-selection-preview-note-shell">
                          {renderEntryPreviewActions(selectedNode.note, {
                            className: "orbital-selection-preview-actions"
                          })}
                          <div className="orbital-selection-preview-note">
                            <EntryStaticPreview
                              note={selectedNode.note}
                              emptyLabel={labels.empty}
                              resolveFileUrl={onResolveFileUrl}
                              compact
                              interactive={false}
                              labels={{
                                canvas: labels.canvas,
                                elements: labels.elementsStat,
                                images: labels.assetsStat,
                                emptyCanvas: labels.emptyCanvas,
                                previewHint: labels.canvasPreviewHint
                              }}
                            />
                          </div>
                        </div>
                        <div className="orbital-selection-meta-line">
                          {selectedEntryIsCanvas && selectedCanvasMetrics ? (
                            <span className="orbital-selection-meta-chip">
                              {selectedCanvasMetrics.activeElementCount} {labels.elementsStat}
                            </span>
                          ) : null}
                          {isEntryFavorite(selectedNode.note) ? (
                            <span className="orbital-selection-badge">{t("note.pinnedActive")}</span>
                          ) : null}
                          {selectedEntryIsCanvas && selectedCanvasMetrics && selectedCanvasMetrics.imageCount > 0 ? (
                            <span className="orbital-selection-meta-chip">
                              {selectedCanvasMetrics.imageCount} {labels.assetsStat}
                            </span>
                          ) : null}
                          {selectedNoteAssetCount > 0 && !selectedEntryIsCanvas ? (
                            <span className="orbital-selection-meta-chip">
                              {selectedNoteAssetCount} {labels.assetsStat}
                            </span>
                          ) : null}
                        </div>
                        {selectedNoteVisibleTags.length > 0 ? (
                          <div className="orbital-selection-tags">
                            {selectedNoteVisibleTags.map((tagName) => (
                              <span className="orbital-selection-tag" key={tagName}>
                                {tagName}
                              </span>
                            ))}
                            {selectedNoteHiddenTagCount > 0 ? (
                              <span className="orbital-selection-tag">+{selectedNoteHiddenTagCount}</span>
                            ) : null}
                          </div>
                        ) : null}
                      </>
                    ) : null}

                    {selectedNode.kind === "folder" && selectedFolderMeta ? (
                      <div className="orbital-selection-stats">
                        <div className="orbital-selection-stat">
                          <strong>{selectedFolderMeta.directNoteCount}</strong>
                          <span>{labels.directNotes}</span>
                        </div>
                        <div className="orbital-selection-stat">
                          <strong>{selectedFolderMeta.descendantFolderCount}</strong>
                          <span>{labels.subfolders}</span>
                        </div>
                        <div className="orbital-selection-stat">
                          <strong>{selectedFolderMeta.descendantNoteCount}</strong>
                          <span>{labels.descendants}</span>
                        </div>
                      </div>
                    ) : null}
                  </section>

                  <div
                    className={`orbital-meta-card orbital-selection-tools ${
                      selectedNode.kind === "note" ? "is-note" : ""
                    }`}
                  >
                    <div className="orbital-color-field orbital-color-field-tight">
                      <span className="orbital-color-label">
                        {selectedNode.kind === "folder" ? labels.folderColor : labels.noteColor}
                      </span>
                      <div className="color-swatch-grid compact">
                        {COLOR_PALETTE.map((colorOption) => (
                          <button
                            key={colorOption.id}
                            type="button"
                            className={`color-swatch compact ${
                              (selectedNode.kind === "folder"
                                ? selectedNode.folder?.color
                                : selectedNode.note?.color) === colorOption.hex
                                ? "is-active"
                                : ""
                            }`}
                            onClick={() =>
                              selectedNode.kind === "folder"
                                ? onUpdateFolderColor(selectedNode.folder!.id, colorOption.hex)
                                : onUpdateNoteColor(selectedNode.note!.id, colorOption.hex)
                            }
                            style={{ "--swatch-color": colorOption.hex } as CSSProperties}
                            aria-label={`${
                              selectedNode.kind === "folder" ? labels.folderColor : labels.noteColor
                            }: ${t(colorOption.labelKey)}`}
                            title={t(colorOption.labelKey)}
                          >
                            <span className="color-swatch-fill" />
                          </button>
                        ))}
                      </div>
                      <label className="orbital-custom-color-picker">
                        <span className="orbital-color-label">{labels.customColor}</span>
                        <span className="orbital-custom-color-control">
                          <input
                            type="color"
                            className="orbital-custom-color-input"
                            value={
                              selectedNode.kind === "folder"
                                ? selectedNode.folder?.color ?? DEFAULT_FOLDER_COLOR
                                : selectedNode.note?.color ?? DEFAULT_NOTE_COLOR
                            }
                            onChange={(event) =>
                              selectedNode.kind === "folder"
                                ? onUpdateFolderColor(selectedNode.folder!.id, event.target.value)
                                : onUpdateNoteColor(selectedNode.note!.id, event.target.value)
                            }
                            aria-label={labels.customColor}
                          />
                          <span className="orbital-custom-color-value">
                            {(
                              selectedNode.kind === "folder"
                                ? selectedNode.folder?.color ?? DEFAULT_FOLDER_COLOR
                                : selectedNode.note?.color ?? DEFAULT_NOTE_COLOR
                            ).toUpperCase()}
                          </span>
                        </span>
                      </label>
                    </div>
                  </div>

                  <div className="orbital-danger-actions">
                    {selectedNode.kind === "folder" && selectedNode.folder ? (
                      <button
                        className="toolbar-action danger"
                        onClick={() => void onDeleteFolder(selectedNode.folder!.id)}
                      >
                        {labels.deleteFolder}
                      </button>
                    ) : null}
                    {selectedNode.kind === "note" && selectedNode.note ? (
                      null
                    ) : null}
                  </div>

              <div className="orbital-action-stack orbital-action-stack-compact">
                {selectedNode.kind === "folder" ? (
                  <>
                    {(selectedFolderMeta?.depth ?? 0) < 1 ? (
                      <button
                        className="primary-action"
                        onClick={() =>
                          beginFolderDraft(
                            selectedNode.folder!.id,
                            selectedNode.folder?.projectId
                          )
                        }
                      >
                        {labels.addChildFolder}
                      </button>
                    ) : null}
                    <button
                      className="toolbar-action"
                      onClick={() =>
                        void handleCreateNote(
                          selectedNode.folder!.id,
                          selectedNode.folder?.projectId
                        )
                      }
                    >
                      {labels.addNote}
                    </button>
                    <button
                      className="toolbar-action"
                      onClick={() =>
                        void handleCreateCanvas(
                          selectedNode.folder!.id,
                          selectedNode.folder?.projectId
                        )
                      }
                    >
                      {labels.addCanvas}
                    </button>
                  </>
                ) : null}
              </div>

              <p className="orbital-hints">{labels.hints}</p>
            </>
          )}

          {!(!selectedNode || shouldShowHierarchyInspector) ? renderFolderDraftErrorMessage() : null}
          {inspectorToast ? (
            <div className="orbital-inspector-toast" role="status">
              {inspectorToast}
            </div>
          ) : null}
        </aside>

        <div
          ref={sceneWrapRef}
          className="orbital-scene-wrap"
          style={{ "--orbital-scene-accent": currentProject?.color ?? DEFAULT_INTERFACE_ACCENT } as CSSProperties}
        >
          <OrbitalMapControls
            label={labels.title}
            motionLabel={!isOrbitalMotionEnabled || isPaused ? labels.resume : labels.pause}
            motionIcon={!isOrbitalMotionEnabled || isPaused ? "play" : "pause"}
            motionActive={isOrbitalMotionEnabled && !isPaused}
            temporalSignalsEnabled={isTemporalSignalsGloballyEnabled}
            temporalLayerVisible={isTemporalLayerVisible}
            temporalLabel={t("orbit.timeLayer")}
            temporalLayerShowLabel={t("orbit.timeLayerShow")}
            temporalLayerHideLabel={t("orbit.timeLayerHide")}
            zoomOutLabel={labels.zoomOut}
            zoomInLabel={labels.zoomIn}
            centerSelectionLabel={labels.centerSelection}
            resetViewLabel={labels.resetView}
            onToggleMotion={() => {
              if (!isOrbitalMotionEnabled) {
                onOrbitalAnimationModeChange("full");
                setIsPaused(false);
                return;
              }

              setIsPaused((current) => !current);
            }}
            onToggleTemporalLayer={() => setIsTemporalLayerQuickHidden((current) => !current)}
            onZoomOut={() => {
              stopCameraAnimation();
              setCamera((current) => ({
                ...current,
                scale: clamp(current.scale * 0.9, CAMERA_MIN_SCALE, CAMERA_MAX_SCALE)
              }));
            }}
            onZoomIn={() => {
              stopCameraAnimation();
              setCamera((current) => ({
                ...current,
                scale: clamp(current.scale * 1.12, CAMERA_MIN_SCALE, CAMERA_MAX_SCALE)
              }));
            }}
            onCenterSelection={handleCenterSelection}
            onResetView={handleResetCamera}
          />

          <div className="orbital-filter-dock">
            <div className="orbital-filter-shell">
              <div className="orbital-filter-topline">
                <label className="orbital-searchbar" aria-label={labels.searchPlaceholder}>
                  <span className="orbital-searchbar-mark">Q</span>
                  <input
                    value={filterQuery}
                    onChange={(event) => setFilterQuery(event.target.value)}
                    placeholder={labels.searchPlaceholder}
                  />
                </label>

                {hasActiveFilter ? (
                  <button className="toolbar-action orbital-filter-clear" onClick={clearFilters}>
                    {labels.clearFilters}
                  </button>
                ) : null}
              </div>

              <div className="orbital-filter-chiprow" onWheel={handleFilterChipWheel}>
                {currentProject ? (
                  <span className="orbital-filter-chip orbital-filter-chip-project">
                    <span
                      className="orbital-filter-chip-dot"
                      style={{ "--pill-color": currentProject.color } as CSSProperties}
                    />
                    <span>{currentProject.name}</span>
                  </span>
                ) : null}
                {!isAndroidMobileShell ? (
                  <span className="orbital-filter-chip is-success">
                    {labels.visibleBodies}: {visibleBodies}
                  </span>
                ) : null}
                {!isAndroidMobileShell && hiddenBodies > 0 ? (
                  <span className="orbital-filter-chip is-warning">
                    {labels.hiddenBodies}: {hiddenBodies}
                  </span>
                ) : null}
                {!isAndroidMobileShell || isSceneFocusActive ? (
                  <span className={`orbital-filter-chip ${isSceneFocusActive ? "is-accent" : ""}`}>
                    {isSceneFocusActive ? labels.focusMode : labels.showAll}
                  </span>
                ) : null}
                {isTemporalLayerVisible &&
                onOpenPlannerView &&
                (temporalMapSignals.totalToday > 0 || temporalMapSignals.totalOverdue > 0) ? (
                  <>
                    <button
                      type="button"
                      className="orbital-filter-chip orbital-filter-temporal-chip is-today-chip is-accent"
                      onClick={() => openPlannerView("today")}
                      title={`${t("orbit.timeLayerToday")}: ${temporalMapSignals.totalToday}`}
                      aria-label={`${t("orbit.timeLayerToday")}: ${temporalMapSignals.totalToday}`}
                    >
                      <span className="orbital-filter-temporal-part is-today">
                        <span className="orbital-filter-temporal-icon" aria-hidden="true" />
                        <span>
                          {t("orbit.timeLayerToday")}: <strong>{temporalMapSignals.totalToday}</strong>
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`orbital-filter-chip orbital-filter-temporal-chip is-overdue-chip ${
                        temporalMapSignals.totalOverdue > 0 ? "is-warning" : ""
                      }`}
                      onClick={() => openPlannerView("overdue")}
                      title={`${t("orbit.timeLayerOverdue")}: ${temporalMapSignals.totalOverdue}`}
                      aria-label={`${t("orbit.timeLayerOverdue")}: ${temporalMapSignals.totalOverdue}`}
                    >
                      <span className="orbital-filter-temporal-part is-overdue">
                        <span className="orbital-filter-temporal-icon" aria-hidden="true" />
                        <span>
                          {t("orbit.timeLayerOverdue")}: <strong>{temporalMapSignals.totalOverdue}</strong>
                        </span>
                      </span>
                    </button>
                  </>
                ) : null}
                {isTemporalLayerVisible && selectedNode?.project && onOpenProjectPlan ? (
                  <button
                    type="button"
                    className={`orbital-filter-chip orbital-filter-plan-chip ${
                      (selectedProjectTemporalSignal?.overdueCount ?? 0) > 0 ? "is-warning" : "is-accent"
                    }`}
                    onClick={() => {
                      onOpenProjectPlan(selectedNode.project!.id);
                      setSurfaceMode("planner");
                      setMobileSection("planner");
                    }}
                    style={{ "--pill-color": selectedNode.project.color } as CSSProperties}
                    title={selectedProjectPlanLabel}
                    aria-label={selectedProjectPlanLabel}
                  >
                    <span className="orbital-filter-plan-dot" aria-hidden="true" />
                    <span className="orbital-filter-plan-copy">
                      <strong>{selectedProjectPlanLabel}</strong>
                      <span>
                        {t("orbit.timeLayerToday")}: {selectedProjectTemporalSignal?.todayCount ?? 0}
                        {(selectedProjectTemporalSignal?.overdueCount ?? 0) > 0
                          ? ` · ${t("orbit.timeLayerOverdue")}: ${selectedProjectTemporalSignal?.overdueCount ?? 0}`
                          : ""}
                      </span>
                    </span>
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <svg
            viewBox={`${VIEWBOX.minX} ${VIEWBOX.minY} ${VIEWBOX.width} ${VIEWBOX.height}`}
            className={`orbital-scene ${isLowDensityDisplay ? "is-low-density" : ""}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handleScenePointerEnd}
            onClick={handleSceneClick}
            onPointerCancel={handleScenePointerEnd}
          >
            <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}>
              {renderedScene.links.map((link) => {
                const linkTone = getSceneTone(link.entityId);

                return (
                  <line
                    key={link.id}
                    x1={link.x1}
                    y1={link.y1}
                    x2={link.x2}
                    y2={link.y2}
                    style={{ "--path-color": link.color } as CSSProperties}
                    className={`orbital-link orbital-link-${link.kind} orbital-link-depth-${Math.min(
                      link.depth,
                      3
                    )} is-${linkTone}`}
                  />
                );
              })}

              {renderedScene.orbits.map((orbit) => {
                const orbitTone = getSceneTone(orbit.entityId);

                return (
                  <ellipse
                    key={orbit.id}
                    cx={orbit.x}
                    cy={orbit.y}
                    rx={orbit.rx}
                    ry={orbit.ry}
                    transform={`rotate(${orbit.rotation} ${orbit.x} ${orbit.y})`}
                    style={{ "--path-color": orbit.color } as CSSProperties}
                    className={`orbital-orbit orbital-orbit-depth-${Math.min(
                      orbit.depth,
                      3
                    )} orbital-orbit-${orbit.kind} is-${orbitTone}`}
                  />
                );
              })}

              {isTemporalLayerVisible ? (
                <TemporalMapLayer
                  nodes={temporalLayerProjectNodes}
                  signals={temporalMapSignals.byProjectId}
                  compact={isAndroidMobileShell || isMobilePreviewMode}
                />
              ) : null}

              {renderedScene.nodes.map((node) => {
                const nodeTone = getSceneTone(node.entityId);
                const isSelected = node.entityId === selectedEntityId;
                const isFilterMatched =
                  filterPrimaryEntityIds.has(node.entityId) ||
                  filterSecondaryEntityIds.has(node.entityId);
                const showSelectedVisuals = isSelected && (!hasActiveFilter || isFilterMatched);
                const folderVisualKind = node.kind === "folder" ? getFolderVisualKind(node.folder) : null;
                const isRootFolder = folderVisualKind === "folder";
                const isSubfolder = folderVisualKind === "subfolder";
                const isRootEntry = node.kind === "note" && !node.note?.folderId;
                const labelText = truncateLabel(node.label, 24);
                const labelWidth = estimateLabelWidth(labelText) + (node.kind === "core" ? 0 : 16);
                const nodeCoreFlareRotation = sceneMovingEntityIds.has(node.entityId) ? coreFlareRotation : 0;
                const showLabel =
                  node.kind === "core" ||
                  showSelectedVisuals ||
                  nodeTone === "primary" ||
                  nodeTone === "direct" ||
                  (nodeTone === "secondary" && canShowHoverPreview) ||
                  (!isSceneBudgetConstrained &&
                    (node.depth === 0 ||
                      (isRootFolder && node.radius >= 24) ||
                      (isRootEntry && node.radius >= 13.5) ||
                      (isSubfolder && node.radius >= 30)));
                const sceneContextTarget = buildSceneNodeContextTarget(node);

                return (
                  <g
                    key={node.id}
                    data-orbital-node="true"
                    className={`orbital-node orbital-node-${node.kind} ${
                      node.note?.contentType === "canvas" ? "is-canvas-entry" : ""
                    } ${isRootFolder ? "is-root-folder" : ""} ${isSubfolder ? "is-subfolder" : ""} ${
                      isRootEntry ? "is-root-entry" : ""
                    } is-${nodeTone} ${showSelectedVisuals ? "is-selected" : ""}`}
                    style={{ "--node-color": node.color } as CSSProperties}
                    transform={`translate(${node.x} ${node.y})`}
                    onPointerDown={(event) => {
                      if (sceneContextTarget) {
                        handleInspectorContextPointerDown(sceneContextTarget, event);
                      }

                      if (event.pointerType === "touch" || isAndroidTouchLayout) {
                        return;
                      }

                      if (node.kind !== "core" || !node.project) {
                        return;
                      }

                      event.stopPropagation();
                      // Prevent scene background click from clearing core selection on pointer release.
                      suppressSceneBackgroundClickRef.current = true;
                      stopCameraAnimation();
                      setSelectedEntityId(node.entityId);
                      setActiveProjectId(node.project.id);
                      dragRef.current = {
                        mode: "project",
                        pointerId: event.pointerId,
                        projectId: node.project.id,
                        startX: event.clientX,
                        startY: event.clientY,
                        originProjectX: node.project.x,
                        originProjectY: node.project.y,
                        hasMoved: false
                      };
                      event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
                    }}
                    onClick={(event) => {
                      event.stopPropagation();

                      if (suppressSceneBackgroundClickRef.current) {
                        event.preventDefault();
                        suppressSceneBackgroundClickRef.current = false;
                        return;
                      }

                      suppressSceneBackgroundClickRef.current = false;
                      setIsInspectorHierarchyAutoExpandSuppressed(false);
                      setSelectedEntityId(node.entityId);

                      const nodeProjectId =
                        node.project?.id ?? node.folder?.projectId ?? node.note?.projectId ?? null;

                      if (effectiveInspectorMenu !== "overview") {
                        setHierarchyFocusedEntityId(node.entityId);
                        requestInspectorHierarchyAutoScroll();

                        if (isVaultInspectorScope) {
                          setActiveProjectId(null);
                          setInspectorHierarchyScope("vault");
                        } else if (nodeProjectId) {
                          setActiveProjectId(nodeProjectId);
                          setInspectorHierarchyScope("project");
                        }

                        return;
                      }

                      setInspectorHierarchyScope("project");
                      openInspectorMenu(node.kind === "core" ? "overview" : "folders");
                      setHierarchyFocusedEntityId(node.entityId);
                      requestInspectorHierarchyAutoScroll();
                      if (nodeProjectId) {
                        setActiveProjectId(nodeProjectId);
                      }
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      suppressSceneBackgroundClickRef.current = false;
                      setSelectedEntityId(node.entityId);
                      setInspectorHierarchyScope("project");
                      if (node.kind !== "core") {
                        openInspectorMenu("folders");
                      }
                      if (node.note) {
                        closeSelectionHoverPreview();
                        onOpenNote(node.note.id);
                      } else {
                        animateCameraTo({
                          x: -node.x,
                          y: -node.y
                        }, 560);
                      }
                    }}
                    onPointerUp={(event) => {
                      if (sceneContextTarget) {
                        handleInspectorContextPointerEnd(event.pointerId);
                      }
                    }}
                    onPointerEnter={
                      node.note && canShowHoverPreview
                        ? (event) => {
                            openSelectionHoverPreview(
                              node.note!.id,
                              event.clientX,
                              event.clientY,
                              "scene",
                              {
                                sceneAnchorElement: event.currentTarget
                              }
                            );
                          }
                        : undefined
                    }
                    onPointerMove={(event) => {
                      if (sceneContextTarget) {
                        handleInspectorContextPointerMove(event);
                      }

                      if (node.note && canShowHoverPreview) {
                            updateSelectionHoverPreviewCursor(event.clientX, event.clientY, {
                              sceneAnchorElement: event.currentTarget
                            });
                          }
                    }}
                    onPointerLeave={(event) => {
                      if (node.note && canShowHoverPreview) {
                            scheduleSelectionHoverPreviewClose();
                          }
                      if (sceneContextTarget) {
                        handleInspectorContextPointerEnd(event.pointerId);
                      }
                    }}
                    onPointerCancel={(event) => {
                      if (node.note && canShowHoverPreview) {
                            scheduleSelectionHoverPreviewClose();
                          }
                      if (sceneContextTarget) {
                        handleInspectorContextPointerEnd(event.pointerId);
                      }
                    }}
                  >
                    <title>{node.label}</title>
                    <circle
                      r={node.radius + (isMobilePreviewMode ? 13 : 7)}
                      className="orbital-hit-area"
                    />
                    {node.kind === "core" ? (
                      <>
                        <circle r={node.radius * 1.72} className="orbital-core-halo" />
                        <circle r={node.radius * 2.24} className="orbital-core-corona" />
                        <g transform={`rotate(${nodeCoreFlareRotation})`}>
                          <polygon
                            points={buildStarburstPoints(node.radius * 1.06, node.radius * 1.82, 10)}
                            className="orbital-core-flare"
                          />
                          <polygon
                            points={buildStarburstPoints(node.radius * 0.96, node.radius * 1.56, 8)}
                            className="orbital-core-flare secondary"
                            transform="rotate(22)"
                          />
                        </g>
                        <circle r={node.radius * 1.28} className="orbital-node-aura" />
                        <circle r={node.radius} className="orbital-core-disc" />
                        <circle r={node.radius * 0.82} className="orbital-core-rim" />
                        <circle r={node.radius * 0.58} className="orbital-core-pulse" />
                      </>
                    ) : null}

                    {node.kind === "folder" ? (
                      <>
                        <circle r={node.radius * (isRootFolder ? 1.46 : 1.28)} className="orbital-node-aura" />
                        <circle r={node.radius} className={isRootFolder ? "orbital-folder-disc" : "orbital-subfolder-disc"} />
                        {isRootFolder ? (
                          <>
                            <ellipse
                              rx={node.radius * 0.88}
                              ry={node.radius * 0.42}
                              className="orbital-folder-band"
                              transform="rotate(-14)"
                            />
                            <path
                              d={`M ${-node.radius * 0.52} ${-node.radius * 0.08} C ${-node.radius * 0.18} ${-node.radius * 0.24}, ${node.radius * 0.18} ${-node.radius * 0.24}, ${node.radius * 0.54} ${-node.radius * 0.02}`}
                              className="orbital-folder-equator"
                            />
                            <circle r={node.radius * 0.34} className="orbital-folder-core" />
                          </>
                        ) : (
                          <>
                            <circle r={node.radius * 0.72} className="orbital-subfolder-ring" />
                            <circle
                              cx={node.radius * 0.58}
                              cy={-node.radius * 0.52}
                              r={Math.max(2.4, node.radius * 0.14)}
                              className="orbital-subfolder-moon"
                            />
                            <circle r={node.radius * 0.24} className="orbital-folder-core" />
                          </>
                        )}
                      </>
                    ) : null}

                    {node.kind === "note" ? (
                      node.note?.contentType === "canvas" ? (
                        <>
                          <circle r={node.radius * 1.18} className="orbital-node-aura note-aura" />
                          <rect
                            x={-node.radius * 1.04}
                            y={-node.radius * 0.86}
                            width={node.radius * 2.08}
                            height={node.radius * 1.72}
                            rx={node.radius * 0.28}
                            className="orbital-canvas-disc"
                          />
                          <rect
                            x={-node.radius * 0.7}
                            y={-node.radius * 0.5}
                            width={node.radius * 1.4}
                            height={node.radius}
                            rx={node.radius * 0.18}
                            className="orbital-canvas-core"
                          />
                          <path
                            d={`M ${-node.radius * 0.62} ${-node.radius * 0.34} H ${node.radius * 0.62} M ${-node.radius * 0.62} ${node.radius * 0.02} H ${node.radius * 0.62}`}
                            className="orbital-canvas-gridline"
                          />
                          <path
                            d={`M ${-node.radius * 0.44} ${-node.radius * 0.08} H ${node.radius * 0.44} M ${-node.radius * 0.44} ${node.radius * 0.18} H ${node.radius * 0.44}`}
                            className="orbital-canvas-lines"
                          />
                          <circle
                            cx={node.radius * 0.78}
                            cy={-node.radius * 0.72}
                            r="3.2"
                            className="orbital-canvas-beacon"
                          />
                        </>
                      ) : (
                        <>
                          <circle r={node.radius * 1.14} className="orbital-node-aura note-aura" />
                          <rect
                            x={-node.radius}
                            y={-node.radius}
                            width={node.radius * 2}
                            height={node.radius * 2}
                            rx={node.radius * 0.18}
                            className="orbital-note-disc"
                            transform="rotate(45)"
                          />
                          <rect
                            x={-node.radius * 0.52}
                            y={-node.radius * 0.52}
                            width={node.radius * 1.04}
                            height={node.radius * 1.04}
                            rx={node.radius * 0.1}
                            className="orbital-note-core"
                            transform="rotate(45)"
                          />
                          <path
                            d={`M ${-node.radius * 0.26} ${-node.radius * 0.88} L ${node.radius * 0.7} ${0.08 * node.radius}`}
                            className="orbital-note-sheen"
                          />
                          {isEntryFavorite(node) ? (
                            <circle
                              cx={-node.radius * 0.92}
                              cy={node.radius * 0.92}
                              r="2.8"
                              className="orbital-pinned-signal"
                            />
                          ) : null}
                        </>
                      )
                    ) : null}

                    {showSelectedVisuals ? <circle r={node.radius * 1.82} className="orbital-selection-ring" /> : null}

                    {showLabel ? (
                      <g transform={`translate(0 ${node.radius + 24})`}>
                        <g
                          className={`orbital-label-group orbital-label-group-${node.kind} ${
                            isRootFolder ? "is-root-folder" : ""
                          } ${isSubfolder ? "is-subfolder" : ""} ${isRootEntry ? "is-root-entry" : ""} ${
                            showSelectedVisuals ? "is-selected" : ""
                          } is-${nodeTone}`}
                        >
                          <rect
                            x={-labelWidth / 2}
                            y={-14}
                            width={labelWidth}
                            height={24}
                            rx={12}
                            className="orbital-label-badge"
                          />
                          {node.kind !== "core" ? (
                            <g className="orbital-label-glyph" transform={`translate(${-labelWidth / 2 + 12} 0)`}>
                              {node.kind === "folder" ? (
                                isRootFolder ? (
                                  <>
                                    <circle r="4.1" className="orbital-label-glyph-orb" />
                                    <ellipse rx="5.6" ry="2.45" className="orbital-label-glyph-ring" transform="rotate(-14)" />
                                  </>
                                ) : (
                                  <>
                                    <circle r="3.4" className="orbital-label-glyph-orb" />
                                    <circle r="4.8" className="orbital-label-glyph-ring orbital-label-glyph-ring-dashed" />
                                    <circle cx="4.7" cy="-3.9" r="1.2" className="orbital-label-glyph-dot" />
                                  </>
                                )
                              ) : node.note?.contentType === "canvas" ? (
                                <>
                                  <rect x="-4.7" y="-3.9" width="9.4" height="7.8" rx="2" className="orbital-label-glyph-rect" />
                                  <path d="M -2.7 -0.9 H 2.7 M -2.7 1.3 H 2.7" className="orbital-label-glyph-line" />
                                </>
                              ) : (
                                <>
                                  <rect
                                    x="-3.7"
                                    y="-3.7"
                                    width="7.4"
                                    height="7.4"
                                    rx="1.25"
                                    transform="rotate(45)"
                                    className="orbital-label-glyph-rect"
                                  />
                                </>
                              )}
                            </g>
                          ) : null}
                          <text y={2} textAnchor="middle" className="orbital-label-text" dx={node.kind === "core" ? 0 : 8}>
                            {labelText}
                          </text>
                        </g>
                      </g>
                    ) : null}
                  </g>
                );
              })}
            </g>
          </svg>

          {isAndroidMobileShell && mobileSection === "map" && selectedNode ? (
            <section
              className="orbital-mobile-selection-sheet"
              style={{ "--mobile-selection-accent": selectedNode.color } as CSSProperties}
            >
              <div className="orbital-mobile-selection-copy">
                <span>{mobileSelectedKindLabel}</span>
                <strong>{mobileSelectedTitle}</strong>
              </div>
              {selectedProjectTemporalSignal ? (
                <div className="orbital-mobile-temporal-summary">
                  <span>
                    <i className="is-today" aria-hidden="true" />
                    {t("orbit.timeLayerToday")}: <strong>{selectedProjectTemporalSignal.todayCount}</strong>
                  </span>
                  <span className={selectedProjectTemporalSignal.overdueCount > 0 ? "is-overdue" : ""}>
                    <i className="is-overdue" aria-hidden="true" />
                    {t("orbit.timeLayerOverdue")}: <strong>{selectedProjectTemporalSignal.overdueCount}</strong>
                  </span>
                  {selectedProjectTemporalSignal.milestoneTitle ? (
                    <span>
                      <i className="is-milestone" aria-hidden="true" />
                      {t("orbit.timeLayerMilestone")}:{" "}
                      <strong>{truncateLabel(selectedProjectTemporalSignal.milestoneTitle, 18)}</strong>
                    </span>
                  ) : null}
                </div>
              ) : null}
              <div className="orbital-mobile-selection-actions">
                {selectedNode.project && onOpenProjectPlan ? (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenProjectPlan(selectedNode.project!.id);
                      setSurfaceMode("planner");
                      setMobileSection("planner");
                    }}
                  >
                    {selectedProjectPlanLabel}
                  </button>
                ) : null}
                {selectedNode.note ? (
                  <button type="button" onClick={openSelectedMobileEntry}>
                    {selectedNode.note.contentType === "canvas" ? labels.openCanvas : labels.openNote}
                  </button>
                ) : null}
                {selectedNode.note ? (
                  <button type="button" onClick={() => openMobileNotePreview(selectedNode.note!.id)}>
                    {t("orbit.mobilePreviewAction")}
                  </button>
                ) : null}
                {mobileSelectedContextTarget ? (
                  <button
                    type="button"
                    onClick={() => openInspectorContextMenu(mobileSelectedContextTarget, "sheet", null)}
                  >
                    {t("orbit.mobileActions")}
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>

      </div>

      {renderMobileInspectorActionBar()}

      {isAndroidMobileShell && !editorOpen ? (
        <nav
          className={`orbital-mobile-bottom-nav is-index-${mobileNavActiveIndex}`}
          style={{ "--mobile-nav-active-index": mobileNavActiveIndex } as CSSProperties}
          aria-label={t("orbit.mobileNavigation")}
        >
          <span
            className={`orbital-mobile-bottom-nav-indicator is-index-${mobileNavActiveIndex}`}
            aria-hidden="true"
          />
          {[
            ["vault", t("orbit.mobileFoldersNav")],
            ["planner", labels.plannerMode],
            ["map", t("orbit.mobileMap")]
          ].map(([section, label]) => (
            <button
              key={section}
              type="button"
              className={mobileNavActiveSection === section ? "is-active" : ""}
              onClick={() => openMobileSection(section as OrbitalMobileSection)}
              aria-pressed={mobileNavActiveSection === section}
            >
              {renderMobileNavGlyph(section as OrbitalMobileSection)}
              <span>{label}</span>
            </button>
          ))}
          <button
            type="button"
            className={mobileNavActiveSection === "more" ? "is-active" : ""}
            onClick={openMobileMore}
            aria-pressed={mobileNavActiveSection === "more"}
          >
            {renderMobileNavGlyph("more")}
            <span>{t("orbit.mobileStorageNav")}</span>
          </button>
          <button
            type="button"
            className={mobileNavActiveSection === "account" ? "is-active" : ""}
            onClick={openMobileAccount}
            aria-pressed={mobileNavActiveSection === "account"}
          >
            {renderMobileNavGlyph("account")}
            <span>{t("orbit.mobileAccountNav")}</span>
          </button>
          <button
            type="button"
            className={mobileNavActiveSection === "settings" ? "is-active" : ""}
            onClick={openMobileSettings}
            aria-pressed={mobileNavActiveSection === "settings"}
          >
            {renderMobileNavGlyph("settings")}
            <span>{labels.settings}</span>
          </button>
        </nav>
      ) : null}

      {isAndroidMobileShell && mobileMoveConflictState ? (
        <div className="orbital-mobile-conflict-layer" role="dialog" aria-modal="true">
          <button
            type="button"
            className="orbital-mobile-conflict-backdrop"
            onClick={clearMobileMoveState}
            aria-label={labels.cancel}
          />
          <div className="orbital-mobile-conflict-card">
            <div className="orbital-mobile-conflict-head">
              <p className="panel-kicker">{t("orbit.mobileMoveConflictTitle")}</p>
              <h3>{mobileMoveConflictState.destination.label}</h3>
              <p>
                {t("orbit.mobileMoveConflictDescription", {
                  count: mobileMoveConflictState.conflicts.length
                })}
              </p>
            </div>
            <div className="orbital-mobile-conflict-list">
              {mobileMoveConflictState.conflicts.slice(0, 4).map((conflict) => (
                <div
                  className="orbital-mobile-conflict-item"
                  key={getMobileMoveItemEntityId(conflict.item)}
                >
                  <span>{conflict.currentName}</span>
                  <strong>{conflict.suggestedName}</strong>
                </div>
              ))}
            </div>
            <div className="orbital-mobile-conflict-actions">
              <button type="button" onClick={clearMobileMoveState}>
                {labels.cancel}
              </button>
              <button
                type="button"
                onClick={() => {
                  void performMobileMove(mobileMoveConflictState.destination, "copy");
                }}
              >
                {t("orbit.mobileMoveCopy")}
              </button>
              <button
                type="button"
                className="is-primary"
                onClick={() => {
                  void performMobileMove(mobileMoveConflictState.destination, "rename");
                }}
              >
                {t("orbit.mobileMoveRename")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {canShowHoverPreview && hoverPreviewPosition && (hoverPreviewNote || hoverPreviewAsset) ? (
          <div
            ref={hoverPreviewCardRef}
            className={`orbital-note-hovercard ${hoverPreviewAsset ? "orbital-file-hovercard" : ""}`}
            style={{
              left: hoverPreviewPosition.left,
              top: hoverPreviewPosition.top,
              width: hoverPreviewPosition.width,
              height: hoverPreviewPosition.height,
              "--hovercard-accent": hoverPreviewAccent,
              "--hovercard-placement": hoverPreviewPosition.placement
            } as CSSProperties}
            onPointerEnter={(event) => {
              hoverPreviewCursorRef.current = { x: event.clientX, y: event.clientY };
              clearHoverPreviewCloseTimeout();
            }}
            onPointerMove={(event) => {
              hoverPreviewCursorRef.current = { x: event.clientX, y: event.clientY };
            }}
            onPointerLeave={(event) => {
              hoverPreviewCursorRef.current = { x: event.clientX, y: event.clientY };
              scheduleSelectionHoverPreviewClose();
            }}
          >
            {hoverPreviewNote ? (
              <>
                <div className="orbital-note-hovercard-head">
                  <div className="orbital-note-hovercard-topline">
                    <p className="panel-kicker">
                      {hoverPreviewNote.contentType === "canvas" ? labels.canvas : labels.note}
                    </p>
                    {renderEntryPreviewActions(hoverPreviewNote, {
                      className: "orbital-note-hovercard-actions",
                      closeHoverPreviewOnAction: true
                    })}
                  </div>
                  <h3>{hoverPreviewNote.title}</h3>
                  <div className="orbital-note-hovercard-meta">
                    <span>{hoverPreviewFolder}</span>
                    <span>{labels.updated}: {formatTimestamp(hoverPreviewNote.updatedAt)}</span>
                  </div>
                </div>
                <div className="orbital-note-hovercard-scroll" ref={noteHoverPreviewScrollRef}>
                  <EntryStaticPreview
                    note={hoverPreviewNote}
                    emptyLabel={labels.empty}
                    resolveFileUrl={onResolveFileUrl}
                    interactive
                    onChecklistItemToggle={(blockId, checked) =>
                      onToggleNoteChecklistItem?.(hoverPreviewNote.id, blockId, checked)
                    }
                    className="orbital-note-hovercard-copy"
                    labels={{
                      canvas: labels.canvas,
                      elements: labels.elementsStat,
                      images: labels.assetsStat,
                      emptyCanvas: labels.emptyCanvas,
                      previewHint: labels.canvasPreviewHint
                    }}
                  />
                </div>
              </>
            ) : hoverPreviewAsset ? (
              <>
                <div className="orbital-note-hovercard-head">
                  <div className="orbital-note-hovercard-topline">
                    <p className="panel-kicker">{labels.filesMenu}</p>
                  </div>
                  <h3>{hoverPreviewAssetDisplayName}</h3>
                  <div className="orbital-note-hovercard-meta">
                    {hoverPreviewAssetNote ? <span>{hoverPreviewAssetNote.title}</span> : null}
                    {hoverPreviewAssetMeta ? <span>{hoverPreviewAssetMeta}</span> : null}
                  </div>
                </div>
                <div
                  className="orbital-note-hovercard-scroll orbital-file-hovercard-scroll"
                  ref={noteHoverPreviewScrollRef}
                >
                  {hoverPreviewAsset.kind === "image" && hoverPreviewAssetUrl ? (
                    <figure className="orbital-file-hovercard-figure">
                      <img
                        src={hoverPreviewAssetUrl}
                        alt={hoverPreviewAssetDisplayName}
                        className="orbital-file-hovercard-image"
                        loading="lazy"
                      />
                    </figure>
                  ) : (
                    <div className="orbital-file-hovercard-fallback">
                      {renderInspectorItemIcon("file", hoverPreviewAccent)}
                      <span>{hoverPreviewAssetDisplayName}</span>
                      {hoverPreviewAssetMeta ? <small>{hoverPreviewAssetMeta}</small> : null}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        ) : null}

      {isAndroidTouchLayout && (hoverPreviewNote || hoverPreviewAsset) ? (
        <div
          className={`orbital-mobile-preview-layer ${hoverPreviewAsset ? "is-file" : "is-note"}`}
          style={{ "--hovercard-accent": hoverPreviewAccent } as CSSProperties}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            className="orbital-mobile-preview-backdrop"
            onClick={closeSelectionHoverPreview}
            aria-label={labels.close}
          />
          <div className="orbital-mobile-preview-card">
            {hoverPreviewNote ? (
              <>
                <div className="orbital-note-hovercard-head">
                  <div className="orbital-note-hovercard-topline">
                    <p className="panel-kicker">{t("orbit.mobilePreviewTitle")}</p>
                    {renderEntryPreviewActions(hoverPreviewNote, {
                      className: "orbital-note-hovercard-actions",
                      closeHoverPreviewOnAction: true
                    })}
                  </div>
                  <h3>{hoverPreviewNote.title}</h3>
                  <div className="orbital-note-hovercard-meta">
                    <span>{hoverPreviewFolder}</span>
                    <span>{labels.updated}: {formatTimestamp(hoverPreviewNote.updatedAt)}</span>
                  </div>
                </div>
                <div className="orbital-note-hovercard-scroll" ref={noteHoverPreviewScrollRef}>
                  <EntryStaticPreview
                    note={hoverPreviewNote}
                    emptyLabel={labels.empty}
                    resolveFileUrl={onResolveFileUrl}
                    interactive
                    onChecklistItemToggle={(blockId, checked) =>
                      onToggleNoteChecklistItem?.(hoverPreviewNote.id, blockId, checked)
                    }
                    className="orbital-note-hovercard-copy"
                    labels={{
                      canvas: labels.canvas,
                      elements: labels.elementsStat,
                      images: labels.assetsStat,
                      emptyCanvas: labels.emptyCanvas,
                      previewHint: labels.canvasPreviewHint
                    }}
                  />
                </div>
              </>
            ) : hoverPreviewAsset ? (
              <>
                <div className="orbital-note-hovercard-head">
                  <div className="orbital-note-hovercard-topline">
                    <p className="panel-kicker">{labels.filesMenu}</p>
                  </div>
                  <h3>{hoverPreviewAssetDisplayName}</h3>
                  <div className="orbital-note-hovercard-meta">
                    {hoverPreviewAssetNote ? <span>{hoverPreviewAssetNote.title}</span> : null}
                    {hoverPreviewAssetMeta ? <span>{hoverPreviewAssetMeta}</span> : null}
                  </div>
                </div>
                <div
                  className="orbital-note-hovercard-scroll orbital-file-hovercard-scroll"
                  ref={noteHoverPreviewScrollRef}
                >
                  {hoverPreviewAsset.kind === "image" && hoverPreviewAssetUrl ? (
                    <figure className="orbital-file-hovercard-figure">
                      <img
                        src={hoverPreviewAssetUrl}
                        alt={hoverPreviewAssetDisplayName}
                        className="orbital-file-hovercard-image"
                        loading="lazy"
                      />
                    </figure>
                  ) : (
                    <div className="orbital-file-hovercard-fallback">
                      {renderInspectorItemIcon("file", hoverPreviewAccent)}
                      <span>{hoverPreviewAssetDisplayName}</span>
                      {hoverPreviewAssetMeta ? <small>{hoverPreviewAssetMeta}</small> : null}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {isOverviewColorPanelOpen && overviewColorPanelStyle && currentProject ? (
        <div
          ref={overviewColorPanelRef}
          className={`orbital-context-menu-colorpanel orbital-context-menu-colorpanel-floating is-${overviewColorPanelStyle.placement} orbital-overview-colorpanel`}
          style={{
            left: overviewColorPanelStyle.left,
            top: overviewColorPanelStyle.top,
            width: overviewColorPanelStyle.width,
            maxHeight: overviewColorPanelStyle.maxHeight,
            "--menu-accent": currentProject.color
          } as CSSProperties}
        >
          <div
            className="orbital-context-menu-colorpanel-body"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="orbital-context-menu-swatches">
              {contextMenuColorOptions.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`orbital-context-menu-swatch ${
                    currentProject.color.toLowerCase() === entry.hex.toLowerCase() ? "is-active" : ""
                  }`}
                  onClick={() => onUpdateProjectColor(currentProject.id, entry.hex)}
                  style={{ "--swatch-color": entry.hex } as CSSProperties}
                  aria-label={entry.label}
                  title={entry.label}
                >
                  <span />
                </button>
              ))}
            </div>

            <label className="orbital-context-menu-customcolor">
              <span>{labels.customColor}</span>
              <span className="orbital-context-menu-customcolor-control">
                <input
                  type="color"
                  value={currentProject.color}
                  onChange={(event) => onUpdateProjectColor(currentProject.id, event.target.value)}
                  aria-label={labels.customColor}
                />
                <strong>{currentProject.color.toUpperCase()}</strong>
              </span>
            </label>
          </div>
        </div>
      ) : null}

      {contextMenuTarget ? (
        <OrbitalInspectorContextMenu
          open
          presentation={contextMenuState?.presentation ?? "popover"}
          position={contextMenuState?.position}
          accentColor={contextMenuTarget.color}
          title={contextMenuTitle}
          kindLabel={contextMenuKindLabel}
          actions={contextMenuActions}
          quickActions={contextMenuQuickActions}
          colorOptions={contextMenuColorOptions}
          activeColor={contextMenuTarget.color}
          chooseColorLabel={labels.chooseColor}
          customColorLabel={labels.customColor}
          closeLabel={labels.cancel}
          onClose={closeInspectorContextMenu}
          onColorChange={handleContextMenuColorChange}
        />
      ) : null}

      <EditorSurfaceTransition
        open={editorOpen}
        mode={editorMode}
        contentKey={editorContentKey}
        title={editorTitle ?? ""}
        accentColor={editorAccentColor || DEFAULT_NOTE_COLOR}
        canvasFullscreen={isCanvasEditorFullscreen}
        modalRef={editorModalRef}
        labels={{
          openCanvas: labels.openCanvas,
          openNote: labels.openNote,
          enterFullscreen: labels.enterFullscreen,
          exitFullscreen: labels.exitFullscreen,
          closeEditor: labels.closeEditor
        }}
        onClose={onCloseEditor}
        onToggleCanvasFullscreen={() => void toggleCanvasEditorFullscreen()}
      >
        {editorSlot}
      </EditorSurfaceTransition>

      {activeModal ? (
        <div
          className="orbital-modal-layer"
          role={isAndroidMobileShell && activeModal === "settings" ? "region" : "dialog"}
          aria-modal={isAndroidMobileShell && activeModal === "settings" ? undefined : true}
        >
          <button
            className="orbital-modal-dim"
            aria-label={labels.closeModal}
            onClick={closeUtilityModal}
          />
          <div
            className={`orbital-modal-window orbital-utility-modal-window ${
              activeModal === "settings" ? "is-settings-mode" : "is-trash-mode"
            }`}
          >
            <button
              type="button"
              className="orbital-utility-modal-close"
              aria-label={labels.closeModal}
              title={labels.closeModal}
              onClick={closeUtilityModal}
            >
              <span aria-hidden="true">×</span>
            </button>
            <div className="orbital-modal-content orbital-utility-modal-content">
              {activeModal === "settings" ? resolvedSettingsModalSlot : resolvedTrashModalSlot}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
