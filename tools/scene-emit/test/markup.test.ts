/// <reference types="node" />
import { sceneSchema, type Scene } from "@hedronite/lts-scene";
import { toTsx } from "@hedronite/lts-scene/emit";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";

// The canvas is where the renderer's context lives, and this stub is the canvas without one: it renders none of its children. So the
// emitted module's inner contents never run here, and a component that renders above the canvas — as `Scene` does — must call no hook
// of it. With a real `WebGPUCanvas` the context is there and a hook called above it is a crash in a real app: "Hooks can only be used
// within the Canvas component!". This is the regression test for exactly that.
vi.mock("@hedronite/lts-adapters/webgpu", () => ({
  WebGPUCanvas: () => null,
  WebGPUEnvironment: () => null,
  WebGPUStudioEnvironment: () => null,
  ScreenEffectsPass: () => null,
}));

const here = fileURLToPath(new URL(".", import.meta.url));
const dir = join(here, "..", "out-markup");

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A document whose motion is data: one solid that turns with the scroll and rests level. */
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
  tracks: [{ id: "turn", target: "node.turntable.rotation", keyframes: [{ time: 0, value: [0, 0, 0], easing: "linear" }, { time: 4, value: [0, 6.2832, 0], easing: "linear" }], driver: "scroll", trigger: "scroll-scrub" }],
  clips: [{ id: "turn-clip", tracks: ["turn"] }],
  rest: { "node.turntable.rotation": [0, 0, 0] },
});

const isScene = (value: unknown): value is (props: Record<string, unknown>) => ReactNode => typeof value === "function";

describe("the emitted React module outside a renderer", () => {
  it("renders with no canvas context at all: Scene itself calls no hook of the canvas", async () => {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "turning.tsx");
    writeFileSync(file, toTsx(turning));
    const loaded: unknown = await import(/* @vite-ignore */ file);
    const Scene = typeof loaded === "object" && loaded !== null && "Scene" in loaded ? loaded.Scene : undefined;
    if (!isScene(Scene)) throw new Error("the emitted module has no Scene");
    // Above the canvas there is no renderer to reach: a hook called there throws out of React's own dispatcher.
    expect(() => renderToStaticMarkup(createElement(Scene))).not.toThrow();
    expect(() => renderToStaticMarkup(createElement(Scene, { reducedMotion: true }))).not.toThrow();
    expect(() => renderToStaticMarkup(createElement(Scene, { inView: false }))).not.toThrow();
  }, 20_000);
});
