import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { stripTrailingSlashes } from "../server-utils.mjs";

test("trailing slash normalization stays linear for adversarial input", () => {
  const adversarialValue = `${"/".repeat(20_000)}x`;
  const startedAt = performance.now();

  const result = stripTrailingSlashes(adversarialValue);
  const durationMs = performance.now() - startedAt;

  assert.equal(result, adversarialValue);
  assert.ok(durationMs < 75, `normalization took ${durationMs.toFixed(1)}ms`);
  assert.equal(stripTrailingSlashes("https://sync.example.com////"), "https://sync.example.com");
});
