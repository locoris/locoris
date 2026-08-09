# Installing direct Locoris builds

Locoris currently distributes builds directly while paid Apple and Windows platform certificates and app-store accounts are deferred. An operating-system warning is therefore expected; a checksum or GitHub attestation must be verified before using the documented override.

## macOS Apple Silicon

1. Download the Apple Silicon DMG from the official Locoris release.
2. Run `shasum -a 256 Locoris_*.dmg` and compare the complete value with `SHA256SUMS.txt`.
3. Drag Locoris to Applications and try to open it once.
4. Open **System Settings → Privacy & Security**. In **Security**, find the blocked Locoris message and choose **Open Anyway**.
5. Confirm **Open**. macOS remembers this choice for that application build.

Do not use `xattr -dr com.apple.quarantine`, disable Gatekeeper globally, or run an unknown copy from a mirror. Managed computers can block overrides entirely; use the web version or ask the administrator.

Locoris does not publish Intel macOS builds.

## Windows x64

1. Download the EXE or MSI from the official release.
2. In PowerShell run `Get-FileHash .\Locoris_* -Algorithm SHA256` and compare the complete value.
3. If Microsoft Defender SmartScreen appears, inspect the app and publisher warning, choose **More info**, then **Run anyway** only after verification.

Do not disable SmartScreen system-wide. Organization policy can remove the override; use the web version or ask the administrator.

## Android

The APK is cryptographically signed with the stable Locoris release key. APK signing itself is free and is already required by Android.

1. Download the APK from Locoris or its linked GitHub release.
2. Compare its SHA-256 checksum.
3. Allow APK installation only for the browser or file manager used for this download.
4. Install the APK, then remove that temporary installation permission if it is no longer needed.

Android updates install over the existing app only when the package name and signing certificate match. Never replace Locoris with a repackaged APK from a third-party mirror.
