/// <reference types="@capacitor/local-notifications" />

import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.getlx.lastdone",
  appName: "LastDone",
  webDir: "dist",
  backgroundColor: "#F3F7F5",
  loggingBehavior: "debug",
  server: {
    hostname: "localhost",
    androidScheme: "https",
    cleartext: false,
  },
  android: {
    path: "android",
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
    includePlugins: [
      "@capacitor/app",
      "@capacitor/local-notifications",
      "@capacitor/network",
      "@capacitor/preferences",
    ],
  },
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_stat_lastdone",
      iconColor: "#28745E",
    },
  },
};

export default config;
