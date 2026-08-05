import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import {
  readPersistentString,
  removePersistentString,
  writePersistentString
} from "./persistentClientStorage";
import { isAndroidRuntime } from "./runtime";

const ANDROID_UPDATE_ATTEMPT_STORAGE_KEY = "locoris:android-update:attempt";
const ANDROID_RELEASE_REPOSITORY = "locoris/locoris";
const ANDROID_RELEASE_TAG_PREFIX = "app-v";
const ANDROID_PACKAGE_NAME = "com.locoris.android";
const GITHUB_RELEASES_ENDPOINT = `https://api.github.com/repos/${ANDROID_RELEASE_REPOSITORY}/releases?per_page=50`;

type PersistedAndroidUpdateAttempt = {
  fromVersion: string;
  targetVersion: string;
  releaseUrl: string;
  startedAt: number;
};

type AndroidReleaseAsset = {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
};

type AndroidGithubRelease = {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
  html_url?: unknown;
  assets?: unknown;
};

type ValidatedAndroidUpdate = {
  availableVersion: string;
  releaseBody: string | null;
  releaseDate: string | null;
  releaseUrl: string;
  apkUrl: string;
  apkName: string;
  apkSize: number | null;
};

type AndroidUpdateProgressResponse = {
  progress?: unknown;
};

export type AndroidUpdateIssueCode =
  | "unsupported"
  | "check-failed"
  | "metadata-invalid"
  | "download-failed"
  | "install-failed"
  | "install-not-applied"
  | "android-install-permission-required";

export type AndroidUpdatePhase =
  | "unsupported"
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "restarting"
  | "failed";

export type AndroidUpdateSnapshot = {
  supported: boolean;
  currentVersion: string | null;
  phase: AndroidUpdatePhase;
  availableVersion: string | null;
  releaseBody: string | null;
  releaseDate: string | null;
  releaseUrl: string | null;
  progress: number | null;
  issueCode: AndroidUpdateIssueCode | null;
  issueDetail: string | null;
  checkedAt: number | null;
  lastAttemptedVersion: string | null;
  canRetryInstall: boolean;
  canOpenReleasePage: boolean;
};

const androidUpdateListeners = new Set<(snapshot: AndroidUpdateSnapshot) => void>();

let androidUpdateSnapshot: AndroidUpdateSnapshot = {
  supported: isAndroidRuntime(),
  currentVersion: null,
  phase: isAndroidRuntime() ? "idle" : "unsupported",
  availableVersion: null,
  releaseBody: null,
  releaseDate: null,
  releaseUrl: null,
  progress: null,
  issueCode: isAndroidRuntime() ? null : "unsupported",
  issueDetail: null,
  checkedAt: null,
  lastAttemptedVersion: null,
  canRetryInstall: false,
  canOpenReleasePage: false
};

let androidUpdateInitializationPromise: Promise<void> | null = null;
let androidUpdateCheckPromise: Promise<AndroidUpdateSnapshot> | null = null;
let androidUpdateInstallPromise: Promise<void> | null = null;
let automaticAndroidUpdateCheckStarted = false;
let currentAvailableAndroidUpdate: ValidatedAndroidUpdate | null = null;
let androidRuntimePackageNamePromise: Promise<string | null> | null = null;

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
  removePersistentString(ANDROID_UPDATE_ATTEMPT_STORAGE_KEY);
}

