import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// The one-renderer tripwire (ROADMAP D1): no `WebGLRenderer` is constructed, named or imported, and no
// React Three Fiber `Canvas` is rendered, anywhere in `apps/*/src` and `packages/*/src` — outside tests,
// generated code and `assets/vendor`. The one `Canvas` the library renders is `WebGPUCanvas`'s own, in
// `packages/adapters/src/postfx.tsx`, which always passes the WebGPU `gl`; that file is the allowlist.
// A plain `<Canvas>` anywhere else, or any `WebGLRenderer` at all, is the classic renderer back, and this
// test fails it.
//
// Exception while Wave 8's G2 (stills and embed) is still open on its branch: `apps/catalog/src/Still.tsx`
// and `apps/catalog/src/embed.ts` are that step's files, and its PR moves both onto the WebGPU renderer.
// The entries below are removed when G2 merges; ROADMAP D1 is ticked only after every step of the wave has.

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

/** The files of an open step whose move to the WebGPU renderer is the step's own PR (Wave 8's G2). */
const OPEN_STEP_FILES = new Set([join(ROOT, "apps", "catalog", "src", "Still.tsx"), join(ROOT, "apps", "catalog", "src", "embed.ts")]);

const violations: readonly string[] = (() => {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const file = join(dir, entry);
      if (statSync(file).isDirectory()) {
        walk(file);
        continue;
      }
      if (!/\.(?:ts|tsx)$/.test(file)) continue;
      if (isTestFile(file)) continue;
      if (GENERATED.test(file)) continue;
      if (OPEN_STEP_FILES.has(file)) continue;
      const text = readFileSync(file, "utf8");
      const where = relative(ROOT, file);
      for (const line of text.split("\n")) {
        if (/\bnew\s+WebGLRenderer\b/.test(line)) found.push(`${where}: constructing three's WebGL renderer: ${line.trim()}`);
        else if (/\bWebGLRenderer\b/.test(line)) found.push(`${where}: the WebGL renderer's name: ${line.trim()}`);
        else if (/<Canvas\b/.test(line) && file !== CANVAS_ALLOW) found.push(`${where}: a plain React Three Fiber <Canvas> (the WebGPU canvas is in packages/adapters/src/postfx.tsx): ${line.trim()}`);
      }
    }
  };
  for (const root of scanRoots()) walk(root);
  return found;
})();

describe("one renderer", () => {
  it("finds no WebGL renderer and no plain React Three Fiber canvas in the sources", () => {
    expect(violations, "the classic renderer is back").toEqual([]);
  });
});
