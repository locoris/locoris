import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDirectory = path.join(appDirectory, "dist");
const cloudUrl = process.env.VITE_LOCORIS_CLOUD_URL?.trim() ?? "";
const accountUrl = process.env.VITE_LOCORIS_ACCOUNT_URL?.trim() ?? "";
const siteUrl = process.env.VITE_LOCORIS_SITE_URL?.trim() ?? "";
const maxCloudflareFileSize = 25 * 1024 * 1024;

function requireHttpsOrigin(name, value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid production URL for web:build.`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${name} must be an HTTPS origin without a path, query, fragment, or local hostname.`);
  }
}

function assertProductionEnvironment() {
  requireHttpsOrigin("VITE_LOCORIS_CLOUD_URL", cloudUrl);
  requireHttpsOrigin("VITE_LOCORIS_ACCOUNT_URL", accountUrl);
  requireHttpsOrigin("VITE_LOCORIS_SITE_URL", siteUrl);
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

async function validateOutput() {
  const required = ["index.html", "_headers", "_redirects", "legal/THIRD_PARTY_NOTICES.md"];
  for (const name of required) {
    await stat(path.join(distDirectory, name)).catch(() => {
      throw new Error(`Production web output is missing ${name}.`);
    });
  }

  const files = await listFiles(distDirectory);
  if (files.length > 20_000) throw new Error(`Web output contains ${files.length} files; Cloudflare Pages Free supports 20,000.`);
  for (const file of files) {
    const metadata = await stat(file);
    if (metadata.size > maxCloudflareFileSize) {
      throw new Error(`${path.relative(distDirectory, file)} exceeds Cloudflare Pages' 25 MiB file limit.`);
    }
  }

  const searchable = files.filter((file) => /\.(?:html|js|css|json|txt|md)$/.test(file));
  const forbidden = ["http://localhost:8787", "http://127.0.0.1:8787"];
  for (const file of searchable) {
    const contents = await readFile(file, "utf8");
    for (const value of forbidden) {
      if (contents.includes(value)) {
        throw new Error(`Production web output contains forbidden development endpoint ${value} in ${path.relative(distDirectory, file)}.`);
      }
    }
  }

  console.log(`Validated ${files.length} Cloudflare Pages files for ${cloudUrl}.`);
}

assertProductionEnvironment();
await validateOutput();
