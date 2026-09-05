import PocketBase, { type RecordModel } from "pocketbase";
import { useMemo, type PropsWithChildren } from "react";

import { AuthProvider, type AuthClient, type AuthUser } from "../auth/AuthProvider";

function toUser(record: RecordModel | null): AuthUser | null {
  if (!record) {
    return null;
  }
  return { id: record.id, username: String(record.username ?? "") };
}

function createPocketBaseAuthClient(): AuthClient {
  const pocketBase = new PocketBase(window.location.origin);
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
    isOffline: () => !navigator.onLine,
  };
}

export function AppProviders({ children }: PropsWithChildren) {
  const authClient = useMemo(() => createPocketBaseAuthClient(), []);
  return <AuthProvider client={authClient}>{children}</AuthProvider>;
}
