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
