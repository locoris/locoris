# Android release signing operations

Android APK signing is free. The private Locoris keystore is the product identity: losing it prevents in-place updates, and leaking it allows an attacker to sign a malicious update that Android accepts as Locoris.

## Required GitHub secrets

- `ANDROID_RELEASE_KEYSTORE_BASE64`
- `ANDROID_RELEASE_KEYSTORE_PASSWORD`
- `ANDROID_RELEASE_KEY_ALIAS`
- `ANDROID_RELEASE_KEY_PASSWORD`

The workflow decodes the keystore only into the temporary runner directory, verifies the finished APK with `apksigner`, and publishes the SHA-256 signing-certificate fingerprint beside the APK.

## Backup policy

Keep at least two encrypted offline copies in different physical locations. Store passwords separately from the keystore. Test restoration by listing the certificate, never by rotating the production key:

```bash
keytool -list -v -keystore locoris-release.keystore -alias <alias>
```

Record the certificate SHA-256 fingerprint outside GitHub. Every release must match the recorded value. Never commit the keystore, passwords, Base64 payload, or decrypted temporary files.

Current pinned production fingerprint:

```text
b6f8dfa354b44da34ed25ec3476d327768584687e72fa42fabd1a1f61f4e5869
```
