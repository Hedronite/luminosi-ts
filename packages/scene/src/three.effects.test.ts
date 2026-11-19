import { WebGPURenderer } from "three/webgpu";
import type * as Webgpu from "three/webgpu";
import { neutral } from "@hedronite/lts-tokens";
import { describe, expect, it, vi } from "vitest";
import { setEffects, setInk, setTransform, type Scene as SceneDocument, type SceneNode } from "./index.js";
import { createScene } from "./three.js";

// No GPU here: the screen effects and the environment bake are stand-ins that hold what the real ones do for this test, render targets with uuids.
const built = vi.hoisted(() => ({ pipelines: 0 }));

vi.mock("@hedronite/lts-postfx/three", () => {
  class ScreenEffects {
    readonly targetIds: readonly string[];
    constructor() {
      built.pipelines += 1;
      this.targetIds = [`pass-${String(built.pipelines)}`, `target-${String(built.pipelines)}`];
    }
    setParams(): void {}
    setPointer(): void {}
    setSize(): void {}
    render(): void {}
    dispose(): void {}
  }
  return {
    ScreenEffects,
    stackStructure: (stack: readonly { readonly id: string }[], reduced: boolean): string => `${String(reduced)}:${stack.map((effect) => effect.id).join(",")}`,
    stackValues: (): Record<string, never> => ({}),
    applyPalette: (): void => undefined,
  };
});

vi.mock("three/webgpu", async (original) => {
  const actual = await original<typeof Webgpu>();
  class PMREMGenerator {
    fromScene(): { readonly texture: object; dispose: () => void } {
      return { texture: {}, dispose: () => undefined };
    }
    dispose(): void {}
  }
  return { ...actual, PMREMGenerator };
});

/** What `createScene` asks of a renderer when it draws: its size and a frame. The real one needs a GPU. */
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- a stand-in for a renderer, which needs a GPU: it is what the type asks for, and has the two methods the scene calls
const renderer = Object.assign(Object.create(WebGPURenderer.prototype) as WebGPURenderer, { getSize: (target: { set: (x: number, y: number) => unknown }) => target.set(512, 512), render: () => undefined });

const node = (id: string): SceneNode => ({ id, parent: null, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], asset: { kind: "primitive", id: "platonic-cube" }, surface: { material: "metal" } });

const doc: SceneDocument = {
  format: "lts-scene",
  version: 1,
  look: "neutral",
  seed: 1,
  nodes: [node("a")],
  lights: { rig: "studio", intensity: 1 },
  environment: { kind: "studio" },
  camera: { position: [0, 1, 6], target: [0, 0, 0], fov: 35 },
  effects: [],
  ink: "look",
};

function ok(result: ReturnType<typeof setEffects>): SceneDocument {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.scene;
}

describe("effectTargets", () => {
  it("is there with a renderer only, and empty while there are no effects", async () => {
    const without = createScene(doc, { palette: neutral.scene });
    await without.ready;
    expect(without.effectTargets).toBeUndefined();
    without.dispose();
    const drawn = createScene(doc, { palette: neutral.scene, renderer });
    await drawn.ready;
    expect(drawn.effectTargets?.()).toEqual([]);
    drawn.dispose();
  });

  it("lists the render-target textures of each pipeline, never fewer, and a new one only when the stack's structure changes", async () => {
    const start = built.pipelines;
    const drawn = createScene(ok(setEffects(doc, [{ id: "dither" }])), { palette: neutral.scene, renderer });
    await drawn.ready;
    const targets = (): readonly string[] => drawn.effectTargets?.() ?? [];
    const first = [`pass-${String(start + 1)}`, `target-${String(start + 1)}`];
    expect(targets()).toEqual(first);

    // Written in place: a parameter, an ink, a look, a transform, the pointer, a frame, and the same stack again.
    const same = ok(setEffects(doc, [{ id: "dither", params: { cell: 6 } }]));
    await drawn.update(same);
    await drawn.update(ok(setInk(same, "accent")));
    drawn.setLook(neutral.scene);
    await drawn.update(ok(setTransform(same, "a", { position: [1, 2, 3], rotation: [0.1, 0.2, 0.3], scale: [2, 2, 2] })));
    drawn.setPointer?.({ x: 0.5, y: 0.5 });
    drawn.render?.(0.016);
    expect(targets()).toEqual(first);

    // Another structure builds another pipeline, and the first one's textures stay listed after it is freed.
    await drawn.update(ok(setEffects(same, [{ id: "dither" }, { id: "grain" }])));
    expect(targets()).toEqual([...first, `pass-${String(start + 2)}`, `target-${String(start + 2)}`]);
    await drawn.update(doc);
    expect(targets()).toHaveLength(4);
    await drawn.update(ok(setEffects(doc, [{ id: "grain" }])));
    expect(targets()).toHaveLength(6);
    expect(new Set(targets()).size).toBe(6);
    drawn.dispose();
  });
});
