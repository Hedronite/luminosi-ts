import type { Page } from "@playwright/test";
import { expect, expectRenderer, test } from "./fixtures.js";

const gallery = (page: Page) => page.getByRole("main").getByRole("list").getByRole("button");

test("the Archimedean and Catalan solids are searchable primitives", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search assets" }).fill("archimedean");
  await expect(gallery(page)).toHaveCount(13);
  await page.getByRole("searchbox", { name: "Search assets" }).fill("catalan");
  await expect(gallery(page)).toHaveCount(13);
});

for (const [id, name] of [
  ["archimedean-truncated-icosidodecahedron", "Truncated icosidodecahedron"],
  ["catalan-pentagonal-hexecontahedron", "Pentagonal hexecontahedron"],
  ["framed-solid", "Framed solid"],
] as const) {
  test(`${id} renders in the viewport`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/?asset=${id}`);
    const viewport = page.getByRole("dialog", { name }).getByTestId("viewport");
    await expectRenderer(viewport.locator("canvas"));
    await expect(viewport).toHaveAttribute("data-gpu-geometries", /^[1-9]\d*$/);
    await expect(viewport).toHaveAttribute("data-frames", /^[1-9]\d*$/);
    expect(errors).toEqual([]);
  });
}
