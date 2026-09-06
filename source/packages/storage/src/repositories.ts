import { nextDueDate, type ScheduleRule } from "@lastdone/core";

import type { LastDoneDatabase } from "./database";
import { enqueueOperation } from "./outbox";
import type {
  CategoryRecord,
  CompletionRecord,
  ItemRecord,
  SkipRecord,
  SyncEntity,
  SyncOperation,
  UserSettingsRecord,
} from "./schema";

export type IdGenerator = () => string;

export interface RepositoryOptions {
  userId: string;
  now?: () => string;
  generateId?: IdGenerator;
  generateRecordId?: IdGenerator;
  generateOperationId?: IdGenerator;
}

export interface CreateItemInput {
  name: string;
  categoryId: string;
  schedule: ScheduleRule;
  previousCompletionDate?: string;
  initialDueDate?: string;
  important: boolean;
  reminderOffsets: number[];
}

export interface CompleteItemInput {
  completedAt: string;
  localDate: string;
  note?: string;
}

export interface CreateCategoryInput {
  name: string;
  icon: string;
  color: string;
}

export interface UpdateItemInput {
  name?: string;
  categoryId?: string;
  schedule?: ScheduleRule;
  dueDate?: string | null;
  important?: boolean;
  reminderOffsets?: number[];
}

export interface Repositories {
  categories: {
    ensureDefaults(): Promise<void>;
    create(input: CreateCategoryInput): Promise<CategoryRecord>;
    update(
      categoryId: string,
      patch: Partial<Pick<CategoryRecord, "name" | "icon" | "color" | "displayOrder">>,
    ): Promise<void>;
    move(categoryId: string, direction: -1 | 1): Promise<void>;
    setArchived(categoryId: string, archived: boolean): Promise<void>;
  };
  items: {
    create(input: CreateItemInput): Promise<ItemRecord>;
    update(itemId: string, patch: UpdateItemInput): Promise<void>;
    complete(itemId: string, input: CompleteItemInput): Promise<CompletionRecord>;
    undoCompletion(completionId: string): Promise<void>;
    archive(itemId: string): Promise<void>;
    pause(itemId: string): Promise<void>;
    restore(itemId: string): Promise<void>;
    remove(itemId: string): Promise<void>;
    skip(itemId: string, occurrenceDate: string, note?: string): Promise<SkipRecord>;
  };
  settings: {
    ensureDefaults(): Promise<UserSettingsRecord>;
    update(
      patch: Partial<Omit<UserSettingsRecord, "userId" | "updatedAt">>,
    ): Promise<UserSettingsRecord>;
  };
}

const POCKETBASE_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function stablePocketBaseId(value: string): string {
  let result = "";
  for (let round = 0; result.length < 15; round += 1) {
    let hash = 0x811c9dc5;
    const input = `${round}:${value}`;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    for (let digit = 0; digit < 6 && result.length < 15; digit += 1) {
      result += POCKETBASE_ID_ALPHABET[hash % POCKETBASE_ID_ALPHABET.length];
      hash = Math.floor(hash / POCKETBASE_ID_ALPHABET.length);
    }
  }
  return result;
}

export const DEFAULT_CATEGORY_KEYS = [
  "health",
  "home",
  "digital",
  "devices",
  "vehicle",
  "other",
] as const;

export type DefaultCategoryKey = (typeof DEFAULT_CATEGORY_KEYS)[number];

export function defaultCategoryId(userId: string, key: DefaultCategoryKey): string {
  return stablePocketBaseId(`${userId}:default-category:${key}`);
}

function generatePocketBaseId(): string {
  const random = crypto.getRandomValues(new Uint8Array(15));
  return Array.from(
    random,
    (value) => POCKETBASE_ID_ALPHABET[value % POCKETBASE_ID_ALPHABET.length],
  ).join("");
}

const DEFAULT_CATEGORIES = [
  { key: "health", name: "健康", icon: "heart-pulse", color: "#C65D57" },
  { key: "home", name: "家居", icon: "house", color: "#B57B46" },
  { key: "digital", name: "数字生活", icon: "cloud", color: "#657FA3" },
  { key: "devices", name: "设备", icon: "cpu", color: "#6E7F68" },
  { key: "vehicle", name: "车辆", icon: "car", color: "#8A6E9E" },
  { key: "other", name: "其他", icon: "shapes", color: "#77736D" },
] as const;

