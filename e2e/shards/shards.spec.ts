import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { balance, median, movedBetween, overBar, parseLog, planDifference, planFor, planOf, SHARDS, stickyPlan, timingsOf } from "./plan.js";

// The shard plan's own arithmetic, and the plan file it wrote (e2e/shards/plan.ts). No browser: these are pure.

const LOG = [
  "2026-11-21T17:39:37.2399320Z   ✓  20 [chromium] › e2e/mcp/render.spec.ts:40:1 › scene_render draws a document (46.7s)",
  "2026-11-21T17:39:37.3294822Z   ✓  21 [chromium] › e2e/mcp/render.spec.ts:86:1 › scene_render is not there (540ms)",
  "2026-11-21T17:38:48.2956123Z   ✓   4 [chromium] › e2e/element.spec.ts:307:1 › twenty cycles of disconnecting (1.7m)",
  "2026-11-21T17:38:50.0000000Z   ✓  18 [chromium] › e2e/looks.spec.ts:103:3 › the material lineup recolors in place (2.0s)",
  "2026-11-21T17:38:51.0000000Z   ✓  19 [chromium] › e2e/looks.spec.ts:103:3 › the material lineup recolors in place (3.0s)",
  "2026-11-21T17:38:52.0000000Z   ✘  22 [chromium] › e2e/failing.spec.ts:5:1 › a test that failed (9.0s)",
  "2026-11-21T17:38:53.0000000Z   some other line (4.0s)",
  "2026-11-21T17:42:10.3976082Z   34 passed (5.2m)",
].join("\n");

test("reads each passed test's location and time from a CI log: seconds, milliseconds and minutes, a loop summed, a failure and other lines left out", () => {
  const log = parseLog(LOG);
  expect([...log.locations]).toEqual([
    ["e2e/mcp/render.spec.ts:40", 46.7],
    ["e2e/mcp/render.spec.ts:86", 0.54],
    ["e2e/element.spec.ts:307", 102],
    ["e2e/looks.spec.ts:103", 5],
  ]);
  expect(log.total).toBe(312);
});

test("takes the median of a location's time over the runs, and counts a run's shards once", () => {
  expect(median([3, 1, 2])).toBe(2);
  expect(median([4, 1, 2, 3])).toBe(2.5);
  expect(median([])).toBe(0);
  const one = "  ✓  1 [chromium] › e2e/a.spec.ts:1:1 › a (10.0s)\n  1 passed (10.0s)";
  const two = "  ✓  1 [chromium] › e2e/a.spec.ts:1:1 › a (30.0s)\n  ✓  2 [chromium] › e2e/b.spec.ts:2:1 › b (5.0s)\n  2 passed (35.0s)";
  const timings = timingsOf([
    { name: "100-e2e-1.log", text: one },
    { name: "101-e2e-1.log", text: two },
    { name: "101-e2e-2.log", text: "  ✓  1 [chromium] › e2e/c.spec.ts:3:1 › c (20.0s)\n  1 passed (20.0s)" },
    { name: "notes.txt", text: "ignored" },
  ]);
  expect(timings.locations).toEqual({ "e2e/a.spec.ts:1": { seconds: 20, runs: 2 }, "e2e/b.spec.ts:2": { seconds: 5, runs: 1 }, "e2e/c.spec.ts:3": { seconds: 20, runs: 1 } });
  expect(timings.runs).toEqual([{ run: "100", shardSeconds: { "1": 10 } }, { run: "101", shardSeconds: { "1": 35, "2": 20 } }]);
});

test("balances longest first onto the lightest shard, so the same weights always give the same plan, each location once", () => {
  const weights = new Map([["a", 9], ["b", 7], ["c", 6], ["d", 5], ["e", 4], ["f", 3], ["g", 1]]);
  const plan = balance(weights, 3);
  expect(plan.map((shard) => shard.seconds)).toEqual([12, 12, 11]);
  expect(plan.flatMap((shard) => shard.locations).sort()).toEqual([...weights.keys()].sort());
  expect(balance(weights, 3)).toEqual(plan);
  expect(balance(new Map([["x", 5]]), 3).map((shard) => shard.locations)).toEqual([["x"], [], []]);
});

