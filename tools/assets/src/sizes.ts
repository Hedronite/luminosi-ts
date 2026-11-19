// The post-build size check: what the apps ship and what the objects cost to draw, against assets/budgets.json.
// Needs `bun run build` first; `bun run validate` runs it, and `bun run --filter tool-assets sizes` prints the table.
//
//   entry sets   the JavaScript a page loads at once: its module script, its modulepreloads, an Astro island's component and
//                renderer, and everything those import statically, gzip -9 each (the same file set a browser fetches at page load)
//   3D set       every file the catalog's 3D entries reach, by static or dynamic import. An entry is a lazily imported chunk, or a
//                script of a page, whose own reach includes three.js (found by three's own markers). The markers only pick the
//                entries; every file they reach is counted, so code moved to a chunk without a marker (a loader, an environment
//                map, a descriptor chunk) is still counted. Files in dist that nothing reaches are ignored: a Turborepo cache
//                restore can leave chunks of an older build behind, and they ship to nobody.
//   chunk set    one lazily imported chunk, found by name: that chunk and what it imports statically, past the gallery's shell (the
//                parameter panel, which loads when the detail view of an asset with parameters opens)
//   objects      draw calls and triangles per object (objects.ts)
//   goldens      the bytes of the golden images in e2e/golden: all together, and the largest
//
// Writes tools/assets/sizes.json for `lumin budgets` (not under dist/, which Turborepo restores from its cache on a build hit). Exits 1 when anything is over, unbudgeted, or budgeted but not measured.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { loadBudgets, type Budgets } from "./budgets.js";
import { measureObjects, type Counts } from "./objects.js";

export interface BundleSize {
  readonly gzipBytes: number;
  readonly files: readonly string[];
}

export interface GoldenSize {
  readonly bytes: number;
  readonly perImageBytes: number;
}

export interface Measured {
  readonly bundles: Readonly<Record<string, BundleSize>>;
  readonly objects: Readonly<Record<string, Counts>>;
  readonly goldens: Readonly<Record<string, GoldenSize>>;
}

export interface Check {
  readonly key: string;
  readonly actual: number;
  readonly budget: number;
  readonly ok: boolean;
}

export interface Row {
  readonly family: "bundle" | "object" | "golden";
  readonly id: string;
  readonly ok: boolean;
  readonly checks: readonly Check[];
}

interface Bundle {
  readonly dist: string;
  readonly pages: readonly string[];
  /** Without it, the static closure of the pages (what loads at once). With it, the 3D set: everything reached from the entries whose reach carries one of these markers. */
  readonly carries?: readonly string[];
  /** For the 3D set: the page whose scripts are the shell, what the gallery loads without any 3D. */
  readonly shell?: string;
  /** For a lazy chunk's set: the chunk's name (`<name>-<hash>.js`), a lazy import of the first page's shell. */
  readonly chunk?: string;
}

/** What each bundle budget measures. */
const bundles: Readonly<Record<string, Bundle>> = {
  "catalog-gallery": { dist: "apps/catalog/dist", pages: ["index.html"] },
  "catalog-embed": { dist: "apps/catalog/dist", pages: ["embed.html"] },
  "catalog-3d": { dist: "apps/catalog/dist", pages: ["index.html", "embed.html"], carries: ["isObject3D", "isWebGPURenderer"], shell: "index.html" },
  "catalog-panel": { dist: "apps/catalog/dist", pages: ["index.html"], chunk: "ParameterPanel" },
  "site-island": { dist: "apps/site/dist", pages: ["index.html"] },
};

const gzipBytes = (files: readonly string[]): number => files.reduce((sum, file) => sum + gzipSync(readFileSync(file), { level: 9 }).length, 0);

