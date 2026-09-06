import { App } from "@capacitor/app";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Network } from "@capacitor/network";

import { requestAndroidNotificationReconcile } from "./events";
import { requestNativeNavigation } from "./navigation";
import { isAndroidNative } from "./platform";

let started = false;

export async function bootstrapNativeRuntime(): Promise<void> {
  if (started || !isAndroidNative()) return;
  started = true;
  document.documentElement.classList.add("native-android");

  await Promise.all([
    LocalNotifications.addListener("localNotificationActionPerformed", (event) =>
      requestNativeNavigation(event.notification.extra?.route),
    ),
    App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) requestAndroidNotificationReconcile();
    }),
    Network.addListener("networkStatusChange", ({ connected }) => {
      if (connected) requestAndroidNotificationReconcile();
    }),
  ]);
}
