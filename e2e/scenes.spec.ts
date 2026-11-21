// The round trip of a scene document (see STACK.md, "Scene document" and "Still frames"): each fixture of packages/scene/fixtures is drawn
// by the still-frame rig's scene mode twice, through `createScene` (`via=doc`) and through the vanilla module emitted for it (`via=code`).
// Two projects run this file (playwright.config.ts): `scenes` (bun run e2e:scenes), strict, on the real GPU, never in CI, and `scenes-loose`
// (bun run e2e:scenes:loose), coarse, on software WebGL, which is what CI runs in the golden job. Neither is in the default run.
//   strict: the doc frame, the code frame and the scene golden (e2e/scenes/<fixture>.png) are the same picture, to the pixel; a planted
//           module (a node moved, an effect dropped, a parameter changed) is not; and after the scene is freed, and after five more
//           builds and frees, the renderer holds what a renderer that drew an empty scene holds, plus the library's fixed leftovers.
//   loose:  the doc frame against the golden with the golden check's metrics and margin (e2e/golden/metrics.ts), and the golden check's four plants.
// LTS_SCENES_UPDATE=1 writes the goldens (strict project only) instead of asserting them: `bun run scenes`.
// GOLDEN_MEASURE=1 asserts no bar and only writes the distances (<report>/<mode>/scene-<fixture>.json), for setting them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectRenderer } from "./fixtures.js";
import { decodePng, type Picture } from "../tools/stills/src/png.js";
import { plant, plants } from "./golden/plants.js";
import { looseDistance, looseRatio, MARGIN, strictDistance, strictFails } from "./golden/metrics.js";
import { fixture, goldenPath, plantPath } from "./scenes/emitted.js";
import { leftoverTextures } from "./scenes/memory.js";
import type { Memory } from "./scenes/window.js";
import { roundTrip, type Fixture } from "./scenes/fixtures.js";
import { planted, plantNames } from "./scenes/plants.js";

const updating = process.env["LTS_SCENES_UPDATE"] === "1";
const measuring = process.env["GOLDEN_MEASURE"] === "1";
const report = resolve(process.env["GOLDEN_REPORT"] ?? join("test-results", "golden"));

/** Loads the rig's scene mode for one fixture and waits for its last frame. Anything the page reports as an error fails the test. */
async function draw(
  page: Page,
  name: Fixture,
  via: "doc" | "code",
  renderers: readonly string[],
  plantName?: string,
): Promise<Picture> {
  const problems: string[] = [];
  const onConsole = (message: { type(): string; text(): string }): void => {
    if (message.type() === "error") problems.push(message.text());
  };
  const onError = (error: Error): void => {
    problems.push(error.message);
  };
  page.on("console", onConsole);
  page.on("pageerror", onError);
  const query = `scene=${encodeURIComponent(name)}&via=${via}${plantName === undefined ? "" : `&plant=${encodeURIComponent(plantName)}`}`;
  await page.goto(`/still.html?${query}`);
  const stage = page.getByTestId("still");
  await expect(stage).toHaveAttribute("data-still", /^(ready|error)$/, { timeout: 90_000 });
  expect(await stage.getAttribute("data-error")).toBeNull();
  await expect(stage).toHaveAttribute("data-still", "ready");
  // The still page's scene modes draw on a hand-built renderer: the canvas must say which backend drew it.
  await expectRenderer(stage.locator("canvas"), renderers);
  expect(problems).toEqual([]);
  page.off("console", onConsole);
  page.off("pageerror", onError);
  const picture = decodePng(await stage.screenshot({ animations: "disabled" }));
  expect([picture.width, picture.height]).toEqual([512, 512]);
  return picture;
}

/** The renderer's counts of what it holds (geometries, textures, render targets, programs, buffers), not the sizes in bytes it reports beside them. */
const counts = (key: string): boolean => key !== "total" && !/size$/i.test(key);

/**
 * What the renderer may hold once a scene is freed, against what it held having drawn only an empty scene: the same counts, and for
 * textures `leftovers` more, the library's fixed leftovers of that fixture (`leftoverTextures`: the environment bake's one, and
 * transmission glass's one where the fixture has any). Nothing grows with a build.
 */
function expectEmpty(label: string, reading: Memory, baseline: Memory, leftovers: number): void {
  for (const [key, base] of Object.entries(baseline).filter(([key]) => counts(key))) {
    const allowed = key === "textures" ? base + leftovers : base;
    expect(reading[key] ?? 0, `${label}: ${key} is ${String(reading[key])}, a renderer that drew an empty scene holds ${String(base)} (and may keep ${String(allowed - base)} more)`).toBeLessThanOrEqual(allowed);
  }
}

/**
 * Frees the scene on the page, then builds and frees it five times more. The five readings are the same (asserted first, so a leak that
 * grows by one a cycle fails this on its own), and every reading, the first free's too, is the empty scene's plus this fixture's leftovers.
 */
