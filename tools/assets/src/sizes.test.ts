import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Budgets } from "./budgets.js";
import { checkAgainst, measureBundles, measureGoldens, unmeasuredReachable, type Measured } from "./sizes.js";

const budgets: Budgets = {
  models: {},
  bundles: { entry: { gzipBytes: 1000 } },
  objects: { cube: { drawCalls: 2, triangles: 12 } },
  goldens: { images: { bytes: 5000, perImageBytes: 800 } },
};
const measured: Measured = { bundles: { entry: { gzipBytes: 900, files: ["entry.js"] } }, objects: { cube: { drawCalls: 2, triangles: 12 } }, goldens: { images: { bytes: 5000, perImageBytes: 800 } } };

describe("checkAgainst", () => {
  it("passes what is within its budget, to the byte", () => {
    const { rows, problems } = checkAgainst(budgets, { ...measured, bundles: { entry: { gzipBytes: 1000, files: ["entry.js"] } } });
    expect(problems).toEqual([]);
    expect(rows.map((row) => [row.id, row.ok])).toEqual([["entry", true], ["cube", true], ["images", true]]);
  });

  it("names a number over its budget", () => {
    const { rows, problems } = checkAgainst(budgets, { ...measured, bundles: { entry: { gzipBytes: 1001, files: ["entry.js"] } }, objects: { cube: { drawCalls: 3, triangles: 12 } } });
    expect(problems).toEqual(["entry: gzipBytes 1001 > budget 1000", "cube: drawCalls 3 > budget 2"]);
    expect(rows.map((row) => row.ok)).toEqual([false, false, true]);
  });

  it("names golden images over their budget, in total or one by one", () => {
    const { problems } = checkAgainst(budgets, { ...measured, goldens: { images: { bytes: 5001, perImageBytes: 801 } } });
    expect(problems).toEqual(["images: bytes 5001 > budget 5000", "images: perImageBytes 801 > budget 800"]);
  });

  it("flags something measured that has no budget", () => {
    const { problems } = checkAgainst({ ...budgets, objects: {} }, measured);
    expect(problems).toEqual(["cube: no object budget in assets/budgets.json"]);
  });

  it("flags a budget with nothing measured", () => {
    const { problems } = checkAgainst(budgets, { ...measured, bundles: {} });
    expect(problems).toEqual(["entry: budgeted under bundles but not measured"]);
  });

  it("refuses a bundle that resolved to zero files", () => {
    const { rows, problems } = checkAgainst(budgets, { ...measured, bundles: { entry: { gzipBytes: 0, files: [] } } });
    expect(problems).toEqual(["entry: measured no files"]);
    expect(rows.find((row) => row.id === "entry")?.ok).toBe(false);
  });
});

describe("measureGoldens", () => {
  const root = mkdtempSync(join(tmpdir(), "lts-goldens-"));
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("adds up the PNGs of e2e/golden and finds the largest", () => {
    mkdirSync(join(root, "e2e/golden"), { recursive: true });
    writeFileSync(join(root, "e2e/golden/a.png"), "12345");
    writeFileSync(join(root, "e2e/golden/b.png"), "1234567");
    writeFileSync(join(root, "e2e/golden/metrics.ts"), "not an image, not counted");
    expect(measureGoldens(root)).toEqual({ "e2e-golden": { bytes: 12, perImageBytes: 7 } });
  });

  it("counts the scene goldens of e2e/scenes with them", () => {
    const own = mkdtempSync(join(tmpdir(), "lts-goldens-scenes-"));
    try {
      mkdirSync(join(own, "e2e/golden"), { recursive: true });
      mkdirSync(join(own, "e2e/scenes"), { recursive: true });
      writeFileSync(join(own, "e2e/golden/a.png"), "12345");
      writeFileSync(join(own, "e2e/scenes/scene.png"), "123456789");
      writeFileSync(join(own, "e2e/scenes/emitted.ts"), "not an image, not counted");
      expect(measureGoldens(own)).toEqual({ "e2e-golden": { bytes: 14, perImageBytes: 9 } });
    } finally {
      rmSync(own, { recursive: true, force: true });
    }
  });

  it("measures nothing for a tree with no golden folder", () => {
    expect(measureGoldens(join(root, "nowhere"))).toEqual({ "e2e-golden": { bytes: 0, perImageBytes: 0 } });
  });
});

