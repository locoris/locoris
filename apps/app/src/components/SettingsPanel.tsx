import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import {
  APP_ACCENT_THEMES,
  getAppAccentTheme,
  resolveAppAccentThemeId,
  type AppAccentThemeId
} from "../lib/accentThemes";
import type {
  OrbitalAnimationMode,
  OrbitalTemporalSignalsMode
} from "../lib/interfacePreferences";
import { readGeminiApiKey } from "../lib/aiIntegration";
import type { LocalVaultKind, LocalVaultProfile } from "../lib/localVaults";
import {
  checkForAppUpdate,
  initializeAppUpdateState,
  installAvailableAppUpdate,
  openAppUpdateReleasePage,
  readAppUpdateSnapshot,
  resolveAppUpdatePermissionIssue,
  retryFailedAppUpdateInstall,
  subscribeAppUpdateState,
  supportsAppUpdates
} from "../lib/appUpdates";
import type {
  AppLanguage,
  AppSettings,
  PlannerCalendarDefaultView,
  PlannerDefaultSurface,
  PlannerWeekStartsOn,
  RemoteVaultImportResult,
  SyncConnection,
  SyncVaultBinding,
  VaultEncryptionSummary
} from "../types";
import BackupSettingsPanel from "./BackupSettingsPanel";
import SyncSettingsPanel from "./SyncSettingsPanel";
import AccountCloudPanel from "./accountCloud/AccountCloudPanel";
import AiIntegrationSettings from "./settings/AiIntegrationSettings";
import "./SettingsPanel.css";

type SyncFeedbackState = {
  tone: "success" | "error";
  text: string;
} | null;

type PlannerDataCounts = {
  tasks: number;
  habits: number;
  habitLogs: number;
  goals: number;
  timeBlocks: number;
};

interface SettingsPanelProps {
  settings: AppSettings;
  accentThemeId: AppAccentThemeId;
  orbitalAnimationMode: OrbitalAnimationMode;
  orbitalTemporalSignalsMode: OrbitalTemporalSignalsMode;
  online: boolean;
  localVaults: LocalVaultProfile[];
  activeLocalVaultId: string;
  selectedLocalVaultId: string;
  syncConnections: SyncConnection[];
  syncBindings: SyncVaultBinding[];
  vaultEncryptionById: Record<string, VaultEncryptionSummary>;
  syncFeedback?: SyncFeedbackState;
  plannerDataCounts?: PlannerDataCounts;
  onAccentThemeChange: (themeId: AppAccentThemeId) => void;
  onOrbitalAnimationModeChange: (mode: OrbitalAnimationMode) => void;
  onOrbitalTemporalSignalsModeChange: (mode: OrbitalTemporalSignalsMode) => void;
  onPlannerSettingsChange: (
    patch: Partial<
      Pick<
        AppSettings,
        "plannerDefaultSurface" | "plannerWeekStartsOn" | "plannerDefaultCalendarView"
      >
    >
  ) => void | Promise<void>;
  onClearPlannerData?: () => boolean | Promise<boolean>;
  onLanguageChange: (language: AppLanguage) => void;
  onSelectLocalVault: (localVaultId: string) => void;
  onCreateLocalVault: (input: {
    name: string;
    vaultKind: LocalVaultKind;
    passphrase?: string;
  }) => string | Promise<string>;
  onRenameLocalVault: (localVaultId: string, name: string) => void;
  onDeleteLocalVault: (
    localVaultId: string,
    options?: {
      skipConfirmation?: boolean;
    }
  ) => void | Promise<void>;
  onCreateConnection: (input: {
    provider: "selfHosted" | "hosted" | "googleDrive";
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
  }) => SyncConnection | void | Promise<SyncConnection | void>;
  onDeleteConnection: (connectionId: string) => void | Promise<void>;
  onUpdateConnection: (
    connectionId: string,
    patch: Partial<Omit<SyncConnection, "id" | "provider" | "createdAt">> & {
      refreshToken?: string | null;
    }
  ) => void | Promise<void>;
  onRefreshHostedConnectionCredentials: (connection: SyncConnection) => void | Promise<void>;
  onBindVault: (input: {
    localVaultId: string;
    connectionId: string;
    remoteVaultId: string;
    remoteVaultName?: string;
    syncToken: string;
  }) => void | Promise<void>;
  onImportRemoteVault: (input: {
    connectionId: string;
    remoteVaultId: string;
    remoteVaultName: string;
    remoteVaultKind?: LocalVaultKind;
    openAfterImport?: boolean;
  }) => Promise<RemoteVaultImportResult>;
  onDeleteRemoteVault: (input: {
    connectionId: string;
    remoteVaultId: string;
  }) => Promise<void>;
  onClearBinding: (localVaultId: string) => void | Promise<void>;
  onRunVaultSync: (localVaultId: string) => void | Promise<void>;
  onEnableVaultEncryption: (input: {
    localVaultId: string;
    passphrase: string;
  }) => void | Promise<void>;
  onUnlockVaultEncryption: (input: {
    localVaultId: string;
    passphrase: string;
  }) => void | Promise<void>;
  onChangeVaultEncryptionPassphrase: (input: {
    localVaultId: string;
    currentPassphrase?: string;
    nextPassphrase: string;
  }) => void | Promise<void>;
  onDisableVaultEncryption: (input: {
    localVaultId: string;
    currentPassphrase?: string;
  }) => void | Promise<void>;
  onLockVaultEncryption: (localVaultId: string) => void | Promise<void>;
  onClose: () => void;
}

function LanguageGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M3.2 4.5h6.2M6.3 4.5c0 5-1.9 8.4-3.6 10.6M6.3 4.5c1.2 2.4 2.8 4.8 4.9 6.8M11.8 6.8h5M14.3 6.8v8.4M11.6 12.4h5.4" />
    </svg>
  );
}

function AccountCloudGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M5.6 14.5h8.9a3 3 0 0 0 .3-5.9 4.9 4.9 0 0 0-9.5-1.5 3.8 3.8 0 0 0 .3 7.4Z" />
      <path d="M8.1 10.9h4.2M10.2 8.8V13" className="settings-row-icon-accent" />
    </svg>
  );
}

function SyncGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M4.2 6.2h4.7" />
      <path d="m7.1 3.6 2.6 2.6-2.6 2.6" className="settings-row-icon-accent" />
      <path d="M15.8 13.8h-4.7" />
      <path d="m12.9 11.2-2.6 2.6 2.6 2.6" className="settings-row-icon-accent" />
      <path d="M6.4 13.8a4.2 4.2 0 0 0 3.6 2" />
      <path d="M13.6 6.2A4.2 4.2 0 0 0 10 4.3" />
    </svg>
  );
}

function AccentGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M10 3.2a6.8 6.8 0 0 0 0 13.6h1.2a1.5 1.5 0 0 0 1.1-2.5 1.4 1.4 0 0 1 1-2.4h.8A2.9 2.9 0 0 0 17 9a5.8 5.8 0 0 0-1.8-4.1A7.1 7.1 0 0 0 10 3.2Z" />
      <circle cx="7" cy="8" r=".7" className="settings-row-icon-accent" />
      <circle cx="10" cy="6.8" r=".7" className="settings-row-icon-core" />
      <circle cx="12.9" cy="8.2" r=".7" className="settings-row-icon-accent" />
    </svg>
  );
}

function PlannerGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M5.3 4.2h9.4a1.7 1.7 0 0 1 1.7 1.7v8.8a1.7 1.7 0 0 1-1.7 1.7H5.3a1.7 1.7 0 0 1-1.7-1.7V5.9a1.7 1.7 0 0 1 1.7-1.7Z" />
      <path d="M3.7 7.4h12.6" className="settings-row-icon-accent" />
      <path d="M7 3.2v2.1M13 3.2v2.1" className="settings-row-icon-accent" />
      <path d="m7.1 12.3 1.6 1.6 4-4.2" className="settings-row-icon-accent" />
    </svg>
  );
}

function AiGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M10 3.2 11.7 7.7 16.2 9.4 11.7 11.1 10 15.6 8.3 11.1 3.8 9.4 8.3 7.7 10 3.2Z" />
      <path d="M15.2 3.7 15.9 5.4 17.6 6.1 15.9 6.8 15.2 8.5 14.5 6.8 12.8 6.1 14.5 5.4 15.2 3.7Z" className="settings-row-icon-accent" />
    </svg>
  );
}

function BackupGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M5.2 6.9a4.8 4.8 0 0 1 8.9 2.2h.4a2.7 2.7 0 0 1 0 5.4H5.3a3.1 3.1 0 0 1-.1-6.2" />
      <path d="M10 8.1v5.2" className="settings-row-icon-accent" />
      <path d="m7.8 11.1 2.2 2.2 2.2-2.2" className="settings-row-icon-accent" />
    </svg>
  );
}

function BackGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M12.6 4.8 7.4 10l5.2 5.2" className="settings-row-icon-accent" />
    </svg>
  );
}

function CloseGlyph() {
  return <span aria-hidden="true">×</span>;
}

function ChevronGlyph({ expanded = false }: { expanded?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        d={expanded ? "M5.5 7.4 10 11.9l4.5-4.5" : "M7.4 5.5 11.9 10l-4.5 4.5"}
        className="settings-row-icon-accent"
      />
    </svg>
  );
}

type SettingsView = "root" | "accountCloud" | "sync" | "interface" | "planner" | "ai" | "backup";

const LANGUAGE_OPTIONS: Array<{
  value: AppLanguage;
  code: string;
  labelKey: "settings.languageEnglish" | "settings.languageRussian";
  nativeLabel: string;
}> = [
  {
    value: "en",
    code: "EN",
    labelKey: "settings.languageEnglish",
    nativeLabel: "English"
  },
  {
    value: "ru",
    code: "RU",
    labelKey: "settings.languageRussian",
    nativeLabel: "Русский"
  }
];

const PLANNER_DEFAULT_SURFACE_OPTIONS: Array<{
  value: PlannerDefaultSurface;
  titleKey: "settings.plannerOpenPlannerTitle" | "settings.plannerOpenCalendarTitle";
  chipKey: "settings.plannerOpenPlannerChip" | "settings.plannerOpenCalendarChip";
  descriptionKey: "settings.plannerOpenPlannerDescription" | "settings.plannerOpenCalendarDescription";
}> = [
  {
    value: "planner",
    titleKey: "settings.plannerOpenPlannerTitle",
    chipKey: "settings.plannerOpenPlannerChip",
    descriptionKey: "settings.plannerOpenPlannerDescription"
  },
  {
    value: "calendar",
    titleKey: "settings.plannerOpenCalendarTitle",
    chipKey: "settings.plannerOpenCalendarChip",
    descriptionKey: "settings.plannerOpenCalendarDescription"
  }
];

const PLANNER_WEEK_START_OPTIONS: Array<{
  value: PlannerWeekStartsOn;
  titleKey: "settings.plannerWeekMondayTitle" | "settings.plannerWeekSundayTitle";
  chipKey: "settings.plannerWeekMondayChip" | "settings.plannerWeekSundayChip";
  descriptionKey: "settings.plannerWeekMondayDescription" | "settings.plannerWeekSundayDescription";
}> = [
  {
    value: "monday",
    titleKey: "settings.plannerWeekMondayTitle",
    chipKey: "settings.plannerWeekMondayChip",
    descriptionKey: "settings.plannerWeekMondayDescription"
  },
  {
    value: "sunday",
    titleKey: "settings.plannerWeekSundayTitle",
    chipKey: "settings.plannerWeekSundayChip",
    descriptionKey: "settings.plannerWeekSundayDescription"
  }
];

const PLANNER_CALENDAR_VIEW_OPTIONS: Array<{
  value: PlannerCalendarDefaultView;
  titleKey:
    | "settings.plannerCalendarViewDayTitle"
    | "settings.plannerCalendarViewWeekTitle"
    | "settings.plannerCalendarViewMonthTitle";
  chipKey:
    | "settings.plannerCalendarViewDayChip"
    | "settings.plannerCalendarViewWeekChip"
    | "settings.plannerCalendarViewMonthChip";
  descriptionKey:
    | "settings.plannerCalendarViewDayDescription"
    | "settings.plannerCalendarViewWeekDescription"
    | "settings.plannerCalendarViewMonthDescription";
}> = [
  {
    value: "day",
    titleKey: "settings.plannerCalendarViewDayTitle",
    chipKey: "settings.plannerCalendarViewDayChip",
    descriptionKey: "settings.plannerCalendarViewDayDescription"
  },
  {
    value: "week",
    titleKey: "settings.plannerCalendarViewWeekTitle",
    chipKey: "settings.plannerCalendarViewWeekChip",
    descriptionKey: "settings.plannerCalendarViewWeekDescription"
  },
  {
    value: "month",
    titleKey: "settings.plannerCalendarViewMonthTitle",
    chipKey: "settings.plannerCalendarViewMonthChip",
    descriptionKey: "settings.plannerCalendarViewMonthDescription"
  }
];

function UpdateGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M10 3.2v7" />
      <path d="m6.7 7.3 3.3 3.3 3.3-3.3" className="settings-row-icon-accent" />
      <path d="M4.1 13.9h11.8" />
      <path d="M5.4 16.3h9.2" />
    </svg>
  );
}

export default function SettingsPanel({
  settings,
  accentThemeId,
  orbitalAnimationMode,
  orbitalTemporalSignalsMode,
  online,
  localVaults,
  activeLocalVaultId,
  selectedLocalVaultId,
  syncConnections,
  syncBindings,
  vaultEncryptionById,
  syncFeedback = null,
  plannerDataCounts = {
    tasks: 0,
    habits: 0,
    habitLogs: 0,
    goals: 0,
    timeBlocks: 0
  },
  onAccentThemeChange,
  onOrbitalAnimationModeChange,
  onOrbitalTemporalSignalsModeChange,
  onPlannerSettingsChange,
  onClearPlannerData,
  onLanguageChange,
  onSelectLocalVault,
  onCreateLocalVault,
  onRenameLocalVault,
  onDeleteLocalVault,
  onCreateConnection,
  onDeleteConnection,
  onUpdateConnection,
  onRefreshHostedConnectionCredentials,
  onBindVault,
  onImportRemoteVault,
  onDeleteRemoteVault,
  onClearBinding,
  onRunVaultSync,
  onEnableVaultEncryption,
  onUnlockVaultEncryption,
  onChangeVaultEncryptionPassphrase,
  onDisableVaultEncryption,
  onLockVaultEncryption,
  onClose
}: SettingsPanelProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<SettingsView>("root");
  const [appUpdateState, setAppUpdateState] = useState(() => readAppUpdateSnapshot());
  const [aiConnected, setAiConnected] = useState(false);
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);
  const [plannerClearBusy, setPlannerClearBusy] = useState(false);
  const [plannerClearFeedback, setPlannerClearFeedback] = useState<SyncFeedbackState>(null);
  const languagePickerRef = useRef<HTMLDivElement | null>(null);
  const appUpdatesEnabled = supportsAppUpdates();

  useEffect(() => {
    if (!languagePickerOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!languagePickerRef.current?.contains(event.target as Node)) {
        setLanguagePickerOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLanguagePickerOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [languagePickerOpen]);

  useEffect(() => {
    if (!appUpdatesEnabled) {
      return;
    }

    void initializeAppUpdateState();

    return subscribeAppUpdateState(setAppUpdateState);
  }, [appUpdatesEnabled]);

  useEffect(() => {
    if (!appUpdatesEnabled || appUpdateState.phase !== "idle") {
      return;
    }

    void handleCheckAppUpdates();
  }, [appUpdatesEnabled, appUpdateState.phase]);

  useEffect(() => {
    let cancelled = false;

    void readGeminiApiKey()
      .then((apiKey) => {
        if (!cancelled) {
          setAiConnected(apiKey.trim().length > 0);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAiConnected(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleCheckAppUpdates = async () => {
    await checkForAppUpdate();
  };

  const handleInstallAppUpdate = async () => {
    await installAvailableAppUpdate();
  };

  const handleRetryAppUpdate = async () => {
    await retryFailedAppUpdateInstall();
  };

  const handleOpenAppReleasePage = async () => {
    await openAppUpdateReleasePage(
      appUpdateState.availableVersion ?? appUpdateState.lastAttemptedVersion
    );
  };

  const handleResolveAppUpdatePermissionIssue = async () => {
    await resolveAppUpdatePermissionIssue();
  };

  const handleClearPlannerDataClick = async () => {
    if (!onClearPlannerData || plannerClearBusy || plannerDataTotal === 0) {
      return;
    }

    setPlannerClearBusy(true);
    setPlannerClearFeedback(null);

    try {
      const cleared = await onClearPlannerData();

      if (cleared) {
        setPlannerClearFeedback({
          tone: "success",
          text: t("settings.plannerClearDataSuccess")
        });
      }
    } catch {
      setPlannerClearFeedback({
        tone: "error",
        text: t("settings.plannerClearDataError")
      });
    } finally {
      setPlannerClearBusy(false);
    }
  };

  const appUpdateCurrentVersion = appUpdateState.currentVersion;
  const appUpdatePublishedLabel = appUpdateState.releaseDate
    ? new Intl.DateTimeFormat(settings.language === "ru" ? "ru-RU" : "en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(appUpdateState.releaseDate))
    : null;

  const appUpdateIssueText =
    appUpdateState.issueCode === "unsupported"
      ? appUpdateState.kind === "android"
        ? t("settings.androidUpdateReleaseOnly")
        : t("settings.desktopUpdateUnsupported")
      : appUpdateState.issueCode === "metadata-invalid"
      ? t("settings.desktopUpdateIssueMetadataInvalid")
      : appUpdateState.issueCode === "download-failed"
      ? t("settings.desktopUpdateIssueDownloadFailed")
      : appUpdateState.issueCode === "install-failed"
      ? t("settings.desktopUpdateIssueInstallFailed")
      : appUpdateState.issueCode === "install-not-applied"
      ? t("settings.desktopUpdateIssueInstallNotApplied", {
          version:
            appUpdateState.availableVersion ??
            appUpdateState.lastAttemptedVersion ??
            "—"
        })
      : appUpdateState.issueCode === "android-install-permission-required"
      ? t("settings.androidUpdatePermissionRequired")
      : appUpdateState.issueCode === "check-failed"
      ? t("settings.desktopUpdateIssueCheckFailed")
      : null;

  const appUpdateDescription =
    appUpdateState.phase === "checking"
      ? t("settings.desktopUpdateChecking")
      : appUpdateState.phase === "upToDate"
      ? t("settings.desktopUpdateUpToDate", {
          version: appUpdateCurrentVersion ?? "—"
        })
      : appUpdateState.phase === "available"
      ? t("settings.desktopUpdateAvailable", {
          version: appUpdateState.availableVersion ?? "—"
        })
      : appUpdateState.phase === "downloading"
      ? t("settings.desktopUpdateDownloading", {
          progress:
            appUpdateState.progress === null
              ? ""
              : ` ${appUpdateState.progress}%`
        })
      : appUpdateState.phase === "restarting"
      ? appUpdateState.kind === "android"
        ? t("settings.androidUpdateInstallerOpened")
        : t("settings.desktopUpdateRestarting")
      : appUpdateState.phase === "failed"
      ? appUpdateIssueText ?? t("settings.desktopUpdateError")
      : appUpdateCurrentVersion
      ? t("settings.desktopUpdateCurrent", {
          version: appUpdateCurrentVersion
        })
      : t("settings.desktopUpdateCurrentUnknown");

  const appUpdatePrimaryActionLabel =
    appUpdateState.phase === "checking"
      ? t("settings.desktopUpdateCheckingAction")
      : appUpdateState.phase === "available"
      ? t("settings.desktopUpdateInstall")
      : appUpdateState.phase === "downloading" ||
        appUpdateState.phase === "restarting"
      ? t("settings.desktopUpdateInstalling")
      : appUpdateState.phase === "failed" &&
        appUpdateState.issueCode === "android-install-permission-required"
      ? t("settings.androidUpdateAllowInstall")
      : appUpdateState.phase === "failed" && appUpdateState.canRetryInstall
      ? t("settings.desktopUpdateRetry")
      : t("settings.desktopUpdateCheck");

  const appUpdatePrimaryAction =
    appUpdateState.phase === "available"
      ? handleInstallAppUpdate
      : appUpdateState.phase === "failed" &&
        appUpdateState.issueCode === "android-install-permission-required"
      ? handleResolveAppUpdatePermissionIssue
      : appUpdateState.phase === "failed" && appUpdateState.canRetryInstall
      ? handleRetryAppUpdate
      : handleCheckAppUpdates;

  const appUpdatePrimaryActionDisabled =
    appUpdateState.phase === "checking" ||
    appUpdateState.phase === "downloading" ||
    appUpdateState.phase === "restarting";

  const shouldShowOpenReleaseAction =
    appUpdateState.canOpenReleasePage &&
    (appUpdateState.phase === "available" || appUpdateState.phase === "failed");
  const selectedLanguageOption =
    LANGUAGE_OPTIONS.find((option) => option.value === settings.language) ?? LANGUAGE_OPTIONS[0];
  const plannerDefaultSurface = settings.plannerDefaultSurface ?? "planner";
  const plannerWeekStartsOn = settings.plannerWeekStartsOn ?? "monday";
  const plannerDefaultCalendarView = settings.plannerDefaultCalendarView ?? "week";
  const plannerDefaultSurfaceOption =
    PLANNER_DEFAULT_SURFACE_OPTIONS.find((option) => option.value === plannerDefaultSurface) ??
    PLANNER_DEFAULT_SURFACE_OPTIONS[0];
  const plannerDefaultCalendarViewOption =
    PLANNER_CALENDAR_VIEW_OPTIONS.find((option) => option.value === plannerDefaultCalendarView) ??
    PLANNER_CALENDAR_VIEW_OPTIONS[1];
  const plannerDataTotal =
    plannerDataCounts.tasks +
    plannerDataCounts.habits +
    plannerDataCounts.habitLogs +
    plannerDataCounts.goals +
    plannerDataCounts.timeBlocks;
  const plannerDataStatItems = [
    { key: "tasks", label: t("settings.plannerClearDataTasks"), count: plannerDataCounts.tasks },
    { key: "habits", label: t("settings.plannerClearDataHabits"), count: plannerDataCounts.habits },
    { key: "habitLogs", label: t("settings.plannerClearDataHabitLogs"), count: plannerDataCounts.habitLogs },
    { key: "goals", label: t("settings.plannerClearDataGoals"), count: plannerDataCounts.goals },
    { key: "timeBlocks", label: t("settings.plannerClearDataTimeBlocks"), count: plannerDataCounts.timeBlocks }
  ];
  const currentAccentThemeId = resolveAppAccentThemeId(accentThemeId);
  const currentAccentTheme = getAppAccentTheme(currentAccentThemeId);
  const aiConnectionLabel = aiConnected
    ? t("settings.aiConnected")
    : t("settings.aiNotConnected");
  const locorisCloudConnections = syncConnections.filter(
    (connection) => connection.provider === "hosted" && connection.role === "locorisCloud"
  );
  const locorisCloudConnectionIds = new Set(locorisCloudConnections.map((connection) => connection.id));
  const locorisCloudBindingCount = syncBindings.filter((binding) =>
    locorisCloudConnectionIds.has(binding.connectionId)
  ).length;
  const externalSyncConnections = syncConnections.filter(
    (connection) => connection.role !== "locorisCloud"
  );
  const externalSyncConnectionIds = new Set(externalSyncConnections.map((connection) => connection.id));
  const externalSyncBindingCount = syncBindings.filter((binding) =>
    externalSyncConnectionIds.has(binding.connectionId)
  ).length;
  const accountCloudLabel =
    locorisCloudConnections.length > 0
      ? t("settings.accountCloudConnectedCount", { count: locorisCloudBindingCount })
      : t("settings.accountCloudSignedOut");

  const renderAccentThemeOptions = (panel = false) => (
    <div
      className={`settings-accent-grid ${panel ? "settings-accent-grid-panel" : ""}`}
      role="radiogroup"
      aria-label={t("settings.accentThemeAriaLabel")}
    >
      {APP_ACCENT_THEMES.map((theme) => {
        const active = currentAccentThemeId === theme.id;
        const previewByRole = Object.fromEntries(
          theme.preview.map((swatch) => [swatch.role, swatch.color])
        );
        const style = {
          "--accent-theme-one": previewByRole.primary,
          "--accent-theme-two": previewByRole.secondary,
          "--accent-theme-three": previewByRole.warm,
          "--theme-preview-background": previewByRole.background,
          "--theme-preview-surface": previewByRole.surface,
          "--theme-preview-emphasis": previewByRole.emphasis,
          "--theme-preview-primary": previewByRole.primary,
          "--theme-preview-secondary": previewByRole.secondary,
          "--theme-preview-warm": previewByRole.warm
        } as CSSProperties;

        return (
          <button
            key={theme.id}
            type="button"
            className={`settings-accent-option ${active ? "is-active" : ""}`}
            style={style}
            onClick={() => onAccentThemeChange(theme.id)}
            role="radio"
            aria-checked={active}
            title={t(theme.labelKey)}
          >
            <span className="settings-accent-swatches" aria-hidden="true">
              {theme.preview.map((swatch) => (
                <span
                  key={swatch.role}
                  className={`settings-accent-swatch is-${swatch.role}`}
                  style={{ "--theme-swatch-color": swatch.color } as CSSProperties}
                />
              ))}
            </span>
            <span>{t(theme.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );

  const renderOrbitalAnimationOptions = () => {
    const options: Array<{
      mode: OrbitalAnimationMode;
      title: string;
      chip: string;
      description: string;
    }> = [
      {
        mode: "full",
        title: t("settings.interfaceMotionFullTitle"),
        chip: t("settings.interfaceMotionFullChip"),
        description: t("settings.interfaceMotionFullDescription")
      },
      {
        mode: "reduced",
        title: t("settings.interfaceMotionReducedTitle"),
        chip: t("settings.interfaceMotionReducedChip"),
        description: t("settings.interfaceMotionReducedDescription")
      }
    ];

    return (
      <div className="settings-interface-motion-grid" role="radiogroup" aria-label={t("settings.interfaceMotionTitle")}>
        {options.map((option) => {
          const active = orbitalAnimationMode === option.mode;

          return (
            <button
              key={option.mode}
              type="button"
              className={`settings-interface-motion-option ${active ? "is-active" : ""}`}
              onClick={() => onOrbitalAnimationModeChange(option.mode)}
              role="radio"
              aria-checked={active}
            >
              <span className="settings-interface-motion-option-head">
                <strong>{option.title}</strong>
                <span>{option.chip}</span>
              </span>
              <p>{option.description}</p>
            </button>
          );
        })}
      </div>
    );
  };

  const renderOrbitalTemporalSignalOptions = () => {
    const options: Array<{
      mode: OrbitalTemporalSignalsMode;
      title: string;
      chip: string;
      description: string;
    }> = [
      {
        mode: "enabled",
        title: t("settings.interfaceTemporalEnabledTitle"),
        chip: t("settings.interfaceTemporalEnabledChip"),
        description: t("settings.interfaceTemporalEnabledDescription")
      },
      {
        mode: "disabled",
        title: t("settings.interfaceTemporalDisabledTitle"),
        chip: t("settings.interfaceTemporalDisabledChip"),
        description: t("settings.interfaceTemporalDisabledDescription")
      }
    ];

    return (
      <div className="settings-interface-motion-grid" role="radiogroup" aria-label={t("settings.interfaceTemporalTitle")}>
        {options.map((option) => {
          const active = orbitalTemporalSignalsMode === option.mode;

          return (
            <button
              key={option.mode}
              type="button"
              className={`settings-interface-motion-option ${active ? "is-active" : ""}`}
              onClick={() => onOrbitalTemporalSignalsModeChange(option.mode)}
              role="radio"
              aria-checked={active}
            >
              <span className="settings-interface-motion-option-head">
                <strong>{option.title}</strong>
                <span>{option.chip}</span>
              </span>
              <p>{option.description}</p>
            </button>
          );
        })}
      </div>
    );
  };

  const renderPlannerChoiceGroup = <T extends string>(
    label: string,
    ariaLabel: string,
    options: Array<{
      value: T;
      titleKey: string;
      chipKey: string;
      descriptionKey: string;
    }>,
    selectedValue: T,
    onSelect: (value: T) => void
  ) => (
    <section className="settings-planner-choice-group" aria-label={label}>
      <div className="settings-panel-block-head">
        <div>
          <p className="panel-kicker settings-panel-block-kicker">{label}</p>
        </div>
      </div>

      <div
        className={`settings-planner-choice-grid ${options.length === 2 ? "is-two" : "is-three"}`}
        role="radiogroup"
        aria-label={ariaLabel}
      >
        {options.map((option) => {
          const active = option.value === selectedValue;

          return (
            <button
              key={option.value}
              type="button"
              className={`settings-interface-motion-option settings-planner-choice ${active ? "is-active" : ""}`}
              onClick={() => onSelect(option.value)}
              role="radio"
              aria-checked={active}
            >
              <span className="settings-interface-motion-option-head">
                <strong>{t(option.titleKey)}</strong>
                <span>{t(option.chipKey)}</span>
              </span>
              <p>{t(option.descriptionKey)}</p>
            </button>
          );
        })}
      </div>
    </section>
  );

  const renderSettingsHeader = (
    title: string,
    caption: string,
    options: { back?: boolean } = {}
  ) => (
    <header className={`settings-panel-header ${options.back ? "has-back-action" : "is-root-action"}`}>
      {options.back ? (
        <button
          type="button"
          className="settings-panel-nav-button settings-panel-back-button"
          onClick={() => setView("root")}
          aria-label={t("settings.back")}
          title={t("settings.back")}
        >
          <span className="settings-row-action-icon" aria-hidden="true">
            <BackGlyph />
          </span>
        </button>
      ) : (
        <span className="settings-panel-header-pad" aria-hidden="true" />
      )}

      <div className="settings-panel-heading">
        <h2 className="panel-title settings-panel-title">{title}</h2>
        <p className="settings-panel-caption">{caption}</p>
      </div>

      <div className="settings-panel-header-actions">
        <button
          type="button"
          className="settings-panel-nav-button settings-panel-close-button"
          onClick={onClose}
          aria-label={t("orbit.closeModal")}
          title={t("orbit.closeModal")}
        >
          <span className="settings-panel-close-icon" aria-hidden="true">
            <CloseGlyph />
          </span>
        </button>
      </div>
    </header>
  );

  if (view === "accountCloud") {
    return (
      <AccountCloudPanel
        settings={settings}
        online={online}
        localVaults={localVaults}
        activeLocalVaultId={activeLocalVaultId}
        selectedLocalVaultId={selectedLocalVaultId}
        syncConnections={syncConnections}
        syncBindings={syncBindings}
        vaultEncryptionById={vaultEncryptionById}
        syncFeedback={syncFeedback}
        onBack={() => setView("root")}
        onClose={onClose}
        onSelectLocalVault={onSelectLocalVault}
        onCreateConnection={onCreateConnection}
        onDeleteConnection={onDeleteConnection}
        onUpdateConnection={onUpdateConnection}
        onRefreshHostedConnectionCredentials={onRefreshHostedConnectionCredentials}
        onBindVault={onBindVault}
        onImportRemoteVault={onImportRemoteVault}
        onClearBinding={onClearBinding}
        onRunVaultSync={onRunVaultSync}
      />
    );
  }

  if (view === "sync") {
    return (
      <SyncSettingsPanel
        settings={settings}
        online={online}
        localVaults={localVaults}
        activeLocalVaultId={activeLocalVaultId}
        selectedLocalVaultId={selectedLocalVaultId}
        syncConnections={syncConnections}
        syncBindings={syncBindings}
        vaultEncryptionById={vaultEncryptionById}
        syncFeedback={syncFeedback}
        onBack={() => setView("root")}
        onClose={onClose}
        onSelectLocalVault={onSelectLocalVault}
        onCreateLocalVault={onCreateLocalVault}
        onRenameLocalVault={onRenameLocalVault}
        onDeleteLocalVault={onDeleteLocalVault}
        onCreateConnection={onCreateConnection}
        onDeleteConnection={onDeleteConnection}
        onUpdateConnection={onUpdateConnection}
        onRefreshHostedConnectionCredentials={onRefreshHostedConnectionCredentials}
        onBindVault={onBindVault}
        onImportRemoteVault={onImportRemoteVault}
        onDeleteRemoteVault={onDeleteRemoteVault}
        onClearBinding={onClearBinding}
        onRunVaultSync={onRunVaultSync}
        onEnableVaultEncryption={onEnableVaultEncryption}
        onUnlockVaultEncryption={onUnlockVaultEncryption}
        onChangeVaultEncryptionPassphrase={onChangeVaultEncryptionPassphrase}
        onDisableVaultEncryption={onDisableVaultEncryption}
        onLockVaultEncryption={onLockVaultEncryption}
      />
    );
  }

  if (view === "planner") {
    return (
      <section className="settings-panel-shell is-planner-settings">
        {renderSettingsHeader(t("settings.plannerTitle"), t("settings.plannerPanelCaption"), {
          back: true
        })}

        <div className="settings-panel-grid settings-planner-panel-grid">
          <section className="settings-panel-block settings-panel-block-primary settings-planner-block">
            <div className="settings-planner-hero">
              <div className="settings-planner-orb" aria-hidden="true">
                <PlannerGlyph />
              </div>
              <div className="settings-planner-hero-copy">
                <p className="panel-kicker settings-panel-block-kicker">
                  {t("settings.plannerKicker")}
                </p>
                <h3>{t("settings.plannerHeroTitle")}</h3>
                <p>{t("settings.plannerHeroDescription")}</p>
              </div>
              <span className="settings-planner-status">
                {t(plannerDefaultSurfaceOption.chipKey)}
              </span>
            </div>

            {renderPlannerChoiceGroup(
              t("settings.plannerDefaultSurfaceLabel"),
              t("settings.plannerDefaultSurfaceLabel"),
              PLANNER_DEFAULT_SURFACE_OPTIONS,
              plannerDefaultSurface,
              (value) => void onPlannerSettingsChange({ plannerDefaultSurface: value })
            )}

            {renderPlannerChoiceGroup(
              t("settings.plannerWeekStartsOnLabel"),
              t("settings.plannerWeekStartsOnLabel"),
              PLANNER_WEEK_START_OPTIONS,
              plannerWeekStartsOn,
              (value) => void onPlannerSettingsChange({ plannerWeekStartsOn: value })
            )}

            {renderPlannerChoiceGroup(
              t("settings.plannerDefaultCalendarViewLabel"),
              t("settings.plannerDefaultCalendarViewLabel"),
              PLANNER_CALENDAR_VIEW_OPTIONS,
              plannerDefaultCalendarView,
              (value) => void onPlannerSettingsChange({ plannerDefaultCalendarView: value })
            )}
          </section>

          <section className="settings-panel-block settings-planner-danger-block">
            <div className="settings-planner-danger-head">
              <div>
                <p className="panel-kicker settings-panel-block-kicker">
                  {t("settings.plannerClearDataKicker")}
                </p>
                <h3>{t("settings.plannerClearDataTitle")}</h3>
                <p>{t("settings.plannerClearDataDescription")}</p>
              </div>
              <span className={`settings-planner-data-total ${plannerDataTotal === 0 ? "is-empty" : ""}`}>
                {plannerDataTotal > 0
                  ? t("settings.plannerClearDataTotal", { count: plannerDataTotal })
                  : t("settings.plannerClearDataEmpty")}
              </span>
            </div>

            <div className="settings-planner-data-grid" aria-label={t("settings.plannerClearDataStatsLabel")}>
              {plannerDataStatItems.map((item) => (
                <span key={item.key} className="settings-planner-data-pill">
                  <strong>{item.count}</strong>
                  <span>{item.label}</span>
                </span>
              ))}
            </div>

            <div className="settings-planner-danger-footer">
              <p>{t("settings.plannerClearDataBoundary")}</p>
              <button
                type="button"
                className="settings-row-action settings-row-action-danger settings-planner-clear-action"
                onClick={() => void handleClearPlannerDataClick()}
                disabled={!onClearPlannerData || plannerClearBusy || plannerDataTotal === 0}
              >
                {plannerClearBusy
                  ? t("settings.plannerClearDataBusy")
                  : t("settings.plannerClearDataAction")}
              </button>
            </div>

            {plannerClearFeedback ? (
              <div className={`settings-planner-clear-feedback is-${plannerClearFeedback.tone}`} role="status">
                {plannerClearFeedback.text}
              </div>
            ) : null}
          </section>
        </div>
      </section>
    );
  }

  if (view === "ai") {
    return (
      <section className="settings-panel-shell is-ai-settings">
        {renderSettingsHeader(t("settings.aiTitle"), t("settings.aiPanelCaption"), {
          back: true
        })}

        <AiIntegrationSettings onConnectionChange={setAiConnected} />
      </section>
    );
  }

  if (view === "backup") {
    const activeVault = localVaults.find((vault) => vault.id === activeLocalVaultId) ?? null;
    const activeVaultName = activeVault?.name || t("app.localVault");

    return (
      <section className="settings-panel-shell is-backup-settings">
        {renderSettingsHeader(t("settings.backupTitle"), t("settings.backupCaption"), {
          back: true
        })}

        <BackupSettingsPanel
          activeLocalVaultId={activeLocalVaultId}
          vaultName={activeVaultName}
          vaultKind={activeVault?.vaultKind ?? "regular"}
          language={settings.language}
        />
      </section>
    );
  }

  if (view === "interface") {
    return (
      <section className="settings-panel-shell is-interface-settings">
        {renderSettingsHeader(t("settings.interfaceTitle"), t("settings.interfacePanelCaption"), {
          back: true
        })}

        <div className="settings-panel-grid">
          <section
            className={`settings-panel-block settings-panel-block-primary settings-language-block ${languagePickerOpen ? "is-picker-open" : ""}`}
          >
            <div className="settings-panel-block-head">
              <p className="panel-kicker settings-panel-block-kicker">{t("settings.interfaceLanguageKicker")}</p>
            </div>

            <div className="settings-row-stack settings-row-stack-single">
              <div className="settings-row settings-row-static is-language">
                <span className="settings-row-icon" aria-hidden="true">
                  <LanguageGlyph />
                </span>
                <div className="settings-row-copy">
                  <strong>{t("settings.language")}</strong>
                  <span>{t("settings.languageDescription")}</span>
                </div>
                <div
                  className={`settings-language-picker ${languagePickerOpen ? "is-open" : ""}`}
                  ref={languagePickerRef}
                >
                  <button
                    type="button"
                    className="settings-language-trigger"
                    onClick={() => setLanguagePickerOpen((current) => !current)}
                    aria-haspopup="listbox"
                    aria-expanded={languagePickerOpen}
                    aria-controls="settings-language-menu"
                  >
                    <span className="settings-language-option-mark" aria-hidden="true">
                      {selectedLanguageOption.code}
                    </span>
                    <span className="settings-language-option-copy">
                      <strong>{t(selectedLanguageOption.labelKey)}</strong>
                      <span>{selectedLanguageOption.nativeLabel}</span>
                    </span>
                    <span className="settings-row-action-icon settings-language-chevron" aria-hidden="true">
                      <ChevronGlyph expanded={languagePickerOpen} />
                    </span>
                  </button>

                  {languagePickerOpen ? (
                    <div
                      id="settings-language-menu"
                      className="settings-language-menu"
                      role="listbox"
                      aria-label={t("settings.language")}
                    >
                    {LANGUAGE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`settings-language-option ${settings.language === option.value ? "is-active" : ""}`}
                        onClick={() => {
                          onLanguageChange(option.value);
                          setLanguagePickerOpen(false);
                        }}
                        role="option"
                        aria-selected={settings.language === option.value}
                      >
                        <span className="settings-language-option-mark" aria-hidden="true">
                          {option.code}
                        </span>
                        <span className="settings-language-option-copy">
                          <strong>{t(option.labelKey)}</strong>
                          <span>{option.nativeLabel}</span>
                        </span>
                        <span className="settings-language-option-check" aria-hidden="true">
                          {settings.language === option.value ? "✓" : ""}
                        </span>
                      </button>
                    ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </section>

          <section className="settings-panel-block settings-panel-block-primary">
            <div className="settings-panel-block-head">
              <p className="panel-kicker settings-panel-block-kicker">{t("settings.accentThemeChoose")}</p>
            </div>

            {renderAccentThemeOptions(true)}
          </section>

          <section className="settings-panel-block settings-panel-block-primary settings-interface-motion-block">
            <div className="settings-panel-block-head">
              <div>
                <p className="panel-kicker settings-panel-block-kicker">{t("settings.interfaceMotionKicker")}</p>
                <h3 className="settings-interface-motion-title">{t("settings.interfaceMotionTitle")}</h3>
                <p className="settings-interface-motion-caption">{t("settings.interfaceMotionDescription")}</p>
              </div>
            </div>

            {renderOrbitalAnimationOptions()}
          </section>

          <section className="settings-panel-block settings-panel-block-primary settings-interface-motion-block">
            <div className="settings-panel-block-head">
              <div>
                <p className="panel-kicker settings-panel-block-kicker">{t("settings.interfaceTemporalKicker")}</p>
                <h3 className="settings-interface-motion-title">{t("settings.interfaceTemporalTitle")}</h3>
                <p className="settings-interface-motion-caption">{t("settings.interfaceTemporalDescription")}</p>
              </div>
            </div>

            {renderOrbitalTemporalSignalOptions()}
          </section>
        </div>
      </section>
    );
  }

  return (
    <section className="settings-panel-shell is-root-settings">
      {renderSettingsHeader(t("settings.title"), t("settings.caption"))}

      <div className="settings-panel-grid">
        <section className="settings-panel-block settings-panel-block-primary">
          <div className="settings-panel-block-head">
            <p className="panel-kicker settings-panel-block-kicker">{t("settings.general")}</p>
          </div>

          <div className="settings-row-stack">
            <button
              type="button"
              className="settings-row settings-row-destination is-account-cloud"
              onClick={() => setView("accountCloud")}
            >
              <span className="settings-row-icon settings-destination-icon" aria-hidden="true">
                <AccountCloudGlyph />
              </span>
              <div className="settings-row-copy">
                <strong>{t("settings.accountCloudTitle")}</strong>
                <span>{t("settings.accountCloudRootDescription")}</span>
              </div>
              <span className="settings-row-side">
                <span className="settings-row-count">{accountCloudLabel}</span>
                <span className="settings-row-action-icon" aria-hidden="true">
                  <ChevronGlyph />
                </span>
              </span>
            </button>

            <button
              type="button"
              className="settings-row settings-row-destination is-interface"
              onClick={() => setView("interface")}
            >
              <span className="settings-row-icon settings-destination-icon" aria-hidden="true">
                <AccentGlyph />
              </span>
              <div className="settings-row-copy">
                <strong>{t("settings.interfaceTitle")}</strong>
                <span>{t("settings.interfaceRootDescription")}</span>
              </div>
              <span className="settings-row-side">
                <span className="settings-row-count">
                  {t(currentAccentTheme.labelKey)} · {t(selectedLanguageOption.labelKey)}
                </span>
                <span className="settings-row-action-icon" aria-hidden="true">
                  <ChevronGlyph />
                </span>
              </span>
            </button>

            <button
              type="button"
              className="settings-row settings-row-destination is-planner"
              onClick={() => setView("planner")}
            >
              <span className="settings-row-icon settings-destination-icon" aria-hidden="true">
                <PlannerGlyph />
              </span>
              <div className="settings-row-copy">
                <strong>{t("settings.plannerTitle")}</strong>
                <span>{t("settings.plannerDescription")}</span>
              </div>
              <span className="settings-row-side">
                <span className="settings-row-count">
                  {t(plannerDefaultCalendarViewOption.titleKey)}
                </span>
                <span className="settings-row-action-icon" aria-hidden="true">
                  <ChevronGlyph />
                </span>
              </span>
            </button>

            <button
              type="button"
              className="settings-row settings-row-destination is-ai"
              onClick={() => setView("ai")}
            >
              <span className="settings-row-icon settings-destination-icon" aria-hidden="true">
                <AiGlyph />
              </span>
              <div className="settings-row-copy">
                <strong>{t("settings.aiTitle")}</strong>
                <span>{t("settings.aiDescription")}</span>
              </div>
              <span className="settings-row-side">
                <span className="settings-row-count">{aiConnectionLabel}</span>
                <span className="settings-row-action-icon" aria-hidden="true">
                  <ChevronGlyph />
                </span>
              </span>
            </button>

            <button
              type="button"
              className="settings-row settings-row-destination is-backup"
              onClick={() => setView("backup")}
            >
              <span className="settings-row-icon settings-destination-icon" aria-hidden="true">
                <BackupGlyph />
              </span>
              <div className="settings-row-copy">
                <strong>{t("settings.backupTitle")}</strong>
                <span>{t("settings.backupDescription")}</span>
              </div>
              <span className="settings-row-side">
                <span className="settings-row-count">{t("settings.backupChip")}</span>
                <span className="settings-row-action-icon" aria-hidden="true">
                  <ChevronGlyph />
                </span>
              </span>
            </button>

            <button
              type="button"
              className="settings-row settings-row-destination is-sync"
              onClick={() => setView("sync")}
            >
              <span className="settings-row-icon settings-destination-icon" aria-hidden="true">
                <SyncGlyph />
              </span>
              <div className="settings-row-copy">
                <strong>{t("settings.syncTitle")}</strong>
                <span>
                  {t("settings.syncDescription", {
                    vaultCount: localVaults.length,
                    connectionCount: externalSyncConnections.length
                  })}
                </span>
              </div>
              <span className="settings-row-side">
                <span className="settings-row-count">{externalSyncBindingCount}</span>
                <span className="settings-row-action-icon" aria-hidden="true">
                  <ChevronGlyph />
                </span>
              </span>
            </button>
          </div>
        </section>

        {appUpdatesEnabled ? (
          <section className="settings-panel-block settings-panel-block-updater">
            <div className="settings-panel-block-head">
              <p className="panel-kicker settings-panel-block-kicker">{t("settings.app")}</p>
            </div>

            <div className="settings-row-stack">
              <div className="settings-row settings-row-static settings-update-row is-update">
                <span className="settings-row-icon settings-destination-icon" aria-hidden="true">
                  <UpdateGlyph />
                </span>
                <div className="settings-row-copy settings-update-copy">
                  <strong>{t("settings.desktopUpdateTitle")}</strong>
                  <span>{appUpdateDescription}</span>
                  {appUpdateState.releaseBody ? (
                    <p className="settings-update-note">{appUpdateState.releaseBody}</p>
                  ) : null}
                  {appUpdatePublishedLabel ? (
                    <p className="settings-update-meta">
                      {t("settings.desktopUpdatePublished", {
                        date: appUpdatePublishedLabel
                      })}
                    </p>
                  ) : null}
                  {appUpdateState.phase === "failed" && appUpdateIssueText ? (
                    <p className="settings-update-error">{appUpdateIssueText}</p>
                  ) : null}
                  {appUpdateState.issueDetail ? (
                    <p className="settings-update-detail">
                      {t("settings.desktopUpdateDetail", {
                        detail: appUpdateState.issueDetail
                      })}
                    </p>
                  ) : null}
                  {appUpdateState.phase === "downloading" &&
                  appUpdateState.progress !== null ? (
                    <div
                      className="settings-update-progress"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={appUpdateState.progress}
                    >
                      <span
                        className="settings-update-progress-fill"
                        style={{ width: `${appUpdateState.progress}%` }}
                      />
                    </div>
                  ) : null}
                  <p className="settings-update-hint">
                    {appUpdateState.kind === "android"
                      ? t("settings.androidUpdateHint")
                      : t("settings.desktopUpdateHint")}
                  </p>
                </div>
                <div className="settings-update-side">
                  <span className="settings-row-count">
                    {t("settings.appVersionChip", {
                      version: appUpdateCurrentVersion ?? "—"
                    })}
                  </span>
                  <div className="settings-update-actions">
                    <button
                      type="button"
                      className="settings-row-action"
                      onClick={() => {
                        void appUpdatePrimaryAction();
                      }}
                      disabled={appUpdatePrimaryActionDisabled}
                    >
                      <span>{appUpdatePrimaryActionLabel}</span>
                    </button>
                    {shouldShowOpenReleaseAction ? (
                      <button
                        type="button"
                        className="settings-row-action settings-row-action-secondary"
                        onClick={() => {
                          void handleOpenAppReleasePage();
                        }}
                        disabled={appUpdatePrimaryActionDisabled}
                      >
                        <span>{t("settings.desktopUpdateOpenRelease")}</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : null}
        </div>
    </section>
  );
}
