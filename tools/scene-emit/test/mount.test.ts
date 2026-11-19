/// <reference types="node" />
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { migrate } from "@hedronite/lts-scene";
import { toTsx } from "@hedronite/lts-scene/emit";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactNode } from "react";
import { Group, Mesh, type Object3D } from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The emitted React code is run, not only type-checked: it is written out, imported and mounted with the R3F test renderer, as the
// adapters' own tests mount their components. The canvas and the WebGPU parts need a browser, so those three are stood in for; the
// components inside them (the groups, the primitives, the framed solids) are the real ones.

vi.mock("@hedronite/lts-adapters/webgpu", () => ({
  WebGPUCanvas: ({ children }: { readonly children?: ReactNode }) => children,
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
  // The emitted module is written and loaded before the test: loading it pulls in three.js and the adapters, which takes longer than
  // drawing the scene, and the test is about the drawing.
  let Scene: (() => ReactNode) | undefined;
  beforeAll(async () => {
    const result = migrate(readFileSync(join(here, "..", "..", "..", "packages", "scene", "fixtures", "transform-hierarchy.json"), "utf8"));
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "transform-hierarchy.tsx");
    writeFileSync(file, toTsx(result.scene));
    const loaded: unknown = await import(/* @vite-ignore */ file);
    const component: unknown = typeof loaded === "object" && loaded !== null && "Scene" in loaded ? loaded.Scene : undefined;
    if (!isComponent(component)) throw new Error("the emitted module has no Scene");
    Scene = component;
  });

  it("draws the document's nodes where it says: a parent's children stand in its group, with its transform", async () => {
    if (Scene === undefined) throw new Error("the emitted module was not loaded");
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
  });
});
