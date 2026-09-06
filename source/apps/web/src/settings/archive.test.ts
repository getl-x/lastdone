import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { LastDoneDatabase, defaultCategoryId } from "@lastdone/storage";

import {
  buildImportPlan,
  parseLastDoneExport,
  restoreJsonExport,
  type LastDoneExport,
} from "./archive";

const databases: LastDoneDatabase[] = [];
const USER_ID = "currentuser0001";
const OLD_USER_ID = "previoususer001";
const FOREIGN_USER_ID = "anotheruser0001";
const CATEGORY_ID = "category0000001";
const ITEM_ID = "item00000000001";

function archiveFixture(): LastDoneExport {
  const createdAt = "2026-09-01T08:00:00.000Z";
  return {
    format: "lastdone-export",
    version: 1,
    exportedAt: "2026-09-06T08:00:00.000Z",
    categories: [
      {
        id: CATEGORY_ID,
        userId: OLD_USER_ID,
        revision: 2,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
        name: "数字生活",
        icon: "cloud",
        color: "#657FA3",
        displayOrder: 0,
        lifecycle: "active",
      },
    ],
    items: [
      {
        id: ITEM_ID,
        userId: OLD_USER_ID,
        revision: 3,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
        name: "备份电脑",
        categoryId: CATEGORY_ID,
        schedule: { type: "relative", every: 30, unit: "days" },
        initialDueDate: "2026-09-30",
        dueDate: "2026-09-30",
        lastCompletedDate: null,
        lastCompletionId: null,
        important: true,
        reminderOffsets: [7, 1, 0],
        lifecycle: "active",
      },
    ],
    completions: [],
    skips: [],
    settings: [
      {
        id: OLD_USER_ID,
        userId: OLD_USER_ID,
        revision: 1,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
        timeZone: "Asia/Shanghai",
        dueSoonDays: 7,
        digestTime: "09:00",
        quietHoursStart: "22:00",
        quietHoursEnd: "08:00",
      },
    ],
    devices: [],
  };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});