async function expectFlat(page: Page, label: string, leftovers: number): Promise<{ readonly baseline: Memory; readonly freed: Memory; readonly cycles: readonly Memory[] }> {
  const baseline = await page.evaluate<Memory>(() => {
    if (window.stillScene === undefined) throw new Error("the page has no stillScene");
    return window.stillScene.baseline;
  });
  const freed = await page.evaluate<Memory>(() => window.stillScene?.dispose() ?? Promise.reject(new Error("the page has no stillScene")));
  const cycles: Memory[] = [];
  for (let cycle = 1; cycle <= 5; cycle += 1) {
    // eslint-disable-next-line no-await-in-loop -- the cycles are one after another on one renderer
    cycles.push(await page.evaluate<Memory>(() => window.stillScene?.cycle() ?? Promise.reject(new Error("the page has no stillScene"))));
  }
  const [first, ...rest] = cycles.map((reading) => Object.fromEntries(Object.entries(reading).filter(([key]) => counts(key))));
  for (const reading of rest) expect(reading, `${label}: the readings over five build-and-free cycles are not flat`).toEqual(first);
  expectEmpty(`${label} after dispose`, freed, baseline, leftovers);
  cycles.forEach((reading, at) => {
    expectEmpty(`${label} cycle ${String(at + 1)}`, reading, baseline, leftovers);
  });
  return { baseline, freed, cycles };
}

for (const name of roundTrip) {
  test(`${name}: doc, code and golden are one picture; the plants are not; memory is flat`, async ({ page }, testInfo) => {
    // Software WebGL draws the effects slowly, and the strict check does a build-and-free five times over: this is a long test.
    test.setTimeout(300_000);
    const strict = testInfo.project.name === "scenes";
    // The strict project draws on a real GPU and is not the WebGPU lane: ask for webgpu by name.
    const renderers = strict ? ["webgpu"] : ["webgpu", "webgl2"];
    const file = goldenPath(name);

    const doc = await draw(page, name, "doc", renderers);
    if (strict && updating) {
      mkdirSync(resolve(file, ".."), { recursive: true });
      await page.getByTestId("still").screenshot({ animations: "disabled", path: file });
      return;
    }
    expect(existsSync(file), `no golden for ${name}: bun run scenes writes it`).toBe(true);
    const golden = decodePng(readFileSync(file));

    if (strict) {
      expect(strictDistance(doc, golden), `${name}: the doc frame is not its golden`).toMatchObject({ changedPixels: 0 });
      const docMemory = await expectFlat(page, `${name} (doc)`, leftoverTextures(fixture(name)));
      const code = await draw(page, name, "code", renderers);
      expect(strictDistance(code, doc), `${name}: the emitted module draws a different frame from the document`).toMatchObject({ changedPixels: 0 });
      expect(strictDistance(code, golden), `${name}: the code frame is not its golden`).toMatchObject({ changedPixels: 0 });
      const codeMemory = await expectFlat(page, `${name} (code)`, leftoverTextures(fixture(name)));
      const results: Record<string, unknown> = { fixture: name, mode: "strict", memory: { doc: docMemory, code: codeMemory } };
      const missed: string[] = [];
      for (const kind of plantNames) {
        if (planted(fixture(name), kind) === undefined) continue;
        expect(existsSync(plantPath(name, kind)), `no planted module ${name}.${kind}: bun run scenes:plants writes it`).toBe(true);
        // eslint-disable-next-line no-await-in-loop -- one plant at a time on one page
        const shown = await draw(page, name, "code", renderers, kind);
        const distance = strictDistance(shown, doc);
        results[kind] = distance;
        if (!strictFails(distance)) missed.push(kind);
      }
      writeReport("strict", name, results);
      if (measuring) return;
      expect(missed, `${name}: the check passed these plants, which it must fail`).toEqual([]);
      return;
    }

    // Loose: only the doc frame is compared, against a golden the real GPU drew. The golden check's four plants must each fail by the margin.
    const stage = page.getByTestId("still");
    const measure = (frame: Picture) => looseDistance(frame, golden);
    const key = `scene-${name}`;
    const clean = measure(doc);
    const results: Record<string, unknown> = { asset: key, kind: "scene", mode: "loose", clean };
    const missed: string[] = [];
    for (const what of plants) {
      // eslint-disable-next-line no-await-in-loop -- one page, one plant at a time
      await plant(page, what);
      // eslint-disable-next-line no-await-in-loop -- the picture is read before the next plant
      const shown = measure(decodePng(await stage.screenshot({ animations: "disabled" })));
      results[what] = shown;
      if (looseRatio(shown, key) < MARGIN) missed.push(what);
    }
    await plant(page, "clear");
    writeReport("loose", key, results);
    if (measuring) return;
    expect(looseRatio(clean, key) <= 1 / MARGIN, `${name} is further from its golden than its bar allows: ${JSON.stringify(clean)}`).toBe(true);
    expect(missed, `${name}: the loose check passed these plants, which it must fail`).toEqual([]);
  });
}

function writeReport(mode: "strict" | "loose", id: string, results: Record<string, unknown>): void {
  const out = join(report, mode);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${id}.json`), `${JSON.stringify(results)}\n`);
}
