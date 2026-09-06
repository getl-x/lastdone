import type {
  ConflictRecord,
  LastDoneDatabase,
  SyncOperation,
} from "@lastdone/storage";

export interface RemoteChange {
  sequence: number;
  userId: string;
  entity: SyncOperation["entity"];
  entityId: string;
  action: SyncOperation["action"];
  revision: number;
  fields: Record<string, unknown>;
}

export interface PushResponse {
  appliedOperationIds: string[];
  conflicts: ConflictRecord[];
}

export interface PullResponse {
  changes: RemoteChange[];
  conflicts: ConflictRecord[];
  nextSequence: number;
  hasMore: boolean;
}

export interface SyncTransport {
  push(operations: SyncOperation[]): Promise<PushResponse>;
  pull(after: number, limit: number): Promise<PullResponse>;
  resolveConflict?(
    conflictId: string,
    choice: "local" | "server",
  ): Promise<ConflictRecord>;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
}

export interface SyncEngine {
  run(): Promise<SyncResult>;
  start(): void;
  stop(): void;
}

export interface SyncEngineOptions {
  db: LastDoneDatabase;
  userId: string;
  transport: SyncTransport;
  clock?: () => string;
  foregroundIntervalMs?: number;
  onCompleted?(result: SyncResult): void;
}
