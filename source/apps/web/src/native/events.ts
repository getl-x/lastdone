export const SYNC_COMPLETED_EVENT = "lastdone:sync-completed";
export const NOTIFICATION_PREFERENCES_CHANGED_EVENT =
  "lastdone:notification-preferences-changed";

export function dispatchSyncCompleted(): void {
  window.dispatchEvent(new Event(SYNC_COMPLETED_EVENT));
}

export function dispatchNotificationPreferencesChanged(): void {
  window.dispatchEvent(new Event(NOTIFICATION_PREFERENCES_CHANGED_EVENT));
}

