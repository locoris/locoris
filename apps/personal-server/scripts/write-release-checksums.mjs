import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = path.join(serverRoot, "release-server");
const artifactLabel = process.argv[2]?.trim() || process.platform;
const manifest = JSON.parse(await readFile(path.join(serverRoot, "package.json"), "utf8"));
const platformSuffixes = new Map([
  ["macos-arm64", "-mac-arm64."],
  ["windows-x64", "-win-x64."],
  ["linux-x64", "-linux-x64."]
]);
const expectedPrefix = `Locoris-Server-${manifest.version}-`;
const expectedSuffix = platformSuffixes.get(artifactLabel);
const releaseExtensions = new Set([".AppImage", ".deb", ".dmg", ".exe", ".zip"]);
const entries = (await readdir(releaseRoot, { withFileTypes: true }))
  .filter((entry) => (
    entry.isFile()
    && entry.name.startsWith(expectedPrefix)
    && (!expectedSuffix || entry.name.includes(expectedSuffix))
    && releaseExtensions.has(path.extname(entry.name))
  ))
  .map((entry) => entry.name)
  .sort();

if (entries.length === 0) {
  throw new Error("LOCORIS_SERVER_RELEASE_ASSETS_MISSING");
}

const lines = [];
for (const name of entries) {
  const digest = createHash("sha256")
    .update(await readFile(path.join(releaseRoot, name)))
    .digest("hex");
  lines.push(`${digest}  ${name}`);
}

await writeFile(
  path.join(releaseRoot, `SHA256SUMS-${artifactLabel}.txt`),
  `${lines.join("\n")}\n`,
  "utf8"
);
