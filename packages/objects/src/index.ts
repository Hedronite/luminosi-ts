export { crystalCluster, latticePoints, type ClusterOptions, type CrystalSpec, type LatticeOptions } from "./cluster.js";
export { createObjectFromSpec, type ObjectFromSpecOptions } from "./fromSpec.js";
export {
  objectSpecSchema,
  parseObjectSpec,
  safeParseObjectSpec,
  shadeHex,
  type ObjectMaterial,
  type ObjectPart,
  type ObjectShape,
  type ObjectSpec,
} from "./spec.js";
export { createCrystalCluster, createLattice, loadGltf, type GltfOptions, type LatticeMeshOptions } from "./three.js";
