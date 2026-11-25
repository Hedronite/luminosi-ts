// D7b in a real browser: the scene element plays a document's tracks from its own loop clock, holds the rest pose and draws no animation
// frames under reduced motion, and draws none while it is out of view. Every claim here is read from the element's own frame counter.
import { expect, test } from "@playwright/test";

const host = (page: import("@playwright/test").Page) => page.locator("lts-scene#moving");
const frames = async (page: import("@playwright/test").Page): Promise<number> => Number(await host(page).getAttribute("data-frames"));

test("the element plays its document's tracks from its own clock", async ({ page }) => {
  await page.goto("/element.html?only=moving");
  const element = host(page);
  await expect(element).toHaveAttribute("alt", "A solid rising in, once");
  // The scene builds, draws its first frame, and then moves: the counter climbs without a scroll or a pointer.
  await expect.poll(() => frames(page), { message: "the element draws frames as its track plays", timeout: 20_000 }).toBeGreaterThan(3);
  await expect(element.locator("canvas")).toHaveAttribute("data-renderer", /^(webgpu|webgl2)$/);
});

test("under reduced motion the element shows the rest pose and draws no animation frames", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/element.html?only=moving");
  // The rest pose is the one frame the element draws before anything moves, and nothing steps it after that.
  await expect.poll(() => frames(page), { message: "the rest pose is drawn", timeout: 20_000 }).toBe(1);
  await page.waitForTimeout(2_000);
  expect(await frames(page), "no animation frames under reduced motion").toBe(1);
});

test("an element out of view draws no frames, and draws again when it returns", async ({ page }) => {
  await page.goto("/element.html?only=moving");
  await expect.poll(() => frames(page), { timeout: 20_000 }).toBeGreaterThan(1);
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  // Out of view: the loop stops, and the counter holds.
  await page.waitForTimeout(1_000);
  const away = await frames(page);
  await page.waitForTimeout(2_000);
  expect(await frames(page), "no frames while out of view").toBe(away);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await expect.poll(() => frames(page), { message: "frames again once it is back", timeout: 20_000 }).toBeGreaterThan(away);
});
