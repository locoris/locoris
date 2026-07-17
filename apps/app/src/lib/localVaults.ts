import Dexie from "dexie";
import type { SyncVaultBinding } from "../types";
import { detectSystemLocale } from "../localization";
import { translateApp } from "../localization/translateInline";
import {
  readPersistentString,
  writePersistentString
} from "./persistentClientStorage";
import { deleteDesktopVaultBackup } from "./desktopVaultBackups";
import { deleteNativeVaultSnapshot } from "./nativeVaultStore";
import {
  buildVaultEncryptionSessionSecretKey,
  clearAppSettingsSecrets,
  deleteSecureSecret
} from "./secureSecretStore";

export type LocalVaultKind = "regular" | "private";

export interface LocalVaultProfile {
  id: string;
  vaultGuid: string;
  name: string;
  vaultKind: LocalVaultKind;
  createdAt: number;
  updatedAt: number;
}

interface LocalVaultRegistryState {
  activeVaultId: string;
  vaults: LocalVaultProfile[];
}

// Legacy storage key. Rename only with a migration that preserves existing vault discovery.
const REGISTRY_STORAGE_KEY = "zen-notes.local-vaults";
export const DEFAULT_LOCAL_VAULT_ID = "local-default";

function now() {
  return Date.now();
}

function sanitizeLocalVaultName(value: string) {
  return value.trim().slice(0, 80);
}

function sanitizeVaultGuid(value: string) {
  return value.trim().slice(0, 120);
}

function sanitizeVaultKind(value: unknown): LocalVaultKind {
  return value === "private" ? "private" : "regular";
}

function createVaultGuid() {
  return crypto.randomUUID();
}

function getDefaultLocalVaultName() {
  return translateApp(detectSystemLocale(), "app.demoVaultName");
}

function createDefaultVaultProfile(): LocalVaultProfile {
  const timestamp = now();

  return {
    id: DEFAULT_LOCAL_VAULT_ID,
    vaultGuid: createVaultGuid(),
    name: getDefaultLocalVaultName(),
    vaultKind: "regular",
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function getFallbackRegistry(): LocalVaultRegistryState {
  const defaultVault = createDefaultVaultProfile();

  return {
    activeVaultId: defaultVault.id,
    vaults: [defaultVault]
  };
}

function normalizeRegistryState(value: unknown): LocalVaultRegistryState {
  if (!value || typeof value !== "object") {
    return getFallbackRegistry();
  }

  const record = value as Record<string, unknown>;
  const vaults = Array.isArray(record.vaults)
    ? record.vaults
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }

          const vault = entry as Record<string, unknown>;
          const id = typeof vault.id === "string" ? vault.id : "";
          const storedName = typeof vault.name === "string" ? sanitizeLocalVaultName(vault.name) : "";
          const name = storedName || (id === DEFAULT_LOCAL_VAULT_ID ? getDefaultLocalVaultName() : "");
          const vaultGuid =
            typeof vault.vaultGuid === "string" ? sanitizeVaultGuid(vault.vaultGuid) : createVaultGuid();

          if (!id || !vaultGuid) {
            return null;
          }

          return {
            id,
            vaultGuid,
            name,
            vaultKind: sanitizeVaultKind(vault.vaultKind),
            createdAt: typeof vault.createdAt === "number" ? vault.createdAt : now(),
            updatedAt: typeof vault.updatedAt === "number" ? vault.updatedAt : now()
          } satisfies LocalVaultProfile;
        })
        .filter(Boolean) as LocalVaultProfile[]
    : [];

  if (vaults.length === 0) {
    return getFallbackRegistry();
  }

  const activeVaultId =
    typeof record.activeVaultId === "string" && vaults.some((vault) => vault.id === record.activeVaultId)
      ? record.activeVaultId
      : vaults[0].id;

  return {
    activeVaultId,
    vaults
  };
}

function readRegistryFromStorage() {
  const raw = readPersistentString(REGISTRY_STORAGE_KEY);

  if (!raw) {
    const fallback = getFallbackRegistry();
    writePersistentString(REGISTRY_STORAGE_KEY, JSON.stringify(fallback));
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw);
    const normalized = normalizeRegistryState(parsed);
    writePersistentString(REGISTRY_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    const fallback = getFallbackRegistry();
    writePersistentString(REGISTRY_STORAGE_KEY, JSON.stringify(fallback));
    return fallback;
  }
}

