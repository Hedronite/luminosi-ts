import { isMaterialId, type MaterialId } from "@hedronite/lts-materials";
import { createMaterial } from "@hedronite/lts-materials/three";
import { crystalCluster, dressWatchSpec, latticePoints, objectSpecById } from "@hedronite/lts-objects";
import { createCrystalCluster, createFramedSolid, createLattice, createObjectFromSpec } from "@hedronite/lts-objects/three";
import { isPrimitiveId, primitive, type PrimitiveId } from "@hedronite/lts-primitives";
import { createPolyhedronGeometry } from "@hedronite/lts-primitives/three";
import { isEffectId, type EffectId } from "@hedronite/lts-shaders";
import { createEffectMaterial } from "@hedronite/lts-shaders/three";
import type { ScenePalette } from "@hedronite/lts-tokens";
import { Material, Mesh, type Object3D } from "three";
import { isPlaceableObject, type PlaceableObject } from "./composition";

/** What stands on the effects stage: one of the solids, or a library object. */
export type StageSubject = { readonly kind: "solid"; readonly id: PrimitiveId } | { readonly kind: "object"; readonly id: PlaceableObject };

/** How it is surfaced: as built, framed glass, one material preset, or one surface shader. */
export type StageSurface =
  | { readonly kind: "own" }
  | { readonly kind: "framed" }
  | { readonly kind: "material"; readonly id: MaterialId }
  | { readonly kind: "shader"; readonly id: EffectId };

/** Subjects and surfaces as `<select>` values, and back. */
export const subjectValue = (subject: StageSubject): string => `${subject.kind}:${subject.id}`;
export const surfaceValue = (surface: StageSurface): string => (surface.kind === "own" || surface.kind === "framed" ? surface.kind : `${surface.kind}:${surface.id}`);

export function parseSubject(value: string): StageSubject | undefined {
  const [kind, id = ""] = value.split(/:(.*)/s);
  if (kind === "solid" && isPrimitiveId(id)) return { kind, id };
  if (kind === "object" && isPlaceableObject(id)) return { kind, id };
  return undefined;
}

export function parseSurface(value: string): StageSurface | undefined {
  if (value === "own" || value === "framed") return { kind: value };
  const [kind, id = ""] = value.split(/:(.*)/s);
  if (kind === "material" && isMaterialId(id)) return { kind, id };
  if (kind === "shader" && isEffectId(id)) return { kind, id };
  return undefined;
}

/** Gives every mesh in `object` the same material, freeing the ones it had. */
function resurface(object: Object3D, material: Material): Object3D {
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const old: unknown = child.material;
    for (const each of Array.isArray(old) ? old : [old]) if (each instanceof Material && each !== material) each.dispose();
    child.material = material;
  });
  return object;
}

const tenPastTen = { hours: 10, minutes: 9, seconds: 36 } as const;

function buildObject(id: PlaceableObject, palette: ScenePalette): Object3D {
  switch (id) {
    case "crystal-cluster":
      return createCrystalCluster(crystalCluster({ count: 14, spread: 0.7, seed: 11 }), createMaterial("satin", palette));
    case "instanced-lattice":
      return createLattice(latticePoints({ size: 6, spacing: 0.28 }), createMaterial("metal", palette), { scale: 0.06 });
    case "dress-watch":
      return createObjectFromSpec(dressWatchSpec(tenPastTen), { palette });
    case "your-desk-lamp": {
      const spec = objectSpecById(id);
      if (spec === undefined) throw new Error(`no spec for ${id}`);
      return createObjectFromSpec(spec, { palette });
    }
  }
}

/**
 * Builds the stage's subject in its surface. Solids have no surface of their own, so "own" frames them;
 * objects can't be framed, so "framed" keeps their own. The caller frees the result with disposeObject.
 */
export function buildStage(subject: StageSubject, surface: StageSurface, palette: ScenePalette): Object3D {
  const material = surface.kind === "material" ? createMaterial(surface.id, palette) : surface.kind === "shader" ? createEffectMaterial(surface.id, palette) : undefined;
  if (subject.kind === "object") {
    const object = buildObject(subject.id, palette);
    return material === undefined ? object : resurface(object, material);
  }
  const shape = primitive(subject.id);
  if (material === undefined) {
    return createFramedSolid(shape, { faces: createMaterial("glass", palette), edges: createMaterial("metal", { ...palette, metal: palette.accent }) });
  }
  return new Mesh(createPolyhedronGeometry(shape, subject.id), material);
}
