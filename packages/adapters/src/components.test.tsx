import ReactThreeTestRenderer from "@react-three/test-renderer";
import { Group, InstancedMesh, Mesh, type Object3D } from "three";
import { describe, expect, it, vi } from "vitest";
import { hedronite, neutral } from "@hedronite/lts-tokens";
import { Color, MeshPhysicalMaterial } from "three";
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

describe("a change of look", () => {
  const surface = (root: Object3D): MeshPhysicalMaterial => {
    const material = meshesIn(root)[0]?.material;
    if (!(material instanceof MeshPhysicalMaterial)) throw new Error("expected a physical material");
    return material;
  };

  it("recolors a primitive's material in place: the same material, the same geometry, nothing freed", async () => {
    const renderer = await ReactThreeTestRenderer.create(<PrimitiveMesh primitive="platonic-cube" material="metal" palette={neutral.scene} />);
    const material = surface(renderer.scene.instance);
    const geometry = meshesIn(renderer.scene.instance)[0]?.geometry;
    const freed = vi.fn();
    material.addEventListener("dispose", freed);
    geometry?.addEventListener("dispose", freed);
    await renderer.update(<PrimitiveMesh primitive="platonic-cube" material="metal" palette={hedronite.scene} />);
    expect(surface(renderer.scene.instance)).toBe(material);
    expect(meshesIn(renderer.scene.instance)[0]?.geometry).toBe(geometry);
    expect(material.color.equals(new Color(hedronite.scene.metal))).toBe(true);
    expect(freed).not.toHaveBeenCalled();
    await renderer.unmount();
  });

  it("recolors a cluster and a lattice in place", async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <CrystalCluster count={3} seed={1} material="metal" palette={neutral.scene} />
        <Lattice size={2} material="metal" palette={neutral.scene} />
      </>,
    );
    const before = meshesIn(renderer.scene.instance).map((mesh) => mesh.material);
    await renderer.update(
      <>
        <CrystalCluster count={3} seed={1} material="metal" palette={hedronite.scene} />
        <Lattice size={2} material="metal" palette={hedronite.scene} />
      </>,
    );
    const after = meshesIn(renderer.scene.instance).map((mesh) => mesh.material);
    expect(after).toEqual(before);
    for (const material of after) expect(material instanceof MeshPhysicalMaterial && material.color.equals(new Color(hedronite.scene.metal))).toBe(true);
    await renderer.unmount();
  });
});
