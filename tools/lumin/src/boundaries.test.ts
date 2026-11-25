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
const COLOR_SINK =
  /(?:new\s+(?:[A-Za-z_$][\w$]*\.)?Color|\.(?:set|setStyle|setColorName))\(\s*["'`]([a-zA-Z]+)["'`]\s*(?:,\s*)?\)|(?:\b(?:fillStyle|strokeStyle|shadowColor)\s*=|\bcolor\s*:)\s*["'`]([a-zA-Z]+)["'`]/g;
const ARBITRARY_FUZZ_LITERAL = /\bmax:\s*(0xffffff)\b/;

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
    const full = join(packagesRoot, pkg);
    if (statSync(full).isDirectory()) walk(full);
  }
  return out.sort();
}

interface StringSegment {
  readonly offset: number;
  readonly text: string;
}

interface LexedFile {
  /** Exact `source.length` string with comments, regex literals, and string/template contents replaced by spaces (newlines preserved). */
  readonly codeOnly: string;
  /** Exact `source.length` string with comments and regex literals replaced by spaces (newlines and strings preserved). */
  readonly codeWithStrings: string;
  /** Every quoted string and static template text segment, with its starting character offset in `source`. */
  readonly strings: readonly StringSegment[];
  /** Maps any 0-based character offset in `source` to its 1-based line number. */
  readonly lineOf: (offset: number) => number;
}

const REGEX_BEFORE = new Set(["=", "(", "[", "{", ",", ";", ":", "!", "&", "|", "?", "~", "+", "-", "*", "%", "^", "<", ">"]);
const REGEX_KEYWORDS = new Set(["return", "throw", "case", "in", "of", "typeof", "void", "delete", "await", "yield", "else", "do"]);

/**
 * Lexes an entire JS/TS/JSX/TSX file once, carrying template-literal and interpolation state across newlines
 * while skipping comments and regex literals and keeping exact character offsets for line mapping.
 */
