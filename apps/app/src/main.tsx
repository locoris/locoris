import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import "@blocknote/mantine/style.css";
import "@fontsource-variable/onest/wght.css";
import "@fontsource-variable/unbounded/wght.css";
import "@fontsource-variable/golos-text/wght.css";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/cyrillic-400.css";
import "@fontsource/ibm-plex-sans/latin-400-italic.css";
import "@fontsource/ibm-plex-sans/cyrillic-400-italic.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/cyrillic-500.css";
import "@fontsource/ibm-plex-sans/latin-500-italic.css";
import "@fontsource/ibm-plex-sans/cyrillic-500-italic.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-sans/cyrillic-600.css";
import "@fontsource/ibm-plex-sans/latin-600-italic.css";
import "@fontsource/ibm-plex-sans/cyrillic-600-italic.css";
import "@fontsource/ibm-plex-sans/latin-700.css";
import "@fontsource/ibm-plex-sans/cyrillic-700.css";
import "@fontsource/ibm-plex-sans/latin-700-italic.css";
import "@fontsource/ibm-plex-sans/cyrillic-700-italic.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/cyrillic-400.css";
import "@fontsource/ibm-plex-mono/latin-400-italic.css";
import "@fontsource/ibm-plex-mono/cyrillic-400-italic.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/cyrillic-500.css";
import "@fontsource/ibm-plex-mono/latin-500-italic.css";
import "@fontsource/ibm-plex-mono/cyrillic-500-italic.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "@fontsource/ibm-plex-mono/cyrillic-600.css";
import "@fontsource/ibm-plex-mono/latin-600-italic.css";
import "@fontsource/ibm-plex-mono/cyrillic-600-italic.css";
import "@fontsource/ibm-plex-mono/latin-700.css";
import "@fontsource/ibm-plex-mono/cyrillic-700.css";
import "@fontsource/ibm-plex-mono/latin-700-italic.css";
import "@fontsource/ibm-plex-mono/cyrillic-700-italic.css";
import "@fontsource/ibm-plex-serif/latin-400.css";
import "@fontsource/ibm-plex-serif/cyrillic-400.css";
import "@fontsource/ibm-plex-serif/latin-400-italic.css";
import "@fontsource/ibm-plex-serif/cyrillic-400-italic.css";
import "@fontsource/ibm-plex-serif/latin-500.css";
import "@fontsource/ibm-plex-serif/cyrillic-500.css";
import "@fontsource/ibm-plex-serif/latin-500-italic.css";
import "@fontsource/ibm-plex-serif/cyrillic-500-italic.css";
import "@fontsource/ibm-plex-serif/latin-600.css";
import "@fontsource/ibm-plex-serif/cyrillic-600.css";
import "@fontsource/ibm-plex-serif/latin-600-italic.css";
import "@fontsource/ibm-plex-serif/cyrillic-600-italic.css";
import "@fontsource/ibm-plex-serif/latin-700.css";
import "@fontsource/ibm-plex-serif/cyrillic-700.css";
import "@fontsource/ibm-plex-serif/latin-700-italic.css";
import "@fontsource/ibm-plex-serif/cyrillic-700-italic.css";

import App from "./App";
import "./styles/scrollbars.css";
import "./styles.css";
import "./styles/motion.css";
import { initializeI18n } from "./i18n";
import { LocaleProvider } from "./localization/LocaleProvider";
import {
  queueLocaleFailureNotice,
  readLastWorkingInterfaceLocale,
  readLocalePreferences,
  writeLastWorkingInterfaceLocale,
  writeLocalePreferences
} from "./localization/localePreferences";
import { preloadLocaleResources, resolveSupportedLocale } from "./localization/localePacks";
import { initializeLocaleWithRecovery } from "./localization/localeTransition";
import {
  flushPendingLocalVaultStorage,
  sanitizePersistedLocalVaultSecrets,
  switchActiveLocalVaultDatabase
} from "./data/db";
import { bootstrapDesktopRuntimeState } from "./lib/desktopRuntimeBootstrap";
import { initializeDesktopWindowStatePersistence } from "./lib/desktopWindowState";
import { initializeVaultEncryptionSessions } from "./lib/e2eeSession";
import { getStoredActiveLocalVaultId, listLocalVaultProfiles } from "./lib/localVaults";
import { initializePersistentClientStorage } from "./lib/persistentClientStorage";
import { isDesktopRuntime } from "./lib/runtime";
import {
  listAppSettingsSecretKeys,
  preloadSecureSecrets
} from "./lib/secureSecretStore";
import { initializeSecureSyncRegistryState } from "./lib/syncRegistry";
import { initializeSelfHostedDeepLinks } from "./lib/selfHostedDeepLinks";

