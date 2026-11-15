import { createRegistry, registerManifest } from "@hedronite/lts-core";
import { hedronite } from "@hedronite/lts-tokens";
import { Color, MeshStandardNodeMaterial } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createEffectMaterial, createFresnelGlowMaterial, createHeightGradientMaterial, createPulseMaterial, effectIds } from "./effects.js";
import { manifest } from "./manifest.js";

describe("effects", () => {
  it.each(effectIds)("%s builds a node material with its graph attached", (id) => {
    const material = createEffectMaterial(id);
    expect(material).toBeInstanceOf(MeshStandardNodeMaterial);
    expect(material.name).toBe(id);
    expect(material.colorNode ?? material.emissiveNode).toBeTruthy();
  });

  it("validates parameters where they enter", () => {
    expect(() => createFresnelGlowMaterial({ power: 99 })).toThrow(z.ZodError);
    expect(() => createPulseMaterial({ color: "red" })).toThrow(z.ZodError);
    expect(() => createHeightGradientMaterial({ minY: 1, maxY: 0 })).toThrow(RangeError);
  });

  it("takes default colors from the token preset", () => {
    const material = createFresnelGlowMaterial({}, hedronite.scene);
    expect(material.color.equals(new Color(hedronite.scene.base))).toBe(true);
  });

  it("registers one shader asset per effect", () => {
    const registry = createRegistry();
    registerManifest(registry, manifest);
    expect(registry.list({ kind: "shader" }).map((a) => a.id)).toEqual([...effectIds]);
  });
});
