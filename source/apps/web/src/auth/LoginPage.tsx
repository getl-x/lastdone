import { useState, type FormEvent } from "react";
import { Navigate } from "react-router";

import { useAuth } from "./AuthProvider";

export function LoginPage() {
  const { user, status, login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{
    username?: string;
    password?: string;
    form?: string;
  }>({});

  if (user && status !== "offline-authenticated") {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: typeof errors = {};
    if (!username.trim()) {
      nextErrors.username = "请输入用户名";
    }
    if (!password) {
      nextErrors.password = "请输入密码";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    try {
      await login(username.trim(), password);
    } catch {
      setErrors({ form: "登录失败，请检查用户名和密码后重试。" });
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand-mark" aria-hidden="true">
          ✓
        </div>
        <p className="eyebrow">LASTDONE</p>
        <h1 id="login-title">记住上次，安排下次</h1>
        <p className="login-intro">管理那些不必每天做，却不能忘记的重复事项。</p>

        {status === "offline-authenticated" ? (
          <div className="notice notice-info">当前离线，已缓存的数据仍可使用。</div>
        ) : null}
        {errors.form ? (
          <div className="notice notice-error" role="alert">
            {errors.form}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span>用户名</span>
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              aria-invalid={Boolean(errors.username)}
            />
            {errors.username ? (
              <small className="field-error">{errors.username}</small>
            ) : null}
          </label>
          <label className="field">
            <span>密码</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(errors.password)}
            />
            {errors.password ? (
              <small className="field-error">{errors.password}</small>
            ) : null}
          </label>
          <button
            className="button button-primary login-submit"
            type="submit"
            disabled={status === "authenticating"}
          >
            {status === "authenticating" ? "正在登录…" : "登录"}
          </button>
        </form>
        <p className="login-footnote">首次登录需要连接你的 LastDone 服务器。</p>
      </section>
    </main>
  );
}
