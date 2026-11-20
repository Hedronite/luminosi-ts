import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";

// The playground's memory guard: open, undo, redo and remove, five times over, leave the GPU holding what it held after the first time.
// A leak (a removed node's geometry kept, a history that keeps old scenes built) shows as a count that climbs cycle by cycle.
// It runs in the default project (software WebGL, CI) and in the WebGPU lane (`bun run e2e:webgpu`); see playwright.config.ts.

/** How long a stage may take to draw or to settle: every wait below is on the stage's own counters, and this is only the ceiling that makes a stage that never does fail. */
const STAGE_WAIT = 20_000;

/** How many reports of the stage's counters, one after another, must read the same before the reading is called settled. */
const QUIET_REPORTS = 4;

/** How many times the whole round is run. Cycle 1 is the reading the rest are held to. */
const CYCLES = 5;

/**
 * Two documents of different sizes, so each open is seen in the scene list: A is four primitives in materials, and B is a watch
 * under two screen effects, so a cycle builds meshes, materials, textures, effect targets and frees them again.
 * (`v1.json` is not used: its glass node under the same effects leaves two textures behind each time its effect pipeline is replaced. R15 fixes
 * that leak in its own change, and the glass-plus-effects case joins this check once the fix is merged.)
 */
const fixtures = join(import.meta.dirname, "..", "packages", "scene", "fixtures");
const FIXTURE_A = join(fixtures, "primitives-in-materials.json");
const FIXTURE_B = join(fixtures, "object-effects-ink.json");

/** How many nodes a scene document holds: what the scene list shows once it is opened. */
const nodesIn = (file: string): number => {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof parsed === "object" && parsed !== null && "nodes" in parsed && Array.isArray(parsed.nodes)) return parsed.nodes.length;
  throw new Error(`${file} holds no nodes`);
};

const ATTRIBUTES = ["data-geometries", "data-textures", "data-targets"] as const;
type Memory = Readonly<Record<(typeof ATTRIBUTES)[number], number>>;

/**
 * The renderer's memory counts once the stage has drawn a frame since `frames` and has held the same three counts for the next few reports.
 * The stage writes its counters on a timer and each write sets the attribute, so the wait is counted in those writes and not in milliseconds.
 * A stage that stops reporting, or never holds still, fails after `STAGE_WAIT` with a message that says so. A reading counts only while the stage holds
 * more geometries than `above`: the scene's nodes are built a moment after the scene list shows them, and the stage with nothing built reads `above`.
 */
async function settledMemory(host: Locator, frames: number, above = -1): Promise<Memory> {
  const result = await host.evaluate(
    (element, { attributes, quiet, ceiling, after, over }) =>
      new Promise<{ readonly memory: Record<string, number>; readonly settled: boolean; readonly reports: number }>((resolve) => {
        const read = (): Record<string, number> => Object.fromEntries(attributes.map((name) => [name, Number(element.getAttribute(name))]));
        let last = "";
        let held = 0;
        let reports = 0;
        const done = (settled: boolean): void => {
          observer.disconnect();
          clearTimeout(timer);
          resolve({ memory: read(), settled, reports });
        };
        const check = (): void => {
          reports += 1;
          const reading = read();
          const drawn = Number(element.getAttribute("data-frames")) > after && (reading["data-geometries"] ?? 0) > over;
          const now = JSON.stringify(reading);
          held = drawn && now === last ? held + 1 : 0;
          last = now;
          if (held >= quiet) done(true);
        };
        const observer = new MutationObserver(check);
        const timer = setTimeout(() => {
          done(false);
        }, ceiling);
        observer.observe(element, { attributes: true, attributeFilter: [...attributes, "data-frames"] });
        check();
      }),
    { attributes: [...ATTRIBUTES], quiet: QUIET_REPORTS, ceiling: STAGE_WAIT, after: frames, over: above },
  );
  expect(result.settled, `the stage's memory counts did not settle: ${String(result.reports)} reports in ${String(STAGE_WAIT)} ms, the last ${JSON.stringify(result.memory)}`).toBe(true);
  return { "data-geometries": result.memory["data-geometries"] ?? 0, "data-textures": result.memory["data-textures"] ?? 0, "data-targets": result.memory["data-targets"] ?? 0 };
}

const framesOf = async (host: Locator): Promise<number> => Number(await host.getAttribute("data-frames"));

