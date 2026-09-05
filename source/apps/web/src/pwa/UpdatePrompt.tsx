import { useRegisterSW } from "virtual:pwa-register/react";

export function UpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!offlineReady && !needRefresh) {
    return null;
  }

  return (
    <aside className="update-prompt" role="status">
      <span>{needRefresh ? "LastDone 有新版本可用。" : "LastDone 已可离线使用。"}</span>
      <div>
        {needRefresh ? (
          <button type="button" onClick={() => void updateServiceWorker(true)}>
            更新
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setOfflineReady(false);
            setNeedRefresh(false);
          }}
        >
          稍后
        </button>
      </div>
    </aside>
  );
}
