import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";

// A 3D asset's gallery tile is its poster, a still the rig made: a lazy, sized image with alt text, fetched from its own file.
// The stand-in shapes are what a tile shows only until the poster is made, and `validate` requires every poster to be made.

const tiles = (page: Page) => page.getByRole("main").getByRole("list").getByRole("button");

test("every 3D tile in the gallery shows its poster, lazy, sized, with alt text, and the stand-ins stay unused", async ({ page }) => {
  const failed: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/posters/") && !response.ok()) failed.push(`${String(response.status())} ${response.url()}`);
  });
  // A page tall enough to hold the whole gallery, so every lazy image is in view and loads.
  await page.setViewportSize({ width: 1280, height: 20_000 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "LuminosiTS catalog" })).toBeVisible();
  const total = Number.parseInt((await page.getByText(/^\d+ assets?, typed and importable\.$/).textContent()) ?? "0", 10);
  await expect(tiles(page)).toHaveCount(total);

  const images = page.getByRole("main").locator("img[src^='/posters/']");
  const count = await images.count();
  expect(count).toBeGreaterThan(0);
  // Every tile is an icon (drawn, an svg) or a poster; none is a stand-in shape, a swatch or a bare kind name.
  expect(await tiles(page).locator("svg").count()).toBe(total - count);

  await expect
    .poll(async () => images.evaluateAll((all) => all.filter((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth === 112 && image.naturalHeight === 112).length), { timeout: 20_000, message: "every poster loaded at twice the tile size" })
    .toBe(count);
  const attributes = await images.evaluateAll((all) => all.map((image) => ({ loading: image.getAttribute("loading"), decoding: image.getAttribute("decoding"), width: image.getAttribute("width"), height: image.getAttribute("height"), alt: image.getAttribute("alt") ?? "" })));
  for (const image of attributes) {
    expect(image.loading).toBe("lazy");
    expect(image.decoding).toBe("async");
    expect(image.width).toBe("56");
    expect(image.height).toBe("56");
    expect(image.alt.trim().length).toBeGreaterThan(0);
  }
  expect(failed).toEqual([]);
});

test("a tile gives way to its stand-in when the poster does not load", async ({ page }) => {
  await page.route("**/posters/metal.webp*", (route) => route.abort());
  await page.goto("/");
  const tile = tiles(page).filter({ hasText: /^Metal$/ });
  await tile.scrollIntoViewIfNeeded();
  await expect(tile.locator("img")).toHaveCount(0);
  await expect(tile.locator("svg")).toHaveCount(1);
});
