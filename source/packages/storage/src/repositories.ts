import { nextDueDate, type ScheduleRule } from "@lastdone/core";

import type { LastDoneDatabase } from "./database";
import { enqueueOperation } from "./outbox";
import type {
  CategoryRecord,
  CompletionRecord,
  ItemRecord,
  SyncEntity,
  SyncOperation,
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

export interface Repositories {
  categories: {
    ensureDefaults(): Promise<void>;
  };
  items: {
    create(input: CreateItemInput): Promise<ItemRecord>;
    complete(itemId: string, input: CompleteItemInput): Promise<CompletionRecord>;
    undoCompletion(completionId: string): Promise<void>;
    archive(itemId: string): Promise<void>;
  };
}

const POCKETBASE_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function generatePocketBaseId(): string {
  const random = crypto.getRandomValues(new Uint8Array(15));
  return Array.from(
    random,
    (value) => POCKETBASE_ID_ALPHABET[value % POCKETBASE_ID_ALPHABET.length],
  ).join("");
}

const DEFAULT_CATEGORIES = [
  { name: "健康", icon: "heart-pulse", color: "#C65D57" },
  { name: "家居", icon: "house", color: "#B57B46" },
  { name: "数字生活", icon: "cloud", color: "#657FA3" },
  { name: "设备", icon: "cpu", color: "#6E7F68" },
  { name: "车辆", icon: "car", color: "#8A6E9E" },
  { name: "其他", icon: "shapes", color: "#77736D" },
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
        const existingCount = await db.categories
          .where("userId")
          .equals(options.userId)
          .count();

        if (existingCount > 0) {
          return;
        }

        await db.transaction("rw", db.categories, db.outbox, async () => {
          for (const [displayOrder, definition] of DEFAULT_CATEGORIES.entries()) {
            const timestamp = now();
            const category: CategoryRecord = {
              id: generateRecordId(),
              userId: options.userId,
              revision: 0,
              createdAt: timestamp,
              updatedAt: timestamp,
              deletedAt: null,
              ...definition,
              displayOrder,
              lifecycle: "active",
            };
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
                { ...category },
              ),
            );
          }
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
          revision: 0,
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
            revision: 0,
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
    },
  };
}
