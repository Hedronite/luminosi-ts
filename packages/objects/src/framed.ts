import { edges, type Polyhedron } from "@hedronite/lts-primitives";
import { createPolyhedronGeometry } from "@hedronite/lts-primitives/three";
import { CylinderGeometry, Group, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3, type Material } from "three";

export interface FramedSolidOptions {
  /** The faces' material, often glass. */
  readonly faces: Material;
  /** The edge tubes' material, often metal. */
  readonly edges: Material;
  /** The vertex beads' material. Default: the faces' material. */
  readonly vertices?: Material;
  /** Edge tube radius, as a share of the solid's circumradius. Default 0.022. 0 leaves the edges out. */
  readonly edgeRadius?: number;
  /** Vertex bead radius, as a share of the circumradius. Default 0.06. 0 leaves the beads out. */
  readonly vertexRadius?: number;
}

const UP = new Vector3(0, 1, 0);

/**
 * A solid drawn the hedronite.com way: faces, a tube along every edge and a bead at every vertex.
 * Edges and beads are instanced, so it is three draw calls whatever the solid. Free it with
 * `disposeObject` from `@hedronite/lts-primitives`; the materials are yours to free.
 */
export function createFramedSolid(polyhedron: Polyhedron, options: FramedSolidOptions): Group {
  const { edgeRadius = 0.022, vertexRadius = 0.06 } = options;
  if (edgeRadius < 0 || vertexRadius < 0) throw new RangeError("edgeRadius and vertexRadius must be 0 or more");
  const radius = Math.max(...polyhedron.vertices.map(([x, y, z]) => Math.hypot(x, y, z)));
  const group = new Group();
  group.name = "framed-solid";

  const faces = new Mesh(createPolyhedronGeometry(polyhedron, "framed-faces"), options.faces);
  faces.name = "faces";
  group.add(faces);

  const matrix = new Matrix4();
  if (edgeRadius > 0) {
    const pairs = edges(polyhedron);
    // A unit-height tube along y, stretched and turned onto each edge.
    const tubes = new InstancedMesh(new CylinderGeometry(edgeRadius * radius, edgeRadius * radius, 1, 10, 1), options.edges, pairs.length);
    tubes.name = "edges";
    pairs.forEach(([i, j], index) => {
      const a = new Vector3(...(polyhedron.vertices[i] ?? [0, 0, 0]));
      const b = new Vector3(...(polyhedron.vertices[j] ?? [0, 0, 0]));
      const along = b.clone().sub(a);
      const turn = new Quaternion().setFromUnitVectors(UP, along.clone().normalize());
      tubes.setMatrixAt(index, matrix.compose(a.add(b).multiplyScalar(0.5), turn, new Vector3(1, along.length(), 1)));
    });
    tubes.instanceMatrix.needsUpdate = true;
    group.add(tubes);
  }

  if (vertexRadius > 0) {
    const beads = new InstancedMesh(new IcosahedronGeometry(vertexRadius * radius, 2), options.vertices ?? options.faces, polyhedron.vertices.length);
    beads.name = "vertices";
    const still = new Quaternion();
    const one = new Vector3(1, 1, 1);
    polyhedron.vertices.forEach((vertex, index) => {
      beads.setMatrixAt(index, matrix.compose(new Vector3(...vertex), still, one));
    });
    beads.instanceMatrix.needsUpdate = true;
    group.add(beads);
  }
  return group;
}
