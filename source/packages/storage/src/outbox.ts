import type { LastDoneDatabase } from "./database";
import type { SyncOperation } from "./schema";

export async function enqueueOperation(
  db: LastDoneDatabase,
  operation: SyncOperation,
): Promise<void> {
  await db.outbox.add(operation);
}

export async function markOperationApplied(
  db: LastDoneDatabase,
  operationId: string,
): Promise<void> {
  const updated = await db.outbox.update(operationId, {
    status: "applied",
    appliedAt: new Date().toISOString(),
    lastError: null,
  });

  if (!updated) {
    throw new Error(`operation not found: ${operationId}`);
  }
}

export async function listPendingOperations(
  db: LastDoneDatabase,
  limit: number,
): Promise<SyncOperation[]> {
  if (!Number.isInteger(limit) || limit <= 0) {
    return [];
  }

  return db.outbox
    .where("[status+createdAt]")
    .between(["pending", DexieMinKey], ["pending", DexieMaxKey])
    .limit(limit)
    .toArray();
}

const DexieMinKey = -Infinity;
const DexieMaxKey = [[]];
