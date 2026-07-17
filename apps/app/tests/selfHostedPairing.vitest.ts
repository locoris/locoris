import { describe, expect, it } from "vitest";

import {
  createSelfHostedClaimSecret,
  createSelfHostedDeviceSecret,
  normalizeSelfHostedPairingCode,
  parseSelfHostedConnectionPackage
} from "../src/lib/selfHostedPairing";

function encodePackage(payload: Record<string, unknown>) {
  const source = new TextEncoder().encode(JSON.stringify(payload));
  const binary = Array.from(source, (byte) => String.fromCharCode(byte)).join("");
  return `lcrs1_${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

describe("self-hosted connection packages", () => {
  it("parses a package directly or from the setup URL", () => {
    const connectionPackage = encodePackage({
      v: 1,
      serverUrl: "https://sync.example.com/",
      secret: "zpi_example",
      code: "ABCD-EFGH",
      serverId: "server-1"
    });

    expect(parseSelfHostedConnectionPackage(connectionPackage)).toEqual({
      version: 1,
      serverUrl: "https://sync.example.com",
      secret: "zpi_example",
      code: "ABCD-EFGH",
      serverId: "server-1"
    });
    expect(
      parseSelfHostedConnectionPackage(
        `https://sync.example.com/connect#lcrs=${encodeURIComponent(connectionPackage)}`
      )
    ).toMatchObject({ serverUrl: "https://sync.example.com", serverId: "server-1" });
  });

  it("normalizes a short code and rejects unsupported protocols", () => {
    expect(normalizeSelfHostedPairingCode("ab cd-ef_gh")).toBe("ABCD-EFGH");
    const invalid = encodePackage({
      v: 1,
      serverUrl: "file:///tmp/server",
      secret: "zpi_example",
      code: "ABCD-EFGH"
    });
    expect(() => parseSelfHostedConnectionPackage(invalid)).toThrow("PAIRING_SERVER_URL_INVALID");
    const credentialUrl = encodePackage({
      v: 1,
      serverUrl: "https://owner:secret@sync.example.com",
      secret: "zpi_example",
      code: "ABCD-EFGH"
    });
    expect(() => parseSelfHostedConnectionPackage(credentialUrl)).toThrow(
      "PAIRING_SERVER_URL_INVALID"
    );
  });

  it("creates independent device and claim credentials", () => {
    const deviceSecret = createSelfHostedDeviceSecret();
    const claimSecret = createSelfHostedClaimSecret();
    expect(deviceSecret).toMatch(/^zpd_[A-Za-z0-9_-]{40,}$/);
    expect(claimSecret).toMatch(/^zpc_[A-Za-z0-9_-]{40,}$/);
    expect(deviceSecret).not.toBe(createSelfHostedDeviceSecret());
  });
});
