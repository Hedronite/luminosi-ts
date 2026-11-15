import ReactThreeTestRenderer from "@react-three/test-renderer";
import { Group, InstancedMesh, Mesh, type Object3D } from "three";
import { describe, expect, it, vi } from "vitest";
import { CrystalCluster, Lattice, PrimitiveMesh, StudioLights } from "./components.js";

const meshesIn = (root: Object3D): Mesh[] => {
  const found: Mesh[] = [];
  const isMesh = (o: Object3D): o is Mesh => o instanceof Mesh;
  root.traverse((o) => {
    if (isMesh(o)) found.push(o);
  });
  return found;
};

describe("PrimitiveMesh", () => {
  it("renders the primitive with its material, then frees both on unmount", async () => {
    const renderer = await ReactThreeTestRenderer.create(<PrimitiveMesh primitive="platonic-octahedron" material="glass" position={[1, 0, 0]} />);
    const [mesh] = meshesIn(renderer.scene.instance);
    if (mesh === undefined) throw new Error("no mesh rendered");
    expect(mesh.geometry.name).toBe("platonic-octahedron");
    expect(mesh.position.x).toBe(1);
    const freed = vi.fn();
    mesh.geometry.addEventListener("dispose", freed);
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    material?.addEventListener("dispose", freed);
    await renderer.unmount();
    expect(freed).toHaveBeenCalledTimes(2);
  });

  it("swaps and frees the old geometry when the id changes", async () => {
    const renderer = await ReactThreeTestRenderer.create(<PrimitiveMesh primitive="platonic-cube" />);
    const [before] = meshesIn(renderer.scene.instance);
    const freed = vi.fn();
    before?.geometry.addEventListener("dispose", freed);
    await renderer.update(<PrimitiveMesh primitive="platonic-icosahedron" />);
    const [after] = meshesIn(renderer.scene.instance);
    expect(after?.geometry.name).toBe("platonic-icosahedron");
    expect(freed).toHaveBeenCalledOnce();
    await renderer.unmount();
  });
});

describe("StudioLights", () => {
  it("adds the studio rig", async () => {
    const renderer = await ReactThreeTestRenderer.create(<StudioLights intensity={2} />);
    const rig = renderer.scene.instance.getObjectByName("studio-lights");
    expect(rig).toBeInstanceOf(Group);
    await renderer.unmount();
  });
});

describe("objects", () => {
  it("CrystalCluster renders one mesh per crystal", async () => {
    const renderer = await ReactThreeTestRenderer.create(<CrystalCluster count={7} seed={3} />);
    expect(meshesIn(renderer.scene.instance)).toHaveLength(7);
    await renderer.unmount();
  });

  it("Lattice renders a single instanced mesh", async () => {
    const renderer = await ReactThreeTestRenderer.create(<Lattice size={3} />);
    const meshes = meshesIn(renderer.scene.instance);
    expect(meshes).toHaveLength(1);
    expect(meshes[0]).toBeInstanceOf(InstancedMesh);
    await renderer.unmount();
  });
});
