import PocketBase, { type RecordModel } from "pocketbase";
import { useEffect, useMemo, type PropsWithChildren } from "react";

import { HttpSyncTransport, type SyncTransport } from "@lastdone/sync";

import {
  AuthProvider,
  useAuth,
  type AuthClient,
  type AuthUser,
} from "../auth/AuthProvider";
import { DataProvider } from "../data/DataProvider";
import { AndroidNotificationClient } from "../native/androidNotificationClient";
import { AndroidNotificationCoordinator } from "../native/AndroidNotificationCoordinator";
import { clearAndroidNotifications } from "../native/androidNotificationScheduler";
import { RuntimeConfigProvider, type RuntimeConfig } from "../native/serverOrigin";
import { BrowserNotificationClient } from "../notifications/client";
import { NotificationProvider } from "../notifications/NotificationProvider";

function toUser(record: RecordModel | null): AuthUser | null {
  if (!record) {
    return null;
  }
  return { id: record.id, username: String(record.username ?? "") };
}

function createPocketBaseAuthClient(pocketBase: PocketBase): AuthClient {
  return {
    currentUser: () => toUser(pocketBase.authStore.record),
    async login(username, password) {
      const result = await pocketBase
        .collection("users")
        .authWithPassword(username, password);
      const user = toUser(result.record);
      if (!user) {
        throw new Error("authentication returned no user");
      }
      return user;
    },
    logout: () => pocketBase.authStore.clear(),
    async changePassword(currentPassword, newPassword) {
      const userId = pocketBase.authStore.record?.id;
      if (!userId) {
        throw new Error("not authenticated");
      }
      await pocketBase.collection("users").update(userId, {
        oldPassword: currentPassword,
        password: newPassword,
        passwordConfirm: newPassword,
      });
    },
    isOffline: () => !navigator.onLine,
  };
}

export function AppProviders({
  children,
  runtimeConfig,
}: PropsWithChildren<{ runtimeConfig: RuntimeConfig }>) {
  const pocketBase = useMemo(
    () => new PocketBase(runtimeConfig.serverOrigin),
    [runtimeConfig.serverOrigin],
  );
  const authClient = useMemo(
    () => createPocketBaseAuthClient(pocketBase),
    [pocketBase],
  );
  const syncTransport = useMemo(
    () =>
      new HttpSyncTransport({
        baseUrl: runtimeConfig.serverOrigin,
        getToken: () => pocketBase.authStore.token || null,
      }),
    [pocketBase, runtimeConfig.serverOrigin],
  );
  const notificationClient = useMemo(
    () =>
      runtimeConfig.isAndroid
        ? new AndroidNotificationClient()
        : new BrowserNotificationClient({
            baseUrl: runtimeConfig.serverOrigin,
            getToken: () => pocketBase.authStore.token || null,
          }),
    [pocketBase, runtimeConfig.isAndroid, runtimeConfig.serverOrigin],
  );
  return (
    <RuntimeConfigProvider value={runtimeConfig}>
      <AuthProvider client={authClient}>
        <NotificationProvider client={notificationClient}>
          <AuthenticatedData
            isAndroid={runtimeConfig.isAndroid}
            syncTransport={syncTransport}
          >
            {children}
          </AuthenticatedData>
        </NotificationProvider>
      </AuthProvider>
    </RuntimeConfigProvider>
  );
}

function AuthenticatedData({
  children,
  isAndroid,
  syncTransport,
}: PropsWithChildren<{ isAndroid: boolean; syncTransport: SyncTransport }>) {
  const { user } = useAuth();
  useEffect(() => {
    if (isAndroid && !user) {
      void clearAndroidNotifications().catch(() => {
        // The next authenticated reconciliation or explicit disable retries cleanup.
      });
    }
  }, [isAndroid, user]);

  return user ? (
    <DataProvider userId={user.id} syncTransport={syncTransport}>
      {isAndroid ? <AndroidNotificationCoordinator /> : null}
      {children}
    </DataProvider>
  ) : (
    children
  );
}
