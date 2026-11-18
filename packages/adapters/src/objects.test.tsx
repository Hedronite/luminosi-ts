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
  const meshesOf = (renderer: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>): number => all(renderer.scene.instance).filter((o) => o instanceof Mesh).length;

  it("builds the dress watch and a data object once their descriptors load, and nothing for an unknown id", async () => {
    const watch = await ReactThreeTestRenderer.create(<LibraryObject object="dress-watch" />);
    expect(meshesOf(watch)).toBe(0);
    await vi.waitFor(
      () => {
        expect(meshesOf(watch)).toBeGreaterThan(50);
      },
      { timeout: 5000 },
    );
    await watch.unmount();
    const lamp = await ReactThreeTestRenderer.create(<LibraryObject object="your-desk-lamp" />);
    await vi.waitFor(
      () => {
        expect(meshesOf(lamp)).toBeGreaterThan(0);
      },
      { timeout: 5000 },
    );
    await lamp.unmount();
    const none = await ReactThreeTestRenderer.create(<LibraryObject object="no-such-object" />);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(meshesOf(none)).toBe(0);
    await none.unmount();
  });

  it("takes the descriptor's parameters: a cluster's material", async () => {
    const metalness = async (params: Record<string, unknown>): Promise<number> => {
      const renderer = await ReactThreeTestRenderer.create(<LibraryObject object="crystal-cluster" params={params} />);
      await vi.waitFor(
        () => {
          expect(meshesOf(renderer)).toBeGreaterThan(0);
        },
        { timeout: 5000 },
      );
      const material = all(renderer.scene.instance).find((o): o is Mesh => o instanceof Mesh)?.material;
      await renderer.unmount();
      if (!(material instanceof MeshPhysicalMaterial)) throw new Error("expected a physical material");
      return material.metalness;
    };
    // Satin is the default; metal is all metal.
    expect(await metalness({ material: "metal" })).toBeGreaterThan(await metalness({}));
  });
});
