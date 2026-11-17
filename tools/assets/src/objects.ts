// Draw calls and triangles of every object the catalog shows, built the way the catalog builds it
// (apps/catalog/src/subjects.ts): the same settings (`showcase` in @hedronite/lts-objects, which the catalog builds from too), the default look. Needs `bun run build` first, for the packages' `./three` entries.
import { createMaterial } from "@hedronite/lts-materials/three";
import { crystalCluster, dressWatchSpec, latticePoints, libraryObjects, objectSpecById, showcase } from "@hedronite/lts-objects";
import { createCrystalCluster, createFramedSolid, createLattice, createObjectFromSpec } from "@hedronite/lts-objects/three";
import { platonic } from "@hedronite/lts-primitives";
import { neutral } from "@hedronite/lts-tokens";
import { InstancedMesh, Mesh, type Object3D } from "three";

export interface Counts {
  readonly drawCalls: number;
  readonly triangles: number;
}

const palette = neutral.scene;

/** Triangles the GPU draws for a mesh: its index (or vertex) count over three, once per instance. */
const trianglesOf = (mesh: Mesh): number => {
  const { geometry } = mesh;
  const vertices = geometry.index?.count ?? geometry.getAttribute("position").count;
  return (vertices / 3) * (mesh instanceof InstancedMesh ? mesh.count : 1);
};

const isMesh = (node: Object3D): node is Mesh => node instanceof Mesh;

/** One draw call per visible mesh (an instanced mesh is one, however many instances), and the triangles they draw. */
function countObject(root: Object3D): Counts {
  let drawCalls = 0;
  let triangles = 0;
  root.traverseVisible((node) => {
    if (!isMesh(node)) return;
    drawCalls += Array.isArray(node.material) ? node.geometry.groups.length : 1;
    triangles += trianglesOf(node);
  });
  return { drawCalls, triangles };
}

/** Each object by the id its budget is under. Objects stored as data (assets/src/objects) are measured as they are listed. */
function objectBuilders(): Readonly<Record<string, () => Object3D>> {
  const stored = Object.fromEntries(
    libraryObjects.map((object): readonly [string, () => Object3D] => [
      object.id,
      () => {
        const spec = objectSpecById(object.id);
        if (spec === undefined) throw new Error(`${object.id}: listed as a library object but has no spec`);
        return createObjectFromSpec(spec, { palette });
      },
    ]),
  );
  return {
    "crystal-cluster": () => createCrystalCluster(crystalCluster(showcase.cluster), createMaterial("satin", palette)),
    "framed-solid": () => createFramedSolid(platonic(showcase.framedSolid.solid, showcase.framedSolid.radius), { faces: createMaterial("glass", palette), edges: createMaterial("metal", { ...palette, metal: palette.accent }) }),
    "instanced-lattice": () => createLattice(latticePoints({ size: showcase.lattice.size, spacing: showcase.lattice.spacing }), createMaterial("metal", palette), { scale: showcase.lattice.scale }),
    "dress-watch": () => createObjectFromSpec(dressWatchSpec(showcase.watch), { palette }),
    "dress-watch-merged": () => createObjectFromSpec(dressWatchSpec(showcase.watch), { palette, merge: "material" }),
    ...stored,
  };
}

export function measureObjects(): Readonly<Record<string, Counts>> {
  return Object.fromEntries(Object.entries(objectBuilders()).map(([id, build]) => [id, countObject(build())]));
}
