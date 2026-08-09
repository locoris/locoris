import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generateReleaseManifest } from "./release-manifest-lib.mjs";

async function createFiles(directory, files) {
  await Promise.all(
    Object.entries(files).map(([name, contents]) => writeFile(path.join(directory, name), contents))
  );
}

test("generates a validated application release manifest", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "locoris-app-release-"));
  await createFiles(directory, {
    "Locoris_1.2.3_aarch64.dmg": "mac",
    "Locoris_1.2.3_x64-setup.exe": "exe",
    "Locoris_1.2.3_x64_en-US.msi": "msi",
    "Locoris-Android-1.2.3.apk": "apk",
    "Locoris-Android-1.2.3.apk.certificate.txt": `certificate\n${"a".repeat(64)}\n`,
    "Locoris-1.2.3.spdx.json": "{}",
    "latest.json": "{}"
  });
  const output = path.join(directory, "locoris-app-release.json");
  const manifest = await generateReleaseManifest({
    kind: "app",
    version: "1.2.3",
    tag: "app-v1.2.3",
    directory,
    output,
    sourceCommit: "abc123",
    generatedAt: "2026-08-09T00:00:00.000Z"
  });

  assert.equal(manifest.product, "locoris-app");
  assert.equal(manifest.assets.filter((asset) => asset.role === "installer").length, 4);
  assert.equal(manifest.androidCertificateSha256, "a".repeat(64));
  assert.equal(manifest.source.commit, "abc123");
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), manifest);
});

test("requires the server compatibility contract and immutable container digest", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "locoris-server-release-"));
  await createFiles(directory, {
    "Locoris-Server-0.4.0-mac-arm64.dmg": "mac",
    "Locoris-Server-0.4.0-win-x64.exe": "win",
    "Locoris-Server-0.4.0-linux-x86_64.AppImage": "appimage",
    "Locoris-Server-0.4.0-linux-amd64.deb": "deb",
    "Locoris-Server-compatibility.json": JSON.stringify({ serverVersion: "0.4.0" })
  });
  const output = path.join(directory, "locoris-server-release.json");
  const digest = `sha256:${"b".repeat(64)}`;
  const manifest = await generateReleaseManifest({
    kind: "server",
    version: "0.4.0",
    tag: "server-v0.4.0",
    directory,
    output,
    containerImage: "ghcr.io/locoris/locoris-server",
    containerDigest: digest,
    generatedAt: "2026-08-09T00:00:00.000Z"
  });

  assert.equal(manifest.compatibility.serverVersion, "0.4.0");
  assert.equal(manifest.container.immutableReference, `ghcr.io/locoris/locoris-server@${digest}`);
  assert.deepEqual(manifest.container.platforms, ["linux/amd64", "linux/arm64"]);
});

test("rejects incomplete application releases", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "locoris-incomplete-release-"));
  await createFiles(directory, {
    "Locoris_1.2.3_aarch64.dmg": "mac",
    "Locoris-Android-1.2.3.apk.certificate.txt": `certificate\n${"a".repeat(64)}\n`
  });

  await assert.rejects(
    generateReleaseManifest({
      kind: "app",
      version: "1.2.3",
      tag: "app-v1.2.3",
      directory,
      output: path.join(directory, "locoris-app-release.json")
    }),
    /missing required installer/
  );
});

