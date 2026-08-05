import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import {
  readPersistentString,
  removePersistentString,
  writePersistentString
} from "./persistentClientStorage";
import { saveDesktopWindowState } from "./desktopWindowState";
import { isDesktopRuntime } from "./runtime";

const DESKTOP_UPDATE_ATTEMPT_STORAGE_KEY = "locoris:desktop-update:attempt";
const DESKTOP_RELEASE_REPOSITORY = "locoris/locoris";

type PersistedDesktopUpdateAttempt = {
  fromVersion: string;
  targetVersion: string;
  releaseUrl: string;
  startedAt: number;
};

export type DesktopUpdateIssueCode =
  | "unsupported"
  | "check-failed"
  | "metadata-invalid"
  | "download-failed"
  | "install-failed"
  | "install-not-applied";

export type DesktopUpdatePhase =
  | "unsupported"
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "restarting"
  | "failed";

export type DesktopUpdateSnapshot = {
  supported: boolean;
  currentVersion: string | null;
  phase: DesktopUpdatePhase;
  availableVersion: string | null;
  releaseBody: string | null;
  releaseDate: string | null;
  releaseUrl: string | null;
  progress: number | null;
  issueCode: DesktopUpdateIssueCode | null;
  issueDetail: string | null;
  checkedAt: number | null;
  lastAttemptedVersion: string | null;
  canRetryInstall: boolean;
  canOpenReleasePage: boolean;
};

type ValidatedAvailableUpdate = {
  availableVersion: string;
  releaseBody: string | null;
  releaseDate: string | null;
  releaseUrl: string;
};

const desktopUpdateListeners = new Set<(snapshot: DesktopUpdateSnapshot) => void>();

let desktopUpdateSnapshot: DesktopUpdateSnapshot = {
  supported: isDesktopRuntime(),
  currentVersion: null,
  phase: isDesktopRuntime() ? "idle" : "unsupported",
  availableVersion: null,
  releaseBody: null,
  releaseDate: null,
  releaseUrl: null,
  progress: null,
  issueCode: isDesktopRuntime() ? null : "unsupported",
  issueDetail: null,
  checkedAt: null,
  lastAttemptedVersion: null,
  canRetryInstall: false,
  canOpenReleasePage: false
};

let desktopUpdateInitializationPromise: Promise<void> | null = null;
let desktopUpdateCheckPromise: Promise<DesktopUpdateSnapshot> | null = null;
let desktopUpdateInstallPromise: Promise<void> | null = null;
let automaticDesktopUpdateCheckStarted = false;
let currentAvailableUpdate: Update | null = null;

function parsePersistedJson<T>(storageKey: string): T | null {
  const raw = readPersistentString(storageKey);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    removePersistentString(storageKey);
    return null;
  }
}

function persistJson(storageKey: string, value: unknown) {
  writePersistentString(storageKey, JSON.stringify(value));
}

function clearPersistedUpdateAttempt() {
  removePersistentString(DESKTOP_UPDATE_ATTEMPT_STORAGE_KEY);
}

function readPersistedUpdateAttempt() {
  const parsed = parsePersistedJson<PersistedDesktopUpdateAttempt>(
    DESKTOP_UPDATE_ATTEMPT_STORAGE_KEY
  );

  if (
    !parsed ||
    typeof parsed.fromVersion !== "string" ||
    typeof parsed.targetVersion !== "string" ||
    typeof parsed.releaseUrl !== "string" ||
    typeof parsed.startedAt !== "number"
  ) {
    clearPersistedUpdateAttempt();
    return null;
  }

  return parsed;
}

function normalizeVersionToken(version: string | null | undefined) {
  return typeof version === "string" ? version.trim() : "";
}

function compareVersions(left: string, right: string) {
  const leftParts = normalizeVersionToken(left)
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = normalizeVersionToken(right)
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);

    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

function trimIssueDetail(detail: string | null | undefined) {
  const normalizedDetail = typeof detail === "string" ? detail.trim() : "";
  return normalizedDetail || null;
}

function normalizeUpdaterError(error: unknown) {
  if (error instanceof Error) {
    return trimIssueDetail(error.message);
  }

  if (typeof error === "string") {
    return trimIssueDetail(error);
  }

  return null;
}

function buildDesktopReleaseTag(version: string) {
  return `app-v${normalizeVersionToken(version)}`;
}

function buildDesktopReleaseUrl(version: string | null | undefined) {
  const normalizedVersion = normalizeVersionToken(version);

  if (!normalizedVersion) {
    return `https://github.com/${DESKTOP_RELEASE_REPOSITORY}/releases/latest`;
  }

  return `https://github.com/${DESKTOP_RELEASE_REPOSITORY}/releases/tag/${buildDesktopReleaseTag(
    normalizedVersion
  )}`;
}

