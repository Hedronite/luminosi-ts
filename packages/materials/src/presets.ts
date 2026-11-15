import type { ScenePalette } from "@hedronite/lts-tokens";

/** A physically based material, described as data. Colors come from the active token preset. */
export interface MaterialPreset {
  readonly name: string;
  readonly tags: readonly string[];
  /** Which scene color the material takes from the token preset. */
  readonly color: keyof ScenePalette;
  readonly roughness: number;
  readonly metalness: number;
  readonly clearcoat?: number;
  readonly transmission?: number;
  readonly ior?: number;
  readonly thickness?: number;
  /** For transmissive materials: how far light travels before taking the full color. Smaller is deeper. */
  readonly attenuationDistance?: number;
  readonly emissiveIntensity?: number;
}

/** Every material preset, by id. Style-agnostic: the token preset supplies the colors. */
export const materialPresets = {
  ceramic: { name: "Ceramic", tags: ["dielectric", "glossy"], color: "base", roughness: 0.25, metalness: 0, clearcoat: 0.6 },
  emissive: { name: "Emissive", tags: ["light"], color: "emissive", roughness: 0.6, metalness: 0, emissiveIntensity: 2 },
  glass: { name: "Glass", tags: ["dielectric", "transparent"], color: "glass", roughness: 0.05, metalness: 0, transmission: 0.92, ior: 1.5, thickness: 1.2, attenuationDistance: 0.9 },
  matte: { name: "Matte", tags: ["dielectric"], color: "base", roughness: 0.9, metalness: 0 },
  metal: { name: "Metal", tags: ["metal", "polished"], color: "metal", roughness: 0.18, metalness: 1 },
  "metal-brushed": { name: "Brushed metal", tags: ["metal"], color: "metal", roughness: 0.45, metalness: 1 },
  satin: { name: "Satin", tags: ["dielectric"], color: "accent", roughness: 0.45, metalness: 0, clearcoat: 0.2 },
} as const satisfies Record<string, MaterialPreset>;

export type MaterialId = keyof typeof materialPresets;

export function isMaterialId(id: string): id is MaterialId {
  return Object.hasOwn(materialPresets, id);
}

export const materialIds: readonly MaterialId[] = Object.keys(materialPresets).filter(isMaterialId).sort();

/** The preset data for a material id. */
export function materialPreset(id: MaterialId): MaterialPreset {
  return materialPresets[id];
}
