// Checks every package's manifest together, the way an app that uses them all would load them:
//   schema and registration (an id used by two packages fails here),
//   every asset dated, for the growth views,
//   every glTF object backed by a source model and a budget,
//   every 3D asset backed by a poster the manifest names, within its byte lines and made from what the asset is now (posters.ts),
//   what the apps ship and what each object costs to draw, within assets/budgets.json (sizes.ts; needs `bun run build`).
// `bun run validate` prints a summary; `--json` prints a machine-readable report. Exits 1 on any problem.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AssetKind } from "@hedronite/lts-core";
import { buildRegistry, loadDescriptors } from "@hedronite/lts-registry";
import { loadBudgets } from "./budgets.js";
import { checkPosters, loadPosterManifest, rigVersion } from "./posters.js";
import { checkSizes } from "./sizes.js";

const root = resolve(import.meta.dirname, "../../..");
const { registry, problems: registration } = buildRegistry();
const problems: string[] = [...registration];

const budgets = await loadBudgets(root);
const hasBudget = (id: string): boolean => Object.hasOwn(budgets.models, id);

const assets = registry.list();
for (const asset of assets) {
  if (asset.added === undefined) problems.push(`${asset.id}: no "added" date`);
  if (asset.kind === "object" && asset.tags.includes("gltf")) {
    if (!existsSync(join(root, "assets/src/models", `${asset.id}.json`))) problems.push(`${asset.id}: no source model in assets/src/models`);
    if (!hasBudget(asset.id)) problems.push(`${asset.id}: no model budget in assets/budgets.json`);
  }
}

const descriptors = await loadDescriptors();
const posters = checkPosters(
  root,
  assets.flatMap((meta) => {
    const descriptor = descriptors.get(meta.id);
    return descriptor === undefined ? [] : [{ meta, defaults: descriptor.defaults }];
  }),
  await loadPosterManifest(root),
  budgets.posters,
  rigVersion(root),
);
problems.push(...posters.problems);

const sizes = await checkSizes(root);
problems.push(...sizes.problems);

const counts: Partial<Record<AssetKind, number>> = {};
for (const asset of assets) counts[asset.kind] = (counts[asset.kind] ?? 0) + 1;

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ok: problems.length === 0, total: assets.length, counts, posters: { count: posters.count, totalBytes: posters.totalBytes }, problems }, null, 2));
} else {
  console.log(`validate: ${String(assets.length)} assets (${Object.entries(counts).map(([kind, n]) => `${String(n)} ${kind}`).join(", ")}), ${String(sizes.rows.length)} budgeted`);
  for (const row of sizes.rows) console.log(`  ${row.id}: ${row.checks.map((check) => `${check.key} ${String(check.actual)} of ${String(check.budget)}`).join(", ")}`);
  console.log(`  posters: ${String(posters.count)} totalling ${String(posters.totalBytes)} bytes${posters.largest === undefined ? "" : `, largest ${posters.largest.id} at ${String(posters.largest.bytes)}`}${budgets.posters === undefined ? "" : ` (limits ${String(budgets.posters.perPosterBytes)} each, ${String(budgets.posters.totalBytes)} in all)`}`);
  for (const problem of problems) console.error(`  ${problem}`);
}
if (problems.length > 0) process.exit(1);
