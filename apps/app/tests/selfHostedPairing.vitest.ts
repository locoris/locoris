import { describe, expect, it, vi } from "vitest";

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
    let entropyOffset = 0;
    const webCryptoSpy = vi
      .spyOn(globalThis.crypto, "getRandomValues")
      .mockImplementation((array) => {
        const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        bytes.forEach((_, index) => {
          bytes[index] = (entropyOffset + index * 31 + 11) % 256;
        });
        entropyOffset += 37;
        return array;
      });
    const mathRandomSpy = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Pairing entropy must not use Math.random");
    });

    const deviceSecret = createSelfHostedDeviceSecret();
    const claimSecret = createSelfHostedClaimSecret();
    const secondDeviceSecret = createSelfHostedDeviceSecret();

    expect(webCryptoSpy).toHaveBeenCalledTimes(3);
    expect(mathRandomSpy).not.toHaveBeenCalled();
    expect(deviceSecret).toMatch(/^zpd_[A-Za-z0-9_-]{40,}$/);
    expect(claimSecret).toMatch(/^zpc_[A-Za-z0-9_-]{40,}$/);
    expect(deviceSecret).not.toBe(secondDeviceSecret);
  });
});
