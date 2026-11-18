import { describe, expect, it } from "vitest";
import { loadDescriptors } from "./lazy.js";
import { loadRegistry } from "./registry.js";
import { snippetsFor } from "./snippets.js";

const meta = { id: "arrow-right", kind: "icon", name: "Arrow right", tags: [], version: "0.1.0" } as const;

describe("snippetsFor", () => {
  it("gives React, TypeScript and SVG snippets for an icon", async () => {
    const snippets = await snippetsFor(meta);
    expect(snippets.map((s) => s.label)).toEqual(["React", "TypeScript", "SVG"]);
    expect(snippets[0]?.code).toContain('import { ArrowRight } from "@hedronite/lts-icons/react";');
    expect(snippets[1]?.code).toContain("iconToSvg(arrowRight");
    expect(snippets[2]?.code).toMatch(/^<svg /);
  });

  it("builds a primitive's geometry by id", async () => {
    const [snippet] = await snippetsFor({ ...meta, id: "platonic-cube", kind: "primitive" });
    expect(snippet?.code).toContain('primitive("platonic-cube")');
  });

  it("creates a material by id, with and without a token preset", async () => {
    const [snippet] = await snippetsFor({ ...meta, id: "glass", kind: "material" });
    expect(snippet?.code).toContain('createMaterial("glass")');
    expect(snippet?.code).toContain("hedronite.scene");
  });

  it("gives nothing for an asset with no descriptor", async () => {
    expect(await snippetsFor({ ...meta, id: "unknown-object", kind: "object" })).toEqual([]);
  });

  it("builds a scene kit by name", async () => {
    const [snippet] = await snippetsFor({ ...meta, id: "scene-dusk", kind: "scene" });
    expect(snippet?.code).toContain('createSceneKit("dusk")');
  });

  it("follows the parameters given, and refuses ones outside the descriptor's schema", async () => {
    expect((await snippetsFor(meta, { size: 48 }))[2]?.code).toContain('width="48"');
    await expect(snippetsFor(meta, { size: 1 })).rejects.toThrow();
  });
});

describe("object snippets", () => {
  it.each(["crystal-cluster", "instanced-lattice", "crystal-cluster-glb"])("gives a TypeScript snippet for %s", async (id) => {
    const [snippet] = await snippetsFor({ ...meta, id, kind: "object" });
    expect(snippet?.label).toBe("TypeScript");
    expect(snippet?.code).toContain("@hedronite/lts-objects");
  });
});

describe("shader snippets", () => {
  it("uses WebGPURenderer", async () => {
    const [snippet] = await snippetsFor({ ...meta, id: "fresnel-glow", kind: "shader" });
    expect(snippet?.code).toContain('createEffectMaterial("fresnel-glow")');
    expect(snippet?.code).toContain("WebGPURenderer");
  });
});

describe("descriptors in the registry", () => {
  it("cover exactly the assets the registry lists, so every one has snippets", async () => {
    const assets = loadRegistry().list();
    const described = (await loadDescriptors()).list();
    expect(described.map((descriptor) => descriptor.meta)).toEqual(assets);
    const counts = await Promise.all(assets.map(async (asset) => [asset.id, (await snippetsFor(asset)).length] as const));
    expect(counts.filter(([, count]) => count === 0)).toEqual([]);
  });
});
