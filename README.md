<p align="center">
  <img src="apps/app/src-tauri/icons/128x128.png" width="96" height="96" alt="Locoris application icon">
</p>

<h1 align="center">Locoris</h1>

<p align="center">
  A private, local-first workspace for notes, visual thinking, planning, and sync.
</p>

<p align="center">
  <a href="LICENSE"><img alt="AGPL-3.0-or-later" src="https://img.shields.io/badge/license-AGPL--3.0--or--later-8cebd8?style=flat-square"></a>
  <a href="../../releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/angrein/locoris?display_name=tag&style=flat-square&color=f2c879"></a>
  <img alt="Local-first" src="https://img.shields.io/badge/data-local--first-a8b5ca?style=flat-square">
  <img alt="Platforms" src="https://img.shields.io/badge/platforms-web%20%7C%20macOS%20%7C%20Windows%20%7C%20Android-c7b5ef?style=flat-square">
</p>

Locoris brings structured knowledge, rich documents, editable canvases, an
orbital map, and a full planner into one workspace. Local data remains useful
without an account. Sync is an optional transport layer, not the owner of the
workspace.

## Why Locoris

- **Local-first by default.** Create and use local vaults without signing in.
- **One connected workspace.** Projects, folders, notes, canvases, tags,
  backlinks, tasks, calendar entries, recurring work, habits, goals, and review.
- **Visual navigation.** Explore knowledge and planning context through the
  orbital map instead of treating every item as another row in a list.
- **Client-side encrypted sync.** Private vault payloads are encrypted before
  they reach supported remote providers. The vault passphrase is not sent to
  Locoris Cloud and cannot be recovered by it.
- **Portable data.** Readable backups and exports reduce lock-in and support
  long-term ownership.
- **Choose the sync model.** Use Locoris Cloud, run Locoris Server yourself, or
  connect Google Drive.

The rich-text editor is built with BlockNote. The editable canvas experience is
powered by [Excalidraw](https://github.com/excalidraw/excalidraw).

## Product surfaces

| Surface | What it provides |
| --- | --- |
| Vault | Projects, folders, hierarchy, metadata, tags, favorites, and trash |
| Documents | Block-based rich notes, attachments, backlinks, import, and export |
| Canvas | Editable visual documents, drawing, diagrams, and structured AI output |
| Map | Orbital navigation across knowledge and aggregated planner signals |
| Planner | Tasks, calendar, recurrence, habits, review, and temporal context |
| Sync | Hosted cloud, self-hosted server, Google Drive, encryption, and recovery |

## Install

Official desktop and Android builds are published on the
[GitHub Releases](../../releases/latest) page. Release assets include platform
labels and checksums where the workflow supports them.

The web application uses the same Locoris client, connected to the official
hosted service. Store distribution will be added when the relevant developer
accounts are available.

## Self-hosted sync

[Locoris Server](apps/personal-server/README.md) is the open-source personal
sync runtime. It is available in two supported forms:

- Docker for Linux servers and NAS devices;
- Locoris Server desktop packages for macOS, Windows, and Linux.

Both use SQLite metadata, a persistent data directory, one-time device
invitations, health checks, backup and restore tooling, and the same sync data
format. Normal setup does not expose a permanent administration token.

## Encryption and recovery

Encryption is vault-scoped and passphrase-based. Current encrypted vault flows
use PBKDF2-SHA-256 for key derivation and AES-GCM-256 for payload encryption.
Losing the passphrase can make remote encrypted content unrecoverable; keep a
local copy or backup and review the
[client-side encryption guide](docs/product/e2ee.md) before relying on a remote
copy as the only recovery path.

Additional documentation:

- [Sync architecture and behavior](docs/product/sync.md)
- [Backups and readable export](docs/product/backups-and-export.md)
- [Storage compatibility](docs/product/storage-compatibility.md)
- [Security terminology](docs/product/security-terminology.md)
- [Google Drive setup](docs/setup/google-drive.md)

## Development

Prerequisites: Node.js 24, npm, and the platform requirements for Tauri 2.

```bash
npm ci
npm run dev
```

Core checks:

```bash
npm run typecheck
npm run build
npm run i18n:check
npm test --workspace @locoris/personal-server
npm run notices:check
git diff --check
```

Useful setup documentation:

- [Desktop development](docs/setup/desktop-development.md)
- [Desktop data lifecycle](docs/setup/desktop-data-lifecycle.md)
- [Release flow](docs/setup/desktop-release.md)

## Repository

```text
apps/
  app/               Locoris web, Tauri desktop, and Tauri Android client
  personal-server/   Self-hosted Locoris Server runtime and desktop packages

packages/
  sync-core/         Sync contracts and helpers shared by public runtimes

docs/
  product/           Current product, privacy, sync, and export documentation
  setup/             Development, integration, and release documentation
```

The managed Locoris Cloud implementation and the marketing website are kept in
separate private repositories. The public client and self-hosted server remain
independently usable under the open-source license.

## Commercial service

Locoris Cloud is the optional hosted convenience layer: account management,
managed availability, web access, storage, and synchronization without running
a server. Subscription revenue supports maintenance of the public application
and self-hosted stack. Local features are not made unusable when a cloud
subscription ends.

## Contributing and security

Locoris is currently maintained by a solo project lead with a lightweight,
public decision process.

- Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.
- Contributions use the [Developer Certificate of Origin](DCO), not a CLA.
- Read [GOVERNANCE.md](GOVERNANCE.md) for the decision model.
- Report vulnerabilities privately according to [SECURITY.md](SECURITY.md).

## Funding

Sponsorships and grants fund work on the public client, open sync behavior,
self-hosted deployment, accessibility, security, interoperability, and data
portability. They do not purchase access to user data or control over project
governance.

GitHub Sponsors is the first low-overhead funding channel. Open Collective and
project-specific grant funding may be added as they become operational. GitHub
reads the active funding destinations from [.github/FUNDING.yml](.github/FUNDING.yml).

## License

Locoris-owned source code in this repository is licensed under the
[GNU Affero General Public License v3.0 or later](LICENSE).

```text
Copyright (c) 2026 angrein
```

Third-party components remain under their respective licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The AGPL does not grant rights
to the Locoris name, logo, icon, or product identity; see
[TRADEMARKS.md](TRADEMARKS.md).
