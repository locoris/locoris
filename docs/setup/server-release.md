# Locoris Server release flow

The canonical workflow is [`.github/workflows/personal-server-release.yml`](../../.github/workflows/personal-server-release.yml). It builds desktop packages and the multi-architecture Docker manifest from tags matching `server-vX.Y.Z`.

## Prepare the version

Update these files to the same version:

- `apps/personal-server/package.json`;
- `package-lock.json` when npm changes it;
- `docs/self-hosting/compatibility.json`;
- `docs/self-hosting/compatibility.md`.

Add `docs/releases/server/X.Y.Z.md`. Every release note must describe security, compatibility, migration, update, rollback, known issues, and verification. Empty generated notes are rejected.

## Verify locally

```bash
npm test --workspace @locoris/personal-server
npm run release:notes:check -- --kind server --version X.Y.Z
npm run desktop:dist --workspace @locoris/personal-server
npm run desktop:smoke --workspace @locoris/personal-server
git diff --check
```

The desktop build verifies the current host platform. The protected release workflow repeats it on macOS Apple Silicon, Windows x64, and Linux x64, then builds native Docker images on `linux/amd64` and `linux/arm64` runners.

## Publish through the protected branch

```bash
git switch -c codex/server-release-X.Y.Z
git add --all
git commit --signoff -m "Release Locoris Server X.Y.Z"
git push -u origin codex/server-release-X.Y.Z
gh pr create --base main --head codex/server-release-X.Y.Z
gh pr checks --watch
gh pr merge --squash --delete-branch
git switch main
git pull --ff-only origin main
git tag server-vX.Y.Z
git push origin server-vX.Y.Z
gh run list --repo locoris/locoris --workflow personal-server-release.yml --limit 5
```

The tag is created only after the protected pull request is merged. The workflow stages everything in a hidden draft and publishes only after desktop smoke tests, native Docker health checks, checksums, SBOMs, provenance, signatures, and attestations succeed.

## Distribution trust

- macOS packages are Apple Silicon only and use an ad-hoc signature until Developer ID signing and notarization are available.
- Windows packages remain unsigned until a maintained Authenticode certificate is available.
- Docker manifests are keyless-signed with Cosign and should be deployed by numbered version or digest.
- A failed release remains a draft. Diagnose the failed job and rerun the existing tag only after the source state at that tag is understood.

Never move an existing release tag to another commit.
