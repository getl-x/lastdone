import { Preferences } from "@capacitor/preferences";

import type { NotificationPreferences } from "../notifications/client";

const DEVICE_ID_KEY = "lastdone_android_notification_device_id";
const ENABLED_KEY = "lastdone_android_notification_enabled";
const PREFERENCES_KEY = "lastdone_android_notification_preferences";
const SCHEDULE_LEDGER_KEY = "lastdone_android_notification_schedule_ledger";

export const ANDROID_NOTIFICATION_DEFAULTS: NotificationPreferences = {
  digestEnabled: false,
  importantRemindersEnabled: true,
};

function makeDeviceId(): string {
  return `android-${crypto.randomUUID()}`;
}

export async function getAndroidNotificationDeviceId(): Promise<string> {
  const existing = await Preferences.get({ key: DEVICE_ID_KEY });
  if (existing.value) return existing.value;
  const deviceId = makeDeviceId();
  await Preferences.set({ key: DEVICE_ID_KEY, value: deviceId });
  return deviceId;
}

export async function getAndroidNotificationsEnabled(): Promise<boolean> {
  return (await Preferences.get({ key: ENABLED_KEY })).value === "true";
}

export async function setAndroidNotificationsEnabled(enabled: boolean): Promise<void> {
  await Preferences.set({ key: ENABLED_KEY, value: String(enabled) });
}

export async function getAndroidNotificationPreferences(): Promise<NotificationPreferences> {
  const stored = await Preferences.get({ key: PREFERENCES_KEY });
  if (!stored.value) return { ...ANDROID_NOTIFICATION_DEFAULTS };
  try {
    const parsed = JSON.parse(stored.value) as Partial<NotificationPreferences>;
    return {
      digestEnabled:
        typeof parsed.digestEnabled === "boolean"
          ? parsed.digestEnabled
          : ANDROID_NOTIFICATION_DEFAULTS.digestEnabled,
      importantRemindersEnabled:
        typeof parsed.importantRemindersEnabled === "boolean"
          ? parsed.importantRemindersEnabled
          : ANDROID_NOTIFICATION_DEFAULTS.importantRemindersEnabled,
    };
  } catch {
    return { ...ANDROID_NOTIFICATION_DEFAULTS };
  }
}

export async function setAndroidNotificationPreferences(
  preferences: NotificationPreferences,
): Promise<void> {
  await Preferences.set({ key: PREFERENCES_KEY, value: JSON.stringify(preferences) });
}

export interface AndroidNotificationLedgerEntry {
  identity: string;
  scheduledAt: string;
}

export async function getAndroidNotificationLedger(): Promise<
  Record<string, AndroidNotificationLedgerEntry>
> {
  const stored = await Preferences.get({ key: SCHEDULE_LEDGER_KEY });
  if (!stored.value) return {};
  try {
    const parsed = JSON.parse(stored.value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, AndroidNotificationLedgerEntry] => {
          const value = entry[1];
          return (
            Boolean(value) &&
            typeof value === "object" &&
            "identity" in value &&
            typeof value.identity === "string" &&
            "scheduledAt" in value &&
            typeof value.scheduledAt === "string" &&
            Number.isFinite(new Date(value.scheduledAt).getTime())
          );
        },
      ),
    );
  } catch {
    return {};
  }
}

export async function setAndroidNotificationLedger(
  value: Record<string, AndroidNotificationLedgerEntry>,
): Promise<void> {
  await Preferences.set({ key: SCHEDULE_LEDGER_KEY, value: JSON.stringify(value) });
}

export async function clearAndroidNotificationLedger(): Promise<void> {
  await Preferences.remove({ key: SCHEDULE_LEDGER_KEY });
}
