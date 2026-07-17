import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveDesktopServerPort } from "../desktop-port.mjs";

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

test("desktop server persists its first available port and reuses it", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "locoris-desktop-port-"));
  const stateFile = path.join(directory, "desktop-server.json");
  const preferredProbe = await listen();
  const preferredPort = serverPort(preferredProbe);
  await close(preferredProbe);

  const firstPort = await resolveDesktopServerPort({ stateFile, preferredPort });
  const secondPort = await resolveDesktopServerPort({ stateFile, preferredPort: preferredPort + 1 });
  const state = JSON.parse(await readFile(stateFile, "utf8"));

  assert.equal(firstPort, preferredPort);
  assert.equal(secondPort, preferredPort);
  assert.equal(state.port, preferredPort);
});

test("desktop server chooses one fallback when the default port is occupied", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "locoris-desktop-port-"));
  const stateFile = path.join(directory, "desktop-server.json");
  const blocker = await listen();
  context.after(() => close(blocker));
  const preferredPort = serverPort(blocker);

  const firstPort = await resolveDesktopServerPort({ stateFile, preferredPort });
  const secondPort = await resolveDesktopServerPort({ stateFile, preferredPort });

  assert.notEqual(firstPort, preferredPort);
  assert.equal(secondPort, firstPort);
});

test("desktop server never silently changes a persisted port", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "locoris-desktop-port-"));
  const stateFile = path.join(directory, "desktop-server.json");
  const initialProbe = await listen();
  const persistedPort = serverPort(initialProbe);
  await close(initialProbe);

  assert.equal(
    await resolveDesktopServerPort({ stateFile, preferredPort: persistedPort }),
    persistedPort
  );

  const blocker = await listen(persistedPort);
  context.after(() => close(blocker));

  await assert.rejects(
    resolveDesktopServerPort({ stateFile, preferredPort: persistedPort }),
    new RegExp(`LOCORIS_SERVER_PORT_IN_USE:${persistedPort}`)
  );
});

test("an explicit port is authoritative and is not persisted", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "locoris-desktop-port-"));
  const stateFile = path.join(directory, "desktop-server.json");
  const explicitProbe = await listen();
  const explicitPort = serverPort(explicitProbe);
  await close(explicitProbe);

  assert.equal(
    await resolveDesktopServerPort({ stateFile, explicitPort }),
    explicitPort
  );

  const blocker = await listen(explicitPort);
  context.after(() => close(blocker));

  await assert.rejects(
    resolveDesktopServerPort({ stateFile, explicitPort }),
    new RegExp(`LOCORIS_SERVER_PORT_IN_USE:${explicitPort}`)
  );
});
