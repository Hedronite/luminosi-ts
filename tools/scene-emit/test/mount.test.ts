/// <reference types="node" />
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { migrate } from "@hedronite/lts-scene";
import { toTsx } from "@hedronite/lts-scene/emit";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactNode } from "react";
import { Group, Mesh, type Object3D } from "three";
import { afterAll, describe, expect, it, vi } from "vitest";

// The emitted React code is run, not only type-checked: it is written out, imported and mounted with the R3F test renderer, as the
// adapters' own tests mount their components. The canvas and the WebGPU parts need a browser, so those three are stood in for; the
// components inside them (the groups, the primitives, the framed solids) are the real ones.

vi.mock("@hedronite/lts-adapters/webgpu", () => ({
  WebGPUCanvas: ({ children }: { readonly children?: ReactNode }) => children,
  WebGPUEnvironment: () => null,
  WebGPUStudioEnvironment: () => null,
  ScreenEffectsPass: () => null,
}));

const here = fileURLToPath(new URL(".", import.meta.url));
const dir = join(here, "..", "out-mount");

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const isComponent = (value: unknown): value is () => ReactNode => typeof value === "function";
const isMesh = (object: Object3D): object is Mesh => object instanceof Mesh;

const named = (root: Object3D, name: string): Object3D => {
  let found: Object3D | undefined;
  root.traverse((object) => {
    if (object.name === name) found ??= object;
  });
  if (found === undefined) throw new Error(`nothing is named ${name}`);
  return found;
};

describe("the emitted React code, mounted", () => {
  it("draws the document's nodes where it says: a parent's children stand in its group, with its transform", async () => {
    const result = migrate(readFileSync(join(here, "..", "..", "..", "packages", "scene", "fixtures", "transform-hierarchy.json"), "utf8"));
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "transform-hierarchy.tsx");
    writeFileSync(file, toTsx(result.scene));
    const loaded: unknown = await import(/* @vite-ignore */ file);
    const Scene: unknown = typeof loaded === "object" && loaded !== null && "Scene" in loaded ? loaded.Scene : undefined;
    if (!isComponent(Scene)) throw new Error("the emitted module has no Scene");

    const renderer = await ReactThreeTestRenderer.create(createElement(Scene));
    const root = renderer.scene.instance;

    const first = named(root, "node-1");
    expect(first).toBeInstanceOf(Group);
    expect(first.scale.toArray()).toEqual([1.6, 0.8, 1.1]);
    expect(first.rotation.toArray().slice(0, 3)).toEqual([0.3, 0.5, 0.2]);

    // node-2 is node-1's child: it is inside its group, at its own position there.
    const second = named(root, "node-2");
    expect(second).toBeInstanceOf(Mesh);
    expect(second.parent).toBe(first);
    expect(second.position.toArray()).toEqual([1.4, 0.6, 0]);
    expect(second.scale.toArray()).toEqual([0.4, 0.4, 0.4]);

    // node-3 is listed before its parent node-4, and still stands under it.
    expect(named(root, "node-3").parent).toBe(named(root, "node-4"));
    expect(named(root, "node-4").parent).toBe(root);

    const meshes: Mesh[] = [];
    root.traverse((object) => {
      if (isMesh(object)) meshes.push(object);
    });
    expect(meshes.map((mesh) => mesh.geometry.name).sort()).toEqual(["platonic-cube", "platonic-dodecahedron", "platonic-icosahedron", "platonic-octahedron"]);
    await renderer.unmount();
    // The test takes 70 to 120 ms on a quiet machine, but its first step is the cold import of three, the adapters and R3F, and CI runs it on two
    // cores beside the lumin tests: 2,432 ms (run 44866191568), 4,056 ms (run 44859038343) and 5,461 ms (run 44869368035, which failed the default 5 s).
    // Three times the largest reading is 16,383 ms, rounded up to the next 5 s.
  }, 20_000);

  it("mounts emitted React code for a non-studio room with intensity, rotation, and CC0 HDRI", async () => {
    const result = migrate(readFileSync(join(here, "..", "..", "..", "packages", "scene", "fixtures", "framed-solid-shader.json"), "utf8"));
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const doc = { ...result.scene, environment: { kind: "dusk" as const, intensity: 1.4, rotation: 0.6, hdri: { url: "https://example.com/dusk.hdr", license: "CC0-1.0" as const, credit: "Poly Haven" } } };
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "dusk-room.tsx");
    writeFileSync(file, toTsx(doc));
    const loaded: unknown = await import(/* @vite-ignore */ file);
    const Scene: unknown = typeof loaded === "object" && loaded !== null && "Scene" in loaded ? loaded.Scene : undefined;
    if (!isComponent(Scene)) throw new Error("the emitted module has no Scene");
    const renderer = await ReactThreeTestRenderer.create(createElement(Scene));
    expect(renderer.scene.instance.children.length).toBeGreaterThan(0);
    await renderer.unmount();
  }, 20_000);
});