function makeOperation(
  generateId: IdGenerator,
  userId: string,
  now: string,
  entity: SyncEntity,
  entityId: string,
  action: SyncOperation["action"],
  baseRevision: number,
  fields: Record<string, unknown>,
): SyncOperation {
  return {
    id: generateId(),
    userId,
    entity,
    entityId,
    action,
    baseRevision,
    fields,
    createdAt: now,
    status: "pending",
    attempts: 0,
    lastError: null,
  };
}

function resolveInitialDates(input: CreateItemInput): {
  initialDueDate: string | null;
  dueDate: string | null;
  lastCompletedDate: string | null;
} {
  if (input.previousCompletionDate && input.initialDueDate) {
    throw new Error(
      "provide either previousCompletionDate or initialDueDate, not both",
    );
  }

  if (input.previousCompletionDate) {
    return {
      initialDueDate: null,
      dueDate: nextDueDate(input.schedule, input.previousCompletionDate),
      lastCompletedDate: input.previousCompletionDate,
    };
  }

  return {
    initialDueDate: input.initialDueDate ?? null,
    dueDate: input.initialDueDate ?? null,
    lastCompletedDate: null,
  };
}

function completionUpdatesProjection(
  item: ItemRecord,
  input: CompleteItemInput,
): boolean {
  return item.lastCompletedDate === null || input.localDate >= item.lastCompletedDate;
}

function dueDateAfterCompletion(item: ItemRecord, localDate: string): string {
  const baseline =
    item.schedule.type === "relative" ? localDate : (item.dueDate ?? localDate);

  return nextDueDate(item.schedule, baseline);
}

function toOperationFields(value: object): Record<string, unknown> {
  return { ...value };
}

