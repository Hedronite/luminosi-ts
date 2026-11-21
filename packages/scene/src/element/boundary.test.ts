/// <reference types="node" />
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The modules a source file imports at load time (`import … from "x"`, `export … from "x"`, `import "x"`), and those it imports on demand (`import("x")`). */
const staticSpecifiers = (source: string): string[] => [...source.matchAll(/^\s*(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm)].map((match) => match[1] ?? match[2] ?? "");
const dynamicSpecifiers = (source: string): string[] => [...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1] ?? "");

/** The package names (not relative paths) an entry file reaches, following every relative import, and dynamic ones too when `onDemand`; and the files it walked. */
function reached(entry: string, onDemand: boolean): { readonly names: Set<string>; readonly files: Set<string> } {
  const names = new Set<string>();
  const files = new Set<string>();
  const visit = (file: string): void => {
    if (files.has(file)) return;
    files.add(file);
    const source = readFileSync(file, "utf8");
    for (const specifier of [...staticSpecifiers(source), ...(onDemand ? dynamicSpecifiers(source) : [])]) {
      if (specifier.startsWith(".")) visit(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
      else names.add(specifier);
    }
  };
  visit(entry);
  return { names, files };
}

const here = fileURLToPath(new URL(".", import.meta.url));
const react = /^(react|react-dom|@react-three\/[^/]+|@hedronite\/lts-adapters)(\/|$)/;
const basename = (file: string): string => relative(here, file).replace(/\\/g, "/");

describe("what a page loads for the scene element", () => {
  it("is the bootstrap: the class, the observers and the poster, and its static imports reach no package at all, so no three, no zod, no scene builder and no React", () => {
    const { names, files } = reached(join(here, "index.ts"), false);
    expect([...names]).toEqual([]);
    expect([...files].map(basename).sort()).toEqual(["element.ts", "index.ts", "types.ts"]);
  });

  it("reaches the lazy half through one dynamic import, and that half holds three's WebGPU build, the builder and zod", () => {
    const element = readFileSync(join(here, "element.ts"), "utf8");
    expect(dynamicSpecifiers(element)).toEqual(["./draw.js"]);
    const { names, files } = reached(join(here, "draw.ts"), true);
    expect(names.has("three/webgpu")).toBe(true);
    expect(names.has("zod")).toBe(true);
    expect([...files].map(basename)).toEqual(expect.arrayContaining(["draw.ts", "../three.ts", "../migrate.ts", "../renderer.ts"]));
  });

  it("has no React, no React Three Fiber and no adapters anywhere in its import graph, on demand included", () => {
    const { names } = reached(join(here, "index.ts"), true);
    const lazy = reached(join(here, "draw.ts"), true).names;
    expect([...names, ...lazy].filter((name) => react.test(name))).toEqual([]);
  });

  it("sees a planted import of three, of zod and of React in the bootstrap, and one on demand", () => {
    const dir = mkdtempSync(join(tmpdir(), "element-boundary-"));
    try {
      mkdirSync(join(dir, "nested"));
      writeFileSync(join(dir, "index.ts"), 'import { Mesh } from "three";\nimport type { Thing } from "./nested/other.js";\nexport const lazy = () => import("zod");\n');
      writeFileSync(join(dir, "nested/other.ts"), 'export { useThree } from "@react-three/fiber";\nimport "react";\n');
      expect([...reached(join(dir, "index.ts"), false).names].sort()).toEqual(["@react-three/fiber", "react", "three"]);
      expect([...reached(join(dir, "index.ts"), true).names].sort()).toEqual(["@react-three/fiber", "react", "three", "zod"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
