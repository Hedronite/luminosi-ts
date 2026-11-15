import type { AssetMeta } from "@hedronite/lts-core";
import { createMaterial, isMaterialId } from "@hedronite/lts-materials";
import { createCrystalCluster, createLattice, crystalCluster, latticePoints, loadGltf } from "@hedronite/lts-objects";
import { createPolyhedronGeometry, geodesicSphere, isPrimitiveId, primitive } from "@hedronite/lts-primitives";
import type { ScenePalette } from "@hedronite/lts-tokens";
import { Mesh, type Object3D } from "three";
import crystalClusterGlb from "tool-assets/models/crystal-cluster-glb.glb?url";

/** Settings the catalog uses to show each object; the same values appear in its snippet. */
const objectSettings = {
  cluster: { count: 14, spread: 0.7, seed: 11 },
  lattice: { size: 6, spacing: 0.28, scale: 0.06 },
  glbUrl: crystalClusterGlb,
} as const;

/** Builds what the viewport shows for an asset. The caller owns the result and frees it with disposeObject. */
export async function buildSubject(meta: AssetMeta, palette: ScenePalette, signal: AbortSignal): Promise<Object3D | undefined> {
  if (meta.kind === "primitive" && isPrimitiveId(meta.id)) {
    return new Mesh(createPolyhedronGeometry(primitive(meta.id), meta.id), createMaterial("satin", palette));
  }
  if (meta.kind === "material" && isMaterialId(meta.id)) {
    return new Mesh(createPolyhedronGeometry(geodesicSphere(6, 0.95), "sphere"), createMaterial(meta.id, palette));
  }
  if (meta.id === "crystal-cluster") {
    return createCrystalCluster(crystalCluster(objectSettings.cluster), createMaterial("satin", palette));
  }
  if (meta.id === "instanced-lattice") {
    const { size, spacing, scale } = objectSettings.lattice;
    return createLattice(latticePoints({ size, spacing }), createMaterial("metal", palette), { scale });
  }
  if (meta.id === "crystal-cluster-glb") {
    return loadGltf(objectSettings.glbUrl, { signal });
  }
  return undefined;
}
