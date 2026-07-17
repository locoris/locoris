export type SelfHostedConnectionPackage = {
  version: 1;
  serverUrl: string;
  secret: string;
  code: string;
  serverId: string | null;
};

export type PendingSelfHostedPairing = {
  serverUrl: string;
  serverId: string;
  deviceSecret: string;
  claimSecret: string;
  requestId: string;
  confirmationCode: string;
  startedAt: number;
};

const CONNECTION_PACKAGE_PREFIX = "lcrs1_";
const PENDING_PAIRING_STORAGE_KEY = "locoris.self-hosted-pairing.pending";
const INCOMING_PACKAGE_STORAGE_KEY = "locoris.self-hosted-pairing.incoming";
export const SELF_HOSTED_INVITE_EVENT = "locoris:self-hosted-invite";

function normalizeServerUrl(value: string) {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("PAIRING_SERVER_URL_INVALID");
  }
  if (url.username || url.password) {
    throw new Error("PAIRING_SERVER_URL_INVALID");
  }
  return url.toString().replace(/\/+$/, "");
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return decodeURIComponent(
    Array.from(atob(padded), (character) =>
      `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`
    ).join("")
  );
}

function extractConnectionPackage(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith(CONNECTION_PACKAGE_PREFIX)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    const payload = hash.get("lcrs") ?? url.searchParams.get("payload") ?? url.searchParams.get("lcrs");
    return payload?.trim() ?? "";
  } catch {
    return "";
  }
}

export function parseSelfHostedConnectionPackage(value: string): SelfHostedConnectionPackage {
  const connectionPackage = extractConnectionPackage(value);
  if (!connectionPackage.startsWith(CONNECTION_PACKAGE_PREFIX)) {
    throw new Error("PAIRING_PACKAGE_INVALID");
  }

  try {
    const parsed = JSON.parse(
      decodeBase64Url(connectionPackage.slice(CONNECTION_PACKAGE_PREFIX.length))
    ) as Record<string, unknown>;
    if (parsed.v !== 1) {
      throw new Error("PAIRING_PACKAGE_VERSION_UNSUPPORTED");
    }

    const secret = typeof parsed.secret === "string" ? parsed.secret.trim() : "";
    const code = typeof parsed.code === "string" ? parsed.code.trim() : "";
    if (!secret && !code) {
      throw new Error("PAIRING_PACKAGE_INVALID");
    }

    return {
      version: 1,
      serverUrl: normalizeServerUrl(String(parsed.serverUrl ?? "")),
      secret,
      code,
      serverId: typeof parsed.serverId === "string" && parsed.serverId.trim() ? parsed.serverId.trim() : null
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PAIRING_")) {
      throw error;
    }
    throw new Error("PAIRING_PACKAGE_INVALID");
  }
}

export function normalizeSelfHostedPairingCode(value: string) {
  const compact = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return compact.length > 4 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
}

function createRandomSecret(prefix: "zpd" | "zpc") {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${prefix}_${encoded}`;
}

export function createSelfHostedDeviceSecret() {
  return createRandomSecret("zpd");
}

export function createSelfHostedClaimSecret() {
  return createRandomSecret("zpc");
}

export function readPendingSelfHostedPairing(): PendingSelfHostedPairing | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(PENDING_PAIRING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingSelfHostedPairing;
    if (
      !parsed.serverUrl ||
      !parsed.serverId ||
      !parsed.deviceSecret.startsWith("zpd_") ||
      !parsed.claimSecret.startsWith("zpc_") ||
      !parsed.requestId ||
      Date.now() - parsed.startedAt > 24 * 60 * 60 * 1000
    ) {
      window.sessionStorage.removeItem(PENDING_PAIRING_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writePendingSelfHostedPairing(value: PendingSelfHostedPairing) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PENDING_PAIRING_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Pairing still works in the current view if session storage is unavailable.
  }
}

export function clearPendingSelfHostedPairing() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PENDING_PAIRING_STORAGE_KEY);
  } catch {
    // Ignore storage restrictions.
  }
}

export function queueIncomingSelfHostedConnectionPackage(value: string) {
  const parsed = parseSelfHostedConnectionPackage(value);
  const connectionPackage = extractConnectionPackage(value);
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(INCOMING_PACKAGE_STORAGE_KEY, connectionPackage);
    window.dispatchEvent(
      new CustomEvent(SELF_HOSTED_INVITE_EVENT, {
        detail: { connectionPackage, serverUrl: parsed.serverUrl }
      })
    );
  }
  return connectionPackage;
}

export function consumeIncomingSelfHostedConnectionPackage() {
  if (typeof window === "undefined") return "";
  try {
    const value = window.sessionStorage.getItem(INCOMING_PACKAGE_STORAGE_KEY) ?? "";
    window.sessionStorage.removeItem(INCOMING_PACKAGE_STORAGE_KEY);
    return value;
  } catch {
    return "";
  }
}

export function hasIncomingSelfHostedConnectionPackage() {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(window.sessionStorage.getItem(INCOMING_PACKAGE_STORAGE_KEY));
  } catch {
    return false;
  }
}
