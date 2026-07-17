# Locoris

Locoris is a local-first workspace for structured knowledge, visual thinking, planning, and private sync.

It combines:

- rich notes;
- canvas documents;
- orbital map navigation;
- projects, folders, tags, and backlinks;
- planner, calendar, recurring tasks, habits, goals, and review;
- AI tools for editor and canvas workflows;
- readable backups and exports;
- Locoris Cloud, self-hosted sync, and Google Drive sync;
- client-side encrypted sync for private/encrypted vault flows.

The app must remain useful without an account. Hosted cloud is the convenience layer, not the owner of the user's local data.

## Workspace Layout

```text
apps/
  app/               # Locoris app: web, desktop through Tauri, Android through Tauri
  personal-server/   # self-hosted personal sync runtime
  site/              # premium marketing website

packages/
  sync-core/         # public sync helpers shared by public runtimes

docs/
  product/           # current product, sync, privacy, and export docs
  setup/             # setup, development, and release notes
```

The managed hosted cloud runtime lives in the separate private `locoris-cloud` repository.

## Product Docs

- [Product overview](docs/product/overview.md)
- [Sync](docs/product/sync.md)
- [Client-side encryption](docs/product/e2ee.md)
- [Backups and export](docs/product/backups-and-export.md)
- [Glossary](docs/product/glossary.md)
- [Security terminology](docs/product/security-terminology.md)
- [Storage compatibility](docs/product/storage-compatibility.md)

## Local App

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm run build
git diff --check
```

## Marketing Site

```bash
npm run site:dev
npm run site:build
```

Site media slots live in:

- [apps/site/public/media](apps/site/public/media)

## Personal Sync Server

Self-hosted sync is distributed in two user-facing forms: the Docker/NAS image for an always-on server and Locoris Server installers for Windows, macOS, and Linux. Both use the same data format and the same one-time device invitations; normal setup does not expose a permanent management token.

The self-hosted server uses SQLite for metadata and token hashes, plus atomic snapshot and journal files in one persistent data directory. By default it uses an OS-appropriate app data directory:

- macOS: `~/Library/Application Support/Locoris/Personal Server`
- Windows: `%LOCALAPPDATA%\\Locoris\\Personal Server`
- Linux: `$XDG_DATA_HOME/locoris/personal-server` or `~/.local/share/locoris/personal-server`

Override it with:

```bash
SYNC_DATA_DIR=/absolute/path
```

Existing `personal-config.json` and `registry.json` metadata is imported once and archived automatically. Back up the complete data directory, not individual files. See [apps/personal-server/README.md](apps/personal-server/README.md) for installation, pairing, guest access, Docker Compose, migration, backup, restore, and operational guidance.

## Google Drive Setup

Google Drive sync stores remote vaults in the hidden `appDataFolder`. Current clients use immutable checkpoints and commits, resumable uploads, client-side encrypted private-vault payloads, background change detection, and platform-native reconnect/revoke flows.

Detailed guide:

- [docs/setup/google-drive.md](docs/setup/google-drive.md)

## Desktop And Android

Locoris uses Tauri 2 for desktop and Android builds.

Useful docs:

- [Desktop development](docs/setup/desktop-development.md)
- [Desktop data lifecycle](docs/setup/desktop-data-lifecycle.md)
- [Release flow](docs/setup/desktop-release.md)
