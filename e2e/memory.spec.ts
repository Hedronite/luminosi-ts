import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { migrate, toneMappingModes, type SceneStage } from "@hedronite/lts-scene";
import { expect, expectRenderer, test } from "./fixtures.js";

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
 * Documents of different sizes, so each open is seen in the scene list: A is four primitives in materials. The second is either a watch under two
 * screen effects, or one node of transmission glass under the same effects, so a cycle builds meshes, materials, textures and effect targets, and frees them again.
 * The glass document is built here from `v1.json`, and nothing hand-edited is committed beside the fixtures: that file's third node (a glass solid), with no parent,
 * under the effects the file already names. Glass under screen effects once left two textures behind each time its effect pipeline was replaced; this case holds that shut.
 */
const fixtures = join(import.meta.dirname, "..", "packages", "scene", "fixtures");
const FIXTURE_A = join(fixtures, "primitives-in-materials.json");
const FIXTURE_B = join(fixtures, "object-effects-ink.json");
const FIXTURE_GLASS = join(fixtures, "v1.json");

/** A scene document to open: a file on disk, or a file made in memory. */
type Source = string | { readonly name: string; readonly mimeType: string; readonly buffer: Buffer };
interface Document {
  readonly source: Source;
  readonly nodes: number;
}

/** How many nodes a scene document holds: what the scene list shows once it is opened. */
const nodesIn = (file: string): number => {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof parsed === "object" && parsed !== null && "nodes" in parsed && Array.isArray(parsed.nodes)) return parsed.nodes.length;
  throw new Error(`${file} holds no nodes`);
};

