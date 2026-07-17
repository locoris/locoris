import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(serverRoot, "dist-server");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await build({
  entryPoints: [path.join(serverRoot, "server.mjs")],
  outfile: path.join(outputRoot, "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: false,
  external: ["better-sqlite3", "qrcode", "qrcode-terminal"]
});
await cp(path.join(serverRoot, "public"), path.join(outputRoot, "public"), {
  recursive: true
});
await cp(
  path.resolve(serverRoot, "../app/src-tauri/icons/128x128.png"),
  path.join(outputRoot, "icon.png")
);
