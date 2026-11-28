/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { materialPreset } from "@hedronite/lts-materials";
import { loadDescriptors } from "@hedronite/lts-registry";
import { hedronite, neutral, presets, type ScenePalette } from "@hedronite/lts-tokens";
import { BufferGeometry, Color, DataTexture, Euler, InstancedMesh, Light, Matrix4, Quaternion, Vector3, Mesh, MeshPhysicalMaterial, Texture, type Material, type Object3D, type Scene as ThreeScene } from "three";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { checkRefs, parseScene, setEffects, setInk, setTransform, type Scene as SceneDocument, type SceneNode } from "./index.js";
import type { WebGPURenderer } from "three/webgpu";
import type * as WebgpuTypes from "three/webgpu";
import type * as ThreeEntry from "./three.js";
import { createRoom, createScene, type HdriLoader } from "./three.js";

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
  version: 2,
  look: "neutral",
  seed: 1,
  nodes,
  lights: { rig: "studio", intensity: 1 },
  environment: { kind: "studio" },
  camera: { position: [0, 1, 6], target: [0, 0, 0], fov: 35 },
  effects: [],
  ink: "look",
  tracks: [],
  clips: [],
  rest: {},
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
  // Older versions are read by the migration tests, not here: this holds the documents that are the current version.
  const names = readdirSync(new URL("../fixtures/", import.meta.url))
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(/\.json$/, ""))
    .filter((name) => {
      const header: unknown = JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));
      return typeof header === "object" && header !== null && "version" in header && header.version === 2;
    });

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

// The screen effects and the environment bake need a GPU, so the block below makes its scenes from stand-ins that hold what the real ones do here:
// render targets with uuids. They are put in for this block only (a fresh import of the entry, after `doMock`), so no other test sees them.
describe("effectTargets", () => {
  const built = { pipelines: 0 };
  let makeScene: typeof createScene;
  let renderer: WebGPURenderer;

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock("@hedronite/lts-postfx/three", () => {
      class ScreenEffects {
        readonly targetIds: readonly string[];
        constructor() {
          built.pipelines += 1;
          this.targetIds = [`pass-${String(built.pipelines)}`, `target-${String(built.pipelines)}`];
        }
        setParams(): void {}
        setStage(): void {}
        setPointer(): void {}
        setSize(): void {}
        render(): void {}
        dispose(): void {}
      }
      return {
        ScreenEffects,
        stackStructure: (stack: readonly { readonly id: string }[], reduced: boolean): string => `${String(reduced)}:${stack.map((effect) => effect.id).join(",")}`,
        stackValues: (): Record<string, never> => ({}),
        applyPalette: (): void => undefined,
      };
    });
    vi.doMock("three/webgpu", async (original) => {
      const actual = await original<typeof WebgpuTypes>();
      class PMREMGenerator {
        fromScene(): { readonly texture: object; dispose: () => void } {
          return { texture: {}, dispose: () => undefined };
        }
        dispose(): void {}
      }
      return { ...actual, PMREMGenerator };
    });
    makeScene = (await import("./three.js")).createScene;
    const Webgpu = await import("three/webgpu");
    // What `createScene` asks of a renderer when it draws: its size and a frame. The real one needs a GPU.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- a stand-in for a renderer, which needs a GPU: it is what the type asks for, and has the two methods the scene calls
    renderer = Object.assign(Object.create(Webgpu.WebGPURenderer.prototype) as WebGPURenderer, { getSize: (target: { set: (x: number, y: number) => unknown }) => target.set(512, 512), render: () => undefined });
  });
  afterAll(() => {
    vi.doUnmock("@hedronite/lts-postfx/three");
    vi.doUnmock("three/webgpu");
    vi.resetModules();
  });

  const doc: SceneDocument = scene([node("a", { surface: { material: "metal" } })]);

  function ok(result: ReturnType<typeof setEffects>): SceneDocument {
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    return result.scene;
  }

  it("is there with a renderer only, and empty while there are no effects", async () => {
    const without = makeScene(doc, { palette: neutral.scene });
    await without.ready;
    expect(without.effectTargets).toBeUndefined();
    without.dispose();
    const drawn = makeScene(doc, { palette: neutral.scene, renderer });
    await drawn.ready;
    expect(drawn.effectTargets?.()).toEqual([]);
    drawn.dispose();
  });

  it("lists the render-target textures of each pipeline, never fewer, and a new one only when the stack's structure changes", async () => {
    const start = built.pipelines;
    const drawn = makeScene(ok(setEffects(doc, [{ id: "dither" }])), { palette: neutral.scene, renderer });
    await drawn.ready;
    const targets = (): readonly string[] => drawn.effectTargets?.() ?? [];
    const first = [`pass-${String(start + 1)}`, `target-${String(start + 1)}`];
    expect(targets()).toEqual(first);

    // Written in place: a parameter, an ink, a look, a transform, the pointer, a frame, and the same stack again.
    const same = ok(setEffects(doc, [{ id: "dither", params: { cell: 6 } }]));
    await drawn.update(same);
    await drawn.update(ok(setInk(same, "accent")));
    drawn.setLook(neutral.scene);
    await drawn.update(ok(setTransform(same, "a", { position: [1, 2, 3], rotation: [0.1, 0.2, 0.3], scale: [2, 2, 2] })));
    drawn.setPointer?.({ x: 0.5, y: 0.5 });
    drawn.render?.(0.016);
    expect(targets()).toEqual(first);

    // Another structure builds another pipeline, and the first one's textures stay listed after it is freed.
    await drawn.update(ok(setEffects(same, [{ id: "dither" }, { id: "grain" }])));
    expect(targets()).toEqual([...first, `pass-${String(start + 2)}`, `target-${String(start + 2)}`]);
    await drawn.update(doc);
    expect(targets()).toHaveLength(4);
    await drawn.update(ok(setEffects(doc, [{ id: "grain" }])));
    expect(targets()).toHaveLength(6);
    expect(new Set(targets()).size).toBe(6);
    drawn.dispose();
  });
});


