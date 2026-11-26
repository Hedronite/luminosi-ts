import type { SceneColorKey } from "@hedronite/lts-tokens";

/** A physically based material, described as data. Colors come from the active token preset. */
export interface MaterialPreset {
  readonly name: string;
  readonly tags: readonly string[];
  /** Which scene color the material takes from the token preset. */
  readonly color: SceneColorKey;
  readonly roughness: number;
  readonly metalness: number;
  readonly clearcoat?: number;
  /** Roughness of the clear coat itself; 0 is a mirror-like lacquer. */
  readonly clearcoatRoughness?: number;
  readonly transmission?: number;
  readonly ior?: number;
  readonly thickness?: number;
  /** For transmissive materials: how far light travels before taking the full color. Smaller is deeper. */
  readonly attenuationDistance?: number;
  readonly emissiveIntensity?: number;
  /** Soft retro-reflection at grazing angles, as cloth and velvet have. 0 to 1. */
  readonly sheen?: number;
  readonly sheenRoughness?: number;
  /** Which scene color tints the sheen; without it the sheen is the material's own color. */
  readonly sheenColor?: SceneColorKey;
  /** A thin film over the surface whose color shifts with the viewing angle. 0 to 1. */
  readonly iridescence?: number;
  readonly iridescenceIOR?: number;
  /** The film's thickness in nanometers, thinnest to thickest. */
  readonly iridescenceThicknessRange?: readonly [number, number];
  /** How strong the non-metallic reflection is; rubber and chalky surfaces sit low. 0 to 1. */
  readonly specularIntensity?: number;
}

/** Every material preset, by id. Style-agnostic: the token preset supplies the colors. */
export const materialPresets = {
  ceramic: { name: "Ceramic", tags: ["dielectric", "glossy"], color: "base", roughness: 0.25, metalness: 0, clearcoat: 0.6 },
  clearcoat: { name: "Clearcoat", tags: ["coated", "glossy", "paint"], color: "accent", roughness: 0.4, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.03 },
  emissive: { name: "Emissive", tags: ["light"], color: "emissive", roughness: 0.6, metalness: 0, emissiveIntensity: 2 },
  fabric: { name: "Fabric", tags: ["dielectric", "cloth", "soft"], color: "accent", roughness: 0.9, metalness: 0, sheen: 1, sheenRoughness: 0.45, sheenColor: "base", specularIntensity: 0.3 },
  glass: { name: "Glass", tags: ["dielectric", "transparent"], color: "glass", roughness: 0.05, metalness: 0, transmission: 0.92, ior: 1.5, thickness: 1.2, attenuationDistance: 0.9 },
  "glass-frosted": { name: "Frosted glass", tags: ["dielectric", "transparent", "diffuse"], color: "glass", roughness: 0.45, metalness: 0, transmission: 0.9, ior: 1.5, thickness: 1.2, attenuationDistance: 1.4 },
  iridescent: {
    name: "Iridescent",
    tags: ["metal", "thin-film", "shifting"],
    color: "metal",
    roughness: 0.2,
    metalness: 1,
    iridescence: 1,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [180, 520],
  },
  matte: { name: "Matte", tags: ["dielectric"], color: "base", roughness: 0.9, metalness: 0 },
  metal: { name: "Metal", tags: ["metal", "polished"], color: "metal", roughness: 0.18, metalness: 1 },
  "metal-anodized": { name: "Anodized metal", tags: ["metal", "colored"], color: "accent", roughness: 0.32, metalness: 1, clearcoat: 0.25, clearcoatRoughness: 0.2 },
  "metal-brushed": { name: "Brushed metal", tags: ["metal"], color: "metal", roughness: 0.45, metalness: 1 },
  rubber: { name: "Rubber", tags: ["dielectric", "soft"], color: "base", roughness: 0.75, metalness: 0, specularIntensity: 0.25, sheen: 0.25, sheenRoughness: 0.8 },
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
