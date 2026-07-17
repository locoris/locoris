# Locoris Sync

Locoris supports multiple sync paths while keeping the app local-first.

## Sync Providers

### Locoris Cloud

Managed hosted sync for users who want convenience, multi-device continuity, account-based access, history, and future paid cloud features.

Hosted sync is the commercial cloud path. It should be easy to connect in the app without requiring normal users to copy manual tokens.

### Self-hosted Sync

The personal server is a free self-hosted runtime for users who want control. It supports owner devices, scoped guest devices, and many remote vaults.

Normal onboarding uses a one-time invitation represented as a link, short code, and optional QR. Each device receives its own revocable credential. Manual recovery-token entry remains only for legacy and disaster-recovery cases.

### Google Drive Sync

Google Drive sync stores Locoris sync data in the hidden Google Drive `appDataFolder`.

This keeps Locoris files out of the user's visible Drive folders while still allowing the user to sync through their own Google account.

The production transport uses immutable checkpoints and commits. This prevents two devices from overwriting each other's last write: an unmerged concurrent commit remains recoverable until a later checkpoint includes it. Web reconnect is intentionally user-driven when Google requires a gesture; desktop refresh tokens stay in native secure storage, and Android authorization is managed by Google Play Services.

## Payload Modes

Locoris sync supports:

- plain payloads;
- encrypted payloads.

Private vaults and encrypted sync flows use client-side encrypted payloads. Remote transports store encrypted snapshots and encrypted change records.

## Remote Vault Bindings

A local vault can be bound to a remote vault through a sync connection.

The app should make these states clear:

- local vault has no remote binding;
- local vault is bound and synced;
- remote vault exists but is not imported locally;
- binding needs reconnect or token refresh;
- remote vault was deleted elsewhere;
- local and remote names conflict;
- encrypted vault is locked until passphrase is entered.

## Conflict Direction

Locoris should avoid silent destructive merges. When conflict resolution cannot be proven safe, the product direction is to create a recoverable duplicate or present a clear manual recovery path.

## UX Direction

Normal hosted sync should become a premium app-driven flow:

1. connect Locoris Cloud;
2. sign in through browser or device-code flow;
3. choose or create a hosted vault;
4. upload current local vault or import an existing remote vault;
5. unlock private vaults with the passphrase when needed;
6. show stable synced status and recoverable errors.

Manual recovery-token entry remains available behind the advanced self-hosted flow for legacy and disaster-recovery cases.
