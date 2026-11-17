import { disposeObject } from "@hedronite/lts-primitives/three";
import { Box3, Mesh, Vector3, type Object3D } from "three";
import { describe, expect, it, vi } from "vitest";
import { createObjectFromSpec } from "./fromSpec.js";
import { parseObjectSpec, type ObjectSpec } from "./spec.js";
import { dressWatchSpec } from "./specs/dressWatch.js";

const isMesh = (object: Object3D): object is Mesh => object instanceof Mesh;

/** Every mesh under `root`: one draw call each, since no object here is instanced or multi-material. */
const meshes = (root: Object3D): Mesh[] => {
  const found: Mesh[] = [];
  root.traverse((object) => {
    if (isMesh(object)) found.push(object);
  });
  return found;
};

const triangleCount = (mesh: Mesh): number => {
  const { index } = mesh.geometry;
  return (index === null ? mesh.geometry.getAttribute("position").count : index.count) / 3;
};

const worldPosition = (root: Object3D, name: string): Vector3 => {
  const node = root.getObjectByName(name);
  if (node === undefined) throw new Error(`no object named ${name}`);
  return node.getWorldPosition(new Vector3());
};

/** Two parts under a rotated, moved parent, and a socket on the child, so baking has work to do. */
const nested = (): ObjectSpec =>
  parseObjectSpec({
    format: "lts-object-spec",
    version: 1,
    id: "nested",
    name: "Nested",
    materials: { a: { preset: "matte" }, b: { preset: "metal" } },
    parts: [
      { id: "arm", shape: { type: "box", size: [1, 0.2, 0.2] }, material: "a", position: [0.5, 0.2, 0], rotation: [0, 0, Math.PI / 3], shapePosition: [0.5, 0, 0] },
      { id: "hand", parent: "arm", shape: { type: "cylinder", radiusTop: 0.1, radiusBottom: 0.1, height: 0.4, segments: 8 }, material: "b", position: [1, 0, 0], rotation: [0.4, 0, 0], scale: [1, 2, 1] },
      { id: "ring", parent: "hand", shape: { type: "primitive", id: "platonic-icosahedron" }, material: "a", position: [0, 0.3, 0], shapeRotation: [0.2, 0.3, 0.1], scale: [0.2, 0.3, 0.2] },
    ],
    sockets: [{ id: "tip", parent: "ring", position: [0, 0.5, 0] }],
  });

describe("createObjectFromSpec with merge: material", () => {
  const spec = dressWatchSpec({ hours: 10, minutes: 9, seconds: 36 });
  const hierarchy = createObjectFromSpec(spec);
  const merged = createObjectFromSpec(spec, { merge: "material" });
  hierarchy.updateMatrixWorld(true);
  merged.updateMatrixWorld(true);

  it("draws the dress watch in one call per material, at most 8", () => {
    const built = meshes(merged);
    expect(Object.keys(spec.materials)).toHaveLength(8);
    expect(built).toHaveLength(8);
    expect(new Set(built.map((mesh) => mesh.material)).size).toBe(8);
    expect(built.map((mesh) => mesh.name).sort()).toEqual(Object.keys(spec.materials).map((name) => `material:${name}`).sort());
    expect(meshes(hierarchy)).toHaveLength(spec.parts.length);
  });

  it("keeps the same triangles and the same bounds", () => {
    const total = (root: Object3D): number => meshes(root).reduce((sum, mesh) => sum + triangleCount(mesh), 0);
    expect(total(merged)).toBe(total(hierarchy));
    const a = new Box3().setFromObject(hierarchy, true);
    const b = new Box3().setFromObject(merged, true);
    for (const [x, y] of [
      [a.min, b.min],
      [a.max, b.max],
    ] as const) {
      expect(y.distanceTo(x)).toBeLessThan(1e-5);
    }
  });

  it("keeps every pivot and socket as an empty node at the same world position", () => {
    const names = [...spec.parts.map((part) => part.id), ...spec.sockets.map((socket) => `socket:${socket.id}`)];
    expect(spec.sockets.length).toBeGreaterThan(0);
    for (const name of names) {
      const node = merged.getObjectByName(name);
      expect(node).toBeDefined();
      expect(node instanceof Mesh).toBe(false);
      expect(node?.children.filter(isMesh)).toHaveLength(0);
      expect(worldPosition(merged, name).distanceTo(worldPosition(hierarchy, name))).toBeLessThan(1e-9);
    }
  });

  it("keeps the pivot nesting", () => {
    for (const part of spec.parts) {
      const parent = merged.getObjectByName(part.id)?.parent;
      expect(parent?.name).toBe(part.parent ?? spec.id);
    }
  });

  it("bakes nested rotations and scales into the merged shapes", () => {
    const flat = nested();
    const a = createObjectFromSpec(flat);
    const b = createObjectFromSpec(flat, { merge: "material" });
    expect(meshes(b)).toHaveLength(2);
    const boxA = new Box3().setFromObject(a, true);
    const boxB = new Box3().setFromObject(b, true);
    expect(boxB.min.distanceTo(boxA.min)).toBeLessThan(1e-5);
    expect(boxB.max.distanceTo(boxA.max)).toBeLessThan(1e-5);
    a.updateMatrixWorld(true);
    b.updateMatrixWorld(true);
    expect(worldPosition(b, "socket:tip").distanceTo(worldPosition(a, "socket:tip"))).toBeLessThan(1e-9);
    disposeObject(a);
    disposeObject(b);
  });

  it("leaves hierarchy mode as it was: a mesh per part under its pivot", () => {
    for (const part of spec.parts) {
      const pivot = hierarchy.getObjectByName(part.id);
      const mesh = pivot?.children.find(isMesh);
      expect(mesh?.name).toBe(part.id);
      expect(pivot?.parent?.name).toBe(part.parent ?? spec.id);
    }
  });

  it("frees every merged geometry and material with disposeObject", () => {
    const root = createObjectFromSpec(spec, { merge: "material" });
    const spies = meshes(root).flatMap((mesh) => [vi.spyOn(mesh.geometry, "dispose"), vi.spyOn(Array.isArray(mesh.material) ? mesh.material[0] ?? mesh.geometry : mesh.material, "dispose")]);
    disposeObject(root);
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
});
