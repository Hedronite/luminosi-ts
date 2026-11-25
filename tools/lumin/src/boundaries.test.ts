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

const PACKAGE_SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const HEX_IN_STRING = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const COLOR_FN_IN_STRING = /\b(?:rgb|rgba|hsl|hsla)\s*\(/gi;
const RAW_HEX_INT = /\b0[xX][0-9a-fA-F]{6}\b/g;
const COLOR_SINK = /(?:new\s+Color|\.(?:set|setStyle))\(\s*["'`]([a-zA-Z]+)["'`]\s*\)|\b(?:fillStyle|strokeStyle)\s*=\s*["'`]([a-zA-Z]+)["'`]/g;
const ARBITRARY_FUZZ_LINE = /^\s*const hex = fc\.integer\(\{\s*min:\s*0,\s*max:\s*0xffffff\s*\}\)/;

// Standard CSS Color Level 4 keywords checked inside color sinks (not bare tags like "transparent").
const CSS_NAMED_COLORS = new Set([
  "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque", "black", "blanchedalmond", "blue",
  "blueviolet", "brown", "burlywood", "cadetblue", "chartreuse", "chocolate", "coral", "cornflowerblue", "cornsilk",
  "crimson", "currentcolor", "cyan", "darkblue", "darkcyan", "darkgoldenrod", "darkgray", "darkgreen", "darkgrey",
  "darkkhaki", "darkmagenta", "darkolivegreen", "darkorange", "darkorchid", "darkred", "darksalmon", "darkseagreen",
  "darkslateblue", "darkslategray", "darkslategrey", "darkturquoise", "darkviolet", "deeppink", "deepskyblue",
  "dimgray", "dimgrey", "dodgerblue", "firebrick", "floralwhite", "forestgreen", "fuchsia", "gainsboro", "ghostwhite",
  "gold", "goldenrod", "gray", "green", "greenyellow", "grey", "honeydew", "hotpink", "indianred", "indigo", "ivory",
  "khaki", "lavender", "lavenderblush", "lawngreen", "lemonchiffon", "lightblue", "lightcoral", "lightcyan",
  "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey", "lightpink", "lightsalmon", "lightseagreen",
  "lightskyblue", "lightslategray", "lightslategrey", "lightsteelblue", "lightyellow", "lime", "limegreen", "linen",
  "magenta", "maroon", "mediumaquamarine", "mediumblue", "mediumorchid", "mediumpurple", "mediumseagreen",
  "mediumslateblue", "mediumspringgreen", "mediumturquoise", "mediumvioletred", "midnightblue", "mintcream",
  "mistyrose", "moccasin", "navajowhite", "navy", "oldlace", "olive", "olivedrab", "orange", "orangered", "orchid",
  "palegoldenrod", "palegreen", "paleturquoise", "palevioletred", "papayawhip", "peachpuff", "peru", "pink", "plum",
  "powderblue", "purple", "rebeccapurple", "red", "rosybrown", "royalblue", "saddlebrown", "salmon", "sandybrown",
  "seagreen", "seashell", "sienna", "silver", "skyblue", "slateblue", "slategray", "slategrey", "snow", "springgreen",
  "steelblue", "tan", "teal", "thistle", "tomato", "transparent", "turquoise", "violet", "wheat", "white",
  "whitesmoke", "yellow", "yellowgreen",
]);

function packageSourceFiles(packagesRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === "dist" || name === "node_modules") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (PACKAGE_SOURCE_EXT.test(name) && !name.includes(".test.") && !name.endsWith(".d.ts")) out.push(full);
    }
  };
  for (const pkg of readdirSync(packagesRoot)) {
    if (pkg === "tokens" || pkg === "icons") continue;
    const src = join(packagesRoot, pkg, "src");
    if (statSync(join(packagesRoot, pkg)).isDirectory() && readdirSync(join(packagesRoot, pkg)).includes("src") && statSync(src).isDirectory()) walk(src);
  }
  return out.sort();
}

