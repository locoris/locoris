import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createEmptySnapshot } from "../../../packages/sync-core/common.mjs";

const SERVER_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../server.mjs");

async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before health check with code ${child.exitCode}`);
    }

    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return response.json();
      }
    } catch {
      // The process may still be binding its socket.
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("Timed out waiting for personal server health check");
}

async function startServer(dataDir, managementToken) {
  const port = await reservePort();
  const child = spawn(process.execPath, [SERVER_FILE], {
    env: {
      ...process.env,
      PORT: String(port),
      SYNC_DATA_DIR: dataDir,
      SYNC_MANAGEMENT_TOKEN: managementToken
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await waitForHealth(baseUrl, child);
  } catch (error) {
    child.kill("SIGKILL");
    throw new Error(`${error.message}\n${output.join("")}`);
  }

  return { child, baseUrl, output };
}

async function stopServer(running) {
  if (running.child.exitCode !== null) {
    return;
  }

  running.child.kill("SIGTERM");
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      running.child.kill("SIGKILL");
      reject(new Error(`Server did not stop cleanly\n${running.output.join("")}`));
    }, 5_000);
    running.child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function waitForOutput(running, pattern) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const output = running.output.join("");
    const match = output.match(pattern);
    if (match) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for server output matching ${pattern}\n${running.output.join("")}`);
}

async function crashServer(running) {
  if (running.child.exitCode !== null) {
    return;
  }

  running.child.kill("SIGKILL");
  await new Promise((resolve) => running.child.once("exit", resolve));
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  return { response, body: await response.json() };
}

function bearer(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}

test("server keeps vault tokens and state across an abrupt restart", async (context) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "locoris-personal-server-"));
  const managementToken = "restart-management-token";
  let running = await startServer(dataDir, managementToken);
  context.after(async () => {
    await stopServer(running).catch(() => undefined);
    await rm(dataDir, { recursive: true, force: true });
  });

  const health = await requestJson(`${running.baseUrl}/health`);
  assert.equal(health.body.storage.backend, "sqlite-files");
  assert.equal(health.body.storage.journalMode, "wal");

  const created = await requestJson(`${running.baseUrl}/v1/personal/vaults`, {
    method: "POST",
    headers: bearer(managementToken),
    body: JSON.stringify({ id: "restart-vault", name: "Restart vault" })
  });
  assert.equal(created.response.status, 201);

  const issued = await requestJson(`${running.baseUrl}/v1/personal/vaults/restart-vault/tokens`, {
    method: "POST",
    headers: bearer(managementToken),
    body: JSON.stringify({ label: "Test device" })
  });
  assert.equal(issued.response.status, 201);
  const vaultToken = issued.body.token;

  const initialSnapshot = {
    ...createEmptySnapshot(),
    deviceId: "server-test",
    exportedAt: Date.now(),
    projects: [{ id: "project-1", name: "Persisted project", updatedAt: Date.now() }]
  };
  const saved = await requestJson(`${running.baseUrl}/v1/vaults/restart-vault/state`, {
    method: "PUT",
    headers: bearer(vaultToken),
    body: JSON.stringify({ baseRevision: null, snapshot: initialSnapshot })
  });
  assert.equal(saved.response.status, 200);
  assert.match(saved.body.revision, /^rev-/);

  const concurrentWrites = await Promise.all(
    ["Device A", "Device B"].map((name) =>
      requestJson(`${running.baseUrl}/v1/vaults/restart-vault/state`, {
        method: "PUT",
        headers: bearer(vaultToken),
        body: JSON.stringify({
          baseRevision: saved.body.revision,
          snapshot: {
            ...initialSnapshot,
            projects: [{ ...initialSnapshot.projects[0], name }]
          }
        })
      })
    )
  );
  assert.deepEqual(
    concurrentWrites.map((result) => result.response.status).sort(),
    [200, 409]
  );
  const winningWrite = concurrentWrites.find((result) => result.response.status === 200);

  await crashServer(running);
  running = await startServer(dataDir, managementToken);

  const listed = await requestJson(`${running.baseUrl}/v1/personal/vaults`, {
    headers: bearer(managementToken)
  });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.vaults[0].id, "restart-vault");
  assert.equal(listed.body.vaults[0].tokenCount, 1);

  const restored = await requestJson(`${running.baseUrl}/v1/vaults/restart-vault/state`, {
    headers: bearer(vaultToken)
  });
  assert.equal(restored.response.status, 200);
  assert.equal(restored.body.revision, winningWrite.body.revision);
  assert.match(restored.body.snapshot.projects[0].name, /^Device [AB]$/);
});