function lexFile(source: string, isTsx: boolean): LexedFile {
  const lineStarts: number[] = [0];
  for (let p = 0; p < source.length; p++) {
    if (source[p] === "\n") lineStarts.push(p + 1);
  }
  const lineOf = (offset: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if ((lineStarts[mid] ?? 0) <= offset) lo = mid + 1;
      else hi = mid - 1;
    }
    return hi + 1;
  };

  const codeOnly: string[] = [];
  const codeWithStrings: string[] = [];
  const strings: StringSegment[] = [];
  const pushBlank = (ch: string, intoStringsToo: boolean): void => {
    const out = ch === "\n" ? "\n" : " ";
    codeOnly.push(out);
    codeWithStrings.push(intoStringsToo ? out : ch);
  };

  const findClosingQuoteOnLine = (quote: string, start: number): number => {
    let k = start;
    while (k < source.length) {
      const ch = source[k] ?? "";
      if (ch === "\n") return -1;
      if (ch === "\\") {
        k += 2;
        continue;
      }
      if (ch === quote) return k;
      k += 1;
    }
    return -1;
  };

  type Mode = { readonly kind: "code"; readonly templateDepth: number } | { readonly kind: "template" };
  const stack: Mode[] = [{ kind: "code", templateDepth: 0 }];
  let canStartRegex = true;
  let ident = "";
  let i = 0;

  while (i < source.length) {
    const top = stack[stack.length - 1] ?? { kind: "code", templateDepth: 0 };
    if (top.kind === "template") {
      const segStart = i;
      let segText = "";
      while (i < source.length) {
        const ch = source[i] ?? "";
        if (ch === "\\") {
          const esc = source.slice(i, i + 2);
          segText += esc;
          for (const c of esc) pushBlank(c, false);
          i += 2;
          continue;
        }
        if (ch === "`") {
          if (segText !== "") strings.push({ offset: segStart, text: segText });
          codeOnly.push("`");
          codeWithStrings.push("`");
          i += 1;
          stack.pop();
          canStartRegex = false;
          ident = "";
          break;
        }
        if (ch === "$" && source[i + 1] === "{") {
          if (segText !== "") strings.push({ offset: segStart, text: segText });
          codeOnly.push("$", "{");
          codeWithStrings.push("$", "{");
          i += 2;
          stack.push({ kind: "code", templateDepth: 1 });
          canStartRegex = true;
          ident = "";
          break;
        }
        segText += ch;
        pushBlank(ch, false);
        i += 1;
      }
      if (i >= source.length && segText !== "" && source[i - 1] !== "`") strings.push({ offset: segStart, text: segText });
      continue;
    }

    const ch = source[i] ?? "";
    const next = source[i + 1] ?? "";

    // Line comment
    if (ch === "/" && next === "/") {
      ident = "";
      while (i < source.length && source[i] !== "\n") {
        pushBlank(source[i] ?? " ", true);
        i += 1;
      }
      continue;
    }
    // Block comment
    if (ch === "/" && next === "*") {
      ident = "";
      pushBlank("/", true);
      pushBlank("*", true);
      i += 2;
      while (i < source.length) {
        const c = source[i] ?? "";
        const n = source[i + 1] ?? "";
        pushBlank(c, true);
        i += 1;
        if (c === "*" && n === "/") {
          pushBlank("/", true);
          i += 1;
          break;
        }
      }
      continue;
    }
    // Regex literal (when `/` cannot be division)
    if (ch === "/" && canStartRegex && !(isTsx && (source[i - 1] === "<" || next === ">"))) {
      ident = "";
      pushBlank("/", true);
      i += 1;
      let inClass = false;
      while (i < source.length) {
        const c = source[i] ?? "";
        if (c === "\n") break;
        if (c === "\\") {
          pushBlank(c, true);
          if (i + 1 < source.length) pushBlank(source[i + 1] ?? " ", true);
          i += 2;
          continue;
        }
        if (c === "[") inClass = true;
        else if (c === "]" && inClass) inClass = false;
        else if (c === "/" && !inClass) {
          pushBlank("/", true);
          i += 1;
          while (i < source.length && /[a-z]/i.test(source[i] ?? "")) {
            pushBlank(source[i] ?? " ", true);
            i += 1;
          }
          break;
        }
        pushBlank(c, true);
        i += 1;
      }
      canStartRegex = false;
      continue;
    }
    // Single or double quoted string (ignore contractions / unmatched apostrophes such as JSX text `Don't`)
    if (ch === "'" || ch === '"') {
      const prevChar = i > 0 ? (source[i - 1] ?? "") : "";
      const isContraction = isTsx && ch === "'" && /[a-zA-Z]/.test(prevChar) && /[a-zA-Z]/.test(next);
      const end = isContraction ? -1 : findClosingQuoteOnLine(ch, i + 1);
      if (end !== -1) {
        ident = "";
        codeOnly.push(ch);
        codeWithStrings.push(ch);
        i += 1;
        const segStart = i;
        const text = source.slice(segStart, end);
        if (text !== "") strings.push({ offset: segStart, text });
        for (let k = segStart; k < end; k++) pushBlank(source[k] ?? " ", false);
        codeOnly.push(ch);
        codeWithStrings.push(ch);
        i = end + 1;
        canStartRegex = false;
        continue;
      }
    }
    // Template literal opening
    if (ch === "`") {
      ident = "";
      codeOnly.push("`");
      codeWithStrings.push("`");
      i += 1;
      stack.push({ kind: "template" });
      continue;
    }

    // Track template `${...}` brace depth
    if (stack.length > 1) {
      if (ch === "{") {
        stack[stack.length - 1] = { kind: "code", templateDepth: top.templateDepth + 1 };
      } else if (ch === "}") {
        if (top.templateDepth === 1) {
          codeOnly.push("}");
          codeWithStrings.push("}");
          i += 1;
          stack.pop();
          ident = "";
          continue;
        }
        stack[stack.length - 1] = { kind: "code", templateDepth: top.templateDepth - 1 };
      }
    }

    if (/[A-Za-z_$0-9]/.test(ch)) {
      ident += ch;
      canStartRegex = false;
    } else {
      if (ident !== "") {
        canStartRegex = REGEX_KEYWORDS.has(ident);
        ident = "";
      }
      if ((ch === "+" && next === "+") || (ch === "-" && next === "-")) {
        codeOnly.push(ch, next);
        codeWithStrings.push(ch, next);
        i += 2;
        canStartRegex = false;
        continue;
      }
      if (REGEX_BEFORE.has(ch) && !(isTsx && ch === "<")) canStartRegex = true;
      else if (ch === ")" || ch === "]") canStartRegex = false;
      else if (ch === "}" && stack.length === 1) canStartRegex = true;
    }

    codeOnly.push(ch);
    codeWithStrings.push(ch);
    i += 1;
  }

  return { codeOnly: codeOnly.join(""), codeWithStrings: codeWithStrings.join(""), strings, lineOf };
}

