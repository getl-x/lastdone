import type { ConflictRecord, LastDoneDatabase } from "@lastdone/storage";

import type { RemoteChange } from "./types";

function tableName(entity: RemoteChange["entity"]): string {
  return entity;
}

async function applyChange(db: LastDoneDatabase, change: RemoteChange): Promise<void> {
  const table = db.table<Record<string, unknown>, string>(tableName(change.entity));
  const existing = await table.get(change.entityId);
  const record: Record<string, unknown> = {
    ...(existing ?? {}),
    ...change.fields,
    revision: change.revision,
  };

  if (change.entity === "settings") {
    record.userId = change.userId;
  } else {
    record.id = change.entityId;
    record.userId = change.userId;
  }

  await table.put(record);
}

export async function applyPullPage(
  db: LastDoneDatabase,
  userId: string,
  changes: RemoteChange[],
  conflicts: ConflictRecord[],
  nextSequence: number,
  syncedAt: string,
): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.categories,
      db.items,
      db.completions,
      db.skips,
      db.settings,
      db.devices,
      db.conflicts,
      db.syncMeta,
    ],
    async () => {
      for (const change of changes) {
        await applyChange(db, change);
      }
      if (conflicts.length > 0) {
        await db.conflicts.bulkPut(conflicts);
      }
      await db.syncMeta.put({
        userId,
        lastSequence: nextSequence,
        lastSyncedAt: syncedAt,
        lastError: null,
      });
    },
  );
}
