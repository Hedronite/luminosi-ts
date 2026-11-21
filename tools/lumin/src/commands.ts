import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { assetKinds, type AssetMeta } from "@hedronite/lts-core";
import { iconPacks as packList } from "@hedronite/lts-icons/packs";
import { kindCounts, loadRegistry, rankAssets, snippetsFor, type KindFilter } from "@hedronite/lts-registry";
import { fail, ok, type Envelope } from "./envelope.js";

/** The repository root: tools/lumin/src → three levels up. */
export const root = resolve(import.meta.dirname, "../../..");

const registry = loadRegistry();

const row = (asset: AssetMeta) => ({ id: asset.id, kind: asset.kind, name: asset.name, package: asset.package ?? null, tags: asset.tags, added: asset.added ?? null });

function isKindFilter(value: string): value is KindFilter {
  return value === "all" || assetKinds.some((k) => k === value);
}

const parseKind = (value: string | undefined): KindFilter | undefined => {
  if (value === undefined || value === "") return "all";
  return isKindFilter(value) ? value : undefined;
};

/** A property of an untyped JSON value, or undefined. */
const field = (source: unknown, key: string): unknown => {
  if (typeof source !== "object" || source === null) return undefined;
  for (const [k, v] of Object.entries(source)) if (k === key) return v;
  return undefined;
};

export function kinds(): Envelope {
  const all = registry.list();
  return ok("kinds", { total: all.length, kinds: Object.fromEntries(kindCounts(all, assetKinds)) });
}

export interface ListOptions {
  readonly kind?: string;
  readonly package?: string;
  readonly tag?: string;
  readonly limit?: number;
  readonly newest?: boolean;
}

export function list(options: ListOptions): Envelope {
  const kind = parseKind(options.kind);
  if (kind === undefined) return fail("list", "usage", `unknown kind "${options.kind ?? ""}"; one of ${assetKinds.join(", ")}`);
  let assets = registry.list().filter((a) => (kind === "all" || a.kind === kind) && (options.package === undefined || a.package === options.package) && (options.tag === undefined || a.tags.includes(options.tag)));
  if (options.newest === true) assets = [...assets].sort((a, b) => (b.added ?? "").localeCompare(a.added ?? ""));
  const limit = options.limit ?? 50;
  return ok("list", { total: assets.length, rows: assets.slice(0, limit).map(row) });
}

export function search(query: string, options: { readonly kind?: string; readonly limit?: number }): Envelope {
  if (query.trim() === "") return fail("search", "usage", "search needs a query");
  const kind = parseKind(options.kind);
  if (kind === undefined) return fail("search", "usage", `unknown kind "${options.kind ?? ""}"; one of ${assetKinds.join(", ")}`);
  const ranked = rankAssets(registry.list(), query, kind);
  return ok("search", { query, total: ranked.length, rows: ranked.slice(0, options.limit ?? 10).map((r) => ({ ...row(r.asset), score: r.score })) });
}

/** Edit distance between two strings (insertions, deletions, substitutions). */
export function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** The ids closest to a mistyped one: search matches first, then near spellings. */
function closestIds(id: string, limit = 5): readonly string[] {
  const ids = registry.list().map((a) => a.id);
  const ranked = rankAssets(registry.list(), id.replace(/-/g, " ")).map((r) => r.asset.id);
  const near = ids
    .map((candidate) => ({ candidate, d: distance(id, candidate) }))
    .filter(({ candidate, d }) => d <= Math.max(2, Math.ceil(candidate.length * 0.3)))
    .sort((x, y) => x.d - y.d)
    .map((x) => x.candidate);
  return [...new Set([...near, ...ranked])].slice(0, limit);
}

export async function show(id: string): Promise<Envelope> {
  const asset = registry.get(id);
  if (asset === undefined) return fail("show", "unknown_asset", `no asset "${id}"`, { matches: closestIds(id) });
  return ok("show", { ...row(asset), version: asset.version, snippets: await snippetsFor(asset), catalog: `apps/catalog → ?asset=${asset.id}` });
}

const packageDirs = (): readonly string[] =>
  readdirSync(join(root, "packages"))
    .filter((dir) => existsSync(join(root, "packages", dir, "package.json")))
    .sort();