/** Returns `"file:line: match"` hits for raw color literals (hex, rgb/hsl, named Color sinks, `0x`/`0X`) in non-token/non-icon package source. */
export function findRawColorLiterals(packagesRoot: string): string[] {
  const hits: string[] = [];
  for (const file of packageSourceFiles(packagesRoot)) {
    const rel = file.slice(packagesRoot.length + 1);
    const source = readFileSync(file, "utf8");
    const lexed = lexFile(source, file.endsWith(".tsx") || file.endsWith(".jsx"));
    const fileHits: { readonly at: number; readonly text: string }[] = [];
    for (const seg of lexed.strings) {
      for (const match of seg.text.matchAll(HEX_IN_STRING)) {
        const at = seg.offset + match.index;
        fileHits.push({ at, text: `${rel}:${String(lexed.lineOf(at))}: ${match[0]}` });
      }
      for (const match of seg.text.matchAll(COLOR_FN_IN_STRING)) {
        const at = seg.offset + match.index;
        fileHits.push({ at, text: `${rel}:${String(lexed.lineOf(at))}: ${match[0]}` });
      }
    }
    for (const match of lexed.codeWithStrings.matchAll(COLOR_SINK)) {
      const name = (match[1] ?? match[2] ?? "").toLowerCase();
      if (CSS_NAMED_COLORS.has(name)) {
        fileHits.push({ at: match.index, text: `${rel}:${String(lexed.lineOf(match.index))}: ${match[0]}` });
      }
    }
    // Allow ONLY the exact `0xffffff` token inside `max: 0xffffff` of `scene/src/arbitrary.ts`; any other 0x color there trips.
    let allowedStart: number | undefined;
    if (rel === "scene/src/arbitrary.ts") {
      const m = ARBITRARY_FUZZ_LITERAL.exec(lexed.codeOnly);
      if (m !== null) allowedStart = m.index + m[0].indexOf("0xffffff");
    }
    for (const match of lexed.codeOnly.matchAll(RAW_HEX_INT)) {
      if (allowedStart !== undefined && match.index === allowedStart) continue;
      fileHits.push({ at: match.index, text: `${rel}:${String(lexed.lineOf(match.index))}: ${match[0]}` });
    }
    fileHits.sort((a, b) => a.at - b.at);
    for (const hit of fileHits) hits.push(hit.text);
  }
  return hits;
}

