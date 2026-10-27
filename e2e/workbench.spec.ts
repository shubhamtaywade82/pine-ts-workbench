import { test, expect } from "@playwright/test";

test.describe("Pine-TS Workbench E2E", () => {
  test("loads the chart workbench and top toolbar", async ({ page }) => {
    await page.goto("/");

    // Verify search symbol button exists in top toolbar
    const symbolBtn = page.getByTitle("Search symbol");
    await expect(symbolBtn).toBeVisible({ timeout: 10_000 });

    // Verify timeframe buttons exist in top bar
    await expect(page.getByRole("button", { name: "1m", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "5m", exact: true })).toBeVisible();
  });

  test("opens and filters symbol search dialog", async ({ page }) => {
    await page.goto("/");
    const symbolBtn = page.getByTitle("Search symbol");
    await symbolBtn.click();

    // Dialog should open
    const searchInput = page.getByPlaceholder(/Search symbol, name or exchange/i);
    await expect(searchInput).toBeVisible();

    // Filter by NIFTY
    await searchInput.fill("NIFTY");
    await expect(page.getByText(/NIFTY 50/i).first()).toBeVisible();

    // Close via escape
    await page.keyboard.press("Escape");
    await expect(searchInput).not.toBeVisible();
  });

  test("toggles the Pine Editor and Strategy Tester panels", async ({ page }) => {
    await page.goto("/");

    // Toggle Pine Editor from bottom footer
    const footer = page.getByRole("contentinfo");
    const editorBtn = footer.getByRole("button", { name: "Pine Editor" });
    await expect(editorBtn).toBeVisible();
    await editorBtn.click();

    // Pine Editor panel displays Add to chart button
    const addToChartBtn = page.getByRole("button", { name: "Add to chart" });
    await expect(addToChartBtn).toBeVisible({ timeout: 5_000 });

    // Toggle Strategy Tester from bottom footer
    const testerBtn = footer.getByRole("button", { name: "Strategy Tester" });
    await expect(testerBtn).toBeVisible();
    await testerBtn.click();

    // Strategy Tester contains report placeholder or overview
    const testerContent = page.getByText(/Run a strategy from the Pine Editor|Overview|Performance/i).first();
    await expect(testerContent).toBeVisible({ timeout: 5_000 });
  });
});

