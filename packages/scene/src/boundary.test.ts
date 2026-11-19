/// <reference types="node" />
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Every module specifier a source file names: `from "x"`, `import("x")` and `import "x"`. */
const specifiers = (source: string): string[] => [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g)].map((match) => match[1] ?? "");

/** The package names (not relative paths) a set of entry files reaches, following every relative import. */
function reached(entries: readonly string[]): Set<string> {
  const names = new Set<string>();
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of specifiers(readFileSync(file, "utf8"))) {
      if (specifier.startsWith(".")) visit(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
      else names.add(specifier);
    }
  };
  for (const entry of entries) visit(entry);
  return names;
}

const src = fileURLToPath(new URL(".", import.meta.url));
const allowed = new Set(["zod", "@hedronite/lts-core"]);
const stray = (names: ReadonlySet<string>): string[] => [...names].filter((name) => !allowed.has(name)).sort();

describe("the root and ./emit are data only", () => {
  it("import nothing but zod and core, so no three.js, no three/webgpu and no React", () => {
    const names = reached([join(src, "index.ts"), join(src, "emit/index.ts")]);
    expect(stray(names)).toEqual([]);
    expect(names.has("zod")).toBe(true);
  });

  it("is a check that sees a planted import of three, of three/webgpu, of React and of another package", () => {
    const dir = mkdtempSync(join(tmpdir(), "scene-boundary-"));
    try {
      mkdirSync(join(dir, "emit"));
      writeFileSync(join(dir, "index.ts"), 'import { z } from "zod";\nexport * from "./other.js";\n');
      writeFileSync(join(dir, "other.ts"), 'import { Mesh } from "three";\nimport { WebGPURenderer } from "three/webgpu";\nexport const x = import("react");\nexport { y } from "@hedronite/lts-adapters";\n');
      expect(stray(reached([join(dir, "index.ts")]))).toEqual(["@hedronite/lts-adapters", "react", "three", "three/webgpu"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("declare no three or React dependency of their own", () => {
    const manifest: unknown = JSON.parse(readFileSync(join(src, "../package.json"), "utf8"));
    const text = JSON.stringify(manifest);
    expect(text).toContain('"@hedronite/lts-core"');
    for (const field of ["dependencies"]) {
      const section = typeof manifest === "object" && manifest !== null && field in manifest ? JSON.stringify(Reflect.get(manifest, field)) : "{}";
      expect(section).not.toMatch(/"(three|react|react-dom|@react-three\/[^"]+)"/);
    }
  });
});
