import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LastDoneDatabase,
  enqueueOperation,
  listPendingOperations,
} from "@lastdone/storage";

import {
  createSyncEngine,
  type PullResponse,
  type PushResponse,
  type SyncTransport,
} from "./index";

const USER_ID = "user-1";

describe("sync engine", () => {
  let db: LastDoneDatabase;

  beforeEach(() => {
    db = new LastDoneDatabase(`lastdone-sync-${crypto.randomUUID()}`);
  });

  afterEach(async () => {
    await db.delete();
  });

  it("pushes before pulling, applies changes, and persists the cursor", async () => {
    await enqueueOperation(db, {
      id: "operation-1",
      userId: USER_ID,
      entity: "items",
      entityId: "item-1",
      action: "update",
      baseRevision: 1,
      fields: { name: "新名称" },
      createdAt: "2026-09-06T01:00:00.000Z",
      status: "pending",
      attempts: 0,
      lastError: null,
    });

    const calls: string[] = [];
    const transport: SyncTransport = {
      async push(operations): Promise<PushResponse> {
        calls.push(`push:${operations.length}`);
        return { appliedOperationIds: ["operation-1"], conflicts: [] };
      },
      async pull(after): Promise<PullResponse> {
        calls.push(`pull:${after}`);
        return {
          changes: [
            {
              sequence: 7,
              userId: USER_ID,
              entity: "categories",
              entityId: "category-1",
              action: "create",
              revision: 1,
              fields: {
                id: "category-1",
                userId: USER_ID,
                revision: 1,
                createdAt: "2026-09-06T01:00:00.000Z",
                updatedAt: "2026-09-06T01:00:00.000Z",
                deletedAt: null,
                name: "家庭",
                icon: "house",
                color: "#B57B46",
                displayOrder: 1,
                lifecycle: "active",
              },
            },
          ],
          conflicts: [],
          nextSequence: 7,
          hasMore: false,
        };
      },
    };

    const result = await createSyncEngine({
      db,
      userId: USER_ID,
      transport,
      clock: () => "2026-09-06T01:00:10.000Z",
    }).run();

    expect(calls).toEqual(["push:1", "pull:0"]);
    expect(result).toEqual({ pushed: 1, pulled: 1, conflicts: 0 });
    expect(await listPendingOperations(db, 10)).toEqual([]);
    expect((await db.categories.get("category-1"))?.name).toBe("家庭");
    expect(await db.syncMeta.get(USER_ID)).toMatchObject({
      lastSequence: 7,
      lastSyncedAt: "2026-09-06T01:00:10.000Z",
      lastError: null,
    });
  });

  it("retains pending operations and records an error when push fails", async () => {
    await enqueueOperation(db, {
      id: "operation-1",
      userId: USER_ID,
      entity: "items",
      entityId: "item-1",
      action: "create",
      baseRevision: 0,
      fields: { name: "备份电脑" },
      createdAt: "2026-09-06T01:00:00.000Z",
      status: "pending",
      attempts: 0,
      lastError: null,
    });
    const pull = vi.fn();
    const engine = createSyncEngine({
      db,
      userId: USER_ID,
      transport: {
        async push() {
          throw new Error("server unavailable");
        },
        pull,
      },
      clock: () => "2026-09-06T01:00:10.000Z",
    });

    await expect(engine.run()).rejects.toThrow("server unavailable");

    expect(pull).not.toHaveBeenCalled();
    expect((await listPendingOperations(db, 10))[0]).toMatchObject({
      id: "operation-1",
      attempts: 1,
      lastError: "server unavailable",
    });
    expect(await db.syncMeta.get(USER_ID)).toMatchObject({
      lastSequence: 0,
      lastError: "server unavailable",
    });
  });

  it("pulls all pages and stores unresolved conflicts", async () => {
    const transport: SyncTransport = {
      async push() {
        return { appliedOperationIds: [], conflicts: [] };
      },
      async pull(after) {
        if (after === 0) {
          return {
            changes: [],
            conflicts: [
              {
                id: "conflict-1",
                userId: USER_ID,
                entity: "items",
                entityId: "item-1",
                field: "name",
                localValue: "本地",
                serverValue: "服务端",
                serverRevision: 2,
                status: "unresolved",
                createdAt: "2026-09-06T01:00:00.000Z",
                resolvedAt: null,
              },
            ],
            nextSequence: 5,
            hasMore: true,
          };
        }
        return {
          changes: [],
          conflicts: [],
          nextSequence: 9,
          hasMore: false,
        };
      },
    };

    const result = await createSyncEngine({
      db,
      userId: USER_ID,
      transport,
    }).run();

    expect(result.conflicts).toBe(1);
    expect((await db.conflicts.get("conflict-1"))?.status).toBe("unresolved");
    expect((await db.syncMeta.get(USER_ID))?.lastSequence).toBe(9);
  });
});
