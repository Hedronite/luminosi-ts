import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// The one-renderer tripwire (ROADMAP D1): no `WebGLRenderer` is constructed, named or imported, and no
// React Three Fiber `Canvas` is rendered, anywhere in `apps/*/src` and `packages/*/src` — outside tests,
// generated code and `assets/vendor`. The one `Canvas` the library renders is `WebGPUCanvas`'s own, in
// `packages/adapters/src/postfx.tsx`, which always passes the WebGPU `gl`; that file is the allowlist.
// A plain `<Canvas>` anywhere else, or any `WebGLRenderer` at all, is the classic renderer back, and this
// test fails it.

/** The repo root, from this file's place in tools/assets/src. */
const ROOT = join(import.meta.dirname, "..", "..", "..");

/** The directories the tripwire walks: every app's and package's `src`. */
const scanRoots = (): readonly string[] => {
  const roots: string[] = [];
  for (const top of ["apps", "packages"]) {
    const dir = join(ROOT, top);
    for (const entry of readdirSync(dir)) {
      const src = join(dir, entry, "src");
      try {
        if (statSync(src).isDirectory()) roots.push(src);
      } catch {
        // no src in that package
      }
    }
  }
  return roots;
};

/** Generated code: the icons' generated module, and anything under a `generated` folder. */
const GENERATED = /(?:^|[\\/])generated[\\/]|generated\.tsx$/;

const isTestFile = (file: string): boolean => /\.(?:test|spec)\.(?:ts|tsx)$/.test(file) || file.includes(`${sep}__tests__${sep}`);

/** The one file allowed to render a `Canvas`: it always passes three's WebGPU renderer as `gl`. */
const CANVAS_ALLOW = join(ROOT, "packages", "adapters", "src", "postfx.tsx");

/**
 * The file's text with its comments removed, so a comment that names `WebGLRenderer` ("this used to hold a
 * `WebGLRenderer`") is not a violation. Strings are left alone: an honest message may say WebGL, and the
 * matcher only reads identifiers.
 */
const stripComments = (text: string): string => {
  // Line and block comments, outside quotes only: a string may hold "//" (a URL) or "/*" and must keep
  // what follows it readable — a `new WebGLRenderer()` after a quoted "/*" is still a violation.
  let out = "";
  let quote: string | undefined;
  for (let at = 0; at < text.length; ) {
    const character = text[at] ?? "";
    const next = text[at + 1] ?? "";
    if (quote === undefined) {
      if (character === "\"" || character === "'" || character === "`") {
        quote = character;
        out += character;
        at += 1;
        continue;
      }
      if (character === "/" && next === "/") {
        while (at < text.length && text[at] !== "\n") at += 1;
        continue;
      }
      if (character === "/" && next === "*") {
        at = text.indexOf("*/", at + 2);
        at = at === -1 ? text.length : at + 2;
        continue;
      }
      out += character;
      at += 1;
      continue;
    }
    // Inside a quote: only its own end leaves it, and a backslash escapes the next character.
    if (character === "\\") {
      out += text.slice(at, at + 2);
      at += 2;
      continue;
    }
    if (character === quote) {
      quote = undefined;
      out += character;
      at += 1;
      continue;
    }
    out += character;
    at += 1;
  }
  return out;
};
const where = (file: string): string => relative(ROOT, file);

/**
 * What one comment-free line of a source file breaks, as the walk reads it: the rule it names, or undefined
 * when the line is clean. `allowCanvas` is false only for the file that defines `WebGPUCanvas` itself.
 */
const violationOf = (line: string, file: string): string | undefined => {
  if (/\bnew\s+WebGLRenderer\b/.test(line)) return "constructing three's WebGL renderer";
  if (/\bWebGLRenderer\b/.test(line)) return "the WebGL renderer's name (a type-only import is a violation too)";
  if (/<Canvas\b/.test(line) && file !== CANVAS_ALLOW) return "a plain React Three Fiber <Canvas> (the WebGPU canvas is in packages/adapters/src/postfx.tsx)";
  return undefined;
};

/**
 * The files under `roots` the tripwire reads, and what they say. A file is read when it is a source the
 * tripwire guards (not a test, not generated code); its comments are stripped before matching, so a comment
 * naming the renderer is not a violation while a type-only import is.
 */
