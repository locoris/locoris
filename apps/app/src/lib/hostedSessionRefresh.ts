import type { HostedAccountSession, HostedAccountUser, SyncConnection } from "../types";
import { adoptHostedDeviceId } from "./hostedDeviceIdentity";
import { refreshHostedAccountSession } from "./sync";

export const HOSTED_SESSION_REFRESH_SKEW_MS = 1000 * 60 * 2;

type HostedSessionRefreshResult = {
  user: HostedAccountUser;
  session: HostedAccountSession;
};

type HostedDeviceIdentity = {
  deviceId?: string | null;
  deviceName?: string | null;
  clientPlatform?: string | null;
};

const refreshesInFlight = new Map<string, Promise<HostedSessionRefreshResult>>();

export function shouldRefreshHostedSession(connection: SyncConnection, timestamp = Date.now()) {
  return (
    connection.provider === "hosted" &&
    Boolean(connection.refreshToken?.trim()) &&
    Boolean(connection.tokenExpiresAt) &&
    Number(connection.tokenExpiresAt) <= timestamp + HOSTED_SESSION_REFRESH_SKEW_MS
  );
}

export function refreshHostedSessionSingleFlight(
  connection: SyncConnection,
  device: HostedDeviceIdentity
) {
  const refreshToken = connection.refreshToken?.trim() ?? "";

  if (connection.provider !== "hosted" || !refreshToken) {
    return Promise.reject(new Error("CLOUD_REAUTH_REQUIRED"));
  }

  const existing = refreshesInFlight.get(connection.id);

  if (existing) {
    return existing;
  }

  // The refresh token already carries its server-side device binding. Do not
  // replace it with the active vault's legacy device id: vault switches must
  // never invalidate the account session.
  const pending = refreshHostedAccountSession(connection.serverUrl, {
    refreshToken,
    deviceName: device.deviceName,
    clientPlatform: device.clientPlatform
  })
    .then((result) => {
      adoptHostedDeviceId(result.session.deviceId);
      return result;
    })
    .finally(() => {
      if (refreshesInFlight.get(connection.id) === pending) {
        refreshesInFlight.delete(connection.id);
      }
    });

  refreshesInFlight.set(connection.id, pending);
  return pending;
}
