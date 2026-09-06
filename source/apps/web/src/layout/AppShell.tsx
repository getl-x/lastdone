import type { PropsWithChildren, ReactNode } from "react";
import { NavLink } from "react-router";

import { ConnectivityBanner } from "../pwa/ConnectivityBanner";
import { UpdatePrompt } from "../pwa/UpdatePrompt";

const NAVIGATION = [
  { to: "/", label: "首页", icon: "home", end: true },
  { to: "/categories", label: "分类", icon: "categories", end: false },
  { to: "/settings", label: "设置", icon: "settings", end: false },
] as const;

function NavigationIcon({ icon }: { icon: (typeof NAVIGATION)[number]["icon"] }) {
  if (icon === "home") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m3.5 10.5 8.5-7 8.5 7" />
        <path d="M5.5 9v11h13V9M9 20v-6h6v6" />
      </svg>
    );
  }
  if (icon === "categories") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h10M18 6h2M4 12h3M11 12h9M4 18h8M16 18h4" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="14" cy="18" r="2" />
    </svg>
  );
}

function NavigationLinks() {
  return (
    <>
      {NAVIGATION.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `navigation-link${isActive ? " is-active" : ""}`}
        >
          <span className="navigation-icon" aria-hidden="true">
            <NavigationIcon icon={item.icon} />
          </span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </>
  );
}

export function AppShell({
  children,
  header,
}: PropsWithChildren<{ header?: ReactNode }>) {
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <NavLink to="/" className="sidebar-brand" aria-label="LastDone 首页">
          <span className="brand-mark brand-mark-small" aria-hidden="true">
            ✓
          </span>
          <span>LastDone</span>
        </NavLink>
        <nav className="desktop-navigation" aria-label="桌面导航">
          <NavigationLinks />
        </nav>
        <p className="sidebar-caption">不常做，也不会忘。</p>
      </aside>

      <div className="app-content">
        <ConnectivityBanner />
        {header ? <header className="page-header">{header}</header> : null}
        <main className="page-content">{children}</main>
      </div>

      <nav className="mobile-navigation" aria-label="移动导航">
        <NavigationLinks />
      </nav>
      <UpdatePrompt />
    </div>
  );
}
