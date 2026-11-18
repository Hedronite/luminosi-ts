import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";

const errorsOn = (page: Page): string[] => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
};

test("the Effects tab puts surface shaders and screen effects on one stage, on real objects", async ({ page }) => {
  const errors = errorsOn(page);
  await page.goto("/?view=effects");
  await expect(page.getByRole("heading", { name: "Effects", exact: true })).toBeVisible();
  const stage = page.getByTestId("effects-stage");
  await expect(stage).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 15000 });

  // A surface shader from the list goes onto the stage, under the screen effects already on.
  await page.getByRole("region", { name: "Surface shaders" }).getByRole("button", { name: "Toon outline" }).click();
  await expect(page.getByRole("region", { name: "Surface shaders" }).getByRole("button", { name: "Toon outline" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: /in Toon outline, under Scan sweep, Lens\.$/ })).toBeVisible();

  // On a real object, with another shader and other screen effects.
  await page.getByLabel("Subject", { exact: true }).selectOption("object:dress-watch");
  await page.getByLabel("Surface", { exact: true }).selectOption("shader:hologram");
  await page.getByRole("checkbox", { name: "Dither" }).check();
  await page.getByRole("checkbox", { name: /^Lens/ }).uncheck();
  await expect(page.getByRole("group", { name: "Your dress watch in Hologram, under Scan sweep, Dither." })).toBeVisible();
  await page.getByLabel("Ink", { exact: true }).selectOption("accent");
  // Back to the watch's own materials, then a solid in a material preset.
  await page.getByLabel("Surface", { exact: true }).selectOption("own");
  await expect(page.getByRole("group", { name: /^Your dress watch in its own materials/ })).toBeVisible();
  await page.getByLabel("Subject", { exact: true }).selectOption("solid:catalan-rhombic-triacontahedron");
  await page.getByLabel("Surface", { exact: true }).selectOption("material:metal");
  const before = Number(await stage.getAttribute("data-frames"));
  await expect.poll(async () => Number(await stage.getAttribute("data-frames"))).toBeGreaterThan(before);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  expect(errors).toEqual([]);
});

test("the adopted soap film and CRT tube render together on the stage", async ({ page }) => {
  const errors = errorsOn(page);
  await page.goto("/?view=effects");
  const stage = page.getByTestId("effects-stage");
  await expect(stage).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 15000 });
  await page.getByRole("region", { name: "Surface shaders" }).getByRole("button", { name: "Soap film" }).click();
  await page.getByRole("checkbox", { name: "CRT screen" }).check();
  await page.getByRole("checkbox", { name: "Scan sweep" }).uncheck();
  await page.getByRole("checkbox", { name: /^Lens/ }).uncheck();
  await expect(page.getByRole("group", { name: /in Soap film, under CRT screen\.$/ })).toBeVisible();
  const before = Number(await stage.getAttribute("data-frames"));
  await expect.poll(async () => Number(await stage.getAttribute("data-frames"))).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});

test("under reduced motion the stage holds a still frame and still answers the pointer", async ({ page }) => {
  const errors = errorsOn(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?view=effects");
  const stage = page.getByTestId("effects-stage");
  await expect(stage).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 15000 });
  // Let first-load renders settle, then nothing moves on its own.
  await page.waitForTimeout(1000);
  const settled = Number(await stage.getAttribute("data-frames"));
  await page.waitForTimeout(1200);
  expect(Number(await stage.getAttribute("data-frames"))).toBe(settled);
  // Pointing at it renders on demand (the lens).
  const box = await stage.boundingBox();
  if (box === null) throw new Error("no stage");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2);
  await expect.poll(async () => Number(await stage.getAttribute("data-frames"))).toBeGreaterThan(settled);
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
  ["crt", "CRT screen"],
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

test("the playground combines framed solids, objects and screen effects, and exports them", async ({ page }) => {
  const errors = errorsOn(page);
  await page.goto("/?view=playground");
  const scene = page.getByRole("list", { name: "Scene" }).getByRole("listitem");
  // The playground starts with three things; wait for the lazy view before counting.
  await expect(scene).toHaveCount(3);
  const before = 3;

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
  await expect(scene).toHaveCount(before + 3);
  await expect(scene.filter({ hasText: "Icosahedron, Dissolve" })).toHaveCount(1);
  await expect(scene.filter({ hasText: "Framed rhombic triacontahedron" })).toHaveCount(1);
  await expect(scene.filter({ hasText: "Your dress watch" })).toHaveCount(1);

  await page.getByRole("checkbox", { name: "Dither" }).check();
  await page.getByRole("checkbox", { name: "Smoke" }).check();
  await page.getByLabel("Ink", { exact: true }).selectOption("glass");
  const viewport = page.getByTestId("playground-viewport");
  await expect(viewport).toHaveAttribute("aria-label", /under Dither, Smoke\./);
  const frames = Number(await viewport.getAttribute("data-frames"));
  // With effects on, the scene renders every frame.
  await expect.poll(async () => Number(await viewport.getAttribute("data-frames")), { timeout: 15000 }).toBeGreaterThan(frames + 5);

  const json = page.getByRole("region", { name: "JSON export" }).locator("code");
  await expect(json).toContainText('"effects": [\n    "smoke",\n    "dither"\n  ]');
  await expect(json).toContainText('"object": "dress-watch"');
  const tsx = page.getByRole("region", { name: "React export" }).locator("code");
  await expect(tsx).toContainText('<FramedSolid primitive="catalan-rhombic-triacontahedron"');
  await expect(tsx).toContainText("<ScreenEffectsPass effects={stack} monochrome={palette.glass} />");
  await expect(tsx).toContainText('<PrimitiveMesh primitive="platonic-icosahedron" shader="dissolve"');
  await expect(tsx).toContainText("<WebGPUCanvas>");
  expect(errors).toEqual([]);
});

test("the playground offers a material only for the objects whose descriptor takes one, and exports it", async ({ page }) => {
  const errors = errorsOn(page);
  await page.goto("/?view=playground");
  await page.getByLabel("Add", { exact: true }).selectOption("object");
  // The glTF needs a model URL, so it is not on offer; every other object is, named by its descriptor.
  const objects = page.getByLabel("Object", { exact: true });
  await expect(objects.locator("option", { hasText: "Your dress watch" })).toHaveCount(1);
  await expect(objects.locator("option", { hasText: "glTF" })).toHaveCount(0);
  await objects.selectOption("dress-watch");
  await expect(page.getByLabel("Surface", { exact: true })).toHaveCount(0);
  await objects.selectOption("crystal-cluster");
  await page.getByLabel("Surface", { exact: true }).selectOption("metal");
  await page.getByRole("button", { name: "Add to scene" }).click();
  await expect(page.locator("code").filter({ hasText: '<LibraryObject object="crystal-cluster" params={{ material: "metal" }}' })).toBeVisible();
  expect(errors).toEqual([]);
});

test("when the descriptors fail to load, the playground and the Effects stage say the objects could not be loaded", async ({ page }) => {
  await page.route(/\/assets\/descriptors-[^/]+\.js$/, (route) => route.abort());
  await page.goto("/?view=playground");
  await page.getByLabel("Add", { exact: true }).selectOption("object");
  await expect(page.getByRole("alert").filter({ hasText: "The objects could not be loaded" })).toBeVisible();
  await page.goto("/?view=effects");
  await expect(page.getByRole("alert").filter({ hasText: "The objects could not be loaded" })).toBeVisible();
});
