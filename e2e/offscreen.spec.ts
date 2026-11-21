import type { Locator, Page } from "@playwright/test";
import { expect, expectRenderer, test } from "./fixtures.js";

const frames = async (stage: Locator): Promise<number> => Number(await stage.getAttribute("data-frames"));

/** The stage's frame count, once it has held still for `quiet` ms (the counter is written every 150 ms, and a last frame may land after the stage leaves). */
async function settled(stage: Locator, quiet = 700): Promise<number> {
  const before = await frames(stage);
  await stage.page().waitForTimeout(quiet);
  const after = await frames(stage);
  return after === before ? after : settled(stage, quiet);
}

const hideTab = (page: Page, hidden: boolean): Promise<void> =>
  page.evaluate((hide) => {
    // A headless page is always visible: say it is hidden the way the browser would.
    if (hide) Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    else Reflect.deleteProperty(document, "visibilityState");
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);

test("an animated stage draws no frames while it is scrolled out of view, and resumes when it returns", async ({ page }) => {
  await page.goto("/?view=effects");
  const stage = page.getByTestId("effects-stage");
  await expect(stage).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 15000 });
  const on = await frames(stage);
  await expect.poll(() => frames(stage)).toBeGreaterThan(on);

  // Room to scroll the stage clear of the viewport.
  await page.addStyleTag({ content: "body::after { content: ''; display: block; height: 3000px; }" });
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await expect(stage).not.toBeInViewport();
  const away = await settled(stage);
  await page.waitForTimeout(1500);
  expect(await frames(stage)).toBe(away);

  await stage.scrollIntoViewIfNeeded();
  await expect(stage).toBeInViewport();
  await expect.poll(() => frames(stage)).toBeGreaterThan(away);
});

test("an animated stage draws no frames in a hidden tab, and resumes when the tab returns", async ({ page }) => {
  await page.goto("/?view=effects");
  const stage = page.getByTestId("effects-stage");
  await expect(stage).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 15000 });
  await hideTab(page, true);
  const hidden = await settled(stage);
  await page.waitForTimeout(1500);
  expect(await frames(stage)).toBe(hidden);

  await hideTab(page, false);
  await expect.poll(() => frames(stage)).toBeGreaterThan(hidden);
});

test("a shader's detail view draws no frames while its tab is hidden", async ({ page }) => {
  await page.goto("/?asset=dissolve");
  const viewport = page.getByRole("dialog", { name: "Dissolve" }).getByTestId("viewport");
  await expectRenderer(viewport.locator("canvas"));
  await expect(viewport).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: 15000 });
  await hideTab(page, true);
  const hidden = await settled(viewport);
  await page.waitForTimeout(1500);
  expect(await frames(viewport)).toBe(hidden);
  await hideTab(page, false);
  await expect.poll(() => frames(viewport)).toBeGreaterThan(hidden);
});
