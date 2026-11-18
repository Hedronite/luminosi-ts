import { neutral, type ScenePalette } from "@hedronite/lts-tokens";
import { Color, Mesh, MeshPhysicalMaterial, Object3D, type Material } from "three";
import { materialPreset, type MaterialId, type MaterialPreset } from "./presets.js";

/** Turns a look's scene colors into the ones a material reads, for a material tinted off the look (an edge in the accent, a part shaded darker). */
export type PaletteDerive = (palette: ScenePalette) => ScenePalette;

/** What `applyPalette` needs to know about a material made here: its preset, and how its colors come from a look. Not its name: a part of an object may rename it. */
const made = new WeakMap<Material, { readonly preset: MaterialPreset; readonly derive: PaletteDerive | undefined }>();

/** Writes the colors a preset takes from a look into `material`, in place. The one place those colors are decided. */
function paint(material: MeshPhysicalMaterial, preset: MaterialPreset, scene: ScenePalette): void {
  material.color.set(scene[preset.color]);
  // Tint the light passing through, so facets read on any background.
  if (preset.attenuationDistance !== undefined) material.attenuationColor.set(scene[preset.color]);
  if (preset.emissiveIntensity !== undefined) material.emissive.set(scene[preset.color]);
  if (preset.sheen !== undefined) material.sheenColor.set(scene[preset.sheenColor ?? preset.color]);
}

/**
 * A three.js material for a preset, colored from `palette` (default: the neutral token preset).
 * `derive` says how this material's colors come from a look when it is not the look's own (framed edges in
 * the accent, say); it is used now and by `applyPalette` later. The caller owns it and must dispose it.
 */
export function createMaterial(id: MaterialId, palette: ScenePalette = neutral.scene, derive?: PaletteDerive): MeshPhysicalMaterial {
  const preset = materialPreset(id);
  const material = new MeshPhysicalMaterial({
    name: id,
    color: new Color(),
    roughness: preset.roughness,
    metalness: preset.metalness,
    clearcoat: preset.clearcoat ?? 0,
    clearcoatRoughness: preset.clearcoatRoughness ?? 0,
    transmission: preset.transmission ?? 0,
    ior: preset.ior ?? 1.5,
    thickness: preset.thickness ?? 0,
  });
  if (preset.attenuationDistance !== undefined) material.attenuationDistance = preset.attenuationDistance;
  if (preset.emissiveIntensity !== undefined) material.emissiveIntensity = preset.emissiveIntensity;
  if (preset.sheen !== undefined) {
    material.sheen = preset.sheen;
    material.sheenRoughness = preset.sheenRoughness ?? 1;
  }
  if (preset.iridescence !== undefined) {
    material.iridescence = preset.iridescence;
    material.iridescenceIOR = preset.iridescenceIOR ?? 1.3;
    const [thinnest, thickest] = preset.iridescenceThicknessRange ?? [100, 400];
    material.iridescenceThicknessMinimum = thinnest;
    material.iridescenceThicknessMaximum = thickest;
  }
  if (preset.specularIntensity !== undefined) material.specularIntensity = preset.specularIntensity;
  paint(material, preset, derive === undefined ? palette : derive(palette));
  made.set(material, { preset, derive });
  return material;
}

/**
 * Recolors in place, from a look, the materials `createMaterial` made: one material, a list of them, or every
 * material under an object. A change of look is a write to their colors, with nothing rebuilt: the same
 * geometries, the same programs. A material made some other way is left alone. The caller asks for a new frame.
 */
export function applyPalette(target: Material | readonly Material[] | Object3D, palette: ScenePalette): void {
  repaint(target, palette);
}

function repaint(target: unknown, palette: ScenePalette): void {
  if (Array.isArray(target)) {
    target.forEach((each) => {
      repaint(each, palette);
    });
  } else if (target instanceof MeshPhysicalMaterial) {
    const known = made.get(target);
    if (known !== undefined) paint(target, known.preset, known.derive === undefined ? palette : known.derive(palette));
  } else if (target instanceof Object3D) {
    target.traverse((child) => {
      if (child instanceof Mesh) repaint(child.material, palette);
    });
  }
}
