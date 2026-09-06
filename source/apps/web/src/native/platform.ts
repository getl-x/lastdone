import { Capacitor } from "@capacitor/core";

export function isAndroidNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}
