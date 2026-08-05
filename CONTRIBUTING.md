# Contributing to Locoris

Thank you for helping make private, local-first knowledge tools better.
Locoris is currently a maintainer-led project, so the contribution process is
kept intentionally small, predictable, and respectful of contributor time.

## Before you start

- Search existing issues and discussions before opening a new one.
- Open an issue before investing in a substantial feature, protocol change,
  migration, or interface redesign.
- Use a private security report instead of a public issue for vulnerabilities;
  see [SECURITY.md](SECURITY.md).
- Keep pull requests focused. Unrelated cleanup should be submitted separately.

The managed Locoris Cloud service and the marketing website are maintained in
separate private repositories. This repository accepts contributions to the
public application, sync core, self-hosted server, documentation, tests, and
release tooling.

## Development

Locoris uses Node.js 24 and npm workspaces.

```bash
npm ci
npm run typecheck
npm run build
npm run i18n:check
npm test --workspace @locoris/personal-server
npm run notices:check
git diff --check
```

Run the checks relevant to your change and describe any check you could not
run in the pull request. Platform-specific changes should explain which of web,
macOS, Windows, Android, portrait mobile, and tablet layouts were considered.

## Product and interface changes

- Follow the existing Locoris visual language and interaction patterns.
- Treat mobile portrait as its own experience, not a compressed desktop view.
- Avoid clipped copy, hover-only actions, inaccessible touch targets, and
  layout shifts caused by transient status text.
- Include keyboard, screen-reader, reduced-motion, empty, loading, error, and
  long-content states where they apply.
- Update every supported locale when adding user-facing copy.

## Developer Certificate of Origin

Locoris uses the [Developer Certificate of Origin](DCO), not a Contributor
License Agreement. By signing off a commit, you certify that you have the right
to submit the contribution under the repository's license.

Sign each commit with:

```bash
git commit --signoff
```

This adds a line in the following form:

```text
Signed-off-by: Your Name <your.email@example.com>
```

The sign-off may use the identity by which you can reliably certify the
contribution. It must not impersonate another person. The complete certificate
is in [DCO](DCO).

## Licensing and provenance

Contributions are accepted under `AGPL-3.0-or-later`, with no additional terms.
Do not submit code, media, fonts, datasets, or generated material unless you
have the right to license it accordingly. Preserve upstream notices and update
the third-party notice configuration when introducing a dependency.

AI-assisted work is allowed, but the contributor remains responsible for its
correctness, security, originality, and license compatibility. Disclose
substantial generated code or assets in the pull request.

## Review and decisions

Review considers product fit, user impact, privacy, maintainability,
cross-platform behavior, migration risk, tests, and long-term support cost.
Acceptance is not guaranteed merely because a change is technically valid.
The decision model is described in [GOVERNANCE.md](GOVERNANCE.md).
