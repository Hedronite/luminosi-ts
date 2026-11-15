import { bipyramid, createPolyhedronGeometry, platonic, type Vec3 } from "@hedronite/lts-primitives";
import { Group, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3, type BufferGeometry, type Material, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { CrystalSpec } from "./cluster.js";

const UP = new Vector3(0, 1, 0);

/**
 * A crystal cluster as three.js meshes sharing one unit geometry per side count and one material.
 * Free it with `disposeObject` from `@hedronite/lts-primitives` (the material too, if it was yours to free).
 */
export function createCrystalCluster(crystals: readonly CrystalSpec[], material: Material): Group {
  const group = new Group();
  group.name = "crystal-cluster";
  const geometries = new Map<number, BufferGeometry>();
  for (const crystal of crystals) {
    let geometry = geometries.get(crystal.sides);
    if (geometry === undefined) {
      geometry = createPolyhedronGeometry(bipyramid(crystal.sides, { radius: 1, height: 1 }), `bipyramid-${String(crystal.sides)}`);
      geometries.set(crystal.sides, geometry);
    }
    const mesh = new Mesh(geometry, material);
    mesh.position.set(...crystal.position);
    mesh.quaternion.setFromUnitVectors(UP, new Vector3(...crystal.axis));
    mesh.scale.set(crystal.radius, crystal.height, crystal.radius);
    group.add(mesh);
  }
  return group;
}

export interface LatticeMeshOptions {
  /** Size of each instance. Default 0.08. */
  readonly scale?: number;
}

/** One instanced mesh for a whole lattice: a single draw call however many points. */
export function createLattice(points: readonly Vec3[], material: Material, { scale = 0.08 }: LatticeMeshOptions = {}): InstancedMesh {
  const geometry = createPolyhedronGeometry(platonic("octahedron"), "lattice-node");
  const mesh = new InstancedMesh(geometry, material, points.length);
  mesh.name = "instanced-lattice";
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const size = new Vector3(scale, scale, scale);
  points.forEach((point, i) => {
    mesh.setMatrixAt(i, matrix.compose(new Vector3(...point), rotation, size));
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

export interface GltfOptions {
  readonly signal?: AbortSignal;
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

/**
 * Loads a glTF binary (a URL, or bytes already in hand) into a group.
 * Meshopt-compressed geometry decodes with the decoder bundled in three, so nothing is fetched from a CDN.
 */
export async function loadGltf(source: string | ArrayBuffer, { signal }: GltfOptions = {}): Promise<Object3D> {
  const bytes = typeof source === "string" ? await (await fetch(source, signal === undefined ? {} : { signal })).arrayBuffer() : source;
  signal?.throwIfAborted();
  const gltf = await loader.parseAsync(bytes, "");
  return gltf.scene;
}
