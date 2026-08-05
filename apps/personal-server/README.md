# Locoris Personal Sync

Free self-hosted sync for one owner and multiple Locoris vaults. The runtime is intentionally small: SQLite stores transactional metadata and token hashes, while portable snapshot and bounded journal files live beside it in one data volume.

Private vault payloads remain end-to-end encrypted. The server stores ciphertext and never receives the private-vault passphrase.

## Choose An Installation

Locoris supports two user-facing installation paths:

1. **Docker / NAS** is the recommended always-on production path. It works on Linux servers and NAS devices with Docker Compose.
2. **Locoris Server for desktop** uses the same server runtime and data layout on Windows, macOS, and Linux. The server window presents the same one-time link and code as the Docker console.

The connection flow is identical in both cases. A QR code is optional: every invitation also has a copyable link and an eight-character code, so a camera is never required.

The invitation secret is placed in the URL fragment, so it is not sent to the setup page in an HTTP request or written to ordinary reverse-proxy access logs. Treat the full copied invitation as a temporary secret until it is used or expires.

## Docker / NAS Quick Start

Download `compose.example.yml` and `.env.example` from this directory into an empty folder, rename `.env.example` to `.env`, then set `LOCORIS_PUBLIC_URL` to an address your Locoris devices can reach.

```bash
docker compose -f compose.example.yml pull
docker compose -f compose.example.yml up -d
docker compose -f compose.example.yml logs -f
```

At first start the terminal shows all three representations of one single-use invitation:

- a clickable setup link;
- an eight-character setup code;
- an optional terminal QR code.

In Locoris open **Settings → Sync → Self-hosted**, paste the link/package or enter the reachable server URL and setup code. The first device becomes the owner. The permanent recovery token is generated into the data volume and is not part of normal onboarding.

The image is published as `ghcr.io/angrein/locoris-server:latest`. For a controlled production upgrade, replace `latest` in the Compose file with a numbered server release.

For development from this repository, the same runtime can be started directly with a permanent data directory:

```bash
npm install
SYNC_DATA_DIR="$HOME/locoris-personal-data" \
SYNC_PUBLIC_URL="http://localhost:26747" \
npm run sync-server
```

Personal Sync uses the dedicated port `26747` by default. Locoris Cloud development can keep `8787`, so both runtimes can run on one computer without special configuration. For an advanced installation, make `PORT` and `SYNC_PUBLIC_URL` match:

```bash
SYNC_DATA_DIR="$HOME/locoris-personal-data" \
PORT=26748 \
SYNC_PUBLIC_URL="http://localhost:26748" \
npm run sync-server
```

The named `locoris-personal-data` volume is the complete persistence boundary. Recreating the container does not rotate tokens or remove vaults as long as this volume is preserved.

Set `LOCORIS_PORT` and `LOCORIS_PUBLIC_URL` in `.env` to the port and address other devices can reach. For a local network that can be `26747` and `http://192.168.1.20:26747`; for remote access use an HTTPS reverse proxy or a private network such as Tailscale. `localhost` only works when Locoris and the server are on the same computer.

## Locoris Server For Desktop

Open the GitHub release whose tag starts with `server-v` and download the Locoris Server installer for your system:

- macOS: `.dmg`;
- Windows: `.exe` installer;
- Linux: `.AppImage` or `.deb`.

Each platform also publishes a `SHA256SUMS-*.txt` file so the downloaded installer can be verified before launch.

On first launch, Locoris Server creates a permanent data directory, starts the same SQLite + files runtime as Docker, and opens a one-time owner invitation. Use **Open in Locoris**, copy the invitation, or enter the shown server address and short code. Closing the window keeps the server running in the system tray; the tray menu can reopen it, enable start-at-login, or stop it completely.

The desktop server always starts on `26747` unless a custom port was saved in **Network**. It never silently chooses a random replacement. If the port is occupied, the window explains the conflict and lets the user choose a free port from `1024` to `49151`; saving requires confirmation and restarts the server. Installations managed with the `PORT` environment variable remain read-only in this screen.

Locoris Server advertises `_locoris-sync._tcp.local` on the local network. Desktop and Android apps can therefore find the same server identity after its address or port changes. An existing connection is updated only after Locoris verifies both the `serverId` and that device's existing credential; vault bindings, tokens, cursors, and sync history are preserved. Web clients can use the address shown in the server window or the endpoint-update link/QR.

Linux containers using ordinary bridge networking may not forward multicast DNS to the LAN. In that case use the explicit reachable URL shown in Locoris, or host networking where appropriate; endpoint verification and manual address updates remain available.

