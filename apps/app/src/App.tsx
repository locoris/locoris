import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";

import ConfirmDialog from "./components/ConfirmDialog";
import "./components/AdaptiveAppShell.css";
import "./components/AndroidEditorCanvas.css";
import FolderPanel from "./components/FolderPanel";
import KnowledgeMap from "./components/KnowledgeMap";
import NotesPanel from "./components/NotesPanel";
import WebAccessGate, {
  type WebAccessMode,
  type WebAuthInput
} from "./components/web/WebAccessGate";
import {
  createCanvas,
  clearTrash,
  clearPlannerData,
  createProject,
  duplicateFolder,
  duplicateNote,
  createFolder,
  createNote,
  createTag,
  consumeLegacyLocalVaultLanguage,
  db,
  ensureLocalVaultSettingsRecord,
  ensureSeedData,
  inspectFolderRemoval,
  moveNoteToTrash,
  moveFolder,
  moveNote,
  patchSettings,
  patchLocalVaultSettings,
  readLocalVaultSettings,
  repairDerivedNoteText,
  resetLocalVaultSyncBinding,
  removeProject,
  removeFolder,
  removeNote,
  removeTag,
  restoreNoteFromTrash,
  renameFolder,
  renameProject,
  renameTag,
  loadCanvasFiles,
  resolveAssetUrl,
  switchActiveLocalVaultDatabase,
  withLocalVaultDatabase,
  saveCanvasContent,
  saveNoteContent,
  storeAsset,
  updateFolderColor,
  updateProjectColor,
  updateProjectPosition,
  updateProjectSortOrder,
  updateNoteMeta
} from "./data/db";
import { createEncryptionDescriptor, verifyEncryptionPassphrase } from "./lib/e2ee";
import {
  APP_ACCENT_THEME_STORAGE_KEY,
  applyAppAccentThemeToRoot,
  readStoredAppAccentThemeId,
  resolveAppAccentThemeId,
  writeStoredAppAccentThemeId,
  type AppAccentThemeId
} from "./lib/accentThemes";
import {
  ORBITAL_ANIMATION_MODE_STORAGE_KEY,
  ORBITAL_TEMPORAL_SIGNALS_STORAGE_KEY,
  readStoredOrbitalAnimationMode,
  readStoredOrbitalTemporalSignalsMode,
  resolveOrbitalAnimationMode,
  resolveOrbitalTemporalSignalsMode,
  writeStoredOrbitalAnimationMode,
  writeStoredOrbitalTemporalSignalsMode,
  type OrbitalAnimationMode,
  type OrbitalTemporalSignalsMode
} from "./lib/interfacePreferences";
import {
  hasVaultEncryptionSession,
  getVaultEncryptionSessionPassphrase,
  lockVaultEncryptionSession,
  unlockVaultEncryptionSession
} from "./lib/e2eeSession";
import {
  buildFolderPathMap,
  getDescendantFolderIds,
  getFolderCascade,
  matchSearch,
  normalizeChecklistOrdering,
  updateChecklistItemChecked
} from "./lib/notes";
import {
  createLocalVaultProfile,
  deleteLocalVaultDatabase,
  getLocalVaultProfile,
  getLocalVaultProfileByGuid,
  getNextLocalVaultAfterDelete,
  getStoredActiveLocalVaultId,
  listLocalVaultProfiles,
  removeLocalVaultProfile,
  renameLocalVaultProfile,
  resolveUniqueLocalVaultName,
  setStoredActiveLocalVaultId,
  syncLocalVaultGuidsWithBindings,
  type LocalVaultKind,
  updateLocalVaultProfile
} from "./lib/localVaults";
import {
  getDisplayNoteTitle,
  getDisplayProjectName,
  getDisplayVaultName
} from "./localization/displayNames";
import { hasExplicitDisplayName } from "./lib/displayNames";
import {
  initializeAppUpdateState,
  readAppUpdateSnapshot,
  startAutomaticAppUpdateCheck,
  subscribeAppUpdateState,
  supportsAppUpdates,
  type AppUpdateSnapshot
} from "./lib/appUpdates";
import {
  clearGoogleDriveAccountSession,
  connectGoogleDriveAccount,
  deleteHostedVault,
  deleteGoogleDriveVault,
  deletePersonalServerVault,
  importRemoteVaultIntoLocalVault,
  loadHostedAccountOverview,
  migrateRemoteVaultEncryption,
  pollGoogleDriveRemoteChanges,
  primeRemoteVaultEncryptionMetadata,
  refreshGoogleDriveAccountSession,
  GOOGLE_DRIVE_TOKEN_REFRESH_SKEW_MS,
  revokeGoogleDriveAccountAccess,
  issueGoogleDriveVaultToken,
  issuePersonalServerVaultToken,
  loginHostedAccount,
  refreshHostedAccountSession,
  registerHostedVaultDevice,
  registerHostedAccount,
  renameGoogleDriveVault,
  renameHostedVault,
  renamePersonalServerVault,
  runConfiguredSync,
  type HostedAccountOverview
} from "./lib/sync";
import { computePendingSyncSummaryFromDirtyEntries } from "./lib/syncStatus";
import {
  clearSyncBinding,
  createSyncConnection,
  initializeSecureSyncRegistryState,
  listSyncBindings,
  listSyncConnections,
  migrateSyncRegistryFromLegacyVaultSettings,
  removeBindingsForLocalVault,
  removeSyncConnection,
  updateSyncConnection,
  updateSyncBindingRemoteName,
  updateSyncBindingState,
  upsertSyncBinding
} from "./lib/syncRegistry";
import { subscribeSecureSecretChanges } from "./lib/secureSecretStore";
import {
  hasIncomingSelfHostedConnectionPackage,
  SELF_HOSTED_INVITE_EVENT
} from "./lib/selfHostedPairing";
import {
  hasPendingSelfHostedEndpointUpdate,
  SELF_HOSTED_ENDPOINT_UPDATE_EVENT
} from "./lib/selfHostedEndpointUpdates";
import { DEFAULT_NOTE_COLOR } from "./lib/palette";
import { getErrorMessage } from "./lib/errors";
import { isHostedReauthRequiredError } from "./lib/hostedAuthErrors";
import { useAdaptiveLayout } from "./lib/useAdaptiveLayout";
import useAutoDismissNotice from "./lib/useAutoDismissNotice";
import { planExactHostedVaultBindingRecovery } from "./lib/cloudBindingRecovery";
import {
  canRefreshHostedSession,
  refreshHostedSessionSingleFlight,
  shouldRefreshHostedSession
} from "./lib/hostedSessionRefresh";
import { getHostedDeviceIdentity } from "./lib/hostedDeviceIdentity";
import {
  createLocorisBackupBlob,
  getVaultBackupFileName
} from "./lib/exportImport/vaultBackup";
import { saveBlobFileWithDialog } from "./lib/nativeFileIntegration";
import { hasMeaningfulCanvasContent } from "./lib/canvas";
import { hasMeaningfulNoteContent } from "./lib/notes";
import {
  createPlannerHabit as createPlannerHabitRecord,
  removePlannerHabit as removePlannerHabitRecord,
  createPlannerTimeBlock as createPlannerTimeBlockRecord,
  createPlannerTask as createPlannerTaskRecord,
  togglePlannerHabitLogForDay as togglePlannerHabitLogForDayRecord,
  removePlannerTimeBlock as removePlannerTimeBlockRecord,
  removePlannerTask as removePlannerTaskRecord,
  setPlannerTaskDone as setPlannerTaskDoneRecord,
  updatePlannerHabit as updatePlannerHabitRecord,
  updatePlannerTimeBlock as updatePlannerTimeBlockRecord,
  updatePlannerTask as updatePlannerTaskRecord,
  type PlannerViewId
} from "./lib/planner";

type WebCloudAuthState =
  | "signedOut"
  | "checking"
  | "authenticated"
  | "offline"
  | "serverUnavailable"
  | "reauthRequired";
import {
  buildPlannerTaskLinks,
  normalizePlannerContextTaskTitle,
  type PlannerContextTaskInput
} from "./lib/plannerLinks";
import { syncPlannerReminderNotifications } from "./lib/plannerReminders";
import {
  formatByteValue,
  formatDateValue,
  formatTimeValue,
  useLocale,
  type LocaleRuntime
} from "./localization";
import type {
  AppSettings,
  AppLanguage,
  HostedAccountVault,
  MobileSection,
  Note,
  NoteListView,
  RemoteVaultImportResult,
  SaveState,
  SyncConnection,
  SyncConnectionProvider,
  SyncEncryptionDescriptor,
  SyncVaultBinding,
  VaultEncryptionSummary
} from "./types";

const EditorPane = lazy(() => import("./components/EditorPane"));
const CanvasPane = lazy(() => import("./components/CanvasPane"));
const OrbitalMapView = lazy(() => import("./components/OrbitalMapView"));
const PlannerSurface = lazy(() => import("./components/planner/PlannerSurface"));
const SettingsPanel = lazy(() => import("./components/SettingsPanel"));
const TrashPanel = lazy(() => import("./components/TrashPanel"));

interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  details?: string[];
}

function useOnlineStatus() {
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}

function resolveLocorisCloudServerUrl(settings: AppSettings, connection?: SyncConnection | null) {
  return (
    connection?.serverUrl.trim() ||
    settings.hostedUrl.trim() ||
    import.meta.env.VITE_LOCORIS_CLOUD_URL?.trim() ||
    (import.meta.env.DEV ? "http://localhost:8787" : "")
  );
}

function buildLocorisCloudAccountUrl(serverUrl: string, view?: "overview" | "vaults" | "devices" | "billing") {
  const configuredAccountUrl = import.meta.env.VITE_LOCORIS_ACCOUNT_URL?.trim();

  if (!serverUrl && !configuredAccountUrl) {
    return null;
  }

  try {
    const accountUrl = configuredAccountUrl
      ? new URL(configuredAccountUrl)
      : new URL("/account", `${serverUrl.replace(/\/+$/, "")}/`);

    if (view) {
      accountUrl.searchParams.set("view", view);
    }

    return accountUrl.toString();
  } catch {
    return null;
  }
}

function formatCloudBytes(value: number | null | undefined, runtime: LocaleRuntime) {
  return formatByteValue(Number(value ?? 0), runtime);
}

