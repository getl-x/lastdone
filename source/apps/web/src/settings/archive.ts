import type { ScheduleRule } from "@lastdone/core";
import {
  DEFAULT_CATEGORY_KEYS,
  defaultCategoryId,
  enqueueOperation,
  type CategoryRecord,
  type CompletionRecord,
  type DeviceRecord,
  type ItemRecord,
  type LastDoneDatabase,
  type SkipRecord,
  type SyncEntity,
  type SyncOperation,
  type SyncRecord,
  type UserSettingsRecord,
} from "@lastdone/storage";

export interface LastDoneExport {
  format: "lastdone-export";
  version: 1;
  exportedAt: string;
  categories: CategoryRecord[];
  items: ItemRecord[];
  completions: CompletionRecord[];
  skips: SkipRecord[];
  settings: UserSettingsRecord[];
  devices: DeviceRecord[];
}

export interface ImportSummary {
  add: number;
  update: number;
  remove: number;
  total: number;
}

export interface LastDoneImportPlan {
  archive: LastDoneExport;
  summary: ImportSummary;
}

type RestorableRecord =
  | CategoryRecord
  | ItemRecord
  | CompletionRecord
  | SkipRecord
  | UserSettingsRecord
  | DeviceRecord;

interface RestorableTable<T> {
  get(key: string): Promise<T | undefined>;
  put(record: T): Promise<unknown>;
}

const RECORD_ID = /^[a-z0-9]{15}$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(Z|[+-]\d{2}:[0-5]\d)$/;

function validCalendarDate(year: number, month: number, day: number): boolean {
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= monthLengths[month - 1]!
  );
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function stringValue(
  value: unknown,
  label: string,
  options: { empty?: boolean; max?: number } = {},
): string {
  if (typeof value !== "string" || (!options.empty && value.length === 0)) {
    throw new Error(`${label} 必须是字符串`);
  }
  if (options.max && value.length > options.max) {
    throw new Error(`${label} 超过长度限制`);
  }
  return value;
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} 必须是数字`);
  }
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} 必须是布尔值`);
  }
  return value;
}

