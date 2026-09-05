import { describe, expect, it } from "vitest";

import type { ItemRecord, UserSettingsRecord } from "@lastdone/storage";

import { planAndroidNotifications } from "./notificationPlanner";

const settings: UserSettingsRecord = {
  id: "user-1",
  userId: "user-1",
  revision: 1,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  deletedAt: null,
  timeZone: "Asia/Shanghai",
  dueSoonDays: 7,
  digestTime: "09:00",
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
};

function item(
  id: string,
  name: string,
  dueDate: string,
  patch: Partial<ItemRecord> = {},
): ItemRecord {
  return {
    id,
    userId: "user-1",
    revision: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    deletedAt: null,
    name,
    categoryId: "category-1",
    schedule: { type: "relative", every: 1, unit: "months" },
    initialDueDate: dueDate,
    dueDate,
    lastCompletedDate: null,
    lastCompletionId: null,
    important: false,
    reminderOffsets: [],
    lifecycle: "active",
    ...patch,
  };
}

describe("planAndroidNotifications", () => {
  it("builds a local daily digest with the same attention ordering", () => {
    const notifications = planAndroidNotifications({
      now: new Date("2026-09-05T00:30:00.000Z"),
      settings,
      items: [
        item("soon-2", "清洗空调", "2026-09-10"),
        item("overdue-2", "备份电脑", "2026-09-01"),
        item("today", "检查门锁", "2026-09-05"),
        item("overdue-1", "更换滤芯", "2026-08-30"),
        item("soon-1", "车辆保养", "2026-09-07"),
      ],
      preferences: { digestEnabled: true, importantRemindersEnabled: false },
      horizonDays: 1,
    });

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      identity: "digest:2026-09-05",
      title: "LastDone 每日摘要",
      body: "逾期 2 · 今天 1 · 即将 2｜更换滤芯、备份电脑、检查门锁",
      route: "/?filter=attention",
      kind: "digest",
    });
    expect(notifications[0]?.at.toISOString()).toBe("2026-09-05T01:00:00.000Z");
  });

  it("plans important offsets and moves quiet-hour delivery to the morning", () => {
    const notifications = planAndroidNotifications({
      now: new Date("2026-09-04T00:00:00.000Z"),
      settings: { ...settings, digestTime: "23:30" },
      items: [
        item("filter-1", "更换滤芯", "2026-09-12", {
          important: true,
          reminderOffsets: [7, 1, 0],
        }),
      ],
      preferences: { digestEnabled: false, importantRemindersEnabled: true },
    });

    expect(notifications.map((entry) => entry.identity)).toEqual([
      "item:filter-1:due:2026-09-12:important:7",
      "item:filter-1:due:2026-09-12:important:1",
      "item:filter-1:due:2026-09-12:important:0",
    ]);
    expect(notifications[0]?.at.toISOString()).toBe("2026-09-06T00:00:00.000Z");
    expect(notifications[0]?.route).toBe("/items/filter-1");
  });

  it("delivers a missed reminder within twelve hours and drops older ones", () => {
    const important = item("filter-1", "更换滤芯", "2026-09-05", {
      important: true,
      reminderOffsets: [0],
    });
    const withinWindow = planAndroidNotifications({
      now: new Date("2026-09-05T05:00:00.000Z"),
      settings,
      items: [important],
      preferences: { digestEnabled: false, importantRemindersEnabled: true },
    });
    expect(withinWindow[0]?.at.toISOString()).toBe("2026-09-05T05:00:05.000Z");

    const tooLate = planAndroidNotifications({
      now: new Date("2026-09-05T14:00:01.000Z"),
      settings,
      items: [important],
      preferences: { digestEnabled: false, importantRemindersEnabled: true },
    });
    expect(tooLate).toEqual([]);
  });

  it("assigns stable positive 32-bit notification ids", () => {
    const input = {
      now: new Date("2026-09-04T00:00:00.000Z"),
      settings,
      items: [
        item("filter-1", "更换滤芯", "2026-09-12", {
          important: true,
          reminderOffsets: [7, 1, 0],
        }),
      ],
      preferences: { digestEnabled: false, importantRemindersEnabled: true },
    };
    const first = planAndroidNotifications(input);
    const second = planAndroidNotifications(input);

    expect(first.map((entry) => entry.id)).toEqual(second.map((entry) => entry.id));
    expect(new Set(first.map((entry) => entry.id)).size).toBe(first.length);
    expect(first.every((entry) => entry.id > 0 && entry.id <= 2_147_483_647)).toBe(
      true,
    );
  });
});
