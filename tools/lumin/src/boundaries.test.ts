import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
