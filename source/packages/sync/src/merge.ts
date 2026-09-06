import type { ConflictRecord, LastDoneDatabase } from "@lastdone/storage";

import type { RemoteChange } from "./types";

function tableName(entity: RemoteChange["entity"]): string {
  return entity;
}

const CHANGE_METADATA_FIELDS = new Set([
  "id",
  "userId",
  "revision",
  "fieldRevisions",
  "createdAt",
  "updatedAt",
]);

async function applyChange(db: LastDoneDatabase, change: RemoteChange): Promise<void> {
  const table = db.table<Record<string, unknown>, string>(tableName(change.entity));
  const existing = await table.get(change.entityId);
  if (existing && existing.userId !== change.userId) {
    throw new Error(`remote change would overwrite another user: ${change.entityId}`);
  }
  const record: Record<string, unknown> = {
    ...(existing ?? {}),
    ...change.fields,
    id: change.entityId,
    userId: change.userId,
    revision: change.revision,
  };

  await table.put(record);
}

async function resolveSupersededConflicts(
  db: LastDoneDatabase,
  change: RemoteChange,
  resolvedAt: string,
): Promise<void> {
  const changedFields = new Set(
    Object.keys(change.fields).filter((field) => !CHANGE_METADATA_FIELDS.has(field)),
  );
  if (change.action !== "delete" && changedFields.size === 0) return;

  const conflicts = await db.conflicts
    .where("userId")
    .equals(change.userId)
    .filter(
      (conflict) =>
        conflict.status === "unresolved" &&
        conflict.entity === change.entity &&
        conflict.entityId === change.entityId &&
        change.revision > conflict.serverRevision &&
        (change.action === "delete" || changedFields.has(conflict.field)),
    )
    .toArray();
  for (const conflict of conflicts) {
    await db.conflicts.update(conflict.id, {
      status: "resolved",
      resolvedAt,
    });
  }
}

export async function applyPullPage(
  db: LastDoneDatabase,
  userId: string,
  changes: RemoteChange[],
  conflicts: ConflictRecord[],
  nextSequence: number,
  syncedAt: string,
): Promise<void> {
  if (changes.some((change) => change.userId !== userId)) {
    throw new Error("pull response contains a change for another user");
  }
  if (conflicts.some((conflict) => conflict.userId !== userId)) {
    throw new Error("pull response contains a conflict for another user");
  }
  if (
    changes.some((change) => change.entity === "settings" && change.entityId !== userId)
  ) {
    throw new Error("pull response contains invalid settings ownership");
  }
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
        await resolveSupersededConflicts(db, change, syncedAt);
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
