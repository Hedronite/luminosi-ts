// `bun run stills` draws every 3D asset with the still-frame rig and writes one PNG each; `bun run stills posters` does that and
// then turns the frames into the gallery's posters and their manifest (assets/posters, made by tool-assets: `posterize.ts`).
// Both run where the rig runs, on a machine with a GPU, and never in CI. The frames land in STILLS_OUT, `test-results/stills` by default.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const [mode, ...rest] = process.argv.slice(2);
if ((mode !== undefined && mode !== "posters") || rest.length > 0) {
  console.error("usage: bun run stills [posters]");
  process.exit(2);
}

const frames = resolve(process.env["STILLS_OUT"] ?? "test-results/stills");
const run = (command: readonly string[], env: Record<string, string> = {}): void => {
  const [program, ...args] = command;
  if (program === undefined) return;
  const result = spawnSync(program, args, { stdio: "inherit", env: { ...process.env, ...env } });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run(["bun", "run", "build"]);
run(["bunx", "playwright", "test"], { LTS_STILLS: "1", STILLS_OUT: frames });
if (mode === "posters") run(["bun", "run", "--filter", "tool-assets", "posters", "--", "--frames", frames]);
