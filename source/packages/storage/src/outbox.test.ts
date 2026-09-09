import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LastDoneDatabase,
  enqueueOperation,
  listPendingOperations,
  markOperationApplied,
  type SyncOperation,
} from "./index";

describe("outbox", () => {
  let db: LastDoneDatabase;

  beforeEach(() => {
    db = new LastDoneDatabase(`lastdone-outbox-${crypto.randomUUID()}`);
  });

  afterEach(async () => {
    await db.delete();
  });

  it("lists pending operations in creation order with a limit", async () => {
    const operations: SyncOperation[] = [1, 2, 3].map((number) => ({
      id: `operation-${number}`,
      userId: "user-1",
      entity: "items",
      entityId: `item-${number}`,
      action: "update",
      baseRevision: number - 1,
      fields: { name: `Item ${number}` },
      createdAt: `2026-09-05T08:00:0${number}.000Z`,
      status: "pending",
      attempts: 0,
      lastError: null,
    }));

    for (const operation of operations) {
      await enqueueOperation(db, operation);
    }

    expect((await listPendingOperations(db, "user-1", 2)).map(({ id }) => id)).toEqual([
      "operation-1",
      "operation-2",
    ]);
  });

  it("preserves insertion order when operations request the same timestamp", async () => {
    const sharedTimestamp = "2026-09-05T08:00:00.000Z";
    for (const id of ["operation-z", "operation-a"]) {
      await enqueueOperation(db, {
        id,
        userId: "user-1",
        entity: "items",
        entityId: "item-1",
        action: "update",
        baseRevision: 1,
        fields: { name: id },
        createdAt: sharedTimestamp,
        status: "pending",
        attempts: 0,
        lastError: null,
      });
    }

    const pending = await listPendingOperations(db, "user-1", 10);
    expect(pending.map(({ id }) => id)).toEqual(["operation-z", "operation-a"]);
    expect(pending[1]!.createdAt).toBe("2026-09-05T08:00:00.001Z");
  });

  it("keeps createdAt strictly increasing for concurrent enqueues", async () => {
    const sharedTimestamp = "2026-09-05T08:00:00.000Z";
    const ids = ["operation-1", "operation-2", "operation-3", "operation-4"];

    await Promise.all(
      ids.map((id) =>
        enqueueOperation(db, {
          id,
          userId: "user-1",
          entity: "items",
          entityId: "item-1",
          action: "update",
          baseRevision: 1,
          fields: { name: id },
          createdAt: sharedTimestamp,
          status: "pending",
          attempts: 0,
          lastError: null,
        }),
      ),
    );

    const timestamps = (await listPendingOperations(db, "user-1", 10)).map(
      ({ createdAt }) => createdAt,
    );

    expect(timestamps).toHaveLength(ids.length);
    expect(new Set(timestamps).size).toBe(ids.length);
    for (let index = 1; index < timestamps.length; index += 1) {
      expect(timestamps[index]! > timestamps[index - 1]!).toBe(true);
    }
  });

  it("marks an acknowledged operation as applied", async () => {
    await enqueueOperation(db, {
      id: "operation-1",
      userId: "user-1",
      entity: "categories",
      entityId: "category-1",
      action: "create",
      baseRevision: 0,
      fields: { name: "家庭" },
      createdAt: "2026-09-05T08:00:00.000Z",
      status: "pending",
      attempts: 0,
      lastError: null,
    });

    await markOperationApplied(db, "operation-1");

    expect(await listPendingOperations(db, "user-1", 10)).toEqual([]);
    expect(await db.outbox.get("operation-1")).toMatchObject({
      status: "applied",
      appliedAt: expect.any(String),
    });
  });

  it("does not return another user's pending operations", async () => {
    await enqueueOperation(db, {
      id: "operation-other-user",
      userId: "user-2",
      entity: "items",
      entityId: "item-other-user",
      action: "create",
      baseRevision: 0,
      fields: { name: "Other user" },
      createdAt: "2026-09-05T08:00:00.000Z",
      status: "pending",
      attempts: 0,
      lastError: null,
    });

    expect(await listPendingOperations(db, "user-1", 10)).toEqual([]);
  });

  it("applies the limit to the current user's operations only", async () => {
    await enqueueOperation(db, {
      id: "operation-other-user",
      userId: "user-2",
      entity: "items",
      entityId: "item-other-user",
      action: "create",
      baseRevision: 0,
      fields: { name: "Other user" },
      createdAt: "2026-09-05T07:00:00.000Z",
      status: "pending",
      attempts: 0,
      lastError: null,
    });
    for (const number of [1, 2]) {
      await enqueueOperation(db, {
        id: `operation-${number}`,
        userId: "user-1",
        entity: "items",
        entityId: `item-${number}`,
        action: "update",
        baseRevision: number - 1,
        fields: { name: `Item ${number}` },
        createdAt: `2026-09-05T08:00:0${number}.000Z`,
        status: "pending",
        attempts: 0,
        lastError: null,
      });
    }

    expect((await listPendingOperations(db, "user-1", 1)).map(({ id }) => id)).toEqual([
      "operation-1",
    ]);
  });
});
