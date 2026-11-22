import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "@playwright/test";

// A spec that makes a folder when its file is loaded and removes it in `test.afterAll` breaks when a worker runs one of its tests, then another one later: Playwright
// runs the file's afterAll after each turn a worker takes, and does not run the file's top level again, so the second test finds the folder gone. That is what failed
// `scene_render is not there without both flags` (a spawn in a missing folder is a bare ENOENT, with no stdout), the test that follows a 46 s one. The folder belongs in `test.beforeAll`.

const here = import.meta.dirname;
const specs = (dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? specs(join(dir, entry.name)) : entry.name.endsWith(".spec.ts") ? [join(dir, entry.name)] : []));

/** Top-level (not indented) lines of a file that make a folder. */
const madeAtLoad = (text: string): readonly string[] => text.split("\n").filter((line) => /^(?:const|let|var) .*\b(?:mkdtempSync|mkdirSync)\(/.test(line));

test("no spec makes a folder at load that its afterAll removes", () => {
  const found = specs(here)
    .filter((file) => file !== join(here, "hooks.spec.ts"))
    .flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return text.includes("test.afterAll(") ? madeAtLoad(text).map((line) => `${relative(here, file)}: ${line.trim()}`) : [];
    });
  expect(found).toEqual([]);
});

test("sees the pattern it guards against, and leaves the one that is safe", () => {
  expect(madeAtLoad('const base = realpathSync(mkdtempSync(join(tmpdir(), "x-")));\ntest.afterAll(() => {});')).toHaveLength(1);
  expect(madeAtLoad('let base = "";\ntest.beforeAll(() => {\n  base = mkdtempSync(join(tmpdir(), "x-"));\n});')).toEqual([]);
});
