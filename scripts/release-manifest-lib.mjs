import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const APP_ASSETS = [
  {
    pattern: /^Locoris_(?<version>[^_]+)_aarch64\.dmg$/,
    metadata: { role: "installer", platform: "macos", architecture: "arm64", format: "dmg", signing: "ad-hoc" }
  },
  {
    pattern: /^Locoris_(?<version>[^_]+)_x64-setup\.exe$/,
    metadata: { role: "installer", platform: "windows", architecture: "x64", format: "exe", signing: "unsigned" }
  },
  {
    pattern: /^Locoris_(?<version>[^_]+)_x64_en-US\.msi$/,
    metadata: { role: "installer", platform: "windows", architecture: "x64", format: "msi", signing: "unsigned" }
  },
  {
    pattern: /^Locoris-Android-(?<version>.+)\.apk$/,
    metadata: { role: "installer", platform: "android", architecture: "universal", format: "apk", signing: "release-key" }
  },
  {
    pattern: /^Locoris_aarch64\.app\.tar\.gz$/,
    metadata: { role: "updater-bundle", platform: "macos", architecture: "arm64", format: "tar.gz", signing: "tauri-updater" }
  },
  {
    pattern: /^Locoris_(?<version>[^_]+)_x64(?:-setup|_en-US\.(?:msi))?.*\.sig$/,
    metadata: { role: "updater-signature", platform: "windows", architecture: "x64", format: "sig" }
  },
  {
    pattern: /^Locoris_aarch64\.app\.tar\.gz\.sig$/,
    metadata: { role: "updater-signature", platform: "macos", architecture: "arm64", format: "sig" }
  }
];

const SERVER_ASSETS = [
  {
    pattern: /^Locoris-Server-(?<version>.+)-mac-arm64\.dmg$/,
    metadata: { role: "installer", platform: "macos", architecture: "arm64", format: "dmg", signing: "unsigned" }
  },
  {
    pattern: /^Locoris-Server-(?<version>.+)-mac-arm64\.zip$/,
    metadata: { role: "portable", platform: "macos", architecture: "arm64", format: "zip", signing: "unsigned" }
  },
  {
    pattern: /^Locoris-Server-(?<version>.+)-win-x64\.exe$/,
    metadata: { role: "installer", platform: "windows", architecture: "x64", format: "exe", signing: "unsigned" }
  },
  {
    pattern: /^Locoris-Server-(?<version>.+)-linux-x86_64\.AppImage$/,
    metadata: { role: "installer", platform: "linux", architecture: "x64", format: "appimage", signing: "attested" }
  },
  {
    pattern: /^Locoris-Server-(?<version>.+)-linux-amd64\.deb$/,
    metadata: { role: "installer", platform: "linux", architecture: "x64", format: "deb", signing: "attested" }
  }
];

function inferMetadata(kind, fileName) {
  const definitions = kind === "app" ? APP_ASSETS : SERVER_ASSETS;

  for (const definition of definitions) {
    if (definition.pattern.test(fileName)) {
      return definition.metadata;
    }
  }

  if (fileName.endsWith(".spdx.json")) {
    return { role: "sbom", format: "spdx-json" };
  }

  if (fileName === "latest.json" || fileName === "android-latest.json") {
    return { role: "updater-metadata", format: "json" };
  }

  if (fileName === "Locoris-Server-compatibility.json") {
    return { role: "compatibility", format: "json" };
  }

  if (fileName.endsWith(".sha256") || fileName.startsWith("SHA256SUMS-")) {
    return { role: "checksum", format: "sha256" };
  }

  if (fileName.endsWith(".certificate.txt")) {
    return { role: "certificate", format: "text" };
  }

  return { role: "metadata", format: path.extname(fileName).replace(/^\./, "") || "binary" };
}

async function sha256(filePath) {
  const contents = await readFile(filePath);
  return createHash("sha256").update(contents).digest("hex");
}