function localDateValue(value: unknown, label: string): string {
  const result = stringValue(value, label);
  const match = LOCAL_DATE.exec(result);
  if (!match) {
    throw new Error(`${label} 不是有效日期`);
  }
  const [year, month, day] = result.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month! - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${label} 不是有效日期`);
  }
  return result;
}

function nullableLocalDate(value: unknown, label: string): string | null {
  if (value === null) return null;
  return localDateValue(value, label);
}

function timestampValue(value: unknown, label: string): string {
  const result = stringValue(value, label);
  const match = TIMESTAMP.exec(result);
  if (!match) {
    throw new Error(`${label} 不是有效时间`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!validCalendarDate(year, month, day)) {
    throw new Error(`${label} 不是有效时间`);
  }
  const offset = match[4]!;
  if (offset !== "Z") {
    const [offsetHour, offsetMinute] = offset.slice(1).split(":").map(Number);
    if (offsetHour! > 14 || (offsetHour === 14 && offsetMinute !== 0)) {
      throw new Error(`${label} 不是有效时间`);
    }
  }
  return result;
}

function nullableTimestamp(value: unknown, label: string): string | null {
  if (value === null) return null;
  return timestampValue(value, label);
}

function clockValue(value: unknown, label: string): string {
  const result = stringValue(value, label);
  if (!CLOCK.test(result)) throw new Error(`${label} 不是有效时间`);
  return result;
}

function timeZoneValue(value: unknown, label: string): string {
  const result = stringValue(value, label, { max: 100 });
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: result }).format();
  } catch {
    throw new Error(`${label} 不是有效时区`);
  }
  return result;
}

function recordId(value: unknown, label: string): string {
  const result = stringValue(value, label);
  if (!RECORD_ID.test(result)) {
    throw new Error(`${label} 不是有效的 LastDone 记录 ID`);
  }
  return result;
}

function baseRecord(value: Record<string, unknown>, label: string): SyncRecord {
  const revision = numberValue(value.revision, `${label}.revision`);
  if (!Number.isInteger(revision) || revision < 0) {
    throw new Error(`${label}.revision 必须是非负整数`);
  }
  return {
    id: recordId(value.id, `${label}.id`),
    userId: stringValue(value.userId, `${label}.userId`),
    revision,
    createdAt: timestampValue(value.createdAt, `${label}.createdAt`),
    updatedAt: timestampValue(value.updatedAt, `${label}.updatedAt`),
    deletedAt: nullableTimestamp(value.deletedAt, `${label}.deletedAt`),
  };
}

function scheduleValue(value: unknown, label: string): ScheduleRule {
  const schedule = objectValue(value, label);
  if (schedule.type === "relative") {
    const every = numberValue(schedule.every, `${label}.every`);
    if (!Number.isInteger(every) || every < 1) {
      throw new Error(`${label}.every 必须是正整数`);
    }
    if (
      schedule.unit !== "days" &&
      schedule.unit !== "weeks" &&
      schedule.unit !== "months" &&
      schedule.unit !== "years"
    ) {
      throw new Error(`${label}.unit 不受支持`);
    }
    return { type: "relative", every, unit: schedule.unit };
  }
  if (schedule.type === "fixed-monthly") {
    const day = numberValue(schedule.day, `${label}.day`);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      throw new Error(`${label}.day 必须在 1 到 31 之间`);
    }
    return { type: "fixed-monthly", day };
  }
  if (schedule.type === "fixed-yearly") {
    const month = numberValue(schedule.month, `${label}.month`);
    const day = numberValue(schedule.day, `${label}.day`);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new Error(`${label}.month 必须在 1 到 12 之间`);
    }
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      throw new Error(`${label}.day 必须在 1 到 31 之间`);
    }
    return { type: "fixed-yearly", month, day };
  }
  throw new Error(`${label}.type 不受支持`);
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  return value;
}

function uniqueRecords<T extends SyncRecord>(records: T[], label: string): T[] {
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.id)) throw new Error(`${label} 中存在重复 ID：${record.id}`);
    ids.add(record.id);
  }
  return records;
}

function parseCategory(value: unknown, index: number): CategoryRecord {
  const label = `categories[${index}]`;
  const record = objectValue(value, label);
  const lifecycle = record.lifecycle;
  if (lifecycle !== "active" && lifecycle !== "archived") {
    throw new Error(`${label}.lifecycle 不受支持`);
  }
  const displayOrder = numberValue(record.displayOrder, `${label}.displayOrder`);
  if (!Number.isInteger(displayOrder) || displayOrder < 0) {
    throw new Error(`${label}.displayOrder 必须是非负整数`);
  }
  return {
    ...baseRecord(record, label),
    name: stringValue(record.name, `${label}.name`, { max: 100 }),
    icon: stringValue(record.icon, `${label}.icon`, { max: 64 }),
    color: stringValue(record.color, `${label}.color`, { max: 16 }),
    displayOrder,
    lifecycle,
  };
}

function parseItem(value: unknown, index: number): ItemRecord {
  const label = `items[${index}]`;
  const record = objectValue(value, label);
  const lifecycle = record.lifecycle;
  if (lifecycle !== "active" && lifecycle !== "paused" && lifecycle !== "archived") {
    throw new Error(`${label}.lifecycle 不受支持`);
  }
  const reminderOffsets = arrayValue(
    record.reminderOffsets,
    `${label}.reminderOffsets`,
  ).map((offset, offsetIndex) => {
    const result = numberValue(offset, `${label}.reminderOffsets[${offsetIndex}]`);
    if (!Number.isInteger(result) || result < 0) {
      throw new Error(`${label}.reminderOffsets 只能包含非负整数`);
    }
    return result;
  });
  return {
    ...baseRecord(record, label),
    name: stringValue(record.name, `${label}.name`, { max: 200 }),
    categoryId: recordId(record.categoryId, `${label}.categoryId`),
    schedule: scheduleValue(record.schedule, `${label}.schedule`),
    initialDueDate: nullableLocalDate(record.initialDueDate, `${label}.initialDueDate`),
    dueDate: nullableLocalDate(record.dueDate, `${label}.dueDate`),
    lastCompletedDate: nullableLocalDate(
      record.lastCompletedDate,
      `${label}.lastCompletedDate`,
    ),
    lastCompletionId:
      record.lastCompletionId === null
        ? null
        : recordId(record.lastCompletionId, `${label}.lastCompletionId`),
    important: booleanValue(record.important, `${label}.important`),
    reminderOffsets,
    lifecycle,
  };
}

function parseCompletion(value: unknown, index: number): CompletionRecord {
  const label = `completions[${index}]`;
  const record = objectValue(value, label);
  return {
    ...baseRecord(record, label),
    itemId: recordId(record.itemId, `${label}.itemId`),
    completedAt: timestampValue(record.completedAt, `${label}.completedAt`),
    localDate: localDateValue(record.localDate, `${label}.localDate`),
    note:
      record.note === null
        ? null
        : stringValue(record.note, `${label}.note`, { empty: true, max: 500 }),
    previousDueDate: nullableLocalDate(
      record.previousDueDate,
      `${label}.previousDueDate`,
    ),
    previousLastCompletedDate: nullableLocalDate(
      record.previousLastCompletedDate,
      `${label}.previousLastCompletedDate`,
    ),
    previousLastCompletionId:
      record.previousLastCompletionId === null
        ? null
        : recordId(
            record.previousLastCompletionId,
            `${label}.previousLastCompletionId`,
          ),
  };
}

function parseSkip(value: unknown, index: number): SkipRecord {
  const label = `skips[${index}]`;
  const record = objectValue(value, label);
  return {
    ...baseRecord(record, label),
    itemId: recordId(record.itemId, `${label}.itemId`),
    occurrenceDate: localDateValue(record.occurrenceDate, `${label}.occurrenceDate`),
    note:
      record.note === null
        ? null
        : stringValue(record.note, `${label}.note`, { empty: true, max: 500 }),
  };
}

function parseSettings(value: unknown, index: number): UserSettingsRecord {
  const label = `settings[${index}]`;
  const record = objectValue(value, label);
  const dueSoonDays = numberValue(record.dueSoonDays, `${label}.dueSoonDays`);
  if (!Number.isInteger(dueSoonDays) || dueSoonDays < 1 || dueSoonDays > 90) {
    throw new Error(`${label}.dueSoonDays 必须在 1 到 90 之间`);
  }
  return {
    ...baseRecord(record, label),
    timeZone: timeZoneValue(record.timeZone, `${label}.timeZone`),
    dueSoonDays,
    digestTime: clockValue(record.digestTime, `${label}.digestTime`),
    quietHoursStart: clockValue(record.quietHoursStart, `${label}.quietHoursStart`),
    quietHoursEnd: clockValue(record.quietHoursEnd, `${label}.quietHoursEnd`),
  };
}

function parseDevice(value: unknown, index: number): DeviceRecord {
  const label = `devices[${index}]`;
  const record = objectValue(value, label);
  const platform = record.platform;
  if (platform !== "web" && platform !== "ios-pwa" && platform !== "android") {
    throw new Error(`${label}.platform 不受支持`);
  }
  return {
    ...baseRecord(record, label),
    name: stringValue(record.name, `${label}.name`, { max: 100 }),
    platform,
    digestEnabled: booleanValue(record.digestEnabled, `${label}.digestEnabled`),
    importantRemindersEnabled: booleanValue(
      record.importantRemindersEnabled,
      `${label}.importantRemindersEnabled`,
    ),
    lastSeenAt: timestampValue(record.lastSeenAt, `${label}.lastSeenAt`),
  };
}

export function parseLastDoneExport(value: unknown): LastDoneExport {
  const archive = objectValue(value, "archive");
  if (archive.format !== "lastdone-export" || archive.version !== 1) {
    throw new Error("不支持的 LastDone 备份格式");
  }
  const result: LastDoneExport = {
    format: "lastdone-export",
    version: 1,
    exportedAt: timestampValue(archive.exportedAt, "archive.exportedAt"),
    categories: uniqueRecords(
      arrayValue(archive.categories, "archive.categories").map(parseCategory),
      "categories",
    ),
    items: uniqueRecords(
      arrayValue(archive.items, "archive.items").map(parseItem),
      "items",
    ),
    completions: uniqueRecords(
      arrayValue(archive.completions, "archive.completions").map(parseCompletion),
      "completions",
    ),
    skips: uniqueRecords(
      arrayValue(archive.skips, "archive.skips").map(parseSkip),
      "skips",
    ),
    settings: uniqueRecords(
      arrayValue(archive.settings, "archive.settings").map(parseSettings),
      "settings",
    ),
    devices: uniqueRecords(
      arrayValue(archive.devices, "archive.devices").map(parseDevice),
      "devices",
    ),
  };
  if (result.settings.length !== 1) {
    throw new Error("备份中必须包含一份用户设置");
  }
  const archiveUserId = result.settings[0]!.userId;
  if (result.settings[0]!.id !== archiveUserId) {
    throw new Error("备份中的用户设置 ID 与账号 ID 不一致");
  }
  const recordGroups: RestorableRecord[][] = [
    result.categories,
    result.items,
    result.completions,
    result.skips,
    result.settings,
    result.devices,
  ];
  if (
    recordGroups.some((records) =>
      records.some(({ userId }) => userId !== archiveUserId),
    )
  ) {
    throw new Error("备份中混入了其他账号的数据");
  }

  const categoryIds = new Set(result.categories.map(({ id }) => id));
  const itemIds = new Set(result.items.map(({ id }) => id));
  const completionsById = new Map(
    result.completions.map((completion) => [completion.id, completion]),
  );
  for (const item of result.items) {
    if (!categoryIds.has(item.categoryId)) {
      throw new Error(`事项 ${item.id} 引用了不存在的分类 ${item.categoryId}`);
    }
    if (item.lastCompletionId) {
      const completion = completionsById.get(item.lastCompletionId);
      if (!completion || completion.itemId !== item.id) {
        throw new Error(
          `事项 ${item.id} 引用了不存在或不属于它的完成记录 ${item.lastCompletionId}`,
        );
      }
    }
  }
  for (const completion of result.completions) {
    if (!itemIds.has(completion.itemId)) {
      throw new Error(`完成记录 ${completion.id} 引用了不存在的事项`);
    }
    if (completion.previousLastCompletionId) {
      const previous = completionsById.get(completion.previousLastCompletionId);
      if (!previous || previous.itemId !== completion.itemId) {
        throw new Error(
          `完成记录 ${completion.id} 的上一条完成记录不存在或不属于同一事项`,
        );
      }
    }
  }
  for (const skip of result.skips) {
    if (!itemIds.has(skip.itemId)) {
      throw new Error(`跳过记录 ${skip.id} 引用了不存在的事项`);
    }
  }
  return result;
}

export async function buildJsonExport(
  db: LastDoneDatabase,
  userId: string,
  exportedAt = new Date().toISOString(),
): Promise<LastDoneExport> {
  const [categories, items, completions, skips, settings, devices] = await Promise.all([
    db.categories.where("userId").equals(userId).toArray(),
    db.items.where("userId").equals(userId).toArray(),
    db.completions.where("userId").equals(userId).toArray(),
    db.skips.where("userId").equals(userId).toArray(),
    db.settings.where("userId").equals(userId).toArray(),
    db.devices.where("userId").equals(userId).toArray(),
  ]);
  return {
    format: "lastdone-export",
    version: 1,
    exportedAt,
    categories,
    items,
    completions,
    skips,
    settings,
    devices,
  };
}

function normalizeArchiveUser(archive: LastDoneExport, userId: string): LastDoneExport {
  const categoryIds = new Map<string, string>();
  for (const category of archive.categories) {
    for (const key of DEFAULT_CATEGORY_KEYS) {
      if (category.id === defaultCategoryId(category.userId, key)) {
        categoryIds.set(category.id, defaultCategoryId(userId, key));
        break;
      }
    }
  }
  const categories = uniqueRecords(
    archive.categories.map((category) => ({
      ...category,
      id: categoryIds.get(category.id) ?? category.id,
      userId,
    })),
    "categories",
  );
  return {
    ...archive,
    categories,
    items: archive.items.map((item) => ({
      ...item,
      userId,
      categoryId: categoryIds.get(item.categoryId) ?? item.categoryId,
    })),
    completions: archive.completions.map((completion) => ({
      ...completion,
      userId,
    })),
    skips: archive.skips.map((skip) => ({ ...skip, userId })),
    settings: archive.settings.map((settings) => ({
      ...settings,
      id: userId,
      userId,
    })),
    devices: archive.devices.map((device) => ({ ...device, userId })),
  };
}

function countPlan<T extends SyncRecord>(
  current: T[],
  imported: T[],
  key: (value: T) => string,
) {
  const currentKeys = new Set(current.map(key));
  const importedKeys = new Set(imported.map(key));
  return {
    add: imported.filter((record) => !currentKeys.has(key(record))).length,
    update: imported.filter((record) => currentKeys.has(key(record))).length,
    remove: current.filter(
      (record) => !record.deletedAt && !importedKeys.has(key(record)),
    ).length,
  };
}

export async function buildImportPlan(
  db: LastDoneDatabase,
  userId: string,
  value: unknown,
): Promise<LastDoneImportPlan> {
  const archive = normalizeArchiveUser(parseLastDoneExport(value), userId);
  const [categories, items, completions, skips, settings, devices] = await Promise.all([
    db.categories.where("userId").equals(userId).toArray(),
    db.items.where("userId").equals(userId).toArray(),
    db.completions.where("userId").equals(userId).toArray(),
    db.skips.where("userId").equals(userId).toArray(),
    db.settings.where("userId").equals(userId).toArray(),
    db.devices.where("userId").equals(userId).toArray(),
  ]);
  const plans = [
    countPlan(categories, archive.categories, (record) => record.id),
    countPlan(items, archive.items, (record) => record.id),
    countPlan(completions, archive.completions, (record) => record.id),
    countPlan(skips, archive.skips, (record) => record.id),
    countPlan(settings, archive.settings, (record) => record.userId),
    countPlan(devices, archive.devices, (record) => record.id),
  ];
  const summary = plans.reduce<ImportSummary>(
    (total, plan) => ({
      add: total.add + plan.add,
      update: total.update + plan.update,
      remove: total.remove + plan.remove,
      total: total.total + plan.add + plan.update + plan.remove,
    }),
    { add: 0, update: 0, remove: 0, total: 0 },
  );
  return { archive, summary };
}

function operationFields(record: RestorableRecord): Record<string, unknown> {
  return { ...record };
}

export async function restoreJsonExport(
  db: LastDoneDatabase,
  userId: string,
  plan: LastDoneImportPlan,
  restoredAt = new Date().toISOString(),
): Promise<ImportSummary> {
  const baseTime = new Date(restoredAt).getTime();
  if (!Number.isFinite(baseTime)) throw new Error("恢复时间无效");
  const archive = normalizeArchiveUser(parseLastDoneExport(plan.archive), userId);
  let sequence = 0;
  const nextTimestamp = () => new Date(baseTime + sequence++).toISOString();
  const summary: ImportSummary = { add: 0, update: 0, remove: 0, total: 0 };

  await db.transaction(
    "rw",
    [
      db.categories,
      db.items,
      db.completions,
      db.skips,
      db.settings,
      db.devices,
      db.outbox,
    ],
    async () => {
      async function replaceRecords<T extends RestorableRecord>(
        table: RestorableTable<T>,
        loadCurrent: () => Promise<T[]>,
        imported: T[],
        entity: SyncEntity,
        key: (record: T) => string,
      ) {
        const current = await loadCurrent();
        const currentByKey = new Map(current.map((record) => [key(record), record]));
        const importedKeys = new Set(imported.map(key));

        for (const source of imported) {
          const operationTime = nextTimestamp();
          const existing = currentByKey.get(key(source));
          const occupyingRecord = await table.get(key(source));
          if (occupyingRecord && occupyingRecord.userId !== userId) {
            throw new Error(`记录 ID ${source.id} 已被其他账号使用，无法安全恢复`);
          }
          const record = {
            ...source,
            userId,
            revision: existing ? existing.revision + 1 : 1,
            updatedAt: operationTime,
          } as T;
          if (existing) {
            summary.update += 1;
          } else {
            summary.add += 1;
          }
          await table.put(record);
          const action = existing && existing.revision > 0 ? "update" : "create";
          const operation: SyncOperation = {
            id: crypto.randomUUID(),
            userId,
            entity,
            entityId: record.id,
            action,
            baseRevision: existing?.revision ?? 0,
            fields: operationFields(record),
            createdAt: operationTime,
            status: "pending",
            attempts: 0,
            lastError: null,
          };
          await enqueueOperation(db, operation);
        }

        for (const existing of current) {
          if (importedKeys.has(key(existing)) || existing.deletedAt) continue;
          summary.remove += 1;
          const operationTime = nextTimestamp();
          const record = {
            ...existing,
            revision: existing.revision + 1,
            updatedAt: operationTime,
            deletedAt: operationTime,
          } as T;
          await table.put(record);
          await enqueueOperation(db, {
            id: crypto.randomUUID(),
            userId,
            entity,
            entityId: record.id,
            action: "delete",
            baseRevision: existing.revision,
            fields: {
              revision: record.revision,
              updatedAt: operationTime,
              deletedAt: operationTime,
            },
            createdAt: operationTime,
            status: "pending",
            attempts: 0,
            lastError: null,
          });
        }
      }

      await replaceRecords<CategoryRecord>(
        db.categories,
        () => db.categories.where("userId").equals(userId).toArray(),
        archive.categories,
        "categories",
        (r) => r.id,
      );
      await replaceRecords<ItemRecord>(
        db.items,
        () => db.items.where("userId").equals(userId).toArray(),
        archive.items,
        "items",
        (r) => r.id,
      );
      await replaceRecords<CompletionRecord>(
        db.completions,
        () => db.completions.where("userId").equals(userId).toArray(),
        archive.completions,
        "completions",
        (r) => r.id,
      );
      await replaceRecords<SkipRecord>(
        db.skips,
        () => db.skips.where("userId").equals(userId).toArray(),
        archive.skips,
        "skips",
        (r) => r.id,
      );
      await replaceRecords<UserSettingsRecord>(
        db.settings,
        () => db.settings.where("userId").equals(userId).toArray(),
        archive.settings,
        "settings",
        (r) => r.userId,
      );
      await replaceRecords<DeviceRecord>(
        db.devices,
        () => db.devices.where("userId").equals(userId).toArray(),
        archive.devices,
        "devices",
        (r) => r.id,
      );
    },
  );

  summary.total = summary.add + summary.update + summary.remove;
  return summary;
}
