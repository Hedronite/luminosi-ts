import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";

/**
 * The WebGPU lane: `bun run e2e:webgpu` (see STACK.md). The default `e2e` run and CI draw with software
 * WebGL and never load this file; here Chromium has WebGPU on, through Metal, and every 3D stage that
 * runs on three's WebGPU renderer must say it is drawing on WebGPU, not on the WebGL 2 fallback.
 */

/**
 * The adapter report the page can get, as a script (the DOM types in this repo do not know `navigator.gpu`). Without a real adapter
 * the renderer would fall back to WebGL 2 and the stages below would fail for a reason this names.
 */
const adapterScript = `(async () => {
  if (!isSecureContext) return "the page is not a secure context";
  if (navigator.gpu === undefined) return "navigator.gpu is missing";
  const found = await navigator.gpu.requestAdapter();
  if (found === null) return "requestAdapter() returned null";
  const info = found.info ?? {};
  const named = [info.vendor, info.architecture, info.device, info.description].map(String).join(" ");
  // The flag alone gives a software adapter (SwiftShader, LLVM): it is no GPU, and it may or may not call itself a fallback.
  if (found.isFallbackAdapter === true || info.isFallbackAdapter === true || /swiftshader|llvm/i.test(named)) return "a software adapter (" + named + ")";
  return "ok " + String(info.vendor) + " " + String(info.architecture);
})()`;

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  expect(await page.evaluate(adapterScript), "a real WebGPU adapter").toMatch(/^ok /);
});

/** How many distinct colours (4 bits a channel) the stage's canvas shows: a cleared or blank canvas shows one or two. */
const coloursOn = async (page: Page, stage: Locator): Promise<number> => {
  const png = await stage.locator("canvas").screenshot();
  return page.evaluate(async (base64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
    const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = surface.getContext("2d");
    if (context === null) return 0;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const seen = new Set<number>();
    for (let at = 0; at < data.length; at += 4) seen.add(((data[at] ?? 0) >> 4) * 256 + ((data[at + 1] ?? 0) >> 4) * 16 + ((data[at + 2] ?? 0) >> 4));
    return seen.size;
  }, png.toString("base64"));
};

/**
 * The stage draws on WebGPU: it says so, it has drawn a frame, and the canvas holds a picture. A stage that animates
 * has also kept drawing; the playground draws on demand, so its frame counter holds still until something changes.
 */
const expectDrawnOnWebGPU = async (page: Page, stage: Locator, animated: boolean): Promise<void> => {
  await expect(stage).toHaveAttribute("data-backend", "webgpu", { timeout: 20_000 });
  await expect(stage).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 20_000 });
  if (animated) {
    const before = Number(await stage.getAttribute("data-frames"));
    await expect.poll(async () => Number(await stage.getAttribute("data-frames"))).toBeGreaterThan(before);
  }
  expect(await coloursOn(page, stage), "distinct colours on the canvas").toBeGreaterThan(8);
  // Every element that carries a frame counter also carries the backend, on this page.
  expect(await page.locator("[data-frames]:not([data-backend])").count()).toBe(0);
};

test("the shader viewport draws on WebGPU", async ({ page }) => {
  await page.goto("/?asset=hologram");
  await expectDrawnOnWebGPU(page, page.getByRole("dialog", { name: "Hologram" }).getByTestId("viewport"), true);
});

test("the Effects stage draws on WebGPU", async ({ page }) => {
  await page.goto("/?view=effects");
  await expectDrawnOnWebGPU(page, page.getByTestId("effects-stage"), true);
});

test("the playground draws on WebGPU", async ({ page }) => {
  await page.goto("/?view=playground");
  await expectDrawnOnWebGPU(page, page.getByTestId("playground-viewport"), false);
});
