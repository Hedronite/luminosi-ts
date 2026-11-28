import { readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, expectRenderer, test } from "./fixtures.js";

const STAGE_WAIT = 20_000;
const FIXTURE = join(import.meta.dirname, "..", "packages", "scene", "fixtures", "finish-glass.json");

test("the glass detail view finish picker is reachable and passes axe", async ({ page }) => {
  await page.goto("/?asset=glass");
  await expect(page.getByRole("dialog", { name: "Glass" })).toBeVisible({ timeout: STAGE_WAIT });
  const viewport = page.getByRole("dialog", { name: "Glass" }).getByTestId("viewport");
  await expectRenderer(viewport.locator("canvas"));
  await expect(page.getByLabel("Finish")).toBeVisible();
  const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});

test("a finish strength change on the playground stays flat on data-builds", async ({ page }) => {
  await page.goto("/?view=playground");
  const host = page.getByTestId("playground-viewport");
  await expectRenderer(host.locator("canvas"));
  await page.getByLabel("Open scene").setInputFiles(FIXTURE);
  await expect(page.getByText(/Opened finish-glass/)).toBeVisible({ timeout: STAGE_WAIT });
  await page.getByRole("button", { name: /Edit transform of/i }).first().click();
  await expect(host).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: STAGE_WAIT });
  const before = Number(await host.getAttribute("data-builds"));
  await page.getByLabel("Finish").selectOption("frost");
  await expect(host).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: STAGE_WAIT });
  const afterPick = Number(await host.getAttribute("data-builds"));
  const finish = page.getByLabel("Strength");
  await finish.focus();
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press("ArrowRight");
  }
  await expect(host).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: STAGE_WAIT });
  const afterStrength = Number(await host.getAttribute("data-builds"));
  expect(afterPick, "choosing a finish may rebuild once").toBeGreaterThanOrEqual(before);
  expect(afterStrength, "strength moves in place").toBe(afterPick);
});

test("R8 on the catalog playground uses one bundled renderer", async ({ page }) => {
  test.setTimeout(180_000);
  const forceWebGL = test.info().project.name !== "webgpu";
  await page.goto(`/?view=playground&r8=1`);
  await expect(page.getByTestId("playground-viewport").locator("canvas")).toBeVisible({ timeout: STAGE_WAIT });
  await page.waitForFunction(() => typeof (window as { __runR8?: unknown }).__runR8 === "function", { timeout: STAGE_WAIT });
  const report = await page.evaluate(async (gl) => {
    const run = (window as unknown as { __runR8?: (force: boolean) => Promise<Record<string, unknown>> }).__runR8;
    if (run === undefined) throw new Error("r8 probe not installed");
    return run(gl);
  }, forceWebGL);
  test.info().annotations.push({ type: "r8", description: JSON.stringify(report) });
  expect((report as { harnessUnshaded?: boolean }).harnessUnshaded).not.toBe(true);
  expect((report as { allFinishesIdentical?: boolean }).allFinishesIdentical).not.toBe(true);
  expect((report as { r8: { pass: boolean } }).r8.pass).toBe(true);
});