function writeRegistryToStorage(state: LocalVaultRegistryState) {
  writePersistentString(REGISTRY_STORAGE_KEY, JSON.stringify(state));
  return state;
}

function buildRegistryState(vaults: LocalVaultProfile[], activeVaultId: string): LocalVaultRegistryState {
  const nextVaults = vaults.length > 0 ? vaults : [createDefaultVaultProfile()];
  const nextActiveVaultId = nextVaults.some((vault) => vault.id === activeVaultId)
    ? activeVaultId
    : nextVaults[0].id;

  return {
    activeVaultId: nextActiveVaultId,
    vaults: nextVaults.sort((left, right) => left.createdAt - right.createdAt)
  };
}

export function buildLocalVaultDatabaseName(localVaultId: string) {
  // Legacy IndexedDB prefix. Existing local vault databases depend on this name.
  return `zen-notes-db-${localVaultId}`;
}

export function getLocalVaultRegistry() {
  return readRegistryFromStorage();
}

export function listLocalVaultProfiles() {
  return getLocalVaultRegistry().vaults;
}

export function getStoredActiveLocalVaultId() {
  return getLocalVaultRegistry().activeVaultId;
}

export function setStoredActiveLocalVaultId(localVaultId: string) {
  const registry = getLocalVaultRegistry();
  const nextState = buildRegistryState(registry.vaults, localVaultId);
  writeRegistryToStorage(nextState);
  return nextState.activeVaultId;
}

export function getLocalVaultProfile(localVaultId: string) {
  return getLocalVaultRegistry().vaults.find((vault) => vault.id === localVaultId) ?? null;
}

export function getLocalVaultProfileByGuid(vaultGuid: string) {
  const normalizedGuid = sanitizeVaultGuid(vaultGuid);

  if (!normalizedGuid) {
    return null;
  }

  return getLocalVaultRegistry().vaults.find((vault) => vault.vaultGuid === normalizedGuid) ?? null;
}

export function resolveUniqueLocalVaultName(name: string, excludeLocalVaultId?: string) {
  const normalizedName = sanitizeLocalVaultName(name);

  if (!normalizedName) {
    throw new Error("LOCAL_VAULT_NAME_REQUIRED");
  }

  const registry = getLocalVaultRegistry();
  const takenNames = new Set(
    registry.vaults
      .filter((vault) => vault.id !== excludeLocalVaultId)
      .map((vault) => vault.name.trim().toLowerCase())
  );

  if (!takenNames.has(normalizedName.toLowerCase())) {
    return normalizedName;
  }

  let index = 2;

  while (true) {
    const candidate = `${normalizedName} (${index})`;

    if (!takenNames.has(candidate.toLowerCase())) {
      return candidate;
    }

    index += 1;
  }
}

