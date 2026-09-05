import type { ScheduleRule } from "@lastdone/core";

export interface SyncRecord {
  id: string;
  userId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type CategoryLifecycle = "active" | "archived";

export interface CategoryRecord extends SyncRecord {
  name: string;
  icon: string;
  color: string;
  displayOrder: number;
  lifecycle: CategoryLifecycle;
}

export type ItemLifecycle = "active" | "paused" | "archived";

export interface ItemRecord extends SyncRecord {
  name: string;
  categoryId: string;
  schedule: ScheduleRule;
  initialDueDate: string | null;
  dueDate: string | null;
  lastCompletedDate: string | null;
  lastCompletionId: string | null;
  important: boolean;
  reminderOffsets: number[];
  lifecycle: ItemLifecycle;
}

export interface CompletionRecord extends SyncRecord {
  itemId: string;
  completedAt: string;
  localDate: string;
  note: string | null;
  previousDueDate: string | null;
  previousLastCompletedDate: string | null;
  previousLastCompletionId: string | null;
}

export interface SkipRecord extends SyncRecord {
  itemId: string;
  occurrenceDate: string;
  note: string | null;
}

export interface UserSettingsRecord {
  userId: string;
  timeZone: string;
  dueSoonDays: number;
  digestTime: string;
  quietHoursStart: string;
  quietHoursEnd: string;
  updatedAt: string;
}

export interface DeviceRecord extends SyncRecord {
  name: string;
  platform: "web" | "ios-pwa" | "android";
  digestEnabled: boolean;
  importantRemindersEnabled: boolean;
  lastSeenAt: string;
}

export type SyncEntity =
  "categories" | "items" | "completions" | "skips" | "settings" | "devices";

export type SyncAction = "create" | "update" | "delete";
export type OutboxStatus = "pending" | "applied";

export interface SyncOperation {
  id: string;
  userId: string;
  entity: SyncEntity;
  entityId: string;
  action: SyncAction;
  baseRevision: number;
  fields: Record<string, unknown>;
  createdAt: string;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  appliedAt?: string;
}

export interface SyncMetaRecord {
  userId: string;
  lastSequence: number;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface ConflictRecord {
  id: string;
  userId: string;
  entity: SyncEntity;
  entityId: string;
  field: string;
  localValue: unknown;
  serverValue: unknown;
  serverRevision: number;
  status: "unresolved" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
}
