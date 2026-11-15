import { createRegistry, registerManifest } from "@hedronite/lts-core";
import { hedronite, neutral } from "@hedronite/lts-tokens";
import { Color, MeshPhysicalMaterial } from "three";
import { describe, expect, it, vi } from "vitest";
import { manifest } from "./manifest.js";
import { materialIds, materialPreset } from "./presets.js";
import { createMaterial } from "./three.js";

describe("material presets", () => {
  it.each(materialIds)("%s has physical values in range", (id) => {
    const preset = materialPreset(id);
    for (const value of [preset.roughness, preset.metalness, preset.clearcoat ?? 0, preset.transmission ?? 0]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(preset.ior ?? 1.5).toBeGreaterThanOrEqual(1);
  });

  it("registers one material asset per preset", () => {
    const registry = createRegistry();
    registerManifest(registry, manifest);
    expect(registry.list({ kind: "material" }).map((a) => a.id)).toEqual([...materialIds]);
  });
});

describe("createMaterial", () => {
  it("builds a physical material named for its preset", () => {
    const material = createMaterial("glass");
    expect(material).toBeInstanceOf(MeshPhysicalMaterial);
    expect(material.name).toBe("glass");
    expect(material.transmission).toBeGreaterThan(0.9);
    expect(material.ior).toBe(1.5);
    expect(material.attenuationColor.equals(material.color)).toBe(true);
    expect(material.attenuationDistance).toBeLessThan(Infinity);
  });

  it("takes its color from the token preset, so swapping presets swaps the look", () => {
    const a = createMaterial("metal", neutral.scene);
    const b = createMaterial("metal", hedronite.scene);
    expect(a.color.equals(new Color(neutral.scene.metal))).toBe(true);
    expect(b.color.equals(new Color(hedronite.scene.metal))).toBe(true);
    expect(a.color.equals(b.color)).toBe(false);
  });

  it("makes emissive materials glow in their own color", () => {
    const material = createMaterial("emissive");
    expect(material.emissiveIntensity).toBe(2);
    expect(material.emissive.equals(material.color)).toBe(true);
  });

  it("can be disposed", () => {
    const material = createMaterial("satin");
    const onDispose = vi.fn();
    material.addEventListener("dispose", onDispose);
    material.dispose();
    expect(onDispose).toHaveBeenCalledOnce();
  });
});
