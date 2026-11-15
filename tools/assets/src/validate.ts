// Checks every package's manifest together, the way an app that uses them all would load them:
//   schema and registration (an id used by two packages fails here),
//   every asset dated, for the growth views,
//   every glTF object backed by a source model and a budget.
// `bun run validate` prints a summary; `--json` prints a machine-readable report. Exits 1 on any problem.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AssetKind } from "@hedronite/lts-core";
import { buildRegistry } from "lumin/registry";

const root = resolve(import.meta.dirname, "../../..");
const { registry, problems: registration } = buildRegistry();
const problems: string[] = [...registration];

const budgets: unknown = JSON.parse(await readFile(join(root, "assets/budgets.json"), "utf8"));
const hasBudget = (id: string): boolean => typeof budgets === "object" && budgets !== null && Object.hasOwn(budgets, id);

const assets = registry.list();
for (const asset of assets) {
  if (asset.added === undefined) problems.push(`${asset.id}: no "added" date`);
  if (asset.kind === "object" && asset.tags.includes("gltf")) {
    if (!existsSync(join(root, "assets/src/models", `${asset.id}.json`))) problems.push(`${asset.id}: no source model in assets/src/models`);
    if (!hasBudget(asset.id)) problems.push(`${asset.id}: no budget in assets/budgets.json`);
  }
}

const counts: Partial<Record<AssetKind, number>> = {};
for (const asset of assets) counts[asset.kind] = (counts[asset.kind] ?? 0) + 1;

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ok: problems.length === 0, total: assets.length, counts, problems }, null, 2));
} else {
  console.log(`validate: ${String(assets.length)} assets (${Object.entries(counts).map(([kind, n]) => `${String(n)} ${kind}`).join(", ")})`);
  for (const problem of problems) console.error(`  ${problem}`);
}
if (problems.length > 0) process.exit(1);