export function createRepositories(
  db: LastDoneDatabase,
  options: RepositoryOptions,
): Repositories {
  const now = options.now ?? (() => new Date().toISOString());
  const generateRecordId =
    options.generateRecordId ?? options.generateId ?? generatePocketBaseId;
  const generateOperationId =
    options.generateOperationId ?? options.generateId ?? (() => crypto.randomUUID());

  return {
    categories: {
      async ensureDefaults() {
        await db.transaction("rw", db.categories, db.outbox, async () => {
          const existingCount = await db.categories
            .where("userId")
            .equals(options.userId)
            .count();
          if (existingCount > 0) {
            return;
          }

          for (const [displayOrder, definition] of DEFAULT_CATEGORIES.entries()) {
            const timestamp = now();
            const { key, ...values } = definition;
            const category: CategoryRecord = {
              id: defaultCategoryId(options.userId, key),
              userId: options.userId,
              revision: 1,
              createdAt: timestamp,
              updatedAt: timestamp,
              deletedAt: null,
              ...values,
              displayOrder,
              lifecycle: "active",
            };
            await db.categories.add(category);
            await enqueueOperation(
              db,
              makeOperation(
                () => `default-category:${options.userId}:${key}`,
                options.userId,
                timestamp,
                "categories",
                category.id,
                "create",
                0,
                { ...category },
              ),
            );
          }
        });
      },
      async create(input) {
        const timestamp = now();
        const highest = (
          await db.categories
            .where("userId")
            .equals(options.userId)
            .sortBy("displayOrder")
        ).filter((category) => !category.deletedAt);
        const category: CategoryRecord = {
          id: generateRecordId(),
          userId: options.userId,
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
          deletedAt: null,
          name: input.name.trim(),
          icon: input.icon,
          color: input.color,
          displayOrder:
            (highest.length > 0 ? highest[highest.length - 1]!.displayOrder : -1) + 1,
          lifecycle: "active",
        };
        if (!category.name) {
          throw new Error("category name is required");
        }
        await db.transaction("rw", db.categories, db.outbox, async () => {
          await db.categories.add(category);
          await enqueueOperation(
            db,
            makeOperation(
              generateOperationId,
              options.userId,
              timestamp,
              "categories",
              category.id,
              "create",
              0,
              toOperationFields(category),
            ),
          );
        });
        return category;
      },
      async update(categoryId, requestedPatch) {
        await db.transaction("rw", db.categories, db.outbox, async () => {
          const category = await db.categories.get(categoryId);
          if (!category || category.deletedAt) {
            throw new Error(`category not found: ${categoryId}`);
          }
          const timestamp = now();
          const patch = {
            ...requestedPatch,
            revision: category.revision + 1,
            updatedAt: timestamp,
          };
          if (typeof patch.name === "string") {
            patch.name = patch.name.trim();
            if (!patch.name) {
              throw new Error("category name is required");
            }
          }
          await db.categories.update(categoryId, patch);
          await enqueueOperation(
            db,
            makeOperation(
              generateOperationId,
              options.userId,
              timestamp,
              "categories",
              categoryId,
              "update",
              category.revision,
              patch,
            ),
          );
        });
      },
      async move(categoryId, direction) {
        await db.transaction("rw", db.categories, db.outbox, async () => {
          const categories = (
            await db.categories
              .where("userId")
              .equals(options.userId)
              .sortBy("displayOrder")
          ).filter((category) => !category.deletedAt);
          const currentIndex = categories.findIndex(
            (category) => category.id === categoryId,
          );
          const targetIndex = currentIndex + direction;
          if (currentIndex < 0 || targetIndex < 0 || targetIndex >= categories.length) {
            return;
          }
          const current = categories[currentIndex]!;
          const target = categories[targetIndex]!;
          const timestamp = now();
          const currentPatch = {
            displayOrder: target.displayOrder,
            revision: current.revision + 1,
            updatedAt: timestamp,
          };
          const targetPatch = {
            displayOrder: current.displayOrder,
            revision: target.revision + 1,
            updatedAt: timestamp,
          };
          await db.categories.update(current.id, currentPatch);
          await db.categories.update(target.id, targetPatch);
          await enqueueOperation(
            db,
            makeOperation(
              generateOperationId,
              options.userId,
              timestamp,
              "categories",
              current.id,
              "update",
              current.revision,
              currentPatch,
            ),
          );
          await enqueueOperation(
            db,
            makeOperation(
              generateOperationId,
              options.userId,
              timestamp,
              "categories",
              target.id,
              "update",
              target.revision,
              targetPatch,
            ),
          );
        });
      },
      async setArchived(categoryId, archived) {
        await db.transaction("rw", db.categories, db.outbox, async () => {
          const category = await db.categories.get(categoryId);
          if (!category) {
            throw new Error(`category not found: ${categoryId}`);
          }
          const timestamp = now();
          const patch = {
            lifecycle: archived ? ("archived" as const) : ("active" as const),
            revision: category.revision + 1,
            updatedAt: timestamp,
          };
          await db.categories.update(categoryId, patch);
          await enqueueOperation(
            db,
            makeOperation(
              generateOperationId,
              options.userId,
              timestamp,
              "categories",
              categoryId,
              "update",
              category.revision,
              patch,
            ),
          );
        });
      },
    },
    items: {
      async create(input) {
        const timestamp = now();
        const dates = resolveInitialDates(input);
        const item: ItemRecord = {
          id: generateRecordId(),
          userId: options.userId,
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
          deletedAt: null,
          name: input.name.trim(),
          categoryId: input.categoryId,
          schedule: input.schedule,
          ...dates,
          lastCompletionId: null,
          important: input.important,
          reminderOffsets: [...input.reminderOffsets],
          lifecycle: "active",
        };

        if (!item.name) {
          throw new Error("item name is required");
        }

        await db.transaction("rw", db.items, db.outbox, async () => {
          await db.items.add(item);
          await enqueueOperation(
            db,
            makeOperation(
              generateOperationId,
              options.userId,
              timestamp,
              "items",
              item.id,
              "create",
              0,
              { ...item },
            ),
          );
        });

        return item;
      },

      async update(itemId, requestedPatch) {
        await db.transaction("rw", db.items, db.outbox, async () => {
          const item = await db.items.get(itemId);
          if (!item || item.deletedAt) {
            throw new Error(`item not found: ${itemId}`);
          }
          const timestamp = now();
          const patch: Partial<ItemRecord> = {
            ...requestedPatch,
            revision: item.revision + 1,
            updatedAt: timestamp,
          };
          if (typeof requestedPatch.name === "string") {
            const name = requestedPatch.name.trim();
            if (!name) {
              throw new Error("item name is required");
            }
            patch.name = name;
          }
          await db.items.update(itemId, patch);
          await enqueueOperation(
            db,
            makeOperation(
              generateOperationId,
              options.userId,
              timestamp,
              "items",
              itemId,
              "update",
              item.revision,
              toOperationFields(patch),
            ),
          );
        });
      },

      async complete(itemId, input) {
        let result: CompletionRecord | undefined;

        await db.transaction("rw", db.items, db.completions, db.outbox, async () => {
          const item = await db.items.get(itemId);
          if (!item || item.deletedAt) {
            throw new Error(`item not found: ${itemId}`);
          }

          const timestamp = now();
          const updatesProjection = completionUpdatesProjection(item, input);
          const completion: CompletionRecord = {
            id: generateRecordId(),
            userId: options.userId,
            revision: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
            deletedAt: null,
            itemId,
            completedAt: input.completedAt,
            localDate: input.localDate,
            note: input.note?.trim() || null,
            previousDueDate: item.dueDate,
            previousLastCompletedDate: item.lastCompletedDate,
            previousLastCompletionId: item.lastCompletionId,
          };

          await db.completions.add(completion);
          await enqueueOperation(
            db,
            makeOperation(
              generateOperationId,
              options.userId,
              timestamp,
              "completions",
              completion.id,
              "create",
              0,
              { ...completion },
            ),
          );

          if (updatesProjection) {
            const itemPatch = {
              lastCompletedDate: input.localDate,
              lastCompletionId: completion.id,
              dueDate: dueDateAfterCompletion(item, input.localDate),
              revision: item.revision + 1,
              updatedAt: timestamp,
            };
            await db.items.update(item.id, itemPatch);
            await enqueueOperation(
              db,
              makeOperation(
                generateOperationId,
                options.userId,
                timestamp,
                "items",
                item.id,
                "update",
                item.revision,
                itemPatch,
              ),
            );
          }

          result = completion;
        });

        if (!result) {
          throw new Error("completion transaction did not produce a record");
        }

        return result;
      },

      async undoCompletion(completionId) {
        await db.transaction("rw", db.items, db.completions, db.outbox, async () => {
          const completion = await db.completions.get(completionId);
          if (!completion || completion.deletedAt) {
            throw new Error(`completion not found: ${completionId}`);
          }

          const item = await db.items.get(completion.itemId);
          if (!item || item.deletedAt) {
            throw new Error(`item not found: ${completion.itemId}`);
          }

          const timestamp = now();
          const completionPatch = {
            deletedAt: timestamp,
            updatedAt: timestamp,
            revision: completion.revision + 1,
          };
          await db.completions.update(completion.id, completionPatch);
          await enqueueOperation(
            db,
            makeOperation(
              generateOperationId,
              options.userId,
              timestamp,
              "completions",
              completion.id,
              "delete",
              completion.revision,
              completionPatch,
            ),
          );

          if (item.lastCompletionId === completion.id) {
            const itemPatch = {
              dueDate: completion.previousDueDate,
              lastCompletedDate: completion.previousLastCompletedDate,
              lastCompletionId: completion.previousLastCompletionId,
              revision: item.revision + 1,
              updatedAt: timestamp,
            };
            await db.items.update(item.id, itemPatch);
            await enqueueOperation(
              db,
              makeOperation(
                generateOperationId,
                options.userId,
                timestamp,
                "items",
                item.id,
                "update",
                item.revision,
                itemPatch,
              ),
            );
          }
        });
      },

      async archive(itemId) {
        await db.transaction("rw", db.items, db.outbox, async () => {
          const item = await db.items.get(itemId);
          if (!item || item.deletedAt) {
            throw new Error(`item not found: ${itemId}`);
          }

          const timestamp = now();
          const patch = {
            lifecycle: "archived" as const,
            revision: item.revision + 1,
            updatedAt: timestamp,
          };
          await db.items.update(item.id, patch);
          await enqueueOperation(
            db,
            makeOperation(
              generateOperationId,
              options.userId,
              timestamp,
              "items",
              item.id,
              "update",
              item.revision,
              patch,
            ),
          );
        });
      },

      async pause(itemId) {
        await db.transaction("rw", db.items, db.outbox, async () => {
          const current = await db.items.get(itemId);
          if (!current) {
            throw new Error(`item not found: ${itemId}`);
          }
          const timestamp = now();
          const patch = {
            lifecycle: "paused" as const,
            revision: current.revision + 1,
            updatedAt: timestamp,
          };
          await db.items.update(itemId, patch);
          await enqueueOperation(
            db,
            makeOperation(
              generateOperationId,
              options.userId,
              timestamp,
              "items",
              itemId,
              "update",
              current.revision,
              patch,
            ),
          );
        });
      },

      async restore(itemId) {
        const item = await db.items.get(itemId);
        if (!item || item.deletedAt) {
          throw new Error(`item not found: ${itemId}`);
        }
        const timestamp = now();
        const patch = {
          lifecycle: "active" as const,
          revision: item.revision + 1,
          updatedAt: timestamp,
        };
        await db.transaction("rw", db.items, db.outbox, async () => {
          await db.items.update(itemId, patch);
          await enqueueOperation(
            db,
            makeOperation(
              generateOperationId,
              options.userId,
              timestamp,
              "items",
              itemId,
              "update",
              item.revision,
              patch,
            ),
          );
        });
      },

      async remove(itemId) {
        const item = await db.items.get(itemId);
        if (!item || item.deletedAt) {
          throw new Error(`item not found: ${itemId}`);
        }
        const timestamp = now();
        const patch = {
          deletedAt: timestamp,
          revision: item.revision + 1,
          updatedAt: timestamp,
        };
        await db.transaction("rw", db.items, db.outbox, async () => {
          await db.items.update(itemId, patch);
          await enqueueOperation(
            db,
            makeOperation(
              generateOperationId,
              options.userId,
              timestamp,
              "items",
              itemId,
              "delete",
              item.revision,
              patch,
            ),
          );
        });
      },

      async skip(itemId, occurrenceDate, note) {
        const item = await db.items.get(itemId);
        if (!item || item.deletedAt) {
          throw new Error(`item not found: ${itemId}`);
        }
        if (item.schedule.type === "relative") {
          throw new Error("relative schedules cannot be skipped");
        }
        const timestamp = now();
        const skip: SkipRecord = {
          id: generateRecordId(),
          userId: options.userId,
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
          deletedAt: null,
          itemId,
          occurrenceDate,
          note: note?.trim() || null,
        };
        const itemPatch = {
          dueDate: nextDueDate(item.schedule, occurrenceDate),
          revision: item.revision + 1,
          updatedAt: timestamp,
        };
        await db.transaction("rw", db.items, db.skips, db.outbox, async () => {
          await db.skips.add(skip);
          await db.items.update(itemId, itemPatch);
          await enqueueOperation(
            db,
            makeOperation(
              generateOperationId,
              options.userId,
              timestamp,
              "skips",
              skip.id,
              "create",
              0,
              toOperationFields(skip),
            ),
          );
          await enqueueOperation(
            db,
            makeOperation(
              generateOperationId,
              options.userId,
              timestamp,
              "items",
              itemId,
              "update",
              item.revision,
              itemPatch,
            ),
          );
        });
        return skip;
      },
    },
    settings: {
      async ensureDefaults() {
        return db.transaction("rw", db.settings, db.outbox, async () => {
          const existing = await db.settings.get(options.userId);
          if (existing) {
            return existing;
          }
          const timestamp = now();
          const settings: UserSettingsRecord = {
            id: options.userId,
            userId: options.userId,
            revision: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
            deletedAt: null,
            timeZone: "Asia/Shanghai",
            dueSoonDays: 7,
            digestTime: "09:00",
            quietHoursStart: "22:00",
            quietHoursEnd: "08:00",
          };
          await db.settings.add(settings);
          await enqueueOperation(
            db,
            makeOperation(
              () => `default-settings:${options.userId}`,
              options.userId,
              timestamp,
              "settings",
              options.userId,
              "create",
              0,
              toOperationFields(settings),
            ),
          );
          return settings;
        });
      },
      async update(requestedPatch) {
        const current = await this.ensureDefaults();
        const timestamp = now();
        const settings: UserSettingsRecord = {
          ...current,
          ...requestedPatch,
          userId: options.userId,
          revision: current.revision + 1,
          updatedAt: timestamp,
        };
        await db.transaction("rw", db.settings, db.outbox, async () => {
          await db.settings.put(settings);
          await enqueueOperation(
            db,
            makeOperation(
              generateOperationId,
              options.userId,
              timestamp,
              "settings",
              options.userId,
              "update",
              current.revision,
              toOperationFields({
                ...requestedPatch,
                revision: settings.revision,
                updatedAt: timestamp,
              }),
            ),
          );
        });
        return settings;
      },
    },
  };
}
