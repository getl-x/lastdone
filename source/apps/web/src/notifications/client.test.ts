import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BrowserNotificationClient,
  notificationDefaults,
  type PushRuntime,
  type PushSubscriptionLike,
} from "./client";

function subscription(): PushSubscriptionLike {
  return {
    endpoint: "https://push.example/device",
    toJSON: () => ({
      endpoint: "https://push.example/device",
      keys: { p256dh: "public-key", auth: "auth-secret" },
    }),
    unsubscribe: vi.fn(async () => true),
  };
}

function runtime(overrides: Partial<PushRuntime> = {}): PushRuntime {
  return {
    supported: true,
    platform: "ios-pwa",
    deviceName: "iPhone PWA",
    permission: () => "default",
    requestPermission: vi.fn(async (): Promise<NotificationPermission> => "granted"),
    getSubscription: vi.fn(async () => null),
    subscribe: vi.fn(async () => subscription()),
    ...overrides,
  };
}

describe("notification client", () => {
  beforeEach(() => localStorage.clear());

  it("uses platform-specific first-run recommendations", () => {
    expect(notificationDefaults("ios-pwa")).toEqual({
      digestEnabled: true,
      importantRemindersEnabled: true,
    });
    expect(notificationDefaults("web")).toEqual({
      digestEnabled: false,
      importantRemindersEnabled: false,
    });
    expect(notificationDefaults("android")).toEqual({
      digestEnabled: false,
      importantRemindersEnabled: true,
    });
  });

  it("requests permission only when enabling and registers the subscription", async () => {
    const browser = runtime();
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith("/config")) {
        return Response.json({ publicKey: "AQID" });
      }
      return Response.json({
        deviceId: "device000000001",
        deviceName: "iPhone PWA",
        platform: "ios-pwa",
        digestEnabled: true,
        importantRemindersEnabled: true,
        enabled: true,
      });
    });
    const client = new BrowserNotificationClient({
      getToken: () => "auth-token",
      fetch,
      runtime: browser,
      storage: localStorage,
    });

    await expect(client.inspect()).resolves.toMatchObject({ status: "disabled" });
    expect(browser.requestPermission).not.toHaveBeenCalled();

    const state = await client.enable();

    expect(browser.requestPermission).toHaveBeenCalledOnce();
    expect(browser.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        userVisibleOnly: true,
        applicationServerKey: new Uint8Array([1, 2, 3]),
      }),
    );
    expect(requests).toHaveLength(2);
    expect(requests[1]?.init?.headers).toMatchObject({ Authorization: "auth-token" });
    expect(JSON.parse(String(requests[1]?.init?.body))).toMatchObject({
      deviceName: "iPhone PWA",
      platform: "ios-pwa",
      digestEnabled: true,
      importantRemindersEnabled: true,
      subscription: { endpoint: "https://push.example/device" },
    });
    expect(state).toMatchObject({ status: "enabled", deviceId: "device000000001" });
    expect(localStorage.getItem("lastdone_device_id")).toBe("device000000001");
  });

  it("reports denied permission without contacting the server", async () => {
    const browser = runtime({
      requestPermission: vi.fn(async (): Promise<NotificationPermission> => "denied"),
    });
    const fetch = vi.fn();
    const client = new BrowserNotificationClient({
      getToken: () => "auth-token",
      fetch,
      runtime: browser,
      storage: localStorage,
    });

    await expect(client.enable()).resolves.toMatchObject({ status: "denied" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("loads and updates per-device preferences", async () => {
    localStorage.setItem("lastdone_device_id", "device000000001");
    const currentSubscription = subscription();
    const browser = runtime({
      permission: () => "granted",
      getSubscription: vi.fn(async () => currentSubscription),
    });
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return Response.json({
          deviceId: "device000000001",
          deviceName: "iPhone PWA",
          platform: "ios-pwa",
          digestEnabled: false,
          importantRemindersEnabled: true,
          enabled: true,
        });
      }
      return Response.json([
        {
          deviceId: "device000000001",
          deviceName: "iPhone PWA",
          platform: "ios-pwa",
          digestEnabled: true,
          importantRemindersEnabled: true,
          enabled: true,
        },
      ]);
    });
    const client = new BrowserNotificationClient({
      getToken: () => "auth-token",
      fetch,
      runtime: browser,
      storage: localStorage,
    });

    await expect(client.listDevices()).resolves.toHaveLength(1);
    await expect(
      client.updatePreferences("device000000001", {
        digestEnabled: false,
        importantRemindersEnabled: true,
      }),
    ).resolves.toMatchObject({ digestEnabled: false, status: "enabled" });
  });
});
