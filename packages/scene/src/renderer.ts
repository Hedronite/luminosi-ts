// The renderer readout: which backend a `WebGPURenderer` got, written on its canvas, and when it has drawn what it was given. It is in the scene package so the
// scene element can call it, and `@hedronite/lts-adapters/webgpu` re-exports it for everything else. It imports nothing at all: no three, no React.

/** The backend a `WebGPURenderer` chose at init: `webgpu`, or `webgl2` where the browser has no WebGPU (or no adapter). */
export type RendererBackend = "webgpu" | "webgl2";

/** The attribute a viewport's canvas carries: it says which backend drew it. */
export const RENDERER_ATTRIBUTE = "data-renderer";

/** What the readout needs of a renderer: the shape of three's `WebGPURenderer`, and nothing of three itself, so this file loads without `three/webgpu`. */
export interface InitialisedRenderer {
  /** Whether `init()` has finished: before that the renderer may still be about to fall back. */
  readonly initialized: boolean;
  readonly backend: unknown;
  readonly domElement: unknown;
}

const flag = (backend: unknown, name: string): boolean => Reflect.get(Object(backend), name) === true;

/**
 * Which backend the renderer is on, read from the renderer itself (`renderer.backend`) and from nothing in the browser: `navigator.gpu`
 * says what the browser could do, not what three chose, and a failed adapter request falls back to WebGL 2 with `navigator.gpu` present.
 * Throws for a renderer that has not finished `init()` (before that three may still fall back) and for one whose backend is neither three's WebGPU
 * nor its WebGL 2 backend: a readout that guessed would let a wrong renderer through a test.
 */
export function backendOf(renderer: InitialisedRenderer): RendererBackend {
  if (renderer.initialized) {
    if (flag(renderer.backend, "isWebGPUBackend")) return "webgpu";
    if (flag(renderer.backend, "isWebGLBackend")) return "webgl2";
  }
  throw new Error("an initialised WebGPURenderer is needed");
}

/**
 * Writes `data-renderer` (`webgpu` or `webgl2`) onto the renderer's canvas and returns it. Call it once, right after `await renderer.init()`:
 * `WebGPUCanvas` does, and a hand-built renderer (the scene element, the embed page) does the same, so every viewport says the same thing the same way.
 */
export function rendererReadout(renderer: InitialisedRenderer): RendererBackend {
  const backend = backendOf(renderer);
  const canvas = renderer.domElement;
  // An OffscreenCanvas is no element and has no attributes: a renderer on one still gets its answer.
  if (canvas instanceof Element) canvas.setAttribute(RENDERER_ATTRIBUTE, backend);
  return backend;
}

const member = (owner: unknown, name: string): unknown => (typeof owner === "object" && owner !== null && name in owner ? Reflect.get(owner, name) : undefined);

/** `owner[name]` as a call with no arguments, or undefined when it is not a function. */
const callable = (owner: unknown, name: string): (() => unknown) | undefined => {
  const fn = member(owner, name);
  if (typeof fn !== "function") return undefined;
  return () => {
    const result: unknown = Reflect.apply(fn, owner, []);
    return result;
  };
};

/**
 * Resolves once the backend has finished the frame it was given, for a ready flag that must mean the picture is there and not that a draw was
 * queued (no timer wait): on WebGPU, `device.queue.onSubmittedWorkDone()`; on the WebGL 2 backend, `gl.finish()`, which returns when the
 * context's commands are done. Call it after the render call (`render`, `renderAsync`) whose frame you mean. Resolves with the backend it waited on.
 * Throws for an uninitialised renderer or a backend with no device or context to wait on, as `rendererReadout` does.
 */
export async function whenDrawn(renderer: InitialisedRenderer): Promise<RendererBackend> {
  const backend = backendOf(renderer);
  if (backend === "webgpu") {
    const done = callable(member(member(renderer.backend, "device"), "queue"), "onSubmittedWorkDone");
    if (done === undefined) throw new Error("whenDrawn: the WebGPU backend has no device queue to wait on");
    await done();
  } else {
    const finish = callable(member(renderer.backend, "gl"), "finish");
    if (finish === undefined) throw new Error("whenDrawn: the WebGL 2 backend has no context to finish");
    finish();
  }
  return backend;
}
