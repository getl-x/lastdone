import { useState, type FormEvent } from "react";

import { normalizeServerOrigin } from "./serverOrigin";

export function ServerSetupPage({
  onSave,
}: {
  onSave(serverOrigin: string): Promise<void>;
}) {
  const [serverOrigin, setServerOrigin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSave(normalizeServerOrigin(serverOrigin));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "服务器地址保存失败。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="server-setup-page">
      <section className="server-setup-card">
        <div className="brand-mark" aria-hidden="true">
          ✓
        </div>
        <p className="eyebrow">ANDROID 首次设置</p>
        <h1>连接你的 LastDone 服务器</h1>
        <p className="login-intro">
          APK 只保存服务器地址，事项仍会同步到你自己的 VPS。请填写已经配置好 HTTPS
          的域名。
        </p>
        <form onSubmit={submit}>
          <label className="field">
            <span>服务器地址</span>
            <input
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="https://lastdone.example.com"
              required
              value={serverOrigin}
              onChange={(event) => setServerOrigin(event.target.value)}
            />
          </label>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="button button-primary login-submit"
            type="submit"
            disabled={saving}
          >
            {saving ? "正在保存…" : "保存并继续"}
          </button>
        </form>
        <p className="login-footnote">
          之后可以在“设置”中查看或重新配置。反向代理由你的 1Panel 管理。
        </p>
      </section>
    </main>
  );
}

export function StartupErrorPage({ message }: { message: string }) {
  return (
    <main className="server-setup-page">
      <section className="server-setup-card">
        <div className="brand-mark" aria-hidden="true">
          !
        </div>
        <p className="eyebrow">LASTDONE 启动失败</p>
        <h1>无法读取应用配置</h1>
        <p className="notice notice-error" role="alert">
          {message}
        </p>
        <button
          className="button button-primary login-submit"
          type="button"
          onClick={() => window.location.reload()}
        >
          重新加载
        </button>
      </section>
    </main>
  );
}
