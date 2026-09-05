import { useLiveQuery } from "dexie-react-hooks";
import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import type {
  CategoryRecord,
  CompletionRecord,
  DeviceRecord,
  ItemRecord,
  LastDoneDatabase,
  SkipRecord,
  UserSettingsRecord,
} from "@lastdone/storage";

import { useAuth } from "../auth/AuthProvider";
import { useData } from "../data/DataProvider";
import type {
  NotificationDeviceState,
  NotificationPreferences,
} from "../notifications/client";
import { useNotifications } from "../notifications/NotificationProvider";

export interface LastDoneExport {
  format: "lastdone-export";
  version: 1;
  exportedAt: string;
  categories: CategoryRecord[];
  items: ItemRecord[];
  completions: CompletionRecord[];
  skips: SkipRecord[];
  settings: UserSettingsRecord[];
  devices: DeviceRecord[];
}

export async function buildJsonExport(
  db: LastDoneDatabase,
  exportedAt = new Date().toISOString(),
): Promise<LastDoneExport> {
  const [categories, items, completions, skips, settings, devices] = await Promise.all([
    db.categories.toArray(),
    db.items.toArray(),
    db.completions.toArray(),
    db.skips.toArray(),
    db.settings.toArray(),
    db.devices.toArray(),
  ]);
  return {
    format: "lastdone-export",
    version: 1,
    exportedAt,
    categories,
    items,
    completions,
    skips,
    settings,
    devices,
  };
}

