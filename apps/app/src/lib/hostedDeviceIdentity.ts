import { readPersistentString, writePersistentString } from "./persistentClientStorage";
import { isWebRuntime } from "./runtime";

const HOSTED_DEVICE_ID_STORAGE_KEY = "zen-notes.hosted-account-device-id";

function normalizeDeviceId(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9:._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function getHostedDevicePlatform() {
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
  let platform = "Locoris app";

  if (/android/i.test(userAgent)) {
    platform = "Android";
  } else if (/iphone|ipad|ipod/i.test(userAgent)) {
    platform = "iOS";
  } else if (/macintosh|mac os x/i.test(userAgent)) {
    platform = "macOS";
  } else if (/windows/i.test(userAgent)) {
    platform = "Windows";
  } else if (/linux/i.test(userAgent)) {
    platform = "Linux";
  }

  return isWebRuntime() ? `Web · ${platform}` : platform;
}

export function adoptHostedDeviceId(value: string | null | undefined) {
  const deviceId = normalizeDeviceId(value);

  if (deviceId) {
    writePersistentString(HOSTED_DEVICE_ID_STORAGE_KEY, deviceId);
  }

  return deviceId;
}

export function getHostedDeviceId(legacyVaultDeviceId?: string | null) {
  const storedDeviceId = normalizeDeviceId(readPersistentString(HOSTED_DEVICE_ID_STORAGE_KEY));

  if (storedDeviceId) {
    return storedDeviceId;
  }

  const deviceId =
    normalizeDeviceId(legacyVaultDeviceId) || `device-${crypto.randomUUID()}`;

  writePersistentString(HOSTED_DEVICE_ID_STORAGE_KEY, deviceId);
  return deviceId;
}

export function getHostedDeviceIdentity(legacyVaultDeviceId?: string | null) {
  const deviceId = getHostedDeviceId(legacyVaultDeviceId);
  const clientPlatform = getHostedDevicePlatform();
  const shortDeviceId = deviceId.replace(/^device-/, "").slice(0, 6);

  return {
    deviceId,
    deviceName: `${clientPlatform} · ${shortDeviceId || "device"}`,
    clientPlatform
  };
}
