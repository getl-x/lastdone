import { useUpdateCheck } from "../native/UpdateCheckProvider";

function openReleasePage(url: string): void {
  // Navigating to a non-local origin makes Capacitor hand the URL to the
  // system browser through Intent.ACTION_VIEW instead of loading it in-app.
  window.location.href = url;
}

export function UpdateChecker() {
  const { check, state } = useUpdateCheck();
  const busy = state.status === "checking";

  return (
    <section className="surface-card">
      <h2>检查更新</h2>
      <p className="muted">
        从 GitHub Releases 获取最新版本。下载后需要手动安装新的 APK。
      </p>
      {state.status === "update-available" ? (
        <>
          <div className="notice notice-info">
            <strong>发现新版本 {state.result.latest.version}</strong>
            <span>当前版本 {state.result.currentVersion}。</span>
          </div>
          <div className="action-row">
            <button
              className="button button-primary"
              type="button"
              onClick={() => openReleasePage(state.result.latest.htmlUrl)}
            >
              前往下载
            </button>
          </div>
        </>
      ) : null}
      {state.status === "up-to-date" ? (
        <div className="notice notice-info">已是最新版本 {state.currentVersion}。</div>
      ) : null}
      {state.status === "unsupported" ? (
        <p className="muted">
          当前版本 {state.currentVersion} 不是正式发布版本，已跳过更新检测。
        </p>
      ) : null}
      {state.status === "error" ? (
        <p className="field-error" role="alert">
          检查更新失败，请确认网络连接后重试。
        </p>
      ) : null}
      <div className="action-row">
        <button
          className="button button-secondary"
          type="button"
          disabled={busy}
          onClick={() => void check()}
        >
          {busy ? "正在检查…" : "检查更新"}
        </button>
      </div>
    </section>
  );
}
