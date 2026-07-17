import { readdir, rm, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = path.join(serverRoot, "release-server");

async function findPackagedExecutable() {
  const releaseEntries = await readdir(releaseRoot, { withFileTypes: true });

  if (process.platform === "darwin") {
    const macDirectory = releaseEntries.find((entry) => entry.isDirectory() && entry.name.startsWith("mac"));
    if (!macDirectory) throw new Error("PACKAGED_MAC_DIRECTORY_NOT_FOUND");
    const macRoot = path.join(releaseRoot, macDirectory.name);
    const appBundle = (await readdir(macRoot, { withFileTypes: true }))
      .find((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
    if (!appBundle) throw new Error("PACKAGED_MAC_APP_NOT_FOUND");
    const executableRoot = path.join(macRoot, appBundle.name, "Contents", "MacOS");
    const executable = (await readdir(executableRoot, { withFileTypes: true }))
      .find((entry) => entry.isFile());
    if (!executable) throw new Error("PACKAGED_MAC_EXECUTABLE_NOT_FOUND");
    return path.join(executableRoot, executable.name);
  }

  if (process.platform === "win32") {
    const unpacked = releaseEntries.find((entry) => entry.isDirectory() && entry.name === "win-unpacked");
    if (!unpacked) throw new Error("PACKAGED_WINDOWS_DIRECTORY_NOT_FOUND");
    const root = path.join(releaseRoot, unpacked.name);
    const executable = (await readdir(root, { withFileTypes: true }))
      .find((entry) => entry.isFile() && entry.name.endsWith(".exe") && !entry.name.toLowerCase().includes("uninstall"));
    if (!executable) throw new Error("PACKAGED_WINDOWS_EXECUTABLE_NOT_FOUND");
    return path.join(root, executable.name);
  }

  const unpacked = releaseEntries.find((entry) => entry.isDirectory() && entry.name === "linux-unpacked");
  if (!unpacked) throw new Error("PACKAGED_LINUX_DIRECTORY_NOT_FOUND");
  const root = path.join(releaseRoot, unpacked.name);
  const entries = await readdir(root, { withFileTypes: true });
  const executable = entries.find((entry) => entry.isFile() && entry.name.toLowerCase().includes("locoris"));
  if (!executable) throw new Error("PACKAGED_LINUX_EXECUTABLE_NOT_FOUND");
  return path.join(root, executable.name);
}

const executable = await findPackagedExecutable();
const dataDir = await mkdtemp(path.join(os.tmpdir(), "locoris-server-package-smoke-"));
const command = process.platform === "linux" ? "xvfb-run" : executable;
const args = process.platform === "linux" ? ["-a", executable, "--smoke-test"] : ["--smoke-test"];

try {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        LOCORIS_DESKTOP_SMOKE_TEST: "1",
        SYNC_DATA_DIR: dataDir,
        SYNC_PRINT_QR: "0",
        SYNC_PRINT_PAIRING_DETAILS: "0",
        ELECTRON_ENABLE_LOGGING: "1"
      },
      stdio: "inherit",
      windowsHide: true
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("PACKAGED_DESKTOP_SMOKE_TIMEOUT"));
    }, 45_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`PACKAGED_DESKTOP_SMOKE_FAILED: code=${code}; signal=${signal ?? "none"}`));
      }
    });
  });
  console.log(`Packaged Locoris Server smoke test passed: ${path.basename(executable)}`);
} finally {
  await rm(dataDir, { recursive: true, force: true });
}
