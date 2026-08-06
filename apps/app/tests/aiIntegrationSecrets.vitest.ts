import { beforeEach, describe, expect, it } from "vitest";

import {
  deleteGeminiApiKey,
  GEMINI_API_KEY_BROWSER_STORAGE_KEY,
  readGeminiApiKey,
  writeGeminiApiKey
} from "../src/lib/aiIntegration";

const WEB_SESSION_STORAGE_KEY = "locoris.web-session-secret:ai:gemini:api-key";

describe("Gemini API key storage", () => {
  beforeEach(async () => {
    await deleteGeminiApiKey();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("migrates a legacy persistent browser key into the current session", async () => {
    window.localStorage.setItem(GEMINI_API_KEY_BROWSER_STORAGE_KEY, "legacy-key");

    await expect(readGeminiApiKey()).resolves.toBe("legacy-key");
    expect(window.localStorage.getItem(GEMINI_API_KEY_BROWSER_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(WEB_SESSION_STORAGE_KEY)).toBe("legacy-key");
  });

  it("keeps newly saved browser keys out of persistent storage", async () => {
    await writeGeminiApiKey("session-key");

    await expect(readGeminiApiKey()).resolves.toBe("session-key");
    expect(window.localStorage.getItem(GEMINI_API_KEY_BROWSER_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(WEB_SESSION_STORAGE_KEY)).toBe("session-key");
  });

  it("removes both current and legacy copies", async () => {
    await writeGeminiApiKey("session-key");
    window.localStorage.setItem(GEMINI_API_KEY_BROWSER_STORAGE_KEY, "legacy-key");

    await deleteGeminiApiKey();

    await expect(readGeminiApiKey()).resolves.toBe("");
    expect(window.localStorage.getItem(GEMINI_API_KEY_BROWSER_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(WEB_SESSION_STORAGE_KEY)).toBeNull();
  });
});
