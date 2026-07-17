export type AppLanguage = string;
export type SyncProvider = "none" | "googleDrive" | "selfHosted" | "hosted";
export type SyncConnectionProvider = Exclude<SyncProvider, "none">;
export type SyncConnectionRole = "external" | "locorisCloud";
export type SelfHostedDeviceRole = "owner" | "guest";
export type MobileSection = "vault" | "notes" | "editor";
export type SaveState = "idle" | "saving" | "saved";
export type AssetKind = "image" | "file" | "audio" | "video";
export type NoteContentType = "note" | "canvas";
export type NoteListView = "all" | "favorites" | "archived" | "trash";
export type SyncState = "local" | "dirty" | "synced" | "conflict";
export type SyncStatus = "disabled" | "idle" | "syncing" | "error";
export type ConflictStrategy = "duplicate";
export type SyncEntityKind =
  | "project"
  | "folder"
  | "tag"
  | "note"
  | "asset"
  | "task"
  | "habit"
  | "habitLog"
  | "goal"
  | "timeBlock";
export type SyncPayloadMode = "plain" | "encrypted";
export type SyncVaultKind = "regular" | "private";
export type SyncEncryptionState = "disabled" | "ready" | "locked";
export type SyncEncryptionKdf = "pbkdf2-sha256";
export type SyncEncryptionCipher = "aes-gcm-256";

export type PlannerTaskKind = "task" | "milestone";
export type PlannerTaskStatus =
  | "inbox"
  | "todo"
  | "scheduled"
  | "inProgress"
  | "waiting"
  | "done"
  | "canceled";
export type PlannerTaskPriority = "none" | "low" | "medium" | "high" | "urgent";
export type PlannerReminderChannel = "inApp" | "system";
export type PlannerLinkKind =
  | "project"
  | "folder"
  | "note"
  | "canvas"
  | "block"
  | "canvasElement"
  | "url";
export type HabitStatus = "active" | "paused" | "archived";
export type HabitTargetPeriod = "day" | "week" | "month";
export type GoalStatus = "active" | "paused" | "completed" | "archived";
export type TimeBlockStatus = "planned" | "active" | "completed" | "canceled";

export interface StoredBlock {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: StoredBlock[];
  [key: string]: unknown;
}

export type NoteContent = StoredBlock[];

export interface CanvasSceneElement {
  id: string;
  type: string;
  isDeleted?: boolean;
  fileId?: string | null;
  [key: string]: unknown;
}

