import assert from "node:assert/strict";
import test from "node:test";

import { extractAndroidCertificateFingerprint } from "../scripts/android-signing-output.mjs";

const fingerprint = "b6f8dfa354b44da34ed25ec3476d327768584687e72fa42fabd1a1f61f4e5869";

test("reads the legacy apksigner certificate line", () => {
  assert.equal(
    extractAndroidCertificateFingerprint(`Signer #1 certificate SHA-256 digest: ${fingerprint}`),
    fingerprint
  );
});

test("reads modern scheme-specific apksigner certificate lines", () => {
  const output = [
    "Verified using v2 scheme (APK Signature Scheme v2): true",
    `V2 Signer: certificate SHA-256 digest: ${fingerprint}`,
    `V3.0 Signer: certificate SHA-256 digest: ${fingerprint.toUpperCase()}`
  ].join("\n");

  assert.equal(extractAndroidCertificateFingerprint(output), fingerprint);
});

test("rejects output without a certificate fingerprint", () => {
  assert.throws(
    () => extractAndroidCertificateFingerprint("Verified"),
    /does not contain/
  );
});

test("rejects APK output containing multiple signing certificates", () => {
  const otherFingerprint = "a".repeat(64);
  assert.throws(
    () => extractAndroidCertificateFingerprint([
      `V3.0 Signer: certificate SHA-256 digest: ${fingerprint}`,
      `V3.0 Signer: certificate SHA-256 digest: ${otherFingerprint}`
    ].join("\n")),
    /multiple certificate/
  );
});
