import assert from "node:assert/strict";
import test from "node:test";

import {
  SERVER_CONTRACT,
  SERVER_VERSION,
  STORAGE_SCHEMA_VERSION
} from "../server-contract.mjs";
import { compareVersions, createServerUpdateService, selectLatestServerRelease } from "../server-update.mjs";
import compatibility from "../../../docs/self-hosting/compatibility.json" with { type: "json" };

test("server contract exposes stable positive protocol versions", () => {
  assert.equal(SERVER_CONTRACT.serverVersion, SERVER_VERSION);
  assert.equal(STORAGE_SCHEMA_VERSION, 2);
  for (const key of ["apiVersion", "syncProtocolVersion", "pairingProtocolVersion", "storageSchemaVersion"]) {
    assert.ok(Number.isInteger(SERVER_CONTRACT[key]));
    assert.ok(SERVER_CONTRACT[key] > 0);
  }
});

test("published compatibility matrix matches the runtime contract", () => {
  assert.equal(compatibility.serverVersion, SERVER_CONTRACT.serverVersion);
  assert.equal(compatibility.apiVersion, SERVER_CONTRACT.apiVersion);
  assert.equal(compatibility.syncProtocolVersion, SERVER_CONTRACT.syncProtocolVersion);
  assert.equal(compatibility.pairingProtocolVersion, SERVER_CONTRACT.pairingProtocolVersion);
  assert.equal(compatibility.storageSchemaVersion, SERVER_CONTRACT.storageSchemaVersion);
  assert.equal(compatibility.minimumClientVersion, SERVER_CONTRACT.minimumClientVersion);
});

test("server release selection ignores drafts, prereleases and untrusted URLs", () => {
  const latest = selectLatestServerRelease([
    { tag_name: "server-v0.1.5", html_url: "https://github.com/locoris/locoris/releases/tag/server-v0.1.5" },
    { tag_name: "server-v0.2.0", html_url: "https://example.com/server-v0.2.0" },
    { tag_name: "server-v0.1.7", html_url: "https://github.com/locoris/locoris/releases/tag/server-v0.1.7", prerelease: true },
    { tag_name: "app-v9.0.0", html_url: "https://github.com/locoris/locoris/releases/tag/app-v9.0.0" }
  ], "0.1.4");
  assert.equal(latest?.version, "0.1.5");
  assert.equal(compareVersions("0.2.0", "0.1.99"), 1);
});

test("server update service caches a successful check", async () => {
  let requests = 0;
  const service = createServerUpdateService({
    currentVersion: "0.1.4",
    now: () => 1_800_000_000_000,
    fetchImpl: async () => {
      requests += 1;
      return new Response(JSON.stringify([{
        tag_name: "server-v0.1.5",
        html_url: "https://github.com/locoris/locoris/releases/tag/server-v0.1.5",
        published_at: "2026-08-09T00:00:00Z"
      }]), { status: 200 });
    }
  });
  assert.equal((await service.check()).status, "available");
  assert.equal((await service.check()).latestVersion, "0.1.5");
  assert.equal(requests, 1);
});
