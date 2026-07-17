import { invoke } from "@tauri-apps/api/core";

import {
  isDesktopPersistentStorageActive,
  readPersistentString,
  removePersistentString
} from "./persistentClientStorage";
import { isTauriRuntime } from "./runtime";
import type {
  AppSettings,
  SyncConnection,
  SyncVaultBinding
} from "../types";

const secureSecretCache = new Map<string, string>();
const loadedSecureSecretKeys = new Set<string>();
const secureSecretListeners = new Set<() => void>();
// Legacy fallback prefix. It is read once only to migrate existing installations.
const SECURE_SECRET_FALLBACK_PREFIX = "zen-notes.secure-secret-fallback:";
const WEB_SESSION_SECRET_PREFIX = "locoris.web-session-secret:";

export const APP_SETTINGS_SECRET_FIELDS = [
  "selfHostedToken",
  "hostedSessionToken",
  "hostedSyncToken"
] as const satisfies readonly (keyof AppSettings)[];

export const SYNC_CONNECTION_SECRET_FIELDS = [
  "managementToken",
  "sessionToken",
  "refreshToken"
] as const;

export const SYNC_BINDING_SECRET_FIELDS = [
  "syncToken"
] as const satisfies readonly (keyof SyncVaultBinding)[];

export type AppSettingsSecretField = (typeof APP_SETTINGS_SECRET_FIELDS)[number];
export type SyncConnectionSecretField = (typeof SYNC_CONNECTION_SECRET_FIELDS)[number];
export type SyncBindingSecretField = (typeof SYNC_BINDING_SECRET_FIELDS)[number];

