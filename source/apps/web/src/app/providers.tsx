import PocketBase, { type RecordModel } from "pocketbase";
import { useMemo, type PropsWithChildren } from "react";

import { HttpSyncTransport, type SyncTransport } from "@lastdone/sync";

import {
  AuthProvider,
  useAuth,
  type AuthClient,
  type AuthUser,
} from "../auth/AuthProvider";
import { DataProvider } from "../data/DataProvider";
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

export function AppProviders({ children }: PropsWithChildren) {
  const pocketBase = useMemo(() => new PocketBase(window.location.origin), []);
  const authClient = useMemo(
    () => createPocketBaseAuthClient(pocketBase),
    [pocketBase],
  );
  const syncTransport = useMemo(
    () =>
      new HttpSyncTransport({
        getToken: () => pocketBase.authStore.token || null,
      }),
    [pocketBase],
  );
  const notificationClient = useMemo(
    () =>
      new BrowserNotificationClient({
        getToken: () => pocketBase.authStore.token || null,
      }),
    [pocketBase],
  );
  return (
    <AuthProvider client={authClient}>
      <NotificationProvider client={notificationClient}>
        <AuthenticatedData syncTransport={syncTransport}>{children}</AuthenticatedData>
      </NotificationProvider>
    </AuthProvider>
  );
}

function AuthenticatedData({
  children,
  syncTransport,
}: PropsWithChildren<{ syncTransport: SyncTransport }>) {
  const { user } = useAuth();
  return user ? (
    <DataProvider userId={user.id} syncTransport={syncTransport}>
      {children}
    </DataProvider>
  ) : (
    children
  );
}
