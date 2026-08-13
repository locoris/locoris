import assert from "node:assert/strict";
import test from "node:test";

import { onRequest } from "./[[path]].js";

test("proxies Web App auth through the same-origin cookie boundary", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  let forwardedRequest = null;
  globalThis.fetch = async (url, init) => {
    forwardedRequest = { url: String(url), init };
    return new Response(JSON.stringify({ session: { token: "access" } }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": "__Host-locoris_account_refresh=secret; Path=/; HttpOnly; Secure; SameSite=Strict"
      }
    });
  };

  const response = await onRequest({
    request: new Request("https://locoris-app.pages.dev/api/v1/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://locoris-app.pages.dev",
        "CF-Connecting-IP": "203.0.113.8"
      },
      body: JSON.stringify({ email: "person@example.com", password: "test-password" })
    }),
    env: { APP_API_BASE_URL: "https://temporary-api.example" }
  });

  assert.equal(response.status, 200);
  assert.equal(forwardedRequest.url, "https://temporary-api.example/v1/auth/login");
  assert.equal(forwardedRequest.init.headers.get("X-Locoris-Web-App"), "1");
  assert.equal(
    forwardedRequest.init.headers.get("X-Locoris-Client-Origin"),
    "https://locoris-app.pages.dev"
  );
  assert.equal(forwardedRequest.init.headers.get("X-Forwarded-For"), "203.0.113.8");
  assert.match(response.headers.get("Set-Cookie"), /HttpOnly/);
});

test("blocks cross-site Web App state changes", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response();
  };

  const response = await onRequest({
    request: new Request("https://locoris-app.pages.dev/api/v1/auth/logout", {
      method: "POST",
      headers: { Origin: "https://malicious.example" }
    }),
    env: { APP_API_BASE_URL: "https://temporary-api.example" }
  });

  assert.equal(response.status, 403);
  assert.equal(called, false);
});

test("does not expose cloud admin routes", async () => {
  const response = await onRequest({
    request: new Request("https://locoris-app.pages.dev/api/v1/admin/users"),
    env: { APP_API_BASE_URL: "https://temporary-api.example" }
  });

  assert.equal(response.status, 404);
});

test("allows the Web App to register a device for an account vault", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  let forwardedUrl = "";
  globalThis.fetch = async (url) => {
    forwardedUrl = String(url);
    return Response.json({ token: "vault-token" });
  };

  const response = await onRequest({
    request: new Request(
      "https://locoris-app.pages.dev/api/v1/account/vaults/vault-123/devices/register",
      {
        method: "POST",
        headers: { Origin: "https://locoris-app.pages.dev" },
        body: JSON.stringify({ deviceName: "Mobile browser" })
      }
    ),
    env: { APP_API_BASE_URL: "https://temporary-api.example" }
  });

  assert.equal(response.status, 200);
  assert.equal(
    forwardedUrl,
    "https://temporary-api.example/v1/account/vaults/vault-123/devices/register"
  );
});
