import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Budgets } from "./budgets.js";
import { checkAgainst, measureBundles, type Measured } from "./sizes.js";

const budgets: Budgets = {
  models: {},
  bundles: { entry: { gzipBytes: 1000 } },
  objects: { cube: { drawCalls: 2, triangles: 12 } },
};
const measured: Measured = { bundles: { entry: { gzipBytes: 900, files: [] } }, objects: { cube: { drawCalls: 2, triangles: 12 } } };

describe("checkAgainst", () => {
  it("passes what is within its budget, to the byte", () => {
    const { rows, problems } = checkAgainst(budgets, { ...measured, bundles: { entry: { gzipBytes: 1000, files: [] } } });
    expect(problems).toEqual([]);
    expect(rows.map((row) => [row.id, row.ok])).toEqual([["entry", true], ["cube", true]]);
  });

  it("names a number over its budget", () => {
    const { rows, problems } = checkAgainst(budgets, { ...measured, bundles: { entry: { gzipBytes: 1001, files: [] } }, objects: { cube: { drawCalls: 3, triangles: 12 } } });
    expect(problems).toEqual(["entry: gzipBytes 1001 > budget 1000", "cube: drawCalls 3 > budget 2"]);
    expect(rows.map((row) => row.ok)).toEqual([false, false]);
  });

  it("flags something measured that has no budget", () => {
    const { problems } = checkAgainst({ ...budgets, objects: {} }, measured);
    expect(problems).toEqual(["cube: no object budget in assets/budgets.json"]);
  });

  it("flags a budget with nothing measured", () => {
    const { problems } = checkAgainst(budgets, { bundles: {}, objects: measured.objects });
    expect(problems).toEqual(["entry: budgeted under bundles but not measured"]);
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
  write("apps/catalog/dist/embed.html", page("/assets/embed.js"));
  write("apps/catalog/dist/assets/main.js", 'import{r}from"./react.js";const view=()=>import(`./view.js`).then(e=>e.t);const packs=()=>import(`./packs.js`);export{r,view,packs};');
  write("apps/catalog/dist/assets/react.js", "export const r = 1;");
  write("apps/catalog/dist/assets/view.js", 'import{t}from"./three.js";import{r}from"./react.js";import{l}from"./loader.js";const late=()=>import(`./late.js`);export{t,r,l,late};');
  write("apps/catalog/dist/assets/three.js", "export const t = { isObject3D: true };");
  write("apps/catalog/dist/assets/loader.js", "export const l = 'a chunk that kept no three marker when the code moved';");
  write("apps/catalog/dist/assets/late.js", "export const late = 'loaded by the view on demand';");
  write("apps/catalog/dist/assets/packs.js", "export const p = 'a lazy page with no 3D in its reach';");
  write("apps/catalog/dist/assets/embed.js", "export const e = 1;");
  // Left in dist by an older build and reached by nothing.
  write("apps/catalog/dist/assets/orphan.js", `export const o = { isObject3D: true, filler: "${"orphan ".repeat(2000)}" };`);
  write("apps/site/dist/index.html", page("/_astro/island.js"));
  write("apps/site/dist/_astro/island.js", "export const i = 1;");
  const sizes = measureBundles(root);
  const names = (id: string): string[] => (sizes[id]?.files ?? []).map((file) => file.split("/").pop() ?? file);

  it("takes an entry set as the static closure of the page, leaving dynamic imports out", () => {
    expect(names("catalog-gallery")).toEqual(["main.js", "react.js"]);
    expect(names("catalog-embed")).toEqual(["embed.js"]);
    expect(names("site-island")).toEqual(["island.js"]);
  });

  it("takes the 3D set from everything the 3D entries reach, markers or not, and ignores files nothing reaches", () => {
    // The loader and the late chunk carry no marker, and are counted all the same. React is the gallery's: the shell is not counted.
    expect(names("catalog-3d")).toEqual(["late.js", "loader.js", "three.js", "view.js"]);
  });

  it("leaves out a lazy chunk whose reach has no 3D, and a page script that has none", () => {
    expect(names("catalog-3d")).not.toContain("packs.js");
    expect(names("catalog-3d")).not.toContain("main.js");
    expect(names("catalog-3d")).not.toContain("embed.js");
    expect(names("catalog-3d")).not.toContain("react.js");
    expect(names("catalog-3d")).not.toContain("orphan.js");
  });
});