describe("raw color literal tripwire", () => {
  it("finds zero raw color literals in non-token, non-icon package source", () => {
    expect(findRawColorLiterals(join(root, "packages"))).toEqual([]);
  });

  it("trips red on multi-line templates, namespaced/multiline Color sinks, 0X, non-src files, and arbitrary.ts while staying quiet on comments/tags/non-color ints", () => {
    const tree = join(scratch, "raw-color-plant");
    mkdirSync(join(tree, "packages/sample/src"), { recursive: true });
    mkdirSync(join(tree, "packages/sample/scripts"), { recursive: true });
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
        'export const badNsColor = new THREE.Color("red");',
        'export const badSetName = new Color().setColorName("crimson");',
        'export const badMat = new MeshBasicMaterial({ color: "red" });',
        'export const cleanMat = { color: "base" };',
        'color.set("blue");',
        'color.setStyle("green");',
        'ctx.fillStyle = "rebeccapurple";',
        'ctx.strokeStyle = "coral";',
        'ctx.shadowColor = "red";',
        'export const badMultiline = new Color(',
        '  "red",',
        ');',
        'export const badUpper = 0XFF0000;',
        'export const regexBefore = /"/; export const afterRegex = 0xff0000;',
        'export const STYLE = `:host {',
        '  border: 1px solid #ff0000;',
        '  color: rgb(255, 0, 0);',
        '  background: #000;`; export const afterTpl = 0xff0000;',
        'export function postIncDec(i: number) { return i++ / 2 + i-- / 2 + 0xff0000; }',
      ].join("\n") + "\n",
    );
    writeFileSync(
      join(tree, "packages/sample/src/jsx.tsx"),
      [
        "export const View = () => <p>Don't {0xff0000}</p>;",
        'export const AfterBoldHex = () => <p><b>x</b>{"#ff0000"}</p>;',
        "export const AfterBoldInt = () => <p><b>x</b>{0xff0000}</p>;",
        'export const AfterBoldRgb = () => <p><b>x</b>{"rgb(255, 0, 0)"}</p>;',
        'export const AfterBoldSink = () => <p><b>x</b><span style={{ color: "red" }} /></p>;',
        'export const AfterBr = () => <p><br />{"#ff0000"}</p>;',
        "export const MultiLine = () => (",
        "  <div>",
        "    <b>multi</b>",
        '    <span>{"#ff0000"}</span>',
        "  </div>",
        ");",
      ].join("\n") + "\n",
    );
    writeFileSync(join(tree, "packages/sample/src/b.js"), 'export const jsHex = "#ff0000";\n');
    writeFileSync(join(tree, "packages/sample/src/c.mts"), 'export const mtsInt = 0x112233;\n');
    writeFileSync(join(tree, "packages/sample/scripts/zz.ts"), 'export const rootHex = "#ff0000";\n');
    writeFileSync(
      join(tree, "packages/scene/src/arbitrary.ts"),
      [
        'const hex = fc.integer({ min: 0, max: 0xffffff }).map((n) => n); const sameLinePlant = 0xff0000;',
        'export const planted = 0xff0000;',
      ].join("\n") + "\n",
    );
    expect(findRawColorLiterals(join(tree, "packages"))).toEqual([
      "sample/scripts/zz.ts:1: #ff0000",
      "sample/src/a.ts:6: #ff0000",
      "sample/src/a.ts:7: #ff0000",
      "sample/src/a.ts:8: #fff",
      "sample/src/a.ts:9: #ff0000",
      "sample/src/a.ts:10: rgb(",
      "sample/src/a.ts:11: hsl(",
      'sample/src/a.ts:12: new Color("red")',
      'sample/src/a.ts:13: new THREE.Color("red")',
      'sample/src/a.ts:14: .setColorName("crimson")',
      'sample/src/a.ts:15: color: "red"',
      'sample/src/a.ts:17: .set("blue")',
      'sample/src/a.ts:18: .setStyle("green")',
      'sample/src/a.ts:19: fillStyle = "rebeccapurple"',
      'sample/src/a.ts:20: strokeStyle = "coral"',
      'sample/src/a.ts:21: shadowColor = "red"',
      'sample/src/a.ts:22: new Color(\n  "red",\n)',
      "sample/src/a.ts:25: 0XFF0000",
      "sample/src/a.ts:26: 0xff0000",
      "sample/src/a.ts:28: #ff0000",
      "sample/src/a.ts:29: rgb(",
      "sample/src/a.ts:30: #000",
      "sample/src/a.ts:30: 0xff0000",
      "sample/src/a.ts:31: 0xff0000",
      "sample/src/b.js:1: #ff0000",
      "sample/src/c.mts:1: 0x112233",
      "sample/src/jsx.tsx:1: 0xff0000",
      "sample/src/jsx.tsx:2: #ff0000",
      "sample/src/jsx.tsx:3: 0xff0000",
      "sample/src/jsx.tsx:4: rgb(",
      'sample/src/jsx.tsx:5: color: "red"',
      "sample/src/jsx.tsx:6: #ff0000",
      "sample/src/jsx.tsx:10: #ff0000",
      "scene/src/arbitrary.ts:1: 0xff0000",
      "scene/src/arbitrary.ts:2: 0xff0000",
    ]);
  });
});
