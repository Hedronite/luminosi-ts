import AxeBuilder from "@axe-core/playwright";
import { counted, expect, settledBuilds, test } from "./fixtures.js";

// The Astro dogfood page, served by `astro preview`.
test.use({ baseURL: process.env["E2E_SITE_URL"] ?? "http://localhost:4174" });

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

test("the island reports its builds and the renderer's memory; a look and a still page leave the builds as they were", async ({ page }) => {
  await page.goto("/");
  const island = page.getByTestId("island").locator("[data-builds]");
  await expect(island).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 15000 });
  const built = await settledBuilds(island);
  // The renderer's own counts: the three solids' geometries are in use. (The WebGL renderer counts no render targets, so those read 0.)
  await Promise.all(["data-geometries", "data-textures", "data-targets"].map((attribute) => expect(island).toHaveAttribute(attribute, /^\d+$/)));
  await expect.poll(() => counted(island, "data-geometries"), { message: "geometries in use" }).toBeGreaterThan(0);
  const geometries = await counted(island, "data-geometries");

  // The page's look changes (its theme answers to data-preset on the root): the solids are recolored in place, with nothing built.
  const before = await island.locator("canvas").screenshot();
  const frames = await counted(island, "data-frames");
  await page.evaluate(() => {
    document.documentElement.dataset["preset"] = "hedronite";
  });
  await expect.poll(() => counted(island, "data-frames"), { message: "a frame after the look" }).toBeGreaterThan(frames);
  await page.waitForTimeout(600);
  expect(await counted(island, "data-builds"), "builds after a look").toBe(built);
  expect(await counted(island, "data-geometries"), "geometries after a look").toBe(geometries);
  expect((await island.locator("canvas").screenshot()).equals(before), "the picture after a look").toBe(false);

  // Nothing animates here, so a viewer who asked for less motion, and a page left alone, draw nothing and build nothing.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const held = await counted(island, "data-frames");
  await page.waitForTimeout(1500);
  expect(await counted(island, "data-builds"), "builds under reduced motion").toBe(built);
  expect(await counted(island, "data-frames"), "frames on a page left alone").toBe(held);
});

test("the page has no serious or critical accessibility violations", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});
