import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A10 will move assets/vendor out of this repository. What a scene's code carries as its credits is generated from the CREDIT.md files into
// packages/core (`vendorCredits`), so nothing that ships may read the vendor tree: not a package, and not an app's source.
// Tools may: `bun run vendor`, the icon pack generator and `lumin study` and `adopt` are the readers, and the tests here.
const root = resolve(import.meta.dirname, "../../..");

/** Every source file under `dir`, but not tests, generated modules, or what a build leaves behind. */
function sourcesIn(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "dist" || entry.name === "generated" ? [] : sourcesIn(path);
    return /\.(?:[cm]?[jt]sx?)$/.test(entry.name) && !/\.test\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

/** The code of a source file: its lines without the comments that only mention the folder. */
const codeOf = (file: string): string =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\/?\*)/.test(line))
    .join("\n");

const shipped = [
  ...readdirSync(join(root, "packages"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(root, "packages", e.name)),
  ...readdirSync(join(root, "apps"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(root, "apps", e.name)),
].flatMap((dir) => sourcesIn(dir));

describe("the vendor tree", () => {
  it("has shipped code to look through", () => {
    expect(shipped.length).toBeGreaterThan(100);
  });

  it("is read by no package and no app: a path into it, an import from it, or a glob over it", () => {
    const readers = shipped.filter((file) => /assets\/vendor|\bvendor\/\w+\/(?:CREDIT|LICENSE)/.test(codeOf(file))).map((file) => relative(root, file));
    expect(readers).toEqual([]);
  });

  it("is not named by the generated credits either: they carry the work and its address, not a path into the tree", () => {
    const generated = readFileSync(join(root, "packages/core/src/generated/vendorCredits.ts"), "utf8");
    expect(generated).not.toMatch(/assets\/vendor/);
  });
});
