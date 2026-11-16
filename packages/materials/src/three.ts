import { neutral, type ScenePalette } from "@hedronite/lts-tokens";
import { Color, MeshPhysicalMaterial } from "three";
import { materialPreset, type MaterialId } from "./presets.js";

/**
 * A three.js material for a preset, colored from `palette` (default: the neutral token preset).
 * The caller owns it and must dispose it.
 */
export function createMaterial(id: MaterialId, palette: ScenePalette = neutral.scene): MeshPhysicalMaterial {
  const preset = materialPreset(id);
  const color = new Color(palette[preset.color]);
  const material = new MeshPhysicalMaterial({
    name: id,
    color,
    roughness: preset.roughness,
    metalness: preset.metalness,
    clearcoat: preset.clearcoat ?? 0,
    clearcoatRoughness: preset.clearcoatRoughness ?? 0,
    transmission: preset.transmission ?? 0,
    ior: preset.ior ?? 1.5,
    thickness: preset.thickness ?? 0,
  });
  if (preset.attenuationDistance !== undefined) {
    // Tint the light passing through, so facets read on any background.
    material.attenuationColor = color.clone();
    material.attenuationDistance = preset.attenuationDistance;
  }
  if (preset.emissiveIntensity !== undefined) {
    material.emissive = color.clone();
    material.emissiveIntensity = preset.emissiveIntensity;
  }
  if (preset.sheen !== undefined) {
    material.sheen = preset.sheen;
    material.sheenRoughness = preset.sheenRoughness ?? 1;
    material.sheenColor = preset.sheenColor === undefined ? color.clone() : new Color(palette[preset.sheenColor]);
  }
  if (preset.iridescence !== undefined) {
    material.iridescence = preset.iridescence;
    material.iridescenceIOR = preset.iridescenceIOR ?? 1.3;
    const [thinnest, thickest] = preset.iridescenceThicknessRange ?? [100, 400];
    material.iridescenceThicknessMinimum = thinnest;
    material.iridescenceThicknessMaximum = thickest;
  }
  if (preset.specularIntensity !== undefined) material.specularIntensity = preset.specularIntensity;
  return material;
}
