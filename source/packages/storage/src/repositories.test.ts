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

  it("uses the same default category and operation ids on every device", async () => {
    const otherDb = new LastDoneDatabase(`lastdone-test-other-${crypto.randomUUID()}`);
    try {
      const first = createRepositories(db, {
        userId: USER_ID,
        now: () => NOW,
        generateId: sequentialIds(),
      });
      const second = createRepositories(otherDb, {
        userId: USER_ID,
        now: () => "2026-09-06T08:00:00.000Z",
        generateId: sequentialIds(),
      });

      await first.categories.ensureDefaults();
      await second.categories.ensureDefaults();

      const firstCategories = await db.categories.orderBy("displayOrder").toArray();
      const secondCategories = await otherDb.categories
        .orderBy("displayOrder")
        .toArray();
      expect(firstCategories.map(({ id }) => id)).toEqual(
        secondCategories.map(({ id }) => id),
      );

      const firstOperations = await db.outbox.orderBy("createdAt").toArray();
      const secondOperations = await otherDb.outbox.orderBy("createdAt").toArray();
      expect(firstOperations.map(({ id }) => id)).toEqual(
        secondOperations.map(({ id }) => id),
      );
    } finally {
      await otherDb.delete();
    }
  });

  it("edits and reorders categories without duplicate display positions", async () => {
    const repositories = createRepositories(db, {
      userId: USER_ID,
      now: () => NOW,
      generateId: sequentialIds(),
    });
    await repositories.categories.ensureDefaults();
    const before = await db.categories.orderBy("displayOrder").toArray();

    await repositories.categories.move(before[1]!.id, -1);
    await repositories.categories.update(before[1]!.id, {
      name: "家庭维护",
      icon: "house",
      color: "#123456",
    });

    const after = await db.categories.orderBy("displayOrder").toArray();
    expect(after[0]).toMatchObject({
      id: before[1]!.id,
      name: "家庭维护",
      color: "#123456",
    });
    expect(new Set(after.map(({ displayOrder }) => displayOrder)).size).toBe(
      after.length,
    );
  });

  it("skips category tombstones when reordering visible categories", async () => {
    const repositories = createRepositories(db, {
      userId: USER_ID,
      now: () => NOW,
      generateId: sequentialIds(),
    });
    await repositories.categories.ensureDefaults();
    const before = await db.categories.orderBy("displayOrder").toArray();
    await db.categories.update(before[1]!.id, { deletedAt: NOW });

    await repositories.categories.move(before[0]!.id, 1);

    const visible = (await db.categories.orderBy("displayOrder").toArray()).filter(
      (category) => !category.deletedAt,
    );
    expect(visible.slice(0, 2).map(({ id }) => id)).toEqual([
      before[2]!.id,
      before[0]!.id,
    ]);
  });

  it("deletes a category after moving all of its items to another category", async () => {
    const repositories = createRepositories(db, {
      userId: USER_ID,
      now: () => NOW,
      generateId: sequentialIds(),
    });
    await repositories.categories.ensureDefaults();
    const categories = await db.categories.orderBy("displayOrder").toArray();
    const source = categories[0]!;
    const replacement = categories[1]!;
    const item = await repositories.items.create({
      name: "年度体检",
      categoryId: source.id,
      schedule: { type: "fixed-yearly", month: 9, day: 5 },
      initialDueDate: "2027-09-05",
      important: true,
      reminderOffsets: [30, 7],
    });
    await db.outbox.clear();

    await repositories.categories.remove(source.id, replacement.id);

    expect((await db.categories.get(source.id))?.deletedAt).toBe(NOW);
    expect(await db.items.get(item.id)).toMatchObject({
      categoryId: replacement.id,
      revision: 2,
    });
    expect(
      (await db.outbox.orderBy("createdAt").toArray()).map(
        ({ entity, action, entityId }) => ({ entity, action, entityId }),
      ),
    ).toEqual([
      { entity: "items", action: "update", entityId: item.id },
      { entity: "categories", action: "delete", entityId: source.id },
    ]);
  });

  it("keeps the final category so items always have a valid destination", async () => {
    const repositories = createRepositories(db, {
      userId: USER_ID,
      now: () => NOW,
      generateId: sequentialIds(),
    });
    await db.categories.add({
      id: "only-category",
      userId: USER_ID,
      revision: 1,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      name: "唯一分类",
      icon: "shapes",
      color: "#5B7FD8",
      displayOrder: 0,
      lifecycle: "active",
    });

    await expect(repositories.categories.remove("only-category")).rejects.toThrow(
      "the last category cannot be deleted",
    );
    expect((await db.categories.get("only-category"))?.deletedAt).toBeNull();
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
      baseRevision: 0,
      status: "pending",
    });
  });

  it("bases an offline edit on the revision created with a new item", async () => {
    const repositories = createRepositories(db, {
      userId: USER_ID,
      now: () => NOW,
      generateId: sequentialIds(),
    });
    const item = await repositories.items.create({
      name: "备份电脑",
      categoryId: "category-digital",
      schedule: { type: "relative", every: 30, unit: "days" },
      initialDueDate: "2026-09-30",
      important: false,
      reminderOffsets: [],
    });

    await repositories.items.update(item.id, { important: true });

    expect(item.revision).toBe(1);
    expect((await db.items.get(item.id))?.revision).toBe(2);
    const operations = await db.outbox.where("entityId").equals(item.id).toArray();
    expect(
      operations.map(({ action, baseRevision }) => ({ action, baseRevision })),
    ).toEqual([
      { action: "create", baseRevision: 0 },
      { action: "update", baseRevision: 1 },
    ]);
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

  it("pauses, restores, skips a fixed occurrence, and tombstones an item", async () => {
    const repositories = createRepositories(db, {
      userId: USER_ID,
      now: () => NOW,
      generateId: sequentialIds(),
    });
    const item = await repositories.items.create({
      name: "检查车辆",
      categoryId: "category-vehicle",
      schedule: { type: "fixed-monthly", day: 31 },
      initialDueDate: "2026-09-30",
      important: false,
      reminderOffsets: [],
    });

    await repositories.items.pause(item.id);
    expect((await db.items.get(item.id))?.lifecycle).toBe("paused");
    await repositories.items.restore(item.id);
    expect((await db.items.get(item.id))?.lifecycle).toBe("active");

    await repositories.items.skip(item.id, "2026-09-30", "本月不检查");
    expect((await db.items.get(item.id))?.dueDate).toBe("2026-10-31");
    expect((await db.skips.where("itemId").equals(item.id).first())?.note).toBe(
      "本月不检查",
    );

    await repositories.items.remove(item.id);
    expect((await db.items.get(item.id))?.deletedAt).toBe(NOW);
  });

  it("rejects skipping a completion-relative schedule", async () => {
    const repositories = createRepositories(db, {
      userId: USER_ID,
      now: () => NOW,
      generateId: sequentialIds(),
    });
    const item = await repositories.items.create({
      name: "备份电脑",
      categoryId: "category-digital",
      schedule: { type: "relative", every: 30, unit: "days" },
      initialDueDate: "2026-09-30",
      important: false,
      reminderOffsets: [],
    });

    await expect(repositories.items.skip(item.id, "2026-09-30")).rejects.toThrow(
      "relative schedules cannot be skipped",
    );
  });

  it("creates settings on first save and updates them with revisions", async () => {
    const repositories = createRepositories(db, {
      userId: USER_ID,
      now: () => NOW,
      generateId: sequentialIds(),
    });

    const defaults = await repositories.settings.ensureDefaults();
    const first = await repositories.settings.update({ dueSoonDays: 10 });
    const second = await repositories.settings.update({ digestTime: "08:30" });

    expect(defaults.revision).toBe(1);
    expect(first.revision).toBe(2);
    expect(second).toMatchObject({ revision: 3, dueSoonDays: 10, digestTime: "08:30" });
    const operations = await db.outbox
      .where("entity")
      .equals("settings")
      .sortBy("createdAt");
    expect(
      operations.map(({ action, baseRevision, fields }) => ({
        action,
        baseRevision,
        businessFields: Object.keys(fields).filter(
          (field) =>
            !["id", "userId", "revision", "createdAt", "updatedAt"].includes(field),
        ),
      })),
    ).toEqual([
      {
        action: "create",
        baseRevision: 0,
        businessFields: [
          "deletedAt",
          "timeZone",
          "dueSoonDays",
          "digestTime",
          "quietHoursStart",
          "quietHoursEnd",
        ],
      },
      { action: "update", baseRevision: 1, businessFields: ["dueSoonDays"] },
      { action: "update", baseRevision: 2, businessFields: ["digestTime"] },
    ]);
  });

  it("registers a device session for synchronization once", async () => {
    const repositories = createRepositories(db, {
      userId: USER_ID,
      now: () => NOW,
      generateId: sequentialIds(),
    });
    const input = {
      id: "device000000001",
      name: "Android 手机",
      platform: "android" as const,
      digestEnabled: false,
      importantRemindersEnabled: true,
    };

    const first = await repositories.devices.register(input);
    const second = await repositories.devices.register(input);

    expect(second).toEqual(first);
    expect(await db.devices.get(input.id)).toEqual(first);
    expect(await db.outbox.where("entity").equals("devices").count()).toBe(1);
    expect(await db.outbox.where("entity").equals("devices").first()).toMatchObject({
      entityId: input.id,
      action: "create",
      baseRevision: 0,
    });
  });

  it("uses the same default settings operation id on every device", async () => {
    const otherDb = new LastDoneDatabase(`lastdone-settings-${crypto.randomUUID()}`);
    try {
      const first = createRepositories(db, {
        userId: USER_ID,
        now: () => NOW,
        generateId: sequentialIds(),
      });
      const second = createRepositories(otherDb, {
        userId: USER_ID,
        now: () => "2026-09-06T08:00:00.000Z",
        generateId: sequentialIds(),
      });

      await first.settings.ensureDefaults();
      await second.settings.ensureDefaults();

      expect((await db.outbox.where("entity").equals("settings").first())?.id).toBe(
        (await otherDb.outbox.where("entity").equals("settings").first())?.id,
      );
    } finally {
      await otherDb.delete();
    }
  });
});
