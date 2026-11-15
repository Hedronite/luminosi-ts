import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("the catalog boots and shows the empty gallery", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "LuminosiTS catalog" })).toBeVisible();
  await expect(page.getByText("No assets yet.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the catalog has no serious or critical accessibility violations", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => v.id)).toEqual([]);
});
