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

  it("gives nothing for a kind without a package yet", () => {
    expect(snippetsFor({ ...meta, kind: "scene" }, undefined)).toEqual([]);
  });
});
