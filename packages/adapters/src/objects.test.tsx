import { hedronite, neutral } from "@hedronite/lts-tokens";
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

  it("follows a change of look in place: the same materials and geometry, edges in the new accent", async () => {
    const renderer = await ReactThreeTestRenderer.create(<FramedSolid primitive="platonic-cube" palette={neutral.scene} />);
    const parts = () => all(renderer.scene.instance).filter((o): o is Mesh => o instanceof Mesh);
    const before = parts().map((mesh) => [mesh.geometry, mesh.material]);
    await renderer.update(<FramedSolid primitive="platonic-cube" palette={hedronite.scene} />);
    expect(parts().map((mesh) => [mesh.geometry, mesh.material])).toEqual(before);
    const edges = parts().find((mesh) => mesh.name === "edges");
    expect(edges?.material instanceof MeshPhysicalMaterial && edges.material.color.equals(new Color(hedronite.scene.accent))).toBe(true);
    const faces = parts().find((mesh) => mesh.name === "faces");
    expect(faces?.material instanceof MeshPhysicalMaterial && faces.material.color.equals(new Color(hedronite.scene.glass))).toBe(true);
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

// Last: the descriptors load once, and the test above that expects nothing until they do needs them not yet loaded.
describe("LibraryObject, on a change of look", () => {
  it("recolors the built object in place: the same meshes and materials", async () => {
    const renderer = await ReactThreeTestRenderer.create(<LibraryObject object="your-desk-lamp" palette={neutral.scene} />);
    const parts = () => all(renderer.scene.instance).filter((o): o is Mesh => o instanceof Mesh);
    await vi.waitFor(
      () => {
        expect(parts().length).toBeGreaterThan(0);
      },
      { timeout: 5000 },
    );
    const before = parts().map((mesh) => [mesh, mesh.material]);
    const colors = (): string[] => parts().flatMap((mesh) => (mesh.material instanceof MeshPhysicalMaterial ? [mesh.material.color.getHexString()] : []));
    const was = colors();
    await renderer.update(<LibraryObject object="your-desk-lamp" palette={hedronite.scene} />);
    await vi.waitFor(() => {
      expect(colors()).not.toEqual(was);
    });
    expect(parts().map((mesh) => [mesh, mesh.material])).toEqual(before);
    await renderer.unmount();
  });
});