describe("measureBundles", () => {
  const root = mkdtempSync(join(tmpdir(), "lts-sizes-"));
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const page = (script: string): string => `<!doctype html><script type="module" crossorigin src="${script}"></script>`;

  // The gallery loads main, which imports react statically, a 3D view and a non-3D page dynamically. The view imports a chunk
  // carrying three, react, a loader with no marker of its own, and loads another unmarked chunk dynamically.
  write("apps/catalog/dist/index.html", page("/assets/main.js"));
  // The embed page preloads spec.js, which the gallery page does not load; the view imports it too.
  write("apps/catalog/dist/embed.html", `${page("/assets/embed.js")}<link rel="modulepreload" crossorigin href="/assets/spec.js">`);
  write("apps/catalog/dist/assets/spec.js", "export const s = 'shared by the embed page and the 3D view';");
  write("apps/catalog/dist/assets/main.js", 'import{r}from"./react.js";const view=()=>import(`./view.js`).then(e=>e.t);const packs=()=>import(`./packs.js`);const panel=()=>import(`./ParameterPanel-x1Y2.js`);const playground=()=>import(`./Playground-a1B2.js`);export{r,view,packs,panel,playground};');
  write("apps/catalog/dist/assets/react.js", "export const r = 1;");
  write("apps/catalog/dist/assets/view.js", 'import{t}from"./three.js";import{r}from"./react.js";import{l}from"./loader.js";import{s}from"./spec.js";const late=()=>import(`./late.js`);const prose=()=>import(`./prose.js`);export{t,r,l,s,late,prose};');
  // Bundled text whose prose reads like code: a Markdown code sample of an import that names a file the build never made, beside a real
  // import of a chunk that is there. The size walk counts the real one and does not fail on the sample.
  write(
    "apps/catalog/dist/assets/prose.js",
    `import{h}from"./prose-helper.js";export const text = "Use [water](demo/assets/harbour-water.js); the code is import('./harbour-water.js') and from './ghost.js'.";export{h};`,
  );
  write("apps/catalog/dist/assets/prose-helper.js", "export const h = 'a chunk the prose chunk really imports';");
  write("apps/catalog/dist/assets/three.js", "export const t = { isObject3D: true };");
  write("apps/catalog/dist/assets/loader.js", "export const l = 'a chunk that kept no three marker when the code moved';");
  write("apps/catalog/dist/assets/late.js", "export const late = 'loaded by the view on demand';");
  write("apps/catalog/dist/assets/packs.js", "export const p = 'a lazy page with no 3D in its reach';");
  // The panel: a lazy chunk with a static import of its own, and one of the gallery's (react), which stays the gallery's.
  write("apps/catalog/dist/assets/ParameterPanel-x1Y2.js", 'import{r}from"./react.js";import{f}from"./paramFit-q9.js";const late=()=>import(`./late.js`);export{r,f,late};');
  write("apps/catalog/dist/assets/paramFit-q9.js", "export const f = 'what the panel and the detail view both read';");
  write("apps/catalog/dist/assets/Playground-a1B2.js", 'import{t}from"./three.js";import{r}from"./react.js";import{v}from"./stage-view.js";const stage=()=>import(`./PlaygroundStage-x9Y8.js`);const credits=()=>import(`./credits-c3D4.js`);const pgExtra=()=>import(`./pg-extra.js`);export{t,r,v,stage,credits,pgExtra};');
  write("apps/catalog/dist/assets/PlaygroundStage-x9Y8.js", 'import{v}from"./stage-view.js";import{t}from"./three.js";export const stage = { v, t, isWebGPURenderer: true };');
  write("apps/catalog/dist/assets/stage-view.js", "export const v = 'playground stage shell';");
  write("apps/catalog/dist/assets/pg-extra.js", "export const extra = 'a lazy chunk reached only via Playground';");
  write("apps/catalog/dist/assets/credits-c3D4.js", 'import{r}from"./main.js";export const c = r;');
  write("apps/catalog/dist/assets/embed.js", "export const e = 1;");
  // Left in dist by an older build and reached by nothing.
  write("apps/catalog/dist/assets/orphan.js", `export const o = { isObject3D: true, filler: "${"orphan ".repeat(2000)}" };`);
  // The scene element's page: the bootstrap holds the class and imports the drawing half on demand, and that half reaches three.
  write("apps/catalog/dist/element.html", page("/assets/element.js"));
  write("apps/catalog/dist/assets/element.js", "const draw=()=>import(`./draw.js`);export{draw};");
  write("apps/catalog/dist/assets/draw.js", 'import{t}from"./three.js";export const d=t;');
  write("apps/site/dist/index.html", page("/_astro/island.js"));
  write("apps/site/dist/_astro/island.js", "export const i = 1;");
  const sizes = measureBundles(root);
  const names = (id: string): string[] => (sizes[id]?.files ?? []).map((file) => file.split("/").pop() ?? file);

  it("takes an entry set as the static closure of the page, leaving dynamic imports out", () => {
    expect(names("catalog-gallery")).toEqual(["main.js", "react.js"]);
    expect(names("catalog-embed")).toEqual(["embed.js", "spec.js"]);
    expect(names("site-island")).toEqual(["island.js"]);
  });

  it("takes what a page loads for the scene element as the bootstrap alone, and its chunk set as what the bootstrap imports on demand", () => {
    expect(names("scene-element")).toEqual(["element.js"]);
    expect(names("scene-element-3d")).toEqual(["draw.js", "three.js"]);
  });

  it("takes the 3D set from everything the 3D entries reach, markers or not, and ignores files nothing reaches", () => {
    // The loader and the late chunk carry no marker, and are counted all the same. React is the gallery's: the shell is not counted.
    expect(names("catalog-3d")).toEqual(["PlaygroundStage-x9Y8.js", "late.js", "loader.js", "pg-extra.js", "prose-helper.js", "prose.js", "spec.js", "stage-view.js", "three.js", "view.js"]);
  });

  it("builds the shell from the gallery page alone: a chunk only the embed page preloads is counted when a 3D view reaches it", () => {
    expect(names("catalog-gallery")).not.toContain("spec.js");
    expect(names("catalog-3d")).toContain("spec.js");
  });

  it("takes a lazy chunk's set by its name: the chunk and its static imports past the shell, no dynamic imports, none of the shell", () => {
    expect(names("catalog-panel")).toEqual(["ParameterPanel-x1Y2.js", "paramFit-q9.js"]);
    expect(names("catalog-playground")).toEqual(["Playground-a1B2.js", "PlaygroundStage-x9Y8.js", "stage-view.js", "three.js"]);
    expect(names("catalog-export")).toEqual(["credits-c3D4.js"]);
  });

  it("keeps lazy Playground and export chunks out of the core catalog-3d closure, while counting lazy chunks reached through Playground", () => {
    expect(names("catalog-3d")).not.toContain("Playground-a1B2.js");
    expect(names("catalog-3d")).not.toContain("credits-c3D4.js");
    expect(names("catalog-3d")).toContain("pg-extra.js");
  });

  it("fails checkAgainst when a budgeted chunk name is missing from dist", () => {
    const renamed = mkdtempSync(join(tmpdir(), "lts-missing-chunk-"));
    try {
      const writeMissing = (path: string, text: string): void => {
        mkdirSync(dirname(join(renamed, path)), { recursive: true });
        writeFileSync(join(renamed, path), text);
      };
      writeMissing("apps/catalog/dist/index.html", page("/assets/main.js"));
      writeMissing("apps/catalog/dist/embed.html", page("/assets/embed.js"));
      writeMissing("apps/catalog/dist/element.html", page("/assets/element.js"));
      writeMissing("apps/catalog/dist/assets/main.js", "export const m = 1;");
      writeMissing("apps/catalog/dist/assets/embed.js", "export const e = 1;");
      writeMissing("apps/catalog/dist/assets/element.js", "export const el = 1;");
      writeMissing("apps/site/dist/index.html", page("/_astro/island.js"));
      writeMissing("apps/site/dist/_astro/island.js", "export const i = 1;");
      const broken = measureBundles(renamed);
      const { problems } = checkAgainst(
        {
          models: {},
          bundles: { "catalog-export": { gzipBytes: 2900 } },
          objects: {},
          goldens: {},
        },
        { bundles: { "catalog-export": broken["catalog-export"] ?? { gzipBytes: 0, files: [] } }, objects: {}, goldens: {} },
      );
      expect(problems).toEqual(['catalog-export: measured no files (chunk "credits" not found)']);
    } finally {
      rmSync(renamed, { recursive: true, force: true });
    }
  });

  it("does not follow an import-looking string inside bundled text, and still follows a real import beside it", () => {
    // A skill's Markdown, bundled as a string, holds `import("./harbour-water.js")` in a code sample: no such file is in dist, and the walk
    // neither fails on it nor counts it. The chunk the same file really imports is counted.
    expect(names("catalog-3d")).toContain("prose.js");
    expect(names("catalog-3d")).toContain("prose-helper.js");
    expect(names("catalog-3d")).not.toContain("harbour-water.js");
    expect(names("catalog-3d")).not.toContain("ghost.js");
    expect(() => measureBundles(root)).not.toThrow();
  });

  it("counts every chunk name in a playground budget line", () => {
    expect(names("catalog-playground")).toContain("PlaygroundStage-x9Y8.js");
    expect(names("catalog-playground")).toContain("stage-view.js");
  });

  it("turns catalog-playground red when PlaygroundStage grows past its budget", () => {
    const playground = sizes["catalog-playground"];
    expect(playground).toBeDefined();
    const before = playground!.gzipBytes;
    write("apps/catalog/dist/assets/PlaygroundStage-x9Y8.js", `${readFileSync(join(root, "apps/catalog/dist/assets/PlaygroundStage-x9Y8.js"), "utf8")}/*${"x".repeat(80)}*/`);
    const after = measureBundles(root)["catalog-playground"]!.gzipBytes;
    expect(after).toBeGreaterThan(before);
    const { problems } = checkAgainst(
      { models: {}, bundles: { "catalog-playground": { gzipBytes: after - 1 } }, objects: {}, goldens: {} },
      { bundles: { "catalog-playground": measureBundles(root)["catalog-playground"]! }, objects: {}, goldens: {} },
    );
    expect(problems).toEqual([`catalog-playground: gzipBytes ${after} > budget ${after - 1}`]);
  });

  it("reports reachable dist files that no budget line counts", () => {
    expect(unmeasuredReachable(root)).toEqual([]);
  });

  it("leaves out a lazy chunk whose reach has no 3D, and a page script that has none", () => {
    expect(names("catalog-3d")).not.toContain("packs.js");
    expect(names("catalog-3d")).not.toContain("main.js");
    expect(names("catalog-3d")).not.toContain("embed.js");
    expect(names("catalog-3d")).not.toContain("react.js");
    expect(names("catalog-3d")).not.toContain("orphan.js");
  });
});
