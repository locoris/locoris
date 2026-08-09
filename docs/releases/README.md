# Release notes contract

Every public application and Locoris Server release has a versioned Markdown file in this directory. The release workflow validates that file before publishing any artifact and uses it as the GitHub Release body.

Required sections are intentionally explicit: summary, security, added, improved, fixed, compatibility, migration, update, rollback, known issues, and verification. Write `None for this release.` when a section genuinely has no entry. Empty sections and placeholders fail the release.

Use:

```bash
npm run release:notes:check -- --kind app
npm run release:notes:check -- --kind server
```

Application notes live in `docs/releases/app/`; server notes live in `docs/releases/server/`.
