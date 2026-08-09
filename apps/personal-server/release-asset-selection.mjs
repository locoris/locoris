import path from "node:path";

const releaseExtensions = new Set([".AppImage", ".deb", ".dmg", ".exe", ".zip"]);
const platformMarkers = new Map([
  ["macos-arm64", ["-mac-arm64."]],
  ["windows-x64", ["-win-x64."]],
  ["linux-x64", ["-linux-x86_64.", "-linux-amd64."]]
]);

export function matchesServerReleaseAsset(name, { version, artifactLabel }) {
  if (!releaseExtensions.has(path.extname(name))) return false;
  if (!name.startsWith(`Locoris-Server-${version}-`)) return false;
  const markers = platformMarkers.get(artifactLabel);
  return !markers || markers.some((marker) => name.includes(marker));
}
