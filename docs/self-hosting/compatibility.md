# Locoris Server compatibility

The machine-readable source is [`compatibility.json`](compatibility.json). The running server exposes the same protocol and schema contract in `/health`, `/v1/capabilities`, and `/v1/pairing/info`.

| Surface | Current contract |
| --- | --- |
| Server | 0.1.7 |
| API | 1 |
| Sync protocol | 1 |
| Pairing protocol | 1 |
| Storage schema | 2 |
| Minimum client | 1.0.0 |
| Docker | Linux amd64 and arm64 |
| Desktop server | macOS Apple Silicon, Windows x64, Linux x64 |

Protocol versions change only when an older client cannot safely continue. Storage schema changes must include an automatic forward migration and a documented backup-based rollback. A newer compatible server must preserve device identities, vault bindings, encrypted payloads, and revision history.

Locoris does not publish Intel macOS server builds. Existing Intel artifacts remain historical downloads but are not supported by new releases.
