import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const serverEntry = process.argv[2];
if (!serverEntry) {
  throw new Error("SERVER_RUNTIME_ENTRY_REQUIRED");
}

const dataDir = await mkdtemp(path.join(os.tmpdir(), "locoris-server-runtime-smoke-"));
process.env.SYNC_DATA_DIR = dataDir;
process.env.PORT = "0";
process.env.SYNC_PRINT_QR = "0";
process.env.SYNC_PRINT_PAIRING_DETAILS = "0";
process.env.LOCORIS_DESKTOP_SERVER = "1";

let runtime = null;
try {
  runtime = await import(pathToFileURL(path.resolve(serverEntry)).href);
  let readyTimeout = null;
  const ready = await Promise.race([
    runtime.personalServerReady,
    new Promise((_, reject) => {
      readyTimeout = setTimeout(() => reject(new Error("SERVER_RUNTIME_READY_TIMEOUT")), 20_000);
    })
  ]).finally(() => clearTimeout(readyTimeout));
  const response = await fetch(`${ready.baseUrl}/health`);
  if (!response.ok) {
    throw new Error(`SERVER_RUNTIME_HEALTH_FAILED: ${response.status}`);
  }
  const health = await response.json();
  console.log(JSON.stringify({ baseUrl: ready.baseUrl, health }));
} finally {
  await runtime?.closePersonalServer?.().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
}