const LEGACY_PWA_RETIREMENT_STORAGE_KEY = "locoris:legacy-pwa-retired:v1";

async function resetLegacyServiceWorkerState() {
  const alreadyRetired =
    typeof window !== "undefined" &&
    window.localStorage.getItem(LEGACY_PWA_RETIREMENT_STORAGE_KEY) === "1";

  if (alreadyRetired) {
    return;
  }

  let foundLegacyPwaState = false;

  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);

    if (registrations.length > 0) {
      foundLegacyPwaState = true;
    }

    await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));
  }

  if ("caches" in window) {
    const cacheKeys = await caches.keys().catch(() => []);

    if (cacheKeys.length > 0) {
      foundLegacyPwaState = true;
    }

    await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey).catch(() => false)));
  }

  if (!foundLegacyPwaState) {
    window.localStorage.setItem(LEGACY_PWA_RETIREMENT_STORAGE_KEY, "1");
    return;
  }

  window.localStorage.setItem(LEGACY_PWA_RETIREMENT_STORAGE_KEY, "1");
  window.location.reload();
  await new Promise(() => undefined);
}

async function bootstrap() {
  await initializePersistentClientStorage();
  const localePreferences = readLocalePreferences();
  await initializeLocaleWithRecovery({
    preferences: localePreferences,
    lastWorkingLocale: readLastWorkingInterfaceLocale(),
    fallbackLocale: resolveSupportedLocale("en"),
    dependencies: {
      preload: preloadLocaleResources,
      initialize: initializeI18n,
      persist: writeLocalePreferences,
      markWorking: writeLastWorkingInterfaceLocale,
      queueFailureNotice: queueLocaleFailureNotice
    }
  });
  switchActiveLocalVaultDatabase(getStoredActiveLocalVaultId());
  await bootstrapDesktopRuntimeState();
  await initializeSelfHostedDeepLinks();
  const localVaultIds = listLocalVaultProfiles().map((vault) => vault.id);
  await sanitizePersistedLocalVaultSecrets(localVaultIds);
  await initializeSecureSyncRegistryState();
  await preloadSecureSecrets(localVaultIds.flatMap((localVaultId) => listAppSettingsSecretKeys(localVaultId)));
  await initializeVaultEncryptionSessions(localVaultIds);
  await resetLegacyServiceWorkerState();
  await initializeDesktopWindowStatePersistence();

  let desktopPersistenceFlush: Promise<void> | null = null;

  const flushDesktopRuntimeState = () => {
    if (!isDesktopRuntime() || desktopPersistenceFlush) {
      return desktopPersistenceFlush;
    }

    const localVaultIds = listLocalVaultProfiles().map((vault) => vault.id);
    desktopPersistenceFlush = flushPendingLocalVaultStorage(localVaultIds).finally(() => {
      desktopPersistenceFlush = null;
    });
    return desktopPersistenceFlush;
  };

  if (isDesktopRuntime()) {
    const scheduleFlush = () => {
      void flushDesktopRuntimeState();
    };

    window.addEventListener("pagehide", scheduleFlush);
    window.addEventListener("beforeunload", scheduleFlush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        scheduleFlush();
      }
    });
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <MantineProvider>
        <LocaleProvider>
          <App />
        </LocaleProvider>
      </MantineProvider>
    </React.StrictMode>
  );
}

void bootstrap();
