import { isMaterialId, type MaterialId } from "@hedronite/lts-materials";
import { createMaterial } from "@hedronite/lts-materials/three";
import { createFramedSolid } from "@hedronite/lts-objects/three";
import { isPrimitiveId, primitive, type PrimitiveId } from "@hedronite/lts-primitives";
import { createPolyhedronGeometry } from "@hedronite/lts-primitives/three";
import { isEffectId, type EffectId } from "@hedronite/lts-shaders";
import type { EffectClock } from "@hedronite/lts-shaders/three";
import { loadDescriptors } from "@hedronite/lts-registry";
import type { ScenePalette } from "@hedronite/lts-tokens";
import { Material, Mesh, Object3D } from "three";
import type { Placeable } from "./placeable";

/** What stands on the effects stage: one of the solids, or a library object. */
export type StageSubject = { readonly kind: "solid"; readonly id: PrimitiveId } | { readonly kind: "object"; readonly id: string };

/** How it is surfaced: as built, framed glass, one material preset, or one surface shader. */
export type StageSurface =
  | { readonly kind: "own" }
  | { readonly kind: "framed" }
  | { readonly kind: "material"; readonly id: MaterialId }
  | { readonly kind: "shader"; readonly id: EffectId };

/** Subjects and surfaces as `<select>` values, and back. */
export const subjectValue = (subject: StageSubject): string => `${subject.kind}:${subject.id}`;
export const surfaceValue = (surface: StageSurface): string => (surface.kind === "own" || surface.kind === "framed" ? surface.kind : `${surface.kind}:${surface.id}`);

/** A `<select>` value back to a subject. `objects` are the objects it may name. */
export function parseSubject(value: string, objects: readonly Placeable[]): StageSubject | undefined {
  const [kind, id = ""] = value.split(/:(.*)/s);
  if (kind === "solid" && isPrimitiveId(id)) return { kind, id };
  if (kind === "object" && objects.some((object) => object.id === id)) return { kind, id };
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

/** What a descriptor builds, by id, when it is the kind of thing the caller needs; its parameters take their defaults. */
async function make<T>(id: string, palette: ScenePalette, accepts: (built: unknown) => built is T): Promise<T> {
  const descriptor = (await loadDescriptors()).get(id);
  if (descriptor === undefined) throw new RangeError(`no descriptor for ${id}`);
  const built = await descriptor.build(undefined, palette);
  if (!accepts(built)) throw new TypeError(`${id} did not build what the stage needs`);
  return built;
}

const isMaterial = (built: unknown): built is Material => built instanceof Material;
const isObject = (built: unknown): built is Object3D => built instanceof Object3D;

/** The surface's material, if it has one. A shader reads its time from the stage's `shaderClock`, so a held stage holds it still. */
async function surfaceMaterial(surface: StageSurface, palette: ScenePalette, shaderClock: EffectClock | undefined): Promise<Material | undefined> {
  if (surface.kind === "material") return make(surface.id, palette, isMaterial);
  if (surface.kind !== "shader") return undefined;
  const { createEffect } = await import("@hedronite/lts-shaders/three");
  return createEffect(surface.id, {}, palette, shaderClock === undefined ? {} : { clock: shaderClock }).material;
}

/**
 * Builds the stage's subject in its surface, from the descriptors. Solids have no surface of their own, so "own"
 * frames them; objects can't be framed, so "framed" keeps their own. The caller frees the result with disposeObject.
 */
export async function buildStage(subject: StageSubject, surface: StageSurface, palette: ScenePalette, shaderClock?: EffectClock): Promise<Object3D> {
  const material = await surfaceMaterial(surface, palette, shaderClock);
  if (subject.kind === "object") {
    const object = await make(subject.id, palette, isObject);
    return material === undefined ? object : resurface(object, material);
  }
  const shape = primitive(subject.id);
  if (material === undefined) {
    return createFramedSolid(shape, { faces: createMaterial("glass", palette), edges: createMaterial("metal", { ...palette, metal: palette.accent }) });
  }
  return new Mesh(createPolyhedronGeometry(shape, subject.id), material);
}
