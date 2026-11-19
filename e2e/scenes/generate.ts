// `bun run scenes:generate` writes the vanilla module emitted for each round-trip fixture into e2e/scenes/generated/, and
// `bun run scenes:check` fails (exit 1) when a committed module is not what the emitter writes now. `bun run scenes:plants`
// writes the planted modules the strict spec draws, into e2e/scenes/plants/ (never committed). A generated module is never edited by hand.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { emit, fixture, generatedPath, isCurrent, plantPath } from "./emitted.js";
import { roundTrip } from "./fixtures.js";
import { planted, plantNames } from "./plants.js";

const [mode] = process.argv.slice(2);

const write = (file: string, text: string): void => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

if (mode === "generate") {
  for (const name of roundTrip) write(generatedPath(name), emit(fixture(name)));
  console.log(`scenes: wrote ${String(roundTrip.length)} modules`);
} else if (mode === "check") {
  const stale = roundTrip.filter((name) => !existsSync(generatedPath(name)) || !isCurrent(name, readFileSync(generatedPath(name), "utf8")));
  if (stale.length > 0) {
    console.error(`scenes: stale or missing generated modules: ${stale.join(", ")}. Run bun run scenes:generate`);
    process.exit(1);
  }
  console.log(`scenes: ${String(roundTrip.length)} generated modules are current`);
} else if (mode === "plants") {
  rmSync(join(import.meta.dirname, "plants"), { recursive: true, force: true });
  let count = 0;
  for (const name of roundTrip) {
    for (const plant of plantNames) {
      const scene = planted(fixture(name), plant);
      if (scene === undefined) continue;
      write(plantPath(name, plant), emit(scene));
      count += 1;
    }
  }
  console.log(`scenes: wrote ${String(count)} planted modules`);
} else {
  console.error("usage: bun e2e/scenes/generate.ts generate|check|plants");
  process.exit(2);
}