describe("the document's motion", () => {
  /** A document whose one node stands at [0, 0.6, 0], with a track that would move it and a rest pose of [0, 0, 0]. */
  const moving = (): SceneDocument =>
    scene([node("hero", { position: [0, 0.6, 0] })], {
      tracks: [{ id: "rise", target: "node.hero.position", keyframes: [{ time: 0, value: [0, 0, 0], easing: "linear" }, { time: 1, value: [0, 0.6, 0], easing: "linear" }], driver: "time", trigger: "load" }],
      rest: { "node.hero.position": [0, 0, 0] },
    });

  const heroAt = (built: { readonly root: Object3D }): readonly number[] => built.root.getObjectByName("hero")?.position.toArray() ?? [];

  it("writes the rest pose before the first step, so a reduced-motion scene shows rest and not the node's own position", async () => {
    const built = createScene(moving(), { palette: neutral.scene, motion: { reducedMotion: true } });
    await built.ready;
    expect(heroAt(built)).toEqual([0, 0, 0]);
    expect(built.motionValues().get("node.hero.position")).toEqual([0, 0, 0]);
    // Nothing moves it, whatever it is handed: the rest pose is all a reduced-motion scene shows.
    expect(built.advance(1, { inView: true })).toBe(false);
    expect(heroAt(built)).toEqual([0, 0, 0]);
    built.dispose();
  });

  it("steps the tracks an update brings, from the rest pose the update wrote", async () => {
    const built = createScene(scene([node("hero", { position: [0, 0.6, 0] })]), { palette: neutral.scene });
    await built.ready;
    expect(built.advance(1, {})).toBe(false);
    expect(built.motionValues().size).toBe(0);
    await built.update(moving());
    expect(heroAt(built)).toEqual([0, 0, 0]);
    expect(built.advance(0.5, {})).toBe(true);
    expect(heroAt(built)).toEqual([0, 0.3, 0]);
    built.dispose();
  });
});

