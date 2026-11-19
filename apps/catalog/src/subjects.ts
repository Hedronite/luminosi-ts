import type { AssetMeta } from "@hedronite/lts-core";
import { loadDescriptors } from "@hedronite/lts-registry";
import type { ScenePalette } from "@hedronite/lts-tokens";
import { BufferGeometry, Material, Mesh, Object3D, SphereGeometry } from "three";
import crystalClusterGlb from "tool-assets/models/crystal-cluster-glb.glb?url";

/** The model the catalog serves, for the one object whose descriptor asks where its model is. */
const modelUrl = crystalClusterGlb;

/**
 * Builds what the viewport shows for an asset, with its descriptor: an object or a scene kit as it is, a primitive's
 * geometry as a mesh in satin, a material on a sphere. `params` are the asset's parameters, over its defaults. The caller owns the result and frees it with disposeObject.
 * Nothing for an asset that is not something to look at (an icon, a shader, a screen effect).
 */
export async function buildSubject(meta: AssetMeta, palette: ScenePalette, signal: AbortSignal, params?: Readonly<Record<string, unknown>>): Promise<Object3D | undefined> {
  const registry = await loadDescriptors();
  const descriptor = registry.get(meta.id);
  if (descriptor === undefined) return undefined;
  // The model the catalog serves is the one an asset that asks where its model is gets, whatever the parameters say.
  const own = descriptor.fields.some((field) => field.key === "url") ? { url: modelUrl } : undefined;
  const built = await descriptor.build(params === undefined && own === undefined ? undefined : { ...params, ...own }, palette, { signal });
  if (built instanceof Object3D) return built;
  if (built instanceof BufferGeometry) {
    const satin = await registry.get("satin")?.build(undefined, palette);
    return satin instanceof Material ? new Mesh(built, satin) : undefined;
  }
  if (built instanceof Material) return new Mesh(new SphereGeometry(0.95, 64, 32), built);
  return undefined;
}
