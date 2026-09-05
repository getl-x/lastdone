import "fake-indexeddb/auto";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { LastDoneDatabase } from "@lastdone/storage";

import { DataProvider } from "../data/DataProvider";
import { ItemFormPage } from "./ItemFormPage";

const databases: LastDoneDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.delete()));
});

describe("item flow", () => {
  it("previews and saves a relative schedule from a previous completion", async () => {
    const user = userEvent.setup();
    const db = new LastDoneDatabase(`item-flow-${crypto.randomUUID()}`);
    databases.push(db);
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

    render(
      <MemoryRouter>
        <DataProvider db={db} userId="user-1">
          <ItemFormPage />
        </DataProvider>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("事项名称"), "更换滤芯");
    await user.clear(screen.getByLabelText("间隔"));
    await user.type(screen.getByLabelText("间隔"), "90");
    await user.type(screen.getByLabelText("上次完成日期"), "2026-08-01");

    expect(await screen.findByText("预计下次：2026-10-30")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存事项" }));

    expect((await db.items.toArray())[0]).toMatchObject({
      name: "更换滤芯",
      dueDate: "2026-10-30",
    });
  });
});
