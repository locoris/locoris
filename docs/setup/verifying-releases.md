# Verify Locoris releases

Every hardened Locoris release publishes `SHA256SUMS.txt`, software bill of materials files, and GitHub artifact attestations. The Android release also publishes the signing-certificate SHA-256 fingerprint.

## Checksums

```bash
# macOS or Linux
shasum -a 256 <downloaded-file>

# Windows PowerShell
Get-FileHash <downloaded-file> -Algorithm SHA256
```

Compare the full 64-character value, not only its beginning or end.

## GitHub artifact attestation

With GitHub CLI installed:

```bash
gh attestation verify <downloaded-file> --repo locoris/locoris
```

The verification must identify `locoris/locoris` and the official release workflow. Checksums detect corruption; attestations also bind an artifact to the GitHub Actions identity that built it.

## Docker

Use immutable numbered tags for production. Release notes publish the manifest digest. Verify the keyless Cosign signature:

```bash
cosign verify \
  --certificate-identity-regexp '^https://github.com/locoris/locoris/.github/workflows/personal-server-release.yml@refs/(tags/server-v.*|heads/main)$' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/locoris/locoris-server@sha256:<digest>
```

The Docker manifest includes BuildKit provenance and an SBOM for both `linux/amd64` and `linux/arm64`.
