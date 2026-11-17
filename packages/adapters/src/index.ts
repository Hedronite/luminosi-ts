// React Three Fiber components over the LuminosiTS libraries. React and R3F are optional peers;
// every other package works without this one. What needs three's WebGPURenderer (WebGPUCanvas,
// ScreenEffectsPass, WebGPUStudioEnvironment) is in `@hedronite/lts-adapters/webgpu`.
export {
  CrystalCluster,
  Lattice,
  PrimitiveMesh,
  StudioEnvironment,
  StudioLights,
  type CrystalClusterProps,
  type LatticeProps,
  type PrimitiveMeshProps,
} from "./components.js";
export { accentPalette, FramedSolid, LibraryObject, type FramedSolidProps, type LibraryObjectProps } from "./objects.js";
export { useReducedMotion } from "./motion.js";