export interface CanvasSceneAppState {
  viewBackgroundColor?: string;
  gridSize?: number | null;
  gridStep?: number;
  scrollX?: number;
  scrollY?: number;
  zoom?: {
    value?: number;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface CanvasContent {
  elements: CanvasSceneElement[];
  appState: CanvasSceneAppState | null;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  sortOrder?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Folder {
  id: string;
  projectId: string;
  name: string;
  parentId: string | null;
  color: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export interface Note {
  id: string;
  title: string;
  contentType: NoteContentType;
  projectId: string;
  folderId: string | null;
  color: string;
  sortOrder: number;
  tagIds: string[];
  content: NoteContent;
  canvasContent: CanvasContent | null;
  excerpt: string;
  plainText: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  favorite: boolean;
  archived: boolean;
  trashedAt: number | null;
  syncState: SyncState;
  conflictOriginId: string | null;
}

export interface Asset {
  id: string;
  noteId: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AssetKind;
  blob: Blob;
  version?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Reminder {
  id: string;
  title: string;
  remindAt: number | null;
  offsetMinutes: number | null;
  channel: PlannerReminderChannel;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PlannerRecurrenceOverride {
  id: string;
  originalStartAt: number;
  startAt: number | null;
  dueAt: number | null;
  scheduledStartAt: number | null;
  scheduledEndAt: number | null;
  skipped: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TaskLink {
  id: string;
  kind: PlannerLinkKind;
  label: string;
  projectId: string | null;
  folderId: string | null;
  noteId: string | null;
  canvasId: string | null;
  sourceBlockId: string | null;
  canvasElementId: string | null;
  url: string | null;
  createdAt: number;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  kind: PlannerTaskKind;
  status: PlannerTaskStatus;
  priority: PlannerTaskPriority;
  projectId: string | null;
  folderId: string | null;
  noteId: string | null;
  canvasId: string | null;
  sourceBlockId: string | null;
  canvasElementId: string | null;
  tagIds: string[];
  links: TaskLink[];
  reminders: Reminder[];
  startAt: number | null;
  dueAt: number | null;
  scheduledStartAt: number | null;
  scheduledEndAt: number | null;
  completedAt: number | null;
  canceledAt: number | null;
  recurrenceRule: string | null;
  recurrenceTimezone: string | null;
  recurrenceAnchorAt: number | null;
  recurrenceUntilAt: number | null;
  recurrenceExceptionDates: number[];
  recurrenceCompletedDates: number[];
  recurrenceOverrides: PlannerRecurrenceOverride[];
  estimateMinutes: number | null;
  spentMinutes: number;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface Habit {
  id: string;
  title: string;
  description: string;
  status: HabitStatus;
  projectId: string | null;
  noteId: string | null;
  color: string;
  icon: string;
  frequencyRule: string;
  frequencyTimezone: string | null;
  targetCount: number;
  targetUnit: string;
  targetPeriod: HabitTargetPeriod;
  reminders: Reminder[];
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  pausedAt: number | null;
  archivedAt: number | null;
  pauseRanges: HabitPauseRange[];
}

export interface HabitPauseRange {
  id: string;
  startAt: number;
  endAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface HabitLog {
  id: string;
  habitId: string;
  occurredAt: number;
  value: number;
  unit: string;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  status: GoalStatus;
  projectId: string | null;
  parentGoalId: string | null;
  color: string;
  metricLabel: string;
  targetValue: number | null;
  currentValue: number | null;
  startAt: number | null;
  dueAt: number | null;
  completedAt: number | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface TimeBlock {
  id: string;
  title: string;
  description: string;
  status: TimeBlockStatus;
  taskId: string | null;
  projectId: string | null;
  noteId: string | null;
  canvasId: string | null;
  startAt: number;
  endAt: number;
  actualStartAt: number | null;
  actualEndAt: number | null;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export type PlannerDefaultSurface = "planner" | "calendar";
export type PlannerWeekStartsOn = "monday" | "sunday";
export type PlannerCalendarDefaultView = "day" | "week" | "month";

export interface AppSettings {
  id: "app";
  syncEnabled: boolean;
  syncStatus: SyncStatus;
  syncProvider: SyncProvider;
  selfHostedUrl: string;
  selfHostedVaultId: string;
  selfHostedToken: string;
  hostedUrl: string;
  hostedSessionToken: string;
  hostedUserId: string | null;
  hostedUserName: string;
  hostedUserEmail: string;
  hostedVaultId: string;
  hostedSyncToken: string;
  conflictStrategy: ConflictStrategy;
  encryptionEnabled: boolean;
  encryptionVersion: number | null;
  encryptionKdf: SyncEncryptionKdf | null;
  encryptionIterations: number | null;
  encryptionKeyId: string | null;
  encryptionSalt: string | null;
  encryptionKeyCheck: string | null;
  encryptionUpdatedAt: number | null;
  lastSyncAt: number | null;
  syncCursor: string | null;
  localDeviceId: string;
  lastOpenedNoteId: string | null;
  plannerDefaultSurface: PlannerDefaultSurface;
  plannerWeekStartsOn: PlannerWeekStartsOn;
  plannerDefaultCalendarView: PlannerCalendarDefaultView;
}

/** Read-only compatibility shape for vaults and backups created before locale preferences became device-local. */
export type LegacyAppSettings = AppSettings & {
  language?: AppLanguage;
};

export interface VaultEncryptionSummary {
  enabled: boolean;
  state: SyncEncryptionState;
  keyId: string | null;
  updatedAt: number | null;
}

export interface SyncRemoteVault {
  id: string;
  name: string;
  vaultKind: SyncVaultKind;
  createdAt: number;
  updatedAt: number;
  lastRevision: string | null;
  lastSyncAt: number | null;
  tokenCount?: number;
}

export interface SyncConnection {
  id: string;
  provider: SyncConnectionProvider;
  role?: SyncConnectionRole;
  label: string;
  serverUrl: string;
  managementToken: string;
  sessionToken: string;
  refreshToken?: string;
  tokenExpiresAt: number | null;
  userId: string | null;
  userName: string;
  userEmail: string;
  changePageToken?: string | null;
  selfHostedDeviceId: string | null;
  selfHostedRole: SelfHostedDeviceRole | null;
  selfHostedServerId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SyncVaultBinding {
  id: string;
  localVaultId: string;
  connectionId: string;
  remoteVaultId: string;
  remoteVaultName: string;
  syncToken: string;
  syncStatus: SyncStatus;
  lastSyncAt: number | null;
  syncCursor: string | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface RemoteVaultImportResult {
  localVaultId: string;
  localVaultName: string;
  disposition: "imported" | "linked" | "pendingUnlock";
  nameAdjusted: boolean;
}

export interface HostedAccountUser {
  id: string;
  name: string;
  email: string | null;
  role: "member" | "admin";
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
  hasPassword: boolean;
}

export interface HostedAccountSession {
  id: string;
  deviceId?: string | null;
  deviceName?: string | null;
  clientPlatform?: string | null;
  createdAt: number;
  expiresAt: number;
  token: string;
  refreshToken?: string;
  refreshExpiresAt?: number;
  refreshIdleExpiresAt?: number;
  authProtocol?: number;
}

export interface HostedAccountVault {
  id: string;
  name: string;
  ownerUserId: string | null;
  ownerName: string | null;
  vaultKind: SyncVaultKind;
  createdAt: number;
  updatedAt: number;
  lastRevision: string | null;
  lastSyncAt: number | null;
  tokenCount: number;
  deviceCount?: number;
}

export interface HostedCloudLimits {
  cloudEnabled: boolean;
  maxVaults: number | null;
  maxSyncTokens: number | null;
  storageBytes: number | null;
  historyDays?: number | null;
  maxUploadBytes: number | null;
  maxJournalEntriesPerVault: number | null;
  journalTtlDays: number | null;
  webAppEnabled?: boolean;
  prioritySupport?: boolean;
  advancedBackupsEnabled?: boolean;
}

export interface HostedCloudPlan {
  id: string;
  name: string;
  description?: string;
  billingMode?: string;
  amountRub?: number;
  interval?: string;
  limits: HostedCloudLimits;
}

export interface HostedCloudEntitlement {
  plan: HostedCloudPlan;
  planId?: string;
  subscription: unknown | null;
  accountStatus: string;
  status?: string;
  subscriptionStatus?: string | null;
  source?: string;
  trialEndsAt: number | null;
  effectiveUntil?: number | null;
  graceEndsAt?: number | null;
  reason: string;
  limits: HostedCloudLimits;
  retention?: {
    phase: "none" | "trial" | "read_only" | "archive" | "expired" | string;
    trialEndsAt: number | null;
    readOnlyUntil: number | null;
    archiveUntil: number | null;
    deleteEligibleAt: number | null;
  } | null;
  capabilities: {
    canUseCloud: boolean;
    canCreateVault: boolean;
    canWriteSync: boolean;
    canReadSync: boolean;
    canIssueToken: boolean;
    canDeleteCloudData: boolean;
    canExportCloudData?: boolean;
    webAppEnabled?: boolean;
    prioritySupport?: boolean;
    advancedBackupsEnabled?: boolean;
  };
  upgradeOffer?: {
    recommendedPlan: HostedCloudPlan;
    accountPortalPath: string;
  } | null;
}

export interface HostedCloudUsage {
  storageBytes: number;
  vaultCount: number;
  syncTokenCount: number;
  deviceCount?: number;
}

export interface HostedAccountDevice {
  id: string;
  credentialId: string | null;
  credentialIds?: string[];
  sessionIds?: string[];
  vaultId: string | null;
  vaultName: string;
  vaultIds?: string[];
  vaultNames?: string[];
  vaultCount?: number;
  deviceId: string | null;
  deviceName: string;
  clientPlatform: string | null;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  expiresAt: number | null;
  active: boolean;
}

export interface SyncShadow {
  key: string;
  entityType: SyncEntityKind;
  entityId: string;
  hash: string;
  deleted: boolean;
  syncedAt: number;
  revision: string | null;
}

export interface SyncDirtyEntry {
  key: string;
  entityType: SyncEntityKind;
  entityId: string;
  updatedAt: number;
  deleted: boolean;
}

export interface SyncTombstone {
  key: string;
  entityType: SyncEntityKind;
  entityId: string;
  deletedAt: number;
}

export interface DesktopLocalVaultBackupAsset {
  id: string;
  noteId: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AssetKind;
  data: string;
  version?: number;
  createdAt: number;
  updatedAt: number;
}

export interface DesktopLocalVaultBackup {
  schemaVersion: 1;
  localVaultId: string;
  savedAt: number;
  projects: Project[];
  folders: Folder[];
  tags: Tag[];
  notes: Note[];
  assets: DesktopLocalVaultBackupAsset[];
  tasks: Task[];
  habits: Habit[];
  habitLogs: HabitLog[];
  goals: Goal[];
  timeBlocks: TimeBlock[];
  settings: LegacyAppSettings | null;
  syncDirtyEntries: SyncDirtyEntry[];
  syncShadows: SyncShadow[];
  syncTombstones: SyncTombstone[];
}

export interface SyncedNoteRecord {
  id: string;
  title: string;
  contentType: NoteContentType;
  projectId: string;
  folderId: string | null;
  color: string;
  sortOrder: number;
  tagIds: string[];
  content: NoteContent;
  canvasContent: CanvasContent | null;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  favorite: boolean;
  archived: boolean;
  trashedAt: number | null;
  conflictOriginId: string | null;
}

export interface SyncedAssetRecord {
  id: string;
  noteId: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AssetKind;
  data: string;
  version?: number;
  createdAt: number;
  updatedAt: number;
}

export interface SyncVaultDescriptor {
  localVaultId: string | null;
  vaultGuid: string | null;
  name: string | null;
  vaultKind: SyncVaultKind;
  schemaVersion: number;
}

export interface SyncEncryptionDescriptor {
  version: 1;
  state: SyncEncryptionState;
  keyId: string | null;
  kdf: SyncEncryptionKdf;
  iterations: number | null;
  salt: string | null;
  keyCheck: string | null;
}

export interface SyncEncryptedPayload {
  version: 1;
  cipher: SyncEncryptionCipher;
  iv: string;
  ciphertext: string;
}

export interface SyncEnvelopeMetadata {
  schemaVersion: 1;
  payloadMode: SyncPayloadMode;
  vault: SyncVaultDescriptor | null;
  encryption: SyncEncryptionDescriptor | null;
}

export interface SyncSnapshot {
  deviceId: string;
  exportedAt: number;
  projects: Project[];
  folders: Folder[];
  tags: Tag[];
  notes: SyncedNoteRecord[];
  assets: SyncedAssetRecord[];
  tasks: Task[];
  habits: Habit[];
  habitLogs: HabitLog[];
  goals: Goal[];
  timeBlocks: TimeBlock[];
  tombstones: SyncTombstone[];
}

export interface SyncChangeSet {
  deviceId: string;
  exportedAt: number;
  projects: Project[];
  folders: Folder[];
  tags: Tag[];
  notes: SyncedNoteRecord[];
  assets: SyncedAssetRecord[];
  tasks: Task[];
  habits: Habit[];
  habitLogs: HabitLog[];
  goals: Goal[];
  timeBlocks: TimeBlock[];
  tombstones: SyncTombstone[];
}

export interface SyncEnvelope {
  revision: string | null;
  snapshot: SyncSnapshot;
  metadata?: SyncEnvelopeMetadata | null;
}

export interface SyncSecureEnvelope {
  revision: string | null;
  metadata: SyncEnvelopeMetadata;
  encryptedSnapshot: SyncEncryptedPayload;
}

export interface SyncChangeFeed {
  mode: "delta" | "snapshot";
  revision: string | null;
  baseRevision: string | null;
  changes: SyncChangeSet | null;
  encryptedChanges: SyncEncryptedPayload[] | null;
  snapshot: SyncSnapshot | null;
  metadata?: SyncEnvelopeMetadata | null;
}

export interface SyncRunStats {
  pulled: number;
  pushed: number;
  conflicts: number;
}
