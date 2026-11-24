// The e2e shard plan (SPEC-wave9 R18). Playwright's own `--shard=N/M` splits the tests by count, so a shard of slow tests runs several times longer than a
// shard of quick ones. This plan splits them by measured run time instead: `plan.json` lists, for each shard, the test locations (`file:line`) it runs, and
// CI hands a shard its list (`bunx playwright test $(bun e2e/shards/plan.ts args N)`).
//
//   bun e2e/shards/plan.ts timings LOGDIR...   read the e2e shard logs of recent runs on main into timings.json (the logs are fetched with `gh api
//                                               repos/OWNER/REPO/actions/jobs/JOB_ID/logs`, one file per shard, named RUN-e2e-SHARD.log)
//   bun e2e/shards/plan.ts generate [--rebalance]  write plan.json: a test keeps the shard the plan on file gives it, and only a test the plan
//                                               does not have is placed, on the shard with the least on it. `--rebalance` plans every test from
//                                               scratch (SPEC-wave10 G0: regenerating from scratch moved 58 tests for 4 new ones, R36)
//   bun e2e/shards/plan.ts check               fail when plan.json is not the sticky plan now: a test added, removed or moved, or a shard whose
//                                               seconds are not its own
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

/** Each location's weight: its median timing, or, for a location no run has timed, the median of every location that has one. */
function weighed(locations: readonly string[], timings: Timings): { readonly weights: ReadonlyMap<string, number>; readonly fallback: number } {
  const known = Object.values(timings.locations).map((entry) => entry.seconds);
  const fallback = round(median(known));
  return { weights: new Map(locations.map((place) => [place, timings.locations[place]?.seconds ?? fallback] as const)), fallback };
}

/** A plan's own sums, from the shards it holds: the mean of them, the slowest of them, and the longest single test no plan can beat. */
function summarise(plan: readonly Shard[], shards: number, weights: Iterable<number>): Plan {
  const total = plan.reduce((sum, shard) => sum + shard.seconds, 0);
  return {
    shards,
    longestSeconds: Math.max(0, ...weights),
    mean: round(total / shards),
    slowest: Math.max(0, ...plan.map((shard) => shard.seconds)),
    plan,
  };
}

/** A plan for the tests that exist (`locations`), weighing each by its timing, or by the median of the timings when it has none. */
export function planFor(locations: readonly string[], timings: Timings, shards: number): Plan {
  const { weights } = weighed(locations, timings);
  return summarise(balance(weights, shards), shards, weights.values());
}

/**
 * A plan that keeps every test where the plan on file has it and places only the tests it does not have yet, each on the shard with the least
 * on it (ties to the lowest), which is what keeps a plan from moving when tests are added (SPEC-wave10 G0, R36's follow-up). A test the file
 * has and Playwright no longer lists is dropped. With no plan to keep — none, one for another count of shards, or `--rebalance` — every test
 * is placed from scratch, as `planFor` does.
 */
export function stickyPlan(existing: Plan | undefined, locations: readonly string[], timings: Timings, shards: number): Plan {
  const keeping = existing !== undefined && existing.shards === shards ? existing.plan : undefined;
  if (keeping === undefined) return planFor(locations, timings, shards);
  const { weights, fallback } = weighed(locations, timings);
  const stillListed = new Set(locations);
  const placed = new Set<string>();
  const buckets = Array.from({ length: shards }, () => ({ seconds: 0, locations: new Array<string>() }));
  for (const shard of keeping) {
    const bucket = buckets[shard.shard - 1];
    if (bucket === undefined) continue;
    for (const place of shard.locations) {
      if (!stillListed.has(place) || placed.has(place)) continue;
      placed.add(place);
      bucket.seconds += weights.get(place) ?? fallback;
      bucket.locations.push(place);
    }
  }
  for (const place of stillListed) {
    if (placed.has(place)) continue;
    let lightest = 0;
    for (let index = 1; index < buckets.length; index += 1) if ((buckets[index]?.seconds ?? 0) < (buckets[lightest]?.seconds ?? 0)) lightest = index;
    const bucket = buckets[lightest];
    if (bucket === undefined) continue;
    bucket.seconds += weights.get(place) ?? fallback;
    bucket.locations.push(place);
  }
  return summarise(
    buckets.map((bucket, index) => ({ shard: index + 1, seconds: round(bucket.seconds), locations: [...bucket.locations] })),
    shards,
    weights.values(),
  );
}

/** What a new plan does to the plan on file: how many tests change shard, how many it places for the first time, and how many it drops. */
export function movedBetween(before: Plan | undefined, after: Plan): { readonly moved: number; readonly added: number; readonly dropped: number } {
  const was = new Map<string, number>();
  for (const shard of before?.plan ?? []) for (const place of shard.locations) was.set(place, shard.shard);
  const now = new Map<string, number>();
  for (const shard of after.plan) for (const place of shard.locations) now.set(place, shard.shard);
  let moved = 0;
  let added = 0;
  for (const [place, shard] of now) {
    const before = was.get(place);
    if (before === undefined) added += 1;
    else if (before !== shard) moved += 1;
  }
  let dropped = 0;
  for (const place of was.keys()) if (!now.has(place)) dropped += 1;
  return { moved, added, dropped };
}

