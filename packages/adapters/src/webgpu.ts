// The adapters that need three's WebGPURenderer (WebGPU, or WebGL 2 where it is missing): TSL surface
// shaders and screen effects run on it. They live here so the root entry does not pull in
// `three/webgpu`, which is most of a page's JavaScript.
export { ScreenEffectsPass, WebGPUCanvas, type ScreenEffectsPassProps } from "./postfx.js";
export { WebGPUStudioEnvironment } from "./webgpuEnvironment.js";
