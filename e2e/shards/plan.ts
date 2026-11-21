// The e2e shard plan (SPEC-wave9 R18). Playwright's own `--shard=N/M` splits the tests by count, so a shard of slow tests runs several times longer than a
// shard of quick ones. This plan splits them by measured run time instead: `plan.json` lists, for each shard, the test locations (`file:line`) it runs, and
// CI hands a shard its list (`bunx playwright test $(bun e2e/shards/plan.ts args N)`).
//
//   bun e2e/shards/plan.ts timings LOGDIR...   read the e2e shard logs of recent runs on main into timings.json (the logs are fetched with `gh api
//                                               repos/OWNER/REPO/actions/jobs/JOB_ID/logs`, one file per shard, named RUN-e2e-SHARD.log)
//   bun e2e/shards/plan.ts generate            write plan.json from timings.json and the tests Playwright lists now
//   bun e2e/shards/plan.ts check               fail when plan.json is not what `generate` writes now: a test added or removed, or a hand edit
//   bun e2e/shards/plan.ts args N              the locations of shard N, for the Playwright command line
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = import.meta.dirname;
const TIMINGS = join(here, "timings.json");
const PLAN = join(here, "plan.json");
const root = resolve(here, "../..");
/** How many shards CI runs (the matrix of the `e2e` and `container-e2e` jobs). */
export const SHARDS = 6;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const UNITS: Readonly<Record<string, number>> = { ms: 0.001, s: 1, m: 60, h: 3600 };
const seconds = (amount: string, unit: string): number => Number(amount) * (UNITS[unit] ?? 1);
const round = (value: number): number => Math.round(value * 10) / 10;

// ---- reading the logs of CI runs ---------------------------------------------------------------------------------------

/** What a log of one shard says: each test location's total seconds (a loop of tests shares a location), and the shard's own total. */
export interface ShardLog {
  readonly locations: ReadonlyMap<string, number>;
  readonly total: number | undefined;
}

const PASSED = /[✓]\s+\d+ \[[^\]]+\] › (e2e\/\S+?):(\d+):\d+ › .*\((\d+(?:\.\d+)?)(ms|s|m|h)\)\s*$/;
const TOTAL = /\b\d+ passed \((\d+(?:\.\d+)?)(ms|s|m|h)\)/;

