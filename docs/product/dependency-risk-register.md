# Dependency Risk Register

This register records dependency advisories that cannot currently be resolved
with a compatible patch. It prevents accepted risks from becoming invisible
while keeping breaking framework migrations out of routine security updates.

Maintainer: `angrein`  
Last reviewed: 2026-08-09  
Review cadence: weekly Dependabot review, before every release, and immediately
after a new critical advisory.

## Release policy

- A reachable critical issue blocks a release until it is fixed or mitigated.
- A reachable high issue with a compatible fix must be patched before release.
- `npm audit fix --force` and unreviewed dependency overrides are not accepted
  remediation strategies.
- Major and pre-1.0 minor migrations require their own pull request, migration
  review, automated checks, and platform smoke tests.
- An exception is removed only after its remediation pull request is merged and
  GitHub rescans the default branch.

## Open exceptions

Alert counts below are a snapshot from GitHub Dependabot on 2026-08-09. Counts
can change when GitHub publishes or consolidates advisories; the package,
reachability, and remediation decision are the durable parts of this register.

| Dependency | Current path | Alerts | Severity / scope | Exposure and compensating controls | Exit criteria |
| --- | --- | ---: | --- | --- | --- |
| Electron `37.10.3` | Locoris Server desktop shell | 62 | High to low / development | Desktop-server packaging only. It does not power the main Tauri application. Routine patches remain enabled; major migration is isolated from application security patches. | Upgrade to the next supported Electron line in a dedicated PR and smoke-test installation, startup, local management, persistence, and uninstall on Windows, macOS, and Linux. |
| Mermaid `11.15.0` | `@excalidraw/mermaid-to-excalidraw` | 5 | Medium to low / runtime | Mermaid source is converted into editable canvas data. Updates are constrained by the Excalidraw conversion stack and must preserve parsing and generated-canvas behavior. | Upstream-compatible update followed by malformed-input, large-diagram, import, edit, save, and reopen tests. |
| `lodash-es` `4.17.21` | Mermaid, Langium, and Chevrotain | 3 | High to medium / runtime | Locoris does not call the affected package as an application or authentication API; it arrives through parser stacks. A forced override could create several incompatible parser copies. | Upstream packages accept a patched version, or a tested override passes editor and Mermaid regression coverage. |
| `nanoid` `3.3.3` and `4.0.2` | Excalidraw and Mermaid conversion | 2 | Medium / runtime | Used for document and diagram identifiers, not credentials, pairing secrets, encryption keys, or bearer tokens. | Excalidraw and Mermaid conversion stacks move to patched compatible releases and canvas identity round-trip tests pass. |
| `uuid` `8.3.2` | BlockNote `0.47.3` | 1 | Medium / runtime | Used inside the editor stack for document identity, not for authentication or secret generation. BlockNote `0.x` updates are treated as migrations because they may alter schema and serialization behavior. | Dedicated BlockNote migration with old-note fixtures, editing, undo, export, sync, and cross-device reopen tests. |
| `glib` `0.18.5` | Tauri Linux dependency graph | 1 | Medium / runtime | Native Linux desktop dependency. Updating it requires a coordinated GTK/Tauri dependency-chain migration rather than a single lockfile patch. | Compatible Tauri/GTK chain update plus Linux compile, launch, window, file-dialog, and packaging checks. |
| esbuild `0.25.12` | Locoris Server build tooling | 1 | Low / development | Development and packaging dependency, not a server runtime request handler. Pre-1.0 minor jumps may be breaking and are excluded from automatic safe groups. | Dedicated `0.28.x` compatibility PR with server bundle, Docker image, packaged desktop runtime, and startup smoke tests. |

## Resolved baseline

The initial remediation series fixed reachable note-export sanitization,
session secret persistence, OAuth and pairing randomness, and server URL
normalization. Compatible npm, Cargo, and website dependency patches were
applied separately. Confirmed CodeQL false positives and accepted session-only
storage findings carry individual explanations in GitHub rather than blanket
dismissals.

Related controls:

- GitHub Actions must be pinned to complete commit SHAs.
- `main` requires application, personal-server, native-core, and legal-notice
  checks.
- Secret scanning and push protection are enabled.
- Dependabot checks npm, Cargo, GitHub Actions, and Docker every week.
