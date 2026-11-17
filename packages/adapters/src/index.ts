// React Three Fiber components over the LuminosiTS libraries. React and R3F are optional peers;
// every other package works without this one.
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
export { ScreenEffectsPass, WebGPUCanvas, type ScreenEffectsPassProps } from "./postfx.js";
export { accentPalette, FramedSolid, LibraryObject, type FramedSolidProps, type LibraryObjectProps } from "./objects.js";
export { useReducedMotion } from "./motion.js";
