import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { AppShell } from "./AppShell";

describe("AppShell", () => {
  it("provides mobile and desktop navigation with current state", () => {
    render(
      <MemoryRouter initialEntries={["/categories"]}>
        <AppShell>
          <h1>分类</h1>
        </AppShell>
      </MemoryRouter>,
    );

    expect(screen.getByRole("navigation", { name: "桌面导航" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "移动导航" })).toBeInTheDocument();
    for (const link of screen.getAllByRole("link", { name: "分类" })) {
      expect(link).toHaveAttribute("aria-current", "page");
    }
    expect(screen.getByRole("main")).toContainElement(
      screen.getByRole("heading", { name: "分类" }),
    );
  });
});
