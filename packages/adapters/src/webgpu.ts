// The adapters that need three's WebGPURenderer (WebGPU, or WebGL 2 where it is missing): TSL surface
// shaders and screen effects run on it. They live here so the root entry does not pull in
// `three/webgpu`, which is most of a page's JavaScript.
export { ScreenEffectsPass, WebGPUCanvas, type ScreenEffectsPassProps } from "./postfx.js";
export { WebGPUEnvironment, WebGPUStudioEnvironment, type WebGPUEnvironmentProps } from "./webgpuEnvironment.js";
// What a hand-built renderer (the scene element, the embed page) calls after `init()`, to say which backend it got as `WebGPUCanvas` does.
export { backendOf, rendererReadout, whenDrawn, RENDERER_ATTRIBUTE, type InitialisedRenderer, type RendererBackend } from "@hedronite/lts-scene/renderer";
