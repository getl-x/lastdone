import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { LastDoneDatabase } from "@lastdone/storage";

import { applyPullPage } from "./merge";

const databases: LastDoneDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});

describe("remote change merge", () => {
  it("creates a complete settings record when no local defaults exist", async () => {
    const db = new LastDoneDatabase(`merge-settings-${crypto.randomUUID()}`);
    databases.push(db);
    const userId = "currentuser0001";
    const timestamp = "2026-09-06T08:00:00.000Z";

    await applyPullPage(
      db,
      userId,
      [
        {
          sequence: 1,
          userId,
          entity: "settings",
          entityId: userId,
          action: "create",
          revision: 1,
          fields: {
            createdAt: timestamp,
            updatedAt: timestamp,
            deletedAt: null,
            timeZone: "Asia/Shanghai",
            dueSoonDays: 7,
            digestTime: "09:00",
            quietHoursStart: "22:00",
            quietHoursEnd: "08:00",
          },
        },
      ],
      [],
      1,
      timestamp,
    );

    expect(await db.settings.get(userId)).toMatchObject({
      id: userId,
      userId,
      revision: 1,
      timeZone: "Asia/Shanghai",
    });
  });

  it("rejects a pull page containing another user's data", async () => {
    const db = new LastDoneDatabase(`merge-ownership-${crypto.randomUUID()}`);
    databases.push(db);
    const timestamp = "2026-09-06T08:00:00.000Z";

    await expect(
      applyPullPage(
        db,
        "user-1",
        [
          {
            sequence: 1,
            userId: "user-2",
            entity: "items",
            entityId: "item00000000001",
            action: "create",
            revision: 1,
            fields: { name: "不应写入" },
          },
        ],
        [],
        1,
        timestamp,
      ),
    ).rejects.toThrow("another user");

    expect(await db.items.count()).toBe(0);
    expect(await db.syncMeta.get("user-1")).toBeUndefined();
  });

  it("resolves an older local conflict when a newer field change arrives", async () => {
    const db = new LastDoneDatabase(`merge-conflict-${crypto.randomUUID()}`);
    databases.push(db);
    const userId = "currentuser0001";
    const timestamp = "2026-09-06T08:00:00.000Z";
    await db.conflicts.add({
      id: "operation-1:name",
      userId,
      entity: "items",
      entityId: "item00000000001",
      field: "name",
      localValue: "旧本机名称",
      serverValue: "服务器名称",
      serverRevision: 2,
      status: "unresolved",
      createdAt: "2026-09-06T07:00:00.000Z",
      resolvedAt: null,
    });

    await applyPullPage(
      db,
      userId,
      [
        {
          sequence: 3,
          userId,
          entity: "items",
          entityId: "item00000000001",
          action: "update",
          revision: 3,
          fields: { name: "最新名称", updatedAt: timestamp },
        },
      ],
      [],
      3,
      timestamp,
    );

    expect(await db.conflicts.get("operation-1:name")).toMatchObject({
      status: "resolved",
      resolvedAt: timestamp,
    });
  });

  it("keeps a conflict open for the server revision that originally caused it", async () => {
    const db = new LastDoneDatabase(`merge-current-conflict-${crypto.randomUUID()}`);
    databases.push(db);
    const userId = "currentuser0001";
    const timestamp = "2026-09-06T08:00:00.000Z";
    await db.conflicts.add({
      id: "operation-1:name",
      userId,
      entity: "items",
      entityId: "item00000000001",
      field: "name",
      localValue: "本机名称",
      serverValue: "服务器名称",
      serverRevision: 2,
      status: "unresolved",
      createdAt: "2026-09-06T07:00:00.000Z",
      resolvedAt: null,
    });

    await applyPullPage(
      db,
      userId,
      [
        {
          sequence: 2,
          userId,
          entity: "items",
          entityId: "item00000000001",
          action: "update",
          revision: 2,
          fields: { name: "服务器名称", updatedAt: timestamp },
        },
      ],
      [],
      2,
      timestamp,
    );

    expect((await db.conflicts.get("operation-1:name"))?.status).toBe("unresolved");
  });
});
