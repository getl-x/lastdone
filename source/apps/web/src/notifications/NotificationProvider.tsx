import { createContext, useContext, type PropsWithChildren } from "react";

import type { NotificationClient } from "./client";

const unsupportedClient: NotificationClient = {
  async inspect() {
    return { status: "unsupported", platform: "web" };
  },
  async enable() {
    return { status: "unsupported", platform: "web" };
  },
  async disable() {
    return { status: "unsupported", platform: "web" };
  },
  async listDevices() {
    return [];
  },
  async updatePreferences() {
    throw new Error("notifications are not supported");
  },
};

const NotificationContext = createContext<NotificationClient>(unsupportedClient);

export function NotificationProvider({
  client,
  children,
}: PropsWithChildren<{ client: NotificationClient }>) {
  return (
    <NotificationContext.Provider value={client}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationClient {
  return useContext(NotificationContext);
}
