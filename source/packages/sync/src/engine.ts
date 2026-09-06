import {
  listPendingOperations,
  type LastDoneDatabase,
  type SyncOperation,
} from "@lastdone/storage";

import { applyPullPage } from "./merge";
import type { SyncEngine, SyncEngineOptions, SyncResult } from "./types";

const PUSH_LIMIT = 100;
const PULL_LIMIT = 500;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

async function recordPushFailure(
  db: LastDoneDatabase,
  userId: string,
  operations: SyncOperation[],
  error: Error,
): Promise<void> {
  await db.transaction("rw", db.outbox, db.syncMeta, async () => {
    for (const operation of operations) {
      await db.outbox.update(operation.id, {
        attempts: operation.attempts + 1,
        lastError: error.message,
      });
    }

    const meta = await db.syncMeta.get(userId);
    await db.syncMeta.put({
      userId,
      lastSequence: meta?.lastSequence ?? 0,
      lastSyncedAt: meta?.lastSyncedAt ?? null,
      lastError: error.message,
    });
  });
}

export function createSyncEngine(options: SyncEngineOptions): SyncEngine {
  const clock = options.clock ?? (() => new Date().toISOString());
  const foregroundIntervalMs = options.foregroundIntervalMs ?? 60_000;
  let interval: ReturnType<typeof setInterval> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelayMs = 1_000;
  let activeRun: Promise<SyncResult> | undefined;
  let rerunRequested = false;

  async function execute(): Promise<SyncResult> {
    const result: SyncResult = { pushed: 0, pulled: 0, conflicts: 0 };
    const pending = await listPendingOperations(options.db, PUSH_LIMIT);

    if (pending.length > 0) {
      try {
        const response = await options.transport.push(pending);
        await options.db.transaction(
          "rw",
          options.db.outbox,
          options.db.conflicts,
          async () => {
            for (const operationId of response.appliedOperationIds) {
              await options.db.outbox.update(operationId, {
                status: "applied",
                appliedAt: clock(),
                lastError: null,
              });
            }
            if (response.conflicts.length > 0) {
              await options.db.conflicts.bulkPut(response.conflicts);
            }
          },
        );
        result.pushed += response.appliedOperationIds.length;
        result.conflicts += response.conflicts.length;
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error("unknown sync error");
        await recordPushFailure(options.db, options.userId, pending, error);
        throw error;
      }
    }

    const meta = await options.db.syncMeta.get(options.userId);
    let after = meta?.lastSequence ?? 0;
    let hasMore = true;

    while (hasMore) {
      const response = await options.transport.pull(after, PULL_LIMIT);
      await applyPullPage(
        options.db,
        options.userId,
        response.changes,
        response.conflicts,
        response.nextSequence,
        clock(),
      );
      result.pulled += response.changes.length;
      result.conflicts += response.conflicts.length;
      after = response.nextSequence;
      hasMore = response.hasMore;
    }

    retryDelayMs = 1_000;
    return result;
  }

  function run(): Promise<SyncResult> {
    if (activeRun) {
      rerunRequested = true;
      return activeRun;
    }

    activeRun = (async () => {
      const combined: SyncResult = { pushed: 0, pulled: 0, conflicts: 0 };
      do {
        rerunRequested = false;
        const result = await execute();
        combined.pushed += result.pushed;
        combined.pulled += result.pulled;
        combined.conflicts += result.conflicts;
      } while (rerunRequested);
      options.onCompleted?.(combined);
      return combined;
    })().finally(() => {
      activeRun = undefined;
    });

    return activeRun;
  }

  function scheduleRetry(): void {
    if (retryTimer) {
      return;
    }
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void run().catch(() => scheduleRetry());
    }, retryDelayMs);
    retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
  }

  return {
    run,
    start() {
      if (interval) {
        return;
      }
      void run().catch(() => scheduleRetry());
      interval = setInterval(() => {
        void run().catch(() => scheduleRetry());
      }, foregroundIntervalMs);
    },
    stop() {
      if (interval) {
        clearInterval(interval);
        interval = undefined;
      }
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
    },
  };
}
