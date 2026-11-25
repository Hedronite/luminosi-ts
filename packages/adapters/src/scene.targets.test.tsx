import type { Scene as SceneDocument } from "@hedronite/lts-scene";
import type { SceneHandle } from "@hedronite/lts-scene/three";
import { neutral } from "@hedronite/lts-tokens";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { Group, PerspectiveCamera } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scene } from "./scene.js";

// The test renderer has no WebGPU renderer, so a real scene never has pipelines to list. `Scene`'s part is what it does with a handle that does:
// it asks after the build and after each update, only of the handle it still holds.
interface Made {
  readonly targets: string[];
  readonly updates: { resolve: () => void }[];
  readonly disposed: () => boolean;
}
const made: Made[] = [];
let withTargets = true;

vi.mock("@hedronite/lts-scene/three", () => ({
  createScene: (): SceneHandle => {
    const targets: string[] = [];
    const updates: { resolve: () => void }[] = [];
    let gone = false;
    made.push({ targets, updates, disposed: () => gone });
    return {
      root: new Group(),
      camera: new PerspectiveCamera(),
      ready: Promise.resolve(),
      set: () => Promise.resolve(true),
      setLook: () => undefined,
      update: () =>
        new Promise<void>((resolve) => {
          updates.push({ resolve });
        }),
      advance: () => false,
      motionValues: () => new Map(),
      ...(withTargets ? { effectTargets: () => [...targets] } : {}),
      dispose: () => {
        gone = true;
      },
    };
  },
}));

const doc: SceneDocument = {
  format: "lts-scene",
  version: 2,
  tracks: [],
  clips: [],
  rest: {},
  look: "neutral",
  seed: 1,
  nodes: [],
  lights: { rig: "studio", intensity: 1 },
  environment: { kind: "studio" },
  camera: { position: [0, 1, 6], target: [0, 0, 0], fov: 35 },
  effects: [],
  ink: "look",
};

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 20));
};

beforeEach(() => {
  made.length = 0;
  withTargets = true;
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }) });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Scene onEffectTargets", () => {
  it("is told what the pipelines hold once the scene has built, and again after each update, a list that only grows", async () => {
    const told: (readonly string[])[] = [];
    const renderer = await ReactThreeTestRenderer.create(<Scene doc={doc} palette={neutral.scene} onEffectTargets={(ids) => told.push(ids)} />);
    await flush();
    expect(told).toEqual([[]]);

    const [only] = made;
    expect(made).toHaveLength(1);
    only?.targets.push("target-a", "target-b");
    only?.updates[0]?.resolve();
    await flush();
    expect(told).toEqual([[], ["target-a", "target-b"]]);

    await renderer.update(<Scene doc={{ ...doc, seed: 2 }} palette={neutral.scene} onEffectTargets={(ids) => told.push(ids)} />);
    only?.targets.push("target-c");
    only?.updates[1]?.resolve();
    await flush();
    expect(told.at(-1)).toEqual(["target-a", "target-b", "target-c"]);
    await renderer.unmount();
  });

  it("tells nothing about a scene that was freed before its update landed", async () => {
    const told: (readonly string[])[] = [];
    const renderer = await ReactThreeTestRenderer.create(<Scene doc={doc} palette={neutral.scene} onEffectTargets={(ids) => told.push(ids)} />);
    await flush();
    const before = told.length;
    made[0]?.targets.push("late");
    await renderer.unmount();
    expect(made[0]?.disposed()).toBe(true);
    made[0]?.updates[0]?.resolve();
    await flush();
    expect(told).toHaveLength(before);
  });

  it("is never told by a scene with no renderer, whose handle has no list", async () => {
    withTargets = false;
    const told: (readonly string[])[] = [];
    const renderer = await ReactThreeTestRenderer.create(<Scene doc={doc} palette={neutral.scene} onEffectTargets={(ids) => told.push(ids)} />);
    await flush();
    made[0]?.updates[0]?.resolve();
    await flush();
    expect(told).toEqual([]);
    await renderer.unmount();
  });
});
