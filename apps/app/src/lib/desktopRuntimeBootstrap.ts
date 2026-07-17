import {
  fetchDataStoreIdentifiers,
  getIdentifier,
  getVersion,
  removeDataStore,
  type DataStoreIdentifier
} from "@tauri-apps/api/app";
import { BaseDirectory, mkdir, readDir, remove } from "@tauri-apps/plugin-fs";

import {
  exportLocalVaultDesktopBackup,
  hasLocalVaultPersistedState,
  readLocalVaultNativeSnapshot,
  restoreLocalVaultDesktopBackup
} from "../data/db";
import {
  DESKTOP_CACHE_DIRECTORY,
  DESKTOP_DATA_DIRECTORY,
  DESKTOP_SETTINGS_DIRECTORY,
  DESKTOP_WEBVIEW_DIRECTORY,
  buildMacosDataStoreIdentifier,
  buildWindowsWebviewDirectory
} from "./desktopRuntimeLayout";
import { listLocalVaultProfiles } from "./localVaults";
import { readDesktopVaultBackup } from "./desktopVaultBackups";
import { isDesktopRuntime } from "./runtime";
import { writeNativeVaultSnapshot } from "./nativeVaultStore";

function isWindowsDesktopRuntime() {
  return isDesktopRuntime() && /Windows/i.test(window.navigator.userAgent);
}

function isMacosDesktopRuntime() {
  return isDesktopRuntime() && /Mac/i.test(window.navigator.userAgent);
}

function sameDataStoreIdentifier(left: DataStoreIdentifier, right: DataStoreIdentifier) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function ensureDesktopRuntimeDirectories() {
  await Promise.all([
    mkdir(DESKTOP_DATA_DIRECTORY, {
      baseDir: BaseDirectory.AppData,
      recursive: true
    }),
    mkdir(DESKTOP_SETTINGS_DIRECTORY, {
      baseDir: BaseDirectory.AppData,
      recursive: true
    }),
    mkdir(DESKTOP_WEBVIEW_DIRECTORY, {
      baseDir: BaseDirectory.AppData,
      recursive: true
    }),
    mkdir(DESKTOP_CACHE_DIRECTORY, {
      baseDir: BaseDirectory.AppCache,
      recursive: true
    })
  ]).catch(() => undefined);
}

async function persistDexieVaultIntoNativeStore(localVaultId: string) {
  const snapshot = await exportLocalVaultDesktopBackup(localVaultId);

  if (!snapshot) {
    return false;
  }

  await writeNativeVaultSnapshot(localVaultId, snapshot);
  return true;
}

async function migrateVaultIntoNativeStoreIfNeeded(localVaultId: string) {
  const existingNativeSnapshot = await readLocalVaultNativeSnapshot(localVaultId);

  if (existingNativeSnapshot) {
    return existingNativeSnapshot;
  }

  const desktopBackup = await readDesktopVaultBackup(localVaultId);

  if (desktopBackup) {
    await writeNativeVaultSnapshot(localVaultId, desktopBackup);
    return desktopBackup;
  }

  return null;
}

async function hydrateDexieCachesFromNativeStore() {
  const vaults = listLocalVaultProfiles();

  for (const vault of vaults) {
    // A populated IndexedDB belongs to the current WebView profile and is more
    // recent than a delayed recovery checkpoint after an unexpected shutdown.
    // Only restore native data into an empty profile (for example, after a
    // WebView migration or reset), never overwrite live local edits at startup.
    if (await hasLocalVaultPersistedState(vault.id)) {
      const nativeSnapshot = await readLocalVaultNativeSnapshot(vault.id);

      if (!nativeSnapshot) {
        await persistDexieVaultIntoNativeStore(vault.id);
      }

      continue;
    }

    const snapshot = await migrateVaultIntoNativeStoreIfNeeded(vault.id);

    if (!snapshot) {
      continue;
    }

    await restoreLocalVaultDesktopBackup(vault.id, snapshot, {
      preserveMissingPlannerCollections: true
    });
  }
}

async function cleanupStaleWindowsWebviewData(identifier: string, version: string) {
  if (!isWindowsDesktopRuntime()) {
    return;
  }

  const currentDirectory = buildWindowsWebviewDirectory("main", identifier, version);
  const rootPath = `${DESKTOP_WEBVIEW_DIRECTORY}/main`;
  const currentDirectoryName = currentDirectory.split("/").at(-1);

  if (!currentDirectoryName) {
    return;
  }

  await mkdir(rootPath, {
    baseDir: BaseDirectory.AppData,
    recursive: true
  }).catch(() => undefined);

  const entries = await readDir(rootPath, {
    baseDir: BaseDirectory.AppData
  }).catch(() => []);

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory && entry.name && entry.name !== currentDirectoryName)
      .map((entry) =>
        remove(`${rootPath}/${entry.name}`, {
          baseDir: BaseDirectory.AppData,
          recursive: true
        }).catch(() => undefined)
      )
  );
}

async function cleanupStaleMacosDataStores(identifier: string, version: string) {
  if (!isMacosDesktopRuntime()) {
    return;
  }

  const currentIdentifier = buildMacosDataStoreIdentifier(identifier, version);
  const existingIdentifiers = await fetchDataStoreIdentifiers().catch(() => []);

  for (const existingIdentifier of existingIdentifiers) {
    if (sameDataStoreIdentifier(existingIdentifier, currentIdentifier)) {
      continue;
    }

    await removeDataStore(existingIdentifier).catch(() => undefined);
  }
}

export async function bootstrapDesktopRuntimeState() {
  if (!isDesktopRuntime()) {
    return;
  }

  await ensureDesktopRuntimeDirectories();
  await hydrateDexieCachesFromNativeStore();

  const [identifier, version] = await Promise.all([
    getIdentifier().catch(() => "com.locoris.desktop"),
    getVersion().catch(() => "dev")
  ]);

  await cleanupStaleWindowsWebviewData(identifier, version);
  await cleanupStaleMacosDataStores(identifier, version);
}
