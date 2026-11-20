import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { counted, effectBuilds, expect, settledBuilds, test } from "./fixtures.js";

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

// Each test below is one short page: a runner that draws in software takes most of a minute for a long one.

/** The Effects tab, drawn, with its pipeline built: the stage and what its pipeline holds. */
async function effectsStage(page: Page) {
  await page.goto("/?view=effects");
  const stage = page.getByTestId("effects-stage");
  await expect(stage).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 15000 });
  return { stage, built: await settledBuilds(stage, "data-effect-builds") };
}

test("a pause, a look and an ink leave the effect pipeline's targets alone", async ({ page }) => {
  const errors = errorsOn(page);
  const { stage, built } = await effectsStage(page);
  // Held, recolored and re-inked: new values written into the passes that are there.
  await page.getByRole("button", { name: "Pause motion" }).click();
  await expect(page.getByRole("button", { name: "Resume motion" })).toBeVisible();
  await page.getByRole("button", { name: "Resume motion" }).click();
  await page.getByLabel("Look").selectOption("hedronite");
  await expect(page.locator("html")).toHaveAttribute("data-preset", "hedronite");
  await page.getByLabel("Ink", { exact: true }).selectOption("accent");
  const frames = await counted(stage, "data-frames");
  await expect.poll(() => counted(stage, "data-frames"), { message: "a frame after the look and the ink" }).toBeGreaterThan(frames);
  await page.waitForTimeout(600);
  expect(await effectBuilds(stage), "effect builds after a pause, a look and an ink").toBe(built);
  expect(errors).toEqual([]);
});

test("an effect added to the stack, and one taken off, each build a new pipeline", async ({ page }) => {
  const errors = errorsOn(page);
  const { stage, built } = await effectsStage(page);
  await page.getByRole("checkbox", { name: "Dither" }).check();
  await expect.poll(() => effectBuilds(stage), { message: "effect builds after an effect is added", timeout: 30_000 }).toBeGreaterThan(built);
  const added = await settledBuilds(stage, "data-effect-builds");
  await page.getByRole("checkbox", { name: "Dither" }).uncheck();
  await expect.poll(() => effectBuilds(stage), { message: "effect builds after an effect is removed", timeout: 30_000 }).toBeGreaterThan(added);
  expect(errors).toEqual([]);
});

test("a forced remount builds the effect pipeline again", async ({ page }) => {
  const errors = errorsOn(page);
  const { stage, built } = await effectsStage(page);
  // The view goes away and comes back, and the stage builds its pipeline again: the count keeps what it held, and adds the new targets.
  const views = page.getByRole("navigation", { name: "Views" });
  await views.getByRole("button", { name: "Playground" }).click();
  await expect(stage).toHaveCount(0);
  await views.getByRole("button", { name: "Effects", exact: true }).click();
  await expect.poll(() => effectBuilds(page.getByTestId("effects-stage")), { message: "effect builds after a remount", timeout: 30_000 }).toBeGreaterThan(built);
  expect(errors).toEqual([]);
});

test("a screen effect's parameter edit moves it in place", async ({ page }) => {
  const errors = errorsOn(page);
  await page.goto("/?asset=dither");
  const dialog = page.getByRole("dialog", { name: "Dither" });
  const host = dialog.getByTestId("viewport");
  await expect(host).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 15000 });
  const built = await settledBuilds(host, "data-effect-builds");
  const cell = dialog.getByRole("region", { name: "Parameters", exact: true }).getByRole("spinbutton", { name: "Cell", exact: true });
  const setCell = async (value: string): Promise<void> => {
    const frames = await counted(host, "data-frames");
    await cell.fill(value);
    await expect.poll(() => counted(host, "data-frames"), { message: `a frame after Cell ${value}` }).toBeGreaterThan(frames);
    await page.waitForTimeout(500);
    expect(await effectBuilds(host), `effect builds after Cell ${value}`).toBe(built);
  };
  await setCell("9");
  await setCell("5");
  expect(errors).toEqual([]);
});

test("a new ASCII ramp, which is built into the effect, makes a new pipeline", async ({ page }) => {
  const errors = errorsOn(page);
  await page.goto("/?asset=ascii");
  const ascii = page.getByRole("dialog", { name: "ASCII" });
  const host = ascii.getByTestId("viewport");
  await expect(host).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 15000 });
  const built = await settledBuilds(host, "data-effect-builds");
  const ramp = ascii.getByRole("region", { name: "Parameters", exact: true }).getByRole("textbox", { name: "Ramp", exact: true });
  await ramp.fill(" .:#");
  await ramp.press("Enter");
  await expect.poll(() => effectBuilds(host), { message: "effect builds after a new ramp", timeout: 30_000 }).toBeGreaterThan(built);
  expect(errors).toEqual([]);
});

test("every stage publishes the renderer's memory counts, and an effects stage its effect builds", async ({ page }) => {
  await page.goto("/?view=effects");
  const stage = page.getByTestId("effects-stage");
  await expect(stage).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 15000 });
  await Promise.all(["data-geometries", "data-textures", "data-targets", "data-effect-builds"].map((attribute) => expect(stage).toHaveAttribute(attribute, /^\d+$/)));
  // The WebGPU renderer counts its render targets: the scene pass and the stack's own are there.
  await expect.poll(() => counted(stage, "data-targets"), { message: "render targets in use" }).toBeGreaterThan(0);
  await expect.poll(() => counted(stage, "data-geometries"), { message: "geometries in use" }).toBeGreaterThan(0);
  await page.goto("/?asset=metal");
  const viewport = page.getByRole("dialog", { name: "Metal" }).getByTestId("viewport");
  await Promise.all(["data-geometries", "data-textures", "data-targets"].map((attribute) => expect(viewport).toHaveAttribute(attribute, /^\d+$/)));
  await expect(viewport).not.toHaveAttribute("data-effect-builds", /.*/);
});

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
  // The document keeps its effects in the order they were added; the effect library decides the order they run in.
  await expect(json).toContainText('"effects": [ { "id": "dither" }, { "id": "smoke" } ]');
  await expect(json).toContainText('"kind": "object", "id": "dress-watch"');
  const tsx = page.getByRole("region", { name: "React export" }).locator("code");
  await expect(tsx).toContainText('<FramedSolid primitive="catalan-rhombic-triacontahedron"');
  await expect(tsx).toContainText("<ScreenEffectsPass effects={effects} palette={palette} reducedMotion={reducedMotion} monochrome={palette.glass} />");
  await expect(tsx).toContainText('<PrimitiveMesh primitive="platonic-icosahedron" shader="dissolve"');
  await expect(tsx).toContainText("<WebGPUCanvas camera=");
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
