import "fake-indexeddb/auto";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { LastDoneDatabase } from "@lastdone/storage";

import { DataProvider } from "../data/DataProvider";
import { DashboardPage } from "./DashboardPage";

const databases: LastDoneDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});

function createDatabase() {
  const db = new LastDoneDatabase(`dashboard-${crypto.randomUUID()}`);
  databases.push(db);
  return db;
}

describe("DashboardPage", () => {
  it("groups items by urgency and searches names and completion notes", async () => {
    const user = userEvent.setup();
    const db = createDatabase();
    await db.categories.add({
      id: "category0000001",
      userId: "user-1",
      revision: 1,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      deletedAt: null,
      name: "家居",
      icon: "house",
      color: "#B57B46",
      displayOrder: 0,
      lifecycle: "active",
    });
    await db.items.bulkAdd([
      {
        id: "item0000000001",
        userId: "user-1",
        revision: 1,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        deletedAt: null,
        name: "逾期事项",
        categoryId: "category0000001",
        schedule: { type: "relative", every: 30, unit: "days" },
        initialDueDate: "2026-09-01",
        dueDate: "2026-09-01",
        lastCompletedDate: null,
        lastCompletionId: null,
        important: false,
        reminderOffsets: [],
        lifecycle: "active",
      },
      {
        id: "item0000000002",
        userId: "user-1",
        revision: 1,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        deletedAt: null,
        name: "今天事项",
        categoryId: "category0000001",
        schedule: { type: "fixed-monthly", day: 5 },
        initialDueDate: "2026-09-05",
        dueDate: "2026-09-05",
        lastCompletedDate: null,
        lastCompletionId: null,
        important: true,
        reminderOffsets: [0],
        lifecycle: "active",
      },
    ]);
    await db.completions.add({
      id: "complete0000001",
      userId: "user-1",
      revision: 1,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      deletedAt: null,
      itemId: "item0000000002",
      completedAt: "2026-08-01T00:00:00.000Z",
      localDate: "2026-08-01",
      note: "检查了客厅",
      previousDueDate: null,
      previousLastCompletedDate: null,
      previousLastCompletionId: null,
    });

    render(
      <MemoryRouter>
        <DataProvider db={db} userId="user-1">
          <DashboardPage today="2026-09-05" />
        </DataProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("逾期")).toBeInTheDocument();
    const cards = await screen.findAllByTestId("item-card");
    expect(cards[0]).toHaveTextContent("逾期事项");
    expect(cards[1]).toHaveTextContent("今天事项");

    await user.type(screen.getByRole("searchbox"), "客厅");
    await waitFor(() => {
      expect(screen.queryByText("逾期事项")).not.toBeInTheDocument();
      expect(screen.getByText("今天事项")).toBeInTheDocument();
    });
  });

  it("records a one-tap completion and offers undo", async () => {
    const user = userEvent.setup();
    const db = createDatabase();
    await db.items.add({
      id: "item0000000001",
      userId: "user-1",
      revision: 1,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      deletedAt: null,
      name: "备份电脑",
      categoryId: "category0000001",
      schedule: { type: "relative", every: 30, unit: "days" },
      initialDueDate: "2026-09-05",
      dueDate: "2026-09-05",
      lastCompletedDate: null,
      lastCompletionId: null,
      important: false,
      reminderOffsets: [],
      lifecycle: "active",
    });

    render(
      <MemoryRouter>
        <DataProvider db={db} userId="user-1" now={() => "2026-09-05T08:00:00.000Z"}>
          <DashboardPage today="2026-09-05" />
        </DataProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "完成 备份电脑" }));
    expect(await screen.findByRole("button", { name: "撤销" })).toBeInTheDocument();
    expect(await db.completions.count()).toBe(1);

    await user.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(async () => {
      expect((await db.completions.toArray())[0]?.deletedAt).not.toBeNull();
    });
  });
});
