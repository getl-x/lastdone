import Dexie from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import type { ConflictRecord } from "@lastdone/storage";

import { useAuth } from "../auth/AuthProvider";
import { useData } from "../data/DataProvider";
import { resetAndroidServerOrigin, useRuntimeConfig } from "../native/serverOrigin";
import type {
  NotificationDeviceState,
  NotificationPlatform,
  NotificationPreferences,
} from "../notifications/client";
import { BrowserPushSetupError } from "../notifications/client";
import { useNotifications } from "../notifications/NotificationProvider";
import {
  buildImportPlan,
  buildJsonExport,
  restoreJsonExport,
  type LastDoneImportPlan,
} from "./archive";
import { VersionInfo } from "./VersionInfo";

export { buildJsonExport };
export type { LastDoneExport } from "./archive";

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

function conflictValue(value: unknown): string {
  if (value === null) return "空";
  if (typeof value === "string") return value || "空字符串";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const CONFLICT_ENTITY_LABELS: Record<ConflictRecord["entity"], string> = {
  categories: "分类",
  items: "事项",
  completions: "完成记录",
  skips: "跳过记录",
  settings: "设置",
  devices: "设备",
};

export function SettingsPage() {
  const { db, repositories, resolveConflict, userId } = useData();
  const { changePassword, logout } = useAuth();
  const notifications = useNotifications();
  const runtimeConfig = useRuntimeConfig();
  const settings = useLiveQuery(() => db.settings.get(userId), [db, userId]);
  const devices = useLiveQuery(
    async () =>
      (await db.devices.where("userId").equals(userId).toArray()).filter(
        (device) => !device.deletedAt,
      ),
    [db, userId],
  );
  // Counts through the [userId+status+createdAt] index added in database v2.
  const pendingCount = useLiveQuery(
    () =>
      db.outbox
        .where("[userId+status+createdAt]")
        .between([userId, "pending", Dexie.minKey], [userId, "pending", Dexie.maxKey])
        .count(),
    [db, userId],
  );
  const conflicts = useLiveQuery(
    () =>
      db.conflicts
        .where("userId")
        .equals(userId)
        .filter((conflict) => conflict.status === "unresolved")
        .sortBy("createdAt"),
    [db, userId],
  );
  const [saved, setSaved] = useState(false);
  const [importPreview, setImportPreview] = useState<string | null>(null);
  const [importPlan, setImportPlan] = useState<LastDoneImportPlan | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [notificationState, setNotificationState] = useState<
    | NotificationDeviceState
    | {
        status: "unsupported" | "denied" | "disabled";
        platform: NotificationPlatform;
      }
    | null
  >(null);
  const [notificationDevices, setNotificationDevices] = useState<
    NotificationDeviceState[]
  >([]);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [resolvingConflictId, setResolvingConflictId] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);

  const refreshNotificationDevices = useCallback(async () => {
    try {
      const values = await notifications.listDevices();
      setNotificationDevices(values);
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
          setNotificationState({
            status: "disabled",
            platform: runtimeConfig.isAndroid ? "android" : "web",
          });
          setNotificationError("暂时无法读取这台设备的通知状态。");
        }
      });
    void refreshNotificationDevices();
    return () => {
      active = false;
    };
  }, [notifications, refreshNotificationDevices, runtimeConfig.isAndroid]);

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
    const archive = await buildJsonExport(db, userId);
    download(
      `lastdone-${archive.exportedAt.slice(0, 10)}.json`,
      JSON.stringify(archive, null, 2),
      "application/json",
    );
  }

  async function exportCsv() {
    const [items, completions, skips] = await Promise.all([
      db.items.where("userId").equals(userId).toArray(),
      db.completions.where("userId").equals(userId).toArray(),
      db.skips.where("userId").equals(userId).toArray(),
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
      ...skips.map((entry) => [
        "skip",
        entry.id,
        entry.itemId,
        "",
        entry.occurrenceDate,
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
    setImportPlan(null);
    try {
      const value: unknown = JSON.parse(await file.text());
      const plan = await buildImportPlan(db, userId, value);
      setImportPlan(plan);
      setImportPreview(
        `校验通过：将新增 ${plan.summary.add} 条、更新 ${plan.summary.update} 条、移除 ${plan.summary.remove} 条记录。`,
      );
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "未知格式错误";
      setImportPreview(`文件无法导入：${detail}。当前数据没有改变。`);
    }
  }

  async function applyImport() {
    if (!importPlan) return;
    if (
      !window.confirm(
        `将按照备份恢复数据：新增 ${importPlan.summary.add} 条、更新 ${importPlan.summary.update} 条、移除 ${importPlan.summary.remove} 条。确定继续吗？`,
      )
    ) {
      return;
    }
    setImportBusy(true);
    try {
      const result = await restoreJsonExport(db, userId, importPlan);
      setImportPlan(null);
      setImportPreview(
        `恢复已写入本机：新增 ${result.add} 条、更新 ${result.update} 条、移除 ${result.remove} 条，正在等待同步。`,
      );
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "未知错误";
      setImportPreview(`恢复失败：${detail}。事务已回滚。`);
    } finally {
      setImportBusy(false);
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
    } catch (cause) {
      setNotificationError(
        cause instanceof BrowserPushSetupError
          ? cause.message
          : "通知启用失败，请确认网络连接后重试。",
      );
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

  async function resetServer() {
    if (
      !window.confirm(
        "重新配置服务器会退出当前账号。设备中的离线数据不会自动删除，确定继续吗？",
      )
    ) {
      return;
    }
    await resetAndroidServerOrigin();
    window.location.reload();
  }

  async function chooseConflict(conflictId: string, choice: "local" | "server") {
    setResolvingConflictId(conflictId);
    setConflictError(null);
    try {
      await resolveConflict(conflictId, choice);
    } catch {
      setConflictError("冲突处理失败，请确认网络连接后重试。");
    } finally {
      setResolvingConflictId(null);
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
                这台设备已启用{" "}
                {notificationState.platform === "android" ? "本地通知" : "Web Push"}
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
          {notificationState?.platform === "android" ? (
            <div className="notice notice-info android-notification-help">
              <strong>红米 / HyperOS 建议设置</strong>
              <span>
                在系统设置中允许 LastDone
                通知，并把电池策略设为“不限制”。如果重启后不提醒，再允许自启动。
              </span>
              <span>
                LastDone 使用非精确本地提醒，不需要 Google 服务或精确闹钟权限。
              </span>
            </div>
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

        {conflicts?.length ? (
          <section className="surface-card conflict-settings">
            <h2>需要确认的同步冲突</h2>
            <p className="muted">
              两台设备同时修改了同一字段。请选择保留本机修改，或保留服务器当前值。
            </p>
            <ul className="conflict-list">
              {conflicts.map((conflict) => (
                <li key={conflict.id}>
                  <div className="conflict-heading">
                    <strong>
                      {CONFLICT_ENTITY_LABELS[conflict.entity]} · {conflict.field}
                    </strong>
                    <span>{conflict.entityId}</span>
                  </div>
                  <div className="conflict-values">
                    <div>
                      <small>本机修改</small>
                      <pre>{conflictValue(conflict.localValue)}</pre>
                    </div>
                    <div>
                      <small>服务器当前值</small>
                      <pre>{conflictValue(conflict.serverValue)}</pre>
                    </div>
                  </div>
                  <div className="action-row">
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={resolvingConflictId === conflict.id}
                      onClick={() => void chooseConflict(conflict.id, "local")}
                    >
                      保留本机修改
                    </button>
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={resolvingConflictId === conflict.id}
                      onClick={() => void chooseConflict(conflict.id, "server")}
                    >
                      保留服务器值
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {conflictError ? (
              <p className="field-error" role="alert">
                {conflictError}
              </p>
            ) : null}
          </section>
        ) : null}

        {runtimeConfig.isAndroid ? (
          <section className="surface-card">
            <h2>服务器</h2>
            <p className="server-origin-value">{runtimeConfig.serverOrigin}</p>
            {runtimeConfig.serverOriginSource === "preferences" ? (
              <>
                <p className="muted">
                  服务器地址保存在这台手机中。重新配置会退出账号，但不会立即删除离线数据库。
                </p>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => void resetServer()}
                >
                  重新配置服务器
                </button>
              </>
            ) : (
              <p className="muted">
                此地址在 APK 构建时固定。如需更改，请使用新的服务器地址重新生成 APK。
              </p>
            )}
          </section>
        ) : null}

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
          {importPlan ? (
            <button
              className="button button-primary"
              type="button"
              disabled={importBusy}
              onClick={() => void applyImport()}
            >
              {importBusy ? "正在恢复…" : "确认恢复这份备份"}
            </button>
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

        <section className="surface-card">
          <h2>账号</h2>
          <p className="muted">
            退出后，本机离线数据库仍会保留；再次登录同一账号后可以继续使用。
          </p>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => {
              if (window.confirm("确定退出 LastDone 吗？")) {
                void logout();
              }
            }}
          >
            退出登录
          </button>
        </section>
      </div>

      <VersionInfo />
    </div>
  );
}
