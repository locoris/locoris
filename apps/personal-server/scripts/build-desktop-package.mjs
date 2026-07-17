import { spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(serverRoot, "../..");
const serverPackage = JSON.parse(await readFile(path.join(serverRoot, "package.json"), "utf8"));
const electronVersion = serverPackage.devDependencies.electron;
const executableSuffix = process.platform === "win32" ? ".cmd" : "";
const electronBuilder = path.join(workspaceRoot, "node_modules", ".bin", `electron-builder${executableSuffix}`);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const workspaceNativeModule = path.join(
  workspaceRoot,
  "node_modules",
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node"
);

function run(command, args, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit",
      windowsHide: true,
      shell: process.platform === "win32"
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
  await run(
    npm,
    ["rebuild", "better-sqlite3"],
    workspaceRoot,
    {
      ...process.env,
      npm_config_runtime: "electron",
      npm_config_target: electronVersion,
      npm_config_dist_url: "https://electronjs.org/headers"
    }
  );
  await run(electronBuilder, ["--publish", "never"], serverRoot);
} catch (error) {
  buildError = error;
} finally {
  try {
    // electron-builder can hard-link the rebuilt native module into the package.
    // Detach the workspace copy before restoring the Node ABI so the signed
    // Electron package keeps its own native binary intact.
    await unlink(workspaceNativeModule).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
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