function formatCloudDate(timestamp: number | null | undefined, runtime: LocaleRuntime) {
  if (!timestamp) {
    return "";
  }

  return formatDateValue(timestamp, runtime, {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function getLimitRatio(value: number, limit: number | null | undefined) {
  if (limit === null || limit === undefined) {
    return null;
  }

  if (limit <= 0) {
    return value > 0 ? 1 : 0;
  }

  return value / limit;
}

function getLimitTone(value: number, limit: number | null | undefined) {
  if (limit === null || limit === undefined || limit <= 0) {
    return "default" as const;
  }

  const ratio = value / limit;

  if (ratio >= 1) {
    return "error" as const;
  }

  if (ratio >= 0.8) {
    return "warning" as const;
  }

  return "success" as const;
}

function getEntitlementTone(entitlement: HostedAccountOverview["entitlement"] | null | undefined) {
  const status = entitlement?.status ?? entitlement?.subscriptionStatus ?? entitlement?.accountStatus;

  if (status === "blocked") {
    return "error" as const;
  }

  if (
    status === "read_only" ||
    status === "past_due" ||
    status === "expired" ||
    status === "archived" ||
    status === "trialing" ||
    status === "grace"
  ) {
    return "warning" as const;
  }

  if (status === "active" || status === "manual_comp") {
    return "success" as const;
  }

  return "default" as const;
}

export default function App() {
  const { t } = useTranslation();
  const {
    preferences: localePreferences,
    runtime: localeRuntime,
    updatePreferences: updateLocalePreferences,
    migrateLegacyLanguage
  } = useLocale();
  const adaptiveLayout = useAdaptiveLayout();
  const online = useOnlineStatus();
  const [activeLocalVaultId, setActiveLocalVaultId] = useState(() => getStoredActiveLocalVaultId());
  const [localVaults, setLocalVaults] = useState(() => listLocalVaultProfiles());
  const [selectedSyncVaultId, setSelectedSyncVaultId] = useState(() => getStoredActiveLocalVaultId());
  const [accentThemeId, setAccentThemeId] = useState<AppAccentThemeId>(() =>
    readStoredAppAccentThemeId()
  );
  const [orbitalAnimationMode, setOrbitalAnimationMode] =
    useState<OrbitalAnimationMode>(() => readStoredOrbitalAnimationMode());
  const [orbitalTemporalSignalsMode, setOrbitalTemporalSignalsMode] =
    useState<OrbitalTemporalSignalsMode>(() => readStoredOrbitalTemporalSignalsMode());
  const [syncConnections, setSyncConnections] = useState(() => listSyncConnections());
  const [syncBindings, setSyncBindings] = useState(() => listSyncBindings());
  const [vaultEncryptionById, setVaultEncryptionById] = useState<Record<string, VaultEncryptionSummary>>({});
  const [settingsOpenRequest, setSettingsOpenRequest] = useState<{
    view: "accountCloud" | "sync";
    requestId: number;
  } | null>(() =>
    hasIncomingSelfHostedConnectionPackage() || hasPendingSelfHostedEndpointUpdate()
      ? { view: "sync", requestId: 1 }
      : null
  );
  const [webCloudOverview, setWebCloudOverview] = useState<HostedAccountOverview | null>(null);
  const [webCloudAuthState, setWebCloudAuthState] = useState<WebCloudAuthState>("checking");
  const [webCloudInitialCheckComplete, setWebCloudInitialCheckComplete] = useState(
    () => adaptiveLayout.runtimeKind !== "web"
  );
  const [webCloudRetryTick, setWebCloudRetryTick] = useState(0);
  const [webCloudBusy, setWebCloudBusy] = useState(false);
  const [webAccessFeedback, setWebAccessFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const openAccountCloudSettings = useCallback(() => {
    setSettingsOpenRequest((current) => ({
      view: "accountCloud",
      requestId: (current?.requestId ?? 0) + 1
    }));
  }, []);
  const handleSettingsOpenRequestHandled = useCallback(() => {
    setSettingsOpenRequest(null);
  }, []);
  useEffect(() => {
    const openSelfHostedInvite = () => {
      setSettingsOpenRequest((current) => ({
        view: "sync",
        requestId: (current?.requestId ?? 0) + 1
      }));
    };
    window.addEventListener(SELF_HOSTED_INVITE_EVENT, openSelfHostedInvite);
    window.addEventListener(SELF_HOSTED_ENDPOINT_UPDATE_EVENT, openSelfHostedInvite);
    return () => {
      window.removeEventListener(SELF_HOSTED_INVITE_EVENT, openSelfHostedInvite);
      window.removeEventListener(SELF_HOSTED_ENDPOINT_UPDATE_EVENT, openSelfHostedInvite);
    };
  }, []);
  const [vaultBooting, setVaultBooting] = useState(true);
  const projects = useLiveQuery(() => db.projects.toArray(), [activeLocalVaultId], []);
  const folders = useLiveQuery(() => db.folders.toArray(), [activeLocalVaultId], []);
  const tags = useLiveQuery(() => db.tags.toArray(), [activeLocalVaultId], []);
  const notes = useLiveQuery(() => db.notes.toArray(), [activeLocalVaultId], []);
  const assets = useLiveQuery(() => db.assets.toArray(), [activeLocalVaultId], []);
  const tasks = useLiveQuery(() => db.tasks.toArray(), [activeLocalVaultId], []);
  const habits = useLiveQuery(() => db.habits.toArray(), [activeLocalVaultId], []);
  const habitLogs = useLiveQuery(() => db.habitLogs.toArray(), [activeLocalVaultId], []);
  const goals = useLiveQuery(() => db.goals.toArray(), [activeLocalVaultId], []);
  const timeBlocks = useLiveQuery(() => db.timeBlocks.toArray(), [activeLocalVaultId], []);
  const syncDirtyEntries = useLiveQuery(() => db.syncDirtyEntries.toArray(), [activeLocalVaultId], []);
  const rawSettings = useLiveQuery(() => db.settings.get("app"), [activeLocalVaultId], undefined);
  const [settings, setSettings] = useState<AppSettings | undefined>(undefined);
  const [secureSecretsVersion, setSecureSecretsVersion] = useState(0);

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [mobileSection, setMobileSection] = useState<MobileSection>("notes");
  const [viewMode, setViewMode] = useState<NoteListView>("all");
  const [search, setSearch] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [orbitalOpen, setOrbitalOpen] = useState(false);
  const [orbitalEditorNoteId, setOrbitalEditorNoteId] = useState<string | null>(null);
  const [plannerProjectFocusId, setPlannerProjectFocusId] = useState<string | null>(null);
  const [plannerNavigationRequest, setPlannerNavigationRequest] = useState<{
    viewId: PlannerViewId;
    requestId: number;
  } | null>(null);
  const [orbitalProjectFocusRequest, setOrbitalProjectFocusRequest] = useState<{
    projectId: string;
    requestId: number;
  } | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  useAutoDismissNotice(syncFeedback, setSyncFeedback, { successMs: 5200 });
  useAutoDismissNotice(webAccessFeedback, setWebAccessFeedback, { successMs: 5200 });
  const [syncTransportIndicator, setSyncTransportIndicator] = useState<{
    localVaultId: string;
    tone: "default" | "success" | "warning" | "error";
    text: string;
    title: string;
  } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [appUpdateChip, setAppUpdateChip] = useState<
    | {
        kind: "available" | "issue";
        version: string | null;
      }
    | null
  >(null);
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState !== "hidden"
  );
  const currentAppLanguage = localeRuntime.interfaceLocale as AppLanguage;

  useEffect(() => {
    void syncPlannerReminderNotifications(tasks, currentAppLanguage);
  }, [currentAppLanguage, tasks]);

  const confirmResolverRef = useRef<((value: boolean) => void) | null>(null);
  const autoSyncTimerRef = useRef<number | null>(null);
  const syncTransportTimerRef = useRef<number | null>(null);
  const syncInFlightRef = useRef(false);
  const syncRerunRequestedRef = useRef(false);
  const bootSyncKeyRef = useRef<string | null>(null);
  const hostedBindingRecoveryPromiseRef = useRef<Promise<{
    restored: number;
    failed: number;
  }> | null>(null);
  const hostedBindingReconciliationKeyRef = useRef<string | null>(null);
  const lastRemoteRefreshAtRef = useRef<Record<string, number>>({});
  const previousOnlineRef = useRef(online);
  const previousVisibilityRef = useRef(isDocumentVisible);
  const previousOrbitalEditorNoteIdRef = useRef<string | null>(null);
  const newDocumentDraftIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    return subscribeSecureSecretChanges(() => {
      setSecureSecretsVersion((current) => current + 1);
    });
  }, [t]);

  useEffect(() => {
    if (!supportsAppUpdates()) {
      setAppUpdateChip(null);
      return () => undefined;
    }

    const syncAppUpdateChip = (snapshot: AppUpdateSnapshot) => {
      if (snapshot.phase === "available" && snapshot.availableVersion) {
        setAppUpdateChip({
          kind: "available",
          version: snapshot.availableVersion
        });
        return;
      }

      if (
        snapshot.phase === "failed" &&
        snapshot.issueCode &&
        snapshot.issueCode !== "check-failed" &&
        snapshot.issueCode !== "unsupported"
      ) {
        setAppUpdateChip({
          kind: "issue",
          version: snapshot.availableVersion ?? snapshot.lastAttemptedVersion
        });
        return;
      }

      setAppUpdateChip(null);
    };

    void initializeAppUpdateState();
    syncAppUpdateChip(readAppUpdateSnapshot());

    return subscribeAppUpdateState(syncAppUpdateChip);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!rawSettings) {
      setSettings(undefined);
      return () => {
        cancelled = true;
      };
    }

    void readLocalVaultSettings(activeLocalVaultId)
      .then((nextSettings) => {
        if (!cancelled) {
          setSettings(nextSettings ?? undefined);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSettings(undefined);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeLocalVaultId, rawSettings, secureSecretsVersion]);

  useEffect(() => {
    let cancelled = false;
    setVaultBooting(true);

    void ensureSeedData()
      .then(() => repairDerivedNoteText())
      .finally(() => {
        if (!cancelled) {
          setVaultBooting(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeLocalVaultId]);

  const refreshSyncRegistryState = useCallback(() => {
    setSyncConnections(listSyncConnections());
    setSyncBindings(listSyncBindings());
  }, []);

  useEffect(() => {
    let cancelled = false;

    void initializeSecureSyncRegistryState()
      .then(() => {
        if (!cancelled) {
          refreshSyncRegistryState();
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    refreshSyncRegistryState();
  }, [secureSecretsVersion]);

  const buildVaultEncryptionSummary = useCallback(
    (
      localVaultId: string,
      vaultSettings:
        | {
            encryptionEnabled?: boolean;
            encryptionKeyId?: string | null;
            encryptionUpdatedAt?: number | null;
          }
        | null
        | undefined
    ): VaultEncryptionSummary => {
      const enabled = Boolean(vaultSettings?.encryptionEnabled);

      return {
        enabled,
        state: enabled
          ? hasVaultEncryptionSession(localVaultId)
            ? "ready"
            : "locked"
          : "disabled",
        keyId: enabled ? vaultSettings?.encryptionKeyId ?? null : null,
        updatedAt: enabled ? vaultSettings?.encryptionUpdatedAt ?? null : null
      };
    },
    []
  );

  const refreshVaultEncryptionSummaries = useCallback(
    async (targetLocalVaultIds?: string[]) => {
      const ids =
        targetLocalVaultIds && targetLocalVaultIds.length > 0
          ? [...new Set(targetLocalVaultIds)]
          : localVaults.map((vault) => vault.id);

      const entries = await Promise.all(
        ids.map(async (localVaultId) => {
          const vaultSettings = await readLocalVaultSettings(localVaultId);

          return [localVaultId, buildVaultEncryptionSummary(localVaultId, vaultSettings)] as const;
        })
      );

      setVaultEncryptionById((current) => ({
        ...current,
        ...Object.fromEntries(entries)
      }));
    },
    [buildVaultEncryptionSummary, localVaults]
  );

  const syncVaultKindsFromEncryptionState = useCallback(
    async (targetLocalVaultIds?: string[]) => {
      const registryVaults = listLocalVaultProfiles();
      const ids =
        targetLocalVaultIds && targetLocalVaultIds.length > 0
          ? [...new Set(targetLocalVaultIds)]
          : registryVaults.map((vault) => vault.id);
      let changed = false;

      for (const localVaultId of ids) {
        const vault = registryVaults.find((entry) => entry.id === localVaultId) ?? null;

        if (!vault) {
          continue;
        }

        const vaultSettings = await readLocalVaultSettings(localVaultId);
        const nextKind: LocalVaultKind = vaultSettings?.encryptionEnabled === true ? "private" : "regular";

        if (nextKind !== vault.vaultKind) {
          updateLocalVaultProfile(localVaultId, {
            vaultKind: nextKind
          });
          changed = true;
        }
      }

      if (changed) {
        setLocalVaults(listLocalVaultProfiles());
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    void migrateSyncRegistryFromLegacyVaultSettings(
      listLocalVaultProfiles().map((vault) => vault.id),
      readLocalVaultSettings
    ).then(() => {
      if (!cancelled) {
        refreshSyncRegistryState();
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (localVaults.some((vault) => vault.id === selectedSyncVaultId)) {
      return;
    }

    setSelectedSyncVaultId(activeLocalVaultId);
  }, [activeLocalVaultId, localVaults, selectedSyncVaultId]);

  useEffect(() => {
    const nextVaults = syncLocalVaultGuidsWithBindings(syncBindings);

    if (
      nextVaults.length !== localVaults.length ||
      nextVaults.some((vault, index) => vault.vaultGuid !== localVaults[index]?.vaultGuid)
    ) {
      setLocalVaults(nextVaults);
    }
  }, [localVaults, syncBindings]);

  useEffect(() => {
    let cancelled = false;

    void refreshVaultEncryptionSummaries()
      .then(() => syncVaultKindsFromEncryptionState())
      .catch(() => {
      if (!cancelled) {
        setVaultEncryptionById((current) => current);
      }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshVaultEncryptionSummaries, syncVaultKindsFromEncryptionState]);

  useEffect(() => {
    let cancelled = false;

    void readLocalVaultSettings(activeLocalVaultId)
      .then((vaultSettings) => {
        if (cancelled) {
          return;
        }

        setVaultEncryptionById((current) => ({
          ...current,
          [activeLocalVaultId]: buildVaultEncryptionSummary(activeLocalVaultId, vaultSettings)
        }));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [activeLocalVaultId, buildVaultEncryptionSummary, settings]);

  useEffect(() => {
    applyAppAccentThemeToRoot(accentThemeId);
  }, [accentThemeId]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === APP_ACCENT_THEME_STORAGE_KEY) {
        setAccentThemeId(resolveAppAccentThemeId(event.newValue));
      }

      if (event.key === ORBITAL_ANIMATION_MODE_STORAGE_KEY) {
        setOrbitalAnimationMode(resolveOrbitalAnimationMode(event.newValue));
      }

      if (event.key === ORBITAL_TEMPORAL_SIGNALS_STORAGE_KEY) {
        setOrbitalTemporalSignalsMode(resolveOrbitalTemporalSignalsMode(event.newValue));
      }
    };

    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    let active = true;

    void consumeLegacyLocalVaultLanguage(activeLocalVaultId).then((legacyLanguage) => {
      if (active) {
        return migrateLegacyLanguage(legacyLanguage);
      }
    });

    return () => {
      active = false;
    };
  }, [activeLocalVaultId, migrateLegacyLanguage]);

  useEffect(() => {
    if (!online || !supportsAppUpdates()) {
      return;
    }

    void startAutomaticAppUpdateCheck();
  }, [online]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState !== "hidden");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const folderMap = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const tagMap = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const folderPathMap = useMemo(() => buildFolderPathMap(folders), [folders]);
  const activeNotes = useMemo(() => notes.filter((note) => note.trashedAt === null), [notes]);
  const trashedNotes = useMemo(
    () =>
      [...notes]
        .filter((note) => note.trashedAt !== null)
        .sort((left, right) => (right.trashedAt ?? right.updatedAt) - (left.trashedAt ?? left.updatedAt)),
    [notes]
  );

  const filteredNotes = useMemo(() => {
    const folderScope =
      selectedFolderId !== null ? getDescendantFolderIds(selectedFolderId, folders) : null;

    return [...notes]
      .filter((note) => {
        if (viewMode === "trash") {
          return note.trashedAt !== null;
        }

        if (note.trashedAt !== null) {
          return false;
        }

        if (viewMode === "favorites") {
          return note.pinned || note.favorite;
        }

        return true;
      })
      .filter((note) => {
        if (!folderScope) {
          return true;
        }

        return note.folderId ? folderScope.has(note.folderId) : false;
      })
      .filter((note) => (selectedTagId ? note.tagIds.includes(selectedTagId) : true))
      .filter((note) => matchSearch(note, search, tagMap))
      .sort((left, right) => {
        const leftFavorite = left.pinned || left.favorite;
        const rightFavorite = right.pinned || right.favorite;

        if (leftFavorite !== rightFavorite) {
          return leftFavorite ? -1 : 1;
        }

        if (left.pinned !== right.pinned) {
          return left.pinned ? -1 : 1;
        }

        return right.updatedAt - left.updatedAt;
      });
  }, [folders, notes, search, selectedFolderId, selectedTagId, tagMap, viewMode]);

  useEffect(() => {
    if (!settings) {
      return;
    }

    const preferredId = selectedNoteId ?? settings.lastOpenedNoteId;
    const candidate = filteredNotes.find((note) => note.id === preferredId) ?? filteredNotes[0] ?? null;

    if (candidate && candidate.id !== selectedNoteId) {
      setSelectedNoteId(candidate.id);
      return;
    }

    if (!candidate && selectedNoteId !== null) {
      setSelectedNoteId(null);
    }
  }, [filteredNotes, selectedNoteId, settings]);

  const activeNote =
    filteredNotes.find((note) => note.id === selectedNoteId) ??
    filteredNotes[0] ??
    null;
  const orbitalEditorEntry =
    notes.find((note) => note.id === orbitalEditorNoteId && note.trashedAt === null) ?? null;
  const syncBindingsByVaultId = useMemo(
    () => new Map(syncBindings.map((binding) => [binding.localVaultId, binding])),
    [syncBindings]
  );
  const syncConnectionsById = useMemo(
    () => new Map(syncConnections.map((connection) => [connection.id, connection])),
    [syncConnections]
  );
  const locorisCloudConnections = useMemo(
    () =>
      syncConnections
        .filter((connection) => connection.provider === "hosted" && connection.role === "locorisCloud")
        .sort((left, right) => right.updatedAt - left.updatedAt),
    [syncConnections]
  );
  const locorisCloudConnection = locorisCloudConnections[0] ?? null;
  const locorisCloudConnectionIds = useMemo(
    () => new Set(locorisCloudConnections.map((connection) => connection.id)),
    [locorisCloudConnections]
  );
  const activeLocorisCloudBinding =
    syncBindings.find(
      (binding) =>
        binding.localVaultId === activeLocalVaultId &&
        locorisCloudConnectionIds.has(binding.connectionId)
    ) ?? null;
  const activeVaultBinding = syncBindingsByVaultId.get(activeLocalVaultId) ?? null;
  const activeVaultConnection = activeVaultBinding
    ? syncConnectionsById.get(activeVaultBinding.connectionId) ?? null
    : null;
  const activeVaultEncryption = vaultEncryptionById[activeLocalVaultId] ?? {
    enabled: false,
    state: "disabled" as const,
    keyId: null,
    updatedAt: null
  };

  const refreshHostedConnectionSession = useCallback(
    async (connection: SyncConnection, options: { force?: boolean } = {}) => {
      if (connection.provider !== "hosted") {
        return connection;
      }

      if (!settings) {
        throw new Error("APP_SETTINGS_NOT_READY");
      }

      if (!options.force && !shouldRefreshHostedSession(connection)) {
        return connection;
      }

      const result = await refreshHostedSessionSingleFlight(
        connection,
        getHostedDeviceIdentity(settings.localDeviceId)
      );
      const nextConnection = {
        ...connection,
        sessionToken: result.session.token,
        refreshToken: result.session.refreshToken ?? connection.refreshToken ?? "",
        tokenExpiresAt: result.session.expiresAt,
        userId: result.user.id,
        userName: result.user.name,
        userEmail: result.user.email ?? connection.userEmail,
        label: result.user.email ?? result.user.name,
        updatedAt: Date.now()
      } satisfies SyncConnection;

      await updateSyncConnection(connection.id, {
        label: nextConnection.label,
        sessionToken: nextConnection.sessionToken,
        refreshToken: nextConnection.refreshToken ?? null,
        tokenExpiresAt: nextConnection.tokenExpiresAt,
        userId: nextConnection.userId,
        userName: nextConnection.userName,
        userEmail: nextConnection.userEmail
      });

      if (
        adaptiveLayout.runtimeKind === "web" &&
        connection.role === "locorisCloud" &&
        result.entitlement
      ) {
        const { token: _accessToken, ...session } = result.session;
        const entitlement = result.entitlement;

        setWebCloudOverview((current) => ({
          user: result.user,
          session,
          vaults: current?.user.id === result.user.id ? current.vaults : [],
          devices: current?.user.id === result.user.id ? current.devices : [],
          usage: current?.user.id === result.user.id
            ? current.usage
            : {
                storageBytes: 0,
                vaultCount: 0,
                syncTokenCount: 0,
                deviceCount: 0
              },
          entitlement
        }));
        setWebCloudAuthState("authenticated");
        setWebCloudInitialCheckComplete(true);
      }

      refreshSyncRegistryState();
      return nextConnection;
    },
    [adaptiveLayout.runtimeKind, settings]
  );

  useEffect(() => {
    if (!online || !settings) {
      return;
    }

    const hostedConnections = syncConnections.filter(
      (connection) => canRefreshHostedSession(connection)
    );

    if (hostedConnections.length === 0) {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    const refreshDueSessions = async () => {
      for (const connection of hostedConnections) {
        if (cancelled || !shouldRefreshHostedSession(connection)) {
          continue;
        }

        try {
          await refreshHostedConnectionSession(connection, { force: true });
        } catch (error) {
          if (
            connection.role === "locorisCloud" &&
            isHostedReauthRequiredError(error)
          ) {
            setWebCloudAuthState("reauthRequired");
          }
        }
      }
    };

    const nextExpiry = hostedConnections.reduce<number | null>((earliest, connection) => {
      if (!connection.tokenExpiresAt) {
        return earliest;
      }

      return earliest === null ? connection.tokenExpiresAt : Math.min(earliest, connection.tokenExpiresAt);
    }, null);
    const delay = nextExpiry
      ? Math.max(1_000, Math.min(60_000, nextExpiry - Date.now() - 120_000))
      : 60_000;

    const scheduleNextRefresh = () => {
      timer = window.setTimeout(async () => {
        await refreshDueSessions();
        if (!cancelled) {
          scheduleNextRefresh();
        }
      }, delay);
    };

    void refreshDueSessions();
    scheduleNextRefresh();

    const handleResume = () => void refreshDueSessions();
    window.addEventListener("online", handleResume);
    document.addEventListener("visibilitychange", handleResume);

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      window.removeEventListener("online", handleResume);
      document.removeEventListener("visibilitychange", handleResume);
    };
  }, [online, refreshHostedConnectionSession, settings, syncConnections]);
  const translateSyncError = useCallback(
    (
      error: unknown,
      provider: "selfHosted" | "hosted" | "googleDrive" | null = null
    ) => {
      const message = getErrorMessage(error);

      switch (message) {
        case "SELF_HOSTED_URL_REQUIRED":
          return t("sync.urlRequired");
        case "HOSTED_URL_REQUIRED":
          return t("sync.hostedUrlRequired");
        case "SELF_HOSTED_TOKEN_REQUIRED":
          return t("sync.tokenRequired");
        case "HOSTED_SYNC_TOKEN_REQUIRED":
          return t("sync.hostedTokenRequired");
        case "SELF_HOSTED_VAULT_REQUIRED":
          return t("sync.vaultRequired");
        case "HOSTED_VAULT_REQUIRED":
          return t("sync.hostedVaultRequired");
        case "GOOGLE_DRIVE_AUTH_REQUIRED":
          return t("sync.googleDriveAuthRequired");
        case "GOOGLE_DRIVE_INTERACTION_REQUIRED":
          return t("sync.googleDriveInteractionRequired");
        case "GOOGLE_DRIVE_STORAGE_QUOTA_EXCEEDED":
          return t("sync.googleDriveStorageQuotaExceeded");
        case "GOOGLE_DRIVE_RATE_LIMITED":
          return t("sync.googleDriveRateLimited");
        case "GOOGLE_DRIVE_PERMISSION_REQUIRED":
          return t("sync.googleDrivePermissionRequired");
        case "GOOGLE_DRIVE_REQUEST_TIMEOUT":
          return t("sync.googleDriveRequestTimeout");
        case "GOOGLE_DRIVE_INVALID_PAYLOAD":
        case "GOOGLE_DRIVE_MANIFEST_CORRUPT":
        case "GOOGLE_DRIVE_JOURNAL_CORRUPT":
        case "GOOGLE_DRIVE_V2_DATA_CORRUPT":
          return t("sync.googleDriveDataCorrupt");
        case "GOOGLE_DRIVE_RESUMABLE_UPLOAD_FAILED":
          return t("sync.googleDriveUploadFailed");
        case "GOOGLE_OAUTH_REVOKE_FAILED":
          return t("sync.googleDriveRevokeFailed");
        case "GOOGLE_DRIVE_CLIENT_ID_REQUIRED":
          return t("sync.googleDriveClientIdRequired");
        case "GOOGLE_OAUTH_ANDROID_CONFIG_INVALID":
          return t("sync.googleDriveAndroidConfigInvalid");
        case "GOOGLE_OAUTH_INVALID_REQUEST":
          return t("sync.googleDriveDesktopConfigInvalid");
        case "GOOGLE_OAUTH_POPUP_CLOSED":
        case "GOOGLE_OAUTH_ACCESS_DENIED":
          return t("sync.googleDrivePopupClosed");
        case "GOOGLE_OAUTH_POPUP_FAILED":
        case "GOOGLE_OAUTH_BROWSER_OPEN_FAILED":
          return t("sync.googleDrivePopupFailed");
        case "GOOGLE_OAUTH_REDIRECT_TIMEOUT":
          return t("sync.googleDriveRedirectTimeout");
        case "GOOGLE_OAUTH_CALLBACK_FAILED":
          return t("sync.googleDriveRedirectFailed");
        case "GOOGLE_OAUTH_DESKTOP_INSTALL_REQUIRED":
          return t("sync.googleDriveDesktopInstallRequired");
        case "GOOGLE_OAUTH_IN_PROGRESS":
          return t("sync.googleDriveAuthInProgress");
        case "GOOGLE_OAUTH_SCRIPT_FAILED":
        case "GOOGLE_OAUTH_UNAVAILABLE":
        case "NETWORK_ERROR":
          return t("sync.googleDriveSdkFailed");
        case "GOOGLE_OAUTH_FAILED":
          return t("sync.googleDriveOAuthFailed");
        case "GOOGLE_PLAY_SERVICES_UNAVAILABLE":
          return t("sync.googleDrivePlayServicesUnavailable");
        case "ENCRYPTED_SYNC_NOT_IMPLEMENTED":
          return t("sync.googleDriveEncryptedPending");
        case "VAULT_ENCRYPTION_LOCKED":
          return t("sync.vaultEncryptionSyncLocked");
        case "VAULT_ENCRYPTION_REMOTE_SYNC_REQUIRED":
          return t("sync.vaultEncryptionRemoteMigrationRequired");
        case "UNAUTHORIZED":
          return provider === "hosted"
            ? t("sync.hostedUnauthorized")
            : t("sync.unauthorized");
        case "CLOUD_REAUTH_REQUIRED":
        case "REFRESH_TOKEN_INVALID":
        case "REFRESH_TOKEN_REVOKED":
        case "REFRESH_TOKEN_EXPIRED":
        case "REFRESH_TOKEN_REUSED":
        case "REFRESH_TOKEN_DEVICE_MISMATCH":
          return t("sync.hostedSessionExpired");
        case "PLAN_REQUIRED":
          return t("sync.cloudPlanRequired");
        case "TRIAL_EXPIRED":
        case "TRIAL_EXPIRED_READ_ONLY":
        case "TRIAL_ARCHIVED":
          return t("sync.cloudTrialExpired");
        case "TRIAL_RETENTION_EXPIRED":
          return t("sync.cloudTrialRetentionExpired");
        case "SUBSCRIPTION_PAST_DUE":
          return t("sync.cloudSubscriptionPastDue");
        case "SUBSCRIPTION_EXPIRED_READ_ONLY":
          return t("sync.cloudReadOnly");
        case "SUBSCRIPTION_BLOCKED":
          return t("sync.cloudAccountBlocked");
        case "OVER_STORAGE_LIMIT":
          return t("sync.cloudStorageLimit");
        case "OVER_VAULT_LIMIT":
          return t("sync.cloudVaultLimit");
        case "OVER_DEVICE_LIMIT":
          return t("sync.cloudDeviceLimit");
        case "PAYLOAD_TOO_LARGE":
          return t("sync.cloudPayloadTooLarge");
        case "RATE_LIMITED":
          return t("sync.cloudRateLimited");
        case "WEB_APP_NOT_INCLUDED":
          return t("webAccess.unavailableDescription");
        case "VAULT_NOT_FOUND":
          return t("sync.vaultNotFound");
        case "VAULT_ACCESS_DENIED":
          return t("sync.selfHostedVaultAccessDenied");
        case "VAULT_READ_ONLY":
          return t("sync.selfHostedVaultReadOnly");
        case "LAST_VAULT_REQUIRED":
          return t("sync.lastRemoteVaultRequired");
        case "SYNC_REVISION_CONFLICT":
          return t("sync.revisionConflict");
        case "HTTP_404":
        case "SERVER_UNAVAILABLE":
          return t("sync.serverNotFound");
        default:
          return t("sync.failedGeneric");
      }
    },
    [t]
  );

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;

    if (adaptiveLayout.runtimeKind !== "web") {
      setWebCloudInitialCheckComplete(true);
      return;
    }

    if (!settings) {
      return;
    }

    if (!online) {
      setWebCloudAuthState(locorisCloudConnection ? "offline" : "signedOut");
      setWebCloudInitialCheckComplete(true);
      return;
    }

    if (!locorisCloudConnection) {
      const serverUrl = resolveLocorisCloudServerUrl(settings);

      if (!serverUrl) {
        setWebCloudAuthState("signedOut");
        setWebCloudOverview(null);
        setWebCloudInitialCheckComplete(true);
        return;
      }

      setWebCloudAuthState("checking");

      void refreshHostedAccountSession(serverUrl, {
        refreshToken: "",
        ...getHostedDeviceIdentity(settings.localDeviceId)
      })
        .then(async (result) => {
          if (cancelled) {
            return;
          }

          const existingConnection = listSyncConnections().find(
            (connection) =>
              connection.provider === "hosted" && connection.role === "locorisCloud"
          );

          if (existingConnection) {
            await updateSyncConnection(existingConnection.id, {
              serverUrl,
              sessionToken: result.session.token,
              refreshToken: result.session.refreshToken ?? null,
              tokenExpiresAt: result.session.expiresAt,
              userId: result.user.id,
              userName: result.user.name,
              userEmail: result.user.email ?? "",
              label: result.user.email ?? result.user.name
            });
          } else {
            await createSyncConnection({
              provider: "hosted",
              role: "locorisCloud",
              serverUrl,
              sessionToken: result.session.token,
              refreshToken: result.session.refreshToken ?? null,
              tokenExpiresAt: result.session.expiresAt,
              userId: result.user.id,
              userName: result.user.name,
              userEmail: result.user.email ?? "",
              label: result.user.email ?? result.user.name
            });
          }

          refreshSyncRegistryState();

          if (cancelled) {
            return;
          }

          if (result.entitlement) {
            const { token: _accessToken, ...session } = result.session;

            setWebCloudOverview({
              user: result.user,
              session,
              vaults: [],
              devices: [],
              usage: {
                storageBytes: 0,
                vaultCount: 0,
                syncTokenCount: 0,
                deviceCount: 0
              },
              entitlement: result.entitlement
            });
          }

          setWebCloudAuthState("authenticated");
          setWebCloudInitialCheckComplete(true);
          setWebAccessFeedback(null);
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }

          const noBrowserSession = isHostedReauthRequiredError(error);

          setWebCloudAuthState(noBrowserSession ? "signedOut" : "serverUnavailable");
          setWebCloudOverview(null);
          setWebCloudInitialCheckComplete(true);
          setWebAccessFeedback(
            noBrowserSession
              ? null
              : {
                  tone: "error",
                  text: translateSyncError(error, "hosted")
                }
          );
        });

      return () => {
        cancelled = true;
      };
    }

    // Only the first Cloud Web check is blocking. Background retries must keep
    // the authenticated shell mounted instead of flashing the access gate.
    if (!webCloudInitialCheckComplete) {
      setWebCloudAuthState("checking");
    }

    const loadOverview = async () => {
      let connection = locorisCloudConnection;

      if (
        shouldRefreshHostedSession(connection) ||
        (!connection.sessionToken.trim() && canRefreshHostedSession(connection))
      ) {
        connection = await refreshHostedConnectionSession(connection, { force: true });
      }

      try {
        return await loadHostedAccountOverview(connection.serverUrl, connection.sessionToken);
      } catch (error) {
        if (getErrorMessage(error) !== "UNAUTHORIZED") {
          throw error;
        }

        connection = await refreshHostedConnectionSession(connection, { force: true });
        return loadHostedAccountOverview(connection.serverUrl, connection.sessionToken);
      }
    };

    void loadOverview()
      .then((overview) => {
        if (cancelled) {
          return;
        }

        setWebCloudOverview(overview);
        setWebCloudAuthState("authenticated");
        setWebCloudInitialCheckComplete(true);
        setWebAccessFeedback(null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        const reauthRequired = isHostedReauthRequiredError(error);

        setWebCloudAuthState(reauthRequired ? "reauthRequired" : "serverUnavailable");
        setWebCloudInitialCheckComplete(true);
        setWebAccessFeedback({
          tone: "error",
          text: reauthRequired
            ? t("sync.hostedSessionExpired")
            : translateSyncError(error, "hosted")
        });

        if (!reauthRequired) {
          retryTimer = window.setTimeout(() => {
            setWebCloudRetryTick((current) => current + 1);
          }, 5_000);
        }
      });

    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [
    adaptiveLayout.runtimeKind,
    locorisCloudConnection?.id,
    locorisCloudConnection?.serverUrl,
    locorisCloudConnection?.sessionToken,
    locorisCloudConnection?.refreshToken,
    locorisCloudConnection?.tokenExpiresAt,
    online,
    refreshHostedConnectionSession,
    settings,
    t,
    translateSyncError,
    webCloudRetryTick
  ]);

  const activeVaultPendingSync = useMemo(
    () => computePendingSyncSummaryFromDirtyEntries(syncDirtyEntries),
    [syncDirtyEntries]
  );
  const syncChipTimestampFormatter = useMemo(
    () => ({ format: (value: number) => formatTimeValue(value, localeRuntime) }),
    [localeRuntime]
  );
  const activeVaultSyncChip = useMemo(() => {
    const pendingCount = activeVaultPendingSync.total;
    const compactSyncTime = activeVaultBinding?.lastSyncAt
      ? syncChipTimestampFormatter.format(activeVaultBinding.lastSyncAt)
      : "—";

    if (!activeVaultBinding || !activeVaultConnection) {
      return {
        tone: "default" as const,
        text: t("sync.statusLocalOnly"),
        compactText: "—"
      };
    }

    if (activeVaultBinding.syncStatus === "syncing") {
      return {
        tone: "warning" as const,
        text: t("sync.statusSyncing"),
        compactText: activeVaultBinding.lastSyncAt ? compactSyncTime : "…"
      };
    }

    if (
      activeVaultBinding.lastError === "VAULT_ENCRYPTION_LOCKED" ||
      (activeVaultEncryption.state === "locked" && activeVaultEncryption.enabled)
    ) {
      return {
        tone: "warning" as const,
        text:
          pendingCount > 0
            ? t("sync.statusUnlockRequiredPending", { count: pendingCount })
            : t("sync.statusUnlockRequired"),
        compactText: activeVaultBinding.lastSyncAt ? compactSyncTime : "!",
        title: t("sync.vaultEncryptionSyncLocked")
      };
    }

    if (activeVaultBinding.lastError) {
      const isAuthError = activeVaultBinding.lastError === "UNAUTHORIZED";
      const isUnavailableError =
        activeVaultBinding.lastError === "SERVER_UNAVAILABLE" ||
        activeVaultBinding.lastError === "HTTP_404";
      const translatedError = translateSyncError(
        new Error(activeVaultBinding.lastError),
        activeVaultConnection.provider
      );
      let message: string;

      if (isAuthError) {
        if (pendingCount > 0) {
          message = t("sync.statusAuthRequiredPending", { count: pendingCount });
        } else {
          message = t("sync.statusAuthRequired");
        }
      } else if (isUnavailableError) {
        if (pendingCount > 0) {
          message = t("sync.statusUnavailablePending", { count: pendingCount });
        } else {
          message = t("sync.statusUnavailable");
        }
      } else {
        message = translatedError;
      }

      return {
        tone: "error" as const,
        text: message,
        compactText: activeVaultBinding.lastSyncAt ? compactSyncTime : "!",
        title: translatedError
      };
    }

    if (!online && pendingCount > 0) {
      return {
        tone: "warning" as const,
        text: t("sync.statusOfflinePending", { count: pendingCount }),
        compactText: activeVaultBinding.lastSyncAt ? compactSyncTime : String(pendingCount)
      };
    }

    if (pendingCount > 0) {
      return {
        tone: "warning" as const,
        text: t("sync.statusPending", { count: pendingCount }),
        compactText: activeVaultBinding.lastSyncAt ? compactSyncTime : String(pendingCount)
      };
    }

    if (activeVaultBinding.lastSyncAt) {
      return {
        tone: "success" as const,
        text: t("sync.statusSyncedAt", {
          time: syncChipTimestampFormatter.format(activeVaultBinding.lastSyncAt)
        }),
        compactText: compactSyncTime
      };
    }

    return {
      tone: "default" as const,
      text: t("sync.statusReady"),
      compactText: "—"
    };
  }, [
    activeVaultBinding,
    activeVaultConnection,
    activeVaultEncryption.enabled,
    activeVaultEncryption.state,
    activeVaultPendingSync.total,
    online,
    syncChipTimestampFormatter,
    t,
    translateSyncError
  ]);
  const localVaultSwitcherItems = useMemo(
    () =>
      localVaults.map((vault, index) => {
        const binding = syncBindingsByVaultId.get(vault.id) ?? null;
        const connection = binding ? syncConnectionsById.get(binding.connectionId) ?? null : null;
        return {
          id: vault.id,
          name: vault.name,
          displayName: getDisplayVaultName(vault, currentAppLanguage, index),
          vaultKind: vault.vaultKind,
          statusLabel: !binding
            ? t("settings.statusUnbound")
            : binding.lastError === "VAULT_ENCRYPTION_LOCKED"
              ? t("settings.statusUnlockRequired")
            : binding.syncStatus === "syncing"
              ? t("settings.statusSyncing")
              : binding.syncStatus === "error"
                ? t("settings.statusError")
                : t("settings.statusReady"),
          statusTone: !binding
            ? ("default" as const)
            : binding.lastError === "VAULT_ENCRYPTION_LOCKED"
              ? ("warning" as const)
            : binding.syncStatus === "syncing"
              ? ("warning" as const)
              : binding.syncStatus === "error"
                ? ("error" as const)
                : ("success" as const),
          providerLabel: connection
            ? connection.provider === "hosted"
              ? t("sync.hosted")
              : connection.provider === "googleDrive"
                ? t("sync.googleDrive")
                : t("sync.selfHosted")
            : null,
          providerTone: connection?.provider ?? ("local" as const),
          detail: connection
            ? binding?.remoteVaultName
              ? `${connection.label} · ${binding.remoteVaultName}`
              : connection.label
            : t("sync.statusLocalOnly"),
          encryptionState: vaultEncryptionById[vault.id]?.state ?? "disabled"
        };
      }),
    [currentAppLanguage, localVaults, syncBindingsByVaultId, syncConnectionsById, t, vaultEncryptionById]
  );
  const activeSyncTransportChip = useMemo(
    () =>
      syncTransportIndicator && syncTransportIndicator.localVaultId === activeLocalVaultId
        ? {
            tone: syncTransportIndicator.tone,
            text: syncTransportIndicator.text,
            title: syncTransportIndicator.title
          }
        : null,
    [activeLocalVaultId, syncTransportIndicator]
  );
  const activeLocalVaultProfile = useMemo(
    () => localVaults.find((vault) => vault.id === activeLocalVaultId) ?? null,
    [activeLocalVaultId, localVaults]
  );
  const activeLocalVaultDisplayName = useMemo(
    () =>
      activeLocalVaultProfile
        ? getDisplayVaultName(
            activeLocalVaultProfile,
            currentAppLanguage,
            localVaults.findIndex((vault) => vault.id === activeLocalVaultProfile.id)
          )
        : t("sync.localVault"),
    [activeLocalVaultProfile, currentAppLanguage, localVaults, t]
  );
  const webAccessMode = useMemo<WebAccessMode>(() => {
    if (adaptiveLayout.runtimeKind !== "web") {
      return "local";
    }

    if (webCloudAuthState === "serverUnavailable" && !webCloudOverview) {
      return "serverUnavailable";
    }

    if (!locorisCloudConnection) {
      return "local";
    }

    if (webCloudAuthState === "checking" && !webCloudOverview) {
      return "checking";
    }

    if (webCloudAuthState === "reauthRequired") {
      return "reauthRequired";
    }

    if (webCloudAuthState === "serverUnavailable") {
      return webCloudOverview ? (activeLocorisCloudBinding ? "cloud" : "cloudPending") : "serverUnavailable";
    }

    const entitlement = webCloudOverview?.entitlement ?? null;

    if (entitlement && entitlement.capabilities.webAppEnabled === false) {
      return "unavailable";
    }

    if (activeLocorisCloudBinding) {
      if (entitlement && entitlement.capabilities.canWriteSync === false) {
        return "readOnly";
      }

      return "cloud";
    }

    if (entitlement && entitlement.capabilities.canWriteSync === false) {
      return "unavailable";
    }

    return "cloudPending";
  }, [
    activeLocorisCloudBinding,
    adaptiveLayout.runtimeKind,
    locorisCloudConnection,
    webCloudAuthState,
    webCloudOverview
  ]);
  const webAccessStatus = useMemo(() => {
    const accountEmailLabel =
      webCloudOverview?.user.email ??
      locorisCloudConnection?.userEmail ??
      locorisCloudConnection?.label ??
      t("webAccess.cloudAccountFallback");
    const accountDisplayName =
      locorisCloudConnection?.userName?.trim() ||
      webCloudOverview?.user.name?.trim() ||
      accountEmailLabel ||
      t("webAccess.cloudAccountFallback");
    const accountDescription =
      accountDisplayName === accountEmailLabel
        ? t("settings.accountCloudProfileDescription")
        : `${accountEmailLabel}. ${t("settings.accountCloudProfileDescription")}`;
    const activeExternalSyncProviderLabel =
      activeVaultBinding && activeVaultConnection && !activeLocorisCloudBinding
        ? activeVaultConnection.provider === "hosted"
          ? t("sync.hosted")
          : activeVaultConnection.provider === "googleDrive"
            ? t("sync.googleDrive")
            : t("sync.selfHosted")
        : null;
    const entitlement = webCloudOverview?.entitlement ?? null;
    const usage = webCloudOverview?.usage ?? null;
    const limits = entitlement?.limits ?? null;
    const planLabel = entitlement?.plan.name ?? t("webAccess.cloudPlanFallback");
    const entitlementTone = getEntitlementTone(entitlement);
    const entitlementStatus = entitlement?.status ?? entitlement?.subscriptionStatus ?? entitlement?.accountStatus ?? null;
    const effectiveUntil = entitlement?.effectiveUntil ?? entitlement?.trialEndsAt ?? null;
    const periodDateLabel = formatCloudDate(effectiveUntil, localeRuntime);
    const trialDateLabel = formatCloudDate(entitlement?.trialEndsAt, localeRuntime);
    const trialReadOnlyDateLabel = formatCloudDate(entitlement?.retention?.readOnlyUntil, localeRuntime);
    const trialArchiveDateLabel = formatCloudDate(entitlement?.retention?.archiveUntil, localeRuntime);
    const periodLabel = (() => {
      if (entitlement?.reason === "TRIAL_EXPIRED_READ_ONLY" && trialReadOnlyDateLabel) {
        return t("settings.accountCloudReadOnlyUntil", { date: trialReadOnlyDateLabel });
      }

      if (entitlement?.reason === "TRIAL_ARCHIVED" && trialArchiveDateLabel) {
        return t("settings.accountCloudArchivedUntil", { date: trialArchiveDateLabel });
      }

      if (entitlement?.reason === "TRIAL_RETENTION_EXPIRED" && trialArchiveDateLabel) {
        return t("settings.accountCloudRetentionEndedOn", { date: trialArchiveDateLabel });
      }

      if (entitlement?.reason === "TRIAL_EXPIRED" && trialDateLabel) {
        return t("settings.accountCloudTrialExpiredOn", { date: trialDateLabel });
      }

      return periodDateLabel
        ? t("settings.accountCloudPeriodUntil", { date: periodDateLabel })
        : t("settings.accountCloudPeriodNoExpiry");
    })();
    const vaultCount = usage?.vaultCount ?? webCloudOverview?.vaults.length ?? 0;
    const deviceCount = usage?.deviceCount ?? usage?.syncTokenCount ?? 0;
    const storageBytes = usage?.storageBytes ?? 0;
    const limitLabel = (value: number | null | undefined) =>
      value === null || value === undefined ? t("settings.accountCloudUnlimited") : String(value);
    const storageLimitLabel = (value: number | null | undefined) =>
      value === null || value === undefined
        ? t("settings.accountCloudUnlimited")
        : formatCloudBytes(value, localeRuntime);
    const accountMetaItems = entitlement
      ? [
          {
            label: t("settings.accountCloudPlan"),
            value: planLabel,
            tone: entitlementTone
          },
          {
            label: t("settings.accountCloudPeriod"),
            value: periodLabel,
            tone: entitlementTone
          }
        ]
      : undefined;
    const accountMeters = limits
      ? [
          {
            label: t("settings.accountCloudVaults"),
            valueLabel: `${vaultCount} / ${limitLabel(limits.maxVaults)}`,
            ratio: getLimitRatio(vaultCount, limits.maxVaults),
            tone: getLimitTone(vaultCount, limits.maxVaults)
          },
          {
            label: t("settings.accountCloudDevices"),
            valueLabel: `${deviceCount} / ${limitLabel(limits.maxSyncTokens)}`,
            ratio: getLimitRatio(deviceCount, limits.maxSyncTokens),
            tone: getLimitTone(deviceCount, limits.maxSyncTokens)
          },
          {
            label: t("settings.accountCloudStorage"),
            valueLabel: `${formatCloudBytes(storageBytes, localeRuntime)} / ${storageLimitLabel(limits.storageBytes)}`,
            ratio: getLimitRatio(storageBytes, limits.storageBytes),
            tone: getLimitTone(storageBytes, limits.storageBytes)
          }
        ]
      : undefined;
    const accountNotice = (() => {
      if (entitlementStatus === "trialing" && (periodDateLabel || trialDateLabel)) {
        return t("settings.accountCloudTrialNotice", { date: periodDateLabel || trialDateLabel });
      }

      if (entitlement?.reason === "TRIAL_EXPIRED_READ_ONLY" && trialReadOnlyDateLabel) {
        return t("settings.accountCloudTrialReadOnlyNotice", { date: trialReadOnlyDateLabel });
      }

      if (entitlement?.reason === "TRIAL_ARCHIVED" && trialArchiveDateLabel) {
        return t("settings.accountCloudTrialArchiveNotice", { date: trialArchiveDateLabel });
      }

      if (entitlement?.reason === "TRIAL_RETENTION_EXPIRED") {
        return t("settings.accountCloudTrialRetentionExpiredNotice");
      }

      if (entitlement?.reason === "TRIAL_EXPIRED" || entitlement?.plan.id === "local_free") {
        return t("settings.accountCloudFreeNotice");
      }

      if (entitlementStatus === "grace" && periodDateLabel) {
        return t("settings.accountCloudGraceNotice", { date: periodDateLabel });
      }

      if (entitlement && !entitlement.capabilities.canWriteSync && entitlement.capabilities.canReadSync) {
        return t("settings.accountCloudReadOnlyDescription");
      }

      return undefined;
    })();
    const accountDetails = {
      metaItems: accountMetaItems,
      meters: accountMeters,
      notice: accountNotice
    };

    if (adaptiveLayout.runtimeKind !== "web") {
      if (!locorisCloudConnection) {
        return {
          tone: "default" as const,
          text: t("settings.accountCloudSignedOut"),
          compactText: t("sync.hostedLogin"),
          title: t("settings.accountCloudNoAccountTitle"),
          description: t("settings.accountCloudNoAccountDescription"),
          primaryActionLabel: t("settings.accountCloudSignIn")
        };
      }

      return {
        tone: entitlement ? entitlementTone : ("success" as const),
        text: t("settings.accountCloudReady"),
        compactText: accountDisplayName,
        title: accountDisplayName,
        description: accountDescription,
        primaryActionLabel: t("settings.accountCloudManage"),
        ...accountDetails
      };
    }

    const statusByMode = {
      local: {
        tone: "warning" as const,
        text: t("webAccess.localTitle"),
        compactText: t("sync.hostedLogin"),
        title: t("webAccess.localTitle"),
        description: t("webAccess.localDescription", {
          vault: activeLocalVaultDisplayName
        }),
        primaryActionLabel: t("webAccess.openCloud"),
        secondaryActionLabel: t("webAccess.exportVault")
      },
      cloud: {
        tone: "success" as const,
        text: t("webAccess.cloudTitle"),
        compactText: accountDisplayName,
        title: accountDisplayName,
        description: t("webAccess.cloudDescription", {
          account: accountEmailLabel
        }),
        primaryActionLabel: t("webAccess.manageCloud"),
        secondaryActionLabel: t("webAccess.exportVault")
      },
      cloudPending: {
        tone: "warning" as const,
        text: t("webAccess.pendingTitle"),
        compactText: accountDisplayName,
        title: accountDisplayName,
        description: activeExternalSyncProviderLabel
          ? t("webAccess.pendingExternalDescription", {
              vault: activeLocalVaultDisplayName,
              provider: activeExternalSyncProviderLabel
            })
          : t("webAccess.pendingLocalDescription", {
              vault: activeLocalVaultDisplayName
            }),
        primaryActionLabel: t("webAccess.manageCloud"),
        secondaryActionLabel: t("webAccess.exportVault")
      },
      readOnly: {
        tone: "warning" as const,
        text: t("webAccess.readOnlyTitle"),
        compactText: accountDisplayName,
        title: accountDisplayName,
        description: t("webAccess.readOnlyDescription"),
        primaryActionLabel: t("webAccess.manageCloud"),
        secondaryActionLabel: t("webAccess.exportVault")
      },
      unavailable: {
        tone: "error" as const,
        text: t("webAccess.unavailableTitle"),
        compactText: accountDisplayName,
        title: accountDisplayName,
        description: t("webAccess.unavailableDescription"),
        primaryActionLabel: t("webAccess.manageCloud"),
        secondaryActionLabel: t("webAccess.exportVault")
      },
      checking: {
        tone: "default" as const,
        text: t("webAccess.authCheckingTitle"),
        compactText: accountDisplayName,
        title: t("webAccess.authCheckingTitle"),
        description: t("webAccess.authCheckingDescription"),
        primaryActionLabel: t("webAccess.manageCloud"),
        secondaryActionLabel: t("webAccess.exportVault")
      },
      serverUnavailable: {
        tone: "error" as const,
        text: t("webAccess.attentionTitle"),
        compactText: accountDisplayName,
        title: t("webAccess.attentionTitle"),
        description: t("webAccess.authServerUnavailable"),
        primaryActionLabel: t("sync.hostedRefresh"),
        secondaryActionLabel: t("webAccess.exportVault")
      },
      reauthRequired: {
        tone: "error" as const,
        text: t("webAccess.authReauthPanelTitle"),
        compactText: accountDisplayName,
        title: t("webAccess.authReauthPanelTitle"),
        description: t("webAccess.authReauthPanelDescription"),
        primaryActionLabel: t("settings.hostedReconnect"),
        secondaryActionLabel: t("webAccess.exportVault")
      }
    } satisfies Record<
      WebAccessMode,
      {
        tone: "default" | "success" | "warning" | "error";
        text: string;
        compactText: string;
        title: string;
        description: string;
        primaryActionLabel: string;
        secondaryActionLabel: string;
      }
    >;

    const status = statusByMode[webAccessMode];

    if (webAccessFeedback?.tone === "error") {
      return {
        ...status,
        tone: "error" as const,
        text: t("webAccess.attentionTitle"),
        title: t("webAccess.attentionTitle"),
        description: webAccessFeedback.text,
        ...accountDetails
      };
    }

    return {
      ...status,
      ...accountDetails
    };
  }, [
    activeLocorisCloudBinding,
    activeVaultBinding,
    activeVaultConnection,
    activeLocalVaultDisplayName,
    adaptiveLayout.runtimeKind,
    currentAppLanguage,
    locorisCloudConnection?.label,
    locorisCloudConnection?.userEmail,
    locorisCloudConnection?.userName,
    t,
    webAccessFeedback,
    webAccessMode,
    webCloudOverview
  ]);
  const activePrivateVaultWarningContext = useMemo(() => {
    if (!activeLocalVaultProfile) {
      return null;
    }

    return {
      localVaultId: activeLocalVaultProfile.id,
      vaultKind: activeLocalVaultProfile.vaultKind,
      vaultName: getDisplayVaultName(
        activeLocalVaultProfile,
        currentAppLanguage,
        localVaults.findIndex((vault) => vault.id === activeLocalVaultProfile.id)
      )
    };
  }, [activeLocalVaultProfile, currentAppLanguage, localVaults]);

  const selectedFolderName = selectedFolderId ? folderPathMap.get(selectedFolderId) ?? null : null;
  const selectedTagName = selectedTagId ? tagMap.get(selectedTagId)?.name ?? null : null;
  const totalVisibleNotes = notes.filter((note) => note.trashedAt === null).length;
  const favoriteCount = notes.filter((note) => note.trashedAt === null && (note.pinned || note.favorite)).length;
  const trashCount = notes.filter((note) => note.trashedAt !== null).length;
  const pinnedCount = favoriteCount;
  const viewModeLabel =
    viewMode === "favorites"
      ? t("filters.viewFavorites")
      : viewMode === "trash"
          ? t("filters.viewTrash")
          : t("filters.viewAll");
  const currentCollectionTitle =
    selectedFolderName ??
    selectedTagName ??
    (viewMode === "favorites"
      ? t("filters.viewFavorites")
      : viewMode === "trash"
          ? t("filters.viewTrash")
          : t("filters.allNotes"));
  const currentCollectionDescription = selectedFolderName
    ? `${t("noteList.filteredByFolder")}: ${selectedFolderName}`
    : selectedTagName
      ? `${t("noteList.filteredByTag")}: ${selectedTagName}`
      : viewMode === "favorites"
        ? t("counts.notes", { count: favoriteCount })
        : viewMode === "trash"
            ? t("counts.notes", { count: trashCount })
            : t("counts.notes", { count: totalVisibleNotes });
  const contextChips = [
    t("counts.notes", { count: filteredNotes.length }),
    selectedFolderName ? `${t("note.folder")}: ${selectedFolderName}` : null,
    selectedTagName ? `${t("note.tags")}: ${selectedTagName}` : null,
    viewMode !== "all" ? viewModeLabel : null,
    search ? `Q: ${search}` : null
  ].filter(Boolean) as string[];

  useEffect(() => {
    if (!orbitalEditorNoteId) {
      return;
    }

    if (!orbitalEditorEntry) {
      setOrbitalEditorNoteId(null);
    }
  }, [orbitalEditorEntry, orbitalEditorNoteId]);

  const clearScheduledAutoSync = useCallback(() => {
    if (autoSyncTimerRef.current !== null) {
      window.clearTimeout(autoSyncTimerRef.current);
      autoSyncTimerRef.current = null;
    }
  }, []);

  const showSyncTransportIndicator = useCallback(
    (
      localVaultId: string,
      syncMode: "delta" | "encrypted-delta" | "snapshot" | "encrypted-snapshot"
    ) => {
      if (syncTransportTimerRef.current !== null) {
        window.clearTimeout(syncTransportTimerRef.current);
        syncTransportTimerRef.current = null;
      }

      const indicator =
        syncMode === "encrypted-delta"
          ? {
              tone: "success" as const,
              text: t("sync.transportEncryptedDelta"),
              title: t("sync.transportEncryptedDeltaTitle")
            }
          : syncMode === "delta"
            ? {
                tone: "success" as const,
                text: t("sync.transportDelta"),
                title: t("sync.transportDeltaTitle")
              }
            : syncMode === "encrypted-snapshot"
              ? {
                  tone: "default" as const,
                  text: t("sync.transportEncryptedSnapshot"),
                  title: t("sync.transportEncryptedSnapshotTitle")
                }
              : {
                  tone: "default" as const,
                  text: t("sync.transportSnapshot"),
                  title: t("sync.transportSnapshotTitle")
                };

      setSyncTransportIndicator({
        localVaultId,
        ...indicator
      });

      syncTransportTimerRef.current = window.setTimeout(() => {
        setSyncTransportIndicator((current) =>
          current?.localVaultId === localVaultId ? null : current
        );
        syncTransportTimerRef.current = null;
      }, 3600);
    },
    [t]
  );

  const refreshGoogleDriveConnectionSilently = useCallback(
    async (connection: SyncConnection) => {
      if (connection.provider !== "googleDrive") {
        return null;
      }

      try {
        const result = await refreshGoogleDriveAccountSession({
          connectionId: connection.id,
          loginHint: connection.userEmail || undefined
        });

        const nextConnection = await updateSyncConnection(connection.id, {
          sessionToken: result.accessToken,
          refreshToken: result.refreshToken ?? undefined,
          tokenExpiresAt: result.expiresAt,
          userId: result.userId,
          userName: result.userName,
          userEmail: result.userEmail,
          label: result.userEmail || result.userName || connection.label
        });

        listSyncBindings()
          .filter(
            (binding) =>
              binding.connectionId === connection.id &&
              ["GOOGLE_DRIVE_AUTH_REQUIRED", "GOOGLE_DRIVE_INTERACTION_REQUIRED"].includes(
                binding.lastError ?? ""
              )
          )
          .forEach((binding) => {
            updateSyncBindingState(binding.localVaultId, {
              syncStatus: "idle",
              lastError: null
            });
          });

        refreshSyncRegistryState();
        return nextConnection;
      } catch {
        return null;
      }
    },
    []
  );

  const syncBoundRemoteVaultName = useCallback(
    async (localVaultId: string, explicitName?: string) => {
      const binding = syncBindingsByVaultId.get(localVaultId) ?? null;
      const connection = binding ? syncConnectionsById.get(binding.connectionId) ?? null : null;
      const localVaultProfile = getLocalVaultProfile(localVaultId);
      const targetName = (explicitName ?? localVaultProfile?.name ?? "").trim();

      if (!binding || !connection || !targetName) {
        return false;
      }

      if (binding.remoteVaultName.trim() === targetName) {
        return true;
      }

      const renameRemoteVault = async (candidate: SyncConnection) => {
        if (candidate.provider === "googleDrive") {
          return renameGoogleDriveVault(candidate.sessionToken, binding.remoteVaultId, targetName);
        }

        if (candidate.provider === "hosted") {
          return renameHostedVault(
            candidate.serverUrl,
            candidate.sessionToken,
            binding.remoteVaultId,
            targetName
          );
        }

        return renamePersonalServerVault(
          candidate.serverUrl,
          candidate.managementToken,
          binding.remoteVaultId,
          targetName
        );
      };

      let targetConnection = connection;

      if (
        targetConnection.provider === "googleDrive" &&
        targetConnection.tokenExpiresAt &&
        targetConnection.tokenExpiresAt <= Date.now() + GOOGLE_DRIVE_TOKEN_REFRESH_SKEW_MS
      ) {
        const refreshedConnection = await refreshGoogleDriveConnectionSilently(targetConnection);

        if (refreshedConnection) {
          targetConnection = refreshedConnection;
        }
      }

      try {
        const renamed = await renameRemoteVault(targetConnection);
        const nextRemoteName = renamed.vault?.name?.trim() || targetName;
        updateSyncBindingRemoteName(localVaultId, nextRemoteName);
        refreshSyncRegistryState();
        return true;
      } catch (error) {
        const errorMessage = getErrorMessage(error);

        if (
          targetConnection.provider !== "googleDrive" ||
          !["GOOGLE_DRIVE_AUTH_REQUIRED", "GOOGLE_DRIVE_INTERACTION_REQUIRED"].includes(errorMessage)
        ) {
          throw error;
        }

        const refreshedConnection = await refreshGoogleDriveConnectionSilently(targetConnection);

        if (!refreshedConnection) {
          throw error;
        }

        const renamed = await renameRemoteVault(refreshedConnection);
        const nextRemoteName = renamed.vault?.name?.trim() || targetName;
        updateSyncBindingRemoteName(localVaultId, nextRemoteName);
        refreshSyncRegistryState();
        return true;
      }
    },
    [refreshGoogleDriveConnectionSilently, syncBindingsByVaultId, syncConnectionsById]
  );

  const runBoundVaultSync = useCallback(
    async (
      localVaultId: string,
      {
        showFeedback = false,
        bindingOverride,
        connectionOverride
      }: {
        showFeedback?: boolean;
        bindingOverride?: SyncVaultBinding;
        connectionOverride?: SyncConnection;
      } = {}
    ) => {
      const binding = bindingOverride ?? syncBindingsByVaultId.get(localVaultId) ?? null;
      const connection =
        connectionOverride ?? (binding ? syncConnectionsById.get(binding.connectionId) ?? null : null);
      const isActiveVaultSync = localVaultId === activeLocalVaultId;

      if (!binding || !connection) {
        if (showFeedback) {
          setSyncFeedback({
            tone: "error",
            text: t("sync.bindingMissing")
          });
        }
        return false;
      }

      if (!online) {
        if (showFeedback) {
          setSyncFeedback({
            tone: "error",
            text: t("app.networkOffline")
          });
        }
        return false;
      }

      if (syncInFlightRef.current) {
        if (showFeedback) {
          setSyncFeedback({
            tone: "error",
            text: t("sync.syncing")
          });
        }
        if (isActiveVaultSync) {
          syncRerunRequestedRef.current = true;
        }
        return false;
      }

      if (isActiveVaultSync) {
        clearScheduledAutoSync();
      }

      syncInFlightRef.current = true;

      if (showFeedback) {
        setSyncFeedback(null);
      }

      updateSyncBindingState(localVaultId, {
        syncStatus: "syncing",
        lastError: null
      });
      refreshSyncRegistryState();

      try {
        let targetConnection = connection;
        let targetBinding = binding;
        const runSyncCycle = async (
          candidate: SyncConnection,
          candidateBinding: SyncVaultBinding = targetBinding
        ) =>
          runConfiguredSync(
            {
              provider: candidate.provider,
              serverUrl: candidate.serverUrl,
              vaultId: candidateBinding.remoteVaultId,
              token:
                candidate.provider === "googleDrive"
                  ? candidate.sessionToken
                  : candidateBinding.syncToken,
              localVaultId
            },
            {
              localVaultId: isActiveVaultSync ? undefined : localVaultId,
              localPendingCount: isActiveVaultSync ? activeVaultPendingSync.total : undefined,
              onStatusChange: (status) => {
                updateSyncBindingState(localVaultId, {
                  syncStatus: status
                });
                refreshSyncRegistryState();
              }
            }
          );

        if (
          targetConnection.provider === "googleDrive" &&
          targetConnection.tokenExpiresAt &&
          targetConnection.tokenExpiresAt <= Date.now() + GOOGLE_DRIVE_TOKEN_REFRESH_SKEW_MS
        ) {
          const refreshedConnection = await refreshGoogleDriveConnectionSilently(targetConnection);

          if (refreshedConnection) {
            targetConnection = refreshedConnection;
          }
        }

        let result;

        try {
          result = await runSyncCycle(targetConnection);
        } catch (error) {
          const errorMessage = getErrorMessage(error);

          if (
            targetConnection.provider === "hosted" &&
            errorMessage === "UNAUTHORIZED" &&
            settings
          ) {
            // A sync credential is scoped to one vault/device and may be revoked
            // independently from the account session. Repair it silently when the
            // signed-in account is still valid, then retry the interrupted sync.
            const registerDevice = (candidate: SyncConnection) =>
              registerHostedVaultDevice(
                candidate.serverUrl,
                candidate.sessionToken,
                targetBinding.remoteVaultId,
                getHostedDeviceIdentity(settings.localDeviceId)
              );
            let refreshedCredential;

            try {
              refreshedCredential = await registerDevice(targetConnection);
            } catch (credentialError) {
              if (getErrorMessage(credentialError) !== "UNAUTHORIZED") {
                throw credentialError;
              }

              targetConnection = await refreshHostedConnectionSession(targetConnection, {
                force: true
              });
              refreshedCredential = await registerDevice(targetConnection);
            }

            targetBinding = await upsertSyncBinding({
              ...targetBinding,
              syncToken: refreshedCredential.token,
              syncStatus: "syncing",
              lastError: null
            });
            refreshSyncRegistryState();
            result = await runSyncCycle(targetConnection, targetBinding);
          } else {
            if (
              targetConnection.provider !== "googleDrive" ||
              !["GOOGLE_DRIVE_AUTH_REQUIRED", "GOOGLE_DRIVE_INTERACTION_REQUIRED"].includes(errorMessage)
            ) {
              throw error;
            }

            const refreshedConnection = await refreshGoogleDriveConnectionSilently(targetConnection);

            if (!refreshedConnection) {
              throw error;
            }

            targetConnection = refreshedConnection;
            result = await runSyncCycle(targetConnection);
          }
        }

        const completedAt = Date.now();
        lastRemoteRefreshAtRef.current[localVaultId] = completedAt;
        updateSyncBindingState(localVaultId, {
          syncStatus: "idle",
          lastSyncAt: completedAt,
          syncCursor: result.revision,
          lastError: null
        });
        const syncedVaultProfile = getLocalVaultProfile(localVaultId);

        if (syncedVaultProfile?.name?.trim()) {
          updateSyncBindingRemoteName(localVaultId, syncedVaultProfile.name);
        }

        setLocalVaults(listLocalVaultProfiles());
        refreshSyncRegistryState();
        showSyncTransportIndicator(localVaultId, result.syncMode);

        if (showFeedback) {
          setSyncFeedback({
            tone: "success",
            text: t("sync.completed", {
              count: result.stats.conflicts
            })
          });
        }

        return true;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        if (
          connection.provider === "hosted" &&
          connection.role === "locorisCloud" &&
          isHostedReauthRequiredError(error)
        ) {
          setWebCloudAuthState("reauthRequired");
        }
        updateSyncBindingState(localVaultId, {
          syncStatus: errorMessage === "VAULT_ENCRYPTION_LOCKED" ? "idle" : "error",
          lastError: errorMessage
        });
        refreshSyncRegistryState();

        if (showFeedback) {
          setSyncFeedback({
            tone: "error",
            text: translateSyncError(error, connection.provider)
          });
        }

        return false;
      } finally {
        syncInFlightRef.current = false;

        if (isActiveVaultSync && syncRerunRequestedRef.current) {
          syncRerunRequestedRef.current = false;
          window.setTimeout(() => {
            void runBoundVaultSync(localVaultId);
          }, 450);
        }
      }
    },
    [
      activeLocalVaultId,
      activeVaultPendingSync.total,
      clearScheduledAutoSync,
      online,
      refreshGoogleDriveConnectionSilently,
      refreshHostedConnectionSession,
      settings,
      showSyncTransportIndicator,
      syncBoundRemoteVaultName,
      syncBindingsByVaultId,
      syncConnectionsById,
      t,
      translateSyncError
    ]
  );

  const runActiveVaultSync = useCallback(
    async ({
      showFeedback = false
    }: {
      showFeedback?: boolean;
    } = {}) => runBoundVaultSync(activeLocalVaultId, { showFeedback }),
    [activeLocalVaultId, runBoundVaultSync]
  );

  const requestAutoSync = useCallback(
    ({
      delayMs = 1600,
      force = false
    }: {
      delayMs?: number;
      force?: boolean;
    } = {}) => {
      if (
        vaultBooting ||
        !activeVaultBinding ||
        !activeVaultConnection ||
        !online ||
        (activeVaultEncryption.enabled && activeVaultEncryption.state === "locked")
      ) {
        return;
      }

      clearScheduledAutoSync();
      const scheduledDelay = force ? Math.min(delayMs, 900) : delayMs;
      autoSyncTimerRef.current = window.setTimeout(() => {
        autoSyncTimerRef.current = null;
        void runActiveVaultSync();
      }, scheduledDelay);
    },
    [
      activeVaultBinding,
      activeVaultConnection,
      clearScheduledAutoSync,
      activeVaultEncryption.enabled,
      activeVaultEncryption.state,
      online,
      runActiveVaultSync,
      vaultBooting
    ]
  );

  useEffect(() => {
    return () => {
      clearScheduledAutoSync();
      if (syncTransportTimerRef.current !== null) {
        window.clearTimeout(syncTransportTimerRef.current);
        syncTransportTimerRef.current = null;
      }
    };
  }, [clearScheduledAutoSync]);

  useEffect(() => {
    if (!activeVaultBinding || !activeVaultConnection || vaultBooting || !online) {
      return;
    }

    const syncKey = `${activeLocalVaultId}:${activeVaultBinding.id}:${activeVaultBinding.remoteVaultId}`;

    if (bootSyncKeyRef.current === syncKey) {
      return;
    }

    bootSyncKeyRef.current = syncKey;
    requestAutoSync({
      delayMs: 900,
      force: true
    });
  }, [
    activeLocalVaultId,
    activeVaultBinding,
    activeVaultConnection,
    online,
    requestAutoSync,
    vaultBooting
  ]);

  useEffect(() => {
    const previousOnline = previousOnlineRef.current;
    previousOnlineRef.current = online;

    if (previousOnline || !online) {
      return;
    }

    requestAutoSync({
      delayMs: 800,
      force: true
    });
  }, [online, requestAutoSync]);

  useEffect(() => {
    const wasVisible = previousVisibilityRef.current;
    previousVisibilityRef.current = isDocumentVisible;

    if (wasVisible || !isDocumentVisible || !activeVaultBinding || !activeVaultConnection || !online) {
      return;
    }

    const lastRemoteRefreshAt =
      lastRemoteRefreshAtRef.current[activeLocalVaultId] ?? activeVaultBinding.lastSyncAt ?? 0;

    if (activeVaultPendingSync.total <= 0 && Date.now() - lastRemoteRefreshAt < 60_000) {
      return;
    }

    requestAutoSync({
      delayMs: 700,
      force: true
    });
  }, [
    activeLocalVaultId,
    activeVaultBinding,
    activeVaultConnection,
    activeVaultPendingSync.total,
    isDocumentVisible,
    online,
    requestAutoSync
  ]);

  useEffect(() => {
    if (
      !online ||
      !isDocumentVisible ||
      vaultBooting ||
      activeVaultConnection?.provider !== "googleDrive" ||
      !activeVaultBinding
    ) {
      return;
    }

    let cancelled = false;
    let timerId: number | null = null;

    const schedule = (delayMs: number) => {
      if (!cancelled) {
        timerId = window.setTimeout(() => void poll(), delayMs);
      }
    };

    const poll = async () => {
      let connection = activeVaultConnection;

      try {
        if (
          connection.tokenExpiresAt &&
          connection.tokenExpiresAt <= Date.now() + GOOGLE_DRIVE_TOKEN_REFRESH_SKEW_MS
        ) {
          const refreshed = await refreshGoogleDriveConnectionSilently(connection);

          if (!refreshed) {
            throw new Error("GOOGLE_DRIVE_INTERACTION_REQUIRED");
          }

          connection = refreshed;
        }

        const result = await pollGoogleDriveRemoteChanges(
          connection.sessionToken,
          connection.changePageToken
        );

        if (cancelled) {
          return;
        }

        if (result.nextPageToken && result.nextPageToken !== connection.changePageToken) {
          await updateSyncConnection(connection.id, {
            changePageToken: result.nextPageToken
          });
          refreshSyncRegistryState();
        }

        if (result.changed) {
          requestAutoSync({ delayMs: 350, force: true });
        }
      } catch (error) {
        const message = getErrorMessage(error);

        if (
          message === "GOOGLE_DRIVE_AUTH_REQUIRED" ||
          message === "GOOGLE_DRIVE_INTERACTION_REQUIRED"
        ) {
          updateSyncBindingState(activeVaultBinding.localVaultId, {
            syncStatus: "error",
            lastError: message
          });
          refreshSyncRegistryState();
        }
      } finally {
        schedule(45_000);
      }
    };

    schedule(2_500);

    return () => {
      cancelled = true;

      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [
    activeVaultBinding,
    activeVaultConnection,
    isDocumentVisible,
    online,
    refreshGoogleDriveConnectionSilently,
    requestAutoSync,
    vaultBooting
  ]);

  useEffect(() => {
    const previousEditorNoteId = previousOrbitalEditorNoteIdRef.current;
    previousOrbitalEditorNoteIdRef.current = orbitalEditorNoteId;

    if (!previousEditorNoteId || orbitalEditorNoteId !== null || activeVaultPendingSync.total <= 0) {
      return;
    }

    requestAutoSync({
      delayMs: 380
    });
  }, [activeVaultPendingSync.total, orbitalEditorNoteId, requestAutoSync]);

  const handleSelectNote = async (noteId: string) => {
    setSelectedNoteId(noteId);
    await patchSettings({
      lastOpenedNoteId: noteId
    });

    if (window.innerWidth <= 980) {
      setMobileSection("editor");
    }
  };

  const handleCreateFolderNode = async (
    name: string,
    parentId: string | null,
    color?: string,
    projectId?: string
  ) => {
    const folder = await createFolder(name, parentId, color, projectId);
    requestAutoSync({
      delayMs: 1500
    });
    return folder;
  };

  const handleCreateNoteAt = async (
    folderId: string | null,
    tagIds: string[] = [],
    projectId?: string
  ) => {
    const note = await createNote(folderId, tagIds, projectId);
    newDocumentDraftIdsRef.current.add(note.id);
    setSelectedNoteId(note.id);
    setSaveState("saved");
    return note;
  };

  const handleCreateCanvasAt = async (
    folderId: string | null,
    tagIds: string[] = [],
    projectId?: string
  ) => {
    const canvas = await createCanvas(folderId, tagIds, projectId);
    newDocumentDraftIdsRef.current.add(canvas.id);
    setSelectedNoteId(canvas.id);
    setSaveState("saved");
    return canvas;
  };

  const handleCreateProjectNode = async (x: number, y: number, name = "") => {
    const project = await createProject(name.trim(), x, y);
    requestAutoSync({
      delayMs: 1500
    });
    return project;
  };

  const handleRenameProject = async (projectId: string, name: string) => {
    const changed = await renameProject(projectId, name);

    if (changed) {
      requestAutoSync({
        delayMs: 1800
      });
    }
  };

  const handleUpdateProjectPosition = async (projectId: string, x: number, y: number) => {
    const changed = await updateProjectPosition(projectId, x, y);

    if (changed) {
      requestAutoSync({
        delayMs: 2600
      });
    }
  };

  const handleUpdateProjectSortOrder = async (projectId: string, sortOrder: number) => {
    const changed = await updateProjectSortOrder(projectId, sortOrder);

    if (changed) {
      requestAutoSync({
        delayMs: 1800
      });
    }
  };

  const handleUpdateProjectColor = async (projectId: string, color: string) => {
    const changed = await updateProjectColor(projectId, color);

    if (changed) {
      requestAutoSync({
        delayMs: 1800
      });
    }
  };

  const handleRenameFolder = async (folderId: string, name: string) => {
    const changed = await renameFolder(folderId, name);

    if (changed) {
      requestAutoSync({
        delayMs: 1800
      });
    }
  };

  const handleUpdateFolderColor = async (folderId: string, color: string) => {
    const changed = await updateFolderColor(folderId, color);

    if (changed) {
      requestAutoSync({
        delayMs: 1800
      });
    }
  };

  const handleMoveFolder = async (
    folderId: string,
    parentId: string | null,
    projectId?: string,
    sortOrder?: number
  ) => {
    const changed = await moveFolder(folderId, parentId, projectId, sortOrder);

    if (changed) {
      requestAutoSync({
        delayMs: 1500
      });
    }
  };

  const handleMoveNote = async (
    noteId: string,
    folderId: string | null,
    projectId?: string,
    sortOrder?: number
  ) => {
    const changed = await moveNote(noteId, folderId, projectId, sortOrder);

    if (changed) {
      requestAutoSync({
        delayMs: 1500
      });
    }
  };

  const handleDuplicateFolder = async (
    folderId: string,
    parentId: string | null,
    projectId?: string,
    sortOrder?: number
  ) => {
    const folder = await duplicateFolder(
      folderId,
      parentId,
      projectId,
      sortOrder,
      t("orbit.duplicateSuffix")
    );

    if (folder) {
      requestAutoSync({
        delayMs: 1500
      });
    }

    return folder;
  };

  const handleDuplicateNote = async (
    noteId: string,
    folderId: string | null,
    projectId?: string,
    sortOrder?: number
  ) => {
    const note = await duplicateNote(
      noteId,
      folderId,
      projectId,
      sortOrder,
      t("orbit.duplicateSuffix")
    );

    if (note) {
      requestAutoSync({
        delayMs: 1500
      });
    }

    return note;
  };

  const handleCreateTag = async (name: string) => {
    const tag = await createTag(name);
    requestAutoSync({
      delayMs: 1800
    });
    return tag;
  };

  const handleUpdateNoteMeta = async (
    noteId: string,
    patch: Partial<
      Pick<
        Note,
        | "title"
        | "projectId"
        | "folderId"
        | "color"
        | "tagIds"
        | "pinned"
        | "favorite"
        | "archived"
        | "trashedAt"
      >
    >,
    delayMs = 1800
  ) => {
    const changed = await updateNoteMeta(noteId, patch);

    if (changed) {
      requestAutoSync({
        delayMs
      });
    }
  };

  const handleToggleTagForNote = async (noteId: string, tagId: string) => {
    const note = notes.find((currentNote) => currentNote.id === noteId);

    if (!note) {
      return;
    }

    const nextTagIds = note.tagIds.includes(tagId)
      ? note.tagIds.filter((currentTagId) => currentTagId !== tagId)
      : [...note.tagIds, tagId];

    await handleUpdateNoteMeta(noteId, {
      tagIds: nextTagIds
    });
  };

  const handleSetTagIdsForNote = async (noteId: string, tagIds: string[]) => {
    await handleUpdateNoteMeta(noteId, {
      tagIds: Array.from(new Set(tagIds))
    });
  };

  const handleContentChangeForNote = async (
    noteId: string,
    content: Note["content"],
    state: SaveState
  ) => {
    setSaveState(state);

    if (state === "saved") {
      const changed = await saveNoteContent(noteId, content);

      if (changed) {
        requestAutoSync({
          delayMs: 6000
        });
      }
    }
  };

  const handleSaveCanvasContentForNote = async (
    noteId: string,
    content: Note["canvasContent"],
    files: Awaited<ReturnType<typeof loadCanvasFiles>>,
    fileNames: Record<string, string>,
    state: SaveState
  ) => {
    setSaveState(state);

    if (state === "saved" && content) {
      const changed = await saveCanvasContent(noteId, content, files, fileNames);

      if (changed) {
        requestAutoSync({
          delayMs: 6000
        });
      }
    }
  };

  const handleStoreAsset = async (noteId: string, file: File) => {
    const assetUrl = await storeAsset(noteId, file);
    requestAutoSync({
      delayMs: 2400
    });
    return assetUrl;
  };

  const handleRestoreNoteById = async (noteId: string) => {
    const changed = await restoreNoteFromTrash(noteId);

    if (changed) {
      requestAutoSync({
        delayMs: 1500
      });
    }
  };

  const handleDeleteNoteById = async (noteId: string) => {
    const note = notes.find((currentNote) => currentNote.id === noteId);

    if (!note) {
      return false;
    }

    if (note.trashedAt) {
      const confirmed = await requestConfirmation({
        title: t("note.delete"),
        message: t("note.deleteConfirm"),
        confirmLabel: t("note.deletePermanently"),
        cancelLabel: t("dialog.cancel")
      });

      if (!confirmed) {
        return false;
      }

      await removeNote(note.id);
    } else {
      const confirmed = await requestConfirmation({
        title: t("note.moveToTrash"),
        message: t("note.moveToTrashConfirm"),
        confirmLabel: t("note.moveToTrash"),
        cancelLabel: t("dialog.cancel")
      });

      if (!confirmed) {
        return false;
      }

      await moveNoteToTrash(note.id);
    }

    newDocumentDraftIdsRef.current.delete(note.id);

    requestAutoSync({
      delayMs: 1500
    });

    if (selectedNoteId === note.id) {
      setSelectedNoteId(null);
    }

    if (orbitalEditorNoteId === note.id) {
      setOrbitalEditorNoteId(null);
    }

    return true;
  };

  const handleClearTrash = async () => {
    if (trashedNotes.length === 0) {
      return;
    }

    const confirmed = await requestConfirmation({
      title: t("orbit.clearTrashTitle"),
      message: t("orbit.clearTrashMessage", {
        count: trashedNotes.length
      }),
      confirmLabel: t("orbit.clearTrashAction"),
      cancelLabel: t("dialog.cancel"),
      details: [`${t("filters.viewTrash")}: ${trashedNotes.length}`]
    });

    if (!confirmed) {
      return;
    }

    const trashedIds = new Set(trashedNotes.map((note) => note.id));
    const removedCount = await clearTrash();

    if (removedCount === 0) {
      return;
    }

    requestAutoSync({
      delayMs: 1500
    });

    if (selectedNoteId && trashedIds.has(selectedNoteId)) {
      setSelectedNoteId(null);
    }

    if (orbitalEditorNoteId && trashedIds.has(orbitalEditorNoteId)) {
      setOrbitalEditorNoteId(null);
    }
  };

  const handleClearPlannerData = async () => {
    const plannerDataCounts = {
      tasks: tasks.length,
      habits: habits.length,
      habitLogs: habitLogs.length,
      goals: goals.length,
      timeBlocks: timeBlocks.length
    };
    const total =
      plannerDataCounts.tasks +
      plannerDataCounts.habits +
      plannerDataCounts.habitLogs +
      plannerDataCounts.goals +
      plannerDataCounts.timeBlocks;

    if (total === 0) {
      return false;
    }

    const confirmed = await requestConfirmation({
      title: t("settings.plannerClearDataConfirmTitle"),
      message: t("settings.plannerClearDataConfirmMessage", {
        count: total
      }),
      confirmLabel: t("settings.plannerClearDataConfirm"),
      cancelLabel: t("dialog.cancel"),
      details: [
        t("settings.plannerClearDataDetailTasks", { count: plannerDataCounts.tasks }),
        t("settings.plannerClearDataDetailHabits", { count: plannerDataCounts.habits }),
        t("settings.plannerClearDataDetailHabitLogs", { count: plannerDataCounts.habitLogs }),
        t("settings.plannerClearDataDetailGoals", { count: plannerDataCounts.goals }),
        t("settings.plannerClearDataDetailTimeBlocks", { count: plannerDataCounts.timeBlocks }),
        t("settings.plannerClearDataConfirmBoundary")
      ]
    });

    if (!confirmed) {
      return false;
    }

    const cleared = await clearPlannerData();

    if (cleared.total === 0) {
      return false;
    }

    setPlannerProjectFocusId(null);
    requestAutoSync({
      delayMs: 1200
    });

    return true;
  };

  const handleCreateNote = async () => {
    setViewMode("all");
    const note = await handleCreateNoteAt(selectedFolderId, selectedTagId ? [selectedTagId] : []);

    if (window.innerWidth <= 980) {
      setMobileSection("editor");
    }
  };

  const handleDeleteNote = async () => {
    if (!activeNote) {
      return;
    }

    await handleDeleteNoteById(activeNote.id);
  };

  const handleCreateFolder = async (name: string, parentId: string | null) => {
    await handleCreateFolderNode(name, parentId);
  };

  const handleDeleteFolder = async (folderId: string) => {
    const impact = await inspectFolderRemoval(folderId);
    const folderName = folderMap.get(folderId)?.name ?? t("folders.thisFolder");

    if (impact.folderCount > 1 || impact.noteCount > 0) {
      const confirmed = await requestConfirmation({
        title: t("folders.delete"),
      message: t("folders.deleteCascadeConfirm", {
          name: folderName,
          count: impact.noteCount,
          noteSummary: t("counts.notes", { count: impact.noteCount })
        }),
        confirmLabel: t("folders.delete"),
        cancelLabel: t("dialog.cancel"),
        details: [
          t("counts.folders", { count: impact.folderCount }),
          t("counts.notes", { count: impact.noteCount })
        ]
      });

      if (!confirmed) {
        return false;
      }
    }

    const deletedFolderIds = getFolderCascade(folderId, folders, notes).folderIds;
    await removeFolder(folderId);
    requestAutoSync({
      delayMs: 1500
    });

    if (selectedFolderId && deletedFolderIds.includes(selectedFolderId)) {
      setSelectedFolderId(null);
    }

    return true;
  };

  const handleDeleteProject = async (projectId: string) => {
    const project = projects.find((entry) => entry.id === projectId);

    if (!project) {
      return;
    }

    const deletedFolderIds = folders
      .filter((folder) => folder.projectId === projectId)
      .map((folder) => folder.id);
    const deletedFolderIdSet = new Set(deletedFolderIds);
    const deletedNotes = notes.filter((note) => note.projectId === projectId);
    const deletedNoteIds = deletedNotes.map((note) => note.id);
    const deletedNoteIdSet = new Set(deletedNoteIds);
    const assetCount = assets.filter((asset) => deletedNoteIdSet.has(asset.noteId)).length;

    const confirmed = await requestConfirmation({
      title: t("project.delete"),
        message: t("project.deleteConfirm", {
          name: getDisplayProjectName(
            project,
            currentAppLanguage,
            projects.findIndex((entry) => entry.id === project.id)
          ),
        folderSummary: t("counts.folders", { count: deletedFolderIds.length }),
        documentSummary: t("counts.documents", { count: deletedNoteIds.length }),
        fileSummary: t("counts.files", { count: assetCount })
      }),
      confirmLabel: t("project.delete"),
      cancelLabel: t("dialog.cancel"),
      details: [
        t("counts.folders", { count: deletedFolderIds.length }),
        t("counts.documents", { count: deletedNoteIds.length }),
        t("counts.files", { count: assetCount })
      ]
    });

    if (!confirmed) {
      return;
    }

    await removeProject(projectId);
    requestAutoSync({
      delayMs: 1500
    });

    if (selectedFolderId && deletedFolderIdSet.has(selectedFolderId)) {
      setSelectedFolderId(null);
    }

    if (selectedNoteId && deletedNoteIdSet.has(selectedNoteId)) {
      setSelectedNoteId(null);
    }

    if (orbitalEditorNoteId && deletedNoteIdSet.has(orbitalEditorNoteId)) {
      setOrbitalEditorNoteId(null);
    }
  };

  const handleChangePlannerSettings = async (
    patch: Partial<
      Pick<
        AppSettings,
        "plannerDefaultSurface" | "plannerWeekStartsOn" | "plannerDefaultCalendarView"
      >
    >
  ) => {
    await patchSettings(patch);
  };

  const handleChangeAccentTheme = (themeId: AppAccentThemeId) => {
    const nextThemeId = resolveAppAccentThemeId(themeId);
    writeStoredAppAccentThemeId(nextThemeId);
    setAccentThemeId(nextThemeId);
  };

  const handleChangeOrbitalAnimationMode = (mode: OrbitalAnimationMode) => {
    const nextMode = resolveOrbitalAnimationMode(mode);
    writeStoredOrbitalAnimationMode(nextMode);
    setOrbitalAnimationMode(nextMode);
  };

  const handleChangeOrbitalTemporalSignalsMode = (mode: OrbitalTemporalSignalsMode) => {
    const nextMode = resolveOrbitalTemporalSignalsMode(mode);
    writeStoredOrbitalTemporalSignalsMode(nextMode);
    setOrbitalTemporalSignalsMode(nextMode);
  };

  const getVaultDescriptor = (localVaultId: string) => {
    const vault =
      localVaults.find((entry) => entry.id === localVaultId) ??
      listLocalVaultProfiles().find((entry) => entry.id === localVaultId) ??
      null;

    if (!vault) {
      throw new Error("LOCAL_VAULT_NOT_FOUND");
    }

    return {
      localVaultId: vault.id,
      vaultGuid: vault.vaultGuid,
      name: vault.name,
      vaultKind: vault.vaultKind,
      schemaVersion: 1
    };
  };

  const readVaultSettings = async (localVaultId: string) => {
    if (localVaultId === activeLocalVaultId && settings) {
      return settings;
    }

    const vaultSettings = await readLocalVaultSettings(localVaultId);

    if (!vaultSettings) {
      throw new Error("SETTINGS_MISSING");
    }

    return vaultSettings;
  };

  const patchVaultSettings = async (
    localVaultId: string,
    patch: Partial<Omit<AppSettings, "id">>
  ) => {
    if (localVaultId === activeLocalVaultId) {
      await patchSettings(patch);
      return;
    }

    await patchLocalVaultSettings(localVaultId, patch);
  };

  const buildEncryptionDescriptorFromSettings = (
    vaultSettings: Awaited<ReturnType<typeof readLocalVaultSettings>>,
    state: "ready" | "locked" = "ready"
  ) => {
    if (
      !vaultSettings?.encryptionEnabled ||
      !vaultSettings.encryptionSalt ||
      !vaultSettings.encryptionKeyId ||
      !vaultSettings.encryptionKdf
    ) {
      throw new Error("VAULT_ENCRYPTION_DISABLED");
    }

    return {
      version: (vaultSettings.encryptionVersion ?? 1) as 1,
      state,
      keyId: vaultSettings.encryptionKeyId,
      kdf: vaultSettings.encryptionKdf,
      iterations: vaultSettings.encryptionIterations,
      salt: vaultSettings.encryptionSalt,
      keyCheck: vaultSettings.encryptionKeyCheck
    } satisfies SyncEncryptionDescriptor;
  };

  const handleEnableVaultEncryption = async (input: {
    localVaultId: string;
    passphrase: string;
  }) => {
    const remoteTarget = resolveRemoteEncryptionMigrationTarget(input.localVaultId);
    let descriptor: SyncEncryptionDescriptor | null = null;
    let revision: string | null = null;
    let completedAt: number | null = null;

    if (remoteTarget) {
      const migrated = await withLocalVaultDatabase(input.localVaultId, async (database) =>
        migrateRemoteVaultEncryption(
          remoteTarget.remote,
          {
            mode: "enable",
            passphrase: input.passphrase
          },
          database
        )
      );

      descriptor = migrated.descriptor;
      revision = migrated.revision;
      completedAt = Date.now();
      updateSyncBindingState(input.localVaultId, {
        syncStatus: "idle",
        lastError: null,
        lastSyncAt: completedAt,
        syncCursor: migrated.revision
      });
      refreshSyncRegistryState();
    } else {
      descriptor = await createEncryptionDescriptor(
        input.passphrase,
        getVaultDescriptor(input.localVaultId)
      );
    }

    if (!descriptor) {
      throw new Error("SYNC_FAILED");
    }

    await patchVaultSettings(input.localVaultId, {
      encryptionEnabled: true,
      encryptionVersion: descriptor.version,
      encryptionKdf: descriptor.kdf,
      encryptionIterations: descriptor.iterations,
      encryptionKeyId: descriptor.keyId,
      encryptionSalt: descriptor.salt,
      encryptionKeyCheck: descriptor.keyCheck,
      encryptionUpdatedAt: Date.now(),
      ...(completedAt !== null
        ? {
            lastSyncAt: completedAt,
            syncCursor: revision,
            syncStatus: "idle" as const
          }
        : {})
    });

    await unlockVaultEncryptionSession(input.localVaultId, input.passphrase);
    await refreshVaultEncryptionSummaries([input.localVaultId]);
    setSyncFeedback({
      tone: "success",
      text: remoteTarget
        ? t("sync.vaultEncryptionEnabledAndMigrated")
        : t("sync.vaultEncryptionEnabled")
    });
  };

  const handleUnlockVaultEncryption = async (input: {
    localVaultId: string;
    passphrase: string;
  }) => {
    let vaultSettings = await readLocalVaultSettings(input.localVaultId);

    if (!vaultSettings?.encryptionEnabled || !vaultSettings.encryptionSalt || !vaultSettings.encryptionKeyId) {
      const binding = syncBindingsByVaultId.get(input.localVaultId) ?? null;
      const connection = binding ? syncConnectionsById.get(binding.connectionId) ?? null : null;

      if (binding && connection) {
        await ensureLocalVaultSettingsRecord(input.localVaultId);

        await primeRemoteVaultEncryptionMetadata({
          provider: connection.provider,
          localVaultId: input.localVaultId,
          serverUrl: connection.serverUrl,
          remoteVaultId: binding.remoteVaultId,
          syncToken: connection.provider === "googleDrive" ? connection.sessionToken : binding.syncToken
        });

        vaultSettings = await readLocalVaultSettings(input.localVaultId);
      }
    }

    const descriptor = buildEncryptionDescriptorFromSettings(vaultSettings, "locked");

    await verifyEncryptionPassphrase(
      input.passphrase,
      descriptor,
      getVaultDescriptor(input.localVaultId)
    );

    await unlockVaultEncryptionSession(input.localVaultId, input.passphrase);
    const binding = syncBindingsByVaultId.get(input.localVaultId) ?? null;
    if (binding?.lastError === "VAULT_ENCRYPTION_LOCKED") {
      updateSyncBindingState(input.localVaultId, {
        syncStatus: "idle",
        lastError: null
      });
      refreshSyncRegistryState();
    }
    await refreshVaultEncryptionSummaries([input.localVaultId]);
    setSyncFeedback({
      tone: "success",
      text: t("sync.vaultEncryptionUnlocked")
    });
  };

  const resolveRemoteEncryptionMigrationTarget = (localVaultId: string) => {
    const binding = syncBindingsByVaultId.get(localVaultId) ?? null;

    if (!binding) {
      return null;
    }

    if (!online) {
      throw new Error("VAULT_ENCRYPTION_REMOTE_SYNC_REQUIRED");
    }

    const connection = syncConnectionsById.get(binding.connectionId) ?? null;

    if (!connection) {
      throw new Error("VAULT_ENCRYPTION_REMOTE_SYNC_REQUIRED");
    }

    const vaultProfile = localVaults.find((entry) => entry.id === localVaultId) ?? null;

    return {
      binding,
      remote: {
        provider: connection.provider,
        serverUrl: connection.serverUrl,
        vaultId: binding.remoteVaultId,
        token: connection.provider === "googleDrive" ? connection.sessionToken : binding.syncToken,
        localVaultId,
        localVaultName: vaultProfile?.name ?? binding.remoteVaultName
      } as const
    };
  };

  const handleChangeVaultEncryptionPassphrase = async (input: {
    localVaultId: string;
    currentPassphrase?: string;
    nextPassphrase: string;
  }) => {
    const currentPassphrase =
      input.currentPassphrase?.trim() || getVaultEncryptionSessionPassphrase(input.localVaultId) || "";

    if (!currentPassphrase) {
      throw new Error("VAULT_ENCRYPTION_LOCKED");
    }

    const remoteTarget = resolveRemoteEncryptionMigrationTarget(input.localVaultId);
    let nextDescriptor: SyncEncryptionDescriptor | null = null;
    let revision: string | null = null;
    let completedAt: number | null = null;

    if (remoteTarget) {
      const migrated = await withLocalVaultDatabase(input.localVaultId, async (database) =>
        migrateRemoteVaultEncryption(
          remoteTarget.remote,
          {
            mode: "changePassphrase",
            currentPassphrase,
            nextPassphrase: input.nextPassphrase
          },
          database
        )
      );

      nextDescriptor = migrated.descriptor;
      revision = migrated.revision;
      completedAt = Date.now();
      updateSyncBindingState(input.localVaultId, {
        syncStatus: "idle",
        lastError: null,
        lastSyncAt: completedAt,
        syncCursor: migrated.revision
      });
      refreshSyncRegistryState();
    } else {
      nextDescriptor = await createEncryptionDescriptor(
        input.nextPassphrase,
        getVaultDescriptor(input.localVaultId)
      );
    }

    if (!nextDescriptor) {
      throw new Error("VAULT_ENCRYPTION_DISABLED");
    }

    await patchVaultSettings(input.localVaultId, {
      encryptionEnabled: true,
      encryptionVersion: nextDescriptor.version,
      encryptionKdf: nextDescriptor.kdf,
      encryptionIterations: nextDescriptor.iterations,
      encryptionKeyId: nextDescriptor.keyId,
      encryptionSalt: nextDescriptor.salt,
      encryptionKeyCheck: nextDescriptor.keyCheck,
      encryptionUpdatedAt: Date.now(),
      syncStatus: "idle",
      ...(completedAt !== null
        ? {
            lastSyncAt: completedAt,
            syncCursor: revision
          }
        : {})
    });

    await unlockVaultEncryptionSession(input.localVaultId, input.nextPassphrase);
    await refreshVaultEncryptionSummaries([input.localVaultId]);
    setSyncFeedback({
      tone: "success",
      text: remoteTarget
        ? t("sync.vaultEncryptionPassphraseChanged")
        : t("sync.vaultEncryptionPassphraseChangedLocalOnly")
    });
  };

  const handleDisableVaultEncryption = async (input: {
    localVaultId: string;
    currentPassphrase?: string;
  }) => {
    const currentPassphrase =
      input.currentPassphrase?.trim() || getVaultEncryptionSessionPassphrase(input.localVaultId) || "";

    if (!currentPassphrase) {
      throw new Error("VAULT_ENCRYPTION_LOCKED");
    }

    const remoteTarget = resolveRemoteEncryptionMigrationTarget(input.localVaultId);
    let revision: string | null = null;
    let completedAt: number | null = null;

    if (remoteTarget) {
      const migrated = await withLocalVaultDatabase(input.localVaultId, async (database) =>
        migrateRemoteVaultEncryption(
          remoteTarget.remote,
          {
            mode: "disable",
            currentPassphrase
          },
          database
        )
      );

      revision = migrated.revision;
      completedAt = Date.now();
      updateSyncBindingState(input.localVaultId, {
        syncStatus: "idle",
        lastError: null,
        lastSyncAt: completedAt,
        syncCursor: migrated.revision
      });
      refreshSyncRegistryState();
    }

    await patchVaultSettings(input.localVaultId, {
      encryptionEnabled: false,
      encryptionVersion: null,
      encryptionKdf: null,
      encryptionIterations: null,
      encryptionKeyId: null,
      encryptionSalt: null,
      encryptionKeyCheck: null,
      encryptionUpdatedAt: null,
      syncStatus: "idle",
      ...(completedAt !== null
        ? {
            lastSyncAt: completedAt,
            syncCursor: revision
          }
        : {})
    });

    await lockVaultEncryptionSession(input.localVaultId);
    await refreshVaultEncryptionSummaries([input.localVaultId]);
    setSyncFeedback({
      tone: "success",
      text: remoteTarget
        ? t("sync.vaultEncryptionDisabledAndMigrated")
        : t("sync.vaultEncryptionDisabledLocalOnly")
    });
  };

  const handleLockVaultEncryption = async (localVaultId: string) => {
    await lockVaultEncryptionSession(localVaultId);
    await refreshVaultEncryptionSummaries([localVaultId]);
    setSyncFeedback({
      tone: "success",
      text: t("sync.vaultEncryptionLocked")
    });
  };

  const resetUiForVaultSwitch = () => {
    clearScheduledAutoSync();
    setSelectedFolderId(null);
    setSelectedTagId(null);
    setSelectedNoteId(null);
    setMobileSection("notes");
    setViewMode("all");
    setSearch("");
    setSaveState("idle");
    setOrbitalOpen(false);
    setOrbitalEditorNoteId(null);
    setSyncFeedback(null);
  };

  const activateLocalVault = (localVaultId: string) => {
    switchActiveLocalVaultDatabase(localVaultId);
    setStoredActiveLocalVaultId(localVaultId);
    setActiveLocalVaultId(localVaultId);
    setSelectedSyncVaultId(localVaultId);
    setLocalVaults(listLocalVaultProfiles());
    resetUiForVaultSwitch();
  };

  const createPrivateVaultLocally = async (
    localVaultId: string,
    passphrase: string
  ) => {
    if (!passphrase.trim()) {
      throw new Error("VAULT_ENCRYPTION_PASSPHRASE_REQUIRED");
    }

    if (passphrase.trim().length < 8) {
      throw new Error("VAULT_ENCRYPTION_PASSPHRASE_TOO_SHORT");
    }

    await ensureLocalVaultSettingsRecord(localVaultId);

    const descriptor = await createEncryptionDescriptor(passphrase.trim(), getVaultDescriptor(localVaultId));

    await patchLocalVaultSettings(localVaultId, {
      encryptionEnabled: true,
      encryptionVersion: descriptor.version,
      encryptionKdf: descriptor.kdf,
      encryptionIterations: descriptor.iterations,
      encryptionKeyId: descriptor.keyId,
      encryptionSalt: descriptor.salt,
      encryptionKeyCheck: descriptor.keyCheck,
      encryptionUpdatedAt: Date.now(),
      syncStatus: "idle"
    });

    await unlockVaultEncryptionSession(localVaultId, passphrase.trim());
  };

  const handleCreateLocalVault = async (input: {
    name: string;
    vaultKind: LocalVaultKind;
    passphrase?: string;
    activate?: boolean;
  }) => {
    const webCloudCanWrite =
      adaptiveLayout.runtimeKind === "web" &&
      Boolean(locorisCloudConnection) &&
      webCloudOverview?.entitlement.capabilities.webAppEnabled !== false &&
      webCloudOverview?.entitlement.capabilities.canWriteSync === true;

    if (adaptiveLayout.runtimeKind === "web" && !webCloudCanWrite && localVaults.length >= 1) {
      const limitMessage = t("webAccess.localVaultLimit");
      setSyncFeedback({
        tone: "error",
        text: limitMessage
      });
      setWebAccessFeedback({
        tone: "error",
        text: limitMessage
      });
      throw new Error(limitMessage);
    }

    const createdVault = createLocalVaultProfile(input.name, {
      activate: false,
      vaultKind: input.vaultKind
    });

    try {
      if (input.vaultKind === "private") {
        await createPrivateVaultLocally(createdVault.id, input.passphrase ?? "");
        await refreshVaultEncryptionSummaries([createdVault.id]);
        await syncVaultKindsFromEncryptionState([createdVault.id]);
      }
    } catch (error) {
      removeLocalVaultProfile(createdVault.id);
      await deleteLocalVaultDatabase(createdVault.id);
      setLocalVaults(listLocalVaultProfiles());
      setSelectedSyncVaultId(activeLocalVaultId);
      throw error;
    }

    setLocalVaults(listLocalVaultProfiles());

    if (input.activate) {
      activateLocalVault(createdVault.id);
    } else {
      setSelectedSyncVaultId(createdVault.id);
    }

    return createdVault.id;
  };

  const handleRenameLocalVault = async (localVaultId: string, name: string) => {
    const previousProfile = getLocalVaultProfile(localVaultId);
    const previousName = previousProfile?.name ?? "";
    const binding = syncBindingsByVaultId.get(localVaultId) ?? null;
    const connection = binding ? syncConnectionsById.get(binding.connectionId) ?? null : null;

    renameLocalVaultProfile(localVaultId, name);
    setLocalVaults(listLocalVaultProfiles());

    if (!binding || !connection) {
      return;
    }

    updateSyncBindingState(localVaultId, {
      syncStatus: "syncing",
      lastError: null
    });
    refreshSyncRegistryState();

    try {
      const didSyncRemoteName = await syncBoundRemoteVaultName(localVaultId, name);

      if (!didSyncRemoteName) {
        return;
      }

      updateSyncBindingState(localVaultId, {
        syncStatus: "idle",
        lastError: null,
        lastSyncAt: Date.now()
      });
      refreshSyncRegistryState();
    } catch (error) {
      renameLocalVaultProfile(localVaultId, previousName);
      setLocalVaults(listLocalVaultProfiles());

      const errorMessage = getErrorMessage(error);
      updateSyncBindingState(localVaultId, {
        syncStatus: "error",
        lastError: errorMessage
      });
      refreshSyncRegistryState();
      setSyncFeedback({
        tone: "error",
        text: translateSyncError(error, connection.provider)
      });
    }
  };

  const discardEmptyDocumentDraftIfNeeded = useCallback(
    (noteId: string) => {
      if (typeof window === "undefined" || !newDocumentDraftIdsRef.current.has(noteId)) {
        return;
      }

      window.setTimeout(() => {
        void (async () => {
          try {
            const note = await db.notes.get(noteId);

            if (!note) {
              newDocumentDraftIdsRef.current.delete(noteId);
              return;
            }

            const assetCount = await db.assets.where("noteId").equals(noteId).count();
            const hasMeaningfulTitle = hasExplicitDisplayName(note.title);
            const hasMeaningfulBody =
              note.contentType === "canvas"
                ? hasMeaningfulCanvasContent(note.canvasContent)
                : hasMeaningfulNoteContent(note.content);

            if (!hasMeaningfulTitle && !hasMeaningfulBody && assetCount === 0) {
              await removeNote(noteId);
              newDocumentDraftIdsRef.current.delete(noteId);

              if (selectedNoteId === noteId) {
                setSelectedNoteId(null);
                await patchSettings({
                  lastOpenedNoteId: null
                });
              }

              requestAutoSync({
                delayMs: 1500
              });
              return;
            }

            newDocumentDraftIdsRef.current.delete(noteId);
          } catch {
            newDocumentDraftIdsRef.current.delete(noteId);
          }
        })();
      }, 40);
    },
    [requestAutoSync, selectedNoteId]
  );

  const handleCloseOrbitalEditor = useCallback(() => {
    const closingNoteId = orbitalEditorNoteId;
    setOrbitalEditorNoteId(null);

    if (closingNoteId) {
      discardEmptyDocumentDraftIfNeeded(closingNoteId);
    }
  }, [discardEmptyDocumentDraftIfNeeded, orbitalEditorNoteId]);

  const clearLocalVaultBindingState = async (localVaultId: string) => {
    const binding = syncBindingsByVaultId.get(localVaultId);

    if (!binding) {
      return false;
    }

    await resetLocalVaultSyncBinding(localVaultId);
    await clearSyncBinding(localVaultId);

    if (localVaultId === activeLocalVaultId) {
      clearScheduledAutoSync();
    }

    refreshSyncRegistryState();
    return true;
  };

  const handleDeleteLocalVault = async (
    localVaultId: string,
    options?: {
      skipConfirmation?: boolean;
    }
  ) => {
    const targetVault = localVaults.find((vault) => vault.id === localVaultId);

    if (!targetVault) {
      return;
    }

    if (localVaults.length <= 1) {
      setSyncFeedback({
        tone: "error",
        text: t("sync.localVaultCannotDeleteLast")
      });
      return;
    }

    if (!(options?.skipConfirmation ?? false)) {
      const confirmed = await requestConfirmation({
        title: t("sync.localVaultDelete"),
        message: t("sync.localVaultDeleteConfirm", {
          name: getDisplayVaultName(
            targetVault,
            currentAppLanguage,
            localVaults.findIndex((vault) => vault.id === targetVault.id)
          )
        }),
        confirmLabel: t("sync.localVaultDelete"),
        cancelLabel: t("dialog.cancel")
      });

      if (!confirmed) {
        return;
      }
    }

    const nextLocalVaultId = getNextLocalVaultAfterDelete(localVaultId);

    if (localVaultId === activeLocalVaultId) {
      const nextActiveVaultId = nextLocalVaultId;
      switchActiveLocalVaultDatabase(nextActiveVaultId);
      setStoredActiveLocalVaultId(nextActiveVaultId);
      setActiveLocalVaultId(nextActiveVaultId);
      resetUiForVaultSwitch();
    }

    if (localVaultId === selectedSyncVaultId) {
      setSelectedSyncVaultId(nextLocalVaultId);
    }

    removeLocalVaultProfile(localVaultId);
    await removeBindingsForLocalVault(localVaultId);
    await deleteLocalVaultDatabase(localVaultId);
    setLocalVaults(listLocalVaultProfiles());
    refreshSyncRegistryState();
  };

  const handleCreateSyncConnection = async (input: {
    provider: SyncConnectionProvider;
    role?: SyncConnection["role"];
    serverUrl: string;
    label?: string;
    managementToken?: string;
    sessionToken?: string;
    refreshToken?: string | null;
    tokenExpiresAt?: number | null;
    userId?: string | null;
    userName?: string;
    userEmail?: string;
    selfHostedDeviceId?: string | null;
    selfHostedRole?: "owner" | "guest" | null;
    selfHostedServerId?: string | null;
  }) => {
    const connection = await createSyncConnection(input);
    refreshSyncRegistryState();
    return connection;
  };

  const handleDeleteSyncConnection = async (
    connectionId: string,
    options?: { skipConfirmation?: boolean }
  ) => {
    const connection = syncConnectionsById.get(connectionId) ?? null;
    const affectedBindings = syncBindings.filter((binding) => binding.connectionId === connectionId);

    if (affectedBindings.length > 0 && !(options?.skipConfirmation ?? false)) {
      const confirmed = await requestConfirmation({
        title: t("sync.connectionDelete"),
        message: t("sync.connectionDeleteConfirm", {
          count: affectedBindings.length
        }),
        confirmLabel: t("sync.connectionDelete"),
        cancelLabel: t("dialog.cancel")
      });

      if (!confirmed) {
        return;
      }
    }

    for (const binding of affectedBindings) {
      await resetLocalVaultSyncBinding(binding.localVaultId);
    }

    if (connection?.provider === "googleDrive") {
      await clearGoogleDriveAccountSession(connection.sessionToken).catch(() => undefined);
    }

    await removeSyncConnection(connectionId);
    refreshSyncRegistryState();
  };

  const handleRevokeGoogleDriveConnection = async (connectionId: string) => {
    const connection = syncConnectionsById.get(connectionId) ?? null;

    if (connection?.provider !== "googleDrive") {
      return;
    }

    const confirmed = await requestConfirmation({
      title: t("sync.googleDriveRevoke"),
      message: t("sync.googleDriveRevokeConfirm"),
      confirmLabel: t("sync.googleDriveRevoke"),
      cancelLabel: t("dialog.cancel")
    });

    if (!confirmed) {
      return;
    }

    await revokeGoogleDriveAccountAccess(connection.sessionToken, connection.id);
    await updateSyncConnection(connection.id, {
      sessionToken: "",
      refreshToken: null,
      tokenExpiresAt: null,
      changePageToken: null
    });
    syncBindings
      .filter((binding) => binding.connectionId === connection.id)
      .forEach((binding) => {
        updateSyncBindingState(binding.localVaultId, {
          syncStatus: "error",
          lastError: "GOOGLE_DRIVE_AUTH_REQUIRED"
        });
      });
    refreshSyncRegistryState();
  };

  const handleUpdateSyncConnection = async (
    connectionId: string,
    patch: Partial<Omit<SyncConnection, "id" | "provider" | "createdAt" | "refreshToken">> & {
      refreshToken?: string | null;
    }
  ) => {
    await updateSyncConnection(connectionId, patch);
    refreshSyncRegistryState();
  };

  const handleDeleteRemoteVault = async (input: {
    connectionId: string;
    remoteVaultId: string;
  }) => {
    const connection = syncConnectionsById.get(input.connectionId) ?? null;

    if (!connection) {
      throw new Error("SYNC_CONNECTION_NOT_FOUND");
    }

    if (connection.provider === "hosted") {
      await deleteHostedVault(connection.serverUrl, connection.sessionToken, input.remoteVaultId);
    } else if (connection.provider === "googleDrive") {
      await deleteGoogleDriveVault(connection.sessionToken, input.remoteVaultId);
    } else {
      await deletePersonalServerVault(
        connection.serverUrl,
        connection.managementToken,
        input.remoteVaultId
      );
    }

    const affectedBindings = syncBindings.filter(
      (binding) =>
        binding.connectionId === input.connectionId && binding.remoteVaultId === input.remoteVaultId
    );

    for (const binding of affectedBindings) {
      await clearLocalVaultBindingState(binding.localVaultId);
    }
  };

  const handleRenameRemoteVault = async (input: {
    connectionId: string;
    remoteVaultId: string;
    name: string;
  }) => {
    const connection = syncConnectionsById.get(input.connectionId) ?? null;
    const name = input.name.trim().slice(0, 80);

    if (!connection) {
      throw new Error("SYNC_CONNECTION_NOT_FOUND");
    }

    if (!name) {
      throw new Error("LOCAL_VAULT_NAME_REQUIRED");
    }

    const result =
      connection.provider === "hosted"
        ? await renameHostedVault(connection.serverUrl, connection.sessionToken, input.remoteVaultId, name)
        : connection.provider === "googleDrive"
          ? await renameGoogleDriveVault(connection.sessionToken, input.remoteVaultId, name)
          : await renamePersonalServerVault(
              connection.serverUrl,
              connection.managementToken,
              input.remoteVaultId,
              name
            );
    const nextName = result.vault?.name?.trim() || name;
    const affectedBindings = syncBindings.filter(
      (binding) =>
        binding.connectionId === input.connectionId && binding.remoteVaultId === input.remoteVaultId
    );

    for (const binding of affectedBindings) {
      renameLocalVaultProfile(binding.localVaultId, nextName);
      updateSyncBindingRemoteName(binding.localVaultId, nextName);
    }

    if (affectedBindings.length > 0) {
      setLocalVaults(listLocalVaultProfiles());
      refreshSyncRegistryState();
    }
  };

  const issueConnectionVaultToken = async (
    connectionId: string,
    remoteVaultId: string,
    label: string
  ) => {
    const connection = syncConnectionsById.get(connectionId) ?? null;

    if (!connection) {
      throw new Error("SYNC_CONNECTION_NOT_FOUND");
    }

    if (connection.provider === "hosted") {
      if (!settings) {
        throw new Error("APP_SETTINGS_NOT_READY");
      }

      const response = await registerHostedVaultDevice(
        connection.serverUrl,
        connection.sessionToken,
        remoteVaultId,
        getHostedDeviceIdentity(settings.localDeviceId)
      );

      return {
        connection,
        syncToken: response.token
      };
    }

    if (connection.provider === "googleDrive") {
      const response = await issueGoogleDriveVaultToken(remoteVaultId);

      return {
        connection,
        syncToken: response.token
      };
    }

    const response = await issuePersonalServerVaultToken(
      connection.serverUrl,
      connection.managementToken,
      remoteVaultId,
      label
    );

    return {
      connection,
      syncToken: response.token
    };
  };

  const applyVaultBinding = useCallback(
    async (
      input: {
        localVaultId: string;
        connectionId: string;
        remoteVaultId: string;
        remoteVaultName?: string;
        syncToken: string;
      },
      options?: {
        resetLocalSyncState?: boolean;
        keepBindingMetadata?: boolean;
        lastSyncAt?: number | null;
        syncCursor?: string | null;
        successMessage?: string | null;
        scheduleSync?: boolean;
      }
    ) => {
      if (options?.resetLocalSyncState ?? true) {
        await resetLocalVaultSyncBinding(input.localVaultId);
      }

      updateLocalVaultProfile(input.localVaultId, {
        vaultGuid: input.remoteVaultId
      });

      await upsertSyncBinding({
        ...input,
        syncStatus: "idle",
        lastError: null,
        ...(options?.keepBindingMetadata
          ? {}
          : {
              lastSyncAt: options?.lastSyncAt ?? null,
              syncCursor: options?.syncCursor ?? null
            })
      });

      setLocalVaults(listLocalVaultProfiles());
      refreshSyncRegistryState();

      if (options?.successMessage) {
        setSyncFeedback({
          tone: "success",
          text: options.successMessage
        });
      }

      if ((options?.scheduleSync ?? false) && input.localVaultId === activeLocalVaultId) {
        window.setTimeout(() => {
          requestAutoSync({
            delayMs: 700,
            force: true
          });
        }, 0);
      }
    },
    [activeLocalVaultId, refreshSyncRegistryState, requestAutoSync]
  );

  const handleBindVaultToConnection = async (input: {
    localVaultId: string;
    connectionId: string;
    remoteVaultId: string;
    remoteVaultName?: string;
    syncToken: string;
  }) => {
    await applyVaultBinding(input, {
      resetLocalSyncState: true,
      keepBindingMetadata: false,
      lastSyncAt: null,
      syncCursor: null,
      successMessage: t("sync.bindingUpdated"),
      scheduleSync: true
    });
  };

  const handleRefreshHostedConnectionCredentials = useCallback(
    async (connection: SyncConnection) => {
      if (connection.provider !== "hosted") {
        return;
      }

      if (!settings) {
        throw new Error("APP_SETTINGS_NOT_READY");
      }

      const hostedBindings = syncBindings.filter((binding) => binding.connectionId === connection.id);

      if (hostedBindings.length === 0) {
        return;
      }

      const refreshedBindings: SyncVaultBinding[] = [];

      for (const binding of hostedBindings) {
        const response = await registerHostedVaultDevice(
          connection.serverUrl,
          connection.sessionToken,
          binding.remoteVaultId,
          getHostedDeviceIdentity(settings.localDeviceId)
        );
        const refreshedBinding = {
          ...binding,
          syncToken: response.token,
          syncStatus: "idle",
          lastError: null,
          updatedAt: Date.now()
        } satisfies SyncVaultBinding;

        await applyVaultBinding(
          {
            localVaultId: binding.localVaultId,
            connectionId: binding.connectionId,
            remoteVaultId: binding.remoteVaultId,
            remoteVaultName: binding.remoteVaultName,
            syncToken: response.token
          },
          {
            resetLocalSyncState: false,
            keepBindingMetadata: true,
            successMessage: null,
            scheduleSync: false
          }
        );

        if (!binding.syncToken.trim() || binding.lastError || binding.syncStatus === "error") {
          refreshedBindings.push(refreshedBinding);
        }
      }

      for (const binding of refreshedBindings) {
        await runBoundVaultSync(binding.localVaultId, {
          bindingOverride: binding,
          connectionOverride: connection
        });
      }
    },
    [applyVaultBinding, runBoundVaultSync, settings, syncBindings]
  );

  const handleRefreshGoogleDriveConnectionCredentials = async (connection: SyncConnection) => {
    if (connection.provider !== "googleDrive") {
      return;
    }

    const repairedBindings: SyncVaultBinding[] = [];

    for (const binding of listSyncBindings().filter(
      (entry) => entry.connectionId === connection.id
    )) {
      const repairedBinding = await upsertSyncBinding({
        ...binding,
        syncStatus: "idle",
        lastError: null
      });
      repairedBindings.push(repairedBinding);
    }

    refreshSyncRegistryState();

    for (const binding of repairedBindings) {
      await runBoundVaultSync(binding.localVaultId, {
        bindingOverride: binding,
        connectionOverride: connection
      });
    }
  };

  const handleRestoreHostedVaultBindings = useCallback(
    async (connection: SyncConnection, remoteVaults: HostedAccountVault[]) => {
      if (connection.provider !== "hosted" || !settings) {
        return { restored: 0, failed: 0 };
      }

      let restored = 0;
      let failed = 0;
      const candidates = planExactHostedVaultBindingRecovery(
        localVaults,
        listSyncBindings(),
        remoteVaults
      );
      let recoveryConnection = connection;

      for (const { localVault: vault, remoteVault } of candidates) {
        try {
          const registerDevice = (candidate: SyncConnection) =>
            registerHostedVaultDevice(
              candidate.serverUrl,
              candidate.sessionToken,
              remoteVault.id,
              getHostedDeviceIdentity(settings.localDeviceId)
            );
          let registration: Awaited<ReturnType<typeof registerHostedVaultDevice>>;

          try {
            registration = await registerDevice(recoveryConnection);
          } catch (error) {
            if (!isHostedReauthRequiredError(error)) {
              throw error;
            }

            recoveryConnection = await refreshHostedConnectionSession(recoveryConnection, {
              force: true
            });
            registration = await registerDevice(recoveryConnection);
          }

          await applyVaultBinding(
            {
              localVaultId: vault.id,
              connectionId: recoveryConnection.id,
              remoteVaultId: remoteVault.id,
              remoteVaultName: remoteVault.name,
              syncToken: registration.token
            },
            {
              resetLocalSyncState: false,
              keepBindingMetadata: false,
              lastSyncAt: null,
              syncCursor: null,
              successMessage: null,
              scheduleSync: false
            }
          );

          const binding = listSyncBindings().find((entry) => entry.localVaultId === vault.id) ?? null;

          if (binding) {
            await runBoundVaultSync(vault.id, {
              bindingOverride: binding,
              connectionOverride: recoveryConnection
            });
          }

          restored += 1;
        } catch {
          failed += 1;
        }
      }

      refreshSyncRegistryState();
      return { restored, failed };
    },
    [
      applyVaultBinding,
      localVaults,
      refreshHostedConnectionSession,
      refreshSyncRegistryState,
      runBoundVaultSync,
      settings
    ]
  );

  const restoreHostedVaultBindingsSingleFlight = useCallback(
    (connection: SyncConnection, remoteVaults: HostedAccountVault[]) => {
      if (hostedBindingRecoveryPromiseRef.current) {
        return hostedBindingRecoveryPromiseRef.current;
      }

      const recovery = handleRestoreHostedVaultBindings(connection, remoteVaults).finally(() => {
        if (hostedBindingRecoveryPromiseRef.current === recovery) {
          hostedBindingRecoveryPromiseRef.current = null;
        }
      });

      hostedBindingRecoveryPromiseRef.current = recovery;
      return recovery;
    },
    [handleRestoreHostedVaultBindings]
  );

  useEffect(() => {
    if (!online || !settings || !locorisCloudConnection) {
      if (!locorisCloudConnection) {
        hostedBindingReconciliationKeyRef.current = null;
      }
      return;
    }

    const localIdentityKey = localVaults
      .map((vault) => `${vault.id}:${vault.vaultGuid}`)
      .sort()
      .join("|");
    const bindingIdentityKey = syncBindings
      .map(
        (binding) =>
          `${binding.localVaultId}:${binding.connectionId}:${binding.remoteVaultId}:${binding.syncToken.trim() ? "ready" : "missing"}`
      )
      .sort()
      .join("|");
    const reconciliationKey = [
      locorisCloudConnection.id,
      locorisCloudConnection.userId ?? "",
      locorisCloudConnection.serverUrl,
      localIdentityKey,
      bindingIdentityKey
    ].join("::");

    if (hostedBindingReconciliationKeyRef.current === reconciliationKey) {
      return;
    }

    hostedBindingReconciliationKeyRef.current = reconciliationKey;
    let cancelled = false;

    const loadOverviewWithSessionRepair = async () => {
      let connection =
        listSyncConnections().find((entry) => entry.id === locorisCloudConnection.id) ??
        locorisCloudConnection;

      if (
        shouldRefreshHostedSession(connection) ||
        (!connection.sessionToken.trim() && canRefreshHostedSession(connection))
      ) {
        connection = await refreshHostedConnectionSession(connection, { force: true });
      }

      try {
        return {
          connection,
          overview: await loadHostedAccountOverview(connection.serverUrl, connection.sessionToken)
        };
      } catch (error) {
        if (getErrorMessage(error) !== "UNAUTHORIZED") {
          throw error;
        }

        connection = await refreshHostedConnectionSession(connection, { force: true });
        return {
          connection,
          overview: await loadHostedAccountOverview(connection.serverUrl, connection.sessionToken)
        };
      }
    };

    void loadOverviewWithSessionRepair()
      .then(async ({ connection, overview }) => {
        const bindingsNeedingCredentials = listSyncBindings().some(
          (binding) => binding.connectionId === connection.id && !binding.syncToken.trim()
        );

        if (bindingsNeedingCredentials) {
          await handleRefreshHostedConnectionCredentials(connection);
        }

        const restoration = await restoreHostedVaultBindingsSingleFlight(
          connection,
          overview.vaults
        );
        let nextOverview = overview;

        if (restoration.restored > 0) {
          nextOverview = await loadHostedAccountOverview(
            connection.serverUrl,
            connection.sessionToken
          );
          setSyncFeedback(null);
        }

        if (cancelled) {
          return;
        }

        if (adaptiveLayout.runtimeKind === "web") {
          setWebCloudOverview(nextOverview);
          setWebCloudAuthState("authenticated");
          setWebCloudInitialCheckComplete(true);
        }

        if (restoration.failed > 0) {
          setWebAccessFeedback({
            tone: "error",
            text: t("settings.accountCloudBindingsRestorePartial", {
              restored: restoration.restored,
              failed: restoration.failed
            })
          });
        }
      })
      .catch((error) => {
        hostedBindingReconciliationKeyRef.current = null;

        if (cancelled) {
          return;
        }

        if (adaptiveLayout.runtimeKind === "web" && isHostedReauthRequiredError(error)) {
          setWebCloudAuthState("reauthRequired");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    adaptiveLayout.runtimeKind,
    handleRefreshHostedConnectionCredentials,
    localVaults,
    locorisCloudConnection?.id,
    locorisCloudConnection?.serverUrl,
    locorisCloudConnection?.userId,
    online,
    refreshHostedConnectionSession,
    restoreHostedVaultBindingsSingleFlight,
    settings,
    syncBindings,
    t
  ]);

  const handleWebCloudAuthenticate = async (input: WebAuthInput) => {
    if (!settings) {
      throw new Error("APP_SETTINGS_NOT_READY");
    }

    if (!online) {
      throw new Error("SERVER_UNAVAILABLE");
    }

    const serverUrl = resolveLocorisCloudServerUrl(settings, locorisCloudConnection);

    if (!serverUrl) {
      throw new Error("CLOUD_ENDPOINT_NOT_CONFIGURED");
    }

    setWebCloudBusy(true);
    setWebAccessFeedback(null);

    try {
      const device = getHostedDeviceIdentity(settings.localDeviceId);
      const result =
        input.mode === "register"
          ? await registerHostedAccount(serverUrl, {
              name: "",
              email: input.email,
              password: input.password,
              ...device
            })
          : await loginHostedAccount(serverUrl, {
              email: input.email,
              password: input.password,
              ...device
            });

      let connection: SyncConnection;

      if (locorisCloudConnection) {
        connection = {
          ...locorisCloudConnection,
          role: "locorisCloud",
          serverUrl,
          sessionToken: result.session.token,
          refreshToken: result.session.refreshToken ?? "",
          tokenExpiresAt: result.session.expiresAt,
          userId: result.user.id,
          userName: result.user.name,
          userEmail: result.user.email ?? input.email,
          label: result.user.email ?? result.user.name,
          updatedAt: Date.now()
        };

        await handleUpdateSyncConnection(locorisCloudConnection.id, {
          role: "locorisCloud",
          label: connection.label,
          serverUrl: connection.serverUrl,
          sessionToken: connection.sessionToken,
          refreshToken: connection.refreshToken ?? null,
          tokenExpiresAt: connection.tokenExpiresAt,
          userId: connection.userId,
          userName: connection.userName,
          userEmail: connection.userEmail
        });
      } else {
        connection = await handleCreateSyncConnection({
          provider: "hosted",
          role: "locorisCloud",
          serverUrl,
          sessionToken: result.session.token,
          refreshToken: result.session.refreshToken ?? null,
          tokenExpiresAt: result.session.expiresAt,
          userId: result.user.id,
          userName: result.user.name,
          userEmail: result.user.email ?? input.email,
          label: result.user.email ?? result.user.name
        });
      }

      if (result.entitlement) {
        const { token: _accessToken, ...session } = result.session;
        const existingOverview =
          webCloudOverview?.user.id === result.user.id ? webCloudOverview : null;

        setWebCloudOverview({
          user: result.user,
          session,
          vaults: existingOverview?.vaults ?? [],
          devices: existingOverview?.devices ?? [],
          usage: existingOverview?.usage ?? {
            storageBytes: 0,
            vaultCount: 0,
            syncTokenCount: 0,
            deviceCount: 0
          },
          entitlement: result.entitlement
        });
        setWebCloudAuthState("authenticated");
      }

      void (async () => {
        const overview = await loadHostedAccountOverview(
          connection.serverUrl,
          connection.sessionToken
        );
        setWebCloudOverview(overview);
        setWebCloudAuthState("authenticated");
        setWebAccessFeedback(null);

        void (async () => {
          await handleRefreshHostedConnectionCredentials(connection);
          const restoration = await restoreHostedVaultBindingsSingleFlight(connection, overview.vaults);

          if (restoration.failed > 0) {
            setWebAccessFeedback({
              tone: "error",
              text: t("settings.accountCloudBindingsRestorePartial", {
                restored: restoration.restored,
                failed: restoration.failed
              })
            });
          } else if (restoration.restored > 0) {
            setWebAccessFeedback({
              tone: "success",
              text: t("settings.accountCloudBindingsRestored", {
                count: restoration.restored
              })
            });
          }
        })().catch((error) => {
          setWebAccessFeedback({
            tone: "error",
            text: translateSyncError(error, "hosted")
          });
        });
      })().catch((error) => {
        const reauthRequired = isHostedReauthRequiredError(error);
        setWebCloudAuthState(reauthRequired ? "reauthRequired" : "serverUnavailable");
        setWebAccessFeedback({
          tone: "error",
          text: reauthRequired
            ? t("sync.hostedSessionExpired")
            : translateSyncError(error, "hosted")
        });
      });
    } catch (error) {
      setWebCloudAuthState(locorisCloudConnection ? "reauthRequired" : "signedOut");
      throw error;
    } finally {
      setWebCloudBusy(false);
    }
  };

  const handleImportRemoteVault = async (input: {
    connectionId: string;
    remoteVaultId: string;
    remoteVaultName: string;
    remoteVaultKind?: LocalVaultKind;
    openAfterImport?: boolean;
  }): Promise<RemoteVaultImportResult> => {
    const remoteVaultId = input.remoteVaultId.trim();
    const remoteVaultName = input.remoteVaultName.trim() || input.remoteVaultId;

    if (!remoteVaultId) {
      throw new Error("VAULT_NOT_FOUND");
    }

    const { connection, syncToken } = await issueConnectionVaultToken(
      input.connectionId,
      remoteVaultId,
      `${remoteVaultName} · ${remoteVaultId}`
    );

    const existingLocalVault = getLocalVaultProfileByGuid(remoteVaultId);
    let targetLocalVault = existingLocalVault;
    let nameAdjusted = false;
    let disposition: RemoteVaultImportResult["disposition"] = existingLocalVault
      ? "linked"
      : "imported";
    let importedRevision: string | null | undefined;
    let importedAt: number | null | undefined;

    if (!targetLocalVault) {
      const uniqueName = resolveUniqueLocalVaultName(remoteVaultName);
      nameAdjusted = uniqueName !== remoteVaultName;
      targetLocalVault = createLocalVaultProfile(uniqueName, {
        activate: false,
        vaultGuid: remoteVaultId,
        vaultKind: input.remoteVaultKind ?? "regular"
      });
      await ensureLocalVaultSettingsRecord(targetLocalVault.id);
      setLocalVaults(listLocalVaultProfiles());
      setSelectedSyncVaultId(targetLocalVault.id);

      try {
        const imported = await importRemoteVaultIntoLocalVault({
          provider: connection.provider,
          localVaultId: targetLocalVault.id,
          serverUrl: connection.serverUrl,
          remoteVaultId,
          syncToken: connection.provider === "googleDrive" ? connection.sessionToken : syncToken
        });

        importedRevision = imported.revision;
        importedAt = Date.now();
        await refreshVaultEncryptionSummaries([targetLocalVault.id]);
        await syncVaultKindsFromEncryptionState([targetLocalVault.id]);
        if (imported.vaultKind === "private" && targetLocalVault.vaultKind !== "private") {
          updateLocalVaultProfile(targetLocalVault.id, {
            vaultKind: "private"
          });
          targetLocalVault = getLocalVaultProfileByGuid(remoteVaultId) ?? targetLocalVault;
          setLocalVaults(listLocalVaultProfiles());
        }
      } catch (error) {
        await refreshVaultEncryptionSummaries([targetLocalVault.id]);
        await syncVaultKindsFromEncryptionState([targetLocalVault.id]);

        if (error instanceof Error && error.message === "VAULT_ENCRYPTION_LOCKED") {
          disposition = "pendingUnlock";
        } else {
          throw error;
        }
      }
    }

    if (targetLocalVault && input.remoteVaultKind === "private" && targetLocalVault.vaultKind !== "private") {
      const targetLocalVaultId = targetLocalVault.id;
      updateLocalVaultProfile(targetLocalVault.id, {
        vaultKind: "private"
      });
      targetLocalVault =
        listLocalVaultProfiles().find((vault) => vault.id === targetLocalVaultId) ?? targetLocalVault;
      setLocalVaults(listLocalVaultProfiles());
    }

    await applyVaultBinding(
      {
        localVaultId: targetLocalVault.id,
        connectionId: input.connectionId,
        remoteVaultId,
        remoteVaultName,
        syncToken
      },
      {
        resetLocalSyncState: false,
        keepBindingMetadata: disposition === "linked",
        lastSyncAt: disposition === "imported" ? importedAt ?? null : undefined,
        syncCursor: disposition === "imported" ? importedRevision ?? null : undefined,
        successMessage:
          disposition === "pendingUnlock"
            ? null
            : disposition === "imported"
            ? nameAdjusted
              ? t("settings.remoteImportAdjusted", {
                  vault: targetLocalVault.name
                })
              : t("settings.remoteImportCreated", {
                  vault: targetLocalVault.name
                })
            : t("settings.remoteImportLinked", {
                vault: targetLocalVault.name
              }),
        scheduleSync:
          disposition !== "pendingUnlock" &&
          (input.openAfterImport === true || targetLocalVault.id === activeLocalVaultId)
      }
    );

    setSelectedSyncVaultId(targetLocalVault.id);

    if (input.openAfterImport) {
      activateLocalVault(targetLocalVault.id);
    } else {
      setLocalVaults(listLocalVaultProfiles());
    }

    return {
      localVaultId: targetLocalVault.id,
      localVaultName: targetLocalVault.name,
      disposition,
      nameAdjusted
    };
  };

  const handleClearVaultBinding = async (localVaultId: string) => {
    const binding = syncBindingsByVaultId.get(localVaultId);

    if (!binding) {
      return;
    }

    await clearLocalVaultBindingState(localVaultId);
    setSyncFeedback({
      tone: "success",
      text: t("sync.bindingCleared")
    });
  };

  const handleRunVaultSync = async (
    localVaultId: string,
    connectionOverride?: SyncConnection
  ) => {
    await runBoundVaultSync(localVaultId, {
      showFeedback: true,
      connectionOverride
    });
  };

  const refreshWebCloudOverview = async () => {
    if (!locorisCloudConnection) {
      setWebCloudOverview(null);
      return null;
    }

    const overview = await loadHostedAccountOverview(
      locorisCloudConnection.serverUrl,
      locorisCloudConnection.sessionToken
    );
    setWebCloudOverview(overview);
    return overview;
  };

  const handleExportCurrentVaultForWeb = async () => {
    if (!activeLocalVaultProfile) {
      return;
    }

    setWebCloudBusy(true);
    setWebAccessFeedback(null);

    try {
      const blob = await createLocorisBackupBlob({
        localVaultId: activeLocalVaultProfile.id,
        vaultName: activeLocalVaultDisplayName
      });

      await saveBlobFileWithDialog({
        defaultPath: getVaultBackupFileName(activeLocalVaultDisplayName),
        filters: [
          {
            name: "Locoris Backup",
            extensions: ["locorisbackup"]
          }
        ],
        blob,
        preferredExtension: "locorisbackup"
      });

      setWebAccessFeedback({
        tone: "success",
        text: t("webAccess.exportSuccess")
      });
    } catch (error) {
      setWebAccessFeedback({
        tone: "error",
        text: translateSyncError(error)
      });
    } finally {
      setWebCloudBusy(false);
    }
  };

  const handleTagToggle = async (tagId: string) => {
    if (!activeNote) {
      return;
    }

    await handleToggleTagForNote(activeNote.id, tagId);
  };

  const handleContentChange = async (content: Note["content"], state: SaveState) => {
    if (!activeNote) {
      return;
    }

    await handleContentChangeForNote(activeNote.id, content, state);
  };

  const handleToggleChecklistItemForNote = async (
    noteId: string,
    blockId: string,
    checked: boolean
  ) => {
    const note = notes.find((currentNote) => currentNote.id === noteId);

    if (!note || note.contentType !== "note") {
      return;
    }

    const checklistUpdate = updateChecklistItemChecked(note.content, blockId, checked);

    if (!checklistUpdate.changed) {
      return;
    }

    const checklistOrdering = normalizeChecklistOrdering(checklistUpdate.blocks);
    await handleContentChangeForNote(noteId, checklistOrdering.blocks, "saved");

    const linkedTasks = tasks.filter(
      (task) =>
        task.noteId === noteId &&
        task.sourceBlockId === blockId &&
        task.status !== "canceled" &&
        (checked ? task.status !== "done" : task.status === "done")
    );

    if (linkedTasks.length > 0) {
      await Promise.all(linkedTasks.map((task) => setPlannerTaskDoneRecord(task.id, checked)));
      requestAutoSync({
        delayMs: 1200
      });
    }
  };

  const syncChecklistSourceForPlannerTask = async (
    task: { noteId?: string | null; sourceBlockId?: string | null },
    checked: boolean
  ) => {
    if (!task.noteId || !task.sourceBlockId) {
      return;
    }

    await handleToggleChecklistItemForNote(task.noteId, task.sourceBlockId, checked);
  };

  const handleOpenOrbital = () => {
    setOrbitalOpen(true);
  };

  const handleCloseOrbital = () => {
    setOrbitalOpen(false);
    setOrbitalEditorNoteId(null);
  };

  const handleOpenOrbitalNote = async (noteId: string) => {
    const previousNoteId = orbitalEditorNoteId;
    await handleSelectNote(noteId);
    setOrbitalEditorNoteId(noteId);

    if (previousNoteId && previousNoteId !== noteId) {
      discardEmptyDocumentDraftIfNeeded(previousNoteId);
    }
  };

  const resolvePlannerContextTaskInput = (input: PlannerContextTaskInput): PlannerContextTaskInput => {
    const sourceNote = input.noteId
      ? notes.find((note) => note.id === input.noteId)
      : input.canvasId
        ? notes.find((note) => note.id === input.canvasId)
        : null;

    return {
      ...input,
      projectId: input.projectId ?? sourceNote?.projectId ?? null,
      folderId: input.folderId ?? sourceNote?.folderId ?? null
    };
  };

  const handleCreatePlannerTask = async (input: Parameters<typeof createPlannerTaskRecord>[0]) => {
    const task = await createPlannerTaskRecord(input);
    requestAutoSync({
      delayMs: 1500
    });
    return task;
  };

  const handleUpdatePlannerTask = async (
    taskId: string,
    patch: Parameters<typeof updatePlannerTaskRecord>[1]
  ) => {
    const task = await updatePlannerTaskRecord(taskId, patch);

    if (task) {
      if (patch.status) {
        await syncChecklistSourceForPlannerTask(task, patch.status === "done");
      }

      requestAutoSync({
        delayMs: 1500
      });
    }

    return task;
  };

  const handleTogglePlannerTaskDone = async (taskId: string, done: boolean) => {
    const task = await setPlannerTaskDoneRecord(taskId, done);

    if (task) {
      await syncChecklistSourceForPlannerTask(task, done);

      requestAutoSync({
        delayMs: 1200
      });
    }

    return task;
  };

  const handleDeletePlannerTask = async (taskId: string) => {
    await removePlannerTaskRecord(taskId);
    requestAutoSync({
      delayMs: 1200
    });
  };

  const handleCreatePlannerHabit = async (input: Parameters<typeof createPlannerHabitRecord>[0]) => {
    const habit = await createPlannerHabitRecord(input);
    requestAutoSync({
      delayMs: 1500
    });
    return habit;
  };

  const handleUpdatePlannerHabit = async (
    habitId: string,
    patch: Parameters<typeof updatePlannerHabitRecord>[1]
  ) => {
    const habit = await updatePlannerHabitRecord(habitId, patch);

    if (habit) {
      requestAutoSync({
        delayMs: 1500
      });
    }

    return habit;
  };

  const handleDeletePlannerHabit = async (habitId: string) => {
    await removePlannerHabitRecord(habitId);
    requestAutoSync({
      delayMs: 1200
    });
  };

  const handleTogglePlannerHabitLog = async (habitId: string, dayAt?: number) => {
    const habitLog = await togglePlannerHabitLogForDayRecord(habitId, dayAt);
    requestAutoSync({
      delayMs: 1200
    });
    return habitLog;
  };

  const handleCreatePlannerTimeBlock = async (input: Parameters<typeof createPlannerTimeBlockRecord>[0]) => {
    const timeBlock = await createPlannerTimeBlockRecord(input);
    requestAutoSync({
      delayMs: 1500
    });
    return timeBlock;
  };

  const handleUpdatePlannerTimeBlock = async (
    timeBlockId: string,
    patch: Parameters<typeof updatePlannerTimeBlockRecord>[1]
  ) => {
    const timeBlock = await updatePlannerTimeBlockRecord(timeBlockId, patch);

    if (timeBlock) {
      requestAutoSync({
        delayMs: 1500
      });
    }

    return timeBlock;
  };

  const handleDeletePlannerTimeBlock = async (timeBlockId: string) => {
    await removePlannerTimeBlockRecord(timeBlockId);
    requestAutoSync({
      delayMs: 1200
    });
  };

  const handleCreatePlannerTaskFromContext = async (input: PlannerContextTaskInput) => {
    const context = resolvePlannerContextTaskInput(input);
    const fallbackTitle = t("inline.plannerSurface.newTask");
    const title = normalizePlannerContextTaskTitle(context.title, fallbackTitle);
    const timestamp = Date.now();
    const task = await handleCreatePlannerTask({
      title,
      description: context.description?.trim() ?? "",
      status: "inbox",
      priority: "none",
      projectId: context.projectId ?? null,
      folderId: context.folderId ?? null,
      noteId: context.noteId ?? null,
      canvasId: context.canvasId ?? null,
      sourceBlockId: context.sourceBlockId ?? null,
      canvasElementId: context.canvasElementId ?? null,
      links: buildPlannerTaskLinks({
        context,
        projects,
        folders,
        notes,
        createdAt: timestamp
      })
    });

    setPlannerProjectFocusId(context.projectId ?? null);
    return task;
  };

  const handleOpenProjectPlan = (projectId: string) => {
    setPlannerProjectFocusId(projectId);
    setPlannerNavigationRequest((current) => ({
      viewId: "projects",
      requestId: (current?.requestId ?? 0) + 1
    }));
  };

  const handleOpenPlannerView = (viewId: PlannerViewId) => {
    setPlannerProjectFocusId(null);
    setPlannerNavigationRequest((current) => ({
      viewId,
      requestId: (current?.requestId ?? 0) + 1
    }));
  };

  const handleOpenProjectOnMap = (projectId: string) => {
    setPlannerProjectFocusId(null);
    setOrbitalProjectFocusRequest((current) => ({
      projectId,
      requestId: (current?.requestId ?? 0) + 1
    }));
  };

  const closeConfirmDialog = (result: boolean) => {
    const resolve = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmDialog(null);
    resolve?.(result);
  };

  const requestConfirmation = (payload: ConfirmDialogState) => {
    if (confirmResolverRef.current) {
      confirmResolverRef.current(false);
    }

    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmDialog(payload);
    });
  };

  useEffect(() => {
    return () => {
      if (confirmResolverRef.current) {
        confirmResolverRef.current(false);
        confirmResolverRef.current = null;
      }
    };
  }, []);

  if (adaptiveLayout.runtimeKind === "web" && !webCloudInitialCheckComplete) {
    return (
      <div
        className="locoris-adaptive-shell"
        data-runtime-kind={adaptiveLayout.runtimeKind}
        data-layout-device={adaptiveLayout.device}
        data-layout-orientation={adaptiveLayout.orientation}
        data-pointer-mode={adaptiveLayout.pointer}
        data-mobile-shell={adaptiveLayout.isMobileShell ? "true" : "false"}
      >
        <WebAccessGate
          enabled
          mode="checking"
          online={online}
          busy
          feedback={null}
          initialEmail={locorisCloudConnection?.userEmail ?? ""}
          entitlement={null}
          accountPortalUrl={null}
          onAuthenticate={handleWebCloudAuthenticate}
          onRetry={() => setWebCloudRetryTick((current) => current + 1)}
          onOpenCloud={openAccountCloudSettings}
          onExportVault={() => void handleExportCurrentVaultForWeb()}
        />
      </div>
    );
  }

  if (
    adaptiveLayout.runtimeKind === "web" &&
    settings &&
    (
      ["local", "unavailable", "checking", "serverUnavailable", "reauthRequired"] as WebAccessMode[]
    ).includes(webAccessMode)
  ) {
    return (
      <div
        className="locoris-adaptive-shell"
        data-runtime-kind={adaptiveLayout.runtimeKind}
        data-layout-device={adaptiveLayout.device}
        data-layout-orientation={adaptiveLayout.orientation}
        data-pointer-mode={adaptiveLayout.pointer}
        data-mobile-shell={adaptiveLayout.isMobileShell ? "true" : "false"}
      >
        <WebAccessGate
          enabled
          mode={webAccessMode}
          online={online}
          busy={webCloudBusy}
          feedback={webAccessFeedback}
          initialEmail={locorisCloudConnection?.userEmail ?? ""}
          entitlement={webCloudOverview?.entitlement ?? null}
          accountPortalUrl={buildLocorisCloudAccountUrl(
            resolveLocorisCloudServerUrl(settings, locorisCloudConnection),
            webAccessMode === "unavailable" ? "billing" : undefined
          )}
          onAuthenticate={handleWebCloudAuthenticate}
          onRetry={() => {
            setWebCloudAuthState("checking");
            setWebCloudRetryTick((current) => current + 1);
          }}
          onOpenCloud={openAccountCloudSettings}
          onExportVault={() => void handleExportCurrentVaultForWeb()}
        />
      </div>
    );
  }

  if (vaultBooting || !settings) {
    return (
      <div className="boot-screen">
        <div className="boot-card">
          <span className="panel-kicker">{t("app.name")}</span>
          <strong>{t("app.booting")}</strong>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={null}>
      <div
        className="locoris-adaptive-shell"
        data-runtime-kind={adaptiveLayout.runtimeKind}
        data-layout-device={adaptiveLayout.device}
        data-layout-orientation={adaptiveLayout.orientation}
        data-pointer-mode={adaptiveLayout.pointer}
        data-mobile-shell={adaptiveLayout.isMobileShell ? "true" : "false"}
      >
        <OrbitalMapView
        adaptiveLayout={adaptiveLayout}
        orbitalAnimationMode={orbitalAnimationMode}
        orbitalTemporalSignalsMode={orbitalTemporalSignalsMode}
        projectFocusRequest={orbitalProjectFocusRequest}
        onOrbitalAnimationModeChange={handleChangeOrbitalAnimationMode}
        projects={projects}
        folders={folders}
        notes={notes}
        tasks={tasks}
        tags={tags}
        assets={assets}
        assetCount={assets.length}
        language={currentAppLanguage}
        editorOpen={Boolean(orbitalEditorEntry)}
        editorTitle={
          orbitalEditorEntry
            ? getDisplayNoteTitle(orbitalEditorEntry, currentAppLanguage)
            : ""
        }
        editorMode={orbitalEditorEntry?.contentType ?? null}
        editorContentKey={orbitalEditorEntry?.id ?? null}
        editorAccentColor={orbitalEditorEntry?.color || DEFAULT_NOTE_COLOR}
        editorSlot={
          orbitalEditorEntry ? (
            orbitalEditorEntry.contentType === "canvas" ? (
              <CanvasPane
                key={`orbital-canvas-${orbitalEditorEntry.id}-${currentAppLanguage}`}
                note={orbitalEditorEntry}
                notes={notes}
                folders={folders}
                tags={tags}
                language={currentAppLanguage}
                saveState={saveState}
                immersive
                onTitleChange={(title) =>
                  void handleUpdateNoteMeta(orbitalEditorEntry.id, {
                    title
                  })
                }
                onFolderChange={(folderId) =>
                  void handleUpdateNoteMeta(orbitalEditorEntry.id, {
                    folderId
                  })
                }
                onNoteColorChange={(color) =>
                  void handleUpdateNoteMeta(orbitalEditorEntry.id, {
                    color
                  })
                }
                onTagIdsChange={(tagIds) =>
                  void handleSetTagIdsForNote(orbitalEditorEntry.id, tagIds)
                }
                onCreateTag={handleCreateTag}
                onDelete={() => void handleDeleteNoteById(orbitalEditorEntry.id)}
                onRestore={() => void handleRestoreNoteById(orbitalEditorEntry.id)}
                onTogglePin={() =>
                  void handleUpdateNoteMeta(orbitalEditorEntry.id, {
                    pinned: !(orbitalEditorEntry.pinned || orbitalEditorEntry.favorite),
                    favorite: false
                  })
                }
                onContentChange={(content, files, fileNames, state) => {
                  void handleSaveCanvasContentForNote(
                    orbitalEditorEntry.id,
                    content,
                    files,
                    fileNames,
                    state
                  );
                }}
                onLoadFiles={() => loadCanvasFiles(orbitalEditorEntry.id)}
                onCreateCanvasFromAi={async (content, files, fileNames, title) => {
                  const canvas = await handleCreateCanvasAt(
                    orbitalEditorEntry.folderId,
                    orbitalEditorEntry.tagIds,
                    orbitalEditorEntry.projectId
                  );
                  const nextTitle = title?.trim().slice(0, 120);

                  if (nextTitle) {
                    await handleUpdateNoteMeta(canvas.id, {
                      title: nextTitle,
                      color: orbitalEditorEntry.color || canvas.color
                    });
                  }

                  await handleSaveCanvasContentForNote(canvas.id, content, files, fileNames, "saved");
	                  setOrbitalEditorNoteId(canvas.id);
	                }}
	                onCreateTaskFromContext={handleCreatePlannerTaskFromContext}
	                onClose={handleCloseOrbitalEditor}
	                libraryStorageScopeId={activeLocalVaultId}
	                privateVaultWarningContext={activePrivateVaultWarningContext}
	              />
            ) : (
              <EditorPane
                key={`orbital-note-${orbitalEditorEntry.id}-${currentAppLanguage}`}
                note={orbitalEditorEntry}
                assets={assets.filter((asset) => asset.noteId === orbitalEditorEntry.id)}
                folders={folders}
                tags={tags}
                language={currentAppLanguage}
                saveState={saveState}
                immersive
                onTitleChange={(title) =>
                  void handleUpdateNoteMeta(orbitalEditorEntry.id, {
                    title
                  })
                }
                onFolderChange={(folderId) =>
                  void handleUpdateNoteMeta(orbitalEditorEntry.id, {
                    folderId
                  })
                }
                onNoteColorChange={(color) =>
                  void handleUpdateNoteMeta(orbitalEditorEntry.id, {
                    color
                  })
                }
                onTagIdsChange={(tagIds) =>
                  void handleSetTagIdsForNote(orbitalEditorEntry.id, tagIds)
                }
                onCreateTag={handleCreateTag}
                onDelete={() => void handleDeleteNoteById(orbitalEditorEntry.id)}
                onRestore={() => void handleRestoreNoteById(orbitalEditorEntry.id)}
                onTogglePin={() =>
                  void handleUpdateNoteMeta(orbitalEditorEntry.id, {
                    pinned: !(orbitalEditorEntry.pinned || orbitalEditorEntry.favorite),
                    favorite: false
                  })
                }
                onContentChange={(content, state) =>
                  void handleContentChangeForNote(orbitalEditorEntry.id, content, state)
                }
                onUploadFile={(file) => handleStoreAsset(orbitalEditorEntry.id, file)}
	                onResolveFileUrl={resolveAssetUrl}
	                privateVaultWarningContext={activePrivateVaultWarningContext}
	                onCreateTaskFromContext={handleCreatePlannerTaskFromContext}
	                onClose={handleCloseOrbitalEditor}
	              />
            )
          ) : null
        }
        plannerSlot={
	          <Suspense
              fallback={<div className="orbital-planner-slot-loading" aria-busy="true" />}
            >
	            <PlannerSurface
              key={`planner-${activeLocalVaultId}-${currentAppLanguage}`}
	            tasks={tasks}
	            habits={habits}
	            habitLogs={habitLogs}
	            timeBlocks={timeBlocks}
	            projects={projects}
	            folders={folders}
	            notes={notes}
		            tags={tags}
		            language={currentAppLanguage}
		            adaptiveLayout={adaptiveLayout}
		            defaultSurface={settings.plannerDefaultSurface ?? "planner"}
		            defaultCalendarView={settings.plannerDefaultCalendarView ?? "week"}
            weekStartsOn={localeRuntime.weekStartsOn}
		            focusProjectId={plannerProjectFocusId}
		            navigationRequest={plannerNavigationRequest}
		            onCreateTask={handleCreatePlannerTask}
	            onUpdateTask={handleUpdatePlannerTask}
	            onToggleTaskDone={handleTogglePlannerTaskDone}
	            onDeleteTask={handleDeletePlannerTask}
            onCreateHabit={handleCreatePlannerHabit}
            onUpdateHabit={handleUpdatePlannerHabit}
            onDeleteHabit={handleDeletePlannerHabit}
            onToggleHabitLog={handleTogglePlannerHabitLog}
            onCreateTimeBlock={handleCreatePlannerTimeBlock}
            onUpdateTimeBlock={handleUpdatePlannerTimeBlock}
            onDeleteTimeBlock={handleDeletePlannerTimeBlock}
            onCreateTag={handleCreateTag}
            onClearProjectFocus={() => setPlannerProjectFocusId(null)}
            onOpenNote={(noteId) => void handleOpenOrbitalNote(noteId)}
		              onOpenProjectMap={handleOpenProjectOnMap}
	            />
	          </Suspense>
	        }
        trashModalSlot={
          <TrashPanel
            notes={trashedNotes}
            folderPathMap={folderPathMap}
            language={currentAppLanguage}
            labels={{
              title: t("filters.viewTrash"),
              deletedAt: t("orbit.deletedAt"),
              folder: t("note.folder"),
              restore: t("note.restore"),
              deletePermanently: t("note.deletePermanently"),
              clearTrash: t("orbit.clearTrashAction"),
              emptyTitle: t("orbit.trashEmptyTitle"),
              emptyDescription: t("orbit.trashEmptyDescription"),
              allNotes: t("filters.allNotes"),
              noteType: t("orbit.note"),
              canvasType: t("orbit.canvas")
            }}
            onRestore={(noteId) => void handleRestoreNoteById(noteId)}
            onDelete={(noteId) => void handleDeleteNoteById(noteId)}
            onClear={() => void handleClearTrash()}
          />
        }
        settingsModalSlot={
          <SettingsPanel
            settings={settings}
            localePreferences={localePreferences}
            localeRuntime={localeRuntime}
            accentThemeId={accentThemeId}
            orbitalAnimationMode={orbitalAnimationMode}
            orbitalTemporalSignalsMode={orbitalTemporalSignalsMode}
            online={online}
            localVaults={localVaults}
            activeLocalVaultId={activeLocalVaultId}
            selectedLocalVaultId={selectedSyncVaultId}
            syncConnections={syncConnections}
            syncBindings={syncBindings}
            vaultEncryptionById={vaultEncryptionById}
            syncFeedback={syncFeedback}
            plannerDataCounts={{
              tasks: tasks.length,
              habits: habits.length,
              habitLogs: habitLogs.length,
              goals: goals.length,
              timeBlocks: timeBlocks.length
            }}
            onAccentThemeChange={handleChangeAccentTheme}
            onOrbitalAnimationModeChange={handleChangeOrbitalAnimationMode}
            onOrbitalTemporalSignalsModeChange={handleChangeOrbitalTemporalSignalsMode}
            onPlannerSettingsChange={(patch) => void handleChangePlannerSettings(patch)}
            onClearPlannerData={handleClearPlannerData}
            onLocalePreferencesChange={updateLocalePreferences}
            onSelectLocalVault={(localVaultId) => setSelectedSyncVaultId(localVaultId)}
            onActivateLocalVault={(localVaultId) => activateLocalVault(localVaultId)}
            onCreateLocalVault={(input) => handleCreateLocalVault(input)}
            onRenameLocalVault={(localVaultId, name) =>
              handleRenameLocalVault(localVaultId, name)
            }
            onDeleteLocalVault={(localVaultId, options) =>
              handleDeleteLocalVault(localVaultId, options)
            }
            onCreateConnection={handleCreateSyncConnection}
            onDeleteConnection={(connectionId, options) =>
              handleDeleteSyncConnection(connectionId, options)
            }
            onRevokeGoogleDriveConnection={(connectionId) =>
              void handleRevokeGoogleDriveConnection(connectionId)
            }
            onUpdateConnection={handleUpdateSyncConnection}
            onRefreshHostedConnectionCredentials={handleRefreshHostedConnectionCredentials}
            onRefreshGoogleDriveConnectionCredentials={handleRefreshGoogleDriveConnectionCredentials}
            onRestoreHostedVaultBindings={restoreHostedVaultBindingsSingleFlight}
            onBindVault={(input) => handleBindVaultToConnection(input)}
            onImportRemoteVault={(input) => handleImportRemoteVault(input)}
            onDeleteRemoteVault={(input) => handleDeleteRemoteVault(input)}
            onRenameRemoteVault={(input) => handleRenameRemoteVault(input)}
            onClearBinding={(localVaultId) => void handleClearVaultBinding(localVaultId)}
            onRunVaultSync={(localVaultId, connectionOverride) =>
              handleRunVaultSync(localVaultId, connectionOverride)
            }
            onEnableVaultEncryption={(input) => void handleEnableVaultEncryption(input)}
            onUnlockVaultEncryption={(input) => void handleUnlockVaultEncryption(input)}
            onChangeVaultEncryptionPassphrase={(input) =>
              void handleChangeVaultEncryptionPassphrase(input)
            }
            onDisableVaultEncryption={(input) => void handleDisableVaultEncryption(input)}
            onLockVaultEncryption={(localVaultId) => void handleLockVaultEncryption(localVaultId)}
            onClose={() => undefined}
          />
        }
        settingsOpenRequest={settingsOpenRequest}
        onSettingsOpenRequestHandled={handleSettingsOpenRequestHandled}
        onOpenWebAccess={openAccountCloudSettings}
        onExportWebVault={() => void handleExportCurrentVaultForWeb()}
        showClose={false}
        onClose={() => undefined}
        onCloseEditor={handleCloseOrbitalEditor}
        syncStatusChip={activeVaultSyncChip}
        syncTransportChip={activeSyncTransportChip}
        webAccessStatus={webAccessStatus}
        updateChip={
          appUpdateChip
            ? {
                text:
                  appUpdateChip.kind === "issue"
                    ? t("settings.desktopUpdateIssueChip")
                    : t("settings.desktopUpdateChip", {
                        version: appUpdateChip.version ?? "—"
                      }),
                title:
                  appUpdateChip.kind === "issue"
                    ? t("settings.desktopUpdateIssueChipTitle", {
                        version: appUpdateChip.version ?? "—"
                      })
                    : t("settings.desktopUpdateChipTitle", {
                        version: appUpdateChip.version ?? "—"
                      })
              }
            : null
        }
        activeLocalVaultId={activeLocalVaultId}
        localVaultOptions={localVaultSwitcherItems}
        onSelectLocalVault={(localVaultId) => activateLocalVault(localVaultId)}
        onCreateLocalVault={(input) =>
          handleCreateLocalVault({
            ...input,
            activate: true
          })
        }
        onRenameLocalVault={(localVaultId, name) =>
          handleRenameLocalVault(localVaultId, name)
        }
        onCreateProject={handleCreateProjectNode}
        onRenameProject={handleRenameProject}
        onUpdateProjectPosition={(projectId, x, y) =>
          void handleUpdateProjectPosition(projectId, x, y)
        }
        onUpdateProjectSortOrder={(projectId, sortOrder) =>
          void handleUpdateProjectSortOrder(projectId, sortOrder)
        }
        onUpdateProjectColor={(projectId, color) =>
          void handleUpdateProjectColor(projectId, color)
        }
        onDeleteProject={handleDeleteProject}
        onUpdateFolderColor={(folderId, color) => void handleUpdateFolderColor(folderId, color)}
        onRenameFolder={(folderId, name) => void handleRenameFolder(folderId, name)}
        onDeleteFolder={handleDeleteFolder}
        onMoveFolder={handleMoveFolder}
        onMoveNote={handleMoveNote}
        onDuplicateFolder={handleDuplicateFolder}
        onDuplicateNote={handleDuplicateNote}
        onRenameNote={(noteId, name) =>
          void handleUpdateNoteMeta(noteId, {
            title: name
          })
        }
        onUpdateNoteColor={(noteId, color) =>
          void handleUpdateNoteMeta(noteId, {
            color
          })
        }
        onSetNotePinned={(noteId, pinned) =>
          void handleUpdateNoteMeta(noteId, {
            pinned,
            favorite: false
          })
        }
        onDeleteNote={handleDeleteNoteById}
        onCreateFolder={handleCreateFolderNode}
        onCreateNote={async (folderId, projectId) => {
          const note = await handleCreateNoteAt(folderId, [], projectId);
          setOrbitalEditorNoteId(note.id);
          return note;
        }}
        onCreateCanvas={async (folderId, projectId) => {
          const canvas = await handleCreateCanvasAt(folderId, [], projectId);
          setOrbitalEditorNoteId(canvas.id);
          return canvas;
        }}
	        onOpenNote={(noteId) => void handleOpenOrbitalNote(noteId)}
	        onOpenProjectPlan={handleOpenProjectPlan}
	        onOpenPlannerView={handleOpenPlannerView}
	        onToggleNoteChecklistItem={handleToggleChecklistItemForNote}
        onResolveFileUrl={resolveAssetUrl}
        labels={{
          title: t("orbit.title"),
          subtitle: t("orbit.subtitle"),
          close: t("orbit.close"),
          mapMode: t("orbit.mapMode"),
          plannerMode: t("orbit.plannerMode"),
          pause: t("orbit.pause"),
          resume: t("orbit.resume"),
          zoomIn: t("orbit.zoomIn"),
          zoomOut: t("orbit.zoomOut"),
          resetView: t("orbit.resetView"),
          centerSelection: t("orbit.centerSelection"),
          focusMode: t("orbit.focusMode"),
          showAll: t("orbit.showAll"),
          autoFocus: t("orbit.autoFocus"),
          visibleBodies: t("orbit.visibleBodies"),
          hiddenBodies: t("orbit.hiddenBodies"),
          focusedSystem: t("orbit.focusedSystem"),
          openNote: t("orbit.openNote"),
          openCanvas: t("orbit.openCanvas"),
          enterFullscreen: t("canvas.enterFullscreen"),
          exitFullscreen: t("canvas.exitFullscreen"),
          closeEditor: t("orbit.closeEditor"),
          addRootFolder: t("orbit.addRootFolder"),
          addChildFolder: t("orbit.addChildFolder"),
	          addNote: t("orbit.addNote"),
	          addCanvas: t("orbit.addCanvas"),
	          openProjectPlan: t("orbit.openProjectPlan"),
	          create: t("orbit.create"),
          cancel: t("orbit.cancel"),
          folderNamePlaceholder: t("orbit.folderNamePlaceholder"),
          addProject: t("orbit.addProject"),
          previousProject: t("orbit.previousProject"),
          nextProject: t("orbit.nextProject"),
          project: t("orbit.project"),
          system: t("orbit.system"),
          projectsStat: t("orbit.projectsStat"),
          core: t("orbit.core"),
          folder: t("orbit.folder"),
          note: t("orbit.note"),
          canvas: t("orbit.canvas"),
          uncategorized: t("orbit.uncategorized"),
          rootFolders: t("orbit.rootFolders"),
          directNotes: t("orbit.directNotes"),
          subfolders: t("orbit.subfolders"),
          descendants: t("orbit.descendants"),
          updated: t("orbit.updated"),
          empty: t("orbit.empty"),
          emptyCanvas: t("orbit.emptyCanvas"),
          canvasPreviewHint: t("orbit.canvasPreviewHint"),
          hints: t("orbit.hints"),
          settings: t("orbit.settings"),
          trash: t("orbit.trash"),
          closeModal: t("orbit.closeModal"),
          overview: t("orbit.overview"),
          vaultOverview: t("orbit.vaultOverview"),
          activeSystem: t("orbit.activeSystem"),
          vaultProfile: t("orbit.vaultProfile"),
          vaultSync: t("orbit.vaultSync"),
          vaultActivity: t("orbit.vaultActivity"),
          vaultStructure: t("orbit.vaultStructure"),
          overviewSections: t("orbit.overviewSections"),
          lastUpdated: t("orbit.lastUpdated"),
          trashStat: t("orbit.trashStat"),
          vaultRegular: t("orbit.vaultRegular"),
          vaultPrivate: t("orbit.vaultPrivate"),
          searchPlaceholder: t("orbit.searchPlaceholder"),
          clearFilters: t("orbit.clearFilters"),
          back: t("orbit.back"),
          documentsMenu: t("orbit.documentsMenu"),
          notesMenu: t("orbit.notesMenu"),
          foldersMenu: t("orbit.foldersMenu"),
          hierarchyScopeVault: t("orbit.hierarchyScopeVault"),
          hierarchyScopeProject: t("orbit.hierarchyScopeProject"),
          expandHierarchy: t("orbit.expandHierarchy"),
          collapseHierarchy: t("orbit.collapseHierarchy"),
          tagsMenu: t("orbit.tagsMenu"),
          filesMenu: t("orbit.filesMenu"),
          pinnedMenu: t("orbit.pinnedMenu"),
          colorsMenu: t("orbit.colorsMenu"),
          maxDepthReached: t("orbit.maxDepthReached"),
          projectColor: t("orbit.projectColor"),
          folderColor: t("folders.color"),
          noteColor: t("note.color"),
          chooseColor: t("orbit.chooseColor"),
          customColor: t("orbit.customColor"),
          copyAction: t("orbit.copyAction"),
          pasteAction: t("orbit.pasteAction"),
          duplicateAction: t("orbit.duplicateAction"),
          goToLocationAction: t("orbit.goToLocationAction"),
          selectedCount: t("orbit.selectedCount"),
          clipboardEmpty: t("orbit.clipboardEmpty"),
          moveBlockedDepth: t("orbit.moveBlockedDepth"),
          moveBlockedInvalid: t("orbit.moveBlockedInvalid"),
          moveBlockedMissingTarget: t("orbit.moveBlockedMissingTarget"),
          deleteSelection: t("orbit.deleteSelection"),
          deleteSystem: t("project.delete"),
          deleteFolder: t("folders.delete"),
          moveToTrash: t("note.moveToTrash"),
          notesStat: t("stats.notes"),
          elementsStat: t("stats.elements"),
          foldersStat: t("stats.folders"),
          tagsStat: t("stats.tags"),
          assetsStat: t("stats.assets"),
          pinnedStat: t("stats.pinned"),
          colorsStat: t("orbit.colorsMenu"),
          localVault: t("sync.localVault"),
          renameAction: t("orbit.renameAction"),
          totalBodies: t("orbit.totalBodies")
        }}
        />
        <ConfirmDialog
          open={Boolean(confirmDialog)}
          kicker={t("dialog.kicker")}
          title={confirmDialog?.title ?? ""}
          message={confirmDialog?.message ?? ""}
          confirmLabel={confirmDialog?.confirmLabel ?? ""}
          cancelLabel={confirmDialog?.cancelLabel ?? ""}
          details={confirmDialog?.details}
          onConfirm={() => closeConfirmDialog(true)}
          onCancel={() => closeConfirmDialog(false)}
        />
      </div>
    </Suspense>
  );
}
