import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/lib/googleDriveDesktopOAuth", () => ({
  connectGoogleDriveDesktopAccount: vi.fn(),
  desktopGoogleDriveOAuthReady: () => false,
  isDesktopGoogleDriveOauthRuntime: () => false,
  prepareGoogleDriveDesktopOAuth: vi.fn(),
  refreshGoogleDriveDesktopAccountSession: vi.fn(),
  revokeGoogleDriveDesktopAccess: vi.fn()
}));

vi.mock("../src/lib/googleDriveAndroidOAuth", () => ({
  androidGoogleDriveOAuthReady: () => false,
  clearGoogleDriveAndroidAccessToken: vi.fn(),
  isAndroidGoogleDriveOauthRuntime: () => false,
  prepareGoogleDriveAndroidOAuth: vi.fn(),
  requestGoogleDriveAndroidAccessToken: vi.fn(),
  revokeGoogleDriveAndroidAccess: vi.fn()
}));

import {
  GOOGLE_DRIVE_MANIFEST_FILE,
  listGoogleDriveRemoteVaults,
  loadGoogleDriveRemoteBootstrap,
  loadGoogleDriveRemoteRevision,
  probeGoogleDriveConnection
} from "../src/lib/googleDriveSync";
import { buildGoogleDriveV2FileName } from "../src/lib/googleDriveSyncV2";

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("Google Drive catalog", () => {
  test("loads an indexed catalog without reading vault history", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.includes("alt=media")) {
        return jsonResponse({
          schemaVersion: 1,
          provider: "googleDrive",
          folder: "appDataFolder",
          updatedAt: 2_000,
          vaults: [
            {
              id: "vault-1",
              name: "Main vault",
              fileId: "legacy-file-1",
              journalFileId: "journal-file-1",
              vaultKind: "private",
              updatedAt: 1_500,
              revision: "revision-1"
            }
          ]
        });
      }

      return jsonResponse({
        files: [
          {
            id: "manifest-file",
            name: GOOGLE_DRIVE_MANIFEST_FILE,
            modifiedTime: "2026-08-21T09:00:00.000Z"
          }
        ]
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listGoogleDriveRemoteVaults("access-token")).resolves.toEqual([
      expect.objectContaining({
        id: "vault-1",
        name: "Main vault",
        vaultKind: "private",
        lastRevision: "revision-1"
      })
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toEqual(
      expect.arrayContaining([expect.stringContaining("legacy-file-1")])
    );
  });

  test("deduplicates concurrent catalog opens", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      await Promise.resolve();

      if (url.includes("alt=media")) {
        return jsonResponse({
          schemaVersion: 1,
          provider: "googleDrive",
          folder: "appDataFolder",
          updatedAt: 2_000,
          vaults: [
            {
              id: "vault-1",
              name: "Main vault",
              fileId: "legacy-file-1",
              vaultKind: "regular",
              updatedAt: 1_500,
              revision: null
            }
          ]
        });
      }

      return jsonResponse({
        files: [{ id: "manifest-file", name: GOOGLE_DRIVE_MANIFEST_FILE }]
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([
      listGoogleDriveRemoteVaults("shared-access-token"),
      listGoogleDriveRemoteVaults("shared-access-token")
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("probes token availability without loading the catalog", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        user: {
          permissionId: "permission-id"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      probeGoogleDriveConnection({ sessionToken: "access-token" })
    ).resolves.toBe("available");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/drive/v3/about");
  });

  test("downloads only the selected checkpoint and unapplied commit", async () => {
    const vaultId = "vault-1";
    const selectedCheckpoint = {
      schemaVersion: 2,
      provider: "googleDrive",
      recordType: "checkpoint",
      checkpointId: "checkpoint-selected",
      vaultId,
      vaultName: "Main vault",
      vaultKind: "regular",
      createdAt: 2_000,
      coveredCommitCount: 2,
      appliedCommitIds: ["commit-applied"],
      baseCursor: null,
      metadata: {
        schemaVersion: 1,
        payloadMode: "plain",
        vault: null,
        encryption: null
      },
      envelope: {
        revision: "snapshot-revision",
        snapshot: {
          deviceId: "device-1",
          exportedAt: 2_000,
          projects: [],
          folders: [],
          tags: [],
          notes: [],
          assets: [],
          tasks: [],
          habits: [],
          habitLogs: [],
          goals: [],
          timeBlocks: [],
          tombstones: []
        },
        metadata: {
          schemaVersion: 1,
          payloadMode: "plain",
          vault: null,
          encryption: null
        }
      }
    } as const;
    const staleCheckpoint = {
      ...selectedCheckpoint,
      checkpointId: "checkpoint-stale",
      createdAt: 3_000,
      coveredCommitCount: 1,
      appliedCommitIds: []
    } as const;
    const unappliedCommit = {
      schemaVersion: 2,
      provider: "googleDrive",
      recordType: "commit",
      commitId: "commit-unapplied",
      vaultId,
      vaultName: "Main vault",
      vaultKind: "regular",
      baseCursor: null,
      createdAt: 4_000,
      changes: {
        deviceId: "device-2",
        exportedAt: 4_000,
        projects: [],
        folders: [],
        tags: [],
        notes: [],
        assets: [],
        tasks: [],
        habits: [],
        habitLogs: [],
        goals: [],
        timeBlocks: [],
        tombstones: []
      },
      encryptedChanges: null,
      metadata: selectedCheckpoint.metadata
    } as const;
    const files = [
      {
        id: "legacy-file",
        name: "vault-vault-1.json",
        createdTime: "2026-08-20T08:00:00.000Z",
        modifiedTime: "2026-08-20T08:00:00.000Z",
        size: "100"
      },
      {
        id: "checkpoint-selected-file",
        name: buildGoogleDriveV2FileName("checkpoint", vaultId, "checkpoint-selected"),
        createdTime: "2026-08-21T08:00:00.000Z",
        modifiedTime: "2026-08-21T08:00:00.000Z",
        size: "1000"
      },
      {
        id: "checkpoint-stale-file",
        name: buildGoogleDriveV2FileName("checkpoint", vaultId, "checkpoint-stale"),
        createdTime: "2026-08-21T09:00:00.000Z",
        modifiedTime: "2026-08-21T09:00:00.000Z",
        size: "1000"
      },
      {
        id: "commit-applied-file",
        name: buildGoogleDriveV2FileName("commit", vaultId, "commit-applied"),
        createdTime: "2026-08-21T10:00:00.000Z",
        modifiedTime: "2026-08-21T10:00:00.000Z",
        size: "100"
      },
      {
        id: "commit-unapplied-file",
        name: buildGoogleDriveV2FileName("commit", vaultId, "commit-unapplied"),
        createdTime: "2026-08-21T11:00:00.000Z",
        modifiedTime: "2026-08-21T11:00:00.000Z",
        size: "100"
      }
    ];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);

        if (!url.includes("alt=media")) {
          return jsonResponse({ files });
        }

        if (url.includes("checkpoint-selected-file")) {
          return jsonResponse(selectedCheckpoint);
        }

        if (url.includes("checkpoint-stale-file")) {
          return jsonResponse(staleCheckpoint);
        }

        if (url.includes("commit-unapplied-file")) {
          return jsonResponse(unappliedCommit);
        }

        throw new Error(`Unexpected Drive request: ${url} ${JSON.stringify(init?.headers)}`);
      }
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadGoogleDriveRemoteBootstrap("access-token", vaultId)).resolves.toEqual(
      expect.objectContaining({
        checkpointRevision: "snapshot-revision",
        changes: expect.objectContaining({ deviceId: "device-2" })
      })
    );

    const requestedUrls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(requestedUrls.filter((url) => url.includes("checkpoint-selected-file"))).toHaveLength(2);
    expect(requestedUrls.filter((url) => url.includes("checkpoint-stale-file"))).toHaveLength(1);
    expect(requestedUrls.some((url) => url.includes("commit-applied-file"))).toBe(false);
    expect(requestedUrls.filter((url) => url.includes("commit-unapplied-file"))).toHaveLength(1);
  });

  test("reads a current revision without downloading the checkpoint body", async () => {
    const checkpoint = {
      schemaVersion: 2,
      provider: "googleDrive",
      recordType: "checkpoint",
      checkpointId: "checkpoint-current",
      vaultId: "vault-1",
      vaultName: "Main vault",
      vaultKind: "regular",
      createdAt: 2_000,
      coveredCommitCount: 0,
      appliedCommitIds: [],
      baseCursor: null,
      metadata: {
        schemaVersion: 1,
        payloadMode: "plain",
        vault: null,
        encryption: null
      },
      envelope: {
        revision: "snapshot-revision",
        snapshot: {}
      }
    } as const;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.includes("alt=media")) {
        return jsonResponse(checkpoint);
      }

      return jsonResponse({
        files: [
          {
            id: "checkpoint-current-file",
            name: buildGoogleDriveV2FileName("checkpoint", "vault-1", "checkpoint-current"),
            createdTime: "2026-08-21T08:00:00.000Z",
            modifiedTime: "2026-08-21T08:00:00.000Z",
            size: "1000"
          }
        ]
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadGoogleDriveRemoteRevision("access-token", "vault-1")).resolves.toEqual(
      expect.objectContaining({
        revision: expect.stringMatching(/^gdrive-v2:/),
        metadata: expect.objectContaining({ payloadMode: "plain" })
      })
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
