import type { ItemRecord, UserSettingsRecord } from "@lastdone/storage";

import type { NotificationPreferences } from "../notifications/client";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_PATTERN = /^(\d{2}):(\d{2})$/;
const MAX_NOTIFICATION_ID = 2_147_483_647;
const MAX_CATCH_UP_MS = 12 * 60 * 60 * 1000;
const CATCH_UP_DELAY_MS = 5_000;

export type AndroidNotificationKind = "digest" | "important";

export interface PlannedAndroidNotification {
  id: number;
  identity: string;
  title: string;
  body: string;
  route: string;
  kind: AndroidNotificationKind;
  at: Date;
  catchUp: boolean;
}

export interface AndroidNotificationPlanInput {
  now: Date;
  settings: UserSettingsRecord;
  items: ItemRecord[];
  preferences: NotificationPreferences;
  horizonDays?: number;
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

interface ClockParts {
  hour: number;
  minute: number;
}

type PendingPlan = Omit<PlannedAndroidNotification, "id">;

function parseLocalDate(value: string): LocalDateParts | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function parseClock(value: string): ClockParts {
  const match = CLOCK_PATTERN.exec(value);
  if (!match) throw new Error(`invalid clock value: ${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new Error(`invalid clock value: ${value}`);
  }
  return { hour, minute };
}

function formatLocalDate(parts: LocalDateParts): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(
    2,
    "0",
  )}-${String(parts.day).padStart(2, "0")}`;
}

function addLocalDays(value: string, days: number): string {
  const parts = parseLocalDate(value);
  if (!parts) throw new Error(`invalid local date: ${value}`);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return formatLocalDate({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

function localPartsAt(date: Date, timeZone: string): LocalDateParts & ClockParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function zonedDateTime(localDate: string, clock: ClockParts, timeZone: string): Date {
  const date = parseLocalDate(localDate);
  if (!date) throw new Error(`invalid local date: ${localDate}`);

  const target = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    clock.hour,
    clock.minute,
  );
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = localPartsAt(new Date(guess), timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    );
    const correction = target - actualAsUtc;
    if (correction === 0) break;
    guess += correction;
  }
  return new Date(guess);
}

function delayForQuietHours(
  localDate: string,
  nominal: ClockParts,
  quietStart: ClockParts,
  quietEnd: ClockParts,
): { localDate: string; clock: ClockParts } {
  const value = nominal.hour * 60 + nominal.minute;
  const start = quietStart.hour * 60 + quietStart.minute;
  const end = quietEnd.hour * 60 + quietEnd.minute;
  if (start === end) return { localDate, clock: nominal };

  if (start < end) {
    return value >= start && value < end
      ? { localDate, clock: quietEnd }
      : { localDate, clock: nominal };
  }

  if (value >= start) {
    return { localDate: addLocalDays(localDate, 1), clock: quietEnd };
  }
  if (value < end) {
    return { localDate, clock: quietEnd };
  }
  return { localDate, clock: nominal };
}

function deliveryTime(
  now: Date,
  localDate: string,
  nominal: ClockParts,
  settings: UserSettingsRecord,
): { at: Date; catchUp: boolean } | null {
  const delayed = delayForQuietHours(
    localDate,
    nominal,
    parseClock(settings.quietHoursStart),
    parseClock(settings.quietHoursEnd),
  );
  const planned = zonedDateTime(delayed.localDate, delayed.clock, settings.timeZone);
  if (planned.getTime() > now.getTime()) return { at: planned, catchUp: false };
  if (now.getTime() - planned.getTime() > MAX_CATCH_UP_MS) return null;
  return { at: new Date(now.getTime() + CATCH_UP_DELAY_MS), catchUp: true };
}

function attentionForDate(
  items: ItemRecord[],
  logicalDate: string,
  dueSoonDays: number,
) {
  const boundary = addLocalDays(logicalDate, dueSoonDays);
  const attention = items
    .filter(
      (item) =>
        !item.deletedAt &&
        item.lifecycle === "active" &&
        item.dueDate !== null &&
        parseLocalDate(item.dueDate) !== null &&
        item.dueDate <= boundary,
    )
    .map((item) => ({
      item,
      priority: item.dueDate! < logicalDate ? 0 : item.dueDate === logicalDate ? 1 : 2,
    }))
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        left.item.dueDate!.localeCompare(right.item.dueDate!) ||
        left.item.name.localeCompare(right.item.name, "zh-CN"),
    );

  return {
    attention,
    overdue: attention.filter((entry) => entry.priority === 0).length,
    dueToday: attention.filter((entry) => entry.priority === 1).length,
    dueSoon: attention.filter((entry) => entry.priority === 2).length,
  };
}

function digestBody(
  overdue: number,
  dueToday: number,
  dueSoon: number,
  names: string[],
): string {
  const summary = `逾期 ${overdue} · 今天 ${dueToday} · 即将 ${dueSoon}`;
  return names.length > 0 ? `${summary}｜${names.slice(0, 3).join("、")}` : summary;
}

function reminderBody(offset: number, dueDate: string): string {
  if (offset === 0) return `今天到期（${dueDate}）`;
  if (offset === 1) return `明天到期（${dueDate}）`;
  return `还有 ${offset} 天到期（${dueDate}）`;
}

export function stableNotificationId(identity: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const positive = hash & MAX_NOTIFICATION_ID;
  return positive === 0 ? 1 : positive;
}

function assignStableIds(entries: PendingPlan[]): PlannedAndroidNotification[] {
  const used = new Set<number>();
  return [...entries]
    .sort((left, right) => left.identity.localeCompare(right.identity))
    .map((entry) => {
      let id = stableNotificationId(entry.identity);
      while (used.has(id)) id = id === MAX_NOTIFICATION_ID ? 1 : id + 1;
      used.add(id);
      return { ...entry, id };
    })
    .sort(
      (left, right) =>
        left.at.getTime() - right.at.getTime() ||
        left.identity.localeCompare(right.identity),
    );
}

export function planAndroidNotifications(
  input: AndroidNotificationPlanInput,
): PlannedAndroidNotification[] {
  if (!Number.isFinite(input.settings.dueSoonDays) || input.settings.dueSoonDays < 0) {
    throw new Error("due soon days must not be negative");
  }
  const horizonDays = Math.max(1, Math.floor(input.horizonDays ?? 90));
  const digestClock = parseClock(input.settings.digestTime);
  const localNow = localPartsAt(input.now, input.settings.timeZone);
  const today = formatLocalDate(localNow);
  const horizonEnd = zonedDateTime(
    addLocalDays(today, horizonDays),
    { hour: 0, minute: 0 },
    input.settings.timeZone,
  );
  const entries: PendingPlan[] = [];

  if (input.preferences.digestEnabled) {
    for (let dayOffset = -1; dayOffset < horizonDays; dayOffset += 1) {
      const logicalDate = addLocalDays(today, dayOffset);
      const view = attentionForDate(
        input.items,
        logicalDate,
        input.settings.dueSoonDays,
      );
      if (view.attention.length === 0) continue;
      const delivery = deliveryTime(
        input.now,
        logicalDate,
        digestClock,
        input.settings,
      );
      if (!delivery || delivery.at >= horizonEnd) continue;
      entries.push({
        identity: `digest:${logicalDate}`,
        title: "LastDone 每日摘要",
        body: digestBody(
          view.overdue,
          view.dueToday,
          view.dueSoon,
          view.attention.map((entry) => entry.item.name),
        ),
        route: "/?filter=attention",
        kind: "digest",
        ...delivery,
      });
    }
  }

  if (input.preferences.importantRemindersEnabled) {
    for (const item of input.items) {
      if (
        item.deletedAt ||
        !item.important ||
        item.lifecycle !== "active" ||
        !item.dueDate ||
        !parseLocalDate(item.dueDate)
      ) {
        continue;
      }
      const seen = new Set<number>();
      for (const offset of item.reminderOffsets) {
        if (!Number.isInteger(offset) || offset < 0 || seen.has(offset)) continue;
        seen.add(offset);
        const logicalDate = addLocalDays(item.dueDate, -offset);
        const delivery = deliveryTime(
          input.now,
          logicalDate,
          digestClock,
          input.settings,
        );
        if (!delivery || delivery.at >= horizonEnd) continue;
        entries.push({
          identity: `item:${item.id}:due:${item.dueDate}:important:${offset}`,
          title: item.name,
          body: reminderBody(offset, item.dueDate),
          route: `/items/${item.id}`,
          kind: "important",
          ...delivery,
        });
      }
    }
  }

  return assignStableIds(entries);
}