/** Playwright's list reporter lines in a CI log: `✓  20 [chromium] › e2e/file.spec.ts:40:1 › the title (46.7s)`. */
export function parseLog(text: string): ShardLog {
  const locations = new Map<string, number>();
  let total: number | undefined;
  for (const line of text.split("\n")) {
    const passed = PASSED.exec(line);
    if (passed !== null) {
      const place = `${passed[1] ?? ""}:${passed[2] ?? ""}`;
      locations.set(place, (locations.get(place) ?? 0) + seconds(passed[3] ?? "0", passed[4] ?? "s"));
      continue;
    }
    const done = TOTAL.exec(line);
    if (done !== null) total = seconds(done[1] ?? "0", done[2] ?? "s");
  }
  return { locations, total };
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length === 0 ? 0 : sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

interface Timings {
  /** The CI runs on main the numbers come from, with how long each shard's Playwright run took in each. */
  readonly runs: readonly { readonly run: string; readonly shardSeconds: Readonly<Record<string, number>> }[];
  /** Each test location's median seconds over the runs that had it. */
  readonly locations: Readonly<Record<string, { readonly seconds: number; readonly runs: number }>>;
}

/** Timings from the shard logs in `dirs`, named RUN-e2e-SHARD.log: per run, the logs of all its shards make one count of each location. */
export function timingsOf(files: readonly { readonly name: string; readonly text: string }[]): Timings {
  const perRun = new Map<string, Map<string, number>>();
  const shardSeconds = new Map<string, Record<string, number>>();
  for (const { name, text } of files) {
    const match = /^(\d+)-e2e-(\d+)\.log$/.exec(name);
    if (match === null) continue;
    const [, run = "", shard = ""] = match;
    const log = parseLog(text);
    const locations = perRun.get(run) ?? new Map<string, number>();
    for (const [place, took] of log.locations) locations.set(place, (locations.get(place) ?? 0) + took);
    perRun.set(run, locations);
    shardSeconds.set(run, { ...(shardSeconds.get(run) ?? {}), [shard]: round(log.total ?? 0) });
  }
  const samples = new Map<string, number[]>();
  for (const locations of perRun.values()) for (const [place, took] of locations) samples.set(place, [...(samples.get(place) ?? []), took]);
  const entries = [...samples].sort(([a], [b]) => a.localeCompare(b)).map(([place, values]) => [place, { seconds: round(median(values)), runs: values.length }] as const);
  return {
    runs: [...perRun.keys()].sort().map((run) => ({ run, shardSeconds: shardSeconds.get(run) ?? {} })),
    locations: Object.fromEntries(entries),
  };
}

// ---- balancing ------------------------------------------------------------------------------------------------------

export interface Shard {
  readonly shard: number;
  readonly seconds: number;
  readonly locations: readonly string[];
}

/** Longest first, each to the shard with the least so far (ties to the lowest shard): the same input always gives the same plan. */
export function balance(weights: ReadonlyMap<string, number>, shards: number): readonly Shard[] {
  const buckets = Array.from({ length: shards }, () => ({ seconds: 0, locations: new Array<string>() }));
  const ordered = [...weights].sort(([aPlace, a], [bPlace, b]) => b - a || aPlace.localeCompare(bPlace));
  for (const [place, took] of ordered) {
    let lightest = 0;
    for (let index = 1; index < buckets.length; index += 1) if ((buckets[index]?.seconds ?? 0) < (buckets[lightest]?.seconds ?? 0)) lightest = index;
    const bucket = buckets[lightest];
    if (bucket === undefined) continue;
    bucket.seconds += took;
    bucket.locations.push(place);
  }
  return buckets.map((bucket, index) => ({ shard: index + 1, seconds: round(bucket.seconds), locations: [...bucket.locations].sort() }));
}

/** The plan as the file holds it. */
export interface Plan {
  readonly shards: number;
  /** The longest single test location, in seconds: no plan can have a shard faster than it. */
  readonly longestSeconds: number;
  readonly mean: number;
  readonly slowest: number;
  readonly plan: readonly Shard[];
}

/** A plan for the tests that exist (`locations`), weighing each by its timing, or by the median of the timings when it has none yet. */
export function planFor(locations: readonly string[], timings: Timings, shards: number): Plan {
  const known = Object.values(timings.locations).map((entry) => entry.seconds);
  const fallback = round(median(known));
  const weights = new Map(locations.map((place) => [place, timings.locations[place]?.seconds ?? fallback] as const));
  const plan = balance(weights, shards);
  const total = plan.reduce((sum, shard) => sum + shard.seconds, 0);
  return { shards, longestSeconds: Math.max(0, ...weights.values()), mean: round(total / shards), slowest: Math.max(0, ...plan.map((shard) => shard.seconds)), plan };
}

// ---- the command line -----------------------------------------------------------------------------------------------

/** Every test location (`e2e/file.spec.ts:line`) Playwright runs in the default project, from its own listing. */
function listed(): readonly string[] {
  const run = spawnSync("bunx", ["playwright", "test", "--list", "--reporter=json"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run.error !== undefined || run.status !== 0) throw new Error(`playwright --list failed: ${run.error?.message ?? run.stderr}`);
  const found: unknown = JSON.parse(run.stdout);
  const places = new Set<string>();
  const visit = (suite: unknown): void => {
    if (!isRecord(suite)) return;
    const specs: unknown = suite["specs"];
    for (const spec of Array.isArray(specs) ? specs : []) {
      if (isRecord(spec) && typeof spec["file"] === "string" && typeof spec["line"] === "number") places.add(`e2e/${spec["file"]}:${String(spec["line"])}`);
    }
    const children: unknown = suite["suites"];
    for (const child of Array.isArray(children) ? children : []) visit(child);
  };
  visit(found);
  return [...places].sort();
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function readTimings(): Timings {
  const found = readJson(TIMINGS);
  if (!isRecord(found) || !isRecord(found["locations"])) throw new Error(`${TIMINGS} is not a timings file`);
  const locations: Record<string, { seconds: number; runs: number }> = {};
  for (const [place, entry] of Object.entries(found["locations"])) {
    if (isRecord(entry) && typeof entry["seconds"] === "number" && typeof entry["runs"] === "number") locations[place] = { seconds: entry["seconds"], runs: entry["runs"] };
  }
  return { runs: [], locations };
}

const text = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function main(argv: readonly string[]): number {
  const [command = "", ...rest] = argv;
  if (command === "timings") {
    const files = rest.flatMap((dir) => readdirSync(dir).map((name) => ({ name: basename(name), text: readFileSync(join(dir, name), "utf8") })));
    const timings = timingsOf(files);
    writeFileSync(TIMINGS, text(timings));
    console.log(`${String(Object.keys(timings.locations).length)} test locations from ${String(timings.runs.length)} runs`);
    return 0;
  }
  if (command === "generate" || command === "check") {
    const plan = planFor(listed(), readTimings(), SHARDS);
    const made = text(plan);
    if (command === "generate") {
      writeFileSync(PLAN, made);
      console.log(`${plan.plan.map((shard) => `${String(shard.shard)}: ${String(shard.seconds)} s, ${String(shard.locations.length)} tests`).join(" | ")} | mean ${String(plan.mean)} s, slowest ${String(plan.slowest)} s`);
      return 0;
    }
    if (readFileSync(PLAN, "utf8") === made) return 0;
    console.error("e2e/shards/plan.json is not what `bun e2e/shards/plan.ts generate` writes now: a test was added, moved or removed, or the file was edited by hand. Run it and commit the result.");
    return 1;
  }
  if (command === "args") {
    const n = Number(rest[0]);
    const found = readJson(PLAN);
    const planned: unknown = isRecord(found) ? found["plan"] : undefined;
    const shards: readonly unknown[] = Array.isArray(planned) ? planned : [];
    const shard = shards.find((entry) => isRecord(entry) && entry["shard"] === n);
    const places: unknown = isRecord(shard) ? shard["locations"] : undefined;
    if (!Array.isArray(places)) throw new RangeError(`there is no shard ${String(rest[0])} in the plan`);
    console.log(places.join(" "));
    return 0;
  }
  console.error("usage: plan.ts timings LOGDIR... | generate | check | args N");
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
