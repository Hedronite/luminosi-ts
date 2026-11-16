import { expect, test } from "@playwright/test";

test("Codevember's days are demos with their notes readable in place and a live link", async ({ page }) => {
  await page.goto("/?view=open-source");
  await page.getByRole("button", { name: /^Codevember 2026/ }).click();
  await expect(page.getByTestId("folder-credit")).toContainText("Theo Tillberg");
  await expect(page.getByTestId("folder-credit")).toContainText("MIT");
  const orrery = page.getByRole("listitem").filter({ hasText: "06 / Orrery" });
  await expect(orrery.getByRole("link", { name: /Open the 06 \/ Orrery demo/ })).toHaveAttribute("href", "https://ttillberg.github.io/codevember-2026/06/");
  await orrery.getByRole("button", { name: "Read 06 / Orrery" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "06 / Orrery" })).toBeVisible();
  await expect(page.getByText(/cat's eye marbles/).first()).toBeVisible();
});

test("ThreeRT sits under Engines, with its docs readable page by page", async ({ page }) => {
  await page.goto("/?view=open-source");
  await expect(page.getByRole("heading", { name: "Engines" })).toBeVisible();
  await page.getByRole("button", { name: /^ThreeRT/ }).click();
  await expect(page.getByTestId("folder-credit")).toContainText("Meshy LLC");
  await page.getByRole("button", { name: /^Read Documentation/ }).click();
  const pages = page.getByRole("combobox", { name: "Page" });
  await expect(pages).toBeVisible();
  expect(await pages.locator("option").count()).toBeGreaterThan(5);
  await expect(page.getByText("Loading…")).toHaveCount(0);
  await expect(page.locator("article").getByRole("paragraph").first()).toBeVisible();
});
