/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { iconPacks } from "./packs/index.js";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

const manifest: unknown = JSON.parse(read("../package.json"));
const field = (name: string): unknown => (typeof manifest === "object" && manifest !== null ? Object.getOwnPropertyDescriptor(manifest, name)?.value : undefined);
const license = String(field("license"));
const scripts = field("scripts");
const build = String(typeof scripts === "object" && scripts !== null ? Object.getOwnPropertyDescriptor(scripts, "build")?.value : "");

/** The SPDX identifiers in an expression, without the operators and parentheses. */
const identifiers = (expression: string): ReadonlySet<string> => new Set(expression.split(/[\s()]+/).filter((token) => token !== "" && token !== "AND" && token !== "OR"));

/** A pack's id up to its first dash is its source's name, and the name of the license file it ships under. */
const sourceOf = (id: string): string => id.split("-")[0] ?? id;

describe("icons package license", () => {
  it("names every license of what it ships, as one SPDX expression", () => {
    const named = identifiers(license);
    for (const id of ["MIT", "Apache-2.0", "ISC", "CC-BY-4.0"]) expect(named.has(id)).toBe(true);
    for (const pack of iconPacks) expect(named.has(pack.license)).toBe(true);
    // The package's own code and its core icons stay a choice between MIT and Apache-2.0.
    expect(license.startsWith("(MIT OR Apache-2.0) AND ")).toBe(true);
  });

  it("ships the license text of each source, crediting its authors", () => {
    for (const pack of iconPacks) {
      const text = read(`../licenses/${sourceOf(pack.id)}.txt`);
      expect(text.length).toBeGreaterThan(500);
      expect(text.toLowerCase()).toContain((pack.credit.split(" ")[0] ?? pack.credit).toLowerCase());
    }
    expect(read("../licenses/core-MIT.txt")).toContain("Permission is hereby granted");
    expect(read("../licenses/core-Apache-2.0.txt")).toContain("Apache License");
  });

  it("copies the license texts into dist, which is all the package publishes", () => {
    expect(build).toContain("licenses");
    expect(build).toContain("dist/licenses");
    expect(field("files")).toEqual(["dist"]);
  });
});
