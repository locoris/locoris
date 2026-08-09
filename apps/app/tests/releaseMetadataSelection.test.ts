import assert from "node:assert/strict";
import test from "node:test";

import { selectReleaseByTag } from "../../../scripts/release-metadata-selection.mjs";

test("uses a public release returned by the tag endpoint", () => {
  const release = { tag_name: "app-v1.0.50", draft: false, prerelease: false };
  assert.equal(selectReleaseByTag({
    directRelease: release,
    releaseTag: "app-v1.0.50"
  }), release);
});

test("finds an authorized hidden draft only when explicitly allowed", () => {
  const release = { tag_name: "app-v1.0.50", draft: true, prerelease: false };
  assert.equal(selectReleaseByTag({
    directRelease: null,
    listedReleases: [{ tag_name: "app-v1.0.49", draft: true }, release],
    releaseTag: "app-v1.0.50",
    allowDraft: true
  }), release);
});

test("rejects a hidden draft in normal validation mode", () => {
  assert.throws(() => selectReleaseByTag({
    directRelease: null,
    listedReleases: [{ tag_name: "app-v1.0.50", draft: true }],
    releaseTag: "app-v1.0.50"
  }), /still a draft/);
});

test("never substitutes another tag or a prerelease", () => {
  assert.throws(() => selectReleaseByTag({
    directRelease: null,
    listedReleases: [{ tag_name: "app-v1.0.49", draft: true }],
    releaseTag: "app-v1.0.50",
    allowDraft: true
  }), /was not found/);
  assert.throws(() => selectReleaseByTag({
    directRelease: { tag_name: "app-v1.0.50", draft: false, prerelease: true },
    releaseTag: "app-v1.0.50"
  }), /prerelease/);
});