/** Opens a scene document from a file, as a person does with Open scene, and waits until the scene list shows what it holds. */
async function open(page: Page, file: string, things: number): Promise<void> {
  await page.getByLabel("Open scene").setInputFiles(file);
  await expect(page.getByRole("list", { name: "Scene" }).getByRole("listitem")).toHaveCount(things, { timeout: STAGE_WAIT });
}

/** Removes every node, one at a time, until the scene list is empty. */
async function removeAll(page: Page): Promise<void> {
  const items = page.getByRole("list", { name: "Scene" }).getByRole("listitem");
  const remove = page.getByRole("list", { name: "Scene" }).getByRole("button", { name: /^Remove / });
  for (let left = await items.count(); left > 0; left -= 1) {
    // eslint-disable-next-line no-await-in-loop -- one removal at a time: each is a step the next one's list is read after
    await remove.first().click();
    // eslint-disable-next-line no-await-in-loop -- the list is the page's own state: the next click waits for this one's effect
    await expect(items).toHaveCount(left - 1);
  }
}

test("the playground holds the same GPU memory after every cycle of open, undo, redo and remove", async ({ page }, info) => {
  // Five cycles of builds and rebuilds on software WebGL take longer than one test's usual share of the clock.
  test.slow();
  await page.goto("/?view=playground");
  const stage = page.getByTestId("playground-viewport");
  await expect(stage).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: STAGE_WAIT });
  const a = nodesIn(FIXTURE_A);
  const b = nodesIn(FIXTURE_B);

  const readings: Memory[] = [];
  const empties: Memory[] = [];
  for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
    // eslint-disable-next-line no-await-in-loop -- the cycles run one after another: each starts from what the last one left
    await open(page, FIXTURE_A, a);
    // eslint-disable-next-line no-await-in-loop -- see above
    await open(page, FIXTURE_B, b);
    // eslint-disable-next-line no-await-in-loop -- see above
    await page.getByRole("button", { name: "Undo" }).click();
    // eslint-disable-next-line no-await-in-loop -- see above
    await expect(page.getByRole("list", { name: "Scene" }).getByRole("listitem")).toHaveCount(a);
    // eslint-disable-next-line no-await-in-loop -- see above
    await page.getByRole("button", { name: "Redo" }).click();
    // eslint-disable-next-line no-await-in-loop -- see above
    await expect(page.getByRole("list", { name: "Scene" }).getByRole("listitem")).toHaveCount(b);
    // eslint-disable-next-line no-await-in-loop -- see above
    await removeAll(page);
    // The empty scene, after the same frame: what the stage holds with nothing of the document built.
    // eslint-disable-next-line no-await-in-loop -- see above
    const empty = await settledMemory(stage, await framesOf(stage));
    empties.push(empty);
    // Each removal is a step of its own, so one undo brings back one node: undo them all, which rebuilds every node that was removed.
    for (let back = 1; back <= b; back += 1) {
      // eslint-disable-next-line no-await-in-loop -- one undo at a time, each read from the scene list before the next
      await page.getByRole("button", { name: "Undo" }).click();
      // eslint-disable-next-line no-await-in-loop -- see above
      await expect(page.getByRole("list", { name: "Scene" }).getByRole("listitem")).toHaveCount(back);
    }
    // After a frame: the stage draws once more, and the counts are read once they hold still.
    // eslint-disable-next-line no-await-in-loop -- see above
    const frames = await framesOf(stage);
    // eslint-disable-next-line no-await-in-loop -- see above
    readings.push(await settledMemory(stage, frames, empty["data-geometries"]));
  }

  // The reading after each cycle goes into the report, so a failure and a pass both show what the GPU held.
  info.annotations.push({ type: "memory after each cycle", description: JSON.stringify(readings) }, { type: "memory empty scene after each cycle", description: JSON.stringify(empties) });
  // Cycle 1 is the empty-scene baseline plus what the fixtures leave behind for good; every later cycle reads the same.
  const [first, ...rest] = readings;
  expect(first, "the first cycle's reading").toBeDefined();
  rest.forEach((reading, index) => {
    expect(reading, `cycle ${String(index + 2)} of ${String(CYCLES)} against cycle 1`).toEqual(first);
  });
  // And the empty scene between them reads the same every time: nothing of a removed document stays on the GPU.
  const [firstEmpty, ...restEmpty] = empties;
  restEmpty.forEach((reading, index) => {
    expect(reading, `the empty scene after cycle ${String(index + 2)} of ${String(CYCLES)} against cycle 1`).toEqual(firstEmpty);
  });
  expect(first?.["data-geometries"], "the scene holds geometries after the cycle").toBeGreaterThan(0);
});
