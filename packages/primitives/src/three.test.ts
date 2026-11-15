import { createDisposalScope } from "@hedronite/lts-core";
import { BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
import { describe, expect, it, vi } from "vitest";
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

  it("is freed by a disposal scope", () => {
    const geometry = createPolyhedronGeometry(primitive("platonic-icosahedron"));
    const onDispose = vi.fn();
    geometry.addEventListener("dispose", onDispose);
    const scope = createDisposalScope();
    scope.track(geometry);
    scope.dispose();
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
