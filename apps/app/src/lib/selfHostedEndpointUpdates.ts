export type PendingSelfHostedEndpointUpdate = {
  serverId: string;
  serverUrl: string;
};

const STORAGE_KEY = "locoris.self-hosted-endpoint-update.pending";
export const SELF_HOSTED_ENDPOINT_UPDATE_EVENT = "locoris:self-hosted-endpoint-update";

export function normalizeSelfHostedServerUrl(value: string) {
  const url = new URL(value.trim());
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("PAIRING_SERVER_URL_INVALID");
  }

  return url.toString().replace(/\/+$/, "");
}

function normalizeEndpointUpdate(value: PendingSelfHostedEndpointUpdate) {
  const serverId = value.serverId.trim();
  if (!serverId) {
    throw new Error("SELF_HOSTED_SERVER_ID_REQUIRED");
  }

  return {
    serverId,
    serverUrl: normalizeSelfHostedServerUrl(value.serverUrl)
  } satisfies PendingSelfHostedEndpointUpdate;
}

export function queueSelfHostedEndpointUpdate(value: PendingSelfHostedEndpointUpdate) {
  const normalized = normalizeEndpointUpdate(value);
  if (typeof window === "undefined") {
    return normalized;
  }

  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // The event still delivers the update to the open application session.
  }

  window.dispatchEvent(
    new CustomEvent(SELF_HOSTED_ENDPOINT_UPDATE_EVENT, {
      detail: normalized
    })
  );
  return normalized;
}

export function consumeSelfHostedEndpointUpdate() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeEndpointUpdate(JSON.parse(raw) as PendingSelfHostedEndpointUpdate);
  } catch {
    return null;
  }
}

export function hasPendingSelfHostedEndpointUpdate() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return Boolean(window.sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}
