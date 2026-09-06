import { Preferences } from "@capacitor/preferences";
import { createContext, useContext, type PropsWithChildren } from "react";

import {
  clearAndroidNotificationLedger,
  setAndroidNotificationsEnabled,
} from "./androidNotificationStore";
import { clearAndroidNotifications } from "./androidNotificationScheduler";
import { isAndroidNative } from "./platform";

const SERVER_ORIGIN_KEY = "lastdone_server_origin";

export type ServerOriginSource = "web" | "environment" | "preferences";

export interface RuntimeConfig {
  isAndroid: boolean;
  serverOrigin: string;
  serverOriginSource: ServerOriginSource;
}

const RuntimeConfigContext = createContext<RuntimeConfig>({
  isAndroid: false,
  serverOrigin: typeof window === "undefined" ? "" : window.location.origin,
  serverOriginSource: "web",
});

export function RuntimeConfigProvider({
  children,
  value,
}: PropsWithChildren<{ value: RuntimeConfig }>) {
  return (
    <RuntimeConfigContext.Provider value={value}>
      {children}
    </RuntimeConfigContext.Provider>
  );
}

export function useRuntimeConfig(): RuntimeConfig {
  return useContext(RuntimeConfigContext);
}

export function normalizeServerOrigin(value: string): string {
  const candidate = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("请输入完整的服务器地址，例如 https://lastdone.example.com");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Android 客户端只接受 HTTPS 服务器地址。");
  }
  if (parsed.username || parsed.password) {
    throw new Error("服务器地址中不能包含用户名或密码。");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("请只填写域名，不要添加路径、查询参数或锚点。");
  }
  return parsed.origin;
}

export async function resolveRuntimeConfig(): Promise<RuntimeConfig | null> {
  if (!isAndroidNative()) {
    return {
      isAndroid: false,
      serverOrigin: window.location.origin,
      serverOriginSource: "web",
    };
  }

  const configuredAtBuild = import.meta.env.VITE_LASTDONE_SERVER_URL?.trim();
  if (configuredAtBuild) {
    return {
      isAndroid: true,
      serverOrigin: normalizeServerOrigin(configuredAtBuild),
      serverOriginSource: "environment",
    };
  }

  const stored = await Preferences.get({ key: SERVER_ORIGIN_KEY });
  if (!stored.value) return null;

  try {
    return {
      isAndroid: true,
      serverOrigin: normalizeServerOrigin(stored.value),
      serverOriginSource: "preferences",
    };
  } catch {
    await Preferences.remove({ key: SERVER_ORIGIN_KEY });
    return null;
  }
}

export async function saveAndroidServerOrigin(value: string): Promise<RuntimeConfig> {
  const serverOrigin = normalizeServerOrigin(value);
  await verifyLastDoneServer(serverOrigin);
  await Preferences.set({ key: SERVER_ORIGIN_KEY, value: serverOrigin });
  return {
    isAndroid: true,
    serverOrigin,
    serverOriginSource: "preferences",
  };
}

export async function resetAndroidServerOrigin(): Promise<void> {
  await clearAndroidNotifications();
  await clearAndroidNotificationLedger();
  await setAndroidNotificationsEnabled(false);
  await Preferences.remove({ key: SERVER_ORIGIN_KEY });
  localStorage.removeItem("pocketbase_auth");
}

export async function verifyLastDoneServer(
  serverOrigin: string,
  request: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await request(`${serverOrigin}/api/lastdone/health`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
  } catch {
    throw new Error("无法连接服务器，请检查域名、HTTPS 证书和网络连接。");
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`服务器健康检查失败（HTTP ${response.status}）。`);
  }
  let payload: { status?: unknown };
  try {
    payload = (await response.json()) as { status?: unknown };
  } catch {
    throw new Error("服务器返回了无法识别的健康检查结果。");
  }
  if (payload.status !== "ok") {
    throw new Error("这个地址不是可用的 LastDone 服务器。");
  }
}
