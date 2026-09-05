import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const userId = "testuser0000001";
const authToken = [
  "eyJhbGciOiJIUzI1NiJ9",
  "eyJpZCI6InRlc3R1c2VyMDAwMDAwMSIsImNvbGxlY3Rpb25JZCI6InVzZXJzIiwidHlwZSI6ImF1dGgiLCJleHAiOjQxMDI0NDQ4MDB9",
  "test-signature",
].join(".");

interface PostedOperation {
  id: string;
  entity: string;
  action: string;
}

async function seedCachedAuth(page: Page) {
  await page.addInitScript(
    ({ token, id }) => {
      localStorage.setItem(
        "pocketbase_auth",
        JSON.stringify({
          token,
          record: { id, username: "getl", collectionName: "users" },
        }),
      );
    },
    { token: authToken, id: userId },
  );
}

async function installApiStub(context: BrowserContext) {
  const pushedOperations: PostedOperation[] = [];

  await context.route("**/api/collections/users/auth-with-password", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        token: authToken,
        record: {
          id: userId,
          collectionId: "users",
          collectionName: "users",
          username: "getl",
          email: "",
          emailVisibility: false,
          verified: true,
          created: "2026-09-05 00:00:00.000Z",
          updated: "2026-09-05 00:00:00.000Z",
        },
      }),
    });
  });
  await context.route("**/api/lastdone/sync/push", async (route) => {
    const payload = route.request().postDataJSON() as {
      operations: PostedOperation[];
    };
    pushedOperations.push(...payload.operations);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        appliedOperationIds: payload.operations.map((operation) => operation.id),
        conflicts: [],
      }),
    });
  });
  await context.route("**/api/lastdone/sync/pull**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        changes: [],
        conflicts: [],
        nextSequence: 0,
        hasMore: false,
      }),
    });
  });

  return pushedOperations;
}

test("logs in, persists an item, and synchronizes an offline completion", async ({
  context,
  page,
}) => {
  const pushedOperations = await installApiStub(context);

  await page.goto("/login");
  await page.getByLabel("用户名").fill("getl");
  await page.getByLabel("密码").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "今天要留意什么？" })).toBeVisible();

  await page.getByRole("link", { name: "新建事项" }).click();
  await page.getByLabel("事项名称").fill("更换滤芯");
  await page.getByLabel("间隔").fill("90");
  await page.getByLabel("上次完成日期", { exact: true }).fill("2026-08-01");
  await expect(page.getByText("预计下次：2026-10-30")).toBeVisible();
  await page.getByRole("button", { name: "保存事项" }).click();
  await expect(page.getByRole("heading", { name: "更换滤芯" })).toBeVisible();
  await expect
    .poll(() =>
      pushedOperations.some(
        (operation) => operation.entity === "items" && operation.action === "create",
      ),
    )
    .toBe(true);

  await page.reload();
  await expect(page.getByRole("heading", { name: "更换滤芯" })).toBeVisible();
  await page.getByRole("link", { name: "返回" }).click();

  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByTestId("item-card").filter({ hasText: "更换滤芯" }),
  ).toBeVisible();
  await expect(page.getByText("当前离线，更改会保存在本机。")).toBeVisible();
  await page.getByRole("button", { name: "完成 更换滤芯" }).click();
  await expect(page.getByText("已记录完成")).toBeVisible();

  await context.setOffline(false);
  await expect
    .poll(() =>
      pushedOperations.some(
        (operation) =>
          operation.entity === "completions" && operation.action === "create",
      ),
    )
    .toBe(true);
});

test("uses bottom navigation at an iPhone-sized viewport", async ({ page }) => {
  await seedCachedAuth(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "移动导航" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "桌面导航" })).toBeHidden();
});
