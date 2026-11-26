import type { MaterialId } from "@hedronite/lts-materials";
import type { PrimitiveId, Vec3 } from "@hedronite/lts-primitives";
import type { Hex, SceneLightRole } from "@hedronite/lts-tokens";
import { duskLightTints } from "@hedronite/lts-tokens";

export type LightSpec =
  | { readonly kind: "directional"; readonly role: SceneLightRole; readonly intensity: number; readonly position: Vec3; readonly tint?: Hex }
  | { readonly kind: "ambient"; readonly role: SceneLightRole; readonly intensity: number; readonly tint?: Hex }
  | { readonly kind: "hemisphere"; readonly sky: SceneLightRole; readonly ground: SceneLightRole; readonly intensity: number };

export interface PlacementSpec {
  readonly primitive: PrimitiveId;
  readonly material: MaterialId;
  readonly position: Vec3;
  readonly scale: number;
  readonly rotation?: Vec3;
}

/** A scene as data: a lighting mood and a small composition. Lights and materials take their colors from the token preset. */
export interface SceneKit {
  readonly name: string;
  readonly tags: readonly string[];
  readonly lights: readonly LightSpec[];
  readonly placements: readonly PlacementSpec[];
}

/** Every scene kit, by id. Each fits inside a sphere of radius 1.2 around the origin. */
export const sceneKits = {
  dusk: {
    name: "Dusk",
    tags: ["warm", "low-key"],
    lights: [
      { kind: "directional", role: "key", intensity: 2.2, position: [-4, 1.2, 3], tint: duskLightTints.key },
      { kind: "directional", role: "rim", intensity: 1.4, position: [3, 2, -4], tint: duskLightTints.rim },
      { kind: "ambient", role: "ambient", intensity: 0.6, tint: duskLightTints.ambient },
    ],
    placements: [
      { primitive: "hexagonal-bipyramid", material: "ceramic", position: [-0.45, 0.05, 0], scale: 0.45 },
      { primitive: "platonic-dodecahedron", material: "metal-brushed", position: [0.5, -0.15, 0.2], scale: 0.35 },
    ],
  },
  gallery: {
    name: "Gallery",
    tags: ["high-key", "soft"],
    lights: [
      { kind: "hemisphere", sky: "sky", ground: "ground", intensity: 1.6 },
      { kind: "directional", role: "key", intensity: 1.2, position: [0, 5, 2] },
    ],
    placements: [
      { primitive: "platonic-cube", material: "matte", position: [-0.65, -0.1, 0], scale: 0.3 },
      { primitive: "platonic-octahedron", material: "ceramic", position: [0, 0.05, 0], scale: 0.32 },
      { primitive: "platonic-icosahedron", material: "satin", position: [0.65, -0.1, 0], scale: 0.3 },
    ],
  },
  noir: {
    name: "Noir",
    tags: ["dramatic", "low-key"],
    lights: [
      { kind: "directional", role: "key", intensity: 3.2, position: [3, 4, 1] },
      { kind: "ambient", role: "ambient", intensity: 0.05 },
    ],
    placements: [{ primitive: "platonic-icosahedron", material: "metal", position: [0, 0, 0], scale: 0.6 }],
  },
  studio: {
    name: "Studio",
    tags: ["neutral", "three-point"],
    lights: [
      { kind: "directional", role: "key", intensity: 2.4, position: [3, 4, 5] },
      { kind: "directional", role: "fill", intensity: 0.9, position: [-4, 1.5, 2] },
      { kind: "directional", role: "rim", intensity: 1.6, position: [0, 3, -5] },
      { kind: "ambient", role: "ambient", intensity: 0.25 },
    ],
    placements: [
      { primitive: "hexagonal-prism", material: "matte", position: [-0.5, -0.2, 0], scale: 0.4, rotation: [0.5, 0, 0] },
      { primitive: "platonic-tetrahedron", material: "satin", position: [0.5, 0, 0], scale: 0.45, rotation: [0, 0.4, 0] },
    ],
  },
} as const satisfies Record<string, SceneKit>;

export type SceneKitId = keyof typeof sceneKits;

export function isSceneKitId(id: string): id is SceneKitId {
  return Object.hasOwn(sceneKits, id);
}

export const sceneKitIds: readonly SceneKitId[] = Object.keys(sceneKits).filter(isSceneKitId).sort();

/** The data for a scene kit id. */
export function sceneKit(id: SceneKitId): SceneKit {
  return sceneKits[id];
}
