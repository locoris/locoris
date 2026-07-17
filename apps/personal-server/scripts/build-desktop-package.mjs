import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(serverRoot, "../..");
const executableSuffix = process.platform === "win32" ? ".cmd" : "";
const electronBuilder = path.join(workspaceRoot, "node_modules", ".bin", `electron-builder${executableSuffix}`);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: "inherit",
      windowsHide: true
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${path.basename(command)} failed: code=${code}; signal=${signal ?? "none"}`));
      }
    });
  });
}

let buildError = null;
try {
  await run(electronBuilder, ["--publish", "never"], serverRoot);
} catch (error) {
  buildError = error;
} finally {
  try {
    await run(
      npm,
      ["rebuild", "better-sqlite3", "--workspace", "@locoris/personal-server"],
      workspaceRoot
    );
  } catch (restoreError) {
    if (buildError) {
      throw new AggregateError([buildError, restoreError], "Desktop package and Node ABI restoration failed");
    }
    throw restoreError;
  }
}

if (buildError) {
  throw buildError;
}
