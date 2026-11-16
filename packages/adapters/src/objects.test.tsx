import { hedronite } from "@hedronite/lts-tokens";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { Color, InstancedMesh, Mesh, MeshPhysicalMaterial, type Object3D } from "three";
import { describe, expect, it, vi } from "vitest";
import { accentPalette, FramedSolid, LibraryObject } from "./objects.js";

const all = (root: Object3D): Object3D[] => {
  const found: Object3D[] = [];
  root.traverse((o) => found.push(o));
  return found;
};

describe("FramedSolid", () => {
  it("draws faces, edges and beads, with the edges in the accent color", async () => {
    const renderer = await ReactThreeTestRenderer.create(<FramedSolid primitive="platonic-cube" palette={hedronite.scene} position={[0, 1, 0]} />);
    const objects = all(renderer.scene.instance);
    const edges = objects.find((o): o is InstancedMesh => o instanceof InstancedMesh && o.name === "edges");
    expect(edges?.count).toBe(12);
    const material = edges?.material;
    expect(material instanceof MeshPhysicalMaterial && material.color.equals(new Color(hedronite.scene.accent))).toBe(true);
    expect(objects.some((o) => o instanceof Mesh && o.name === "faces")).toBe(true);
    await renderer.unmount();
  });

  it("frees what it built when it unmounts", async () => {
    const renderer = await ReactThreeTestRenderer.create(<FramedSolid primitive="platonic-tetrahedron" />);
    const faces = all(renderer.scene.instance).find((o): o is Mesh => o instanceof Mesh && o.name === "faces");
    const freed = vi.fn();
    faces?.geometry.addEventListener("dispose", freed);
    await renderer.unmount();
    expect(freed).toHaveBeenCalledOnce();
  });
});

describe("accentPalette", () => {
  it("puts the accent in whichever slot the material reads", () => {
    expect(accentPalette(hedronite.scene, "metal").metal).toBe(hedronite.scene.accent);
    expect(accentPalette(hedronite.scene, "glass").glass).toBe(hedronite.scene.accent);
    expect(accentPalette(hedronite.scene, "metal").glass).toBe(hedronite.scene.glass);
  });
});

describe("LibraryObject", () => {
  it("builds the dress watch and a data object, and nothing for an unknown id", async () => {
    const watch = await ReactThreeTestRenderer.create(<LibraryObject object="dress-watch" />);
    expect(all(watch.scene.instance).filter((o) => o instanceof Mesh).length).toBeGreaterThan(50);
    await watch.unmount();
    const lamp = await ReactThreeTestRenderer.create(<LibraryObject object="your-desk-lamp" />);
    expect(all(lamp.scene.instance).some((o) => o instanceof Mesh)).toBe(true);
    await lamp.unmount();
    const none = await ReactThreeTestRenderer.create(<LibraryObject object="no-such-object" />);
    expect(all(none.scene.instance).some((o) => o instanceof Mesh)).toBe(false);
    await none.unmount();
  });
});
