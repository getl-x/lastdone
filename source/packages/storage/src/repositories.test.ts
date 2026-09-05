import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LastDoneDatabase, createRepositories, type IdGenerator } from "./index";

const USER_ID = "user-1";
const NOW = "2026-09-05T08:00:00.000Z";

function sequentialIds(): IdGenerator {
  let current = 0;
  return () => `id-${++current}`;
}

describe("offline repositories", () => {
  let db: LastDoneDatabase;

  beforeEach(() => {
    db = new LastDoneDatabase(`lastdone-test-${crypto.randomUUID()}`);
  });

  afterEach(async () => {
    await db.delete();
  });

  it("seeds the six default categories once", async () => {
    const repositories = createRepositories(db, {
      userId: USER_ID,
      now: () => NOW,
      generateId: sequentialIds(),
    });

    await repositories.categories.ensureDefaults();
    await repositories.categories.ensureDefaults();

    const categories = await db.categories.orderBy("displayOrder").toArray();
    expect(categories.map(({ name }) => name)).toEqual([
      "健康",
      "家居",
      "数字生活",
      "设备",
      "车辆",
      "其他",
    ]);
    expect(await db.outbox.count()).toBe(6);
  });

  it("creates an item and its operation in one transaction", async () => {
    const repositories = createRepositories(db, {
      userId: USER_ID,
      now: () => NOW,
      generateId: sequentialIds(),
    });

    const item = await repositories.items.create({
      name: "更换净水器滤芯",
      categoryId: "category-home",
      schedule: { type: "relative", every: 90, unit: "days" },
      previousCompletionDate: "2026-08-01",
      important: true,
      reminderOffsets: [7, 1, 0],
    });

    expect(item.dueDate).toBe("2026-10-30");
    expect(item.lastCompletedDate).toBe("2026-08-01");
    expect(await db.items.get(item.id)).toEqual(item);
    expect((await db.outbox.toArray())[0]).toMatchObject({
      entity: "items",
      entityId: item.id,
      action: "create",
      status: "pending",
    });
  });

  it("rolls back the item if its outbox write fails", async () => {
    const repositories = createRepositories(db, {
      userId: USER_ID,
      now: () => NOW,
      generateId: sequentialIds(),
    });
    db.outbox.hook("creating", () => {
      throw new Error("outbox unavailable");
    });

    await expect(
      repositories.items.create({
        name: "备份电脑",
        categoryId: "category-digital",
        schedule: { type: "relative", every: 30, unit: "days" },
        initialDueDate: "2026-09-30",
        important: false,
        reminderOffsets: [],
      }),
    ).rejects.toThrow("outbox unavailable");
    expect(await db.items.count()).toBe(0);
  });

  it("records one-tap and backdated completions and can undo the latest", async () => {
    const repositories = createRepositories(db, {
      userId: USER_ID,
      now: () => NOW,
      generateId: sequentialIds(),
    });
    const item = await repositories.items.create({
      name: "清洗空调滤网",
      categoryId: "category-home",
      schedule: { type: "relative", every: 30, unit: "days" },
      initialDueDate: "2026-09-10",
      important: false,
      reminderOffsets: [],
    });

    const backdated = await repositories.items.complete(item.id, {
      completedAt: "2026-08-01T10:00:00.000Z",
      localDate: "2026-08-01",
      note: "补录",
    });
    const current = await repositories.items.complete(item.id, {
      completedAt: NOW,
      localDate: "2026-09-05",
    });

    expect(backdated.note).toBe("补录");
    expect((await db.items.get(item.id))?.dueDate).toBe("2026-10-05");
    await repositories.items.undoCompletion(current.id);

    const restored = await db.items.get(item.id);
    expect(restored?.lastCompletedDate).toBe("2026-08-01");
    expect(restored?.dueDate).toBe("2026-08-31");
    expect((await db.completions.get(current.id))?.deletedAt).toBe(NOW);
  });

  it("archives an item without deleting its history", async () => {
    const repositories = createRepositories(db, {
      userId: USER_ID,
      now: () => NOW,
      generateId: sequentialIds(),
    });
    const item = await repositories.items.create({
      name: "车辆保养",
      categoryId: "category-vehicle",
      schedule: { type: "fixed-yearly", month: 9, day: 5 },
      initialDueDate: "2027-09-05",
      important: true,
      reminderOffsets: [30, 7],
    });
    await repositories.items.complete(item.id, {
      completedAt: NOW,
      localDate: "2026-09-05",
    });

    await repositories.items.archive(item.id);

    expect((await db.items.get(item.id))?.lifecycle).toBe("archived");
    expect(await db.completions.where("itemId").equals(item.id).count()).toBe(1);
  });
});