test("encrypted snapshots remain opaque and survive restart", async (context) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "locoris-personal-encrypted-"));
  const managementToken = "encrypted-management-token";
  let running = await startServer(dataDir, managementToken);
  context.after(async () => {
    await stopServer(running).catch(() => undefined);
    await rm(dataDir, { recursive: true, force: true });
  });

  await requestJson(`${running.baseUrl}/v1/personal/vaults`, {
    method: "POST",
    headers: bearer(managementToken),
    body: JSON.stringify({ id: "private-vault", name: "Private vault" })
  });
  const issued = await requestJson(`${running.baseUrl}/v1/personal/vaults/private-vault/tokens`, {
    method: "POST",
    headers: bearer(managementToken),
    body: JSON.stringify({ label: "Private device" })
  });
  const encryptedSnapshot = {
    algorithm: "AES-GCM",
    nonce: "opaque-nonce",
    ciphertext: "opaque-ciphertext"
  };
  const metadata = {
    schemaVersion: 1,
    payloadMode: "encrypted",
    encryption: { algorithm: "AES-GCM" },
    vault: { vaultGuid: "private-vault", name: "Private vault", vaultKind: "private" }
  };
  const saved = await requestJson(`${running.baseUrl}/v1/vaults/private-vault/state`, {
    method: "PUT",
    headers: bearer(issued.body.token),
    body: JSON.stringify({ baseRevision: null, encryptedSnapshot, metadata })
  });
  assert.equal(saved.response.status, 200);

  await stopServer(running);
  running = await startServer(dataDir, managementToken);
  const restored = await requestJson(`${running.baseUrl}/v1/vaults/private-vault/state`, {
    headers: bearer(issued.body.token)
  });
  assert.equal(restored.response.status, 200);
  assert.deepEqual(restored.body.encryptedSnapshot, encryptedSnapshot);
  assert.equal(restored.body.snapshot, undefined);
});

