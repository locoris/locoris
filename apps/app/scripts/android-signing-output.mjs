import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const CERTIFICATE_LINE = /^(?:(?:Signer #\d+)|(?:V\d+(?:\.\d+)* Signer:))\s*certificate SHA-256 digest:\s*([a-f\d]{64})\s*$/gim;

export function extractAndroidCertificateFingerprint(output) {
  const fingerprints = new Set(
    Array.from(output.matchAll(CERTIFICATE_LINE), (match) => match[1].toLowerCase())
  );

  if (fingerprints.size === 0) {
    throw new Error("apksigner output does not contain a SHA-256 certificate fingerprint");
  }
  if (fingerprints.size !== 1) {
    throw new Error("apksigner output contains multiple certificate fingerprints");
  }

  return fingerprints.values().next().value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${extractAndroidCertificateFingerprint(readFileSync(0, "utf8"))}\n`);
}