function emitDesktopUpdateSnapshot() {
  desktopUpdateListeners.forEach((listener) => {
    listener(desktopUpdateSnapshot);
  });
}

function replaceCurrentAvailableUpdate(nextUpdate: Update | null) {
  const previousUpdate = currentAvailableUpdate;
  currentAvailableUpdate = nextUpdate;

  if (!previousUpdate || previousUpdate === nextUpdate) {
    return;
  }

  void previousUpdate.close().catch(() => undefined);
}

function setDesktopUpdateSnapshot(
  patch:
    | Partial<DesktopUpdateSnapshot>
    | ((current: DesktopUpdateSnapshot) => Partial<DesktopUpdateSnapshot>)
) {
  const nextPatch = typeof patch === "function" ? patch(desktopUpdateSnapshot) : patch;
  desktopUpdateSnapshot = {
    ...desktopUpdateSnapshot,
    ...nextPatch
  };
  emitDesktopUpdateSnapshot();
}

function applyDesktopUpdateFailure(input: {
  issueCode: DesktopUpdateIssueCode;
  issueDetail?: string | null;
  availableVersion?: string | null;
  releaseUrl?: string | null;
  canRetryInstall?: boolean;
}) {
  setDesktopUpdateSnapshot((current) => ({
    phase: input.issueCode === "unsupported" ? "unsupported" : "failed",
    availableVersion: input.availableVersion ?? current.availableVersion,
    releaseUrl:
      input.releaseUrl ??
      current.releaseUrl ??
      buildDesktopReleaseUrl(input.availableVersion ?? current.availableVersion),
    progress: null,
    issueCode: input.issueCode,
    issueDetail: trimIssueDetail(input.issueDetail),
    lastAttemptedVersion:
      input.availableVersion ?? current.availableVersion ?? current.lastAttemptedVersion,
    canRetryInstall: Boolean(input.canRetryInstall),
    canOpenReleasePage: Boolean(
      input.releaseUrl ??
        current.releaseUrl ??
        buildDesktopReleaseUrl(input.availableVersion ?? current.availableVersion)
    )
  }));
}

function validateAvailableUpdate(update: Update): ValidatedAvailableUpdate {
  const availableVersion = normalizeVersionToken(update.version);

  if (!availableVersion) {
    throw new Error("Missing update version in latest.json.");
  }

  if (update.date && Number.isNaN(Date.parse(update.date))) {
    throw new Error(`Invalid update publication date for ${availableVersion}.`);
  }

  const rawJson = update.rawJson;

  if (!rawJson || typeof rawJson !== "object" || Array.isArray(rawJson)) {
    throw new Error("Update metadata is not an object.");
  }

  const { platforms } = rawJson as {
    platforms?: Record<string, { url?: unknown; signature?: unknown }>;
  };

  if (!platforms || typeof platforms !== "object" || Array.isArray(platforms)) {
    throw new Error("Update metadata does not contain a platforms map.");
  }

  const platformEntries = Object.entries(platforms);

  if (platformEntries.length === 0) {
    throw new Error("Update metadata does not contain any platform payloads.");
  }

  for (const [platformKey, entry] of platformEntries) {
    const candidateUrl = typeof entry?.url === "string" ? entry.url.trim() : "";
    const candidateSignature =
      typeof entry?.signature === "string" ? entry.signature.trim() : "";

    if (!candidateUrl) {
      throw new Error(`Update metadata is missing a URL for ${platformKey}.`);
    }

    if (!candidateSignature) {
      throw new Error(`Update metadata is missing a signature for ${platformKey}.`);
    }
  }

  return {
    availableVersion,
    releaseBody: update.body?.trim() || null,
    releaseDate: update.date ?? null,
    releaseUrl: buildDesktopReleaseUrl(availableVersion)
  };
}

async function getUpdaterApi() {
  return import("@tauri-apps/plugin-updater");
}

export function supportsDesktopUpdates() {
  return isDesktopRuntime();
}

export async function getDesktopAppVersion() {
  if (!supportsDesktopUpdates()) {
    return null;
  }

  return getVersion();
}

export function readDesktopUpdateSnapshot() {
  return desktopUpdateSnapshot;
}

export function subscribeDesktopUpdateState(listener: (snapshot: DesktopUpdateSnapshot) => void) {
  desktopUpdateListeners.add(listener);
  listener(desktopUpdateSnapshot);

  return () => {
    desktopUpdateListeners.delete(listener);
  };
}

