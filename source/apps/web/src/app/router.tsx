import type { ReactNode } from "react";
import { Navigate, Outlet, createBrowserRouter, useLocation } from "react-router";

import { useAuth } from "../auth/AuthProvider";
import { LoginPage } from "../auth/LoginPage";
import { AppShell } from "../layout/AppShell";

function PlaceholderPage({ title, copy }: { title: string; copy: string }) {
  return (
    <section className="placeholder-page">
      <p className="eyebrow">LASTDONE</p>
      <h1>{title}</h1>
      <p>{copy}</p>
    </section>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  return user ? (
    children
  ) : (
    <Navigate to="/login" replace state={{ from: location.pathname }} />
  );
}

function ProtectedLayout() {
  return (
    <RequireAuth>
      <AppShell>
        <Outlet />
      </AppShell>
    </RequireAuth>
  );
}

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <ProtectedLayout />,
    children: [
      {
        path: "/",
        element: (
          <PlaceholderPage
            title="今天要留意什么？"
            copy="逾期、今天到期和即将到期的事项会显示在这里。"
          />
        ),
      },
      {
        path: "/items/:id",
        element: (
          <PlaceholderPage title="事项详情" copy="查看周期、下次日期和完成记录。" />
        ),
      },
      {
        path: "/categories",
        element: (
          <PlaceholderPage title="分类" copy="整理健康、家居、设备等重复事项。" />
        ),
      },
      {
        path: "/settings",
        element: (
          <PlaceholderPage title="设置" copy="管理同步、提醒、导入导出和账户。" />
        ),
      },
    ],
  },
]);