test("pairing connects owners, gates guests by vault, and revokes device credentials", async (context) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "locoris-personal-pairing-"));
  const managementToken = "pairing-recovery-token";
  const running = await startServer(dataDir, managementToken);
  context.after(async () => {
    await stopServer(running).catch(() => undefined);
    await rm(dataDir, { recursive: true, force: true });
  });

  const connectionPage = await fetch(`${running.baseUrl}/connect#lcrs=test`);
  assert.equal(connectionPage.status, 200);
  const connectionPageBody = await connectionPage.text();
  assert.match(connectionPageBody, /Connect this device/);
  assert.match(connectionPageBody, /data:image\/png;base64,/);
  const russianSetupPage = await fetch(`${running.baseUrl}/`, {
    headers: { "Accept-Language": "ru-RU,ru;q=0.9" }
  });
  assert.match(await russianSetupPage.text(), /Подключить это устройство/);

  const setupMatch = await waitForOutput(running, /Setup code: ([A-Z0-9-]+)/);
  const ownerDeviceSecret = `zpd_${"a".repeat(48)}`;
  const ownerPairing = await requestJson(`${running.baseUrl}/v1/pairing/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: setupMatch[1],
      deviceSecret: ownerDeviceSecret,
      deviceName: "Owner Mac",
      platform: "macOS"
    })
  });
  assert.equal(ownerPairing.response.status, 201);
  assert.equal(ownerPairing.body.status, "connected");
  assert.equal(ownerPairing.body.device.role, "owner");

  for (const [id, name] of [
    ["shared-vault", "Shared vault"],
    ["private-vault", "Private vault"]
  ]) {
    const created = await requestJson(`${running.baseUrl}/v1/personal/vaults`, {
      method: "POST",
      headers: bearer(ownerDeviceSecret),
      body: JSON.stringify({ id, name })
    });
    assert.equal(created.response.status, 201);
  }

  const invalidAddressInvite = await requestJson(`${running.baseUrl}/v1/personal/invites`, {
    method: "POST",
    headers: bearer(ownerDeviceSecret),
    body: JSON.stringify({
      kind: "owner_device",
      serverUrl: "ftp://sync.example.test"
    })
  });
  assert.equal(invalidAddressInvite.response.status, 400);
  assert.equal(invalidAddressInvite.body.error, "PAIRING_SERVER_URL_INVALID");

  const guestInvite = await requestJson(`${running.baseUrl}/v1/personal/invites`, {
    method: "POST",
    headers: bearer(ownerDeviceSecret),
    body: JSON.stringify({
      kind: "guest",
      label: "Read-only collaborator",
      vaultIds: ["shared-vault"],
      permission: "read",
      serverUrl: "https://sync.example.test/locoris"
    })
  });
  assert.equal(guestInvite.response.status, 201);
  assert.match(guestInvite.body.connection.connectionPackage, /^lcrs1_/);
  const invitationPayload = JSON.parse(
    Buffer.from(
      guestInvite.body.connection.connectionPackage.replace(/^lcrs1_/, ""),
      "base64url"
    ).toString("utf8")
  );
  assert.equal(invitationPayload.serverUrl, "https://sync.example.test/locoris");
  assert.match(guestInvite.body.connection.url, /^https:\/\/sync\.example\.test\/locoris\/connect#/);

  const guestDeviceSecret = `zpd_${"b".repeat(48)}`;
  const guestClaimSecret = `zpc_${"c".repeat(48)}`;
  const guestPairing = await requestJson(`${running.baseUrl}/v1/pairing/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: guestInvite.body.invite.secret,
      deviceSecret: guestDeviceSecret,
      claimSecret: guestClaimSecret,
      deviceName: "Guest Windows PC",
      platform: "Windows"
    })
  });
  assert.equal(guestPairing.response.status, 202);
  assert.equal(guestPairing.body.status, "pending");
  assert.match(guestPairing.body.request.confirmationCode, / · /);

  const accessBeforeApproval = await requestJson(`${running.baseUrl}/v1/personal/access`, {
    headers: bearer(ownerDeviceSecret)
  });
  assert.equal(accessBeforeApproval.response.status, 200);
  assert.equal(accessBeforeApproval.body.requests[0].status, "pending");

  const approval = await requestJson(
    `${running.baseUrl}/v1/personal/pairing-requests/${guestPairing.body.request.id}/decision`,
    {
      method: "POST",
      headers: bearer(ownerDeviceSecret),
      body: JSON.stringify({ approve: true })
    }
  );
  assert.equal(approval.response.status, 200);
  assert.equal(approval.body.device.role, "guest");
  const guestDeviceId = approval.body.device.id;

  const pairingStatus = await requestJson(
    `${running.baseUrl}/v1/pairing/requests/${guestPairing.body.request.id}/status`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimSecret: guestClaimSecret })
    }
  );
  assert.equal(pairingStatus.response.status, 200);
  assert.equal(pairingStatus.body.status, "approved");
  assert.equal(pairingStatus.body.device.id, guestDeviceId);

  const guestVaults = await requestJson(`${running.baseUrl}/v1/personal/vaults`, {
    headers: bearer(guestDeviceSecret)
  });
  assert.equal(guestVaults.response.status, 200);
  assert.deepEqual(guestVaults.body.vaults.map((vault) => vault.id), ["shared-vault"]);

  const guestVaultToken = await requestJson(
    `${running.baseUrl}/v1/personal/vaults/shared-vault/tokens`,
    {
      method: "POST",
      headers: bearer(guestDeviceSecret),
      body: JSON.stringify({ label: "Guest sync" })
    }
  );
  assert.equal(guestVaultToken.response.status, 201);
  const rejectedWrite = await requestJson(`${running.baseUrl}/v1/vaults/shared-vault/state`, {
    method: "PUT",
    headers: bearer(guestVaultToken.body.token),
    body: JSON.stringify({ baseRevision: null, snapshot: createEmptySnapshot() })
  });
  assert.equal(rejectedWrite.response.status, 403);
  assert.equal(rejectedWrite.body.error, "VAULT_READ_ONLY");

  const revoked = await requestJson(`${running.baseUrl}/v1/personal/devices/${guestDeviceId}`, {
    method: "DELETE",
    headers: bearer(ownerDeviceSecret)
  });
  assert.equal(revoked.response.status, 200);

  const rejectedGuest = await requestJson(`${running.baseUrl}/v1/personal/vaults`, {
    headers: bearer(guestDeviceSecret)
  });
  assert.equal(rejectedGuest.response.status, 401);
  const rejectedVaultToken = await requestJson(`${running.baseUrl}/v1/vaults/shared-vault/state`, {
    headers: bearer(guestVaultToken.body.token)
  });
  assert.equal(rejectedVaultToken.response.status, 401);
});