export async function initializeDesktopUpdateState() {
  if (desktopUpdateInitializationPromise) {
    return desktopUpdateInitializationPromise;
  }

  desktopUpdateInitializationPromise = (async () => {
    if (!supportsDesktopUpdates()) {
      replaceCurrentAvailableUpdate(null);
      setDesktopUpdateSnapshot({
        supported: false,
        currentVersion: null,
        phase: "unsupported",
        availableVersion: null,
        releaseBody: null,
        releaseDate: null,
        releaseUrl: null,
        progress: null,
        issueCode: "unsupported",
        issueDetail: null,
        checkedAt: null,
        lastAttemptedVersion: null,
        canRetryInstall: false,
        canOpenReleasePage: false
      });
      return;
    }

    const currentVersion = await getDesktopAppVersion();
    const pendingAttempt = readPersistedUpdateAttempt();

    replaceCurrentAvailableUpdate(null);

    setDesktopUpdateSnapshot({
      supported: true,
      currentVersion,
      phase: "idle",
      availableVersion: null,
      releaseBody: null,
      releaseDate: null,
      releaseUrl: null,
      progress: null,
      issueCode: null,
      issueDetail: null,
      checkedAt: null,
      lastAttemptedVersion: null,
      canRetryInstall: false,
      canOpenReleasePage: false
    });

    if (!pendingAttempt || !currentVersion) {
      clearPersistedUpdateAttempt();
      return;
    }

    if (compareVersions(currentVersion, pendingAttempt.targetVersion) >= 0) {
      clearPersistedUpdateAttempt();
      return;
    }

    clearPersistedUpdateAttempt();
    applyDesktopUpdateFailure({
      issueCode: "install-not-applied",
      availableVersion: pendingAttempt.targetVersion,
      releaseUrl: pendingAttempt.releaseUrl,
      issueDetail: `The app restarted on ${currentVersion} instead of ${pendingAttempt.targetVersion}.`,
      canRetryInstall: true
    });
  })();

  return desktopUpdateInitializationPromise;
}

export async function checkForDesktopUpdate(options?: { quiet?: boolean }) {
  await initializeDesktopUpdateState();

  if (!supportsDesktopUpdates()) {
    return readDesktopUpdateSnapshot();
  }

  if (desktopUpdateCheckPromise) {
    return desktopUpdateCheckPromise;
  }

  desktopUpdateCheckPromise = (async () => {
    setDesktopUpdateSnapshot((current) => ({
      phase: "checking",
      progress: null,
      issueCode: options?.quiet ? current.issueCode : null,
      issueDetail: options?.quiet ? current.issueDetail : null,
      canRetryInstall: false
    }));

    try {
      const { check } = await getUpdaterApi();
      const update = await check();

      if (!update) {
        replaceCurrentAvailableUpdate(null);
        setDesktopUpdateSnapshot((current) => ({
          phase: "upToDate",
          availableVersion: null,
          releaseBody: null,
          releaseDate: null,
          releaseUrl: null,
          progress: null,
          issueCode: null,
          issueDetail: null,
          checkedAt: Date.now(),
          lastAttemptedVersion:
            current.phase === "failed" ? current.lastAttemptedVersion : null,
          canRetryInstall: false,
          canOpenReleasePage: false
        }));

        return readDesktopUpdateSnapshot();
      }

      const validated = validateAvailableUpdate(update);
      replaceCurrentAvailableUpdate(update);

      setDesktopUpdateSnapshot({
        phase: "available",
        availableVersion: validated.availableVersion,
        releaseBody: validated.releaseBody,
        releaseDate: validated.releaseDate,
        releaseUrl: validated.releaseUrl,
        progress: null,
        issueCode: null,
        issueDetail: null,
        checkedAt: Date.now(),
        lastAttemptedVersion: validated.availableVersion,
        canRetryInstall: false,
        canOpenReleasePage: true
      });

      return readDesktopUpdateSnapshot();
    } catch (error) {
      replaceCurrentAvailableUpdate(null);

      if (!options?.quiet) {
        const issueMessage = normalizeUpdaterError(error);
        const metadataIssue =
          issueMessage &&
          /metadata|platforms map|signature|publication date|latest\.json|version/i.test(
            issueMessage
          );

        applyDesktopUpdateFailure({
          issueCode: metadataIssue ? "metadata-invalid" : "check-failed",
          issueDetail: issueMessage,
          availableVersion: readDesktopUpdateSnapshot().availableVersion,
          releaseUrl: readDesktopUpdateSnapshot().releaseUrl,
          canRetryInstall: false
        });
      } else {
        setDesktopUpdateSnapshot((current) => ({
          phase: current.phase === "failed" ? "failed" : "idle",
          progress: null,
          checkedAt: current.checkedAt
        }));
      }

      return readDesktopUpdateSnapshot();
    } finally {
      desktopUpdateCheckPromise = null;
    }
  })();

  return desktopUpdateCheckPromise;
}

