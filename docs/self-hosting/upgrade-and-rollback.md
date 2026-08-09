# Upgrade and rollback Locoris Server

## Before every update

1. Read the complete server release notes, especially Compatibility, Migration, and Known issues.
2. Record the currently running server or Docker image version.
3. Stop writes by closing connected Locoris clients when practical.
4. Stop Locoris Server and back up the entire data boundary, including SQLite, WAL files, `vaults/`, `legacy-json/`, and `.trash/`.
5. Keep the previous installer or immutable Docker image tag until verification is complete.

## Desktop update

Install the new Locoris Server package over the existing application. Do not delete the data directory. Start the server, open `/health`, and confirm the expected server version, storage schema, and vault count.

## Docker update

Pin production installations to a numbered version instead of `latest`:

```bash
docker compose stop
docker compose pull
docker compose up -d
docker compose exec locoris-personal-server node -e "fetch('http://127.0.0.1:26747/health').then(r => r.json()).then(console.log)"
```

The release manifest supports `linux/amd64` and `linux/arm64`; Docker selects the matching image automatically.

## Verification

1. Confirm `/health` reports `ok: true`, `storage.backend: sqlite-files`, and the expected vault count.
2. Open Locoris on an existing device without creating a new pairing.
3. Sync one ordinary vault in both directions.
4. Sync one encrypted vault and confirm the server still reports only encrypted payload metadata.
5. Restart the server once and repeat a sync.
6. Keep the backup through at least one normal backup cycle.

## Rollback

Never run an older server against a data directory after a newer storage migration unless that release explicitly says it is backward compatible.

1. Stop the new server.
2. Move the post-update data directory aside for diagnosis.
3. Restore the complete pre-update backup as one unit.
4. Reinstall the previous desktop package or select the previous immutable Docker tag.
5. Start the server and repeat the verification checklist.

Do not copy only the database or only `vaults/`; mixing generations can create revisions the metadata cannot account for.