function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function SettingsPage() {
  const { db, repositories, userId } = useData();
  const { changePassword } = useAuth();
  const notifications = useNotifications();
  const settings = useLiveQuery(() => db.settings.get(userId), [db, userId]);
  const devices = useLiveQuery(
    () => db.devices.where("userId").equals(userId).toArray(),
    [db, userId],
  );
  const pendingCount = useLiveQuery(
    () => db.outbox.where("status").equals("pending").count(),
    [db],
  );
  const [saved, setSaved] = useState(false);
  const [importPreview, setImportPreview] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [notificationState, setNotificationState] = useState<
    | NotificationDeviceState
    | { status: "unsupported" | "denied" | "disabled"; platform: "web" | "ios-pwa" }
    | null
  >(null);
  const [notificationDevices, setNotificationDevices] = useState<
    NotificationDeviceState[]
  >([]);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);

  const refreshNotificationDevices = useCallback(async () => {
    try {
      const values = await notifications.listDevices();
      setNotificationDevices(values);
      const timestamp = new Date().toISOString();
      await db.transaction("rw", db.devices, async () => {
        for (const value of values) {
          const existing = await db.devices.get(value.deviceId);
          await db.devices.put({
            id: value.deviceId,
            userId,
            revision: existing?.revision ?? 1,
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp,
            deletedAt: null,
            name: value.deviceName,
            platform: value.platform,
            digestEnabled: value.digestEnabled,
            importantRemindersEnabled: value.importantRemindersEnabled,
            lastSeenAt: timestamp,
          });
        }
      });
    } catch {
      const cached = await db.devices.where("userId").equals(userId).toArray();
      setNotificationDevices(
        cached
          .filter((device) => !device.deletedAt)
          .map((device) => ({
            deviceId: device.id,
            deviceName: device.name,
            platform: device.platform,
            digestEnabled: device.digestEnabled,
            importantRemindersEnabled: device.importantRemindersEnabled,
            enabled: false,
            status: "disabled",
          })),
      );
    }
  }, [db, notifications, userId]);

  useEffect(() => {
    let active = true;
    void notifications
      .inspect()
      .then((state) => {
        if (active) setNotificationState(state);
      })
      .catch(() => {
        if (active) {
          setNotificationState({ status: "disabled", platform: "web" });
          setNotificationError("暂时无法读取这台设备的通知状态。");
        }
      });
    void refreshNotificationDevices();
    return () => {
      active = false;
    };
  }, [notifications, refreshNotificationDevices]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await repositories.settings.update({
      timeZone: String(form.get("timeZone")),
      dueSoonDays: Number(form.get("dueSoonDays")),
      digestTime: String(form.get("digestTime")),
      quietHoursStart: String(form.get("quietHoursStart")),
      quietHoursEnd: String(form.get("quietHoursEnd")),
    });
    setSaved(true);
  }

  async function exportJson() {
    const archive = await buildJsonExport(db);
    download(
      `lastdone-${archive.exportedAt.slice(0, 10)}.json`,
      JSON.stringify(archive, null, 2),
      "application/json",
    );
  }

  async function exportCsv() {
    const [items, completions] = await Promise.all([
      db.items.toArray(),
      db.completions.toArray(),
    ]);
    const rows = [
      ["type", "id", "itemId", "name", "date", "note"],
      ...items.map((item) => ["item", item.id, "", item.name, item.dueDate, ""]),
      ...completions.map((entry) => [
        "completion",
        entry.id,
        entry.itemId,
        "",
        entry.localDate,
        entry.note,
      ]),
    ];
    download(
      "lastdone.csv",
      rows.map((row) => row.map(csvCell).join(",")).join("\n"),
      "text/csv;charset=utf-8",
    );
  }

  async function previewImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const value = JSON.parse(await file.text()) as Partial<LastDoneExport>;
      if (value.format !== "lastdone-export" || value.version !== 1) {
        throw new Error("unsupported export format");
      }
      setImportPreview(
        `可导入 ${value.categories?.length ?? 0} 个分类、${value.items?.length ?? 0} 个事项和 ${value.completions?.length ?? 0} 条完成记录。`,
      );
    } catch {
      setImportPreview("文件无法识别，当前数据没有改变。");
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword.length < 8) {
      setPasswordMessage("新密码至少需要 8 个字符。");
      return;
    }
    setChangingPassword(true);
    setPasswordMessage(null);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setPasswordMessage("密码已更新。");
    } catch {
      setPasswordMessage("密码更新失败，请确认当前密码和网络连接。");
    } finally {
      setChangingPassword(false);
    }
  }

  async function enableNotifications() {
    setNotificationBusy(true);
    setNotificationError(null);
    try {
      const state = await notifications.enable();
      setNotificationState(state);
      await refreshNotificationDevices();
    } catch {
      setNotificationError("通知启用失败，请确认网络连接后重试。");
    } finally {
      setNotificationBusy(false);
    }
  }

  async function disableNotifications() {
    setNotificationBusy(true);
    setNotificationError(null);
    try {
      const state = await notifications.disable();
      setNotificationState(state);
      await refreshNotificationDevices();
    } catch {
      setNotificationError("通知关闭失败，请稍后重试。");
    } finally {
      setNotificationBusy(false);
    }
  }

  async function updateNotificationPreferences(
    patch: Partial<NotificationPreferences>,
  ) {
    if (!notificationState || !("deviceId" in notificationState)) return;
    const previous = notificationState;
    const optimistic: NotificationDeviceState = {
      ...notificationState,
      digestEnabled: patch.digestEnabled ?? notificationState.digestEnabled,
      importantRemindersEnabled:
        patch.importantRemindersEnabled ?? notificationState.importantRemindersEnabled,
    };
    setNotificationState(optimistic);
    setNotificationBusy(true);
    setNotificationError(null);
    try {
      const next = await notifications.updatePreferences(notificationState.deviceId, {
        digestEnabled: optimistic.digestEnabled,
        importantRemindersEnabled: optimistic.importantRemindersEnabled,
      });
      setNotificationState(next);
      await refreshNotificationDevices();
    } catch {
      setNotificationState(previous);
      setNotificationError("通知偏好保存失败，请稍后重试。");
    } finally {
      setNotificationBusy(false);
    }
  }

  if (settings === undefined) {
    return <p className="loading-state">正在读取设置…</p>;
  }

  return (
    <div className="settings-page">
      <header className="content-header">
        <div>
          <p className="eyebrow">偏好</p>
          <h1>设置</h1>
          <p>管理日期判断、通知时段、数据与设备。</p>
        </div>
      </header>

      <div className="settings-grid">
        <section className="surface-card">
          <h2>日期与提醒</h2>
          <form onSubmit={save}>
            <label className="field">
              <span>时区</span>
              <select name="timeZone" defaultValue={settings.timeZone}>
                <option value="Asia/Shanghai">Asia/Shanghai</option>
                <option value="UTC">UTC</option>
                <option value="America/New_York">America/New_York</option>
              </select>
            </label>
            <label className="field">
              <span>即将到期天数</span>
              <input
                type="number"
                name="dueSoonDays"
                min={1}
                max={90}
                defaultValue={settings.dueSoonDays}
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span>每日摘要时间</span>
                <input
                  type="time"
                  name="digestTime"
                  defaultValue={settings.digestTime}
                />
              </label>
              <label className="field">
                <span>安静时段开始</span>
                <input
                  type="time"
                  name="quietHoursStart"
                  defaultValue={settings.quietHoursStart}
                />
              </label>
              <label className="field">
                <span>安静时段结束</span>
                <input
                  type="time"
                  name="quietHoursEnd"
                  defaultValue={settings.quietHoursEnd}
                />
              </label>
            </div>
            <div className="action-row">
              <button className="button button-primary" type="submit">
                保存设置
              </button>
              {saved ? <span className="saved-state">已保存</span> : null}
            </div>
          </form>
        </section>

        <section className="surface-card notification-settings">
          <h2>通知</h2>
          {notificationState === null ? (
            <p className="muted">正在读取这台设备的通知状态…</p>
          ) : null}
          {notificationState?.status === "unsupported" ? (
            <div className="notice notice-info">
              此浏览器不支持 Web Push。iPhone 请先用 Safari 将 LastDone 添加到主屏幕。
            </div>
          ) : null}
          {notificationState?.status === "denied" ? (
            <div className="notice notice-error" role="alert">
              通知权限已被系统拒绝，请在浏览器或系统设置中重新允许。
            </div>
          ) : null}
          {notificationState?.status === "disabled" ? (
            <>
              <p className="muted">
                通知尚未在这台设备启用。只有点击按钮后才会请求系统权限。
              </p>
              <button
                className="button button-primary"
                type="button"
                disabled={notificationBusy}
                onClick={() => void enableNotifications()}
              >
                {notificationBusy ? "正在启用…" : "启用这台设备的通知"}
              </button>
            </>
          ) : null}
          {notificationState?.status === "enabled" ? (
            <>
              <p className="sync-status">
                <span className="status-dot" />
                这台设备已启用 Web Push
              </p>
              <div className="notification-preferences">
                <label>
                  <input
                    type="checkbox"
                    checked={notificationState.digestEnabled}
                    disabled={notificationBusy}
                    onChange={(event) =>
                      void updateNotificationPreferences({
                        digestEnabled: event.target.checked,
                      })
                    }
                  />
                  每日摘要
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={notificationState.importantRemindersEnabled}
                    disabled={notificationBusy}
                    onChange={(event) =>
                      void updateNotificationPreferences({
                        importantRemindersEnabled: event.target.checked,
                      })
                    }
                  />
                  重要事项提醒
                </label>
              </div>
              <button
                className="button button-secondary"
                type="button"
                disabled={notificationBusy}
                onClick={() => void disableNotifications()}
              >
                关闭这台设备的通知
              </button>
            </>
          ) : null}
          {notificationError ? (
            <p className="field-error" role="alert">
              {notificationError}
            </p>
          ) : null}
          {notificationDevices.length > 0 ? (
            <>
              <h3>已登记设备</h3>
              <ul className="simple-list notification-device-list">
                {notificationDevices.map((device) => (
                  <li key={device.deviceId}>
                    <strong>{device.deviceName}</strong>
                    <span>
                      {device.enabled ? "通知开启" : "通知关闭"} ·
                      {device.digestEnabled ? " 摘要开启" : " 摘要关闭"} ·
                      {device.importantRemindersEnabled
                        ? " 重要提醒开启"
                        : " 重要提醒关闭"}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <section className="surface-card">
          <h2>同步状态</h2>
          <p className="sync-status">
            <span className={pendingCount ? "status-dot pending" : "status-dot"} />
            {pendingCount ? `${pendingCount} 项更改等待同步` : "本地更改已同步"}
          </p>
          <p className="muted">离线时可以继续使用，恢复网络后会自动重试。</p>
        </section>

        <section className="surface-card">
          <h2>数据导出与恢复</h2>
          <p className="muted">JSON 可完整恢复；CSV 适合查看和整理。</p>
          <div className="action-row">
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void exportJson()}
            >
              导出 JSON
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void exportCsv()}
            >
              导出 CSV
            </button>
          </div>
          <label className="field">
            <span>选择 JSON 备份进行预览</span>
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => void previewImport(e)}
            />
          </label>
          {importPreview ? (
            <div className="notice notice-info">{importPreview}</div>
          ) : null}
        </section>

        <section className="surface-card">
          <h2>设备会话</h2>
          {devices?.length ? (
            <ul className="simple-list">
              {devices.map((device) => (
                <li key={device.id}>
                  <strong>{device.name}</strong>
                  <span>{device.platform}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">当前设备会在首次同步后显示。</p>
          )}
        </section>

        <section className="surface-card">
          <h2>修改密码</h2>
          <p className="muted">
            需要在线连接服务器。忘记密码时由 PocketBase 管理员重置。
          </p>
          <form onSubmit={submitPassword}>
            <label className="field">
              <span>当前密码</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label className="field">
              <span>新密码</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <button
              className="button button-secondary"
              type="submit"
              disabled={changingPassword}
            >
              {changingPassword ? "正在更新…" : "更新密码"}
            </button>
            {passwordMessage ? (
              <p className="muted" role="status">
                {passwordMessage}
              </p>
            ) : null}
          </form>
        </section>
      </div>

      <footer className="version-info">
        LastDone Web · Server version available after sync
      </footer>
    </div>
  );
}
