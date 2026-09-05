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
});
