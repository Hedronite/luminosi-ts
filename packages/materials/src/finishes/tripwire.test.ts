import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { scanFinishFiles, scanFinishSource } from "./scan.js";

const src = join(fileURLToPath(new URL(".", import.meta.url)), "..");

describe("finish tripwires", () => {
  const scratch = mkdtempSync(join(tmpdir(), "lts-finish-plant-"));
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("finds no texture, raw color, or no-op finish patterns in shipped finish sources", () => {
    const files = ["finishes/graphs.ts", "finished.ts"].map((file) => join(src, file));
    expect(scanFinishFiles(files, ["texture", "raw-color", "no-op"])).toEqual([]);
  });

  it("plant row: no-op finish turns red", () => {
    const planted = 'export const modulates = [] as const;\nexport const modulates2 = { modulates: [] };\n';
    expect(scanFinishSource(planted, ["no-op"]).map((hit) => hit.rule)).toEqual(["no-op", "no-op"]);
    expect(scanFinishFiles([join(src, "finishes/graphs.ts")], ["no-op"])).toEqual([]);
  });

  it("plant row: texture file turns red", () => {
    writeFileSync(join(scratch, "planted.ts"), 'import tex from "./noise.png";\nconst loader = new TextureLoader();\n');
    expect(scanFinishSource(readFileSync(join(scratch, "planted.ts"), "utf8"), ["texture"]).length).toBeGreaterThan(0);
    expect(scanFinishFiles([join(src, "finished.ts"), join(src, "finishes/graphs.ts")], ["texture"])).toEqual([]);
  });

  it("plant row: raw color turns red", () => {
    writeFileSync(join(scratch, "raw.ts"), 'const c = new Color("#ff00aa");\nimport { color } from "three/tsl";\nconst n = color(0xff0000);\n');
    expect(scanFinishSource(readFileSync(join(scratch, "raw.ts"), "utf8"), ["raw-color"]).length).toBeGreaterThan(0);
    expect(scanFinishFiles([join(src, "finished.ts"), join(src, "finishes/graphs.ts")], ["raw-color"])).toEqual([]);
  });
});