const BUILT_IN_LOCORIS_CLOUD_URL = "https://locoris-api.duckdns.org";

function normalizeCloudUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export function getLocorisCloudUrl() {
  const configuredUrl = import.meta.env.VITE_LOCORIS_CLOUD_URL?.trim();

  if (configuredUrl) {
    return normalizeCloudUrl(configuredUrl);
  }

  if (import.meta.env.DEV) {
    return "http://localhost:8787";
  }

  return BUILT_IN_LOCORIS_CLOUD_URL;
}

export function resolveLocorisCloudUrl() {
  return getLocorisCloudUrl();
}

export function buildLocorisCloudAccountUrl(serverUrl: string, view?: "overview" | "vaults" | "devices" | "billing") {
  const configuredAccountUrl = import.meta.env.VITE_LOCORIS_ACCOUNT_URL?.trim();
  if (!serverUrl && !configuredAccountUrl) return null;
  try {
    const url = configuredAccountUrl ? new URL(configuredAccountUrl) : new URL("/account", `${serverUrl.replace(/\/+$/, "")}/`);
    if (view) url.searchParams.set("view", view);
    return url.toString();
  } catch { return null; }
}
