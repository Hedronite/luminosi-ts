import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";

// A change of look is a write to colors and uniforms: nothing on the GPU is rebuilt. Each stage below holds the same
// geometries and the same shader programs across three looks, keeps drawing, and shows a different picture.

const number = async (host: Locator, attribute: string): Promise<number> => Number(await host.getAttribute(attribute));

/** The picture, as bytes: held still first, so a difference is the look and nothing else. */
const picture = (host: Locator): Promise<Buffer> => host.locator("canvas").screenshot();

/** Waits until the stage has built everything it will (the geometry count has held for two samples). */
async function settled(host: Locator): Promise<void> {
  let last = -1;
  let steady = 0;
  await expect
    .poll(
      async () => {
        await host.page().waitForTimeout(500);
        const now = await number(host, "data-gpu-geometries");
        steady = now === last && now > 0 ? steady + 1 : 0;
        last = now;
        return steady;
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(2);
}

/** Switches the look through each of `looks` in turn, and checks the GPU holds the same geometries and programs, and draws a new picture, after every one. */
async function expectLooksInPlace(page: Page, host: Locator, looks: readonly string[]): Promise<void> {
  await expect(host).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 15_000 });
  await settled(host);
  // An animated stage is held, so only the look can change the picture.
  const pause = page.getByRole("button", { name: "Pause motion" });
  if (await pause.isVisible()) {
    await pause.click();
    await expect(page.getByRole("button", { name: "Resume motion" })).toBeVisible();
    await page.waitForTimeout(1500);
  }
  const geometries = await number(host, "data-gpu-geometries");
  const programs = await number(host, "data-programs");
  expect(geometries).toBeGreaterThan(0);
  expect(programs).toBeGreaterThan(0);
  await looks.reduce<Promise<Buffer>>(async (before, look) => {
    const was = await before;
    const frames = await number(host, "data-frames");
    await page.getByLabel("Look").selectOption(look);
    await expect(page.locator("html")).toHaveAttribute("data-preset", look);
    await expect.poll(async () => number(host, "data-frames"), { message: `a frame after ${look}` }).toBeGreaterThan(frames);
    await page.waitForTimeout(600);
    expect(await number(host, "data-gpu-geometries"), `geometries after ${look}`).toBe(geometries);
    expect(await number(host, "data-programs"), `programs after ${look}`).toBe(programs);
    const now = await picture(host);
    expect(now.equals(was), `the picture after ${look}`).toBe(false);
    return now;
  }, picture(host));
}

const looks = ["hedronite", "tokyo-night", "hedron-light"] as const;

test("the playground keeps its geometry and programs across looks: solids, the watch, a surface shader and the print effects", async ({ page }) => {
  await page.goto("/?view=playground");
  const scene = page.getByRole("list", { name: "Scene" }).getByRole("listitem");
  await expect(scene).toHaveCount(3);
  await page.getByLabel("Add", { exact: true }).selectOption("framed");
  await page.getByLabel("Primitive", { exact: true }).selectOption("catalan-rhombic-triacontahedron");
  await page.getByRole("button", { name: "Add to scene" }).click();
  await page.getByLabel("Add", { exact: true }).selectOption("object");
  await page.getByLabel("Object", { exact: true }).selectOption("dress-watch");
  await page.getByRole("button", { name: "Add to scene" }).click();
  await page.getByLabel("Add", { exact: true }).selectOption("primitive");
  await page.getByLabel("Primitive", { exact: true }).selectOption("platonic-icosahedron");
  await page.getByLabel("Surface", { exact: true }).selectOption("shader:dissolve");
  await page.getByRole("button", { name: "Add to scene" }).click();
  await expect(scene).toHaveCount(6);
  await page.getByRole("checkbox", { name: "Dither" }).check();
  await expectLooksInPlace(page, page.getByTestId("playground-viewport"), looks);
});

test("a surface shader's detail view recolors in place", async ({ page }) => {
  await page.goto("/?asset=hologram");
  await expectLooksInPlace(page, page.getByRole("dialog", { name: "Hologram" }).getByTestId("viewport"), looks);
});

test("a material's detail view recolors in place", async ({ page }) => {
  await page.goto("/?asset=metal");
  await expectLooksInPlace(page, page.getByRole("dialog", { name: "Metal" }).getByTestId("viewport"), looks);
});

test("the Effects stage recolors its subject and prints in place", async ({ page }) => {
  await page.goto("/?view=effects");
  await expectLooksInPlace(page, page.getByTestId("effects-stage"), looks);
});
