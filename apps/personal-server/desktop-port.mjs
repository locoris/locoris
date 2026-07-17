import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const DESKTOP_PORT_STATE_VERSION = 1;
const MIN_PORT = 1;
const MAX_PORT = 65_535;

function normalizePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT ? port : null;
}

function probePort(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", (error) => {
      if (error && typeof error === "object" && error.code === "EADDRINUSE") {
        resolve(false);
        return;
      }

      reject(error);
    });
    probe.listen(port, () => {
      probe.close((error) => error ? reject(error) : resolve(true));
    });
  });
}

function reserveEphemeralPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : null;

      if (!normalizePort(port)) {
        probe.close(() => reject(new Error("LOCORIS_SERVER_PORT_UNAVAILABLE")));
        return;
      }

      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function readPersistedPort(stateFile) {
  try {
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    return state?.version === DESKTOP_PORT_STATE_VERSION ? normalizePort(state.port) : null;
  } catch {
    return null;
  }
}

async function persistPort(stateFile, port) {
  await mkdir(path.dirname(stateFile), { recursive: true });
  const temporaryFile = `${stateFile}.${process.pid}.tmp`;
  await writeFile(
    temporaryFile,
    `${JSON.stringify({ version: DESKTOP_PORT_STATE_VERSION, port }, null, 2)}\n`,
    "utf8"
  );
  await rename(temporaryFile, stateFile);
}

function portInUseError(port) {
  return new Error(`LOCORIS_SERVER_PORT_IN_USE:${port}`);
}

export async function resolveDesktopServerPort({
  stateFile,
  explicitPort = null,
  preferredPort = 8787
}) {
  const configuredPort = normalizePort(explicitPort);

  if (explicitPort !== null && explicitPort !== undefined && !configuredPort) {
    throw new Error("LOCORIS_SERVER_PORT_INVALID");
  }

  if (configuredPort) {
    if (!(await probePort(configuredPort))) {
      throw portInUseError(configuredPort);
    }

    return configuredPort;
  }

  const persistedPort = await readPersistedPort(stateFile);

  if (persistedPort) {
    if (!(await probePort(persistedPort))) {
      throw portInUseError(persistedPort);
    }

    return persistedPort;
  }

  const normalizedPreferredPort = normalizePort(preferredPort) ?? 8787;
  const selectedPort = (await probePort(normalizedPreferredPort))
    ? normalizedPreferredPort
    : await reserveEphemeralPort();

  await persistPort(stateFile, selectedPort);
  return selectedPort;
}
