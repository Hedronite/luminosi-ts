import { materialPreset } from "@hedronite/lts-materials";
import type { Scene as SceneDocument, SceneNode } from "@hedronite/lts-scene";
import { hedronite, neutral } from "@hedronite/lts-tokens";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { Color, Mesh, MeshPhysicalMaterial, Texture, type BufferGeometry, type Material, type Object3D } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scene } from "./scene.js";

const node = (id: string, over: Partial<SceneNode> = {}): SceneNode => ({
  id,
  parent: null,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  asset: { kind: "primitive", id: "platonic-cube" },
  ...over,
});

const document = (nodes: SceneNode[]): SceneDocument => ({
  format: "lts-scene",
  version: 1,
  look: "neutral",
  seed: 1,
  nodes,
  lights: { rig: "studio", intensity: 1 },
  environment: { kind: "studio" },
  camera: { position: [0, 1, 6], target: [0, 0, 0], fov: 35 },
  effects: [],
  ink: "look",
});

type Drawn = Mesh<BufferGeometry, Material | Material[]>;
const isMesh = (object: Object3D): object is Drawn => object instanceof Mesh;

const meshesOf = (root: Object3D): Drawn[] => {
  const found: Drawn[] = [];
  root.traverse((object) => {
    if (isMesh(object)) found.push(object);
  });
  return found;
};

/** The uuids of every mesh and material, as the stage's identity counter reads them. */
const identities = (root: Object3D): Set<string> => new Set(meshesOf(root).flatMap((mesh) => [mesh.uuid, ...(Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((material: Material) => material.uuid)]));

const doc = document([node("a", { surface: { material: "metal" } }), node("b", { position: [2, 0, 0], asset: { kind: "primitive", id: "platonic-octahedron" }, surface: { shader: "hologram" } })]);

const built = async (root: Object3D, count: number): Promise<void> => {
  await vi.waitFor(
    () => {
      expect(meshesOf(root)).toHaveLength(count);
    },
    { timeout: 5000 },
  );
};

// The reduced-motion query reads `window`, which a node test does not have.
beforeEach(() => {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }) });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Scene", () => {
  it("mounts the document: nodes at their transforms and the lights", async () => {
    const renderer = await ReactThreeTestRenderer.create(<Scene doc={doc} palette={neutral.scene} />);
    const root = renderer.scene.instance;
    await built(root, 2);
    expect(root.getObjectByName("b")?.position.x).toBe(2);
    expect(root.getObjectByName("studio-lights")).toBeDefined();
    await renderer.unmount();
  });

  it("frees every geometry, material and texture on unmount", async () => {
    const renderer = await ReactThreeTestRenderer.create(<Scene doc={doc} palette={neutral.scene} />);
    const root = renderer.scene.instance;
    await built(root, 2);
    const spies: ReturnType<typeof vi.fn>[] = [];
    const seen = new Set<BufferGeometry | Material | Texture>();
    for (const mesh of meshesOf(root)) {
      seen.add(mesh.geometry);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        seen.add(material);
        for (const value of Object.values(material)) if (value instanceof Texture) seen.add(value);
      }
    }
    for (const resource of seen) {
      const spy = vi.fn();
      resource.addEventListener("dispose", spy);
      spies.push(spy);
    }
    expect(spies.length).toBeGreaterThanOrEqual(4);
    await renderer.unmount();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
    expect(meshesOf(root)).toHaveLength(0);
  });

  it("tells onRoot the root it built, and undefined when it frees it", async () => {
    const roots: (Object3D | undefined)[] = [];
    const renderer = await ReactThreeTestRenderer.create(<Scene doc={doc} palette={neutral.scene} onRoot={(root) => roots.push(root)} />);
    await built(renderer.scene.instance, 2);
    expect(roots).toHaveLength(1);
    expect(roots[0]).toBeDefined();
    expect(meshesOf(roots[0] ?? renderer.scene.instance)).toHaveLength(2);
    await renderer.unmount();
    expect(roots).toHaveLength(2);
    expect(roots[1]).toBeUndefined();
  });

  it("builds nothing for a new document object with equal content", async () => {
    const renderer = await ReactThreeTestRenderer.create(<Scene doc={doc} palette={neutral.scene} />);
    const root = renderer.scene.instance;
    await built(root, 2);
    const before = identities(root);
    await renderer.update(<Scene doc={structuredClone(doc)} palette={neutral.scene} />);
    // Give a rebuild, if there were one, time to land.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(identities(root)).toEqual(before);
    await renderer.unmount();
  });

  it("builds only the node that changed", async () => {
    const renderer = await ReactThreeTestRenderer.create(<Scene doc={doc} palette={neutral.scene} />);
    const root = renderer.scene.instance;
    await built(root, 2);
    const of = (id: string): Set<string> => identities(root.getObjectByName(id) ?? root);
    const [a, b] = [of("a"), of("b")];
    await renderer.update(<Scene doc={document([node("a", { surface: { material: "satin" } }), doc.nodes[1] ?? node("b")])} palette={neutral.scene} />);
    await vi.waitFor(() => {
      expect([...of("a")].some((id) => a.has(id))).toBe(false);
    });
    expect(of("b")).toEqual(b);
    await renderer.unmount();
  });

  it("recolors in place when the palette changes", async () => {
    const renderer = await ReactThreeTestRenderer.create(<Scene doc={document([node("a")])} palette={neutral.scene} />);
    const root = renderer.scene.instance;
    await built(root, 1);
    const before = identities(root);
    await renderer.update(<Scene doc={document([node("a")])} palette={hedronite.scene} />);
    const material = meshesOf(root)[0]?.material;
    expect(identities(root)).toEqual(before);
    expect(material instanceof MeshPhysicalMaterial && material.color.getHexString()).toBe(new Color(hedronite.scene[materialPreset("satin").color]).getHexString());
    await renderer.unmount();
  });
});
