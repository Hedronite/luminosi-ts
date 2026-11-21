import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backendOf, rendererReadout, RENDERER_ATTRIBUTE, whenDrawn } from "./renderer.js";

/** The element a canvas is, as far as the readout asks: it records the attributes it is given. */
class FakeCanvas {
  readonly attributes = new Map<string, string>();
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

beforeEach(() => {
  vi.stubGlobal("Element", FakeCanvas);
});

/** A renderer as three leaves it after init: a backend with its flag, and a canvas that records its attributes. */
const rendererOn = (backend: object, initialized = true) => {
  const domElement = new FakeCanvas();
  const attributes = domElement.attributes;
  return { renderer: { initialized, backend, domElement }, attributes };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the ./renderer entry", () => {
  it("imports nothing: no three, no three/webgpu, no React, no other module", () => {
    expect(readFileSync(new URL("./renderer.ts", import.meta.url), "utf8")).not.toMatch(/^\s*(import|export)\b[^\n]*\bfrom\b/m);
  });
});

describe("rendererReadout", () => {
  it("reads webgpu from a WebGPU backend and webgl2 from the WebGL 2 backend, and writes data-renderer on the canvas", () => {
    const gpu = rendererOn({ isWebGPUBackend: true });
    expect(rendererReadout(gpu.renderer)).toBe("webgpu");
    expect(gpu.attributes.get("data-renderer")).toBe("webgpu");
    const gl = rendererOn({ isWebGLBackend: true });
    expect(rendererReadout(gl.renderer)).toBe("webgl2");
    expect(gl.attributes.get(RENDERER_ATTRIBUTE)).toBe("webgl2");
  });

  it("reads the renderer and never navigator.gpu: a browser with WebGPU whose renderer fell back says webgl2, and one without says webgpu if the renderer has it", () => {
    vi.stubGlobal("navigator", { gpu: {} });
    expect(backendOf({ initialized: true, backend: { isWebGLBackend: true }, domElement: {} })).toBe("webgl2");
    vi.stubGlobal("navigator", {});
    expect(backendOf({ initialized: true, backend: { isWebGPUBackend: true }, domElement: {} })).toBe("webgpu");
  });

  it("throws before init has finished, and writes nothing", () => {
    const early = rendererOn({ isWebGPUBackend: true }, false);
    expect(() => rendererReadout(early.renderer)).toThrow(/initialised WebGPURenderer/);
    expect(early.attributes.size).toBe(0);
  });

  it.each([{}, { isWebGPUBackend: false }, null, "webgpu"])("throws for a backend that is neither three's (%j): it does not guess", (backend) => {
    const odd = rendererOn(backend === null || typeof backend === "string" ? {} : backend);
    expect(() => rendererReadout({ ...odd.renderer, backend })).toThrow(/initialised WebGPURenderer/);
    expect(odd.attributes.size).toBe(0);
  });

  it("answers for a renderer on a canvas that is no element (an OffscreenCanvas) without writing", () => {
    expect(rendererReadout({ initialized: true, backend: { isWebGPUBackend: true }, domElement: {} })).toBe("webgpu");
  });
});

/** A renderer with a WebGPU device queue whose work finishes only when the test says so, or a WebGL 2 context that counts its finish calls. */
describe("whenDrawn", () => {
  it("on WebGPU waits for the device queue and resolves only after it has finished the submitted work", async () => {
    let finish: () => void = () => undefined;
    const onSubmittedWorkDone = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const renderer = { initialized: true, backend: { isWebGPUBackend: true, device: { queue: { onSubmittedWorkDone } } }, domElement: {} };
    let settled = false;
    const drawn = whenDrawn(renderer).then((backend) => { settled = true; return backend; });
    await Promise.resolve();
    expect(onSubmittedWorkDone).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    finish();
    await expect(drawn).resolves.toBe("webgpu");
  });

  it("on the WebGL 2 backend finishes the context, once, and resolves with webgl2", async () => {
    const finish = vi.fn();
    const renderer = { initialized: true, backend: { isWebGLBackend: true, gl: { finish } }, domElement: {} };
    await expect(whenDrawn(renderer)).resolves.toBe("webgl2");
    expect(finish).toHaveBeenCalledOnce();
  });

  it("does not wait on the other backend: WebGPU never touches a gl, and WebGL 2 never a device", async () => {
    const finish = vi.fn();
    const onSubmittedWorkDone = vi.fn(() => Promise.resolve());
    await whenDrawn({ initialized: true, backend: { isWebGPUBackend: true, device: { queue: { onSubmittedWorkDone } }, gl: { finish } }, domElement: {} });
    expect(finish).not.toHaveBeenCalled();
    await whenDrawn({ initialized: true, backend: { isWebGLBackend: true, gl: { finish }, device: { queue: { onSubmittedWorkDone } } }, domElement: {} });
    expect(onSubmittedWorkDone).toHaveBeenCalledOnce();
  });

  it("rejects before init, and for a backend with nothing to wait on, rather than resolve for a frame it cannot vouch for", async () => {
    await expect(whenDrawn({ initialized: false, backend: { isWebGPUBackend: true }, domElement: {} })).rejects.toThrow(/initialised WebGPURenderer/);
    await expect(whenDrawn({ initialized: true, backend: { isWebGPUBackend: true }, domElement: {} })).rejects.toThrow(/no device queue/);
    await expect(whenDrawn({ initialized: true, backend: { isWebGLBackend: true, gl: {} }, domElement: {} })).rejects.toThrow(/no context to finish/);
  });
});
