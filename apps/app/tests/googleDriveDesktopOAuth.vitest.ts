import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizationUrl: "",
  invoke: vi.fn(),
  openUrl: vi.fn(),
  setFocus: vi.fn(),
  show: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setFocus: mocks.setFocus,
    show: mocks.show
  })
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: mocks.openUrl
}));

vi.mock("../src/lib/runtime", () => ({
  isDesktopRuntime: () => true
}));

import { connectGoogleDriveDesktopAccount } from "../src/lib/googleDriveDesktopOAuth";

beforeEach(() => {
  mocks.authorizationUrl = "";
  vi.stubEnv("VITE_GOOGLE_DRIVE_DESKTOP_CLIENT_SECRET", "desktop-client-secret");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      json: async () => ({
        user: {
          displayName: "Locoris Test",
          emailAddress: "test@example.com",
          permissionId: "permission-id"
        }
      }),
      ok: true,
      status: 200
    }))
  );

  mocks.openUrl.mockImplementation(async (url: string) => {
    mocks.authorizationUrl = url;
  });
  mocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
    if (command === "desktop_google_oauth_prepare_loopback") {
      return { redirectUri: "http://localhost:43123" };
    }

    if (command === "desktop_google_oauth_wait_for_callback") {
      const state = new URL(mocks.authorizationUrl).searchParams.get("state");
      return { url: `http://localhost:43123/?state=${state}&code=authorization-code` };
    }

    if (command === "desktop_google_oauth_exchange_code") {
      return {
        access_token: "access-token",
        expires_in: 3600,
        refresh_token: "refresh-token",
        args
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  });
});

describe("desktop Google OAuth", () => {
  test("passes the configured Desktop app companion secret to the token exchange", async () => {
    await connectGoogleDriveDesktopAccount({
      clientId: "desktop-client-id.apps.googleusercontent.com"
    });

    expect(mocks.invoke).toHaveBeenCalledWith("desktop_google_oauth_exchange_code", {
      input: expect.objectContaining({
        clientId: "desktop-client-id.apps.googleusercontent.com",
        clientSecret: "desktop-client-secret"
      })
    });
  });
});