export async function startAutomaticDesktopUpdateCheck() {
  if (automaticDesktopUpdateCheckStarted) {
    return;
  }

  automaticDesktopUpdateCheckStarted = true;
  await checkForDesktopUpdate({ quiet: true }).catch(() => undefined);
}

export async function installAvailableDesktopUpdate() {
  await initializeDesktopUpdateState();

  if (!supportsDesktopUpdates()) {
    applyDesktopUpdateFailure({
      issueCode: "unsupported",
      canRetryInstall: false
    });
    return;
  }

  if (desktopUpdateInstallPromise) {
    return desktopUpdateInstallPromise;
  }

  const update = currentAvailableUpdate;
  const currentSnapshot = readDesktopUpdateSnapshot();

  if (!update || currentSnapshot.phase !== "available" || !currentSnapshot.availableVersion) {
    applyDesktopUpdateFailure({
      issueCode: "install-not-applied",
      availableVersion: currentSnapshot.availableVersion,
      releaseUrl: currentSnapshot.releaseUrl,
      issueDetail: "No prepared update is available to install.",
      canRetryInstall: true
    });
    return;
  }

  desktopUpdateInstallPromise = (async () => {
    let totalBytes = 0;
    let downloadedBytes = 0;
    let sawInstallPhase = false;
    const targetVersion = currentSnapshot.availableVersion ?? update.version;

    persistJson(DESKTOP_UPDATE_ATTEMPT_STORAGE_KEY, {
      fromVersion: currentSnapshot.currentVersion ?? "0.0.0",
      targetVersion,
      releaseUrl:
        currentSnapshot.releaseUrl ??
        buildDesktopReleaseUrl(targetVersion),
      startedAt: Date.now()
    } satisfies PersistedDesktopUpdateAttempt);

    setDesktopUpdateSnapshot({
      phase: "downloading",
      progress: 0,
      issueCode: null,
      issueDetail: null,
      canRetryInstall: false,
      canOpenReleasePage: true
    });

    try {
      await saveDesktopWindowState().catch(() => {});

      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength ?? 0;
          downloadedBytes = 0;

          setDesktopUpdateSnapshot({
            phase: "downloading",
            progress: totalBytes > 0 ? 0 : null
          });
          return;
        }

        if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;

          setDesktopUpdateSnapshot({
            phase: "downloading",
            progress:
              totalBytes > 0
                ? Math.max(
                    0,
                    Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
                  )
                : null
          });
          return;
        }

        sawInstallPhase = true;
        setDesktopUpdateSnapshot({
          phase: "restarting",
          progress: 100
        });
      });

      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (error) {
      clearPersistedUpdateAttempt();

      applyDesktopUpdateFailure({
        issueCode: sawInstallPhase ? "install-failed" : "download-failed",
        issueDetail: normalizeUpdaterError(error),
        availableVersion: targetVersion,
        releaseUrl: currentSnapshot.releaseUrl,
        canRetryInstall: true
      });
    } finally {
      desktopUpdateInstallPromise = null;
    }
  })();

  return desktopUpdateInstallPromise;
}

export async function retryFailedDesktopUpdateInstall() {
  await initializeDesktopUpdateState();

  const currentSnapshot = readDesktopUpdateSnapshot();

  if (!currentSnapshot.canRetryInstall && currentSnapshot.phase !== "failed") {
    return currentSnapshot;
  }

  const targetVersion =
    currentSnapshot.availableVersion ?? currentSnapshot.lastAttemptedVersion;

  const nextSnapshot = await checkForDesktopUpdate();

  if (
    nextSnapshot.phase === "available" &&
    nextSnapshot.availableVersion &&
    (!targetVersion ||
      compareVersions(nextSnapshot.availableVersion, targetVersion) >= 0)
  ) {
    await installAvailableDesktopUpdate();
    return readDesktopUpdateSnapshot();
  }

  applyDesktopUpdateFailure({
    issueCode: "install-not-applied",
    availableVersion: targetVersion,
    releaseUrl: nextSnapshot.releaseUrl ?? buildDesktopReleaseUrl(targetVersion),
    issueDetail:
      "The requested update is not currently ready for automatic installation. Open the release page or check again.",
    canRetryInstall: true
  });

  return readDesktopUpdateSnapshot();
}

export async function openDesktopUpdateReleasePage(version?: string | null) {
  const releaseUrl =
    buildDesktopReleaseUrl(version ?? readDesktopUpdateSnapshot().availableVersion);
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(releaseUrl);
}
