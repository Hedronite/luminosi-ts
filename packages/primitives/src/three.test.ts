import { BatchedMesh, BufferAttribute, BufferGeometry, Color, Group, InstancedMesh, Line, LineBasicMaterial, LineLoop, LineSegments, Mesh, MeshStandardMaterial, Points, PointsMaterial, Texture } from "three";
import { describe, expect, it, vi, type Mock } from "vitest";
import { primitive } from "./catalog.js";
import { createPolyhedronGeometry, createStudioLights, disposeObject } from "./three.js";

describe("createPolyhedronGeometry", () => {
  it("has a position and normal per triangle corner, and a bounding sphere", () => {
    const geometry = createPolyhedronGeometry(primitive("platonic-cube"), "cube");
    expect(geometry.name).toBe("cube");
    expect(geometry.getAttribute("position").count).toBe(36); // 6 faces × 2 triangles × 3 corners
    expect(geometry.getAttribute("normal").count).toBe(36);
    expect(geometry.boundingSphere?.radius).toBeCloseTo(1, 5);
  });

  it("is freed by dispose", () => {
    const geometry = createPolyhedronGeometry(primitive("platonic-icosahedron"));
    const onDispose = vi.fn();
    geometry.addEventListener("dispose", onDispose);
    geometry.dispose();
    expect(onDispose).toHaveBeenCalledOnce();
  });
});

describe("createStudioLights", () => {
  it("has key, fill, rim and ambient lights, scaled by intensity", () => {
    const rig = createStudioLights({ intensity: 2 });
    expect(rig.children.map((c) => c.name)).toEqual(["key", "fill", "rim", "ambient"]);
    const key = rig.getObjectByName("key");
    expect(key && "intensity" in key ? key.intensity : 0).toBeCloseTo(4.8);
  });
});

describe("disposeObject", () => {
  it("frees each geometry, material and texture once, even when shared", () => {
    const geometry = new BufferGeometry();
    const map = new Texture();
    const material = new MeshStandardMaterial({ map });
    const parent = new Mesh(geometry, material);
    parent.add(new Mesh(geometry, material));
    const disposed = { geometry: vi.fn(), material: vi.fn(), map: vi.fn() };
    geometry.addEventListener("dispose", disposed.geometry);
    material.addEventListener("dispose", disposed.material);
    map.addEventListener("dispose", disposed.map);

    disposeObject(parent);

    expect(disposed.geometry).toHaveBeenCalledOnce();
    expect(disposed.material).toHaveBeenCalledOnce();
    expect(disposed.map).toHaveBeenCalledOnce();
  });
});

describe("disposeObject beyond plain meshes", () => {
  const geometry = (): BufferGeometry => new BufferGeometry().setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));

  /** Counts `dispose` events on each resource, so a miss or a double free both show. */
  const watch = (...resources: readonly { addEventListener: (type: "dispose", listener: () => void) => void }[]): readonly Mock[] =>
    resources.map((resource) => {
      const listener = vi.fn();
      resource.addEventListener("dispose", listener);
      return listener;
    });

  it("frees an InstancedMesh with its instance buffers", () => {
    const shape = geometry();
    const material = new MeshStandardMaterial();
    const mesh = new InstancedMesh(shape, material, 4);
    mesh.setColorAt(0, new Color("#ff0000"));
    const [onMesh, onGeometry, onMaterial] = watch(mesh, shape, material);
    const instanceMatrix = vi.spyOn(mesh.instanceMatrix, "dispose");
    const instanceColor = vi.spyOn(mesh.instanceColor ?? mesh.instanceMatrix, "dispose");
    disposeObject(new Group().add(mesh));
    expect([onMesh, onGeometry, onMaterial].map((m) => m?.mock.calls.length)).toEqual([1, 1, 1]);
    expect(instanceMatrix).toHaveBeenCalledOnce();
    expect(instanceColor).toHaveBeenCalled();
  });

  it("frees a BatchedMesh, its material and its geometry once", () => {
    const material = new MeshStandardMaterial();
    const batch = new BatchedMesh(2, 8, 8, material);
    batch.addGeometry(geometry());
    const [onBatch, onGeometry, onMaterial] = watch(batch, batch.geometry, material);
    disposeObject(batch);
    expect([onBatch, onGeometry, onMaterial].map((m) => m?.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it.each([
    ["Line", (g: BufferGeometry, m: LineBasicMaterial) => new Line(g, m)],
    ["LineSegments", (g: BufferGeometry, m: LineBasicMaterial) => new LineSegments(g, m)],
    ["LineLoop", (g: BufferGeometry, m: LineBasicMaterial) => new LineLoop(g, m)],
  ] as const)("frees the geometry and material of a %s", (_name, make) => {
    const shape = geometry();
    const material = new LineBasicMaterial();
    const [onGeometry, onMaterial] = watch(shape, material);
    disposeObject(new Group().add(make(shape, material)));
    expect([onGeometry, onMaterial].map((m) => m?.mock.calls.length)).toEqual([1, 1]);
  });

  it("frees the geometry, material and texture of Points, and every material of an array", () => {
    const shape = geometry();
    const map = new Texture();
    const first = new PointsMaterial({ map });
    const second = new PointsMaterial();
    const [onGeometry, onFirst, onSecond, onMap] = watch(shape, first, second, map);
    disposeObject(new Points(shape, [first, second]));
    expect([onGeometry, onFirst, onSecond, onMap].map((m) => m?.mock.calls.length)).toEqual([1, 1, 1, 1]);
  });
});