const scan = (roots: readonly string[]): { readonly files: readonly string[]; readonly violations: readonly string[] } => {
  const files: string[] = [];
  const violations: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const file = join(dir, entry);
      if (statSync(file).isDirectory()) {
        walk(file);
        continue;
      }
      if (!/\.(?:ts|tsx|js|mjs|astro)$/.test(file)) continue;
      if (isTestFile(file)) continue;
      if (GENERATED.test(file)) continue;
      files.push(file);
      const text = stripComments(readFileSync(file, "utf8"));
      for (const line of text.split("\n")) {
        const found = violationOf(line, file);
        if (found !== undefined) violations.push(`${where(file)}: ${found}: ${line.trim()}`);
      }
    }
  };
  for (const root of roots) walk(root);
  return { files, violations };
};

const repo = scan(scanRoots());
const scanned = repo.files.map((file) => relative(ROOT, file));
const violations = repo.violations;

describe("one renderer", () => {
  it("finds no WebGL renderer and no plain React Three Fiber canvas in the sources", () => {
    expect(violations, "the classic renderer is back").toEqual([]);
  });

  it("walked the sources it guards, the site's page and the WebGPU canvas's own file among them", () => {
    expect(scanned.length, "the walk reached the code").toBeGreaterThan(0);
    expect(scanned).toContain(relative(ROOT, CANVAS_ALLOW));
    expect(scanned).toContain("apps/site/src/pages/index.astro");
  });

  it("keeps a WebGPU gl on the one canvas it allows", () => {
    const text = readFileSync(CANVAS_ALLOW, "utf8");
    // The allowlisted <Canvas> is WebGPUCanvas's own: it builds a WebGPURenderer and hands it to R3F as gl.
    expect(text).toMatch(/<Canvas\b/);
    expect(text).toMatch(/gl=\{?async/);
    expect(text).toMatch(/new\s+WebGPURenderer/);
  });

  it("fails a planted classic renderer and a planted plain canvas, in a tree of its own", () => {
    const root = mkdtempSync(join(tmpdir(), "lts-onerenderer-"));
    try {
      for (const top of ["apps", "packages"]) mkdirSync(join(root, top, "demo", "src"), { recursive: true });
      writeFileSync(
        join(root, "packages", "demo", "src", "classic.ts"),
        'import { WebGLRenderer } from "three";\nexport const renderer = new WebGLRenderer();\n',
      );
      writeFileSync(
        join(root, "packages", "demo", "src", "typed.ts"),
        'import type { WebGLRenderer } from "three";\nexport type R = WebGLRenderer;\n',
      );
      writeFileSync(join(root, "packages", "demo", "src", "commented.ts"), '// a WebGLRenderer used to live here\nexport const ok = 1;\n');
      writeFileSync(
        join(root, "packages", "demo", "src", "quoted.ts"),
        'const hint = "/* not a comment";\nexport const renderer = new WebGLRenderer();\n',
      );
      writeFileSync(join(root, "apps", "demo", "src", "stage.tsx"), 'import { Canvas } from "@react-three/fiber";\nexport const Stage = () => <Canvas />;\n');
      // The walk itself, over the planted tree: a construction, a type-only import, a plain canvas and a
      // `new WebGLRenderer` after a quoted "/*" each trip; a comment naming the renderer does not.
      const found = scan([join(root, "apps", "demo", "src"), join(root, "packages", "demo", "src")]);
      expect(found.files.length, "the walk reached the planted tree").toBeGreaterThanOrEqual(5);
      for (const name of ["classic.ts", "typed.ts", "stage.tsx", "quoted.ts"]) expect(found.violations.some((one) => one.includes(name)), `${name} must trip the tripwire`).toBe(true);
      expect(found.violations.some((one) => one.includes("commented.ts")), "commented.ts must stay clean").toBe(false);
      // One line, one rule: the same matchers the walk applies, asked directly.
      expect(violationOf('export const renderer = new WebGLRenderer();', "x.ts")).toBe("constructing three's WebGL renderer");
      expect(violationOf('import type { WebGLRenderer } from "three";', "x.ts")).toBe("the WebGL renderer's name (a type-only import is a violation too)");
      expect(violationOf('export const Stage = () => <Canvas />;', "x.tsx")).toBe("a plain React Three Fiber <Canvas> (the WebGPU canvas is in packages/adapters/src/postfx.tsx)");
      // The allowlist exempts the <Canvas> rule only on that file; the renderer-name rules still bite there.
      expect(violationOf('export const Stage = () => <Canvas />;', CANVAS_ALLOW)).toBeUndefined();
      expect(violationOf('const renderer = new WebGLRenderer();', CANVAS_ALLOW)).toBe("constructing three's WebGL renderer");
      expect(violationOf(stripComments('// a WebGLRenderer used to live here'), "x.ts")).toBeUndefined();
      expect(violationOf('export const ok = 1;', "x.ts")).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
