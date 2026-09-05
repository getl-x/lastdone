import "fake-indexeddb/auto";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LastDoneDatabase } from "@lastdone/storage";

import { AuthProvider } from "../auth/AuthProvider";
import { DataProvider } from "../data/DataProvider";
import type { NotificationClient } from "../notifications/client";
import { NotificationProvider } from "../notifications/NotificationProvider";
import { SettingsPage, buildJsonExport } from "./SettingsPage";

const databases: LastDoneDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});

describe("SettingsPage", () => {
  it("saves time zone and due-soon preferences", async () => {
    const user = userEvent.setup();
    const db = new LastDoneDatabase(`settings-${crypto.randomUUID()}`);
    databases.push(db);

    render(
      <MemoryRouter>
        <AuthProvider
          client={{
            currentUser: () => ({ id: "user-1", username: "getl" }),
            login: async () => ({ id: "user-1", username: "getl" }),
            logout: () => undefined,
            changePassword: async () => undefined,
          }}
        >
          <DataProvider db={db} userId="user-1">
            <SettingsPage />
          </DataProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText("时区")).toHaveValue("Asia/Shanghai");
    await user.clear(screen.getByLabelText("即将到期天数"));
    await user.type(screen.getByLabelText("即将到期天数"), "10");
    expect(screen.getByLabelText("即将到期天数")).toHaveValue(10);
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    expect(
      await screen.findByText("已保存", {}, { timeout: 5_000 }),
    ).toBeInTheDocument();
    expect((await db.settings.get("user-1"))?.dueSoonDays).toBe(10);
  });

  it("builds a versioned complete JSON export", async () => {
    const db = new LastDoneDatabase(`export-${crypto.randomUUID()}`);
    databases.push(db);
    await db.items.add({
      id: "item0000000001",
      userId: "user-1",
      revision: 1,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      deletedAt: null,
      name: "备份电脑",
      categoryId: "category0000001",
      schedule: { type: "relative", every: 30, unit: "days" },
      initialDueDate: "2026-09-05",
      dueDate: "2026-09-05",
      lastCompletedDate: null,
      lastCompletionId: null,
      important: false,
      reminderOffsets: [],
      lifecycle: "active",
    });

    const archive = await buildJsonExport(db, "2026-09-05T08:00:00.000Z");

    expect(archive).toMatchObject({
      format: "lastdone-export",
      version: 1,
      exportedAt: "2026-09-05T08:00:00.000Z",
    });
    expect(archive.items).toHaveLength(1);
  });

  it("changes the account password through the authenticated client", async () => {
    const user = userEvent.setup();
    const db = new LastDoneDatabase(`password-${crypto.randomUUID()}`);
    databases.push(db);
    const changePassword = vi.fn(async () => undefined);

    render(
      <MemoryRouter>
        <AuthProvider
          client={{
            currentUser: () => ({ id: "user-1", username: "getl" }),
            login: async () => ({ id: "user-1", username: "getl" }),
            logout: () => undefined,
            changePassword,
          }}
        >
          <DataProvider db={db} userId="user-1">
            <SettingsPage />
          </DataProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.type(await screen.findByLabelText("当前密码"), "old-password");
    await user.type(screen.getByLabelText("新密码"), "new-password");
    await user.click(screen.getByRole("button", { name: "更新密码" }));

    expect(changePassword).toHaveBeenCalledWith("old-password", "new-password");
    expect(await screen.findByText("密码已更新。")).toBeInTheDocument();
  });

  it("requests notification permission only after an explicit button click", async () => {
    const user = userEvent.setup();
    const db = new LastDoneDatabase(`notifications-${crypto.randomUUID()}`);
    databases.push(db);
    const enable = vi.fn<NotificationClient["enable"]>(async () => ({
      status: "enabled",
      deviceId: "device000000001",
      deviceName: "iPhone PWA",
      platform: "ios-pwa",
      digestEnabled: true,
      importantRemindersEnabled: true,
      enabled: true,
    }));
    const notificationClient: NotificationClient = {
      inspect: async () => ({ status: "disabled", platform: "ios-pwa" }),
      enable,
      disable: async () => ({ status: "disabled", platform: "ios-pwa" }),
      listDevices: async () => [],
      updatePreferences: async () => {
        throw new Error("not used");
      },
    };

    render(
      <MemoryRouter>
        <AuthProvider
          client={{
            currentUser: () => ({ id: "user-1", username: "getl" }),
            login: async () => ({ id: "user-1", username: "getl" }),
            logout: () => undefined,
          }}
        >
          <NotificationProvider client={notificationClient}>
            <DataProvider db={db} userId="user-1">
              <SettingsPage />
            </DataProvider>
          </NotificationProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    const button = await screen.findByRole("button", {
      name: "启用这台设备的通知",
    });
    expect(enable).not.toHaveBeenCalled();
    await user.click(button);

    expect(enable).toHaveBeenCalledOnce();
    expect(await screen.findByText("这台设备已启用 Web Push")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "每日摘要" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "重要事项提醒" })).toBeChecked();
  });

  it("explains denied notification permission", async () => {
    const db = new LastDoneDatabase(`notifications-denied-${crypto.randomUUID()}`);
    databases.push(db);
    const notificationClient: NotificationClient = {
      inspect: async () => ({ status: "denied", platform: "web" }),
      enable: async () => ({ status: "denied", platform: "web" }),
      disable: async () => ({ status: "disabled", platform: "web" }),
      listDevices: async () => [],
      updatePreferences: async () => {
        throw new Error("not used");
      },
    };

    render(
      <MemoryRouter>
        <AuthProvider
          client={{
            currentUser: () => ({ id: "user-1", username: "getl" }),
            login: async () => ({ id: "user-1", username: "getl" }),
            logout: () => undefined,
          }}
        >
          <NotificationProvider client={notificationClient}>
            <DataProvider db={db} userId="user-1">
              <SettingsPage />
            </DataProvider>
          </NotificationProvider>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("通知权限已被系统拒绝，请在浏览器或系统设置中重新允许。"),
    ).toBeInTheDocument();
  });
});
