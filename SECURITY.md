# Locoris Security Policy

Locoris stores personal knowledge and synchronizes encrypted user data, so
security reports are treated as product-critical work.

## Supported versions

Security fixes target the latest stable release and the current `main` branch.
Older releases may receive a fix when the issue is severe and a safe backport is
practical, but users should normally update to the latest release.

## Report a vulnerability

Do not open a public issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting flow:

1. Open the **Security** tab of this repository.
2. Select **Report a vulnerability**.
3. Include affected versions and platforms, reproduction steps, impact, and any
   suggested mitigation.

The same channel may be used for issues affecting the official Locoris Cloud
service when no public reproduction can be shared safely. Do not include real
user content, credentials, recovery material, encryption keys, or access tokens
in a report. Use synthetic data and redact logs.

## What to expect

For a complete report, the maintainer aims to:

- acknowledge receipt within five business days;
- provide an initial assessment within ten business days;
- keep the reporter informed at meaningful milestones;
- coordinate disclosure after a fix or mitigation is available.

These are response targets for a solo-maintained project, not a service-level
agreement. Complex cross-platform or cryptographic issues may require more time.

## Scope priorities

High-priority reports include authentication bypass, unauthorized vault access,
remote code execution, sync isolation failures, secret leakage, signature or
update compromise, encryption defects, destructive migration behavior, and
cross-account data exposure.

Product support questions, availability problems without a security impact,
and reports based only on automated version matching may be filed as ordinary
issues. A dependency report is actionable when it explains reachability or the
specific impact on Locoris.

## Dependency exceptions

Advisories without a compatible patch are tracked in the
[dependency risk register](docs/product/dependency-risk-register.md). The
register documents reachability, compensating controls, review cadence, and the
tests required to remove each temporary exception. Major editor and desktop
runtime migrations are reviewed separately from routine security patches.

## Disclosure

Please allow reasonable time for investigation, coordinated fixes, release
signing, and user updates before public disclosure. Locoris will credit
reporters who request credit and will not publish their personal information
without permission.
