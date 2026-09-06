import { LocalNotifications } from "@capacitor/local-notifications";
import type { LastDoneDatabase } from "@lastdone/storage";

import {
  getAndroidNotificationPreferences,
  getAndroidNotificationLedger,
  getAndroidNotificationsEnabled,
  setAndroidNotificationLedger,
} from "./androidNotificationStore";
import { planAndroidNotifications } from "./notificationPlanner";
import { isAndroidNative } from "./platform";

export const ANDROID_NOTIFICATION_CHANNEL_ID = "lastdone-reminders-v1";

export async function ensureAndroidNotificationChannel(): Promise<void> {
  if (!isAndroidNative()) return;
  await LocalNotifications.createChannel({
    id: ANDROID_NOTIFICATION_CHANNEL_ID,
    name: "LastDone 提醒",
    description: "每日摘要和重要事项的本地提醒",
    importance: 3,
    visibility: 1,
    vibration: true,
  });
}

export async function clearAndroidNotifications(): Promise<void> {
  if (!isAndroidNative()) return;
  await LocalNotifications.cancelAll();
}

export async function reconcileAndroidNotifications(
  db: LastDoneDatabase,
  userId: string,
  now = new Date(),
): Promise<void> {
  if (!isAndroidNative()) return;

  const permission = await LocalNotifications.checkPermissions();
  if (permission.display !== "granted" || !(await getAndroidNotificationsEnabled())) {
    await LocalNotifications.cancelAll();
    return;
  }

  const [settings, items, preferences] = await Promise.all([
    db.settings.get(userId),
    db.items.where("userId").equals(userId).toArray(),
    getAndroidNotificationPreferences(),
  ]);
  if (!settings || settings.deletedAt) {
    await LocalNotifications.cancelAll();
    return;
  }

  const planned = planAndroidNotifications({ now, settings, items, preferences });
  const previousLedger = await getAndroidNotificationLedger();
  const nextLedger = { ...previousLedger };
  const cutoff = now.getTime() - 120 * 24 * 60 * 60 * 1000;
  for (const [key, entry] of Object.entries(nextLedger)) {
    if (new Date(entry.scheduledAt).getTime() < cutoff) delete nextLedger[key];
  }

  const toSchedule = planned.flatMap((entry) => {
    const ledgerKey = `${userId}:${entry.identity}`;
    const previous = previousLedger[ledgerKey];
    if (entry.catchUp && previous) {
      const previousAt = new Date(previous.scheduledAt);
      if (Number.isFinite(previousAt.getTime())) {
        if (previousAt.getTime() <= now.getTime()) return [];
        entry = { ...entry, at: previousAt };
      }
    }
    nextLedger[ledgerKey] = {
      identity: entry.identity,
      scheduledAt: entry.at.toISOString(),
    };
    return [entry];
  });

  await ensureAndroidNotificationChannel();
  await LocalNotifications.cancelAll();
  if (toSchedule.length === 0) {
    await setAndroidNotificationLedger(nextLedger);
    return;
  }

  await LocalNotifications.schedule({
    notifications: toSchedule.map((entry) => ({
      id: entry.id,
      title: entry.title,
      body: entry.body,
      largeBody: entry.body,
      channelId: ANDROID_NOTIFICATION_CHANNEL_ID,
      schedule: { at: entry.at, allowWhileIdle: true },
      isExactNotification: false,
      autoCancel: true,
      foreground: true,
      extra: {
        identity: entry.identity,
        route: entry.route,
        kind: entry.kind,
      },
    })),
  });
  await setAndroidNotificationLedger(nextLedger);
}