interface ScannedLine {
  readonly codeOnly: string;
  readonly codeWithStrings: string;
  readonly strings: readonly string[];
}

/** Strips JS/TS comments line-for-line while separating string/template text segments from code. */
function scanLines(source: string): readonly ScannedLine[] {
  const lines = source.split("\n");
  const result: ScannedLine[] = [];
  let inBlockComment = false;
  const templateBraces: number[] = [];

  for (const line of lines) {
    let codeOnly = "";
    let codeWithStrings = "";
    const strings: string[] = [];
    let i = 0;

    const readQuoted = (quote: string): void => {
      const start = i;
      i += 1;
      let text = "";
      while (i < line.length) {
        const ch = line[i] ?? "";
        if (ch === "\\") {
          text += line.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (ch === quote) {
          i += 1;
          break;
        }
        if (quote === "`" && ch === "$" && line[i + 1] === "{") {
          strings.push(text);
          codeOnly += `${quote}${quote}`;
          codeWithStrings += line.slice(start, i + 2);
          i += 2;
          templateBraces.push(1);
          return;
        }
        text += ch;
        i += 1;
      }
      strings.push(text);
      codeOnly += `${quote}${quote}`;
      codeWithStrings += line.slice(start, i);
    };

    while (i < line.length) {
      if (inBlockComment) {
        const end = line.indexOf("*/", i);
        if (end === -1) break;
        inBlockComment = false;
        i = end + 2;
        continue;
      }
      const ch = line[i] ?? "";
      const next = line[i + 1] ?? "";
      if (ch === "/" && next === "/") break;
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        i += 2;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === "`") {
        readQuoted(ch);
        continue;
      }
      if (templateBraces.length > 0) {
        if (ch === "{") templateBraces[templateBraces.length - 1] = (templateBraces[templateBraces.length - 1] ?? 0) + 1;
        else if (ch === "}") {
          const depth = (templateBraces[templateBraces.length - 1] ?? 1) - 1;
          if (depth === 0) {
            templateBraces.pop();
            codeWithStrings += "}";
            i += 1;
            // Resume static template text after `${...}`.
            let text = "";
            const segStart = i;
            while (i < line.length) {
              const tc = line[i] ?? "";
              if (tc === "\\") {
                text += line.slice(i, i + 2);
                i += 2;
                continue;
              }
              if (tc === "`") {
                i += 1;
                break;
              }
              if (tc === "$" && line[i + 1] === "{") {
                strings.push(text);
                codeWithStrings += line.slice(segStart, i + 2);
                i += 2;
                templateBraces.push(1);
                text = "";
                break;
              }
              text += tc;
              i += 1;
            }
            if (text !== "") strings.push(text);
            if (line[i - 1] === "`") codeWithStrings += line.slice(segStart, i);
            continue;
          }
          templateBraces[templateBraces.length - 1] = depth;
        }
      }
      codeOnly += ch;
      codeWithStrings += ch;
      i += 1;
    }
    result.push({ codeOnly, codeWithStrings, strings });
  }
  return result;
}

/** Returns `"file:line: match"` hits for raw color literals (hex, rgb/hsl, named Color sinks, `0x`/`0X`) in non-token/non-icon package source. */
export function findRawColorLiterals(packagesRoot: string): string[] {
  const hits: string[] = [];
  for (const file of packageSourceFiles(packagesRoot)) {
    const rel = file.slice(packagesRoot.length + 1);
    const rawLines = readFileSync(file, "utf8").split("\n");
    const scanned = scanLines(rawLines.join("\n"));
    for (const [index, entry] of scanned.entries()) {
      const lineNo = String(index + 1);
      for (const str of entry.strings) {
        for (const match of str.matchAll(HEX_IN_STRING)) hits.push(`${rel}:${lineNo}: ${match[0]}`);
        for (const match of str.matchAll(COLOR_FN_IN_STRING)) hits.push(`${rel}:${lineNo}: ${match[0]}`);
      }
      for (const match of entry.codeWithStrings.matchAll(COLOR_SINK)) {
        const name = (match[1] ?? match[2] ?? "").toLowerCase();
        if (CSS_NAMED_COLORS.has(name)) hits.push(`${rel}:${lineNo}: ${match[0]}`);
      }
      // Only the arbitrary fuzz range generator `max: 0xffffff` is non-color; any other 0x color in arbitrary.ts trips.
      const rawLine = rawLines[index] ?? "";
      if (!(rel === "scene/src/arbitrary.ts" && ARBITRARY_FUZZ_LINE.test(rawLine))) {
        for (const match of entry.codeOnly.matchAll(RAW_HEX_INT)) hits.push(`${rel}:${lineNo}: ${match[0]}`);
      }
    }
  }
  return hits;
}

