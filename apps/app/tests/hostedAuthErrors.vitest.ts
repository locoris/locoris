import { describe, expect, it } from "vitest";

import { isHostedReauthRequiredError } from "../src/lib/hostedAuthErrors";

describe("hosted auth error classification", () => {
  it("sends legacy browser sessions without a refresh cookie to sign-in", () => {
    expect(isHostedReauthRequiredError(new Error("REFRESH_TOKEN_REQUIRED"))).toBe(true);
  });

  it("keeps a real cloud outage separate from reauthentication", () => {
    expect(isHostedReauthRequiredError(new Error("SERVER_UNAVAILABLE"))).toBe(false);
  });
});
