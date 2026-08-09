#!/usr/bin/env node

import { selectReleaseByTag } from "./release-metadata-selection.mjs";

const argMap = new Map();

for (let index = 2; index < process.argv.length; index += 1) {
  const token = process.argv[index];

  if (!token.startsWith("--")) {
    continue;
  }

  const [rawKey, inlineValue] = token.slice(2).split("=", 2);

  if (typeof inlineValue === "string") {
    argMap.set(rawKey, inlineValue);
    continue;
  }

  const nextValue = process.argv[index + 1];

  if (nextValue && !nextValue.startsWith("--")) {
    argMap.set(rawKey, nextValue);
    index += 1;
    continue;
  }

  argMap.set(rawKey, "true");
}

const repository = argMap.get("repo") || process.env.LOCORIS_RELEASE_REPO;
const releaseTag = argMap.get("tag") || process.env.LOCORIS_RELEASE_TAG;
const expectedVersion =
  argMap.get("expected-version") || process.env.LOCORIS_EXPECTED_VERSION;
const expectedTargets = (argMap.get("targets") || process.env.LOCORIS_EXPECTED_TARGETS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const allowDraft = argMap.get("allow-draft") === "true";

if (!repository) {
  throw new Error("Missing --repo <owner/name>.");
}

if (!releaseTag) {
  throw new Error("Missing --tag <release-tag>.");
}

if (!expectedVersion) {
  throw new Error("Missing --expected-version <version>.");
}

if (expectedTargets.length === 0) {
  throw new Error("Missing --targets <comma-separated-platforms>.");
}

const apiHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": "locoris-release-validator",
  ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {})
};

function fail(message) {
  throw new Error(message);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: apiHeaders
  });

  if (!response.ok) {
    fail(`Request failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function fetchTaggedRelease(url) {
  const response = await fetch(url, {
    headers: apiHeaders
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    fail(`Request failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function fetchText(url, accept = "text/plain") {
  const response = await fetch(url, {
    headers: {
      ...apiHeaders,
      Accept: accept
    }
  });

  if (!response.ok) {
    fail(`Request failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function retry(label, fn, options = {}) {
  const attempts = options.attempts ?? 8;
  const delayMs = options.delayMs ?? 4000;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === attempts) {
        break;
      }

      console.warn(
        `[release-validator] ${label} attempt ${attempt}/${attempts} failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

function getAssetNameFromUrl(url) {
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/");
  return decodeURIComponent(segments[segments.length - 1] || "");
}

function assertTruthy(value, message) {
  if (!value) {
    fail(message);
  }
}

const release = await retry("fetch release", async () => {
  const directRelease = await fetchTaggedRelease(
    `https://api.github.com/repos/${repository}/releases/tags/${releaseTag}`
  );
  const listedReleases = directRelease || !allowDraft
    ? []
    : await fetchJson(`https://api.github.com/repos/${repository}/releases?per_page=100`);

  return selectReleaseByTag({
    directRelease,
    listedReleases,
    releaseTag,
    allowDraft
  });
});

assertTruthy(allowDraft || !release.draft, `Release ${releaseTag} is still a draft.`);
assertTruthy(!release.prerelease, `Release ${releaseTag} is marked as prerelease.`);
assertTruthy(
  typeof release.name === "string" && release.name.includes(expectedVersion),
  `Release name does not mention expected version ${expectedVersion}.`
);
assertTruthy(
  Array.isArray(release.assets) && release.assets.length > 0,
  `Release ${releaseTag} does not contain uploaded assets.`
);

const assetNames = new Set(release.assets.map((asset) => asset.name));
const latestJsonAsset = release.assets.find((asset) => asset.name === "latest.json");

assertTruthy(latestJsonAsset, `Release ${releaseTag} is missing latest.json.`);

const latestRaw = await retry("download latest.json", () =>
  fetchText(
    allowDraft && latestJsonAsset.url
      ? latestJsonAsset.url
      : latestJsonAsset.browser_download_url,
    allowDraft ? "application/octet-stream" : "application/json"
  )
);
const latestJson = JSON.parse(latestRaw);

assertTruthy(
  latestJson.version === expectedVersion,
  `latest.json version ${latestJson.version ?? "<missing>"} does not match ${expectedVersion}.`
);
assertTruthy(
  typeof latestJson.notes === "string" && latestJson.notes.trim().length > 0,
  "latest.json notes field is empty."
);
assertTruthy(
  typeof latestJson.pub_date === "string" && !Number.isNaN(Date.parse(latestJson.pub_date)),
  "latest.json pub_date is missing or invalid."
);
assertTruthy(
  latestJson.platforms && typeof latestJson.platforms === "object" && !Array.isArray(latestJson.platforms),
  "latest.json does not contain a valid platforms object."
);

for (const target of expectedTargets) {
  assertTruthy(
    target in latestJson.platforms,
    `latest.json is missing required platform entry ${target}.`
  );
}

for (const [platformKey, platformEntry] of Object.entries(latestJson.platforms)) {
  assertTruthy(
    platformEntry && typeof platformEntry === "object" && !Array.isArray(platformEntry),
    `Platform ${platformKey} is not an object in latest.json.`
  );

  const candidateUrl =
    typeof platformEntry.url === "string" ? platformEntry.url.trim() : "";
  const candidateSignature =
    typeof platformEntry.signature === "string" ? platformEntry.signature.trim() : "";

  assertTruthy(candidateUrl, `Platform ${platformKey} is missing url.`);
  assertTruthy(candidateSignature, `Platform ${platformKey} is missing signature.`);
  assertTruthy(
    candidateUrl.includes(`/releases/download/${releaseTag}/`),
    `Platform ${platformKey} url does not point at release ${releaseTag}.`
  );

  const assetName = getAssetNameFromUrl(candidateUrl);

  assertTruthy(assetNames.has(assetName), `Release is missing asset ${assetName}.`);
  assertTruthy(
    assetNames.has(`${assetName}.sig`),
    `Release is missing detached signature asset ${assetName}.sig.`
  );
}

console.log(
  `[release-validator] ${releaseTag} passed metadata validation for ${expectedTargets.join(", ")}.`
);
