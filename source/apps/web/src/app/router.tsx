import type { ReactNode } from "react";
import { Navigate, Outlet, createBrowserRouter, useLocation } from "react-router";

import { useAuth } from "../auth/AuthProvider";
import { LoginPage } from "../auth/LoginPage";
import { CategoriesPage } from "../categories/CategoriesPage";
import { DashboardPage } from "../dashboard/DashboardPage";
import { ItemDetailPage } from "../items/ItemDetailPage";
import { ItemFormPage } from "../items/ItemFormPage";
import { AppShell } from "../layout/AppShell";
import { SettingsPage } from "../settings/SettingsPage";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  return user ? (
    children
  ) : (
    <Navigate
      to="/login"
      replace
      state={{ from: `${location.pathname}${location.search}${location.hash}` }}
    />
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
        element: <DashboardPage />,
      },
      { path: "/items/new", element: <ItemFormPage /> },
      {
        path: "/items/:id",
        element: <ItemDetailPage />,
      },
      { path: "/items/:id/edit", element: <ItemFormPage /> },
      {
        path: "/categories",
        element: <CategoriesPage />,
      },
      {
        path: "/settings",
        element: <SettingsPage />,
      },
    ],
  },
]);
