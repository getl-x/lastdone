import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { AuthProvider, type AuthClient } from "./AuthProvider";
import { LoginPage } from "./LoginPage";

function renderLogin(client: AuthClient) {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider client={client}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p>应用首页</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("LoginPage", () => {
  it("validates username and password before submitting", async () => {
    const user = userEvent.setup();
    const login = vi.fn();
    renderLogin({ currentUser: () => null, login, logout: vi.fn() });

    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(screen.getByText("请输入用户名")).toBeInTheDocument();
    expect(screen.getByText("请输入密码")).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it("disables submission while logging in and shows a recoverable error", async () => {
    const user = userEvent.setup();
    let rejectLogin: ((reason: Error) => void) | undefined;
    const login = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectLogin = reject;
        }),
    );
    renderLogin({ currentUser: () => null, login, logout: vi.fn() });

    await user.type(screen.getByLabelText("用户名"), "getl");
    await user.type(screen.getByLabelText("密码"), "password123");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(screen.getByRole("button", { name: "正在登录…" })).toBeDisabled();
    rejectLogin?.(new Error("invalid credentials"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "登录失败，请检查用户名和密码后重试。",
    );
  });

  it("opens the application with an offline cached session", () => {
    renderLogin({
      currentUser: () => ({ id: "user-1", username: "getl" }),
      login: vi.fn(),
      logout: vi.fn(),
      isOffline: () => true,
    });

    expect(screen.getByText("应用首页")).toBeInTheDocument();
  });
});
