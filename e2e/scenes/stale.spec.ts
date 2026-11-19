// The generated modules in e2e/scenes/generated/ are what the emitter writes, and nothing else: no Playwright browser, so it is in the default run and in CI.
// A module edited by hand, or left behind by a change to the document or the emitter, fails here; `bun run scenes:generate` writes them again.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test } from "@playwright/test";
import { emit, fixture, generatedPath, isCurrent } from "./emitted.js";
import { roundTrip } from "./fixtures.js";
import { planted, plantNames } from "./plants.js";

for (const name of roundTrip) {
  test(`the generated module of ${name} is what the emitter writes`, () => {
    expect(existsSync(generatedPath(name)), `no generated module for ${name}: bun run scenes:generate writes it`).toBe(true);
    expect(isCurrent(name, readFileSync(generatedPath(name), "utf8")), `${name}: the generated module is stale or edited by hand: bun run scenes:generate`).toBe(true);
  });
}

test("every generated module belongs to a fixture", () => {
  const known = new Set(roundTrip.map((name) => `${name}.ts`));
  expect(readdirSync(dirname(generatedPath(roundTrip[0]))).filter((file) => !known.has(file))).toEqual([]);
});

test("a module edited by hand, or left behind by a change to the document, is caught", () => {
  const name = roundTrip[0];
  const current = emit(fixture(name));
  expect(isCurrent(name, current)).toBe(true);
  expect(isCurrent(name, `${current}// edited\n`)).toBe(false);
  expect(isCurrent(name, current.replace(/[0-9]/, (digit) => String((Number(digit) + 1) % 10)))).toBe(false);
  const moved = planted(fixture(name), "moved-node");
  expect(moved === undefined ? true : isCurrent(name, emit(moved))).toBe(false);
});

test("each plant changes the emitted module, and applies where there is something to change", () => {
  let made = 0;
  for (const name of roundTrip) {
    const scene = fixture(name);
    for (const plant of plantNames) {
      const changed = planted(scene, plant);
      if (changed === undefined) continue;
      made += 1;
      expect(emit(changed), `${plant} leaves ${name}'s module as it was`).not.toBe(emit(scene));
    }
  }
  // Every fixture has its node moved; the effects and the parameters are in the fixtures that have them.
  expect(made).toBeGreaterThanOrEqual(roundTrip.length + 2);
  expect(planted(fixture("object-effects-ink"), "dropped-effect")?.effects).toHaveLength(1);
  expect(planted(fixture("framed-solid-shader"), "changed-parameter")).toBeDefined();
});
