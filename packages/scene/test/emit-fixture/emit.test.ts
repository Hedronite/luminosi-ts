/// <reference types="node" />
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { toTsx, toVanilla } from "../../src/emit/index.js";
import { migrate } from "../../src/migrate.js";
import { sceneSchema } from "../../src/schema.js";

// The emitted code, for every fixture document, is type-checked against the real packages (their built types). A planted
// id the packages do not have must fail it, so a pass means something.

const here = fileURLToPath(new URL(".", import.meta.url));
const fixtures = join(here, "..", "..", "fixtures");
const good = join(here, "out");
const bad = join(here, "out-bad");
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");

afterAll(() => {
  rmSync(good, { recursive: true, force: true });
  rmSync(bad, { recursive: true, force: true });
});

/** Writes `files` to `dir` with a project file of its own, and runs the compiler on it. The text it says, and whether it passed. */
function check(dir: string, files: ReadonlyMap<string, string>): { readonly passed: boolean; readonly output: string } {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [name, code] of files) writeFileSync(join(dir, name), code);
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ extends: "../tsconfig.json", include: ["./*.ts", "./*.tsx"] }));
  try {
    execFileSync(process.execPath, [tsc, "-p", dir], { encoding: "utf8", stdio: "pipe" });
    return { passed: true, output: "" };
  } catch (error) {
    const output = typeof error === "object" && error !== null && "stdout" in error ? String(error.stdout) : String(error);
    return { passed: false, output };
  }
}

/** Every `fixtures/*.json`, as a current document (an older one is migrated first). */
function documents() {
  return readdirSync(fixtures)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => {
      const result = migrate(readFileSync(join(fixtures, file), "utf8"));
      if (!result.ok) throw new Error(`${file}: ${JSON.stringify(result.issues)}`);
      return [basename(file, ".json"), result.scene] as const;
    });
}

describe("emitted code", () => {
  it("type-checks for every fixture document, as React and as plain three.js", () => {
    const files = new Map(documents().flatMap(([name, scene]) => [[`${name}.tsx`, toTsx(scene)] as const, [`${name}.vanilla.ts`, toVanilla(scene)] as const]));
    expect(files.size).toBeGreaterThanOrEqual(12);
    const run = check(good, files);
    expect(run.output).toBe("");
    expect(run.passed).toBe(true);
  }, 240_000);

  it("fails to type-check when the document names an id the packages do not have", () => {
    const scene = sceneSchema.parse({
      format: "lts-scene",
      version: 1,
      look: "neutral",
      seed: 0,
      nodes: [
        { id: "a", parent: null, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], asset: { kind: "primitive", id: "platonic-cuboid" }, surface: { material: "chrome" } },
        { id: "b", parent: null, position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], asset: { kind: "primitive", id: "platonic-cube" }, surface: { shader: "no-such-shader" } },
      ],
      lights: { rig: "studio", intensity: 1 },
      environment: { kind: "studio" },
      camera: { position: [0, 0, 4], target: [0, 0, 0], fov: 35 },
      effects: [{ id: "no-such-effect" }],
      ink: "look",
    });
    const vanilla = check(bad, new Map([["bad.vanilla.ts", toVanilla(scene)]]));
    expect(vanilla.passed).toBe(false);
    expect(vanilla.output).toMatch(/platonic-cuboid/);
    const tsx = check(bad, new Map([["bad.tsx", toTsx(scene)]]));
    expect(tsx.passed).toBe(false);
    expect(tsx.output).toMatch(/platonic-cuboid|chrome/);
  }, 240_000);
});