const staticImport = /(?:\bfrom|\bimport)\s*["'](\.{1,2}\/[^"']+\.js)["']/g;
const dynamicImport = /\bimport\(\s*["'`](\.{1,2}\/[^"'`]+\.js)["'`]\s*\)/g;

/** The scripts a page's HTML loads: its module script, its modulepreloads, an Astro island's component and renderer. */
function pageScripts(dist: string, pages: readonly string[]): string[] {
  return pages.flatMap((page) => {
    const html = readFileSync(join(dist, page), "utf8");
    return [
      ...html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g),
      ...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g),
      ...html.matchAll(/\b(?:component-url|renderer-url|before-hydration-url)="([^"]+)"/g),
    ].map((match) => resolve(dist, (match[1] ?? "").replace(/^\//, "")));
  });
}

/** `starts` and every file they import statically, and dynamically too when `lazy`. Files in `skip` are neither counted nor followed. */
function closure(starts: readonly string[], lazy: boolean, skip: ReadonlySet<string> = new Set()): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file) || skip.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const pattern of lazy ? [staticImport, dynamicImport] : [staticImport]) for (const match of source.matchAll(pattern)) visit(resolve(dirname(file), match[1] ?? ""));
  };
  starts.forEach(visit);
  return seen;
}

/** The files the pages' HTML pulls in as scripts, with every file those import statically. */
const reach = (dist: string, pages: readonly string[]): string[] => [...closure(pageScripts(dist, pages), false)].sort();

/**
 * The 3D set. The shell is what the gallery page loads without any 3D (its own scripts and what they import statically; the
 * embed page's preloads are not part of it, so a chunk only the embed page preloads is counted when a 3D route reaches it):
 * it is the gallery's budget, and its lazy imports (the icon packs, the other views) are not on a 3D route, so it is
 * neither followed nor counted here. The entries are the page scripts whose static reach carries a marker (the embed
 * page) and every chunk the shell imports lazily whose reach carries one (the views, and the descriptors, which load the
 * builders). The set is everything the entries reach past the shell, so a chunk the markers do not see (a loader, an
 * environment map, a descriptor chunk) is still counted.
 */
function reachThreeD(dist: string, pages: readonly string[], markers: readonly string[], shellPage: string): string[] {
  const carries = (files: Iterable<string>): boolean => [...files].some((file) => markers.some((marker) => readFileSync(file, "utf8").includes(marker)));
  const scripts = pageScripts(dist, pages);
  const shell = closure(pageScripts(dist, [shellPage]).filter((script) => !carries(closure([script], false))), false);
  const lazyTargets = new Set<string>();
  for (const file of shell) for (const match of readFileSync(file, "utf8").matchAll(dynamicImport)) lazyTargets.add(resolve(dirname(file), match[1] ?? ""));
  const entries = [...scripts.filter((script) => !shell.has(script) && carries(closure([script], false))), ...[...lazyTargets].filter((target) => carries(closure([target], true, shell)))];
  return [...closure(entries, true, shell)].sort();
}

/** A lazy chunk's set: the chunk the gallery's shell imports under `name` (`<name>-<hash>.js`) and what it imports statically, past the shell. */
function reachChunk(dist: string, shellPage: string, name: string): string[] {
  const shell = closure(pageScripts(dist, [shellPage]), false);
  const named = new RegExp(`^${name}(-[\\w-]+)?\\.js$`);
  const targets = new Set<string>();
  for (const file of shell) for (const match of readFileSync(file, "utf8").matchAll(dynamicImport)) targets.add(resolve(dirname(file), match[1] ?? ""));
  return [...closure([...targets].filter((target) => named.test(basename(target))), false, shell)].sort();
}

export function measureBundles(root: string): Readonly<Record<string, BundleSize>> {
  return Object.fromEntries(
    Object.entries(bundles).map(([id, bundle]): readonly [string, BundleSize] => {
      const dist = join(root, bundle.dist);
      if (!existsSync(dist)) throw new Error(`${id}: no build output at ${bundle.dist}; run \`bun run build\``);
      const { carries, shell, chunk } = bundle;
      const files = chunk !== undefined ? reachChunk(dist, bundle.pages[0] ?? "", chunk) : carries === undefined || shell === undefined ? reach(dist, bundle.pages) : reachThreeD(dist, bundle.pages, carries, shell);
      return [id, { gzipBytes: gzipBytes(files), files: files.map((file) => file.slice(root.length + 1)) }];
    }),
  );
}

/** The golden images (`bun run goldens` writes e2e/golden, `bun run scenes` e2e/scenes), measured together as the one budget line "e2e-golden". */
export function measureGoldens(root: string): Readonly<Record<string, GoldenSize>> {
  const sizes = ["e2e/golden", "e2e/scenes"].flatMap((folder) => {
    const directory = join(root, folder);
    return existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith(".png")).map((name) => statSync(join(directory, name)).size) : [];
  });
  return { "e2e-golden": { bytes: sizes.reduce((sum, size) => sum + size, 0), perImageBytes: Math.max(0, ...sizes) } };
}

/** Measured against budgeted, both ways: a number over its budget, one with no budget, and a budget with nothing measured, are all problems. */
export function checkAgainst(budgets: Budgets, measured: Measured): { readonly rows: readonly Row[]; readonly problems: readonly string[] } {
  const problems: string[] = [];
  const rows: Row[] = [];
  type Numbers = Readonly<Record<string, number>>;
  const family = (name: "bundle" | "object" | "golden", limits: Readonly<Record<string, Numbers>>, actuals: Readonly<Record<string, Numbers>>): void => {
    for (const id of Object.keys(limits)) if (!Object.hasOwn(actuals, id)) problems.push(`${id}: budgeted under ${name}s but not measured`);
    for (const [id, actual] of Object.entries(actuals)) {
      const limit = limits[id];
      if (limit === undefined) {
        problems.push(`${id}: no ${name} budget in assets/budgets.json`);
        continue;
      }
      const checks = Object.entries(limit).map(([key, budget]): Check => ({ key, actual: actual[key] ?? Infinity, budget, ok: (actual[key] ?? Infinity) <= budget }));
      for (const check of checks) if (!check.ok) problems.push(`${id}: ${check.key} ${String(check.actual)} > budget ${String(check.budget)}`);
      rows.push({ family: name, id, ok: checks.every((check) => check.ok), checks });
    }
  };
  family("bundle", budgets.bundles, Object.fromEntries(Object.entries(measured.bundles).map(([id, size]) => [id, { gzipBytes: size.gzipBytes }])));
  family("object", budgets.objects, Object.fromEntries(Object.entries(measured.objects).map(([id, counts]) => [id, { drawCalls: counts.drawCalls, triangles: counts.triangles }])));
  family("golden", budgets.goldens, Object.fromEntries(Object.entries(measured.goldens).map(([id, size]) => [id, { bytes: size.bytes, perImageBytes: size.perImageBytes }])));
  return { rows, problems };
}

/** Measures, writes tools/assets/sizes.json, and returns what is wrong. */
export async function checkSizes(root: string): Promise<{ readonly rows: readonly Row[]; readonly problems: readonly string[] }> {
  const measured: Measured = { bundles: measureBundles(root), objects: measureObjects(), goldens: measureGoldens(root) };
  await writeFile(join(root, "tools/assets/sizes.json"), `${JSON.stringify(measured, null, 2)}\n`);
  return checkAgainst(await loadBudgets(root), measured);
}

if (import.meta.main) {
  const { rows, problems } = await checkSizes(resolve(import.meta.dirname, "../../.."));
  console.table(rows.flatMap((row) => row.checks.map((check) => ({ id: row.id, key: check.key, actual: check.actual, budget: check.budget, ok: check.ok }))));
  if (problems.length > 0) {
    console.error(`Over budget:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
}
