import ReactThreeTestRenderer from "@react-three/test-renderer";
import { Mesh, type Object3D } from "three";
import { describe, expect, it, vi } from "vitest";
import { PrimitiveMesh } from "./components.js";

const isMesh = (o: Object3D): o is Mesh => o instanceof Mesh;

const meshes = (root: Object3D): Mesh[] => {
  const found: Object3D[] = [];
  root.traverse((o) => {
    found.push(o);
  });
  return found.filter(isMesh);
};

describe("PrimitiveMesh with a surface shader", () => {
  it("draws nothing until the shader has loaded, then draws with it, and frees it on unmount", async () => {
    const renderer = await ReactThreeTestRenderer.create(<PrimitiveMesh primitive="platonic-cube" shader="hologram" />);
    expect(meshes(renderer.scene.instance)).toHaveLength(0);
    // The import resolves on its own and React commits the result; there is nothing to await but the scene.
    await vi.waitFor(
      () => {
        expect(meshes(renderer.scene.instance)).toHaveLength(1);
      },
      { timeout: 5000 },
    );
    const material = meshes(renderer.scene.instance)[0]?.material;
    if (material === undefined || Array.isArray(material)) throw new Error("expected one material");
    expect(material.name).toBe("hologram");
    const freed = vi.fn();
    material.addEventListener("dispose", freed);
    await renderer.unmount();
    expect(freed).toHaveBeenCalled();
  });

  it("draws a preset at once when it has no shader", async () => {
    const renderer = await ReactThreeTestRenderer.create(<PrimitiveMesh primitive="platonic-cube" material="glass" />);
    expect(meshes(renderer.scene.instance)).toHaveLength(1);
    await renderer.unmount();
  });
});