export function packages(): Envelope {
  const all = registry.list();
  const rows = packageDirs().map((dir) => {
    const manifest: unknown = JSON.parse(readFileSync(join(root, "packages", dir, "package.json"), "utf8"));
    const declared = field(manifest, "name");
    const name = typeof declared === "string" ? declared : dir;
    const exportsField = field(manifest, "exports");
    const readme = join(root, "packages", dir, "README.md");
    const summary = existsSync(readme)
      ? (readFileSync(readme, "utf8").split("\n\n").find((block) => block.trim() !== "" && !block.startsWith("#")) ?? "").trim()
      : "";
    const owned = all.filter((a) => a.package === name);
    return {
      name,
      dir: `packages/${dir}`,
      exports: typeof exportsField === "object" && exportsField !== null ? Object.keys(exportsField) : [],
      summary,
      assets: Object.fromEntries(kindCounts(owned, assetKinds)),
    };
  });
  return ok("packages", rows);
}

/** `{ id: { key: n } }` from parsed JSON: the numbers of each row, whatever else the row holds. */
const numbersById = (rows: unknown): Record<string, Record<string, number>> => {
  const result: Record<string, Record<string, number>> = {};
  if (typeof rows !== "object" || rows === null) return result;
  for (const [id, value] of Object.entries(rows)) {
    const row: unknown = value;
    const numbers: Record<string, number> = {};
    if (typeof row === "object" && row !== null) for (const [key, n] of Object.entries(row)) if (typeof n === "number") numbers[key] = n;
    result[id] = numbers;
  }
  return result;
};

/**
 * Every budget in assets/budgets.json against the last measurement: the pipeline's models (tools/assets/dist/report.json),
 * and the bundles and objects the size check measured (tools/assets/sizes.json, written by `bun run validate`).
 */
export function budgets(): Envelope {
  const reportPath = join(root, "tools/assets/dist/report.json");
  const sizesPath = join(root, "tools/assets/sizes.json");
  if (!existsSync(reportPath)) return fail("budgets", "not_built", "no asset report yet; run `bun run build`");
  if (!existsSync(sizesPath)) return fail("budgets", "not_built", "no size report yet; run `bun run build`, then `bun run validate`");
  const limits: unknown = JSON.parse(readFileSync(join(root, "assets/budgets.json"), "utf8"));
  const report: unknown = JSON.parse(readFileSync(reportPath, "utf8"));
  const sizes: unknown = JSON.parse(readFileSync(sizesPath, "utf8"));
  const families = [
    { family: "model", limit: field(limits, "models"), actual: numbersById(report) },
    { family: "bundle", limit: field(limits, "bundles"), actual: numbersById(field(sizes, "bundles")) },
    { family: "object", limit: field(limits, "objects"), actual: numbersById(field(sizes, "objects")) },
  ] as const;
  const rows = families.flatMap(({ family, limit, actual }) =>
    Object.entries(numbersById(limit)).map(([id, max]) => {
      const measured = actual[id] ?? {};
      const checks = Object.entries(max).map(([key, budget]) => ({ key, actual: measured[key] ?? null, budget, ok: (measured[key] ?? Infinity) <= budget }));
      return { family, id, ok: checks.every((c) => c.ok), checks, bytes: measured["bytes"] ?? measured["gzipBytes"] ?? null };
    }),
  );
  return ok("budgets", rows);
}

export function boundaries(packageName?: string): Envelope {
  const require = createRequire(import.meta.url);
  const config: unknown = require(join(root, ".dependency-cruiser.cjs"));
  const raw = field(config, "forbidden");
  const forbidden: readonly unknown[] = Array.isArray(raw) ? raw : [];
  const rules = forbidden.map((rule) => ({
    name: field(rule, "name") ?? null,
    comment: field(rule, "comment") ?? null,
    from: field(rule, "from") ?? null,
    to: field(rule, "to") ?? null,
  }));
  const relevant = packageName === undefined ? rules : rules.filter((r) => JSON.stringify(r.from).includes(packageName.replace(/^@hedronite\/lts-/, "")));
  return ok("boundaries", { source: ".dependency-cruiser.cjs", rules: relevant });
}

/** The gate, in CI order. */
const checkSteps = ["icons:check", "typecheck", "build", "validate", "test", "lint", "boundaries", "knip", "e2e"] as const;