function readPersistedUpdateAttempt() {
  const parsed = parsePersistedJson<PersistedAndroidUpdateAttempt>(
    ANDROID_UPDATE_ATTEMPT_STORAGE_KEY
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

function buildAndroidReleaseTag(version: string) {
  return `${ANDROID_RELEASE_TAG_PREFIX}${normalizeVersionToken(version)}`;
}

function buildAndroidReleaseUrl(version: string | null | undefined) {
  const normalizedVersion = normalizeVersionToken(version);

  if (!normalizedVersion) {
    return `https://github.com/${ANDROID_RELEASE_REPOSITORY}/releases`;
  }

  return `https://github.com/${ANDROID_RELEASE_REPOSITORY}/releases/tag/${buildAndroidReleaseTag(
    normalizedVersion
  )}`;
}

function getAndroidRuntimePackageName() {
  if (!androidRuntimePackageNamePromise) {
    androidRuntimePackageNamePromise = invoke<{ packageName?: unknown }>("android_get_package_name")
      .then((response) =>
        typeof response.packageName === "string" ? response.packageName.trim() || null : null
      )
      .catch(() => null);
  }

  return androidRuntimePackageNamePromise;
}

async function readAndroidUpdateDownloadProgress() {
  try {
    const response = await invoke<AndroidUpdateProgressResponse>("android_get_apk_update_progress");
    const progress = typeof response.progress === "number" ? response.progress : null;

    if (progress === null || progress < 0) {
      return null;
    }

    return Math.round(Math.min(100, Math.max(0, progress)));
  } catch {
    return null;
  }
}

function setAndroidUpdateSnapshot(
  patch:
    | Partial<AndroidUpdateSnapshot>
    | ((current: AndroidUpdateSnapshot) => Partial<AndroidUpdateSnapshot>)
) {
  const nextPatch = typeof patch === "function" ? patch(androidUpdateSnapshot) : patch;
  androidUpdateSnapshot = {
    ...androidUpdateSnapshot,
    ...nextPatch
  };
  androidUpdateListeners.forEach((listener) => listener(androidUpdateSnapshot));
}

function applyAndroidUpdateFailure(input: {
  issueCode: AndroidUpdateIssueCode;
  issueDetail?: string | null;
  availableVersion?: string | null;
  releaseUrl?: string | null;
  canRetryInstall?: boolean;
}) {
  setAndroidUpdateSnapshot((current) => ({
    phase: input.issueCode === "unsupported" ? "unsupported" : "failed",
    availableVersion: input.availableVersion ?? current.availableVersion,
    releaseUrl:
      input.releaseUrl ??
      current.releaseUrl ??
      buildAndroidReleaseUrl(input.availableVersion ?? current.availableVersion),
    progress: null,
    issueCode: input.issueCode,
    issueDetail: trimIssueDetail(input.issueDetail),
    lastAttemptedVersion:
      input.availableVersion ?? current.availableVersion ?? current.lastAttemptedVersion,
    canRetryInstall: Boolean(input.canRetryInstall),
    canOpenReleasePage: Boolean(
      input.releaseUrl ??
        current.releaseUrl ??
        buildAndroidReleaseUrl(input.availableVersion ?? current.availableVersion)
    )
  }));
}

function parseAndroidReleaseVersion(tagName: unknown) {
  if (typeof tagName !== "string") {
    return null;
  }

  const normalizedTag = tagName.trim();

  if (!normalizedTag.startsWith(ANDROID_RELEASE_TAG_PREFIX)) {
    return null;
  }

  const version = normalizeVersionToken(normalizedTag.slice(ANDROID_RELEASE_TAG_PREFIX.length));
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version) ? version : null;
}

function normalizeAndroidApkAsset(asset: AndroidReleaseAsset) {
  const name = typeof asset.name === "string" ? asset.name.trim() : "";
  const url =
    typeof asset.browser_download_url === "string"
      ? asset.browser_download_url.trim()
      : "";

  if (!name || !url || !name.toLowerCase().endsWith(".apk")) {
    return null;
  }

  return {
    name,
    url,
    size: typeof asset.size === "number" && Number.isFinite(asset.size) ? asset.size : null
  };
}

function findAndroidApkAsset(release: AndroidGithubRelease) {
  if (!Array.isArray(release.assets)) {
    return null;
  }

  const assets = release.assets
    .map((asset) => normalizeAndroidApkAsset(asset as AndroidReleaseAsset))
    .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));

  return (
    assets.find((asset) => /universal|release|android/i.test(asset.name)) ??
    assets[0] ??
    null
  );
}

