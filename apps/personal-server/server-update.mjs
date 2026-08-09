const DEFAULT_RELEASES_URL = "https://api.github.com/repos/locoris/locoris/releases?per_page=30";
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

function parseVersion(value) {
  const match = String(value ?? "").trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    raw: match[0],
    parts: match.slice(1, 4).map(Number),
    prerelease: match[4] ?? ""
  };
}

export function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  if (!left || !right) return 0;
  for (let index = 0; index < left.parts.length; index += 1) {
    if (left.parts[index] !== right.parts[index]) {
      return left.parts[index] > right.parts[index] ? 1 : -1;
    }
  }
  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return left.prerelease.localeCompare(right.prerelease, "en", { numeric: true });
}

function normalizeRelease(release) {
  const tag = String(release?.tag_name ?? "");
  if (release?.draft || release?.prerelease || !tag.startsWith("server-v")) return null;
  const version = tag.slice("server-v".length);
  if (!parseVersion(version)) return null;

  try {
    const releaseUrl = new URL(String(release?.html_url ?? ""));
    if (releaseUrl.protocol !== "https:" || releaseUrl.hostname !== "github.com") return null;
    if (!releaseUrl.pathname.startsWith("/locoris/locoris/releases/")) return null;
    return {
      version,
      releaseUrl: releaseUrl.toString(),
      publishedAt: typeof release?.published_at === "string" ? release.published_at : null
    };
  } catch {
    return null;
  }
}

export function selectLatestServerRelease(releases, currentVersion) {
  return (Array.isArray(releases) ? releases : [])
    .map(normalizeRelease)
    .filter(Boolean)
    .filter((release) => compareVersions(release.version, currentVersion) > 0)
    .sort((left, right) => compareVersions(right.version, left.version))[0] ?? null;
}

export function createServerUpdateService({
  currentVersion,
  distribution = "desktop",
  enabled = true,
  fetchImpl = globalThis.fetch,
  releasesUrl = DEFAULT_RELEASES_URL,
  intervalMs = DEFAULT_INTERVAL_MS,
  now = () => Date.now()
}) {
  let inFlight = null;
  let lastCheckedAt = 0;
  let state = {
    status: enabled ? "unchecked" : "disabled",
    currentVersion,
    latestVersion: null,
    releaseUrl: null,
    publishedAt: null,
    checkedAt: null,
    distribution
  };

  async function check({ force = false } = {}) {
    if (!enabled) return state;
    const minimumAge = force ? 60_000 : intervalMs;
    if (lastCheckedAt && now() - lastCheckedAt < minimumAge) return state;
    if (inFlight) return inFlight;

    inFlight = (async () => {
      const checkedAt = now();
      try {
        const response = await fetchImpl(releasesUrl, {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": `Locoris-Server/${currentVersion}`,
            "X-GitHub-Api-Version": "2022-11-28"
          },
          signal: AbortSignal.timeout(8_000)
        });
        if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
        const latest = selectLatestServerRelease(await response.json(), currentVersion);
        state = {
          ...state,
          status: latest ? "available" : "current",
          latestVersion: latest?.version ?? currentVersion,
          releaseUrl: latest?.releaseUrl ?? null,
          publishedAt: latest?.publishedAt ?? null,
          checkedAt: new Date(checkedAt).toISOString()
        };
      } catch {
        state = {
          ...state,
          status: "unavailable",
          checkedAt: new Date(checkedAt).toISOString()
        };
      } finally {
        lastCheckedAt = checkedAt;
        inFlight = null;
      }
      return state;
    })();
    return inFlight;
  }

  return {
    check,
    getState: () => ({ ...state })
  };
}