describe("in-place light recoloring", () => {
  it("recolors studio lights in place on setLook and update without rebuilding", async () => {
    const doc = scene([node("a", { surface: { material: "satin" } })], { look: "neutral" });
    const built = createScene(doc);
    await built.ready;
    const rig = built.root.getObjectByName("studio-lights");
    const lightsBefore = rig?.children.slice();
    const key = rig?.getObjectByName("key");
    expect(key instanceof Light && key.color.getHexString()).toBe(new Color(neutral.scene.key).getHexString());

    built.setLook(hedronite.scene);
    expect(rig?.children).toEqual(lightsBefore);
    expect(key instanceof Light && key.color.getHexString()).toBe(new Color(hedronite.scene.key).getHexString());

    const live = createScene(doc);
    await live.ready;
    const liveRig = live.root.getObjectByName("studio-lights");
    const liveLightsBefore = liveRig?.children.slice();
    const liveKey = liveRig?.getObjectByName("key");
    await live.update({ ...doc, look: "hedronite" });
    expect(liveRig?.children).toEqual(liveLightsBefore);
    expect(liveKey instanceof Light && liveKey.color.getHexString()).toBe(new Color(hedronite.scene.key).getHexString());

    built.dispose();
    live.dispose();
  });
});

describe("procedural rooms, PMREM disposal, and CC0 HDRI fallback", () => {
  it("builds four distinct procedural rooms and disposes geometry and materials cleanly", () => {
    const names = new Set<string>();
    const blurs = new Set<number>();
    for (const kind of ["studio", "gallery", "dusk", "noir"] as const) {
      const { scene: room, blur } = createRoom(kind);
      names.add(room.name);
      blurs.add(blur);
      expect(room.children.length).toBeGreaterThanOrEqual(7);
      room.dispose();
    }
    expect(names.size).toBe(4);
    expect(blurs.size).toBe(4);
  });

  it("switches rooms with zero PMREM target leaks, updates intensity/rotation in place, and falls back gracefully when offline HDRI fails", async () => {
    vi.resetModules();
    const bakes: { kind: string; disposed: boolean; texture: Texture; isHdri: boolean }[] = [];
    const scenesSeen: ThreeScene[] = [];
    vi.doMock("three/webgpu", async (original) => {
      const actual = await original<typeof WebgpuTypes>();
      class PMREMGenerator {
        fromScene(room: ThreeScene) {
          const entry = { kind: room.name || "room", disposed: false, texture: new Texture(), isHdri: false };
          bakes.push(entry);
          return {
            texture: entry.texture,
            dispose: () => {
              entry.disposed = true;
            },
          };
        }
        fromEquirectangular() {
          const entry = { kind: "hdri", disposed: false, texture: new Texture(), isHdri: true };
          bakes.push(entry);
          return {
            texture: entry.texture,
            dispose: () => {
              entry.disposed = true;
            },
          };
        }
        dispose(): void {}
      }
      return { ...actual, PMREMGenerator };
    });

    const threeMod = await import("./three.js");
    const Webgpu = await import("three/webgpu");
    // Capture internal stage.scene via Renderer stub not needed if we inspect bake targets & scene.environment via WebGPURenderer + Scene spy;
    // verify real HDRLoader offline decode from an in-memory base64 Radiance RGBE data URI first:
    const rgbeHeader = "#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 2\n";
    const rgbeBytes = new Uint8Array(rgbeHeader.length + 8);
    for (let k = 0; k < rgbeHeader.length; k++) rgbeBytes[k] = rgbeHeader.charCodeAt(k);
    rgbeBytes.set([128, 128, 128, 128, 130, 130, 130, 130], rgbeHeader.length);
    const dataUri = `data:application/octet-stream;base64,${Buffer.from(rgbeBytes).toString("base64")}`;

    let equirectDisposed = false;
    const syntheticLoader = (): Promise<Texture> => {
      const tex = new DataTexture(new Uint8Array(16), 2, 2);
      tex.addEventListener("dispose", () => {
        equirectDisposed = true;
      });
      return Promise.resolve(tex);
    };

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test renderer stub without a GPU
    const renderer = Object.assign(Object.create(Webgpu.WebGPURenderer.prototype) as WebGPURenderer, {
      getSize: (target: { set: (x: number, y: number) => unknown }) => target.set(256, 256),
      render: (s: ThreeScene) => {
        scenesSeen.push(s);
      },
    });

    const drawn = threeMod.createScene(scene([node("a")], { environment: { kind: "studio" } }), { palette: neutral.scene, renderer, hdriLoader: syntheticLoader });
    await drawn.ready;
    drawn.render?.(0.016);
    const stageScene = scenesSeen[0];
    expect(stageScene).toBeDefined();
    expect(bakes).toHaveLength(1);
    expect(bakes[0]?.disposed).toBe(false);
    expect(stageScene?.environment).toBe(bakes[0]?.texture);

    // Intensity + rotation update in place with ZERO PMREM re-bakes.
    await drawn.update(scene([node("a")], { environment: { kind: "studio", intensity: 2.2, rotation: 1.25 } }));
    expect(bakes).toHaveLength(1);
    expect(stageScene?.environmentIntensity).toBe(2.2);
    expect(stageScene?.environmentRotation.y).toBeCloseTo(1.25);

    // Room switches bake new target and dispose old target immediately.
    await drawn.update(scene([node("a")], { environment: { kind: "gallery", intensity: 1.1 } }));
    expect(bakes).toHaveLength(2);
    expect(bakes[0]?.disposed).toBe(true);
    expect(bakes[1]?.kind).toBe("room-gallery");
    expect(bakes[1]?.disposed).toBe(false);
    expect(stageScene?.environment).toBe(bakes[1]?.texture);

    await drawn.update(scene([node("a")], { environment: { kind: "dusk" } }));
    expect(bakes[1]?.disposed).toBe(true);
    expect(bakes[2]?.kind).toBe("room-dusk");

    // In-memory synthetic HDRI upgrades cleanly and disposes the temporary equirectangular texture + previous room target.
    await drawn.update(scene([node("a")], { environment: { kind: "noir", hdri: { url: dataUri, license: "CC0-1.0", credit: "Synthetic Test" } } }));
    expect(equirectDisposed).toBe(true);
    expect(bakes[2]?.disposed).toBe(true);
    expect(bakes[3]?.isHdri).toBe(true);
    expect(stageScene?.environment).toBe(bakes[3]?.texture);

    // Offline / failing HDRI falls back gracefully to procedural room without rejecting update.
    const failing = threeMod.createScene(scene([node("a")], { environment: { kind: "noir", hdri: { url: "https://offline.invalid/nope.hdr", license: "CC0-1.0", credit: "Offline Test" } } }), {
      palette: neutral.scene,
      renderer,
      hdriLoader: async () => Promise.reject(new Error("offline")),
    });
    await expect(failing.ready).resolves.toBeUndefined();
    expect(bakes[4]?.kind).toBe("room-noir");
    expect(bakes[4]?.isHdri).toBe(false);

    // Real HDRLoader offline parse via bakeEnvironmentTarget using data: URI (zero network).
    let decodedTex: Texture | undefined;
    const bakedData = await threeMod.bakeEnvironmentTarget(
      {
        fromScene: () => ({ texture: new Texture(), dispose: () => undefined }),
        fromEquirectangular: (t) => {
          decodedTex = t;
          return { texture: new Texture(), dispose: () => undefined };
        },
        dispose: () => undefined,
      },
      { kind: "studio", hdri: { url: dataUri, license: "CC0-1.0", credit: "Data URI" } },
    );
    expect(bakedData.source).toBe("hdri");
    expect(decodedTex).toBeInstanceOf(DataTexture);
    bakedData.target.dispose();

    drawn.dispose();
    failing.dispose();
    expect(bakes.every((b) => b.disposed)).toBe(true);

    vi.doUnmock("three/webgpu");
    vi.resetModules();
  });
});

