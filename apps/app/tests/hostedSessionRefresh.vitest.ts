import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncConnection } from "../src/types";

const { refreshHostedAccountSession } = vi.hoisted(() => ({
  refreshHostedAccountSession: vi.fn()
}));

vi.mock("../src/lib/sync", () => ({
  refreshHostedAccountSession
}));

import { refreshHostedSessionSingleFlight } from "../src/lib/hostedSessionRefresh";

function createHostedConnection(): SyncConnection {
  return {
    id: "hosted-connection",
    provider: "hosted",
    role: "locorisCloud",
    label: "Locoris Cloud",
    serverUrl: "https://cloud.locoris.test",
    managementToken: "",
    sessionToken: "access-token",
    refreshToken: "refresh-token",
    tokenExpiresAt: Date.now() - 1,
    userId: "user-1",
    userName: "User",
    userEmail: "user@example.test",
    changePageToken: null,
    selfHostedDeviceId: null,
    selfHostedRole: null,
    selfHostedServerId: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

describe("hosted session refresh", () => {
  beforeEach(() => {
    refreshHostedAccountSession.mockReset();
  });

  it("keeps the refresh token's server-side device binding across vault switches", async () => {
    refreshHostedAccountSession.mockResolvedValue({
      user: {
        id: "user-1",
        name: "User",
        email: "user@example.test",
        role: "member",
        createdAt: 1,
        updatedAt: 1,
        lastLoginAt: 1,
        hasPassword: true
      },
      session: {
        id: "session-2",
        token: "access-token-2",
        refreshToken: "refresh-token-2",
        deviceId: "device-original-vault",
        createdAt: 2,
        expiresAt: 3
      }
    });

    await refreshHostedSessionSingleFlight(createHostedConnection(), {
      deviceId: "device-new-active-vault",
      deviceName: "Web · macOS",
      clientPlatform: "Web · macOS"
    });

    expect(refreshHostedAccountSession).toHaveBeenCalledWith(
      "https://cloud.locoris.test",
      {
        refreshToken: "refresh-token",
        deviceName: "Web · macOS",
        clientPlatform: "Web · macOS"
      }
    );
  });
});