describe("LastDone JSON restore", () => {
  it("rejects an archive with a broken relationship", () => {
    const archive = archiveFixture();
    archive.items[0]!.categoryId = "missing00000001";
    expect(() => parseLastDoneExport(archive)).toThrow("不存在的分类");
  });

  it("rejects a backup containing records from multiple accounts", () => {
    const archive = archiveFixture();
    archive.items[0]!.userId = FOREIGN_USER_ID;

    expect(() => parseLastDoneExport(archive)).toThrow("混入了其他账号的数据");
  });

  it("rejects normalized calendar timestamps and broken completion history", () => {
    const invalidTimestamp = archiveFixture();
    invalidTimestamp.exportedAt = "2026-02-30T08:00:00.000Z";
    expect(() => parseLastDoneExport(invalidTimestamp)).toThrow("不是有效时间");

    const brokenHistory = archiveFixture();
    brokenHistory.completions.push({
      id: "complete0000001",
      userId: OLD_USER_ID,
      revision: 1,
      createdAt: "2026-09-01T08:00:00.000Z",
      updatedAt: "2026-09-01T08:00:00.000Z",
      deletedAt: null,
      itemId: ITEM_ID,
      completedAt: "2026-09-01T08:00:00.000Z",
      localDate: "2026-09-01",
      note: null,
      previousDueDate: null,
      previousLastCompletedDate: null,
      previousLastCompletionId: "complete0000002",
    });
    expect(() => parseLastDoneExport(brokenHistory)).toThrow("上一条完成记录不存在");
  });

  it("previews and restores all records for the signed-in user", async () => {
    const db = new LastDoneDatabase(`archive-${crypto.randomUUID()}`);
    databases.push(db);

    const plan = await buildImportPlan(db, USER_ID, archiveFixture());
    expect(plan.summary).toEqual({ add: 3, update: 0, remove: 0, total: 3 });

    await restoreJsonExport(db, USER_ID, plan, "2026-09-06T09:00:00.000Z");

    expect(await db.categories.get(CATEGORY_ID)).toMatchObject({
      userId: USER_ID,
      name: "数字生活",
    });
    expect(await db.items.get(ITEM_ID)).toMatchObject({
      userId: USER_ID,
      name: "备份电脑",
    });
    expect(await db.settings.get(USER_ID)).toMatchObject({
      id: USER_ID,
      userId: USER_ID,
      timeZone: "Asia/Shanghai",
    });
    expect(await db.outbox.count()).toBe(3);
  });

  it("creates server settings when only unsynchronized local defaults exist", async () => {
    const db = new LastDoneDatabase(`archive-defaults-${crypto.randomUUID()}`);
    databases.push(db);
    const createdAt = "2026-09-06T08:30:00.000Z";
    await db.settings.add({
      id: USER_ID,
      userId: USER_ID,
      revision: 0,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
      timeZone: "Asia/Shanghai",
      dueSoonDays: 7,
      digestTime: "09:00",
      quietHoursStart: "22:00",
      quietHoursEnd: "08:00",
    });

    const plan = await buildImportPlan(db, USER_ID, archiveFixture());
    await restoreJsonExport(db, USER_ID, plan, "2026-09-06T09:00:00.000Z");

    const operation = await db.outbox.where("entity").equals("settings").first();
    expect(operation).toMatchObject({
      action: "create",
      baseRevision: 0,
      entityId: USER_ID,
    });
    expect((await db.settings.get(USER_ID))?.revision).toBe(1);
  });

  it("remaps default category ids when restoring into a new user account", async () => {
    const db = new LastDoneDatabase(`archive-new-user-${crypto.randomUUID()}`);
    databases.push(db);
    const archive = archiveFixture();
    const oldDefaultId = defaultCategoryId(OLD_USER_ID, "digital");
    archive.categories[0]!.id = oldDefaultId;
    archive.items[0]!.categoryId = oldDefaultId;

    const plan = await buildImportPlan(db, USER_ID, archive);
    const currentDefaultId = defaultCategoryId(USER_ID, "digital");

    expect(plan.archive.categories[0]!.id).toBe(currentDefaultId);
    expect(plan.archive.items[0]!.categoryId).toBe(currentDefaultId);
  });

  it("does not count or remove another user's local records", async () => {
    const db = new LastDoneDatabase(`archive-isolation-${crypto.randomUUID()}`);
    databases.push(db);
    const createdAt = "2026-09-01T08:00:00.000Z";
    await db.categories.add({
      id: "foreigncat00001",
      userId: FOREIGN_USER_ID,
      revision: 4,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
      name: "其他账号的分类",
      icon: "lock",
      color: "#123456",
      displayOrder: 0,
      lifecycle: "active",
    });

    const plan = await buildImportPlan(db, USER_ID, archiveFixture());
    expect(plan.summary).toEqual({ add: 3, update: 0, remove: 0, total: 3 });

    await restoreJsonExport(db, USER_ID, plan, "2026-09-06T09:00:00.000Z");

    expect(await db.categories.get("foreigncat00001")).toMatchObject({
      userId: FOREIGN_USER_ID,
      revision: 4,
      deletedAt: null,
    });
  });

  it("rolls back instead of overwriting another user's colliding record id", async () => {
    const db = new LastDoneDatabase(`archive-collision-${crypto.randomUUID()}`);
    databases.push(db);
    const createdAt = "2026-09-01T08:00:00.000Z";
    await db.categories.add({
      id: CATEGORY_ID,
      userId: FOREIGN_USER_ID,
      revision: 4,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
      name: "其他账号的分类",
      icon: "lock",
      color: "#123456",
      displayOrder: 0,
      lifecycle: "active",
    });

    const plan = await buildImportPlan(db, USER_ID, archiveFixture());
    await expect(
      restoreJsonExport(db, USER_ID, plan, "2026-09-06T09:00:00.000Z"),
    ).rejects.toThrow("已被其他账号使用");

    expect(await db.categories.get(CATEGORY_ID)).toMatchObject({
      userId: FOREIGN_USER_ID,
      revision: 4,
    });
    expect(await db.items.get(ITEM_ID)).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });

  it("returns the actual summary when local data changes after preview", async () => {
    const db = new LastDoneDatabase(`archive-stale-preview-${crypto.randomUUID()}`);
    databases.push(db);
    const plan = await buildImportPlan(db, USER_ID, archiveFixture());
    const createdAt = "2026-09-06T08:30:00.000Z";
    await db.categories.add({
      id: "localcategory01",
      userId: USER_ID,
      revision: 1,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
      name: "预览后新增",
      icon: "plus",
      color: "#123456",
      displayOrder: 1,
      lifecycle: "active",
    });

    const summary = await restoreJsonExport(
      db,
      USER_ID,
      plan,
      "2026-09-06T09:00:00.000Z",
    );

    expect(plan.summary.remove).toBe(0);
    expect(summary).toEqual({ add: 3, update: 0, remove: 1, total: 4 });
    expect((await db.categories.get("localcategory01"))?.deletedAt).not.toBeNull();
  });
});
