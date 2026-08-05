import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  distributedDevelopmentPackages,
  packageOverrides,
} from "./third-party-notices.config.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(rootDir, "THIRD_PARTY_NOTICES.md");
const packageLockPath = join(rootDir, "package-lock.json");
const cargoManifestPath = join(
  rootDir,
  "apps",
  "app",
  "src-tauri",
  "Cargo.toml",
);
const checkOnly = process.argv.includes("--check");

const licenseFilePattern = /^(licen[cs]e|copying|notice)([-._].*)?$/i;

const normalizeText = (value) =>
  value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const readLicenseFiles = (directory) => {
  if (!directory || !existsSync(directory)) {
    return [];
  }

  return readdirSync(directory)
    .filter((name) => licenseFilePattern.test(name))
    .sort((left, right) => left.localeCompare(right))
    .flatMap((name) => {
      const path = join(directory, name);
      if (!statSync(path).isFile()) {
        return [];
      }

      const text = normalizeText(readFileSync(path, "utf8"));
      return text ? [text] : [];
    });
};

const normalizeRepository = (repository, fallback = "") => {
  const raw =
    typeof repository === "string"
      ? repository
      : repository?.url || fallback || "";

  return raw
    .replace(/^github:/, "https://github.com/")
    .replace(/^git\+/, "")
    .replace(/^git:\/\/github\.com\//, "https://github.com/")
    .replace(/\.git$/, "");
};

const packageNameFromLockPath = (lockPath) => {
  const marker = "node_modules/";
  const packagePath = lockPath.slice(lockPath.lastIndexOf(marker) + marker.length);
  const segments = packagePath.split("/");
  return packagePath.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : segments[0];
};

const collectNpmPackages = () => {
  const lock = readJson(packageLockPath);
  const records = new Map();

  for (const [lockPath, metadata] of Object.entries(lock.packages ?? {})) {
    if (!lockPath.includes("node_modules/") || metadata.link) {
      continue;
    }

    const name = packageNameFromLockPath(lockPath);
    if (metadata.dev === true && !distributedDevelopmentPackages.has(name)) {
      continue;
    }

    const directory = join(rootDir, lockPath);
    const manifestPath = join(directory, "package.json");
    const manifest = existsSync(manifestPath) ? readJson(manifestPath) : {};
    const version = metadata.version || manifest.version || "unknown";
    const identity = `${name}@${version}`;
    const override = packageOverrides.get(identity) ?? {};
    const overrideFileTexts = (override.licenseTextFiles ?? []).map((path) =>
      normalizeText(readFileSync(join(rootDir, path), "utf8")),
    );
    const licenseTexts = [
      ...readLicenseFiles(directory),
      ...(override.licenseTexts ?? []),
      ...overrideFileTexts,
      ...(override.additionalNotices ?? []),
    ].map(normalizeText);
    const record = {
      ecosystem: "npm",
      name,
      version,
      license: override.license || metadata.license || manifest.license || "NOASSERTION",
      repository: normalizeRepository(
        override.repository || manifest.repository,
        metadata.resolved,
      ),
      licenseTexts,
    };

    const existing = records.get(identity);
    if (!existing || existing.licenseTexts.length < record.licenseTexts.length) {
      records.set(identity, record);
    }
  }

  return [...records.values()];
};

const collectCargoPackages = () => {
  const rawMetadata = execFileSync(
    "cargo",
    [
      "metadata",
      "--locked",
      "--format-version",
      "1",
      "--manifest-path",
      cargoManifestPath,
    ],
    {
      cwd: rootDir,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    },
  );
  const metadata = JSON.parse(rawMetadata);

  return metadata.packages
    .filter((pkg) => Boolean(pkg.source))
    .map((pkg) => ({
      ecosystem: "Cargo",
      name: pkg.name,
      version: pkg.version,
      license:
        pkg.license ||
        (pkg.license_file
          ? `SEE LICENSE IN ${pkg.license_file}`
          : "NOASSERTION"),
      repository: normalizeRepository(pkg.repository, pkg.homepage),
      licenseTexts: readLicenseFiles(dirname(pkg.manifest_path)),
    }));
};

const escapeTableCell = (value) =>
  String(value || "-")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const renderSource = (repository) => {
  if (!repository) {
    return "-";
  }

  if (/^https?:\/\//.test(repository)) {
    return `[source](${repository})`;
  }

  return escapeTableCell(repository);
};

const renderInventory = (title, packages) => {
  const lines = [
    `## ${title}`,
    "",
    "| Package | Version | License | Upstream |",
    "| --- | --- | --- | --- |",
  ];

  for (const pkg of packages) {
    lines.push(
      `| \`${escapeTableCell(pkg.name)}\` | \`${escapeTableCell(pkg.version)}\` | ${escapeTableCell(pkg.license)} | ${renderSource(pkg.repository)} |`,
    );
  }

  return lines.join("\n");
};

const renderLicenseTexts = (packages) => {
  const texts = new Map();

  for (const pkg of packages) {
    for (const text of pkg.licenseTexts) {
      const hash = createHash("sha256").update(text).digest("hex");
      const entry = texts.get(hash) ?? { text, packages: new Set() };
      entry.packages.add(`${pkg.name}@${pkg.version}`);
      texts.set(hash, entry);
    }
  }

  const entries = [...texts.values()].sort((left, right) => {
    const leftName = [...left.packages].sort()[0] ?? "";
    const rightName = [...right.packages].sort()[0] ?? "";
    return leftName.localeCompare(rightName);
  });
  const lines = [
    "## Collected license texts",
    "",
    "Identical upstream texts are stored once and associated with every package",
    "that supplied that text.",
    "",
  ];

  entries.forEach((entry, index) => {
    const packageList = [...entry.packages].sort().join(", ");
    lines.push(
      "<details>",
      `<summary>License text ${String(index + 1).padStart(3, "0")} - ${escapeHtml(packageList)}</summary>`,
      "",
      `<pre>${escapeHtml(entry.text)}</pre>`,
      "",
      "</details>",
      "",
    );
  });

  return lines.join("\n").trimEnd();
};

const renderNotices = () => {
  const packages = [...collectNpmPackages(), ...collectCargoPackages()].sort(
    (left, right) =>
      left.ecosystem.localeCompare(right.ecosystem) ||
      left.name.localeCompare(right.name) ||
      left.version.localeCompare(right.version),
  );
  const unresolved = packages.filter((pkg) => pkg.license === "NOASSERTION");

  if (unresolved.length > 0) {
    const names = unresolved
      .map((pkg) => `${pkg.ecosystem}:${pkg.name}@${pkg.version}`)
      .join(", ");
    throw new Error(`Dependencies without a declared license: ${names}`);
  }

  const npmPackages = packages.filter((pkg) => pkg.ecosystem === "npm");
  const cargoPackages = packages.filter((pkg) => pkg.ecosystem === "Cargo");
  const withCollectedText = packages.filter((pkg) => pkg.licenseTexts.length > 0);

  return `# Third-Party Notices

This file is generated from the dependency lockfiles. Do not edit it manually.
Regenerate it with \`npm run notices:generate\`.

Locoris is built on open-source software maintained by many individuals and
communities. Their work remains governed by the licenses identified below.
Nothing in the Locoris AGPL license replaces those upstream terms.

## Scope

- npm runtime graph: ${npmPackages.length} unique packages;
- Rust/Tauri graph: ${cargoPackages.length} unique crates;
- packages with collected upstream license or notice text: ${withCollectedText.length};
- copyright for Locoris-owned code: Copyright (c) 2026 angrein.

The inventory includes target-specific dependencies for supported platforms.
Build-only JavaScript tools are excluded, except for runtimes distributed with
the product. License metadata comes from locked package manifests; available
upstream license and notice files are reproduced in the appendix.

## Material components

- Excalidraw powers the editable canvas experience and is licensed under MIT.
- BlockNote powers rich-text editing and is licensed under MPL-2.0.
- Tauri powers native application shells and uses Apache-2.0/MIT licensing.
- Electron powers Locoris Server desktop packages and is licensed under MIT.
- Bundled font families are licensed under SIL Open Font License 1.1.

${renderInventory("npm runtime packages", npmPackages)}

${renderInventory("Rust and Tauri crates", cargoPackages)}

${renderLicenseTexts(packages)}
`.trimEnd() + "\n";
};

const generated = renderNotices();

if (checkOnly) {
  const current = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "";
  if (current !== generated) {
    console.error(
      `${relative(rootDir, outputPath)} is out of date. Run npm run notices:generate.`,
    );
    process.exitCode = 1;
  } else {
    console.log(`${relative(rootDir, outputPath)} is up to date.`);
  }
} else {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, generated, "utf8");
  console.log(`Wrote ${relative(rootDir, outputPath)}.`);
}
