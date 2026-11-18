import { expect, test } from "@playwright/test";

test("when the descriptors chunk fails to load, the dialog says the snippets could not be loaded", async ({ page }) => {
  await page.route(/\/assets\/descriptors-[^/]+\.js$/, (route) => route.abort());
  await page.goto("/?asset=arrow-right");
  const dialog = page.getByRole("dialog", { name: "Arrow right" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("could not be loaded");
  await expect(dialog.getByRole("region", { name: /snippet/ })).toHaveCount(0);
});
