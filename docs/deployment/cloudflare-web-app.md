# Cloudflare Pages: Locoris Web

The web app is a separate static Cloudflare Pages project. It serves the local-first client UI and IndexedDB data; authenticated Cloud operations go to the HTTPS API origin.

## Build contract

| Setting | Value |
| --- | --- |
| Project name | `locoris-app` |
| Repository | `locoris/locoris` |
| Production branch | `main` |
| Build command | `npm run web:build` |
| Build output | `apps/app/dist` |
| Root directory | repository root |
| Node | `24` |

Production variables:

```text
VITE_LOCORIS_CLOUD_URL=https://api.locoris.app
VITE_LOCORIS_ACCOUNT_URL=https://account.locoris.app
VITE_LOCORIS_SITE_URL=https://locoris.app
VITE_GOOGLE_DRIVE_CLIENT_ID=<Google OAuth Web client ID>
```

Pages Function runtime variable:

```text
APP_API_BASE_URL=https://api.locoris.app
```

During the domain-free test phase set it to the current HTTPS API origin. The Web App calls
account routes through same-origin `/api`; the Pages Function keeps the rotating refresh token
in a Secure HttpOnly cookie, while short-lived access tokens remain in the active browser session.

Never add `VITE_GOOGLE_DRIVE_DESKTOP_CLIENT_SECRET`, cloud database credentials, Robokassa secrets, signing keys, or an administrative token to the Pages environment. Every `VITE_` value is public browser configuration.

For the domain-free test phase use:

```text
VITE_LOCORIS_CLOUD_URL=https://your-current-cloud-api.example
VITE_LOCORIS_ACCOUNT_URL=https://locoris-account.pages.dev
VITE_LOCORIS_SITE_URL=https://locoris-site.pages.dev
```

The Google OAuth Web client must allow the exact active Web App origin. Add `https://locoris-app.pages.dev` to the test OAuth client, then add the final custom origin later. Do not allow branch-preview wildcards.

Do not add a catch-all `_redirects` rule or a top-level `404.html`. Cloudflare Pages treats a deployment without `404.html` as a single-page application and serves `index.html` for direct navigation to application routes.

## Launch gate

1. Build succeeds with `npm run web:build`.
2. The stable Web App origin (`locoris-app.pages.dev` during testing) is active over HTTPS.
3. API CORS allows the exact app origin.
4. Register, login, refresh, logout, entitlement expiry, and revoked-device flows pass.
5. Plain and encrypted vaults sync from two independent browsers.
6. Google Drive login and background reauthorization pass with the production OAuth client.
7. Refreshing the page preserves local vaults and does not flash an authenticated surface before the access gate resolves.
8. Closing and reopening a mobile browser restores the signed-in session without asking for the password.
9. Only after these checks set `PUBLIC_WEB_APP_AVAILABLE=true` on the marketing site.

Cloudflare Pages preview deployments are non-indexable by default. The permanent `locoris-app.pages.dev` fallback is also marked `noindex` in `_headers` to avoid competing with the custom domain.
