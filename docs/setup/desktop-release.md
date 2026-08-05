# Locoris Release Flow

This document describes the current release flow for Locoris desktop and Android builds.

The canonical workflow is:

- [`.github/workflows/tauri-desktop-release.yml`](../../.github/workflows/tauri-desktop-release.yml)

The workflow builds and publishes release assets from tags matching:

```text
app-v*
```

Example:

```text
app-v1.0.39
```

## Version Locations

For version `X.Y.Z`, update:

- `package.json`
- `package-lock.json`
- `apps/app/package.json`
- `apps/app/src-tauri/tauri.conf.json`
- `apps/app/src-tauri/Cargo.toml`

## Checks

Run before release:

```bash
npm run typecheck
npm run build
git diff --check
```

## Release Steps

```bash
git add ...
git commit -m "Release X.Y.Z"
git push origin main
git tag app-vX.Y.Z
git push origin app-vX.Y.Z
gh run list --repo locoris/locoris --limit 5
```

Important:

- A normal push to `main` does not start the release workflow.
- The release workflow starts on `app-v*` tags or manual dispatch.
- Release commits should include the whole intended app state unless a selective release is explicitly requested.

## Distribution Notes

Direct downloads are expected until App Store and Google Play distribution are available.

The public website should be the main user-facing download surface. GitHub Releases can remain the transparent artifact source, but non-technical users should not need to browse GitHub manually.

## Signing Notes

Tauri updater signing verifies update artifacts and manifests.

It is not the same as:

- Apple signing and notarization;
- Windows Authenticode signing;
- Google Play distribution signing.

Until platform signing is available, macOS Gatekeeper and Windows SmartScreen warnings are expected and should be explained clearly on the download page.
