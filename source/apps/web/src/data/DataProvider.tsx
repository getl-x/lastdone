import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type PropsWithChildren,
} from "react";

import {
  LastDoneDatabase,
  createRepositories,
  type IdGenerator,
  type Repositories,
} from "@lastdone/storage";
import { createSyncEngine, type SyncEngine, type SyncTransport } from "@lastdone/sync";

import { dispatchSyncCompleted } from "../native/events";

interface DataContextValue {
  db: LastDoneDatabase;
  repositories: Repositories;
  userId: string;
  resolveConflict(conflictId: string, choice: "local" | "server"): Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({
  children,
  db: providedDatabase,
  userId,
  now,
  generateRecordId,
  generateOperationId,
  syncTransport,
}: PropsWithChildren<{
  db?: LastDoneDatabase;
  userId: string;
  now?: () => string;
  generateRecordId?: IdGenerator;
  generateOperationId?: IdGenerator;
  syncTransport?: SyncTransport;
}>) {
  const database = useMemo(
    () => providedDatabase ?? new LastDoneDatabase(`lastdone-${userId}`),
    [providedDatabase, userId],
  );
  const repositories = useMemo(
    () =>
      createRepositories(database, {
        userId,
        now,
        generateRecordId,
        generateOperationId,
      }),
    [database, generateOperationId, generateRecordId, now, userId],
  );
  const syncEngineRef = useRef<SyncEngine | null>(null);

  useEffect(() => {
    void Promise.all([
      repositories.categories.ensureDefaults(),
      repositories.settings.ensureDefaults(),
    ]);
    return () => {
      if (!providedDatabase) {
        database.close();
      }
    };
  }, [database, providedDatabase, repositories]);

  useEffect(() => {
    if (!syncTransport) {
      return;
    }

    const engine = createSyncEngine({
      db: database,
      userId,
      transport: syncTransport,
      onCompleted: dispatchSyncCompleted,
    });
    syncEngineRef.current = engine;
    const run = () => {
      void engine.run().catch(() => {
        // The engine persists a recoverable error and retries while active.
      });
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        run();
      }
    };
    const handleOutboxCreate = () => queueMicrotask(run);

    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", handleVisibility);
    database.outbox.hook("creating", handleOutboxCreate);
    engine.start();

    return () => {
      if (syncEngineRef.current === engine) {
        syncEngineRef.current = null;
      }
      engine.stop();
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", handleVisibility);
      database.outbox.hook("creating").unsubscribe(handleOutboxCreate);
    };
  }, [database, syncTransport, userId]);

  const resolveConflict = useCallback(
    async (conflictId: string, choice: "local" | "server") => {
      if (!syncTransport?.resolveConflict) {
        throw new Error("conflict resolution requires an online server");
      }
      const conflict = await database.conflicts.get(conflictId);
      if (!conflict || conflict.userId !== userId) {
        throw new Error("conflict does not belong to the signed-in user");
      }
      const resolved = await syncTransport.resolveConflict(conflictId, choice);
      if (
        resolved.id !== conflictId ||
        resolved.userId !== userId ||
        resolved.status !== "resolved"
      ) {
        throw new Error("server returned an invalid conflict resolution");
      }
      await database.conflicts.update(conflictId, {
        status: "resolved",
        resolvedAt: resolved.resolvedAt ?? new Date().toISOString(),
      });
      void syncEngineRef.current?.run().catch(() => {
        // The server accepted the resolution; the engine will retry pulling its change.
      });
    },
    [database, syncTransport, userId],
  );

  const value = useMemo(
    () => ({ db: database, repositories, resolveConflict, userId }),
    [database, repositories, resolveConflict, userId],
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const value = useContext(DataContext);
  if (!value) {
    throw new Error("useData must be used inside DataProvider");
  }
  return value;
}
