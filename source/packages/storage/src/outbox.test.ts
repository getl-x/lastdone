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

    expect((await listPendingOperations(db, 2)).map(({ id }) => id)).toEqual([
      "operation-1",
      "operation-2",
    ]);
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

    expect(await listPendingOperations(db, 10)).toEqual([]);
    expect(await db.outbox.get("operation-1")).toMatchObject({
      status: "applied",
      appliedAt: expect.any(String),
    });
  });
});
