import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What the canvas does with a renderer is its own part: the fake renderer below stands for three's, and the fake Canvas hands the test the `gl` function it was given.
const state: { backend: object; order: string[] } = { backend: { isWebGPUBackend: true }, order: [] };
vi.mock("three/webgpu", () => ({
  WebGPURenderer: class {
    initialized = false;
    backend: object = {};
    domElement: unknown;
    constructor(options: { canvas: unknown }) {
      this.domElement = options.canvas;
    }
    init(): Promise<void> {
      state.order.push("init");
      this.initialized = true;
      this.backend = state.backend;
      return Promise.resolve();
    }
  },
}));
vi.mock("@react-three/fiber", () => ({
  Canvas: () => null,
  useFrame: () => undefined,
  useThree: () => undefined,
}));
vi.mock("@hedronite/lts-postfx/three", () => ({ ScreenEffects: vi.fn(), applyPalette: () => undefined, stackStructure: () => "", stackValues: () => ({}) }));

class FakeCanvas {
  readonly attributes = new Map<string, string>();
  setAttribute(name: string, value: string): void {
    state.order.push(`set ${name}=${value}`);
    this.attributes.set(name, value);
  }
}

type Gl = (defaults: { canvas: unknown }) => Promise<unknown>;
const glOf = async (): Promise<{ gl: Gl; props: Record<string, unknown> }> => {
  const { WebGPUCanvas } = await import("./postfx.js");
  const element: ReactElement<Record<string, unknown>> = WebGPUCanvas({});
  const gl = element.props["gl"];
  if (typeof gl !== "function") throw new Error("WebGPUCanvas gave Canvas no gl function");
  return {
    gl: async (defaults) => {
      const renderer: unknown = await Reflect.apply(gl, undefined, [defaults]);
      return renderer;
    },
    props: element.props,
  };
};

beforeEach(() => {
  state.order = [];
  vi.stubGlobal("HTMLCanvasElement", FakeCanvas);
  vi.stubGlobal("Element", FakeCanvas);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the readout", () => {
  it("is the scene package's own, re-exported unchanged by the WebGPU entry, so the canvas and the scene element read a backend the same way", async () => {
    const adapters = await import("./webgpu.js");
    const scene = await import("@hedronite/lts-scene/renderer");
    expect(adapters.rendererReadout).toBe(scene.rendererReadout);
    expect(adapters.whenDrawn).toBe(scene.whenDrawn);
    expect(adapters.backendOf).toBe(scene.backendOf);
    expect(adapters.RENDERER_ATTRIBUTE).toBe(scene.RENDERER_ATTRIBUTE);
  });
});

describe("WebGPUCanvas", () => {
  it("sets data-renderer from the renderer after init, webgpu on a WebGPU backend", async () => {
    state.backend = { isWebGPUBackend: true };
    const canvas = new FakeCanvas();
    const { gl } = await glOf();
    await gl({ canvas });
    expect(canvas.attributes.get("data-renderer")).toBe("webgpu");
    expect(state.order).toEqual(["init", "set data-renderer=webgpu"]);
  });

  it("says webgl2 when the renderer fell back, whatever the browser offers", async () => {
    state.backend = { isWebGLBackend: true };
    vi.stubGlobal("navigator", { gpu: {} });
    const canvas = new FakeCanvas();
    const { gl } = await glOf();
    await gl({ canvas });
    expect(canvas.attributes.get("data-renderer")).toBe("webgl2");
  });

  it("leaves tone mapping to React Three Fiber, as the plain canvas does: no flat, and the renderer's own tone mapping is not set", async () => {
    state.backend = { isWebGPUBackend: true };
    const { gl, props } = await glOf();
    expect(props["flat"]).toBeUndefined();
    const renderer = await gl({ canvas: new FakeCanvas() });
    expect(renderer).not.toHaveProperty("toneMapping");
  });
});
