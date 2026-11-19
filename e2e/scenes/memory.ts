import { isMaterialId, materialPreset } from "@hedronite/lts-materials";
import type { Scene } from "@hedronite/lts-scene";

/** Every material a document names: its nodes' surfaces, a framed solid's edges, and an object's `material` parameter. */
function materialsOf(scene: Scene): readonly string[] {
  return scene.nodes.flatMap((node) => {
    const named: string[] = [];
    if (node.surface !== undefined && "material" in node.surface) named.push(node.surface.material);
    if (node.asset.kind === "framed") named.push(node.asset.edges.material);
    const param = node.asset.params?.["material"];
    if (typeof param === "string") named.push(param);
    return named;
  });
}

/**
 * The textures a renderer keeps after a scene of this document is freed, beyond what a renderer that drew an empty scene holds: the
 * environment bake's one always, and one more where the document has a transmissive material (transmission glass keeps its backdrop).
 */
export function leftoverTextures(scene: Scene): number {
  const transmissive = materialsOf(scene).some((id) => isMaterialId(id) && (materialPreset(id).transmission ?? 0) > 0);
  return transmissive ? 2 : 1;
}