// Environments are swapped by asking for another one before the last has landed: an undo, a slider, a link followed twice.
// The room on show must be the one the document names, and a load that was only superseded must reject nothing.
describe("environment swaps that overtake one another", () => {
  interface Bake {
    readonly kind: string;
    readonly texture: Texture;
    disposed: boolean;
  }
  const bakes: Bake[] = [];
  let failProcedural = false;
  let threeMod: typeof ThreeEntry;
  let Webgpu: typeof WebgpuTypes;

  const bake = (kind: string): { readonly texture: Texture; dispose: () => void } => {
    const entry: Bake = { kind, texture: new Texture(), disposed: false };
    bakes.push(entry);
    return {
      texture: entry.texture,
      dispose: () => {
        entry.disposed = true;
      },
    };
  };

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock("three/webgpu", async (original) => {
      const actual = await original<typeof WebgpuTypes>();
      class PMREMGenerator {
        fromScene(room: ThreeScene) {
          if (failProcedural) throw new Error("the GPU refused");
          return bake(room.name || "studio");
        }
        fromEquirectangular() {
          return bake("hdri");
        }
        dispose(): void {}
      }
      return { ...actual, PMREMGenerator };
    });
    threeMod = await import("./three.js");
    Webgpu = await import("three/webgpu");
  });
  afterAll(() => {
    vi.doUnmock("three/webgpu");
    vi.resetModules();
  });

  const hdri = { url: "https://example.com/room.hdr", license: "CC0-1.0", credit: "Nobody" } as const;
  const doc = (environment: SceneDocument["environment"]): SceneDocument => scene([node("a")], { environment });
  const equirect = (): DataTexture => new DataTexture(new Uint8Array(16), 2, 2);

  /** A loader that stays pending until the test lets it go; `obeys` says whether an abort rejects it, as `fetch` does. */
  const held = (obeys: boolean) => {
    let release: (texture: Texture) => void = () => undefined;
    let begun: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      begun = resolve;
    });
    const signals: AbortSignal[] = [];
    const loader: HdriLoader = (_url, options) =>
      new Promise<Texture>((resolve, reject) => {
        release = resolve;
        const signal = options?.signal;
        if (signal !== undefined) signals.push(signal);
        if (obeys) {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }
        begun();
      });
    return {
      loader,
      started,
      signals,
      release: (texture: Texture) => {
        release(texture);
      },
    };
  };

  /** A drawn scene and the three.js scene it draws, so a test can see which environment is on show. */
  const draw = (environment: SceneDocument["environment"], hdriLoader?: HdriLoader) => {
    bakes.length = 0;
    const seen: ThreeScene[] = [];
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test renderer stub without a GPU
    const renderer = Object.assign(Object.create(Webgpu.WebGPURenderer.prototype) as WebGPURenderer, {
      getSize: (target: { set: (x: number, y: number) => unknown }) => target.set(256, 256),
      render: (s: ThreeScene) => {
        seen.push(s);
      },
    });
    const handle = threeMod.createScene(doc(environment), { palette: neutral.scene, renderer, ...(hdriLoader === undefined ? {} : { hdriLoader }) });
    const shown = (): string | undefined => {
      handle.render?.(0.016);
      const texture = seen.at(-1)?.environment;
      return bakes.find((entry) => entry.texture === texture)?.kind;
    };
    return { handle, shown, live: () => bakes.filter((entry) => !entry.disposed).map((entry) => entry.kind) };
  };

  it("shows the document's room after a switch away and back before the first switch landed", async () => {
    const { handle, shown, live } = draw({ kind: "studio" });
    await handle.ready;
    const away = handle.update(doc({ kind: "gallery" }));
    const back = handle.update(doc({ kind: "studio" }));
    await Promise.all([away, back]);
    expect(shown()).toBe("RoomEnvironment");
    expect(live()).toEqual(["RoomEnvironment"]);
    // The room that was given up can still be asked for again.
    await handle.update(doc({ kind: "gallery" }));
    expect(shown()).toBe("room-gallery");
    expect(live()).toEqual(["room-gallery"]);
    handle.dispose();
    expect(live()).toEqual([]);
  });

  it("updates intensity and rotation in place when the same HDRI bake is already in flight (F1)", async () => {
    const pending = held(true);
    const { handle, shown, live } = draw({ kind: "noir", hdri }, pending.loader);
    await pending.started;
    const sameSource = handle.update(doc({ kind: "noir", intensity: 2.2, rotation: 0.9, hdri }));
    expect(pending.signals).toHaveLength(1);
    expect(pending.signals[0]?.aborted).toBe(false);
    pending.release(equirect());
    await expect(Promise.all([handle.ready, sameSource])).resolves.toBeDefined();
    expect(shown()).toBe("hdri");
    expect(live()).toEqual(["hdri"]);
    handle.dispose();
  });

  it("aborts a pending HDRI when the document goes back to the room on show, and never shows it", async () => {
    const pending = held(false);
    const { handle, shown, live } = draw({ kind: "studio" }, pending.loader);
    await handle.ready;
    const away = handle.update(doc({ kind: "noir", hdri }));
    await pending.started;
    const back = handle.update(doc({ kind: "studio" }));
    expect(pending.signals.map((signal) => signal.aborted)).toEqual([true]);
    let freed = false;
    const late = equirect();
    late.addEventListener("dispose", () => {
      freed = true;
    });
    pending.release(late);
    await expect(Promise.all([away, back])).resolves.toBeDefined();
    expect(freed).toBe(true);
    expect(shown()).toBe("RoomEnvironment");
    expect(live()).toEqual(["RoomEnvironment"]);
    handle.dispose();
  });

  it("rejects neither ready nor update when a switch aborts a pending HDRI load", async () => {
    const pending = held(true);
    const { handle, shown, live } = draw({ kind: "noir", hdri }, pending.loader);
    await pending.started;
    const next = handle.update(doc({ kind: "dusk" }));
    await expect(handle.ready).resolves.toBeUndefined();
    await expect(next).resolves.toBeUndefined();
    expect(shown()).toBe("room-dusk");
    expect(live()).toEqual(["room-dusk"]);
    handle.dispose();
  });

  it("rejects ready for nothing when dispose aborts a pending HDRI load", async () => {
    const pending = held(true);
    const { handle, live } = draw({ kind: "noir", hdri }, pending.loader);
    await pending.started;
    handle.dispose();
    await expect(handle.ready).resolves.toBeUndefined();
    expect(live()).toEqual([]);
  });

  it("still rejects a bake that fails while it is the one wanted", async () => {
    failProcedural = true;
    try {
      const { handle } = draw({ kind: "gallery" });
      await expect(handle.ready).rejects.toThrow("could not be built");
      handle.dispose();
    } finally {
      failProcedural = false;
    }
  });

  it("frees an aborted load's texture and generator once each", async () => {
    const controller = new AbortController();
    const counts = { generator: 0, texture: 0 };
    const texture = equirect();
    texture.addEventListener("dispose", () => {
      counts.texture += 1;
    });
    const generator = {
      fromScene: () => bake("unwanted"),
      fromEquirectangular: () => bake("unwanted"),
      dispose: () => {
        counts.generator += 1;
      },
    };
    const loading = threeMod.bakeEnvironmentTarget(
      generator,
      { kind: "noir", hdri },
      {
        signal: controller.signal,
        hdriLoader: async () => {
          controller.abort();
          return Promise.resolve(texture);
        },
      },
    );
    await expect(loading).rejects.toThrow("aborted");
    expect(counts).toEqual({ generator: 1, texture: 1 });
  });

  describe("stage quality engine (shadows, bloom, dof, tone mapping, full/lite)", () => {
    const stageDoc = (stage?: SceneDocument["stage"], look: SceneDocument["look"] = "neutral"): SceneDocument => ({
      format: "lts-scene",
      version: 2,
      look,
      seed: 0,
      nodes: [node("cube", { asset: { kind: "primitive", id: "platonic-cube" }, surface: { material: "metal" } })],
      lights: { rig: "studio", intensity: 1 },
      environment: { kind: "studio" },
      camera: { position: [0, 0, 5], target: [0, 0, 0], fov: 40 },
      effects: [],
      ink: "look",
      tracks: [],
      clips: [],
      rest: {},
      ...(stage === undefined ? {} : { stage }),
    });

    const makeRenderer = () => {
      const seen: ThreeScene[] = [];
      const proto: unknown = Object.create(Webgpu.WebGPURenderer.prototype);
      if (!(proto instanceof Webgpu.WebGPURenderer)) throw new Error("not renderer");
      const renderer = Object.assign(proto, {
        toneMapping: 0,
        toneMappingExposure: 1,
        shadowMap: { enabled: false, type: 1 },
        getPixelRatio: () => 1,
        getSize: (target: { set: (x: number, y: number) => unknown }) => target.set(256, 256),
        render: (s: ThreeScene) => {
          seen.push(s);
        },
      });
      return { renderer, seen };
    };

    it("toggles soft shadows, mesh castShadow/receiveShadow, shadow catcher, and disposes cleanly", async () => {
      const { renderer } = makeRenderer();
      const handle = threeMod.createScene(stageDoc({ quality: "full", shadows: { enabled: true, catcher: true } }), { renderer });
      await handle.ready;

      const key = handle.root.getObjectByName("key");
      expect(key instanceof Light && key.castShadow).toBe(true);
      expect(renderer.shadowMap.enabled).toBe(true);
      const catcher = handle.root.getObjectByName("shadow-catcher");
      expect(catcher).toBeInstanceOf(Mesh);
      expect(catcher?.receiveShadow).toBe(true);
      const meshes: Object3D[] = [];
      handle.root.traverse((o) => {
        if (o instanceof Mesh && o.name !== "shadow-catcher") meshes.push(o);
      });
      expect(meshes.every((m) => m.castShadow && m.receiveShadow)).toBe(true);

      let catcherDisposed = false;
      if (catcher instanceof Mesh && catcher.geometry instanceof BufferGeometry) {
        catcher.geometry.addEventListener("dispose", () => {
          catcherDisposed = true;
        });
      }

      // Switching to lite cleanly disables shadows and frees the shadow catcher without rebuilding nodes.
      await handle.update(stageDoc({ quality: "lite", shadows: { enabled: true, catcher: true } }));
      expect(key instanceof Light && key.castShadow).toBe(false);
      expect(renderer.shadowMap.enabled).toBe(false);
      expect(handle.root.getObjectByName("shadow-catcher")).toBeUndefined();
      expect(catcherDisposed).toBe(true);
      expect(meshes.every((m) => !m.castShadow && !m.receiveShadow)).toBe(true);

      handle.dispose();
    });

    it("drives toneMapping and exposure from look tokens with per-scene override, and preserves baseline when stage is omitted", async () => {
      const { renderer } = makeRenderer();
      const lightPreset = presets.find((p) => p.scene.toneMapping === "neutral") ?? hedronite;
      const handle = threeMod.createScene(stageDoc(undefined, lightPreset.id), { renderer });
      await handle.ready;
      expect([renderer.toneMapping, renderer.toneMappingExposure]).toEqual([0, 1]);

      // Adding stage uses the look toneMapping and exposure tokens.
      await handle.update(stageDoc({ quality: "lite" }, lightPreset.id));
      expect(renderer.toneMapping).toBe(lightPreset.scene.toneMapping === "neutral" ? 7 : 4);
      expect(renderer.toneMappingExposure).toBe(lightPreset.scene.exposure);

      // Explicit per-scene override takes precedence; setLook only updates non-overridden fields.
      await handle.update(stageDoc({ quality: "lite", toneMapping: "agx", exposure: 1.6 }, lightPreset.id));
      expect([renderer.toneMapping, renderer.toneMappingExposure]).toEqual([6, 1.6]);
      handle.setLook(hedronite.scene);
      expect([renderer.toneMapping, renderer.toneMappingExposure]).toEqual([6, 1.6]);

      // Clearing stage restores renderer baseline cleanly.
      await handle.update(stageDoc(undefined, lightPreset.id));
      expect([renderer.toneMapping, renderer.toneMappingExposure]).toEqual([0, 1]);
      handle.dispose();
    });

    it("does not dispose the key light on look changes or updates while shadows stay off", async () => {
      const doc = stageDoc({ quality: "lite", shadows: { enabled: false, catcher: false } });
      const built = createScene(doc);
      await built.ready;
      const key = built.root.getObjectByName("key");
      if (!(key instanceof Light)) throw new Error("missing key");
      let disposals = 0;
      key.addEventListener("dispose", () => {
        disposals += 1;
      });
      built.setLook(hedronite.scene);
      built.setLook(neutral.scene);
      await built.update({ ...doc, look: "hedronite" });
      expect(disposals).toBe(0);
      built.dispose();
      expect(disposals).toBeGreaterThanOrEqual(1);
    });

    it("disposes the key light once when shadows go off after they were on", async () => {
      const { renderer } = makeRenderer();
      const handle = createScene(stageDoc({ quality: "full", shadows: { enabled: true, catcher: false } }), { renderer });
      await handle.ready;
      const key = handle.root.getObjectByName("key");
      if (!(key instanceof Light)) throw new Error("missing key");
      let disposals = 0;
      key.addEventListener("dispose", () => {
        disposals += 1;
      });
      await handle.update(stageDoc({ quality: "lite", shadows: { enabled: true, catcher: false } }));
      expect(disposals).toBe(1);
      handle.dispose();
    });

    it("disposes previous key light (releasing ShadowNode target/textures) when shadows turn off or lights.intensity changes", async () => {
      const { renderer } = makeRenderer();
      const docWithIntensity = (intensity: number, stage?: SceneDocument["stage"]): SceneDocument => ({
        ...stageDoc(stage),
        lights: { rig: "studio", intensity },
      });
      const handle = threeMod.createScene(docWithIntensity(1, { quality: "full", shadows: { enabled: true, catcher: false } }), { renderer });
      await handle.ready;

      const firstKey = handle.root.getObjectByName("key");
      if (!(firstKey instanceof Light)) throw new Error("missing key light");
      let firstDisposed = 0;
      firstKey.addEventListener("dispose", () => {
        firstDisposed += 1;
      });

      // Opening a scene with a different lights.intensity (e.g., v1 glass fixture at 1.2) replaces the light rig: the old key light must dispose.
      await handle.update(docWithIntensity(1.2));
      expect(firstDisposed).toBe(1);

      // Enabling shadows again on the new light rig and then switching shadows off also disposes the key light synchronously.
      await handle.update(docWithIntensity(1.2, { quality: "full", shadows: { enabled: true, catcher: false } }));
      const secondKey = handle.root.getObjectByName("key");
      if (!(secondKey instanceof Light)) throw new Error("missing second key light");
      let secondDisposed = 0;
      secondKey.addEventListener("dispose", () => {
        secondDisposed += 1;
      });
      await handle.update(docWithIntensity(1.2, { quality: "lite", shadows: { enabled: true, catcher: false } }));
      expect(secondDisposed).toBe(1);

      handle.dispose();
      expect(secondDisposed).toBeGreaterThanOrEqual(2);
    });

    it("builds bloom and dof targets on full quality, updates uniformly, and disables under lite with zero leaks", async () => {
      const { renderer } = makeRenderer();
      const handle = threeMod.createScene(
        stageDoc({ quality: "full", bloom: { enabled: true, threshold: 5, gain: 0.22, radius: 0.35 }, dof: { enabled: true, focus: 5.5, aperture: 1, focalLength: 2.5 } }),
        { renderer },
      );
      await handle.ready;
      const initialTargets = handle.effectTargets?.() ?? [];
      expect(initialTargets.length).toBeGreaterThan(0);

      // Updating bloom/dof parameters reuses the same pipeline targets without reallocating.
      await handle.update(
        stageDoc({ quality: "full", bloom: { enabled: true, threshold: 3, gain: 0.4, radius: 0.5 }, dof: { enabled: true, focus: 7, aperture: 1.5, focalLength: 3 } }),
      );
      expect(handle.effectTargets?.()).toEqual(initialTargets);

      // Switching to lite tears down bloom/dof targets cleanly.
      await handle.update(stageDoc({ quality: "lite", bloom: { enabled: true, threshold: 5, gain: 0.22, radius: 0.35 }, dof: { enabled: true, focus: 5.5, aperture: 1, focalLength: 2.5 } }));
      expect(handle.effectTargets?.()).toEqual(initialTargets);
      handle.dispose();
    });
  });
});