function validateVersionedAssets(kind, version, assets) {
  const installers = assets.filter((asset) => asset.role === "installer");
  const expected =
    kind === "app"
      ? ["macos:arm64:dmg", "windows:x64:exe", "windows:x64:msi", "android:universal:apk"]
      : ["macos:arm64:dmg", "windows:x64:exe", "linux:x64:appimage", "linux:x64:deb"];
  const present = new Set(
    installers.map((asset) => `${asset.platform}:${asset.architecture}:${asset.format}`)
  );

  for (const requirement of expected) {
    if (!present.has(requirement)) {
      throw new Error(`Release ${kind} ${version} is missing required installer ${requirement}.`);
    }
  }

  const mismatched = assets.filter(
    (asset) => asset.detectedVersion && asset.detectedVersion !== version
  );

  if (mismatched.length > 0) {
    throw new Error(
      `Release assets do not match ${version}: ${mismatched.map((asset) => asset.name).join(", ")}`
    );
  }
}

function detectVersion(kind, fileName) {
  const definitions = kind === "app" ? APP_ASSETS : SERVER_ASSETS;

  for (const definition of definitions) {
    const match = fileName.match(definition.pattern);
    if (match?.groups?.version) {
      return match.groups.version;
    }
  }

  return null;
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readAndroidCertificate(directory, version) {
  const filePath = path.join(directory, `Locoris-Android-${version}.apk.certificate.txt`);

  try {
    const contents = await readFile(filePath, "utf8");
    const fingerprint = contents.match(/[a-f0-9]{64}/i)?.[0]?.toLowerCase() ?? null;
    if (!fingerprint) {
      throw new Error("Android certificate file does not contain a SHA-256 fingerprint.");
    }
    return fingerprint;
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("Android release certificate metadata is missing.");
    }
    throw error;
  }
}

export async function generateReleaseManifest({
  kind,
  version,
  tag,
  directory,
  output,
  repository = "locoris/locoris",
  sourceCommit = null,
  generatedAt = new Date().toISOString(),
  containerImage = null,
  containerDigest = null
}) {
  if (!new Set(["app", "server"]).has(kind)) {
    throw new Error("Release manifest kind must be app or server.");
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("Release manifest version must match X.Y.Z.");
  }
  if (tag !== `${kind === "app" ? "app" : "server"}-v${version}`) {
    throw new Error(`Release tag ${tag} does not match ${kind} ${version}.`);
  }

  const outputName = path.basename(output);
  const fileNames = (await readdir(directory))
    .filter((fileName) => fileName !== outputName && fileName !== "SHA256SUMS.txt")
    .sort((left, right) => left.localeCompare(right));
  const assets = [];

  for (const fileName of fileNames) {
    const filePath = path.join(directory, fileName);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      continue;
    }

    assets.push({
      name: fileName,
      size: fileStat.size,
      sha256: await sha256(filePath),
      downloadUrl: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(fileName)}`,
      detectedVersion: detectVersion(kind, fileName),
      ...inferMetadata(kind, fileName)
    });
  }

  validateVersionedAssets(kind, version, assets);

  const compatibility =
    kind === "server"
      ? await readOptionalJson(path.join(directory, "Locoris-Server-compatibility.json"))
      : null;
  if (kind === "server" && !compatibility) {
    throw new Error("Server compatibility contract is missing from the release directory.");
  }

  if (kind === "server" && (!containerImage || !/^sha256:[a-f0-9]{64}$/.test(containerDigest ?? ""))) {
    throw new Error("Server release manifest requires a container image and immutable SHA-256 digest.");
  }

  const androidCertificateSha256 =
    kind === "app" ? await readAndroidCertificate(directory, version) : null;
  const cleanAssets = assets.map(({ detectedVersion, ...asset }) => asset);
  const manifest = {
    schemaVersion: 1,
    product: kind === "app" ? "locoris-app" : "locoris-server",
    channel: "stable",
    version,
    tag,
    generatedAt,
    releaseUrl: `https://github.com/${repository}/releases/tag/${tag}`,
    source: {
      repository,
      commit: sourceCommit || null
    },
    assets: cleanAssets,
    ...(androidCertificateSha256 ? { androidCertificateSha256 } : {}),
    ...(compatibility ? { compatibility } : {}),
    ...(kind === "server"
      ? {
          container: {
            image: containerImage,
            versionTag: `${containerImage}:${version}`,
            digest: containerDigest,
            immutableReference: `${containerImage}@${containerDigest}`,
            platforms: ["linux/amd64", "linux/arm64"],
            signing: "cosign-keyless-github-oidc"
          }
        }
      : {})
  };

  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