test("gives a test with no timing the median of the others, and says the longest test no plan can beat", () => {
  const timings = { runs: [], locations: { "e2e/a.spec.ts:1": { seconds: 100, runs: 3 }, "e2e/b.spec.ts:1": { seconds: 10, runs: 3 }, "e2e/c.spec.ts:1": { seconds: 20, runs: 3 } } };
  const plan = planFor(["e2e/a.spec.ts:1", "e2e/b.spec.ts:1", "e2e/c.spec.ts:1", "e2e/new.spec.ts:1"], timings, 2);
  expect(plan.longestSeconds).toBe(100);
  expect(plan.plan.flatMap((shard) => shard.locations).sort()).toEqual(["e2e/a.spec.ts:1", "e2e/b.spec.ts:1", "e2e/c.spec.ts:1", "e2e/new.spec.ts:1"]);
  expect(plan.plan[0]?.seconds).toBe(100);
  expect(plan.plan[1]?.seconds).toBe(50);
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

test("the plan on file holds every location once, in the shards CI runs, with sums that are its own, and within the bar", () => {
  const file: unknown = JSON.parse(readFileSync(join(import.meta.dirname, "plan.json"), "utf8"));
  if (!isRecord(file)) throw new Error("plan.json is not an object");
  const listed: unknown = file["plan"];
  const shards: readonly unknown[] = Array.isArray(listed) ? listed : [];
  expect(shards).toHaveLength(SHARDS);
  const locations: unknown[] = [];
  const sums: number[] = [];
  for (const shard of shards) {
    if (!isRecord(shard) || !Array.isArray(shard["locations"]) || typeof shard["seconds"] !== "number") throw new Error("a shard is not { seconds, locations }");
    const places: unknown[] = shard["locations"];
    locations.push(...places);
    sums.push(shard["seconds"]);
  }
  expect(locations.length).toBeGreaterThan(100);
  expect(new Set(locations).size).toBe(locations.length);
  expect(locations.every((place) => typeof place === "string" && /^e2e\/.+\.spec\.ts:\d+$/.test(place))).toBe(true);
  const mean = sums.reduce((a, b) => a + b, 0) / SHARDS;
  const longest = typeof file["longestSeconds"] === "number" ? file["longestSeconds"] : Infinity;
  expect(Math.max(...sums)).toBeLessThanOrEqual(Math.max(1.5 * mean, longest * 1.1));
});
// SPEC-wave10 G0: generate is sticky. A test already planned keeps its shard, and only a test the plan does not have is placed, so adding one
// moves none of the others (R36's follow-up: 4 new tests moved 58). These are the arithmetic of that, without a build.
test("sticky generate keeps a planned test in its shard and places a new one on the shard with the least on it", () => {
  const timings = { runs: [], locations: { "e2e/a.spec.ts:1": { seconds: 100, runs: 1 }, "e2e/b.spec.ts:1": { seconds: 50, runs: 1 } } };
  const first = planFor(["e2e/a.spec.ts:1", "e2e/b.spec.ts:1"], timings, 2);
  expect(first.plan.map((shard) => shard.locations)).toEqual([["e2e/a.spec.ts:1"], ["e2e/b.spec.ts:1"]]);
  // The new test has no timing, so it weighs the median of 100 and 50; it goes where there is less on.
  const next = stickyPlan(first, ["e2e/a.spec.ts:1", "e2e/b.spec.ts:1", "e2e/new.spec.ts:1"], timings, 2);
  expect(next.plan.map((shard) => shard.locations)).toEqual([["e2e/a.spec.ts:1"], ["e2e/b.spec.ts:1", "e2e/new.spec.ts:1"]]);
  expect(next.plan.map((shard) => shard.seconds)).toEqual([100, 125]);
  expect(movedBetween(first, next)).toEqual({ moved: 0, added: 1, dropped: 0 });
});
test("sticky generate keeps a shard the balance would not choose, and a test no longer listed leaves the plan", () => {
  const timings = { runs: [], locations: { "e2e/a.spec.ts:1": { seconds: 100, runs: 1 }, "e2e/b.spec.ts:1": { seconds: 50, runs: 1 } } };
  const handKept = {
    shards: 2,
    longestSeconds: 100,
    mean: 75,
    slowest: 100,
    plan: [
      { shard: 1, seconds: 50, locations: ["e2e/b.spec.ts:1"] },
      { shard: 2, seconds: 100, locations: ["e2e/a.spec.ts:1"] },
    ],
  };
  const next = stickyPlan(handKept, ["e2e/a.spec.ts:1", "e2e/b.spec.ts:1"], timings, 2);
  expect(next.plan.map((shard) => shard.locations)).toEqual([["e2e/b.spec.ts:1"], ["e2e/a.spec.ts:1"]]);
  expect(movedBetween(handKept, next)).toEqual({ moved: 0, added: 0, dropped: 0 });
  const afterDrop = stickyPlan(handKept, ["e2e/a.spec.ts:1"], timings, 2);
  expect(afterDrop.plan.map((shard) => shard.locations)).toEqual([[], ["e2e/a.spec.ts:1"]]);
  expect(afterDrop.plan.map((shard) => shard.seconds)).toEqual([0, 100]);
  expect(movedBetween(handKept, afterDrop)).toEqual({ moved: 0, added: 0, dropped: 1 });
});
test("--rebalance plans every test from scratch, as if there were no plan on file", () => {
  const timings = { runs: [], locations: { "e2e/a.spec.ts:1": { seconds: 100, runs: 1 }, "e2e/b.spec.ts:1": { seconds: 50, runs: 1 } } };
  const handKept = {
    shards: 2,
    longestSeconds: 100,
    mean: 75,
    slowest: 100,
    plan: [
      { shard: 1, seconds: 50, locations: ["e2e/b.spec.ts:1"] },
      { shard: 2, seconds: 100, locations: ["e2e/a.spec.ts:1"] },
    ],
  };
  expect(stickyPlan(handKept, ["e2e/a.spec.ts:1", "e2e/b.spec.ts:1"], timings, 2).plan[1]?.locations).toEqual(["e2e/a.spec.ts:1"]);
  expect(stickyPlan(undefined, ["e2e/a.spec.ts:1", "e2e/b.spec.ts:1"], timings, 2)).toEqual(planFor(["e2e/a.spec.ts:1", "e2e/b.spec.ts:1"], timings, 2));
});
test("check names the first thing that makes the plan on file stale or hand-edited", () => {
  const timings = { runs: [], locations: { "e2e/a.spec.ts:1": { seconds: 100, runs: 1 }, "e2e/b.spec.ts:1": { seconds: 50, runs: 1 } } };
  const wrote = planFor(["e2e/a.spec.ts:1", "e2e/b.spec.ts:1"], timings, 2);
  expect(planDifference(wrote, wrote)).toBeUndefined();
  expect(planDifference(undefined, wrote)).toContain("missing");
  const listed = ["e2e/a.spec.ts:1", "e2e/b.spec.ts:1", "e2e/new.spec.ts:1"];
  expect(planDifference(wrote, planFor(listed, timings, 2))).toContain("does not place e2e/new.spec.ts:1");
  expect(planDifference(wrote, planFor(["e2e/a.spec.ts:1"], timings, 2))).toContain("still places e2e/b.spec.ts:1");
  // A location swapped between two shards by hand, with the seconds left as they were.
  const edited = {
    ...wrote,
    plan: [
      { shard: 1, seconds: wrote.plan[0]?.seconds ?? 0, locations: ["e2e/b.spec.ts:1"] },
      { shard: 2, seconds: wrote.plan[1]?.seconds ?? 0, locations: ["e2e/a.spec.ts:1"] },
    ],
  };
  expect(planDifference(edited, stickyPlan(edited, ["e2e/a.spec.ts:1", "e2e/b.spec.ts:1"], timings, 2))).toContain("its own locations weigh");
});
test("says when a plan is past the W9 bar: 1.5 times the mean, or the longest test plus a tenth", () => {
  const within = { shards: 2, longestSeconds: 100, mean: 100, slowest: 140, plan: [] };
  const past = { shards: 2, longestSeconds: 100, mean: 100, slowest: 160, plan: [] };
  // A plan whose longest test is the whole shard is judged by that test plus a tenth, not by the mean.
  const byTheLongest = { shards: 2, longestSeconds: 300, mean: 200, slowest: 320, plan: [] };
  expect(overBar(within)).toBe(false);
  expect(overBar(past)).toBe(true);
  expect(overBar(byTheLongest)).toBe(false);
});
test("check refuses a plan that places a test twice, and a plan with an entry that is not a location at all", () => {
  const timings = { runs: [], locations: { "e2e/a.spec.ts:1": { seconds: 100, runs: 1 }, "e2e/b.spec.ts:1": { seconds: 50, runs: 1 } } };
  const listed = ["e2e/a.spec.ts:1", "e2e/b.spec.ts:1"];
  const wrote = planFor(listed, timings, 2);
  const [first, second] = wrote.plan;
  if (first === undefined || second === undefined) throw new Error("planFor gave fewer than two shards");
  // The same location twice in one shard runs that test twice on CI; the plan is refused, and the message names it.
  const twice = { ...wrote, plan: [{ ...first, locations: ["e2e/a.spec.ts:1", "e2e/a.spec.ts:1"] }, second] };
  expect(planDifference(twice, stickyPlan(twice, listed, timings, 2))).toContain("places e2e/a.spec.ts:1 twice in shard 1");
  // The same location in two shards loses one shard's copy of it, so that is named too.
  const across = {
    ...wrote,
    plan: [
      { ...first, locations: ["e2e/a.spec.ts:1"] },
      { ...second, locations: ["e2e/a.spec.ts:1", "e2e/b.spec.ts:1"] },
    ],
  };
  expect(planDifference(across, stickyPlan(across, listed, timings, 2))).toContain("places e2e/a.spec.ts:1 in shards 1 and 2");
  // A hand-edited entry that is not a location makes the whole file no plan, rather than being dropped and planned around.
  expect(planOf({ ...wrote, plan: [{ ...first, locations: ["e2e/a.spec.ts:1", 12345] }, second] })).toBeUndefined();
  expect(planOf({ ...wrote, plan: [{ ...first, locations: ["e2e/a.spec.ts:1", null] }, second] })).toBeUndefined();
  expect(planOf(wrote)).toEqual(wrote);
  expect(planOf({ shards: "2" })).toBeUndefined();
});
