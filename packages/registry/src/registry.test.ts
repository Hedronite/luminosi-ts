import { describe, expect, it } from "vitest";
import { buildRegistry, loadRegistry, manifests } from "./registry.js";

describe("registry", () => {
  it("registers every package's manifest without a problem", () => {
    const { registry, problems } = buildRegistry();
    expect(problems).toEqual([]);
    expect(registry.list()).toHaveLength(manifests.reduce((total, manifest) => total + manifest.assets.length, 0));
  });

  it("holds each package's assets under that package", () => {
    const registry = loadRegistry();
    for (const manifest of manifests) {
      for (const asset of manifest.assets) expect(registry.get(asset.id)?.package).toBe(manifest.package);
    }
  });

  it("covers all seven kinds", () => {
    const kinds = new Set(loadRegistry().list().map((asset) => asset.kind));
    expect([...kinds].sort()).toEqual(["effect", "icon", "material", "object", "primitive", "scene", "shader"]);
  });
});
