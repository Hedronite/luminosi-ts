import { expect, expectRenderer, test } from "./fixtures.js";

// The helper the viewport specs share: what it does with the canvases it is there to catch. The pages are built here, no catalog and no GPU.
const canvas = (attributes: string): string => `<main><canvas ${attributes} width="8" height="8"></canvas></main>`;
const SHORT = 1_000;

test("a canvas with no data-renderer fails, with the lane's list and with an explicit one", async ({ page }) => {
  await page.setContent(canvas(""));
  await expect(expectRenderer(page.locator("canvas"), undefined, SHORT)).rejects.toThrow(/data-renderer/);
  await expect(expectRenderer(page.locator("canvas"), ["webgpu"], SHORT)).rejects.toThrow(/data-renderer/);
});

test("a canvas that says webgl2 passes where a fallback is allowed (this run is not the WebGPU lane) and fails an explicit webgpu-only list", async ({ page }) => {
  await page.setContent(canvas('data-renderer="webgl2"'));
  expect(await expectRenderer(page.locator("canvas"))).toBe("webgl2");
  await expect(expectRenderer(page.locator("canvas"), ["webgpu"], SHORT)).rejects.toThrow(/data-renderer/);
});

test("a canvas that says webgpu passes both lists, and a backend that is neither fails", async ({ page }) => {
  await page.setContent(canvas('data-renderer="webgpu"'));
  expect(await expectRenderer(page.locator("canvas"))).toBe("webgpu");
  expect(await expectRenderer(page.locator("canvas"), ["webgpu"])).toBe("webgpu");
  await page.setContent(canvas('data-renderer="webgl"'));
  await expect(expectRenderer(page.locator("canvas"), undefined, SHORT)).rejects.toThrow(/data-renderer/);
});

test("an attribute that arrives late is waited for", async ({ page }) => {
  await page.setContent(canvas(""));
  await page.evaluate(() => {
    setTimeout(() => {
      document.querySelector("canvas")?.setAttribute("data-renderer", "webgpu");
    }, 600);
  });
  expect(await expectRenderer(page.locator("canvas"))).toBe("webgpu");
});