describe("raw color literal tripwire", () => {
  it("finds zero raw color literals in non-token, non-icon package source", () => {
    expect(findRawColorLiterals(join(root, "packages"))).toEqual([]);
  });

  it("trips red on embedded hex, rgb/hsl, named Color sinks, uppercase 0X, .js/.mts files, and arbitrary.ts non-max 0x while staying quiet on comments/tags/non-color ints", () => {
    const tree = join(scratch, "raw-color-plant");
    mkdirSync(join(tree, "packages/sample/src"), { recursive: true });
    mkdirSync(join(tree, "packages/scene/src"), { recursive: true });
    mkdirSync(join(tree, "packages/tokens/src"), { recursive: true });
    writeFileSync(join(tree, "packages/tokens/src/presets.ts"), 'export const c = "#ff0000";\n');
    writeFileSync(
      join(tree, "packages/sample/src/a.ts"),
      [
        '// comment #ff0000 rgb(0, 0, 0) 0xff0000 new Color("red")',
        '/* block #ffffff hsl(0, 0%, 100%) */',
        'export const tags = ["transparent"];',
        'export const prng = 0x6d2b79f5;',
        'export const chunk = 0x8000;',
        'export const badHex = "#ff0000";',
        'export const badEmbedded = "1px solid #ff0000";',
        'export const badTemplate = `0 0 4px #fff`;',
        'export const badStop = "#ff0000 50%";',
        'export const badRgb = "rgb(255, 0, 0)";',
        'export const badHsl = "hsl(0 100% 50%)";',
        'export const badColor = new Color("red");',
        'color.set("blue");',
        'color.setStyle("green");',
        'ctx.fillStyle = "rebeccapurple";',
        'ctx.strokeStyle = "coral";',
        'export const badUpper = 0XFF0000;',
      ].join("\n") + "\n",
    );
    writeFileSync(join(tree, "packages/sample/src/b.js"), 'export const jsHex = "#ff0000";\n');
    writeFileSync(join(tree, "packages/sample/src/c.mts"), 'export const mtsInt = 0x112233;\n');
    writeFileSync(
      join(tree, "packages/scene/src/arbitrary.ts"),
      [
        'const hex = fc.integer({ min: 0, max: 0xffffff }).map((n) => n);',
        'export const planted = 0xff0000;',
      ].join("\n") + "\n",
    );
    expect(findRawColorLiterals(join(tree, "packages"))).toEqual([
      "sample/src/a.ts:6: #ff0000",
      "sample/src/a.ts:7: #ff0000",
      "sample/src/a.ts:8: #fff",
      "sample/src/a.ts:9: #ff0000",
      "sample/src/a.ts:10: rgb(",
      "sample/src/a.ts:11: hsl(",
      'sample/src/a.ts:12: new Color("red")',
      'sample/src/a.ts:13: .set("blue")',
      'sample/src/a.ts:14: .setStyle("green")',
      'sample/src/a.ts:15: fillStyle = "rebeccapurple"',
      'sample/src/a.ts:16: strokeStyle = "coral"',
      "sample/src/a.ts:17: 0XFF0000",
      "sample/src/b.js:1: #ff0000",
      "sample/src/c.mts:1: 0x112233",
      "scene/src/arbitrary.ts:2: 0xff0000",
    ]);
  });
});
