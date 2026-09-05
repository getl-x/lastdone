import type { PropsWithChildren, ReactNode } from "react";
import { NavLink } from "react-router";

const NAVIGATION = [
  { to: "/", label: "首页", icon: "⌂", end: true },
  { to: "/categories", label: "分类", icon: "◫", end: false },
  { to: "/settings", label: "设置", icon: "⚙", end: false },
] as const;

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
            {item.icon}
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
        {header ? <header className="page-header">{header}</header> : null}
        <main className="page-content">{children}</main>
      </div>

      <nav className="mobile-navigation" aria-label="移动导航">
        <NavigationLinks />
      </nav>
    </div>
  );
}
