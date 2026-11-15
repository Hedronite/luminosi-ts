import { arrowRight } from "@hedronite/lts-icons";
import { describe, expect, it } from "vitest";
import { snippetsFor } from "./snippets.js";

const meta = { id: "arrow-right", kind: "icon", name: "Arrow right", tags: [], version: "0.1.0" } as const;

describe("snippetsFor", () => {
  it("gives React, TypeScript and SVG snippets for an icon", () => {
    const snippets = snippetsFor(meta, arrowRight);
    expect(snippets.map((s) => s.label)).toEqual(["React", "TypeScript", "SVG"]);
    expect(snippets[0]?.code).toContain('import { ArrowRight } from "@hedronite/lts-icons/react";');
    expect(snippets[1]?.code).toContain("iconToSvg(arrowRight");
    expect(snippets[2]?.code).toMatch(/^<svg /);
  });

  it("builds a primitive's geometry by id", () => {
    const [snippet] = snippetsFor({ ...meta, id: "platonic-cube", kind: "primitive" }, undefined);
    expect(snippet?.code).toContain('primitive("platonic-cube")');
  });

  it("creates a material by id, with and without a token preset", () => {
    const [snippet] = snippetsFor({ ...meta, id: "glass", kind: "material" }, undefined);
    expect(snippet?.code).toContain('createMaterial("glass")');
    expect(snippet?.code).toContain("hedronite.scene");
  });

  it("gives nothing for a kind without a package yet", () => {
    expect(snippetsFor({ ...meta, kind: "scene" }, undefined)).toEqual([]);
  });
});

describe("object snippets", () => {
  it.each(["crystal-cluster", "instanced-lattice", "crystal-cluster-glb"])("gives a TypeScript snippet for %s", (id) => {
    const [snippet] = snippetsFor({ ...meta, id, kind: "object" }, undefined);
    expect(snippet?.label).toBe("TypeScript");
    expect(snippet?.code).toContain("@hedronite/lts-objects");
  });
});
