import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_LOCORIS_SERVER_PORT,
  readDesktopServerPortConfig,
  resolveDesktopServerPort,
  saveDesktopServerPortConfig
} from "../desktop-port.mjs";

function listen(port = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function serverPort(server) {
  const address = server.address();
  assert.equal(typeof address, "object");
  assert.ok(address);
  return address.port;
}

async function availableUserPort() {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const port = 10_000 + Math.floor(Math.random() * 30_000);
    try {
      const probe = await listen(port);
      await close(probe);
      return port;
    } catch {
      // Try another port inside the user-selectable range.
    }
  }

  throw new Error("No free user-selectable port found for the test.");
}

test("desktop server persists and reuses the fixed Locoris port", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "locoris-desktop-port-"));
  const stateFile = path.join(directory, "desktop-server.json");

  const firstPort = await resolveDesktopServerPort({ stateFile });
  const secondPort = await resolveDesktopServerPort({ stateFile });
  const state = JSON.parse(await readFile(stateFile, "utf8"));

  assert.equal(firstPort, DEFAULT_LOCORIS_SERVER_PORT);
  assert.equal(secondPort, DEFAULT_LOCORIS_SERVER_PORT);
  assert.equal(state.port, DEFAULT_LOCORIS_SERVER_PORT);
  assert.equal(state.source, "default");
  assert.equal(state.version, 2);
});

test("desktop server reports a conflict instead of choosing a random port", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "locoris-desktop-port-"));
  const stateFile = path.join(directory, "desktop-server.json");
  const blocker = await listen(DEFAULT_LOCORIS_SERVER_PORT);
  context.after(() => close(blocker));

  await assert.rejects(
    resolveDesktopServerPort({ stateFile }),
    new RegExp(`LOCORIS_SERVER_PORT_IN_USE:${DEFAULT_LOCORIS_SERVER_PORT}`)
  );

  const state = await readDesktopServerPortConfig(stateFile);
  assert.equal(state.port, DEFAULT_LOCORIS_SERVER_PORT);
});

test("a custom desktop port is explicit, persisted, and never silently changed", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "locoris-desktop-port-"));
  const stateFile = path.join(directory, "desktop-server.json");
  const customPort = await availableUserPort();

  await saveDesktopServerPortConfig(stateFile, customPort);
  assert.equal(await resolveDesktopServerPort({ stateFile }), customPort);

  const blocker = await listen(customPort);
  context.after(() => close(blocker));

  await assert.rejects(
    resolveDesktopServerPort({ stateFile }),
    new RegExp(`LOCORIS_SERVER_PORT_IN_USE:${customPort}`)
  );
});

test("legacy random-port state migrates to the fixed default", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "locoris-desktop-port-"));
  const stateFile = path.join(directory, "desktop-server.json");
  await writeFile(stateFile, `${JSON.stringify({ version: 1, port: 62_341 })}\n`, "utf8");

  assert.equal(await resolveDesktopServerPort({ stateFile }), DEFAULT_LOCORIS_SERVER_PORT);
  const state = await readDesktopServerPortConfig(stateFile);
  assert.equal(state.version, 2);
  assert.equal(state.port, DEFAULT_LOCORIS_SERVER_PORT);
  assert.equal(state.source, "default");
});

test("PORT remains authoritative and is never persisted", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "locoris-desktop-port-"));
  const stateFile = path.join(directory, "desktop-server.json");
  const explicitProbe = await listen();
  const explicitPort = serverPort(explicitProbe);
  await close(explicitProbe);

  assert.equal(await resolveDesktopServerPort({ stateFile, explicitPort }), explicitPort);
  const state = await readDesktopServerPortConfig(stateFile);
  assert.equal(state.port, DEFAULT_LOCORIS_SERVER_PORT);

  const blocker = await listen(explicitPort);
  context.after(() => close(blocker));

  await assert.rejects(
    resolveDesktopServerPort({ stateFile, explicitPort }),
    new RegExp(`LOCORIS_SERVER_PORT_IN_USE:${explicitPort}`)
  );
});

test("custom port settings reject reserved and invalid values", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "locoris-desktop-port-"));
  const stateFile = path.join(directory, "desktop-server.json");

  await assert.rejects(saveDesktopServerPortConfig(stateFile, 80), /LOCORIS_SERVER_PORT_INVALID/);
  await assert.rejects(saveDesktopServerPortConfig(stateFile, 70_000), /LOCORIS_SERVER_PORT_INVALID/);
});
