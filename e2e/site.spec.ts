import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The Astro dogfood page, served by `astro preview`.
test.use({ baseURL: "http://localhost:4174" });

test("the page renders its icons and solids as static HTML", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "LuminosiTS" })).toBeVisible();
  await expect(page.getByTestId("icons").getByRole("listitem")).toHaveCount(12);
  await expect(page.getByTestId("solids").getByRole("listitem")).toHaveCount(5);
});

test("the static parts ship no JavaScript; only the island does", async ({ request }) => {
  const html = await (await request.get("/")).text();
  // Astro emits one module script per hydrated island; the rest of the page is plain HTML.
  const scripts = html.match(/<script\b[^>]*type="module"/g) ?? [];
  expect(scripts.length).toBeLessThanOrEqual(1);
  expect(html).toContain("astro-island");
});

test("the 3D island mounts without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByTestId("island").locator("canvas")).toBeVisible({ timeout: 15000 });
  expect(errors).toEqual([]);
});

test("the page has no serious or critical accessibility violations", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});
