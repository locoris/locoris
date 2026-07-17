import { beforeEach, describe, expect, test, vi } from "vitest";

const LOCAL_VAULT_REGISTRY_KEY = "zen-notes.local-vaults";

beforeEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

describe("database bootstrap", () => {
  test("does not read or create the vault registry during module evaluation", async () => {
    await import("../src/data/db");

    expect(window.localStorage.getItem(LOCAL_VAULT_REGISTRY_KEY)).toBeNull();
  });
});
