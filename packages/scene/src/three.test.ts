/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { materialPreset } from "@hedronite/lts-materials";
import { loadDescriptors } from "@hedronite/lts-registry";
import { hedronite, neutral, presets, type ScenePalette } from "@hedronite/lts-tokens";
import { Color, Euler, InstancedMesh, Matrix4, Quaternion, Vector3, Mesh, MeshPhysicalMaterial, Texture, type BufferGeometry, type Material, type Object3D } from "three";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { checkRefs, parseScene, setTransform, type Scene as SceneDocument, type SceneNode } from "./index.js";
import { createScene } from "./three.js";

const node = (id: string, over: Partial<SceneNode> = {}): SceneNode => ({
  id,
  parent: null,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  asset: { kind: "primitive", id: "platonic-cube" },
  ...over,
});

/** The colour a satin surface takes from a look: satin draws in one of the look's scene colours. */
const satin = (palette: ScenePalette): string => new Color(palette[materialPreset("satin").color]).getHexString();

const scene = (nodes: SceneNode[], over: Partial<SceneDocument> = {}): SceneDocument => ({
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
  ...over,
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

/** The uuids of every mesh and material under `root`: what the identity counter reads. */
const identities = (root: Object3D): Set<string> => new Set(meshesOf(root).flatMap((mesh) => [mesh.uuid, ...(Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((material: Material) => material.uuid)]));

/** Every geometry, material and texture under `root`, once each. */
const resourcesOf = (root: Object3D): Set<BufferGeometry | Material | Texture> => {
  const found = new Set<BufferGeometry | Material | Texture>();
  for (const mesh of meshesOf(root)) {
    found.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      found.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) found.add(value);
    }
  }
  return found;
};

/** A spy on each resource's `dispose` event, which is what three's renderer listens to when it frees GPU memory. */
const watch = (resources: Iterable<BufferGeometry | Material | Texture>): Map<BufferGeometry | Material | Texture, ReturnType<typeof vi.fn>> => {
  const spies = new Map<BufferGeometry | Material | Texture, ReturnType<typeof vi.fn>>();
  for (const resource of resources) {
    const spy = vi.fn();
    resource.addEventListener("dispose", spy);
    spies.set(resource, spy);
  }
  return spies;
};

const fixtures: readonly (readonly [string, SceneDocument])[] = [
  ["primitives in materials", scene([node("a", { surface: { material: "metal" } }), node("b", { asset: { kind: "primitive", id: "platonic-icosahedron" }, position: [2, 0, 0] })])],
  ["a framed solid with a shader", scene([node("f", { asset: { kind: "framed", id: "platonic-dodecahedron", edges: { material: "metal" } }, surface: { shader: "hologram" } })])],
  ["objects", scene([node("c", { asset: { kind: "object", id: "crystal-cluster", params: { count: 5 } } }), node("l", { asset: { kind: "object", id: "instanced-lattice", params: { size: 3 } }, position: [3, 0, 0] })])],
  ["a shader on a primitive, under a parent", scene([node("p", { position: [1, 0, 0] }), node("s", { parent: "p", position: [0, 1, 0], asset: { kind: "primitive", id: "platonic-octahedron" }, surface: { shader: "toon", params: { bands: 3 } } })])],
];

describe("createScene", () => {
  it("builds each node at its transform, under its parent, and the lights", async () => {
    const built = createScene(
      scene([node("p", { position: [1, 0, 0], scale: [2, 2, 2] }), node("c", { parent: "p", position: [0, 1, 0], rotation: [0, 0.5, 0], surface: { material: "glass" } })]),
      { palette: neutral.scene },
    );
    await built.ready;
    const parent = built.root.getObjectByName("p");
    const child = built.root.getObjectByName("c");
    expect(parent?.position.toArray()).toEqual([1, 0, 0]);
    expect(parent?.scale.toArray()).toEqual([2, 2, 2]);
    expect(child?.parent).toBe(parent);
    expect(child?.rotation.y).toBeCloseTo(0.5);
    expect(built.root.getObjectByName("studio-lights")).toBeDefined();
    expect(meshesOf(built.root)).toHaveLength(2);
    expect(built.camera.fov).toBe(35);
    expect(built.camera.position.toArray()).toEqual([0, 1, 6]);
    built.dispose();
  });

  it("has no renderer path without a renderer", async () => {
    const built = createScene(scene([node("a")]));
    await built.ready;
    expect(built.render).toBeUndefined();
    expect(built.setPointer).toBeUndefined();
    built.dispose();
  });

  it("builds in the document's look when no palette is given, and in the palette when one is", async () => {
    const colour = (built: ReturnType<typeof createScene>): string => {
      const material = meshesOf(built.root)[0]?.material;
      return material instanceof MeshPhysicalMaterial ? material.color.getHexString() : "";
    };
    const own = createScene(scene([node("a")], { look: "hedronite" }));
    const given = createScene(scene([node("a")], { look: "hedronite" }), { palette: neutral.scene });
    await Promise.all([own.ready, given.ready]);
    expect(colour(own)).toBe(satin(hedronite.scene));
    expect(colour(given)).toBe(satin(neutral.scene));
    own.dispose();
    given.dispose();
  });

  it.each(fixtures)("frees every geometry, material and texture it built: %s", async (_name, doc) => {
    const built = createScene(doc, { palette: neutral.scene });
    await built.ready;
    const spies = watch(resourcesOf(built.root));
    expect(spies.size).toBeGreaterThan(0);
    built.dispose();
    for (const [resource, spy] of spies) {
      expect(spy, `${resource.constructor.name} ${resource.uuid} freed`).toHaveBeenCalled();
    }
    expect(built.root.children).toHaveLength(0);
  });

  it("frees what a node built again replaced, and what a removed node held", async () => {
    const built = createScene(scene([node("a"), node("b", { position: [2, 0, 0] })]), { palette: neutral.scene });
    await built.ready;
    const before = watch(resourcesOf(built.root));
    await built.update(scene([node("a", { asset: { kind: "primitive", id: "platonic-icosahedron" } })]));
    // "b" is gone and "a" was built again: everything the first build made is freed, and only the new "a" is left.
    for (const spy of before.values()) expect(spy).toHaveBeenCalled();
    expect(meshesOf(built.root)).toHaveLength(1);
    built.dispose();
  });

  it("frees a build that finishes after dispose, and never attaches it", async () => {
    const built = createScene(scene([node("a", { surface: { shader: "hologram" } })]), { palette: neutral.scene });
    built.dispose();
    await built.ready;
    expect(built.root.children).toHaveLength(0);
    expect(meshesOf(built.root)).toHaveLength(0);
  });

  it("is safe to dispose twice, and refuses an update after", async () => {
    const built = createScene(scene([node("a")]));
    await built.ready;
    built.dispose();
    expect(() => {
      built.dispose();
    }).not.toThrow();
    await expect(built.update(scene([]))).rejects.toThrow(/disposed/);
  });

  it("rejects ready for an asset that does not exist, and leaves the other nodes standing", async () => {
    const built = createScene(scene([node("ok"), node("bad", { asset: { kind: "primitive", id: "no-such-solid" } })]));
    await expect(built.ready).rejects.toThrow(/could not be built/);
    expect(built.root.getObjectByName("ok")).toBeDefined();
    built.dispose();
  });
});

describe("setLook", () => {
  it("recolours in place: the same meshes and materials, new colours", async () => {
    const built = createScene(
      scene([node("m", { surface: { material: "satin" } }), node("e", { asset: { kind: "framed", id: "platonic-cube", edges: { material: "metal" } } }), node("h", { surface: { shader: "hologram" } }), node("o", { asset: { kind: "object", id: "crystal-cluster" } })]),
      { palette: neutral.scene },
    );
    await built.ready;
    const before = identities(built.root);
    const material = meshesOf(built.root.getObjectByName("m") ?? built.root)[0]?.material;
    built.setLook(hedronite.scene);
    expect(identities(built.root)).toEqual(before);
    expect(material instanceof MeshPhysicalMaterial && material.color.getHexString()).toBe(satin(hedronite.scene));
    // The framed solid's edges follow the accent, and a shader's look-following colours are written.
    const edges = meshesOf(built.root.getObjectByName("e") ?? built.root)
      .filter((mesh): mesh is InstancedMesh => mesh instanceof InstancedMesh)
      .map((mesh) => mesh.material)
      .find((each) => each instanceof MeshPhysicalMaterial && each.color.getHexString() === new Color(hedronite.scene.accent).getHexString());
    expect(edges).toBeDefined();
    built.dispose();
  });

  it("is not undone by a document whose look differs, once a palette was given", async () => {
    const doc = scene([node("a")], { look: "hedronite" });
    const built = createScene(doc, { palette: neutral.scene });
    await built.ready;
    await built.update({ ...doc, lights: { rig: "studio", intensity: 2 } });
    const material = meshesOf(built.root)[0]?.material;
    expect(material instanceof MeshPhysicalMaterial && material.color.getHexString()).toBe(satin(neutral.scene));
    built.dispose();
  });

  it("follows the document's look while no palette was given", async () => {
    const built = createScene(scene([node("a")], { look: "neutral" }));
    await built.ready;
    const before = identities(built.root);
    await built.update(scene([node("a")], { look: "hedronite" }));
    const material = meshesOf(built.root)[0]?.material;
    expect(identities(built.root)).toEqual(before);
    expect(material instanceof MeshPhysicalMaterial && material.color.getHexString()).toBe(satin(hedronite.scene));
    built.dispose();
  });
});

describe("set", () => {
  const doc = scene([node("h", { surface: { shader: "hologram", params: { density: 40 } } }), node("t", { position: [2, 0, 0], surface: { shader: "toon", params: { bands: 3 } } })]);

  it("writes a shader parameter into its uniform and builds nothing", async () => {
    const built = createScene(doc, { palette: neutral.scene });
    await built.ready;
    const before = identities(built.root);
    const material = meshesOf(built.root.getObjectByName("h") ?? built.root)[0]?.material;
    expect(await built.set("h", { density: 120, speed: 4 })).toBe(true);
    expect(identities(built.root)).toEqual(before);
    expect(meshesOf(built.root.getObjectByName("h") ?? built.root)[0]?.material).toBe(material);
    built.dispose();
  });

  it("builds only that node again for a structural parameter, and says so", async () => {
    const built = createScene(doc, { palette: neutral.scene });
    await built.ready;
    const hologram = meshesOf(built.root.getObjectByName("h") ?? built.root)[0];
    const toon = meshesOf(built.root.getObjectByName("t") ?? built.root)[0];
    expect(await built.set("t", { bands: 5 })).toBe(false);
    expect(meshesOf(built.root.getObjectByName("h") ?? built.root)[0]).toBe(hologram);
    expect(meshesOf(built.root.getObjectByName("t") ?? built.root)[0]).not.toBe(toon);
    built.dispose();
  });

  it("builds the node again for an asset parameter", async () => {
    const built = createScene(scene([node("c", { asset: { kind: "object", id: "crystal-cluster", params: { count: 3 } } })]), { palette: neutral.scene });
    await built.ready;
    const before = identities(built.root);
    expect(await built.set("c", { count: 9 })).toBe(false);
    const after = identities(built.root);
    expect([...after].some((id) => before.has(id))).toBe(false);
    built.dispose();
  });

  it("refuses a value outside the schema, a parameter nothing has and a node that is not there, and changes nothing", async () => {
    const built = createScene(doc, { palette: neutral.scene });
    await built.ready;
    await expect(built.set("h", { density: 100_000 })).rejects.toThrow();
    await expect(built.set("h", { nothing: 1 })).rejects.toThrow(/no parameter/);
    await expect(built.set("zzz", {})).rejects.toThrow(/no node/);
    // The refused value is not remembered: an equal document builds nothing.
    const before = identities(built.root);
    await built.update(doc);
    expect(identities(built.root)).toEqual(before);
    built.dispose();
  });

  it("remembers what it set, so a document that agrees builds nothing", async () => {
    const built = createScene(doc, { palette: neutral.scene });
    await built.ready;
    await built.set("t", { bands: 5 });
    const before = identities(built.root);
    await built.update(scene([node("h", { surface: { shader: "hologram", params: { density: 40 } } }), node("t", { position: [2, 0, 0], surface: { shader: "toon", params: { bands: 5 } } })]));
    expect(identities(built.root)).toEqual(before);
    built.dispose();
  });
});

describe("update", () => {
  const doc = scene([node("a"), node("b", { position: [2, 0, 0], surface: { shader: "hologram" } }), node("c", { position: [4, 0, 0], asset: { kind: "object", id: "crystal-cluster" } })]);

  it("builds nothing for a document with equal content, however it was made", async () => {
    const built = createScene(doc, { palette: neutral.scene });
    await built.ready;
    const before = identities(built.root);
    await built.update(structuredClone(doc));
    expect(identities(built.root)).toEqual(before);
    built.dispose();
  });

  it("moves a node in place and builds nothing", async () => {
    const built = createScene(doc, { palette: neutral.scene });
    await built.ready;
    const before = identities(built.root);
    await built.update({ ...doc, nodes: doc.nodes.map((each) => (each.id === "a" ? { ...each, position: [0, 3, 0], rotation: [1, 0, 0], scale: [2, 2, 2] } : each)) });
    expect(identities(built.root)).toEqual(before);
    const moved = built.root.getObjectByName("a");
    expect(moved?.position.toArray()).toEqual([0, 3, 0]);
    expect(moved?.scale.toArray()).toEqual([2, 2, 2]);
    built.dispose();
  });

  it("writes a shader's parameters in place when the document changes them", async () => {
    const built = createScene(doc, { palette: neutral.scene });
    await built.ready;
    const before = identities(built.root);
    await built.update({ ...doc, nodes: doc.nodes.map((each) => (each.id === "b" ? { ...each, surface: { shader: "hologram", params: { density: 200 } } } : each)) });
    expect(identities(built.root)).toEqual(before);
    built.dispose();
  });

  it("builds only the node whose asset or surface changed", async () => {
    const built = createScene(doc, { palette: neutral.scene });
    await built.ready;
    const of = (id: string): Set<string> => identities(built.root.getObjectByName(id) ?? built.root);
    const [a, b, c] = [of("a"), of("b"), of("c")];
    await built.update({ ...doc, nodes: doc.nodes.map((each) => (each.id === "a" ? { ...each, surface: { material: "metal" } } : each)) });
    expect(of("b")).toEqual(b);
    expect(of("c")).toEqual(c);
    expect([...of("a")].some((id) => a.has(id))).toBe(false);
    built.dispose();
  });

  it("adds a node, takes one away and moves one to another parent", async () => {
    const built = createScene(doc, { palette: neutral.scene });
    await built.ready;
    await built.update(scene([node("a"), node("b", { parent: "a", position: [0, 1, 0], surface: { shader: "hologram" } }), node("d", { position: [-2, 0, 0] })]));
    expect(built.root.getObjectByName("c")).toBeUndefined();
    expect(built.root.getObjectByName("d")).toBeDefined();
    expect(built.root.getObjectByName("b")?.parent).toBe(built.root.getObjectByName("a"));
    built.dispose();
  });

  it("follows the lights and the camera", async () => {
    const built = createScene(doc, { palette: neutral.scene });
    await built.ready;
    await built.update({ ...doc, lights: { rig: "studio", intensity: 2 }, camera: { position: [0, 0, 9], target: [0, 0, 0], fov: 50 } });
    const key = built.root.getObjectByName("key");
    expect(key !== undefined && "intensity" in key ? key.intensity : 0).toBeCloseTo(4.8);
    expect(built.camera.fov).toBe(50);
    expect(built.camera.position.z).toBe(9);
    built.dispose();
  });

  it("keeps the old object on show until the new one is built", async () => {
    const built = createScene(scene([node("a")]), { palette: neutral.scene });
    await built.ready;
    const first = meshesOf(built.root)[0];
    const pending = built.update(scene([node("a", { surface: { material: "metal" } })]));
    expect(meshesOf(built.root)[0]).toBe(first);
    await pending;
    expect(meshesOf(built.root)[0]).not.toBe(first);
    expect(meshesOf(built.root)).toHaveLength(1);
    built.dispose();
  });
});

describe("the fixtures", () => {
  // Every document of the current version the package ships, held to the real registry (the schema tests use a small stand-in catalog).
  const names = readdirSync(new URL("../fixtures/", import.meta.url))
    .filter((file) => file.endsWith(".json") && file !== "v0.json")
    .map((file) => file.replace(/\.json$/, ""));

  it("are there", () => {
    expect(names.length).toBeGreaterThanOrEqual(4);
  });

  it.each(names)("%s names real assets with parameters they take, and builds", async (name) => {
    const parsed = parseScene(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const registry = await loadDescriptors();
    const issues = checkRefs(parsed.scene, (kind, id) => {
      if (kind === "look") return presets.some((preset) => preset.id === id) ? {} : undefined;
      const found = registry.get(id);
      return found?.meta.kind === kind ? { parameters: found.parameters } : undefined;
    });
    expect(issues).toEqual([]);
    const built = createScene(parsed.scene, { palette: neutral.scene });
    await built.ready;
    expect(meshesOf(built.root).length).toBeGreaterThanOrEqual(parsed.scene.nodes.length);
    built.dispose();
  });

  it("places every node of the transform fixture where its chain of parents puts it: Euler x, y, z order, a parent coming later in the list", async () => {
    const parsed = parseScene(readFileSync(new URL("../fixtures/transform-hierarchy.json", import.meta.url), "utf8"));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const { nodes } = parsed.scene;
    // The expected world matrix, worked out apart from the scene: each node's own matrix, multiplied up through its parents.
    const local = (node: SceneNode): Matrix4 => new Matrix4().compose(new Vector3(...node.position), new Quaternion().setFromEuler(new Euler(...node.rotation, "XYZ")), new Vector3(...node.scale));
    const world = (node: SceneNode): Matrix4 => {
      const parent = node.parent === null ? undefined : nodes.find((candidate) => candidate.id === node.parent);
      return parent === undefined ? local(node) : world(parent).multiply(local(node));
    };
    expect(nodes.some((node) => node.parent !== null)).toBe(true);
    expect(nodes.some((node) => node.rotation.some((angle) => angle !== 0))).toBe(true);
    const built = createScene(parsed.scene, { palette: neutral.scene });
    await built.ready;
    built.root.updateMatrixWorld(true);
    for (const node of nodes) {
      const group = built.root.getObjectByName(node.id);
      expect(group?.name).toBe(node.id);
      group?.matrixWorld.elements.forEach((value, i) => {
        expect(value).toBeCloseTo(world(node).elements[i] ?? Number.NaN, 9);
      });
    }
    built.dispose();
  });
});

describe("a transform-only update", () => {
  const family = scene([
    node("p", { position: [1, 0, 0], rotation: [0.2, 0.4, 0.1], scale: [1, 2, 1] }),
    node("s", { parent: "p", position: [0, 1, 0], asset: { kind: "primitive", id: "platonic-octahedron" }, surface: { shader: "toon", params: { bands: 3 } } }),
    node("f", { position: [-2, 0, 0], asset: { kind: "framed", id: "platonic-dodecahedron", edges: { material: "metal" } }, surface: { shader: "hologram" } }),
    node("o", { position: [3, 0, 0], asset: { kind: "object", id: "crystal-cluster" } }),
  ]);
  const ids = ["p", "s", "f", "o"] as const;
  const number = fc.double({ min: -20, max: 20, noNaN: true });
  const vec = fc.tuple(number, number, number);
  const changes = fc.record({ position: vec, rotation: vec, scale: vec }, { requiredKeys: [] });

  const same = (now: Set<unknown>, then: Set<unknown>): boolean => now.size === then.size && [...now].every((each) => then.has(each));
  const closeTo = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

  /** What the document says a node's own matrix is: position, Euler x, y, z, scale. */
  const local = (each: SceneNode): Matrix4 => new Matrix4().compose(new Vector3(...each.position), new Quaternion().setFromEuler(new Euler(...each.rotation, "XYZ")), new Vector3(...each.scale));

  it("moves, turns and scales any node over and over, and back, and builds and frees nothing: the same objects, geometries and materials throughout", async () => {
    const built = createScene(family, { palette: neutral.scene });
    await built.ready;
    const before = resourcesOf(built.root);
    const identity = identities(built.root);
    const spies = watch(before);
    let current = family;
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...ids), changes, async (id, change) => {
        const edited = setTransform(current, id, change);
        if (!edited.ok) throw new Error(JSON.stringify(edited.issues));
        current = edited.scene;
        await built.update(current);
        expect(identities(built.root)).toEqual(identity);
        expect(same(resourcesOf(built.root), before)).toBe(true);
        const target = current.nodes.find((each) => each.id === id);
        const object = built.root.getObjectByName(id);
        expect(object?.position.toArray()).toEqual(target?.position);
        expect(object?.rotation.toArray().slice(0, 3)).toEqual(target?.rotation);
        expect(object?.scale.toArray()).toEqual(target?.scale);
      }),
      { numRuns: 40 },
    );
    // Back to where it began, as an undo does: still nothing built, and nothing freed.
    await built.update(family);
    expect(identities(built.root)).toEqual(identity);
    expect(same(resourcesOf(built.root), before)).toBe(true);
    for (const spy of spies.values()) expect(spy).not.toHaveBeenCalled();
    built.dispose();
  });

  it("puts a nested node where its parent's transform and its own put it, after any edit of either", async () => {
    const built = createScene(family, { palette: neutral.scene });
    await built.ready;
    let current = family;
    await fc.assert(
      fc.asyncProperty(fc.constantFrom("p", "s"), changes, async (id, change) => {
        const edited = setTransform(current, id, change);
        if (!edited.ok) throw new Error(JSON.stringify(edited.issues));
        current = edited.scene;
        await built.update(current);
        built.root.updateMatrixWorld(true);
        const [parent, child] = [current.nodes.find((each) => each.id === "p"), current.nodes.find((each) => each.id === "s")];
        if (parent === undefined || child === undefined) throw new Error("the family lost a node");
        const expected = local(parent).multiply(local(child)).toArray();
        const actual = built.root.getObjectByName("s")?.matrixWorld.toArray() ?? [];
        expect(actual).toHaveLength(16);
        expect(actual.every((value, at) => closeTo(value, expected[at] ?? Number.NaN))).toBe(true);
      }),
      { numRuns: 40 },
    );
    built.dispose();
  });

  it("leaves a shader's parameters and the look alone while a node moves", async () => {
    const built = createScene(family, { palette: neutral.scene });
    await built.ready;
    const colours = meshesOf(built.root).map((mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((material) => (material instanceof MeshPhysicalMaterial ? material.color.getHexString() : "")));
    for (let step = 1; step <= 5; step += 1) {
      const edited = setTransform(family, "s", { position: [step, 0, 0], scale: [step, step, step] });
      if (!edited.ok) throw new Error(JSON.stringify(edited.issues));
      // eslint-disable-next-line no-await-in-loop -- the updates are one gesture after another
      await built.update(edited.scene);
    }
    expect(meshesOf(built.root).map((mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((material) => (material instanceof MeshPhysicalMaterial ? material.color.getHexString() : "")))).toEqual(colours);
    built.dispose();
  });
});