export function check(options: { readonly only?: readonly string[]; readonly keepGoing?: boolean }): Envelope {
  const unknown = (options.only ?? []).filter((step) => !checkSteps.some((s) => s === step));
  if (unknown.length > 0) return fail("check", "usage", `unknown step(s): ${unknown.join(", ")}; steps are ${checkSteps.join(", ")}`);
  const steps = options.only === undefined || options.only.length === 0 ? checkSteps : checkSteps.filter((s) => options.only?.includes(s));
  const results: { step: string; ok: boolean; ms: number; tail: string[] }[] = [];
  for (const step of steps) {
    const started = Date.now();
    const run = spawnSync("bun", ["run", step], { cwd: root, encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
    const output = `${run.stdout}${run.stderr}`.split("\n").filter((line) => line.trim() !== "");
    results.push({ step, ok: run.status === 0, ms: Date.now() - started, tail: output.slice(-15) });
    if (run.status !== 0 && options.keepGoing !== true) break;
  }
  const passed = results.every((r) => r.ok) && results.length === steps.length;
  if (!passed) {
    const failed = results.filter((r) => !r.ok).map((r) => r.step);
    return fail("check", "failed", `failed: ${failed.join(", ")}`, { data: { steps: results } });
  }
  return ok("check", { steps: results });
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALLOWED = /^(svg|path|circle|ellipse|line|polyline|polygon|rect)$/;

export interface NewIconOptions {
  readonly name: string;
  readonly tags: readonly string[];
  readonly svg: string;
  readonly dryRun?: boolean;
  readonly today?: string;
}

/** Adds a source icon: assets/src/icons/<id>.svg plus its entry in icons.json. Run `bun run icons` after. */
export function newIcon(id: string, options: NewIconOptions): Envelope {
  if (!SLUG.test(id)) return fail("new-icon", "usage", `id "${id}" must be a lowercase slug like "arrow-up-right"`);
  if (options.name.trim() === "") return fail("new-icon", "usage", "--name is required");
  if (options.tags.length === 0 || !options.tags.every((t) => SLUG.test(t))) return fail("new-icon", "usage", "--tags needs one or more slugs, comma-separated");
  if (registry.get(id) !== undefined || existsSync(join(root, "assets/src/icons", `${id}.svg`))) return fail("new-icon", "exists", `an asset or icon source "${id}" already exists`);
  const svg = options.svg.trim();
  if (!/^<svg\b[^>]*viewBox="0 0 24 24"/.test(svg)) return fail("new-icon", "invalid", 'the SVG must start with <svg … viewBox="0 0 24 24">');
  const tags = [...svg.matchAll(/<([a-zA-Z][\w-]*)\b/g)].map((m) => m[1] ?? "");
  const disallowed = [...new Set(tags.filter((t) => !ALLOWED.test(t)))];
  if (disallowed.length > 0) return fail("new-icon", "invalid", `elements not allowed in a stroke icon: ${disallowed.join(", ")}`);
  if (/\b(fill|stroke|style|class)=/.test(svg.replace(/^<svg\b[^>]*>/, ""))) return fail("new-icon", "invalid", "drop fill, stroke, style and class: the renderer applies the stroke style");
  const metaPath = join(root, "assets/src/icons/icons.json");
  const meta: unknown = JSON.parse(readFileSync(metaPath, "utf8"));
  const entries: [string, unknown][] = typeof meta === "object" && meta !== null ? Object.entries(meta) : [];
  const added = options.today ?? new Date().toISOString().slice(0, 10);
  entries.push([id, { name: options.name.trim(), tags: options.tags, added }]);
  const next = Object.fromEntries(entries.sort((a, b) => a[0].localeCompare(b[0])));
  const plan = { svgPath: `assets/src/icons/${id}.svg`, metaPath: "assets/src/icons/icons.json", entry: { name: options.name.trim(), tags: options.tags, added }, next: "bun run icons" };
  if (options.dryRun === true) return ok("new-icon", { ...plan, dryRun: true });
  writeFileSync(join(root, plan.svgPath), `${svg}\n`);
  writeFileSync(metaPath, `${JSON.stringify(next, null, 2)}\n`);
  return ok("new-icon", { ...plan, dryRun: false });
}

/** The icon packs (other people's open-source icon sets, as data): id, size, license and credit. */
export function iconPacks(): Envelope {
  return ok("icon-packs", { packs: packList.map((pack) => ({ ...pack, import: `@hedronite/lts-icons/packs/${pack.id}` })), total: packList.reduce((sum, pack) => sum + pack.count, 0) });
}
