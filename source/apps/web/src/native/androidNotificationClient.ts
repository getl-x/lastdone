import { App } from "@capacitor/app";
import { LocalNotifications } from "@capacitor/local-notifications";

import {
  notificationDefaults,
  type NotificationClient,
  type NotificationDeviceState,
  type NotificationPreferences,
} from "../notifications/client";
import {
  dispatchNotificationPreferencesChanged,
  requestAndroidNotificationReconcile,
} from "./events";
import {
  getAndroidNotificationDeviceId,
  clearAndroidNotificationLedger,
  getAndroidNotificationPreferences,
  getAndroidNotificationsEnabled,
  setAndroidNotificationPreferences,
  setAndroidNotificationsEnabled,
} from "./androidNotificationStore";
import { ensureAndroidNotificationChannel } from "./androidNotificationScheduler";

export async function getAndroidDeviceName(): Promise<string> {
  try {
    const info = await App.getInfo();
    return `Android · ${info.name}`;
  } catch {
    return "Android 手机";
  }
}

function permissionIsDenied(value: string): boolean {
  return value === "denied";
}

export class AndroidNotificationClient implements NotificationClient {
  async inspect() {
    const permission = await LocalNotifications.checkPermissions();
    if (permissionIsDenied(permission.display)) {
      return { status: "denied" as const, platform: "android" as const };
    }
    if (permission.display !== "granted" || !(await getAndroidNotificationsEnabled())) {
      return { status: "disabled" as const, platform: "android" as const };
    }
    return this.#state(true);
  }

  async enable(preferences = notificationDefaults("android")) {
    let permission = await LocalNotifications.checkPermissions();
    if (permission.display !== "granted") {
      permission = await LocalNotifications.requestPermissions();
    }
    if (permission.display !== "granted") {
      return { status: "denied" as const, platform: "android" as const };
    }

    await ensureAndroidNotificationChannel();
    await setAndroidNotificationPreferences(preferences);
    await setAndroidNotificationsEnabled(true);
    dispatchNotificationPreferencesChanged();
    requestAndroidNotificationReconcile();
    return this.#state(true, preferences);
  }

  async disable() {
    await setAndroidNotificationsEnabled(false);
    await LocalNotifications.cancelAll();
    await clearAndroidNotificationLedger();
    dispatchNotificationPreferencesChanged();
    return this.#state(false);
  }

  async listDevices(): Promise<NotificationDeviceState[]> {
    const permission = await LocalNotifications.checkPermissions();
    const enabled =
      permission.display === "granted" && (await getAndroidNotificationsEnabled());
    return [await this.#state(enabled)];
  }

  async updatePreferences(
    deviceId: string,
    preferences: NotificationPreferences,
  ): Promise<NotificationDeviceState> {
    if (deviceId !== (await getAndroidNotificationDeviceId())) {
      throw new Error("notification device does not belong to this Android app");
    }
    await setAndroidNotificationPreferences(preferences);
    dispatchNotificationPreferencesChanged();
    requestAndroidNotificationReconcile();
    return this.#state(await getAndroidNotificationsEnabled(), preferences);
  }

  async #state(
    enabled: boolean,
    preferences?: NotificationPreferences,
  ): Promise<NotificationDeviceState> {
    const values = preferences ?? (await getAndroidNotificationPreferences());
    return {
      deviceId: await getAndroidNotificationDeviceId(),
      deviceName: await getAndroidDeviceName(),
      platform: "android",
      enabled,
      status: enabled ? "enabled" : "disabled",
      ...values,
    };
  }
}
