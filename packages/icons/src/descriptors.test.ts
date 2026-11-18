import { compareDescriptors } from "@hedronite/lts-core";
import { describe, expect, it } from "vitest";
import { descriptors } from "./descriptors.js";
import { arrowDown } from "./generated/icons.js";
import { manifest } from "./manifest.js";
import { iconToSvg } from "./svg.js";

const find = (id: string) => {
  const descriptor = descriptors.find((candidate) => candidate.meta.id === id);
  if (descriptor === undefined) throw new Error(`no descriptor for ${id}`);
  return descriptor;
};

describe("icon descriptors", () => {
  it("describe every icon in the manifest exactly once", () => {
    expect(compareDescriptors(manifest, descriptors)).toEqual({ missing: [], extra: [], duplicate: [], mismatched: [] });
    expect(descriptors).toHaveLength(manifest.assets.length);
  });

  it("build the SVG string, with the options given", async () => {
    expect(await find("arrow-down").build()).toBe(iconToSvg(arrowDown));
    expect(await find("arrow-down").build({ size: 32, strokeWidth: 1.5, title: "Down" })).toBe(iconToSvg(arrowDown, { size: 32, strokeWidth: 1.5, title: "Down" }));
  });

  it("describe the options for a panel", () => {
    expect(find("arrow-down").fields.map(({ key, type, label }) => ({ key, type, label }))).toEqual([
      { key: "size", type: "integer", label: "Size (px)" },
      { key: "strokeWidth", type: "number", label: "Stroke" },
      { key: "title", type: "string", label: "Accessible name" },
    ]);
  });

  it("write the React, TypeScript and SVG snippets", () => {
    const snippets = find("external-link").snippets();
    expect(snippets.map((snippet) => snippet.label)).toEqual(["React", "TypeScript", "SVG"]);
    expect(snippets[0]?.code).toBe('import { ExternalLink } from "@hedronite/lts-icons/react";\n\n<ExternalLink title="External link" />');
    expect(snippets[1]?.code).toBe('import { externalLink, iconToSvg } from "@hedronite/lts-icons";\n\nconst svg = iconToSvg(externalLink, { title: "External link" });');
    expect(snippets[2]?.code).toMatch(/^<svg xmlns=/);
    expect(find("arrow-down").snippets({ size: 48 })[2]?.code).toContain('width="48"');
  });
});
