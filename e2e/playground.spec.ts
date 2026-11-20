import AxeBuilder from "@axe-core/playwright";
import type { Locator } from "@playwright/test";
import { builds, expect, test } from "./fixtures.js";

/** How long a stage may take to draw: every wait below is on the stage's own counters, and this is only the ceiling that makes a stage that never draws fail. */
const STAGE_WAIT = 20_000;

/** How many reports of the stage's counters, one after another, must hold the same build count before it is called settled. */
const QUIET_REPORTS = 4;

/**
 * A stage's `data-builds` once it has settled: positive, and the same in each of its next few reports. The stage writes its counters on a timer
 * of its own, and each write sets the attribute, so the wait is counted in those writes and not in milliseconds: a slow machine takes longer to
 * reach them and does not read the count early. A stage that stops reporting, or never settles, fails after `STAGE_WAIT` with a message that says so.
 */
async function settledBuilds(host: Locator): Promise<number> {
  const result = await host.evaluate(
    (element, { quiet, ceiling }) =>
      new Promise<{ readonly builds: number; readonly settled: boolean; readonly reports: number }>((resolve) => {
        let last = -1;
        let held = 0;
        let reports = 0;
        const done = (settled: boolean): void => {
          observer.disconnect();
          clearTimeout(timer);
          resolve({ builds: last, settled, reports });
        };
        const observer = new MutationObserver(() => {
          reports += 1;
          const now = Number(element.getAttribute("data-builds"));
          held = now > 0 && now === last ? held + 1 : 0;
          last = now;
          if (held >= quiet) done(true);
        });
        const timer = setTimeout(() => {
          done(false);
        }, ceiling);
        observer.observe(element, { attributes: true, attributeFilter: ["data-builds"] });
      }),
    { quiet: QUIET_REPORTS, ceiling: STAGE_WAIT },
  );
  expect(result.settled, `the stage's build count did not settle: ${String(result.reports)} reports in ${String(STAGE_WAIT)} ms, the last of ${String(result.builds)}`).toBe(true);
  return result.builds;
}

test("the playground composes primitives and exports the scene", async ({ page }) => {
  await page.goto("/?view=playground");
  await expect(page.getByRole("heading", { name: "Playground" })).toBeVisible();
  const scene = page.getByRole("list", { name: "Scene" }).getByRole("listitem");
  // The count is read once the list has drawn its first item, so a slow machine does not read it empty.
  await expect(scene.first()).toBeVisible();
  const before = await scene.count();
  const viewport = page.getByTestId("playground-viewport");
  await expect(viewport).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: STAGE_WAIT });
  const built = await settledBuilds(viewport);

  await page.getByLabel("Primitive", { exact: true }).selectOption("hexagonal-bipyramid");
  await page.getByLabel("Surface", { exact: true }).selectOption("glass");
  await page.getByRole("button", { name: "Add to scene" }).click();
  await expect(scene).toHaveCount(before + 1);

  // The counter's positive control in the playground: an added node is a new build.
  await expect.poll(() => builds(viewport), { message: "builds after an add", timeout: STAGE_WAIT }).toBeGreaterThan(built);
  await expect(page.getByRole("region", { name: "JSON export" }).locator("code")).toContainText('"kind": "primitive", "id": "hexagonal-bipyramid"');
  await expect(page.getByRole("region", { name: "React export" }).locator("code")).toContainText('<PrimitiveMesh primitive="hexagonal-bipyramid" material="glass"');
  await expect(page.getByRole("region", { name: "Vanilla export" }).locator("code")).toContainText('createPolyhedronGeometry(primitive("hexagonal-bipyramid")');
  await expect(page.getByTestId("playground-viewport")).toHaveAttribute("data-frames", /^[1-9]\d*$/);

  await page.getByRole("button", { name: "Remove Hexagonal bipyramid, Glass" }).click();
  await expect(scene).toHaveCount(before);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});

test("the playground lines up every material on one shape", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?view=playground");
  const lineup = page.getByTestId("material-lineup");
  await lineup.scrollIntoViewIfNeeded();
  await expect(page.getByRole("list", { name: "Materials in the lineup" }).getByRole("listitem")).toHaveCount(13);
  // Thirteen materials, transmission among them, compile slowly under software rendering in CI.
  await expect(lineup).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: STAGE_WAIT });
  // One shared shape: a single geometry however many materials.
  await expect(lineup).toHaveAttribute("data-gpu-geometries", "1");
  await page.getByLabel("Shape", { exact: true }).selectOption("platonic-icosahedron");
  await expect(page.getByRole("group", { name: "13 materials on the Icosahedron shape, in a grid." })).toBeVisible();
  expect(errors).toEqual([]);
});
