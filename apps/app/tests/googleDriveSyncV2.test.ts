import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGoogleDriveV2Cursor,
  buildGoogleDriveV2FileName,
  collectGoogleDriveV2UnappliedCommits,
  parseGoogleDriveV2FileName,
  planGoogleDriveV2CommitRetention,
  selectGoogleDriveV2Checkpoint
} from "../src/lib/googleDriveSyncV2.ts";

test("v2 file names round-trip vault and record identities", () => {
  const fileName = buildGoogleDriveV2FileName("commit", "vault.with spaces", "rev-1");
  assert.deepEqual(parseGoogleDriveV2FileName(fileName), {
    kind: "commit",
    vaultId: "vault.with spaces",
    recordId: "rev-1"
  });
});

test("checkpoint selection favors the most complete branch", () => {
  const selected = selectGoogleDriveV2Checkpoint([
    {
      checkpointId: "newer-stale",
      coveredCommitCount: 4,
      appliedCommitIds: ["a"],
      createdAt: 200
    },
    {
      checkpointId: "older-complete",
      coveredCommitCount: 7,
      appliedCommitIds: ["a", "b", "c"],
      createdAt: 100
    }
  ]);

  assert.equal(selected?.checkpointId, "older-complete");
});

test("concurrent immutable commits remain visible after selecting one checkpoint", () => {
  const checkpoint = {
    checkpointId: "checkpoint-b",
    coveredCommitCount: 2,
    appliedCommitIds: ["base", "commit-b"],
    createdAt: 200
  };
  const commits = [
    { commitId: "commit-a", createdAt: 190 },
    { commitId: "commit-b", createdAt: 200 }
  ];

  assert.deepEqual(
    collectGoogleDriveV2UnappliedCommits(checkpoint, commits).map((commit) => commit.commitId),
    ["commit-a"]
  );
  assert.notEqual(
    buildGoogleDriveV2Cursor(checkpoint, commits),
    buildGoogleDriveV2Cursor(checkpoint, commits.slice(1))
  );
});

test("retention never deletes an unapplied concurrent commit", () => {
  const files = Array.from({ length: 5 }, (_, index) => ({
    id: `file-${index}`,
    name: buildGoogleDriveV2FileName("commit", "vault", `commit-${index}`),
    createdTime: new Date(1_000 + index).toISOString(),
    modifiedTime: new Date(1_000 + index).toISOString(),
    size: 100
  }));
  const plan = planGoogleDriveV2CommitRetention(
    files,
    new Set(["commit-0", "commit-1", "commit-2", "commit-4"]),
    { maxCount: 1, maxBytes: 100 }
  );

  assert.equal(plan.retainedFileIds.has("file-3"), true);
  assert.equal(plan.deleteFileIds.includes("file-3"), false);
});
