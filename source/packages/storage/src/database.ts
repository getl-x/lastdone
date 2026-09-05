import Dexie, { type EntityTable } from "dexie";

import type {
  CategoryRecord,
  CompletionRecord,
  ConflictRecord,
  DeviceRecord,
  ItemRecord,
  SkipRecord,
  SyncMetaRecord,
  SyncOperation,
  UserSettingsRecord,
} from "./schema";

export class LastDoneDatabase extends Dexie {
  categories!: EntityTable<CategoryRecord, "id">;
  items!: EntityTable<ItemRecord, "id">;
  completions!: EntityTable<CompletionRecord, "id">;
  skips!: EntityTable<SkipRecord, "id">;
  settings!: EntityTable<UserSettingsRecord, "userId">;
  devices!: EntityTable<DeviceRecord, "id">;
  outbox!: EntityTable<SyncOperation, "id">;
  syncMeta!: EntityTable<SyncMetaRecord, "userId">;
  conflicts!: EntityTable<ConflictRecord, "id">;

  constructor(name = "lastdone") {
    super(name);

    this.version(1).stores({
      categories:
        "&id,userId,name,displayOrder,[userId+displayOrder],lifecycle,updatedAt,deletedAt",
      items: "&id,userId,categoryId,dueDate,lifecycle,important,updatedAt,deletedAt",
      completions:
        "&id,userId,itemId,[itemId+completedAt],localDate,updatedAt,deletedAt",
      skips: "&id,userId,itemId,[itemId+occurrenceDate],updatedAt,deletedAt",
      settings: "&userId,id,revision,updatedAt,deletedAt",
      devices: "&id,userId,platform,lastSeenAt,deletedAt",
      outbox: "&id,userId,status,createdAt,[status+createdAt],entity,entityId",
      syncMeta: "&userId,lastSequence",
      conflicts: "&id,userId,status,createdAt,entity,entityId",
    });
  }
}
