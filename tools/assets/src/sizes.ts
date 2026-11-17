// The post-build size check: what the apps ship and what the objects cost to draw, against assets/budgets.json.
// Needs `bun run build` first; `bun run validate` runs it, and `bun run --filter tool-assets sizes` prints the table.
//
//   entry sets   the JavaScript a page loads at once: its module script, its modulepreloads, an Astro island's component and
//                renderer, and everything those import statically, gzip -9 each (the same file set a browser fetches at page load)
//   3D chunks    every JavaScript file in the catalog build that carries three.js (found by three's own markers), entry or lazy
//   objects      draw calls and triangles per object (objects.ts)
//
// Writes tools/assets/sizes.json for `lumin budgets` (not under dist/, which Turborepo restores from its cache on a build hit). Exits 1 when anything is over, unbudgeted, or budgeted but not measured.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { loadBudgets, type Budgets } from "./budgets.js";
import { measureObjects, type Counts } from "./objects.js";

export interface BundleSize {
  readonly gzipBytes: number;
  readonly files: readonly string[];
}

export interface Measured {
  readonly bundles: Readonly<Record<string, BundleSize>>;
  readonly objects: Readonly<Record<string, Counts>>;
}

export interface Check {
  readonly key: string;
  readonly actual: number;
  readonly budget: number;
  readonly ok: boolean;
}

export interface Row {
  readonly family: "bundle" | "object";
  readonly id: string;
  readonly ok: boolean;
  readonly checks: readonly Check[];
}

type Bundle = { readonly dist: string; readonly page: string } | { readonly dist: string; readonly carries: readonly string[] };

/** What each bundle budget measures. A page's set is its entry; the 3D set is by content. */
const bundles: Readonly<Record<string, Bundle>> = {
  "catalog-gallery": { dist: "apps/catalog/dist", page: "index.html" },
  "catalog-embed": { dist: "apps/catalog/dist", page: "embed.html" },
  "catalog-3d": { dist: "apps/catalog/dist", carries: ["isObject3D", "isWebGPURenderer"] },
  "site-island": { dist: "apps/site/dist", page: "index.html" },
};

const gzipBytes = (files: readonly string[]): number => files.reduce((sum, file) => sum + gzipSync(readFileSync(file), { level: 9 }).length, 0);

const jsFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? jsFiles(join(dir, entry.name)) : entry.name.endsWith(".js") ? [join(dir, entry.name)] : []));

/** The files a page's HTML pulls in as scripts, with every file those import statically (dynamic imports are lazy, so left out). */
function entrySet(dist: string, page: string): string[] {
  const html = readFileSync(join(dist, page), "utf8");
  const references = [
    ...html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g),
    ...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g),
    ...html.matchAll(/\b(?:component-url|renderer-url|before-hydration-url)="([^"]+)"/g),
  ].map((match) => resolve(dist, (match[1] ?? "").replace(/^\//, "")));
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(/(?:\bfrom|\bimport)\s*["'](\.{1,2}\/[^"']+\.js)["']/g)) visit(resolve(dirname(file), match[1] ?? ""));
  };
  references.forEach(visit);
  return [...seen].sort();
}

export function measureBundles(root: string): Readonly<Record<string, BundleSize>> {
  return Object.fromEntries(
    Object.entries(bundles).map(([id, bundle]): readonly [string, BundleSize] => {
      const dist = join(root, bundle.dist);
      if (!existsSync(dist)) throw new Error(`${id}: no build output at ${bundle.dist}; run \`bun run build\``);
      const files =
        "page" in bundle ? entrySet(dist, bundle.page) : jsFiles(dist).filter((file) => bundle.carries.some((marker) => readFileSync(file, "utf8").includes(marker)));
      return [id, { gzipBytes: gzipBytes(files), files: files.map((file) => file.slice(root.length + 1)) }];
    }),
  );
}

/** Measured against budgeted, both ways: a number over its budget, one with no budget, and a budget with nothing measured, are all problems. */
export function checkAgainst(budgets: Budgets, measured: Measured): { readonly rows: readonly Row[]; readonly problems: readonly string[] } {
  const problems: string[] = [];
  const rows: Row[] = [];
  type Numbers = Readonly<Record<string, number>>;
  const family = (name: "bundle" | "object", limits: Readonly<Record<string, Numbers>>, actuals: Readonly<Record<string, Numbers>>): void => {
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
  return { rows, problems };
}

/** Measures, writes tools/assets/sizes.json, and returns what is wrong. */
export async function checkSizes(root: string): Promise<{ readonly rows: readonly Row[]; readonly problems: readonly string[] }> {
  const measured: Measured = { bundles: measureBundles(root), objects: measureObjects() };
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
