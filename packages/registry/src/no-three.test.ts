/// <reference types="node" />
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The registry lists assets for apps that must not load three.js to do it. Walks every static import from the
// package's entry, through the packages it builds on (their built entries), and reports any that is three.js.
// `import type` is erased at build and `import(...)` loads lazily, so neither counts.

const packages = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function staticSpecifiers(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/^\s*(?:import|export)\s+(type\s+)?[^;]*?\bfrom\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm)) {
    if (match[1] === undefined) found.push(match[2] ?? match[3] ?? "");
  }
  return found;
}

/** The built file a workspace specifier such as `@hedronite/lts-icons/manifest` names, by the package's `exports`. */
function builtEntry(specifier: string): string {
  const parts = /^@hedronite\/lts-([a-z]+)(\/.+)?$/.exec(specifier);
  if (parts === null) throw new Error(`not a workspace package: ${specifier}`);
  const dir = resolve(packages, parts[1] ?? "");
  const manifest: unknown = JSON.parse(readFileSync(resolve(dir, "package.json"), "utf8"));
  const exported = isRecord(manifest) && isRecord(manifest.exports) ? manifest.exports[`.${parts[2] ?? ""}`] : undefined;
  const target = isRecord(exported) ? exported.import : exported;
  if (typeof target !== "string") throw new Error(`${specifier} has no import entry`);
  return resolve(dir, target);
}

function walk(entry: string): { readonly modules: number; readonly three: readonly string[] } {
  const seen = new Set<string>();
  const three: string[] = [];
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of staticSpecifiers(readFileSync(file, "utf8"))) {
      if (specifier === "three" || specifier.startsWith("three/")) three.push(`${relative(packages, file)} -> ${specifier}`);
      else if (specifier.startsWith(".")) visit(resolve(dirname(file), specifier).replace(/\.js$/, file.endsWith(".ts") ? ".ts" : ".js"));
      else if (specifier.startsWith("@hedronite/lts-")) visit(builtEntry(specifier));
    }
  };
  visit(entry);
  return { modules: seen.size, three };
}

describe("the registry's imports", () => {
  it("reach no three.js, in this package or in any package it builds on", () => {
    const { modules, three } = walk(resolve(packages, "registry/src/index.ts"));
    expect(three).toEqual([]);
    // It did walk across packages: the manifests and the data they read, not just this package's few files.
    expect(modules).toBeGreaterThan(40);
  });

  it("would notice one: the same walk from a package's three.js entry finds it", () => {
    expect(walk(builtEntry("@hedronite/lts-materials").replace(/index\.js$/, "three.js")).three).toEqual(["materials/dist/three.js -> three"]);
  });
});
