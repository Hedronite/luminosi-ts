import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const errorsOn = (page: Page): string[] => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
};

test("the Effects tab stacks screen effects over a solid and lists the surface shaders", async ({ page }) => {
  const errors = errorsOn(page);
  await page.goto("/?view=effects");
  await expect(page.getByRole("heading", { name: "Effects", exact: true })).toBeVisible();
  const stage = page.getByTestId("effects-stage");
  await expect(stage).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 15000 });
  await page.getByRole("checkbox", { name: "Dither" }).check();
  await page.getByRole("checkbox", { name: /^Lens/ }).uncheck();
  await expect(page.getByRole("img", { name: /under Scan sweep, Dither\.$/ })).toBeVisible();
  await page.getByLabel("Solid", { exact: true }).selectOption("catalan-rhombic-triacontahedron");
  await page.getByLabel("Ink", { exact: true }).selectOption("accent");
  await page.getByLabel("Surface", { exact: true }).selectOption("metal");
  // Still rendering after every change.
  const before = Number(await stage.getAttribute("data-frames"));
  await expect.poll(async () => Number(await stage.getAttribute("data-frames"))).toBeGreaterThan(before);
  await expect(page.getByRole("region", { name: "Surface shaders" }).getByRole("button")).toHaveCount(7);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  expect(errors).toEqual([]);
});

test("the lens opens where the pointer is", async ({ page }) => {
  const errors = errorsOn(page);
  await page.goto("/?view=effects");
  const stage = page.getByTestId("effects-stage");
  await expect(stage).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 15000 });
  const box = await stage.boundingBox();
  if (box === null) throw new Error("no stage");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2);
  const before = Number(await stage.getAttribute("data-frames"));
  await expect.poll(async () => Number(await stage.getAttribute("data-frames"))).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});

for (const [id, name] of [
  ["dither", "Dither"],
  ["ascii", "ASCII"],
  ["grain", "Film grain"],
  ["scan", "Scan sweep"],
  ["lens", "Lens"],
  ["crystallize", "Crystallize"],
  ["smoke", "Smoke"],
] as const) {
  test(`the ${id} screen effect renders in its detail view`, async ({ page }) => {
    const errors = errorsOn(page);
    await page.goto(`/?asset=${id}`);
    const viewport = page.getByRole("dialog", { name }).getByTestId("viewport");
    await expect(viewport).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 15000 });
    await expect(viewport).toHaveAttribute("data-gpu-geometries", /^[1-9]\d*$/);
    expect(errors).toEqual([]);
  });
}
