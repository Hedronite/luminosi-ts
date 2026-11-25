import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// The import rules, run for real: a throwaway tree with a planted import, cruised with the repository's own config
// from the directory the rules' `^packages/` and `^apps/` patterns are relative to.
const root = resolve(import.meta.dirname, "../../..");
const scratch = mkdtempSync(join(tmpdir(), "lts-boundaries-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Writes `files` (path to text) into a fresh tree and cruises packages, apps and tools there. */
function cruise(name: string, files: Readonly<Record<string, string>>): { readonly ok: boolean; readonly output: string } {
  const tree = join(scratch, name);
  for (const folder of ["packages", "apps", "tools"]) mkdirSync(join(tree, folder), { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(tree, path)), { recursive: true });
    writeFileSync(join(tree, path), text);
  }
  copyFileSync(join(root, "tsconfig.base.json"), join(tree, "tsconfig.base.json"));
  const run = spawnSync(join(root, "node_modules/.bin/depcruise"), ["packages", "apps", "tools", "--config", join(root, ".dependency-cruiser.cjs")], { cwd: tree, encoding: "utf8" });
  return { ok: run.status === 0, output: `${run.stdout}${run.stderr}` };
}

const helper = { "tools/helper/src/helper.ts": "export const helper = 1;\n" };

describe("packages and apps never import tools", () => {
  it("passes a tree where they do not", () => {
    const result = cruise("clean", { ...helper, "packages/widget/src/index.ts": "export const widget = 1;\n", "apps/site/src/main.ts": 'import { site } from "./site.js";\n\nconsole.log(site);\n', "apps/site/src/site.ts": "export const site = 1;\n" });
    expect(result.output).toContain("no dependency violations found");
    expect(result.ok).toBe(true);
  });

  it("fails a package that imports a tool", () => {
    const result = cruise("package", { ...helper, "packages/widget/src/index.ts": 'import { helper } from "../../../tools/helper/src/helper.js";\n\nexport const widget = helper;\n' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("products-never-import-tools: packages/widget/src/index.ts → tools/helper/src/helper.ts");
  });

  it("fails an app that imports a tool", () => {
    const result = cruise("app", { ...helper, "apps/site/src/main.ts": 'import { helper } from "../../../tools/helper/src/helper.js";\n\nconsole.log(helper);\n' });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("products-never-import-tools: apps/site/src/main.ts → tools/helper/src/helper.ts");
  });

  it("lets an app serve a .glb the asset pipeline built, and nothing else under that folder", () => {
    const model = "tools/assets/dist/models/model.glb";
    const allowed = cruise("glb", { [model]: "glTF", "apps/site/src/main.ts": 'import model from "../../../tools/assets/dist/models/model.glb?url";\n\nconsole.log(model);\n' });
    expect(allowed.output).not.toContain("products-never-import-tools");
    const code = cruise("glb-code", { "tools/assets/dist/models/model.ts": "export const model = 1;\n", "apps/site/src/main.ts": 'import { model } from "../../../tools/assets/dist/models/model.js";\n\nconsole.log(model);\n' });
    expect(code.ok).toBe(false);
    expect(code.output).toContain("products-never-import-tools");
  });
});

const RAW_HEX_STRING = /["'`]#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})["'`]/;
const RAW_HEX_INT = /\b0x[0-9a-fA-F]{6}\b/;

function packageSourceFiles(packagesRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === "dist" || name === "node_modules") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && !name.includes(".test.") && !name.endsWith(".d.ts")) out.push(full);
    }
  };
  for (const pkg of readdirSync(packagesRoot)) {
    if (pkg === "tokens" || pkg === "icons") continue;
    const full = join(packagesRoot, pkg);
    if (statSync(full).isDirectory()) walk(full);
  }
  return out.sort();
}

/** Returns `"file:line: match"` hits for raw hex strings or 6-digit `0x` color literals in non-token/non-icon package source. */
export function findRawColorLiterals(packagesRoot: string): string[] {
  const hits: string[] = [];
  for (const file of packageSourceFiles(packagesRoot)) {
    const rel = file.slice(packagesRoot.length + 1);
    const lines = readFileSync(file, "utf8").split("\n");
    for (const [index, line] of lines.entries()) {
      const strHit = RAW_HEX_STRING.exec(line);
      if (strHit !== null) hits.push(`${rel}:${String(index + 1)}: ${strHit[0]}`);
      // Arbitrary scene fuzz generator (`max: 0xffffff`) produces test documents, not a color literal.
      if (rel !== "scene/src/arbitrary.ts") {
        const intHit = RAW_HEX_INT.exec(line);
        if (intHit !== null) hits.push(`${rel}:${String(index + 1)}: ${intHit[0]}`);
      }
    }
  }
  return hits;
}

describe("raw color literal tripwire", () => {
  it("finds zero raw color literals in non-token, non-icon package source", () => {
    expect(findRawColorLiterals(join(root, "packages"))).toEqual([]);
  });

  it("trips red when a raw hex or 0x color literal is planted in a non-token package", () => {
    const tree = join(scratch, "raw-color-plant");
    mkdirSync(join(tree, "packages/sample/src"), { recursive: true });
    mkdirSync(join(tree, "packages/tokens/src"), { recursive: true });
    writeFileSync(join(tree, "packages/tokens/src/presets.ts"), 'export const c = "#ff0000";\n');
    writeFileSync(join(tree, "packages/sample/src/a.ts"), 'export const badHex = "#ff0000";\nexport const badInt = 0xff0000;\n');
    expect(findRawColorLiterals(join(tree, "packages"))).toEqual([
      'sample/src/a.ts:1: "#ff0000"',
      "sample/src/a.ts:2: 0xff0000",
    ]);
  });
});