For another device on the same network, use the computer's LAN address instead of `localhost` and allow the selected port through the operating-system firewall. For access over the internet, do not expose plain HTTP directly: use an HTTPS reverse proxy or a private overlay network. When creating an invitation in Locoris, the address field must contain the URL that the invited device can actually reach.

## Devices And Invitations

After the first owner device connects, Locoris exposes **Devices and access** on the self-hosted sync card.

- **Add my device** creates a 15-minute, single-use owner invitation.
- **Invite guest** grants access only to selected vaults. The owner must compare the confirmation phrase and approve the request.
- Every device receives an independent credential. Revoking a device immediately invalidates its management credential and every vault sync token issued to it.
- Invitations expire, are single-use, and can be revoked before use.

For a remote person, send the copied invitation link through a trusted channel. They do not need a management token, shell access, or a camera.

## Data Layout

When `SYNC_DATA_DIR` is not set, the server uses:

- macOS: `~/Library/Application Support/Locoris/Personal Server`
- Windows: `%LOCALAPPDATA%\\Locoris\\Personal Server`
- Linux: `$XDG_DATA_HOME/locoris/personal-server` or `~/.local/share/locoris/personal-server`

The volume contains:

```text
locoris-personal.sqlite3       SQLite metadata and token hashes
locoris-personal.sqlite3-wal   SQLite write-ahead log while the server is running
management-token              Generated fallback management secret
vaults/                        Vault snapshots and bounded delta journals
legacy-json/                   Archived metadata imported from the old JSON backend
.trash/                        Crash-safe staging for vault deletion
```

Do not mount only the SQLite file or only `vaults/`; both are required for a complete server.

## Legacy JSON Migration

On the first start with the SQLite backend, existing `personal-config.json` and `registry.json` are validated and imported in one database transaction. Existing vault snapshot and journal files stay in place. After a successful import, the two metadata files move to a timestamped `legacy-json/` directory.

The migration marker is stored in SQLite, so an interrupted archive step cannot import tokens or vaults twice. Once initialized, JSON metadata is never used as the active backend. Keep the archived files until the migrated server has been verified.

The old `SYNC_TOKEN` variable is accepted only during this migration and is converted to a hashed token for the legacy default vault. Existing `SYNC_MANAGEMENT_TOKEN` deployments remain compatible, but new devices should use one-time pairing. The app issues per-vault tokens through the authenticated device API.

## Backup And Restore

The safest backup is a copy of the entire data directory while the server is stopped:

```bash
docker compose -f compose.example.yml stop
docker run --rm \
  -v locoris-personal-data:/data:ro \
  -v "$PWD/backups":/backup \
  busybox tar czf /backup/locoris-personal-data.tar.gz -C /data .
docker compose -f compose.example.yml start
```

Restore into an empty volume while the server is stopped. Never combine a database from one backup with vault files from another. SQLite WAL is checkpointed on graceful `SIGTERM`/`SIGINT`, but backing up the whole stopped volume remains the portable option across Docker, Windows, macOS, and Linux.

## Operational Settings

- `PORT`: advanced HTTP port override, default `26747`. Desktop users normally change it in **Network** instead.
- `SYNC_DATA_DIR`: permanent server data directory.
- `SYNC_PUBLIC_URL`: reachable base URL embedded into setup links and QR codes.
- `SYNC_MDNS`: set to `0` to disable `_locoris-sync._tcp.local` discovery advertising.
- `SYNC_PRINT_QR`: set to `0` to suppress the console QR code; desktop Locoris Server does this automatically.
- `SYNC_MANAGEMENT_TOKEN`: optional disaster-recovery override; not required for normal device pairing.
- `SYNC_JOURNAL_MAX_BYTES`: maximum journal size per vault, default `2097152` (2 MiB, minimum 64 KiB). When old deltas are pruned, clients automatically receive a full snapshot.

The `/health` response reports `storage.backend: "sqlite-files"`, the schema version, and WAL mode. The server serializes writes per vault, uses optimistic revisions, writes snapshot files atomically, and stages deletions so a process interruption cannot silently detach live data.

## Upgrade Checklist

1. Back up the complete data volume.
2. Stop the old server.
3. Start the new image against the same volume.
4. Check `/health` and confirm the expected vault count in the app.
5. Sync one existing plain or private vault from two devices.
6. Keep `legacy-json/` through at least one verified backup cycle.

## License

Locoris Server is part of the public Locoris project and is licensed under
[`AGPL-3.0-or-later`](../../LICENSE). Third-party notices are maintained in
[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md). Modified network
deployments must continue to provide their corresponding source as required by
the AGPL. The Locoris name and brand are covered separately by the
[trademark policy](../../TRADEMARKS.md).