export function createLocalVaultProfile(
  name: string,
  options?: {
    activate?: boolean;
    localVaultId?: string;
    vaultGuid?: string;
    vaultKind?: LocalVaultKind;
  }
) {
  const registry = getLocalVaultRegistry();
  const normalizedName = sanitizeLocalVaultName(name);
  const localVaultId = sanitizeVaultGuid(options?.localVaultId ?? "") || crypto.randomUUID();
  const vaultGuid = sanitizeVaultGuid(options?.vaultGuid ?? "") || createVaultGuid();

  if (!normalizedName) {
    throw new Error("LOCAL_VAULT_NAME_REQUIRED");
  }

  if (registry.vaults.some((vault) => vault.id === localVaultId)) {
    throw new Error("LOCAL_VAULT_ID_EXISTS");
  }

  if (registry.vaults.some((vault) => vault.vaultGuid === vaultGuid)) {
    throw new Error("LOCAL_VAULT_GUID_EXISTS");
  }

  const timestamp = now();
  const nextVault: LocalVaultProfile = {
    id: localVaultId,
    vaultGuid,
    name: normalizedName,
    vaultKind: options?.vaultKind ?? "regular",
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const nextState = buildRegistryState(
    [...registry.vaults, nextVault],
    options?.activate === false ? registry.activeVaultId : nextVault.id
  );
  writeRegistryToStorage(nextState);
  return nextVault;
}

export function renameLocalVaultProfile(localVaultId: string, name: string) {
  const registry = getLocalVaultRegistry();
  const normalizedName = sanitizeLocalVaultName(name);

  const nextVaults = registry.vaults.map((vault) =>
    vault.id === localVaultId
      ? {
          ...vault,
          name: normalizedName,
          updatedAt: now()
        }
      : vault
  );
  const nextState = buildRegistryState(nextVaults, registry.activeVaultId);
  writeRegistryToStorage(nextState);
  return nextState.vaults.find((vault) => vault.id === localVaultId) ?? null;
}

export function updateLocalVaultProfile(
  localVaultId: string,
  patch: Partial<Pick<LocalVaultProfile, "name" | "vaultGuid" | "vaultKind">>
) {
  const registry = getLocalVaultRegistry();
  const normalizedName =
    typeof patch.name === "string" ? sanitizeLocalVaultName(patch.name) : null;
  const normalizedVaultGuid =
    typeof patch.vaultGuid === "string" ? sanitizeVaultGuid(patch.vaultGuid) : null;
  const normalizedVaultKind =
    patch.vaultKind === undefined ? null : sanitizeVaultKind(patch.vaultKind);

  if (
    normalizedVaultGuid &&
    registry.vaults.some((vault) => vault.id !== localVaultId && vault.vaultGuid === normalizedVaultGuid)
  ) {
    throw new Error("LOCAL_VAULT_GUID_EXISTS");
  }

  const timestamp = now();
  const nextVaults = registry.vaults.map((vault) =>
    vault.id === localVaultId
      ? {
          ...vault,
          name: normalizedName ?? vault.name,
          vaultGuid: normalizedVaultGuid ?? vault.vaultGuid,
          vaultKind: normalizedVaultKind ?? vault.vaultKind,
          updatedAt: timestamp
        }
      : vault
  );
  const nextState = buildRegistryState(nextVaults, registry.activeVaultId);
  writeRegistryToStorage(nextState);
  return nextState.vaults.find((vault) => vault.id === localVaultId) ?? null;
}

export function syncLocalVaultGuidsWithBindings(bindings: readonly Pick<SyncVaultBinding, "localVaultId" | "remoteVaultId">[]) {
  const registry = getLocalVaultRegistry();
  const remoteVaultIdByLocalVaultId = new Map(
    bindings.map((binding) => [binding.localVaultId, sanitizeVaultGuid(binding.remoteVaultId)])
  );
  let changed = false;

  const nextVaults = registry.vaults.map((vault) => {
    const remoteVaultId = remoteVaultIdByLocalVaultId.get(vault.id) ?? null;

    if (!remoteVaultId || remoteVaultId === vault.vaultGuid) {
      return vault;
    }

    changed = true;

    return {
      ...vault,
      vaultGuid: remoteVaultId,
      updatedAt: now()
    };
  });

  if (!changed) {
    return registry.vaults;
  }

  const nextState = buildRegistryState(nextVaults, registry.activeVaultId);
  writeRegistryToStorage(nextState);
  return nextState.vaults;
}

export function getNextLocalVaultAfterDelete(localVaultId: string) {
  const registry = getLocalVaultRegistry();
  const remainingVaults = registry.vaults.filter((vault) => vault.id !== localVaultId);

  if (remainingVaults.length === 0) {
    throw new Error("LOCAL_VAULT_LAST");
  }

  if (registry.activeVaultId !== localVaultId) {
    return registry.activeVaultId;
  }

  return remainingVaults[0].id;
}

export function removeLocalVaultProfile(localVaultId: string) {
  const registry = getLocalVaultRegistry();
  const remainingVaults = registry.vaults.filter((vault) => vault.id !== localVaultId);

  if (remainingVaults.length === 0) {
    throw new Error("LOCAL_VAULT_LAST");
  }

  const nextActiveVaultId =
    registry.activeVaultId === localVaultId ? remainingVaults[0].id : registry.activeVaultId;
  const nextState = buildRegistryState(remainingVaults, nextActiveVaultId);
  writeRegistryToStorage(nextState);

  return nextState;
}

export async function deleteLocalVaultDatabase(localVaultId: string) {
  await clearAppSettingsSecrets(localVaultId);
  await deleteSecureSecret(buildVaultEncryptionSessionSecretKey(localVaultId));
  await Dexie.delete(buildLocalVaultDatabaseName(localVaultId));
  await deleteNativeVaultSnapshot(localVaultId);
  await deleteDesktopVaultBackup(localVaultId);
}
