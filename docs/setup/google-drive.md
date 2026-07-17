# Google Drive Production Setup

Locoris stores Google Drive sync records in the hidden `appDataFolder` space and requests only the `drive.appdata` scope. Google Drive is a first-class transport alongside Locoris Cloud and the personal self-hosted server.

## Runtime Behavior

- Web uses Google Identity Services token flow. Google may require an explicit user gesture after the access token expires; Locoris shows **Sign in again** instead of opening a background popup.
- macOS and Windows use the system browser, authorization code + PKCE, a loopback callback, and a refresh token kept in the operating-system secure store.
- Android uses Google Play Services `AuthorizationClient`; token clearing and full access revocation use the platform APIs.
- Private vault checkpoints and commits are encrypted on the client before upload. Google receives ciphertext and sync metadata, not the decrypted vault.
- Drive Changes polling detects edits made by another device and schedules a sync while the app is visible and online.

## Storage Protocol

Current clients use immutable v2 records:

- `locoris-v2.checkpoint.<vault>.<id>.json` contains a complete recoverable state;
- `locoris-v2.commit.<vault>.<id>.json` contains one plain or encrypted change batch;
- a deterministic cursor identifies the selected checkpoint and every known commit;
- concurrent commits are retained until a later checkpoint proves they were applied;
- large records use resumable upload;
- old `vault-*.json`, journal, and manifest files remain dual-read migration inputs and compatibility mirrors during the transition;
- if an older Locoris client changes a legacy vault after v2 migration, the next current client promotes that write into a new checkpoint and merges any still-unapplied v2 commits.

Do not manually edit files in `appDataFolder`. An invalid manifest or journal produces a visible recovery error; Locoris does not silently replace damaged metadata with an empty file.

## 1. Google Cloud Project

Use separate Google Cloud projects for production and local/test builds when possible. In the production project:

1. Enable **Google Drive API**.
2. Configure the OAuth consent screen with the production Locoris name and logo.
3. Add a monitored support email and developer contact email.
4. Add the real product home page, Privacy Policy, and Terms URLs.
5. Verify every domain used by the web app and legal pages.
6. Keep requested scopes limited to `https://www.googleapis.com/auth/drive.appdata`.
7. Move the app from testing to production only after the branding, domains, legal pages, and support contact are final.

Official references:

- [Drive app data](https://developers.google.com/workspace/drive/api/guides/appdata)
- [OAuth production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
- [OAuth for installed apps](https://developers.google.com/identity/protocols/oauth2/native-app)

## 2. OAuth Clients

Create clients in the same production project.

### Web application

Create a **Web application** client and register every exact production and development origin. Examples:

- `https://app.locoris.com`
- `http://localhost:5173`
- `http://127.0.0.1:5173`

Do not use wildcard origins. The web client ID is public and is compiled into the frontend.

### Desktop app

Create a **Desktop app** client for macOS and Windows. Locoris uses PKCE and a random local loopback port. If Google issues a companion client secret, include it in desktop builds: Google documents the field as optional for installed apps, but some issued clients reject the token exchange when it is omitted. Installed apps cannot keep this credential confidential, so it is not a substitute for PKCE.

### Android

Create Android OAuth clients for every shipped application ID and signing certificate pair:

- release: `com.locoris.android` plus the release certificate SHA-1;
- debug: `com.locoris.android.debug` plus the debug certificate SHA-1, if debug Google sign-in is required.

The Android clients, web client, and desktop client must belong to the Google Cloud project where Drive API is enabled.

## 3. Local Configuration

Create `apps/app/.env` from the example and set only public client IDs:

```env
VITE_GOOGLE_DRIVE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
VITE_GOOGLE_DRIVE_DESKTOP_CLIENT_ID=your-desktop-client-id.apps.googleusercontent.com
VITE_GOOGLE_DRIVE_DESKTOP_CLIENT_SECRET=your-desktop-client-secret
```

Android resolves authorization through the application ID, signing certificate, and Google Cloud configuration; it does not consume either browser client ID.

## 4. GitHub Actions

Add these repository **Variables**, not secrets:

- `VITE_GOOGLE_DRIVE_CLIENT_ID`
- `VITE_GOOGLE_DRIVE_DESKTOP_CLIENT_ID`
- `VITE_GOOGLE_DRIVE_DESKTOP_CLIENT_SECRET` as a repository secret

The release workflows validate all three desktop OAuth values before packaging. The companion secret is embedded in the desktop frontend and therefore must be treated as a public installed-app credential, consistent with Google's installed-app threat model.

## 5. Account Actions

- **Sign in again** refreshes or recreates the platform session while preserving vault bindings.
- **Delete connection** removes the local Locoris connection and bindings. On Android it also clears the cached access token.
- **Revoke Google access** calls Google's revoke API, clears local access/refresh state, and leaves the connection visible for an intentional re-login.

Revocation affects every Locoris device authorized through that Google grant. The hidden Drive data is not deleted by revocation.

## 6. Release Verification

Run the following matrix before shipping a production build:

1. Connect a new account on web, macOS, Windows, and Android.
2. Close and reopen desktop/Android; confirm refresh happens without another login.
3. Let a web token expire; confirm background sync does not open a popup and **Sign in again** repairs the same connection.
4. Create, rename, sync, import, and delete a remote vault.
5. Sync one regular and one private vault between two devices.
6. Edit the same vault while both devices are offline, reconnect together, and confirm both immutable commits are merged.
7. Interrupt a large upload, restore the network, and confirm retry/resumable upload completes.
8. Test Drive storage quota, revoked permission, rate limiting, offline mode, and a damaged legacy manifest against non-production test data.
9. Revoke access, verify the connection reports authorization required, then sign in again without deleting the local vault.
10. Confirm another device change is detected while Locoris is visible without requiring a local edit.

Automated v2 protocol tests run with:

```bash
npm run test --workspace @locoris/app
```
