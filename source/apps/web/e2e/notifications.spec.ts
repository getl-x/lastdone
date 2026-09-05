import { expect, test } from "@playwright/test";

const userId = "testuser0000001";
const authToken = [
  "eyJhbGciOiJIUzI1NiJ9",
  "eyJpZCI6InRlc3R1c2VyMDAwMDAwMSIsImNvbGxlY3Rpb25JZCI6InVzZXJzIiwidHlwZSI6ImF1dGgiLCJleHAiOjQxMDI0NDQ4MDB9",
  "test-signature",
].join(".");

test("enables iPhone PWA notifications only after a user gesture", async ({
  context,
  page,
}) => {
  await page.addInitScript(
    ({ token, id }) => {
      localStorage.setItem(
        "pocketbase_auth",
        JSON.stringify({
          token,
          record: { id, username: "getl", collectionName: "users" },
        }),
      );
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      });
      Object.defineProperty(navigator, "standalone", {
        configurable: true,
        value: true,
      });

      let permission: NotificationPermission = "default";
      class MockNotification {
        static get permission() {
          return permission;
        }

        static async requestPermission(): Promise<NotificationPermission> {
          const target = window as typeof window & {
            notificationPermissionRequests?: number;
          };
          target.notificationPermissionRequests =
            (target.notificationPermissionRequests ?? 0) + 1;
          permission = "granted";
          return permission;
        }
      }
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: MockNotification,
      });

      const subscription = {
        endpoint: "https://push.example/iphone",
        toJSON: () => ({
          endpoint: "https://push.example/iphone",
          keys: { p256dh: "public-key", auth: "auth-secret" },
        }),
        unsubscribe: async () => true,
      };
      const pushManager = {
        getSubscription: async () => (permission === "granted" ? subscription : null),
        subscribe: async () => subscription,
      };
      Object.defineProperty(ServiceWorkerRegistration.prototype, "pushManager", {
        configurable: true,
        get: () => pushManager,
      });
    },
    { token: authToken, id: userId },
  );

  let registered = false;
  let subscribeBody: Record<string, unknown> | undefined;
  let preferencesBody: Record<string, unknown> | undefined;
  const state = () => ({
    deviceId: "device000000001",
    deviceName: "iPhone PWA",
    platform: "ios-pwa",
    digestEnabled: preferencesBody?.digestEnabled ?? true,
    importantRemindersEnabled: preferencesBody?.importantRemindersEnabled ?? true,
    enabled: registered,
  });

  await context.route("**/api/lastdone/sync/push", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ appliedOperationIds: [], conflicts: [] }),
    }),
  );
  await context.route("**/api/lastdone/sync/pull**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        changes: [],
        conflicts: [],
        nextSequence: 0,
        hasMore: false,
      }),
    }),
  );
  await context.route("**/api/lastdone/push/config", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ publicKey: "AQID" }),
    }),
  );
  await context.route("**/api/lastdone/push/devices", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(registered ? [state()] : []),
    }),
  );
  await context.route("**/api/lastdone/push/status**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(state()) }),
  );
  await context.route("**/api/lastdone/push/subscribe", async (route) => {
    subscribeBody = route.request().postDataJSON() as Record<string, unknown>;
    registered = true;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(state()),
    });
  });
  await context.route("**/api/lastdone/push/preferences", async (route) => {
    preferencesBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(state()),
    });
  });

  await page.goto("/settings");
  const enable = await page.getByRole("button", {
    name: "启用这台设备的通知",
  });
  await expect(enable).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { notificationPermissionRequests?: number })
          .notificationPermissionRequests ?? 0,
    ),
  ).toBe(0);

  await enable.click();

  await expect(page.getByText("这台设备已启用 Web Push")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { notificationPermissionRequests?: number })
          .notificationPermissionRequests ?? 0,
    ),
  ).toBe(1);
  expect(subscribeBody).toMatchObject({
    platform: "ios-pwa",
    digestEnabled: true,
    importantRemindersEnabled: true,
    subscription: { endpoint: "https://push.example/iphone" },
  });

  const digest = page.getByRole("checkbox", { name: "每日摘要" });
  await expect(digest).toBeChecked();
  await digest.uncheck();
  await expect.poll(() => preferencesBody?.digestEnabled).toBe(false);
  expect(preferencesBody).toMatchObject({
    deviceId: "device000000001",
    importantRemindersEnabled: true,
  });
});
