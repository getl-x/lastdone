import "fake-indexeddb/auto";

import { render, screen, waitFor } from "@testing-library/react";
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

  it("moves existing items before deleting their category", async () => {
    const user = userEvent.setup();
    const db = new LastDoneDatabase(`categories-remove-${crypto.randomUUID()}`);
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
        name: "准备删除",
        icon: "shapes",
        color: "#E56B7F",
        displayOrder: 0,
        lifecycle: "active",
      },
      {
        id: "category0000002",
        userId: "user-1",
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
        name: "保留分类",
        icon: "house",
        color: "#D7903D",
        displayOrder: 1,
        lifecycle: "active",
      },
    ]);
    await db.items.add({
      id: "item00000000001",
      userId: "user-1",
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
      name: "测试事项",
      categoryId: "category0000001",
      schedule: { type: "relative", every: 30, unit: "days" },
      initialDueDate: "2026-09-30",
      dueDate: "2026-09-30",
      lastCompletedDate: null,
      lastCompletionId: null,
      important: false,
      reminderOffsets: [],
      lifecycle: "active",
    });

    render(
      <MemoryRouter>
        <DataProvider db={db} userId="user-1">
          <CategoriesPage />
        </DataProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "删除分类 准备删除" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("此分类中有 1 个事项");
    await user.selectOptions(screen.getByLabelText("事项移动到"), "category0000002");
    await user.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(async () => {
      expect((await db.categories.get("category0000001"))?.deletedAt).not.toBeNull();
    });
    expect((await db.items.get("item00000000001"))?.categoryId).toBe("category0000002");
    expect(screen.queryByText("准备删除")).not.toBeInTheDocument();
  });
});
