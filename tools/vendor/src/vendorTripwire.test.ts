import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A tripwire, not a proof. A10 will move assets/vendor out of this repository, and a scene's credits are generated from the CREDIT.md files into
// packages/core (`vendorCredits`, `lookCredits`), so nothing that ships should read the vendor tree. This test fails on the ways code names it: a path,
// a path joined from its segments, a backslash separator, or a glob over it. It cannot see a path built at run time. The proof is a build and the package
// tests run with the folder moved away (recorded in the step's READY). Tools may read the tree, and do: `bun run vendor`, the icon pack generator,
// `lumin study` and `adopt`, and the tests here.
const root = resolve(import.meta.dirname, "../../..");

/** Every extension a package or an app keeps code, styles or markup in. */
const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".astro", ".css", ".scss", ".html", ".vue", ".svelte", ".mdx"]);
const skippedFolders = new Set(["node_modules", "dist", ".turbo", ".astro", "coverage", "test-results", "playwright-report", "vendor-pages", "generated"]);

const sourcesIn = (dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return skippedFolders.has(entry.name) ? [] : sourcesIn(path);
    return sourceExtensions.has(extname(entry.name)) && !/\.test\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });

/**
 * A source without its comments: block comments that open a line (code and styles), HTML comments, lines that are only a line comment, and the lines of a
 * block comment that start with a star. A glob in a string is left whole (it holds `/**` and `*` and `/`), so a comment is told by where it starts.
 */
const withoutComments = (source: string): string =>
  source
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line) && !/^\s*\*(?:\s|\/|$)/.test(line))
    .join("\n");

const quote = String.raw`["'\`]`;
/** The ways a source names the tree. */
const namings: readonly (readonly [string, RegExp])[] = [
  ["a path into it", /\bassets(?:\/+|\\+)vendor\b/],
  ["its segments joined", new RegExp(`${quote}assets${quote}\\s*,\\s*${quote}vendor${quote}`)],
  ["a glob over assets", /\bassets(?:\/+|\\+)(?:\*|\{)/],
  ["a glob over any vendor folder", /\*\*(?:\/+|\\+)vendor\b/],
];

/** What a source names of the tree, by the ways above. */
export const vendorNamings = (source: string): readonly string[] => {
  const code = withoutComments(source);
  return namings.filter(([, pattern]) => pattern.test(code)).map(([way]) => way);
};

describe("the tripwire", () => {
  it.each([
    ['join(root, "assets", "vendor", "threeui")', "its segments joined"],
    ["resolve(root, 'assets', 'vendor')", "its segments joined"],
    ['"../../assets/vendor/lucide/CREDIT.md"', "a path into it"],
    ["`${root}/assets//vendor/x`", "a path into it"],
    ["assets\\vendor\\lucide", "a path into it"],
    ['"assets\\\\vendor\\\\lucide"', "a path into it"],
    ['import.meta.glob("../../assets/**/CREDIT.md")', "a glob over assets"],
    ['glob("assets/{vendor,src}/**")', "a glob over assets"],
    ['glob("**/vendor/**/LICENSE")', "a glob over any vendor folder"],
    [".card { background: url(../../assets/vendor/x/preview.png); }", "a path into it"],
    ['<img src="../../assets/vendor/x/preview.png" />', "a path into it"],
  ])("names %s", (source, way) => {
    expect(vendorNamings(source)).toContain(way);
  });

  it.each([
    "// reads assets/vendor/lucide",
    "/* assets/vendor, joined: join(root, 'assets', 'vendor') */",
    "<!-- assets/vendor/x -->",
    " * The folder under assets/vendor.\n */",
    'const vendored = "vendor";',
    'fetch("/vendor/threeui-preview.jpg")',
    'import { vendored } from "./generated/vendor";',
  ])("leaves %s alone", (source) => {
    expect(vendorNamings(source)).toEqual([]);
  });
});

const shipped = ["packages", "apps"].flatMap((group) =>
  readdirSync(join(root, group), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => sourcesIn(join(root, group, entry.name))),
);

describe("the vendor tree", () => {
  it("is looked for in every kind of source the packages and apps keep", () => {
    const seen = new Set(shipped.map((file) => extname(file)));
    expect([".ts", ".tsx", ".css", ".astro"].filter((extension) => !seen.has(extension))).toEqual([]);
  });

  it("is named by no package and no app: not by a path, joined segments, a backslash separator or a glob", () => {
    const readers = shipped.flatMap((file) => {
      const ways = vendorNamings(readFileSync(file, "utf8"));
      return ways.length === 0 ? [] : [`${relative(root, file)}: ${ways.join(", ")}`];
    });
    expect(readers).toEqual([]);
  });

  it.each(["packages/core/src/generated/vendorCredits.ts", "packages/core/src/generated/lookCredits.ts"])("is named by no line of the generated credits, %s", (file) => {
    expect(readFileSync(join(root, file), "utf8")).not.toMatch(/assets[\\/]/);
  });
});
