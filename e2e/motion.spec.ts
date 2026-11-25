// D7b in a real browser: the scene element and the catalog stage play a document's tracks from their own loop clock, hold the
// rest pose and draw no animation frames under reduced motion, and draw none while they are out of view. Every claim here is
// read from the stage's own frame counter or from its own picture, and the motion itself is data: the documents below carry it.
import type { Page } from "@playwright/test";
import { expect, expectRenderer, test } from "./fixtures.js";

/** How long a stage may take to draw: every wait below is on the stage's own counter, and this is only the ceiling. */
const STAGE_WAIT = 20_000;

/** A document whose motion is data: one solid that spins with the scroll and rises once on the clock. */
const turning = {
  format: "lts-scene",
  version: 2,
  look: "neutral",
  seed: 0,
  nodes: [{ id: "turning", parent: null, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], asset: { kind: "primitive", id: "platonic-cube" }, surface: { material: "metal" } }],
  lights: { rig: "studio", intensity: 1 },
  environment: { kind: "studio" },
  camera: { position: [0, 1.6, 4.4], target: [0, 0, 0], fov: 40 },
  effects: [],
  ink: "look",
  tracks: [
    { id: "spin", target: "node.turning.rotation", keyframes: [{ time: 0, value: [0, 0, 0], easing: "linear" }, { time: 4, value: [0, 6.2832, 0], easing: "linear" }], driver: "time", trigger: "load" },
    { id: "bob", target: "node.turning.position", keyframes: [{ time: 0, value: [0, 0, 0], easing: "linear" }, { time: 1, value: [0, 0.24, 0], easing: "linear" }, { time: 2, value: [0, 0, 0] }], driver: "time", trigger: "load" },
  ],
  clips: [{ id: "turn", tracks: ["spin", "bob"], easing: "linear" }],
  rest: { "node.turning.rotation": [0, 0, 0], "node.turning.position": [0, 0, 0] },
};

/** The document above as the playground's Open scene input takes it: a scene file of its own, so nothing here imports a built package. */
const turningFile = (): { readonly name: string; readonly mimeType: string; readonly buffer: Buffer } => ({
  name: "turning.lts-scene.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify(turning), "utf8"),
});

/**
 * A stage's frame count once it has held still for `holds` samples, `quiet` ms apart: the counter is written on a timer,
 * and a stage that leaves the viewport draws its last frame after it leaves, so a hold is what says the loop stopped.
 */
async function settledFrames(page: Page, read: (page: Page) => Promise<number>, quiet = 500, holds = 3): Promise<number> {
  const sample = async (last: number, held: number): Promise<number> => {
    if (held >= holds) return last;
    await page.waitForTimeout(quiet);
    const now = await read(page);
    return sample(now, now === last ? held + 1 : 0);
  };
  return sample(await read(page), 0);
}

const host = (page: Page) => page.locator("lts-scene#moving");
const elementFrames = async (page: Page): Promise<number> => Number(await host(page).getAttribute("data-frames"));

/** The catalog stage: the playground's viewport, where the `<Scene>` adapter plays the opened document. */
const viewport = (page: Page) => page.getByTestId("playground-viewport");
const stageFrames = async (page: Page): Promise<number> => Number(await viewport(page).getAttribute("data-frames"));
/** Opens the catalog on the playground and hands it `turning` as a scene file, so the stage plays a document that carries tracks. */
const atTurning = async (page: Page): Promise<void> => {
  await page.goto("/?view=playground");
  await page.getByLabel("Open scene").setInputFiles(turningFile());
  await expect(page.getByRole("list", { name: "Scene" }).getByRole("listitem")).toHaveCount(1);
};

test("the element plays its document's tracks from its own clock", async ({ page }) => {
  await page.goto("/element.html?only=moving");
  const element = host(page);
  await expect(element).toHaveAttribute("alt", "A solid rising in, once");
  // The scene builds, draws its first frame, and then moves: the counter climbs without a scroll or a pointer.
  await expect.poll(() => elementFrames(page), { message: "the element draws frames as its track plays", timeout: STAGE_WAIT }).toBeGreaterThan(3);
  await expect(element.locator("canvas")).toHaveAttribute("data-renderer", /^(webgpu|webgl2)$/);
});

