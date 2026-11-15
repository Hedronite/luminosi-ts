import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const gallery = (page: Page) => page.getByRole("main").getByRole("list").getByRole("button");

async function assetCount(page: Page): Promise<number> {
  const summary = await page.getByText(/^\d+ assets?, typed and importable\.$/).textContent();
  return Number.parseInt(summary ?? "0", 10);
}

test("the gallery lists every asset with no page errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "LuminosiTS catalog" })).toBeVisible();
  const total = await assetCount(page);
  expect(total).toBeGreaterThanOrEqual(20);
  await expect(gallery(page)).toHaveCount(total);
  expect(errors).toEqual([]);
});

test("search narrows the gallery and says how many match", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search assets" }).fill("arrow");
  await expect(gallery(page)).toHaveCount(4);
  await expect(page.getByText("4 results")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search assets" }).fill("no-such-asset");
  await expect(page.getByText("Nothing matches “no-such-asset”.")).toBeVisible();
});

test("the kind filter is a set of toggle buttons", async ({ page }) => {
  await page.goto("/");
  const icons = page.getByRole("group", { name: "Filter by kind" }).getByRole("button", { name: /^Icons/ });
  await icons.click();
  await expect(icons).toHaveAttribute("aria-pressed", "true");
});

test("an asset opens in a dialog with snippets that copy", async ({ page }) => {
  await page.goto("/");
  const trigger = gallery(page).filter({ hasText: "Arrow right" });
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "Arrow right" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\?asset=arrow-right$/);
  const react = dialog.getByRole("region", { name: "React snippet" });
  await expect(react.locator("code")).toContainText('import { ArrowRight } from "@hedronite/lts-icons/react";');

  await react.getByRole("button", { name: "Copy: React snippet" }).click();
  await expect(react.getByRole("button", { name: "Copied: React snippet" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("<ArrowRight");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page).not.toHaveURL(/asset=/);
});

test("a deep link opens its asset", async ({ page }) => {
  await page.goto("/?asset=moon");
  await expect(page.getByRole("dialog", { name: "Moon" })).toBeVisible();
});

for (const [name, path] of [["gallery", "/"], ["detail dialog", "/?asset=cube"]] as const) {
  test(`the ${name} has no serious or critical accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });
}