/** The glass node of `v1.json` as a document of its own: no parent, and the effects the file names kept. It fails if the file stops holding a glass node or its effects. */
const glassUnderEffects = (): Document => {
  const parsed: unknown = JSON.parse(readFileSync(FIXTURE_GLASS, "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("nodes" in parsed) || !Array.isArray(parsed.nodes) || !("effects" in parsed)) throw new Error(`${FIXTURE_GLASS} holds no nodes and effects`);
  const node: unknown = parsed.nodes[2];
  if (typeof node !== "object" || node === null || !JSON.stringify(node).includes('"glass"')) throw new Error(`${FIXTURE_GLASS} holds no glass node as its third`);
  const solo = { ...parsed, nodes: [{ ...node, parent: null }] };
  return { source: { name: "glass-under-effects.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(solo)) }, nodes: 1 };
};

/** A fixture, or a document made from one, brought to the current version and given a stage block. One that does not read fails here and not in the page. */
const staged = (from: () => Document, stage: SceneStage): Document => {
  const { source, nodes } = from();
  const text = typeof source === "string" ? readFileSync(source, "utf8") : source.buffer.toString("utf8");
  const read = migrate(JSON.parse(text));
  if (!read.ok) throw new Error(`the document to stage does not read: ${JSON.stringify(read.issues)}`);
  return { source: { name: "staged.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...read.scene, stage })) }, nodes };
};

const fixture = (file: string) => (): Document => ({ source: file, nodes: nodesIn(file) });

const shadows = { enabled: true, catcher: false } as const;
/** Every stage feature at once. */
const everything: SceneStage = {
  quality: "full",
  shadows: { enabled: true, catcher: true },
  bloom: { enabled: true, threshold: 5, gain: 0.22, radius: 0.35 },
  dof: { enabled: true, focus: 5.5, aperture: 1, focalLength: 2.5 },
  toneMapping: toneMappingModes[1],
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
async function open(page: Page, scene: Document): Promise<void> {
  await page.getByLabel("Open scene").setInputFiles(scene.source);
  await expect(page.getByRole("list", { name: "Scene" }).getByRole("listitem")).toHaveCount(scene.nodes, { timeout: STAGE_WAIT });
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

interface Round {
  readonly title: string;
  /** What each cycle opens first: A, plain unless given. */
  readonly opening?: () => Document;
  readonly build: () => Document;
}

const rounds: readonly Round[] = [
  { title: "the playground holds the same GPU memory after every cycle of open, undo, redo and remove", build: fixture(FIXTURE_B) },
  { title: "the playground holds the same GPU memory after every cycle with transmission glass under screen effects", build: glassUnderEffects },
  {
    title: "the playground holds the same GPU memory after every cycle with shadows, a catcher, bloom and depth of field",
    opening: () => staged(fixture(FIXTURE_A), everything),
    build: () => staged(fixture(FIXTURE_B), everything),
  },
  {
    title: "the playground holds the same GPU memory after every cycle with transmission glass under screen effects and every stage feature",
    opening: () => staged(fixture(FIXTURE_A), everything),
    build: () => staged(glassUnderEffects, everything),
  },
];

rounds.forEach(({ title, opening: first_, build }) => {
  test(title, async ({ page }, info) => {
    // Five cycles of builds and rebuilds on software WebGL take longer than one test's usual share of the clock, and longer still with a stage.
    test.setTimeout(300_000);
    await page.goto("/?view=playground");
    const stage = page.getByTestId("playground-viewport");
    await expectRenderer(stage.locator("canvas"));
    await expect(stage).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: STAGE_WAIT });
    const opening = (first_ ?? fixture(FIXTURE_A))();
    const closing = build();
    const a = opening.nodes;
    const b = closing.nodes;

    const readings: Memory[] = [];
    const empties: Memory[] = [];
    for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
      // eslint-disable-next-line no-await-in-loop -- the cycles run one after another: each starts from what the last one left
      await open(page, opening);
      // eslint-disable-next-line no-await-in-loop -- see above
      await open(page, closing);
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
});

// The detail view's stage is switched by its controls, not opened from a document: five rounds of every feature on, lite, off.
test("the detail view holds the same GPU memory after every round of its stage controls", async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.goto("/?asset=glass");
  const stage = page.getByRole("dialog", { name: "Glass" }).getByTestId("viewport");
  await expectRenderer(stage.locator("canvas"));
  await expect(stage).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: STAGE_WAIT });
  const quality = page.getByLabel("Quality", { exact: true });
  const box = (name: string) => page.getByRole("checkbox", { name, exact: true });

  const on: Memory[] = [];
  const off: Memory[] = [];
  for (let round = 1; round <= CYCLES; round += 1) {
    // eslint-disable-next-line no-await-in-loop -- one round after another, each from what the last one left
    let frames = await framesOf(stage);
    // eslint-disable-next-line no-await-in-loop -- see above
    await quality.selectOption("full");
    for (const name of ["Shadows", "Shadow catcher", "Bloom", "Depth of field"]) {
      // eslint-disable-next-line no-await-in-loop -- the catcher is enabled once shadows are
      await box(name).check();
    }
    // eslint-disable-next-line no-await-in-loop -- see above
    on.push(await settledMemory(stage, frames));
    // eslint-disable-next-line no-await-in-loop -- see above
    frames = await framesOf(stage);
    // eslint-disable-next-line no-await-in-loop -- see above
    await quality.selectOption("lite");
    // eslint-disable-next-line no-await-in-loop -- see above
    await settledMemory(stage, frames);
    // eslint-disable-next-line no-await-in-loop -- see above
    await quality.selectOption("full");
    for (const name of ["Shadow catcher", "Shadows", "Bloom", "Depth of field"]) {
      // eslint-disable-next-line no-await-in-loop -- the catcher goes before the shadows it needs
      await box(name).uncheck();
    }
    // eslint-disable-next-line no-await-in-loop -- see above
    frames = await framesOf(stage);
    // eslint-disable-next-line no-await-in-loop -- see above
    await quality.selectOption("off");
    // eslint-disable-next-line no-await-in-loop -- see above
    off.push(await settledMemory(stage, frames));
  }
  info.annotations.push({ type: "memory with every feature on", description: JSON.stringify(on) }, { type: "memory with no stage", description: JSON.stringify(off) });
  const [firstOn, ...restOn] = on;
  restOn.forEach((reading, index) => {
    expect(reading, `round ${String(index + 2)} with every feature on, against round 1`).toEqual(firstOn);
  });
  const [firstOff, ...restOff] = off;
  restOff.forEach((reading, index) => {
    expect(reading, `round ${String(index + 2)} with no stage, against round 1`).toEqual(firstOff);
  });
  expect(firstOn?.["data-targets"], "the stage features draw into targets of their own").toBeGreaterThan(firstOff?.["data-targets"] ?? 0);
});

// A shadow map and the transmission glass's own pass under screen effects once left a render target and two textures behind each time the
// shadows went off again. It shows only when every document on the way is drawn, and the count is read back on the plain first one.
const chains: readonly { readonly title: string; readonly steps: readonly (() => Document)[] }[] = [
  { title: "shadows", steps: [() => staged(fixture(FIXTURE_B), { quality: "full", shadows }), glassUnderEffects] },
  { title: "shadows and a catcher", steps: [() => staged(fixture(FIXTURE_B), { quality: "full", shadows: { enabled: true, catcher: true } }), glassUnderEffects] },
  { title: "every stage feature, on the glass too", steps: [() => staged(fixture(FIXTURE_B), everything), () => staged(glassUnderEffects, everything), glassUnderEffects] },
];

for (const { title, steps } of chains) {
  test(`the playground holds the same GPU memory each time round, from ${title} through transmission glass and back`, async ({ page }, info) => {
    test.setTimeout(300_000);
    await page.goto("/?view=playground");
    const stage = page.getByTestId("playground-viewport");
    await expectRenderer(stage.locator("canvas"));
    await expect(stage).toHaveAttribute("data-frames", /^[1-9]\d*$/, { timeout: STAGE_WAIT });
    const home = fixture(FIXTURE_A);

    const readings: Memory[] = [];
    for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
      let reading: Memory | undefined;
      for (const step of [...steps, home]) {
        // eslint-disable-next-line no-await-in-loop -- each document is opened over the one before, once that one has been drawn
        const frames = await framesOf(stage);
        // eslint-disable-next-line no-await-in-loop -- see above
        await open(page, step());
        // eslint-disable-next-line no-await-in-loop -- see above
        reading = await settledMemory(stage, frames, 0);
      }
      if (reading !== undefined) readings.push(reading);
    }

    info.annotations.push({ type: "memory back on the first document after each cycle", description: JSON.stringify(readings) });
    expect(readings).toHaveLength(CYCLES);
    const [first, ...rest] = readings;
    rest.forEach((reading, index) => {
      expect(reading, `cycle ${String(index + 2)} of ${String(CYCLES)} against cycle 1`).toEqual(first);
    });
  });
}
