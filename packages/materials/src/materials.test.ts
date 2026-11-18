import { createRegistry, registerManifest } from "@hedronite/lts-core";
import { hedronite, neutral, presets, type ScenePalette } from "@hedronite/lts-tokens";
import { BoxGeometry, Color, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial } from "three";
import { describe, expect, it, vi } from "vitest";
import { manifest } from "./manifest.js";
import { materialIds, materialPreset } from "./presets.js";
import { applyPalette, createMaterial } from "./three.js";

describe("material presets", () => {
  it.each(materialIds)("%s has physical values in range", (id) => {
    const preset = materialPreset(id);
    const unit = [preset.roughness, preset.metalness, preset.clearcoat ?? 0, preset.clearcoatRoughness ?? 0, preset.transmission ?? 0, preset.sheen ?? 0, preset.sheenRoughness ?? 0, preset.iridescence ?? 0, preset.specularIntensity ?? 1];
    for (const value of unit) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(preset.ior ?? 1.5).toBeGreaterThanOrEqual(1);
    const [thinnest, thickest] = preset.iridescenceThicknessRange ?? [100, 400];
    expect(thinnest).toBeLessThan(thickest);
  });

  it("names are unique, so the catalog and the playground can tell them apart", () => {
    const names = materialIds.map((id) => materialPreset(id).name);
    expect(new Set(names).size).toBe(names.length);
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

  it("gives cloth a sheen tinted by its scene color", () => {
    const material = createMaterial("fabric", hedronite.scene);
    expect(material.sheen).toBe(1);
    expect(material.sheenColor.equals(new Color(hedronite.scene.base))).toBe(true);
    expect(material.specularIntensity).toBeLessThan(0.5);
  });

  it("gives the iridescent metal a thin film", () => {
    const film = createMaterial("iridescent");
    expect(film.iridescence).toBe(1);
    expect([film.iridescenceThicknessMinimum, film.iridescenceThicknessMaximum]).toEqual([180, 520]);
  });

  it("frosts glass by roughness, keeping its transmission", () => {
    const clear = createMaterial("glass");
    const frosted = createMaterial("glass-frosted");
    expect(frosted.transmission).toBeGreaterThan(0.8);
    expect(frosted.roughness).toBeGreaterThan(clear.roughness * 4);
  });

  it("lacquers clearcoat with a near-mirror coat", () => {
    const material = createMaterial("clearcoat");
    expect(material.clearcoat).toBe(1);
    expect(material.clearcoatRoughness).toBeLessThan(0.1);
  });

  it("can be disposed", () => {
    const material = createMaterial("satin");
    const onDispose = vi.fn();
    material.addEventListener("dispose", onDispose);
    material.dispose();
    expect(onDispose).toHaveBeenCalledOnce();
  });
});

describe("applyPalette", () => {
  const colorsOf = (material: MeshPhysicalMaterial) => [material.color, material.attenuationColor, material.emissive, material.sheenColor].map((color) => color.getHexString());

  it.each(materialIds)("%s: recolored from one look to another, it equals one made in the second look", (id) => {
    for (const from of presets) {
      for (const to of [neutral, hedronite]) {
        const material = createMaterial(id, from.scene);
        applyPalette(material, to.scene);
        expect(colorsOf(material), `${from.id} to ${to.id}`).toEqual(colorsOf(createMaterial(id, to.scene)));
      }
    }
  });

  it("recolors every look from every other, with the same values as making it new, and leaves what is not a color alone", () => {
    for (const to of presets) {
      const material = createMaterial("glass", neutral.scene);
      const before = [material.roughness, material.transmission, material.ior, material.thickness, material.attenuationDistance];
      applyPalette(material, to.scene);
      expect(colorsOf(material)).toEqual(colorsOf(createMaterial("glass", to.scene)));
      expect([material.roughness, material.transmission, material.ior, material.thickness, material.attenuationDistance]).toEqual(before);
    }
  });

  it("keeps a derived tint: a material made off the look follows the look the same way", () => {
    const accented = (palette: ScenePalette): ScenePalette => ({ ...palette, metal: palette.accent });
    const material = createMaterial("metal", neutral.scene, accented);
    expect(material.color.equals(new Color(neutral.scene.accent))).toBe(true);
    applyPalette(material, hedronite.scene);
    expect(material.color.equals(new Color(hedronite.scene.accent))).toBe(true);
  });

  it("recolors the materials under an object, one or many to a mesh, and no others", () => {
    const own = createMaterial("satin", neutral.scene);
    const pair = [createMaterial("metal", neutral.scene), createMaterial("glass", neutral.scene)];
    const stranger = new MeshStandardMaterial({ color: "#123456" });
    const group = new Group();
    group.add(new Mesh(new BoxGeometry(), own), new Mesh(new BoxGeometry(), pair), new Mesh(new BoxGeometry(), stranger));
    applyPalette(group, hedronite.scene);
    expect(own.color.equals(new Color(hedronite.scene[materialPreset("satin").color]))).toBe(true);
    expect(pair[0]?.color.equals(new Color(hedronite.scene[materialPreset("metal").color]))).toBe(true);
    expect(pair[1]?.color.equals(new Color(hedronite.scene.glass))).toBe(true);
    expect(stranger.color.getHexString()).toBe("123456");
  });
});
