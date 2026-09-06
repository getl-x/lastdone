import type { LastDoneDatabase } from "./database";
import type { SyncOperation } from "./schema";

export async function enqueueOperation(
  db: LastDoneDatabase,
  operation: SyncOperation,
): Promise<void> {
  const requestedTime = new Date(operation.createdAt).getTime();
  if (!Number.isFinite(requestedTime)) {
    throw new Error(`invalid operation timestamp: ${operation.createdAt}`);
  }
  const latest = await db.outbox.orderBy("createdAt").last();
  const latestTime = latest
    ? new Date(latest.createdAt).getTime()
    : Number.NEGATIVE_INFINITY;
  const createdAt = new Date(Math.max(requestedTime, latestTime + 1)).toISOString();
  await db.outbox.add({ ...operation, createdAt });
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
  userId: string,
  limit: number,
): Promise<SyncOperation[]> {
  if (!Number.isInteger(limit) || limit <= 0) {
    return [];
  }

  return db.outbox
    .where("[status+createdAt]")
    .between(["pending", DexieMinKey], ["pending", DexieMaxKey])
    .filter((operation) => operation.userId === userId)
    .limit(limit)
    .toArray();
}

const DexieMinKey = -Infinity;
const DexieMaxKey = [[]];