/** The first thing that makes a plan on file not the plan `wrote`, in the words of a failure, or nothing when it is that plan. */
export function planDifference(onFile: Plan | undefined, wrote: Plan): string | undefined {
  if (onFile === undefined) return "e2e/shards/plan.json is missing or is not a plan: run `bun run shards:plan` and commit the result";
  if (onFile.shards !== wrote.shards) return `e2e/shards/plan.json plans ${String(onFile.shards)} shards; CI runs ${String(wrote.shards)}`;
  const was = new Map<string, number>();
  for (const shard of onFile.plan) for (const place of shard.locations) was.set(place, shard.shard);
  const now = new Map<string, number>();
  for (const shard of wrote.plan) for (const place of shard.locations) now.set(place, shard.shard);
  for (const [place, shard] of now) {
    const before = was.get(place);
    if (before === undefined) return `e2e/shards/plan.json does not place ${place}, which shard ${String(shard)} runs: run \`bun run shards:plan\``;
    if (before !== shard) return `e2e/shards/plan.json puts ${place} in shard ${String(before)}; the sticky plan gives it shard ${String(shard)}`;
  }
  for (const place of was.keys()) if (!now.has(place)) return `e2e/shards/plan.json still places ${place}, which Playwright no longer lists`;
  for (const shard of wrote.plan) {
    const said = onFile.plan.find((entry) => entry.shard === shard.shard);
    if (said === undefined) return `e2e/shards/plan.json has no shard ${String(shard.shard)}`;
    if (said.seconds !== shard.seconds) {
      return `e2e/shards/plan.json says shard ${String(shard.shard)} takes ${String(said.seconds)} s; its own locations weigh ${String(shard.seconds)} s`;
    }
  }
  if (onFile.mean !== wrote.mean || onFile.slowest !== wrote.slowest || onFile.longestSeconds !== wrote.longestSeconds) {
    return "e2e/shards/plan.json's mean, slowest or longest is not the one its shards give: the file was edited by hand or is stale";
  }
  return undefined;
}

// ---- the command line -----------------------------------------------------------------------------------------------

/** Every test location (`e2e/file.spec.ts:line`) Playwright runs in the default project, from its own listing. */
function listed(): readonly string[] {
  const run = spawnSync("bunx", ["playwright", "test", "--list", "--reporter=json"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run.error !== undefined) throw new Error(`playwright --list failed: ${run.error.message}`);
  const found: unknown = JSON.parse(run.stdout);
  if (run.status !== 0) {
    // Playwright reports a spec it cannot load (a package that is not built yet, for one) in the listing's `errors`, with nothing on stderr.
    const errors: unknown = isRecord(found) ? found["errors"] : undefined;
    const said = (Array.isArray(errors) ? errors : []).map((error) => (isRecord(error) && typeof error["message"] === "string" ? error["message"].split("\n")[0] : "")).join("; ");
    throw new Error(`playwright --list failed: ${said === "" ? run.stderr : said} (the specs import built packages: run bun run build first)`);
  }
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

/** The plan on file, as this file writes it, or nothing when it is not there or not a plan that can be kept. */
function readPlan(): Plan | undefined {
  let found: unknown;
  try {
    found = readJson(PLAN);
  } catch {
    return undefined;
  }
  if (!isRecord(found) || !Array.isArray(found["plan"])) return undefined;
  const { shards, longestSeconds, mean, slowest } = found;
  if (typeof shards !== "number" || typeof longestSeconds !== "number" || typeof mean !== "number" || typeof slowest !== "number") return undefined;
  const plan: Shard[] = [];
  for (const entry of found["plan"]) {
    if (!isRecord(entry) || typeof entry["shard"] !== "number" || typeof entry["seconds"] !== "number" || !Array.isArray(entry["locations"])) return undefined;
    const locations = entry["locations"].filter((place): place is string => typeof place === "string");
    plan.push({ shard: entry["shard"], seconds: entry["seconds"], locations });
  }
  return { shards, longestSeconds, mean, slowest, plan };
}

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
    const rebalance = rest.includes("--rebalance");
    if (command === "check" && rest.length > 0) {
      console.error("usage: plan.ts generate [--rebalance] | check | args N");
      return 2;
    }
    const onFile = readPlan();
    const wrote = stickyPlan(rebalance ? undefined : onFile, listed(), readTimings(), SHARDS);
    if (command === "generate") {
      writeFileSync(PLAN, text(wrote));
      const moves = movedBetween(onFile, wrote);
      console.log(
        `${String(wrote.plan.reduce((count, shard) => count + shard.locations.length, 0))} tests in ${String(SHARDS)} shards${rebalance ? ", rebalanced" : ""}: mean ${String(wrote.mean)} s, slowest ${String(wrote.slowest)} s; ${String(moves.moved)} moved, ${String(moves.added)} added, ${String(moves.dropped)} dropped`,
      );
      return 0;
    }
    const said = planDifference(onFile, wrote);
    if (said === undefined) return 0;
    console.error(said);
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
  console.error("usage: plan.ts timings LOGDIR... | generate [--rebalance] | check | args N");
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
