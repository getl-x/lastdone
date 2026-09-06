import { useEffect } from "react";

import type { RegisterDeviceInput } from "@lastdone/storage";

import {
  createBrowserPushRuntime,
  getOrCreateBrowserDeviceId,
  notificationDefaults,
} from "../notifications/client";
import { getAndroidDeviceName } from "../native/androidNotificationClient";
import {
  getAndroidNotificationDeviceId,
  getAndroidNotificationPreferences,
} from "../native/androidNotificationStore";
import { useData } from "./DataProvider";

async function currentDevice(isAndroid: boolean): Promise<RegisterDeviceInput> {
  if (isAndroid) {
    const preferences = await getAndroidNotificationPreferences();
    return {
      id: await getAndroidNotificationDeviceId(),
      name: await getAndroidDeviceName(),
      platform: "android",
      ...preferences,
    };
  }

  const runtime = createBrowserPushRuntime();
  return {
    id: getOrCreateBrowserDeviceId(),
    name: runtime.deviceName,
    platform: runtime.platform,
    ...notificationDefaults(runtime.platform),
  };
}

export function DeviceSessionRegistrar({ isAndroid }: { isAndroid: boolean }) {
  const { repositories } = useData();

  useEffect(() => {
    let active = true;
    void currentDevice(isAndroid)
      .then((device) => {
        if (!active) return;
        return repositories.devices.register(device);
      })
      .catch(() => {
        // A later login or application launch retries local device registration.
      });
    return () => {
      active = false;
    };
  }, [isAndroid, repositories]);

  return null;
}