async function fetchLatestAndroidUpdate(): Promise<ValidatedAndroidUpdate | null> {
  const response = await fetch(GITHUB_RELEASES_ENDPOINT, {
    headers: {
      Accept: "application/vnd.github+json"
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub returned HTTP ${response.status}.`);
  }

  const releases = (await response.json()) as AndroidGithubRelease[];

  if (!Array.isArray(releases)) {
    throw new Error("GitHub release response is not a list.");
  }

  const candidates = releases
    .map((release) => {
      const version = parseAndroidReleaseVersion(release.tag_name);
      const apkAsset = findAndroidApkAsset(release);

      if (
        !version ||
        release.draft === true ||
        release.prerelease === true ||
        !apkAsset
      ) {
        return null;
      }

      return {
        availableVersion: version,
        releaseBody: typeof release.body === "string" && release.body.trim() ? release.body.trim() : null,
        releaseDate:
          typeof release.published_at === "string" && release.published_at.trim()
            ? release.published_at.trim()
            : null,
        releaseUrl:
          typeof release.html_url === "string" && release.html_url.trim()
            ? release.html_url.trim()
            : buildAndroidReleaseUrl(version),
        apkUrl: apkAsset.url,
        apkName: apkAsset.name,
        apkSize: apkAsset.size
      } satisfies ValidatedAndroidUpdate;
    })
    .filter((release): release is ValidatedAndroidUpdate => Boolean(release))
    .sort((left, right) => compareVersions(right.availableVersion, left.availableVersion));

  return candidates[0] ?? null;
}

export function supportsAndroidUpdates() {
  return isAndroidRuntime();
}

export async function getAndroidAppVersion() {
  if (!supportsAndroidUpdates()) {
    return null;
  }

  return getVersion();
}

export function readAndroidUpdateSnapshot() {
  return androidUpdateSnapshot;
}

export function subscribeAndroidUpdateState(listener: (snapshot: AndroidUpdateSnapshot) => void) {
  androidUpdateListeners.add(listener);
  listener(androidUpdateSnapshot);

  return () => {
    androidUpdateListeners.delete(listener);
  };
}

export async function initializeAndroidUpdateState() {
  if (androidUpdateInitializationPromise) {
    return androidUpdateInitializationPromise;
  }

  androidUpdateInitializationPromise = (async () => {
    if (!supportsAndroidUpdates()) {
      currentAvailableAndroidUpdate = null;
      setAndroidUpdateSnapshot({
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

    const currentVersion = await getAndroidAppVersion();
    const runtimePackageName = await getAndroidRuntimePackageName();
    const pendingAttempt = readPersistedUpdateAttempt();

    currentAvailableAndroidUpdate = null;

    if (runtimePackageName && runtimePackageName !== ANDROID_PACKAGE_NAME) {
      clearPersistedUpdateAttempt();
      setAndroidUpdateSnapshot({
        supported: false,
        currentVersion,
        phase: "unsupported",
        availableVersion: null,
        releaseBody: null,
        releaseDate: null,
        releaseUrl: buildAndroidReleaseUrl(null),
        progress: null,
        issueCode: "unsupported",
        issueDetail: `Android updates are only enabled for ${ANDROID_PACKAGE_NAME}; this build is ${runtimePackageName}.`,
        checkedAt: null,
        lastAttemptedVersion: null,
        canRetryInstall: false,
        canOpenReleasePage: true
      });
      return;
    }

    setAndroidUpdateSnapshot({
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
    applyAndroidUpdateFailure({
      issueCode: "install-not-applied",
      availableVersion: pendingAttempt.targetVersion,
      releaseUrl: pendingAttempt.releaseUrl,
      issueDetail: `Android returned to ${currentVersion} instead of ${pendingAttempt.targetVersion}.`,
      canRetryInstall: true
    });
  })();

  return androidUpdateInitializationPromise;
}

export async function checkForAndroidUpdate(options?: { quiet?: boolean }) {
  await initializeAndroidUpdateState();

  if (!supportsAndroidUpdates()) {
    return readAndroidUpdateSnapshot();
  }

  if (!readAndroidUpdateSnapshot().supported) {
    return readAndroidUpdateSnapshot();
  }

  if (androidUpdateCheckPromise) {
    return androidUpdateCheckPromise;
  }

  androidUpdateCheckPromise = (async () => {
    setAndroidUpdateSnapshot((current) => ({
      phase: "checking",
      progress: null,
      issueCode: options?.quiet ? current.issueCode : null,
      issueDetail: options?.quiet ? current.issueDetail : null,
      canRetryInstall: false
    }));

    try {
      const update = await fetchLatestAndroidUpdate();

      if (!update) {
        currentAvailableAndroidUpdate = null;
        setAndroidUpdateSnapshot((current) => ({
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

        return readAndroidUpdateSnapshot();
      }

      const currentVersion = androidUpdateSnapshot.currentVersion ?? (await getAndroidAppVersion());

      if (currentVersion && compareVersions(update.availableVersion, currentVersion) <= 0) {
        currentAvailableAndroidUpdate = null;
        setAndroidUpdateSnapshot((current) => ({
          phase: "upToDate",
          currentVersion,
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

        return readAndroidUpdateSnapshot();
      }

      currentAvailableAndroidUpdate = update;
      setAndroidUpdateSnapshot({
        phase: "available",
        currentVersion,
        availableVersion: update.availableVersion,
        releaseBody: update.releaseBody,
        releaseDate: update.releaseDate,
        releaseUrl: update.releaseUrl,
        progress: null,
        issueCode: null,
        issueDetail: null,
        checkedAt: Date.now(),
        lastAttemptedVersion: update.availableVersion,
        canRetryInstall: false,
        canOpenReleasePage: true
      });

      return readAndroidUpdateSnapshot();
    } catch (error) {
      currentAvailableAndroidUpdate = null;

      if (!options?.quiet) {
        applyAndroidUpdateFailure({
          issueCode: "check-failed",
          issueDetail: normalizeUpdaterError(error),
          availableVersion: readAndroidUpdateSnapshot().availableVersion,
          releaseUrl: readAndroidUpdateSnapshot().releaseUrl,
          canRetryInstall: false
        });
      } else {
        setAndroidUpdateSnapshot((current) => ({
          phase: current.phase === "failed" ? "failed" : "idle",
          progress: null,
          checkedAt: current.checkedAt
        }));
      }

      return readAndroidUpdateSnapshot();
    } finally {
      androidUpdateCheckPromise = null;
    }
  })();

  return androidUpdateCheckPromise;
}

export async function startAutomaticAndroidUpdateCheck() {
  if (automaticAndroidUpdateCheckStarted) {
    return;
  }

  automaticAndroidUpdateCheckStarted = true;
  await checkForAndroidUpdate({ quiet: true }).catch(() => undefined);
}

export async function installAvailableAndroidUpdate() {
  await initializeAndroidUpdateState();

  if (!supportsAndroidUpdates()) {
    applyAndroidUpdateFailure({
      issueCode: "unsupported",
      canRetryInstall: false
    });
    return;
  }

  if (!readAndroidUpdateSnapshot().supported) {
    applyAndroidUpdateFailure({
      issueCode: "unsupported",
      canRetryInstall: false
    });
    return;
  }

  if (androidUpdateInstallPromise) {
    return androidUpdateInstallPromise;
  }

  const update = currentAvailableAndroidUpdate;
  const currentSnapshot = readAndroidUpdateSnapshot();

  if (!update || currentSnapshot.phase !== "available" || !currentSnapshot.availableVersion) {
    applyAndroidUpdateFailure({
      issueCode: "install-not-applied",
      availableVersion: currentSnapshot.availableVersion,
      releaseUrl: currentSnapshot.releaseUrl,
      issueDetail: "No prepared Android APK update is available to install.",
      canRetryInstall: true
    });
    return;
  }

  androidUpdateInstallPromise = (async () => {
    const targetVersion = currentSnapshot.availableVersion ?? update.availableVersion;

    persistJson(ANDROID_UPDATE_ATTEMPT_STORAGE_KEY, {
      fromVersion: currentSnapshot.currentVersion ?? "0.0.0",
      targetVersion,
      releaseUrl: currentSnapshot.releaseUrl ?? buildAndroidReleaseUrl(targetVersion),
      startedAt: Date.now()
    } satisfies PersistedAndroidUpdateAttempt);

    setAndroidUpdateSnapshot({
      phase: "downloading",
      progress: update.apkSize && update.apkSize > 0 ? 0 : null,
      issueCode: null,
      issueDetail: null,
      canRetryInstall: false,
      canOpenReleasePage: true
    });

    let progressPollTimer: number | null = null;
    const stopProgressPolling = () => {
      if (progressPollTimer !== null) {
        window.clearInterval(progressPollTimer);
        progressPollTimer = null;
      }
    };

    if (typeof window !== "undefined") {
      progressPollTimer = window.setInterval(() => {
        void readAndroidUpdateDownloadProgress().then((progress) => {
          if (progress === null) {
            return;
          }

          setAndroidUpdateSnapshot((current) => {
            if (current.phase !== "downloading") {
              return {};
            }

            return {
              progress: Math.max(current.progress ?? 0, progress)
            };
          });
        });
      }, 300);
    }

    try {
      await invoke("android_install_apk_update", {
        url: update.apkUrl,
        fileName: update.apkName,
        expectedPackageName: ANDROID_PACKAGE_NAME,
        expectedSizeBytes: update.apkSize
      });

      setAndroidUpdateSnapshot({
        phase: "restarting",
        progress: 100,
        issueCode: null,
        issueDetail: null,
        canRetryInstall: true,
        canOpenReleasePage: true
      });
    } catch (error) {
      const detail = normalizeUpdaterError(error);
      const permissionRequired = detail === "ANDROID_INSTALL_PERMISSION_REQUIRED";

      if (!permissionRequired) {
        clearPersistedUpdateAttempt();
      }

      applyAndroidUpdateFailure({
        issueCode: permissionRequired
          ? "android-install-permission-required"
          : detail === "ANDROID_UPDATE_DOWNLOAD_FAILED"
          ? "download-failed"
          : "install-failed",
        issueDetail: detail,
        availableVersion: targetVersion,
        releaseUrl: currentSnapshot.releaseUrl,
        canRetryInstall: !permissionRequired
      });
    } finally {
      stopProgressPolling();
      androidUpdateInstallPromise = null;
    }
  })();

  return androidUpdateInstallPromise;
}

export async function retryFailedAndroidUpdateInstall() {
  await initializeAndroidUpdateState();

  const currentSnapshot = readAndroidUpdateSnapshot();

  if (
    currentSnapshot.issueCode === "android-install-permission-required" ||
    (!currentSnapshot.canRetryInstall && currentSnapshot.phase !== "failed")
  ) {
    return currentSnapshot;
  }

  const targetVersion =
    currentSnapshot.availableVersion ?? currentSnapshot.lastAttemptedVersion;

  const nextSnapshot = await checkForAndroidUpdate();

  if (
    nextSnapshot.phase === "available" &&
    nextSnapshot.availableVersion &&
    (!targetVersion || compareVersions(nextSnapshot.availableVersion, targetVersion) >= 0)
  ) {
    await installAvailableAndroidUpdate();
    return readAndroidUpdateSnapshot();
  }

  applyAndroidUpdateFailure({
    issueCode: "install-not-applied",
    availableVersion: targetVersion,
    releaseUrl: nextSnapshot.releaseUrl ?? buildAndroidReleaseUrl(targetVersion),
    issueDetail:
      "The requested Android update is not currently ready for automatic installation. Open the release page or check again.",
    canRetryInstall: true
  });

  return readAndroidUpdateSnapshot();
}

export async function openAndroidUpdateReleasePage(version?: string | null) {
  const releaseUrl = buildAndroidReleaseUrl(version ?? readAndroidUpdateSnapshot().availableVersion);
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(releaseUrl);
}

export async function openAndroidInstallPermissionSettings() {
  await invoke("android_open_install_permission_settings");
}
