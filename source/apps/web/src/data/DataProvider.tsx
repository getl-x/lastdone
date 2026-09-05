import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type PropsWithChildren,
} from "react";

import {
  LastDoneDatabase,
  createRepositories,
  type IdGenerator,
  type Repositories,
} from "@lastdone/storage";
import { createSyncEngine, type SyncTransport } from "@lastdone/sync";

interface DataContextValue {
  db: LastDoneDatabase;
  repositories: Repositories;
  userId: string;
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
    });
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
      engine.stop();
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", handleVisibility);
      database.outbox.hook("creating").unsubscribe(handleOutboxCreate);
    };
  }, [database, syncTransport, userId]);

  const value = useMemo(
    () => ({ db: database, repositories, userId }),
    [database, repositories, userId],
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
