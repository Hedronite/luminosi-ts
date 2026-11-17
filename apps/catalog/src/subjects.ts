import type { AssetMeta } from "@hedronite/lts-core";
import { isMaterialId } from "@hedronite/lts-materials";
import { createMaterial } from "@hedronite/lts-materials/three";
import { crystalCluster, dressWatchSpec, latticePoints, objectSpecById, showcase } from "@hedronite/lts-objects";
import { createCrystalCluster, createFramedSolid, createLattice, createObjectFromSpec, loadGltf } from "@hedronite/lts-objects/three";
import { geodesicSphere, isPrimitiveId, platonic, primitive } from "@hedronite/lts-primitives";
import { createPolyhedronGeometry } from "@hedronite/lts-primitives/three";
import { isSceneKitId } from "@hedronite/lts-scenes";
import { createSceneKit } from "@hedronite/lts-scenes/three";
import type { ScenePalette } from "@hedronite/lts-tokens";
import { Mesh, type Object3D } from "three";
import crystalClusterGlb from "tool-assets/models/crystal-cluster-glb.glb?url";

/** Builds what the viewport shows for an asset. The caller owns the result and frees it with disposeObject. */
export async function buildSubject(meta: AssetMeta, palette: ScenePalette, signal: AbortSignal): Promise<Object3D | undefined> {
  if (meta.kind === "primitive" && isPrimitiveId(meta.id)) {
    return new Mesh(createPolyhedronGeometry(primitive(meta.id), meta.id), createMaterial("satin", palette));
  }
  if (meta.kind === "material" && isMaterialId(meta.id)) {
    return new Mesh(createPolyhedronGeometry(geodesicSphere(6, 0.95), "sphere"), createMaterial(meta.id, palette));
  }
  if (meta.id === "crystal-cluster") {
    return createCrystalCluster(crystalCluster(showcase.cluster), createMaterial("satin", palette));
  }
  if (meta.id === "framed-solid") {
    // Glass faces with edges and beads in metal tinted by the look's accent: copper in the Hedronite look.
    const solid = platonic(showcase.framedSolid.solid, showcase.framedSolid.radius);
    return createFramedSolid(solid, { faces: createMaterial("glass", palette), edges: createMaterial("metal", { ...palette, metal: palette.accent }) });
  }
  if (meta.id === "instanced-lattice") {
    const { size, spacing, scale } = showcase.lattice;
    return createLattice(latticePoints({ size, spacing }), createMaterial("metal", palette), { scale });
  }
  const stored = meta.kind === "object" ? objectSpecById(meta.id) : undefined;
  if (stored !== undefined) {
    return createObjectFromSpec(stored, { palette });
  }
  if (meta.id === "dress-watch") {
    return createObjectFromSpec(dressWatchSpec(showcase.watch), { palette });
  }
  const kit = meta.id.replace(/^scene-/, "");
  if (meta.kind === "scene" && isSceneKitId(kit)) {
    return createSceneKit(kit, palette);
  }
  if (meta.id === "crystal-cluster-glb") {
    return loadGltf(crystalClusterGlb, { signal });
  }
  return undefined;
}