function normalizeSecretValue(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function buildSecureSecretFallbackKey(key: string) {
  return `${SECURE_SECRET_FALLBACK_PREFIX}${key.trim()}`;
}

function canUseLegacySecretFallback() {
  if (isTauriRuntime()) {
    return isDesktopPersistentStorageActive();
  }

  if (typeof window === "undefined") {
    return false;
  }

  try {
    return typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

function readLegacySecretFallback(key: string) {
  if (!canUseLegacySecretFallback()) {
    return "";
  }

  return normalizeSecretValue(readPersistentString(buildSecureSecretFallbackKey(key)));
}

function clearLegacySecretFallback(key: string) {
  if (!canUseLegacySecretFallback()) {
    return;
  }

  const storageKey = buildSecureSecretFallbackKey(key);
  removePersistentString(storageKey);
}

function canUseWebSessionSecrets() {
  if (isTauriRuntime() || typeof window === "undefined") {
    return false;
  }

  try {
    return typeof window.sessionStorage !== "undefined";
  } catch {
    return false;
  }
}

function buildWebSessionSecretKey(key: string) {
  return `${WEB_SESSION_SECRET_PREFIX}${key.trim()}`;
}

function readWebSessionSecret(key: string) {
  if (!canUseWebSessionSecrets()) {
    return "";
  }

  try {
    return normalizeSecretValue(window.sessionStorage.getItem(buildWebSessionSecretKey(key)));
  } catch {
    return "";
  }
}

function writeWebSessionSecret(key: string, value: string) {
  if (!canUseWebSessionSecrets()) {
    return;
  }

  try {
    const storageKey = buildWebSessionSecretKey(key);

    if (value) {
      window.sessionStorage.setItem(storageKey, value);
    } else {
      window.sessionStorage.removeItem(storageKey);
    }
  } catch {
    // Keep the runtime cache usable when browser session storage is unavailable.
  }
}

function notifySecureSecretListeners() {
  secureSecretListeners.forEach((listener) => listener());
}

async function readNativeSecureSecret(key: string) {
  if (!isTauriRuntime()) {
    return null;
  }

  return invoke<string | null>("secure_secret_get", {
    key
  });
}

async function writeNativeSecureSecret(key: string, value: string) {
  if (!isTauriRuntime()) {
    return;
  }

  if (!value) {
    await invoke("secure_secret_delete", {
      key
    });
    return;
  }

  await invoke("secure_secret_set", {
    key,
    value
  });
}

async function ensureSecureSecretLoaded(key: string) {
  const normalizedKey = key.trim();

  if (!normalizedKey) {
    return "";
  }

  if (loadedSecureSecretKeys.has(normalizedKey)) {
    return secureSecretCache.get(normalizedKey) ?? "";
  }

  const nativeValue = normalizeSecretValue(await readNativeSecureSecret(normalizedKey));
  const legacyValue = readLegacySecretFallback(normalizedKey);
  const sessionValue = readWebSessionSecret(normalizedKey);
  let resolvedValue = nativeValue || sessionValue;

  if (isTauriRuntime()) {
    if (nativeValue) {
      clearLegacySecretFallback(normalizedKey);
    } else if (legacyValue) {
      // Existing desktop installations used an encrypted platform secret plus a
      // plaintext recovery copy. Move it once, then remove the recovery copy.
      await writeNativeSecureSecret(normalizedKey, legacyValue);
      clearLegacySecretFallback(normalizedKey);
      resolvedValue = legacyValue;
    }
  } else if (!resolvedValue && legacyValue) {
    // Browser sessions deliberately do not persist bearer credentials across
    // restarts. Migrate an old localStorage value into the current tab only.
    writeWebSessionSecret(normalizedKey, legacyValue);
    clearLegacySecretFallback(normalizedKey);
    resolvedValue = legacyValue;
  }

  loadedSecureSecretKeys.add(normalizedKey);

  if (resolvedValue) {
    secureSecretCache.set(normalizedKey, resolvedValue);
  } else {
    secureSecretCache.delete(normalizedKey);
  }

  return resolvedValue;
}

function setCachedSecureSecret(key: string, value: string) {
  const normalizedKey = key.trim();

  if (!normalizedKey) {
    return;
  }

  loadedSecureSecretKeys.add(normalizedKey);

  if (value) {
    secureSecretCache.set(normalizedKey, value);
  } else {
    secureSecretCache.delete(normalizedKey);
  }

  notifySecureSecretListeners();
}

export function subscribeSecureSecretChanges(listener: () => void) {
  secureSecretListeners.add(listener);

  return () => {
    secureSecretListeners.delete(listener);
  };
}

export function readCachedSecureSecret(key: string) {
  return secureSecretCache.get(key.trim()) ?? "";
}

export async function preloadSecureSecrets(keys: readonly string[]) {
  const normalizedKeys = [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
  await Promise.all(normalizedKeys.map((key) => ensureSecureSecretLoaded(key)));
}

export async function readSecureSecret(key: string) {
  return ensureSecureSecretLoaded(key);
}

export async function writeSecureSecret(key: string, value: string) {
  const normalizedKey = key.trim();
  const normalizedValue = normalizeSecretValue(value);

  if (!normalizedKey) {
    return;
  }

  setCachedSecureSecret(normalizedKey, normalizedValue);

  if (!isTauriRuntime()) {
    writeWebSessionSecret(normalizedKey, normalizedValue);
    clearLegacySecretFallback(normalizedKey);
    return;
  }

  await writeNativeSecureSecret(normalizedKey, normalizedValue);
  clearLegacySecretFallback(normalizedKey);
}

export async function deleteSecureSecret(key: string) {
  const normalizedKey = key.trim();

  if (!normalizedKey) {
    return;
  }

  setCachedSecureSecret(normalizedKey, "");

  if (!isTauriRuntime()) {
    writeWebSessionSecret(normalizedKey, "");
    clearLegacySecretFallback(normalizedKey);
    return;
  }

  await writeNativeSecureSecret(normalizedKey, "");
  clearLegacySecretFallback(normalizedKey);
}

export function buildAppSettingsSecretKey(
  localVaultId: string,
  field: AppSettingsSecretField
) {
  return `vault:${localVaultId.trim()}:settings:${field}`;
}

export function buildSyncConnectionSecretKey(
  connectionId: string,
  field: SyncConnectionSecretField
) {
  return `sync-connection:${connectionId.trim()}:${field}`;
}

export function buildSyncBindingSecretKey(
  bindingId: string,
  field: SyncBindingSecretField
) {
  return `sync-binding:${bindingId.trim()}:${field}`;
}

export function buildVaultEncryptionSessionSecretKey(localVaultId: string) {
  return `vault:${localVaultId.trim()}:encryption-session`;
}

export function listAppSettingsSecretKeys(localVaultId: string) {
  return APP_SETTINGS_SECRET_FIELDS.map((field) => buildAppSettingsSecretKey(localVaultId, field));
}

export function listSyncConnectionSecretKeys(connectionId: string) {
  return SYNC_CONNECTION_SECRET_FIELDS.map((field) => buildSyncConnectionSecretKey(connectionId, field));
}

export function listSyncBindingSecretKeys(bindingId: string) {
  return SYNC_BINDING_SECRET_FIELDS.map((field) => buildSyncBindingSecretKey(bindingId, field));
}

export async function hydrateAppSettingsSecrets(
  localVaultId: string,
  settings: AppSettings | null
): Promise<AppSettings | null> {
  if (!settings) {
    return null;
  }

  const [selfHostedToken, hostedSessionToken, hostedSyncToken] = await Promise.all(
    APP_SETTINGS_SECRET_FIELDS.map((field) =>
      readSecureSecret(buildAppSettingsSecretKey(localVaultId, field))
    )
  );

  return {
    ...settings,
    selfHostedToken,
    hostedSessionToken,
    hostedSyncToken
  };
}

export function hydrateCachedSyncConnection(connection: SyncConnection): SyncConnection {
  return {
    ...connection,
    managementToken: readCachedSecureSecret(
      buildSyncConnectionSecretKey(connection.id, "managementToken")
    ),
    sessionToken: readCachedSecureSecret(
      buildSyncConnectionSecretKey(connection.id, "sessionToken")
    ),
    refreshToken: readCachedSecureSecret(
      buildSyncConnectionSecretKey(connection.id, "refreshToken")
    )
  };
}

export function hydrateCachedSyncBinding(binding: SyncVaultBinding): SyncVaultBinding {
  return {
    ...binding,
    syncToken: readCachedSecureSecret(
      buildSyncBindingSecretKey(binding.id, "syncToken")
    )
  };
}

export async function clearAppSettingsSecrets(localVaultId: string) {
  await Promise.all(
    APP_SETTINGS_SECRET_FIELDS.map((field) =>
      deleteSecureSecret(buildAppSettingsSecretKey(localVaultId, field))
    )
  );
}

export async function clearSyncConnectionSecrets(connectionId: string) {
  await Promise.all(
    SYNC_CONNECTION_SECRET_FIELDS.map((field) =>
      deleteSecureSecret(buildSyncConnectionSecretKey(connectionId, field))
    )
  );
}

export async function clearSyncBindingSecrets(bindingId: string) {
  await Promise.all(
    SYNC_BINDING_SECRET_FIELDS.map((field) =>
      deleteSecureSecret(buildSyncBindingSecretKey(bindingId, field))
    )
  );
}
