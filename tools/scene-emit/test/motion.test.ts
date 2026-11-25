/// <reference types="node" />
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { sceneSchema, type Scene } from "@hedronite/lts-scene";
import { toTsx, toVanilla } from "@hedronite/lts-scene/emit";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactNode } from "react";
import { Group, type Object3D } from "three";
import { afterAll, describe, expect, it, vi } from "vitest";

// The emitted motion code is run, not only type-checked: the React module is written out, imported and mounted with the R3F test
// renderer, handed the same inputs a stage hands it, and compared with what the document's own keyframes say. The canvas and the
// WebGPU parts need a browser, so those are stood in for; the components inside them are the real ones.
vi.mock("@hedronite/lts-adapters/webgpu", () => ({
  WebGPUCanvas: ({ children }: { readonly children?: ReactNode }) => children,
  WebGPUStudioEnvironment: () => null,
  ScreenEffectsPass: () => null,
}));

const here = fileURLToPath(new URL(".", import.meta.url));
const dir = join(here, "..", "out-motion");

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A document whose motion is data: a turntable that turns with the scroll and rises once on the clock, and rests level at the origin. */
const turning: Scene = sceneSchema.parse({
  format: "lts-scene",
  version: 2,
  look: "neutral",
  seed: 0,
  nodes: [{ id: "turntable", parent: null, position: [0, 0.6, 0], rotation: [0, 0, 0], scale: [1, 1, 1], asset: { kind: "primitive", id: "platonic-cube" }, surface: { material: "metal" } }],
  lights: { rig: "studio", intensity: 1 },
  environment: { kind: "studio" },
  camera: { position: [0, 1.6, 4.4], target: [0, 0, 0], fov: 40 },
  effects: [],
  ink: "look",
  tracks: [
    { id: "turn", target: "node.turntable.rotation", keyframes: [{ time: 0, value: [0, 0, 0], easing: "linear" }, { time: 4, value: [0, 6.2832, 0], easing: "linear" }], driver: "scroll", trigger: "scroll-scrub" },
    { id: "rise", target: "node.turntable.position", keyframes: [{ time: 0, value: [0, 0, 0], easing: "linear" }, { time: 1, value: [0, 0.6, 0], easing: "linear" }], driver: "time", trigger: "load" },
  ],
  clips: [{ id: "turn-clip", tracks: ["turn"] }, { id: "rise-clip", tracks: ["rise"] }],
  rest: { "node.turntable.rotation": [0, 0, 0], "node.turntable.position": [0, 0, 0] },
});

/** The `turn` track's last keyframe: one turn over four seconds, so at progress p the rotation's y is TURN * p. */
const TURN = 6.2832;

interface Scroll {
  readonly progress: number;
  readonly smooth: number;
  readonly direction: -1 | 0 | 1;
}
interface SceneProps {
  readonly reducedMotion?: boolean;
  readonly scroll?: Scroll;
}
type SceneComponent = (props: SceneProps) => ReactNode;
const isScene = (value: unknown): value is SceneComponent => typeof value === "function";

const isComponent = (loaded: unknown): loaded is { readonly Scene: unknown } => typeof loaded === "object" && loaded !== null && "Scene" in loaded;

/** The emitted module, mounted with these props: the test renderer, and the component to re-render with other props. */
async function mounted(props: SceneProps): Promise<{ readonly renderer: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>; readonly Scene: SceneComponent }> {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "turning.tsx");
  writeFileSync(file, toTsx(turning));
  const loaded: unknown = await import(/* @vite-ignore */ file);
  if (!isComponent(loaded) || !isScene(loaded.Scene)) throw new Error("the emitted module has no Scene");
  return { renderer: await ReactThreeTestRenderer.create(createElement(loaded.Scene, props)), Scene: loaded.Scene };
}

const named = (root: Object3D, name: string): Object3D => {
  let found: Object3D | undefined;
  root.traverse((object) => {
    if (object.name === name) found ??= object;
  });
  if (found === undefined) throw new Error(`nothing is named ${name}`);
  return found;
};

describe("the emitted React code plays the document's motion", () => {
  it("turns with the scroll, both ways, exactly as the document's keyframes say", async () => {
    const { renderer, Scene } = await mounted({ scroll: { progress: 0, smooth: 0, direction: 1 } });
    const node = named(renderer.scene.instance, "turntable");
    expect(node).toBeInstanceOf(Group);
    for (const progress of [0, 0.25, 0.5, 1, 0.25]) {
      await renderer.update(createElement(Scene, { scroll: { progress, smooth: progress, direction: 1 } }));
      await renderer.advanceFrames(1, 1 / 60);
      expect(node.rotation.y, `at progress ${String(progress)}`).toBeCloseTo(TURN * progress, 3);
    }
    await renderer.unmount();
  }, 20_000);

  it("shows the rest pose under reduced motion, and steps nothing", async () => {
    const { renderer, Scene } = await mounted({ reducedMotion: true, scroll: { progress: 1, smooth: 1, direction: 1 } });
    const node = named(renderer.scene.instance, "turntable");
    // The document writes the node at [0, 0.6, 0]; its rest pose is the origin, which is what a reduced-motion stage shows.
    await renderer.advanceFrames(2, 1 / 60);
    expect(node.position.toArray()).toEqual([0, 0, 0]);
    expect(node.rotation.y).toBe(0);
    await renderer.update(createElement(Scene, { reducedMotion: true, scroll: { progress: 0, smooth: 0, direction: 1 } }));
    await renderer.advanceFrames(2, 1 / 60);
    expect(node.rotation.y).toBe(0);
    await renderer.unmount();
  }, 20_000);

  it("carries one player in both emitters: the document's data and the runtime, written the same way in each", () => {
    const playerOf = (text: string): string => text.slice(text.indexOf("const motionDocument"), text.indexOf("/** Writes every value onto the object"));
    expect(playerOf(toTsx(turning))).toBe(playerOf(toVanilla(turning)));
    expect(toTsx(turning)).toContain("useFrame((_, delta) => {");
    expect(toVanilla(turning)).toContain("advance: (seconds: number, input: MotionInput = {}) => {");
  });
});