test("under reduced motion the element shows the rest pose and draws no animation frames", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/element.html?only=moving");
  // The rest pose is the one frame the element draws before anything moves, and nothing steps it after that.
  await expect.poll(() => elementFrames(page), { message: "the rest pose is drawn", timeout: STAGE_WAIT }).toBe(1);
  await page.waitForTimeout(2_000);
  expect(await elementFrames(page), "no animation frames under reduced motion").toBe(1);
});

test("an element out of view draws no frames, and draws again when it returns", async ({ page }) => {
  await page.goto("/element.html?only=moving");
  const element = host(page);
  await expect(element).toHaveAttribute("data-state", "ready", { timeout: STAGE_WAIT });
  await expect.poll(() => elementFrames(page), { message: "the element draws frames as its track plays", timeout: STAGE_WAIT }).toBeGreaterThan(3);
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  // Out of view: the loop stops once the last frame of the transition has drawn, and then the counter holds.
  const away = await settledFrames(page, elementFrames);
  await page.waitForTimeout(1_500);
  expect(await elementFrames(page), "no frames while out of view").toBe(away);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await expect.poll(() => elementFrames(page), { message: "frames again once it is back", timeout: STAGE_WAIT }).toBeGreaterThan(away);
});

test("a hover track plays on the element while the pointer is over it, and rests when it leaves", async ({ page }) => {
  await page.goto("/element.html?only=hovering");
  const element = page.locator("lts-scene#hovering");
  await expect(element).toHaveAttribute("data-state", "ready", { timeout: STAGE_WAIT });
  const canvas = element.locator("canvas");
  await expectRenderer(canvas);
  await page.waitForTimeout(400);
  const rest = await canvas.screenshot();
  // The pointer arrives: the document's hover track starts, lifts the solid and holds it there.
  await element.hover();
  await page.waitForTimeout(1_200);
  const lifted = await canvas.screenshot();
  expect(lifted.equals(rest), "the hover track moved what the element draws").toBe(false);
  // The pointer leaves: the track is back at its rest pose, and the picture is the one it started with.
  await page.mouse.move(4, 4);
  await page.waitForTimeout(1_200);
  const settled = await canvas.screenshot();
  expect(settled.equals(rest), "the rest pose came back when the pointer left").toBe(true);
});

test("the catalog stage plays a document's tracks from its own loop", async ({ page }) => {
  await atTurning(page);
  const view = viewport(page);
  await expectRenderer(view.locator("canvas"));
  await expect(view).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: STAGE_WAIT });
  // The stage steps the document's own tracks and draws as they move: the counter climbs with nothing editing it.
  await expect.poll(() => stageFrames(page), { message: "the catalog stage draws frames as its tracks play", timeout: STAGE_WAIT }).toBeGreaterThan(3);
  // The motion is the document's data: a spin on the rotation and a bob on the position.
  const json = (await page.getByRole("region", { name: "JSON export" }).locator("code").textContent()) ?? "";
  expect(json).toContain('"id": "spin"');
  expect(json).toContain('"id": "bob"');
  expect(json).toContain('"target": "node.turning.rotation"');
  expect(json).toContain('"target": "node.turning.position"');
});

test("under reduced motion the catalog stage shows the rest pose and draws no animation frames", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await atTurning(page);
  const view = viewport(page);
  await expectRenderer(view.locator("canvas"));
  await expect(view).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: STAGE_WAIT });
  // The rest pose is drawn; nothing steps the document's tracks after that, so the counter holds.
  await page.waitForTimeout(1_500);
  const held = await stageFrames(page);
  await page.waitForTimeout(1_500);
  expect(await stageFrames(page), "no animation frames under reduced motion").toBe(held);
});

test("the catalog stage draws no frames out of view, and draws again when it returns", async ({ page }) => {
  await atTurning(page);
  const view = viewport(page);
  await expectRenderer(view.locator("canvas"));
  await expect.poll(() => stageFrames(page), { message: "the catalog stage draws frames as its tracks play", timeout: STAGE_WAIT }).toBeGreaterThan(3);
  // Room to scroll the stage clear of the viewport.
  await page.addStyleTag({ content: "body::after { content: ''; display: block; height: 4000px; }" });
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await expect(view).not.toBeInViewport();
  const away = await settledFrames(page, stageFrames);
  await page.waitForTimeout(2_000);
  expect(await stageFrames(page), "no frames while out of view").toBe(away);
  await view.scrollIntoViewIfNeeded();
  await expect(view).toBeInViewport();
  await expect.poll(() => stageFrames(page), { message: "frames again once it is back", timeout: STAGE_WAIT }).toBeGreaterThan(away);
});
