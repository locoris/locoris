import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

export const DEFAULT_LOCORIS_SERVER_PORT = 26_747;
export const MIN_USER_SERVER_PORT = 1_024;
export const MAX_USER_SERVER_PORT = 49_151;

const DESKTOP_PORT_STATE_VERSION = 2;
const MIN_PORT = 1;
const MAX_PORT = 65_535;

export function normalizeServerPort(value, options = {}) {
  const port = Number(value);
  const minimum = options.userSelectable ? MIN_USER_SERVER_PORT : MIN_PORT;
  const maximum = options.userSelectable ? MAX_USER_SERVER_PORT : MAX_PORT;
  return Number.isInteger(port) && port >= minimum && port <= maximum ? port : null;
}

export function probeDesktopServerPort(port) {
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

function defaultConfig() {
  return {
    version: DESKTOP_PORT_STATE_VERSION,
    port: DEFAULT_LOCORIS_SERVER_PORT,
    source: "default",
    updatedAt: null
  };
}

export async function readDesktopServerPortConfig(stateFile) {
  try {
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    const port = normalizeServerPort(state?.port, { userSelectable: true });

    if (
      state?.version !== DESKTOP_PORT_STATE_VERSION ||
      !port ||
      !["default", "custom"].includes(state?.source)
    ) {
      return defaultConfig();
    }

    return {
      version: DESKTOP_PORT_STATE_VERSION,
      port,
      source: state.source,
      updatedAt: Number.isFinite(state.updatedAt) ? state.updatedAt : null
    };
  } catch {
    return defaultConfig();
  }
}

export async function saveDesktopServerPortConfig(stateFile, port) {
  const normalizedPort = normalizeServerPort(port, { userSelectable: true });
  if (!normalizedPort) {
    throw new Error("LOCORIS_SERVER_PORT_INVALID");
  }

  const state = {
    version: DESKTOP_PORT_STATE_VERSION,
    port: normalizedPort,
    source: normalizedPort === DEFAULT_LOCORIS_SERVER_PORT ? "default" : "custom",
    updatedAt: Date.now()
  };

  await mkdir(path.dirname(stateFile), { recursive: true });
  const temporaryFile = `${stateFile}.${process.pid}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryFile, stateFile);
  return state;
}

function portInUseError(port) {
  return new Error(`LOCORIS_SERVER_PORT_IN_USE:${port}`);
}

export async function resolveDesktopServerPort({
  stateFile,
  explicitPort = null
}) {
  const configuredPort = normalizeServerPort(explicitPort);

  if (explicitPort !== null && explicitPort !== undefined && !configuredPort) {
    throw new Error("LOCORIS_SERVER_PORT_INVALID");
  }

  if (configuredPort) {
    if (!(await probeDesktopServerPort(configuredPort))) {
      throw portInUseError(configuredPort);
    }

    return configuredPort;
  }

  const persisted = await readDesktopServerPortConfig(stateFile);

  // Version 1 stored an automatically selected random port. Writing the v2
  // config here deliberately migrates that legacy behavior to the fixed port.
  if (persisted.updatedAt === null) {
    await saveDesktopServerPortConfig(stateFile, persisted.port);
  }

  if (!(await probeDesktopServerPort(persisted.port))) {
    throw portInUseError(persisted.port);
  }

  return persisted.port;
}
