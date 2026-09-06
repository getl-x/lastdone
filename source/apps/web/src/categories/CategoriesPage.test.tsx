import "fake-indexeddb/auto";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { LastDoneDatabase } from "@lastdone/storage";

import { DataProvider } from "../data/DataProvider";
import { CategoriesPage } from "./CategoriesPage";

const databases: LastDoneDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});

describe("CategoriesPage", () => {
  it("shows defaults and adds a custom category", async () => {
    const user = userEvent.setup();
    const db = new LastDoneDatabase(`categories-${crypto.randomUUID()}`);
    databases.push(db);

    render(
      <MemoryRouter>
        <DataProvider db={db} userId="user-1">
          <CategoriesPage />
        </DataProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("健康")).toBeInTheDocument();
    await user.type(screen.getByLabelText("分类名称"), "旅行");
    await user.click(screen.getByRole("button", { name: "添加分类" }));

    expect(await screen.findByText("旅行")).toBeInTheDocument();
    expect(await db.categories.where("name").equals("旅行").count()).toBe(1);
  });

  it("does not show category tombstones", async () => {
    const db = new LastDoneDatabase(`categories-deleted-${crypto.randomUUID()}`);
    databases.push(db);
    const timestamp = "2026-09-06T08:00:00.000Z";
    await db.categories.bulkAdd([
      {
        id: "category0000001",
        userId: "user-1",
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
        name: "保留分类",
        icon: "shapes",
        color: "#657FA3",
        displayOrder: 0,
        lifecycle: "active",
      },
      {
        id: "category0000002",
        userId: "user-1",
        revision: 2,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: timestamp,
        name: "已删除分类",
        icon: "shapes",
        color: "#77736D",
        displayOrder: 1,
        lifecycle: "active",
      },
    ]);

    render(
      <MemoryRouter>
        <DataProvider db={db} userId="user-1">
          <CategoriesPage />
        </DataProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("保留分类")).toBeInTheDocument();
    expect(screen.queryByText("已删除分类")).not.toBeInTheDocument();
  });
});
