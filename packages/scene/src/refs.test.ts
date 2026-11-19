import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { acceptAll, currentFixtures, fixtureScene, resolve, scenes } from "./arbitrary.js";
import { checkRefs } from "./refs.js";
import type { Scene, SceneNode } from "./schema.js";

const base = fixtureScene("primitives-in-materials");
const codes = (scene: Scene): string[] => checkRefs(scene, resolve).map((issue) => `${issue.code}@${issue.path.join(".")}`);
const withNodes = (nodes: readonly SceneNode[]): Scene => ({ ...base, nodes: [...nodes] });
/** The first node of the fixture, as a starting point. */
const first: SceneNode = fixtureScene("primitives-in-materials").nodes[0] ?? (() => { throw new Error("fixture has no node"); })();
/** A node of the fixture's transform. It has a metal surface unless it is an object (which has none) or `extra` gives another. */
const node = (id: string, parent: string | null, extra: Partial<SceneNode> = {}): SceneNode => {
  const asset = extra.asset ?? { kind: "primitive", id: "platonic-cube" };
  const surface = extra.surface ?? (asset.kind === "object" ? undefined : { material: "metal" });
  return { id, parent, position: first.position, rotation: first.rotation, scale: first.scale, asset, ...(surface === undefined ? {} : { surface }) };
};

describe("checkRefs", () => {
  it("finds nothing wrong with any valid document", () => {
    fc.assert(
      fc.property(scenes, (scene) => {
        expect(checkRefs(scene, resolve)).toEqual([]);
      }),
    );
  });

  it.each(currentFixtures)("finds no structural problem in the %s fixture", (name) => {
    expect(checkRefs(fixtureScene(name), acceptAll(fixtureScene(name)))).toEqual([]);
  });

  it("names an unknown id of each kind, at its path", () => {
    const scene: Scene = {
      ...base,
      look: "nowhere",
      nodes: [
        node("a", null, { asset: { kind: "primitive", id: "no-such" } }),
        node("b", null, { asset: { kind: "object", id: "no-such" } }),
        node("c", null, { asset: { kind: "framed", id: "platonic-cube", edges: { material: "no-such" } }, surface: { material: "no-such" } }),
        node("d", null, { surface: { shader: "no-such" } }),
      ],
      effects: [{ id: "no-such" }],
    };
    expect(codes(scene)).toEqual([
      "unknown-look@look",
      "unknown-primitive@nodes.0.asset.id",
      "unknown-object@nodes.1.asset.id",
      "unknown-material@nodes.2.asset.edges.material",
      "unknown-material@nodes.2.surface.material",
      "unknown-shader@nodes.3.surface.shader",
      "unknown-effect@effects.0.id",
    ]);
  });

  it("names a parameter the asset does not have and a value outside its schema", () => {
    const scene: Scene = {
      ...base,
      nodes: [
        node("a", null, { asset: { kind: "primitive", id: "platonic-cube", params: { scale: 99 } } }),
        node("b", null, { asset: { kind: "object", id: "dress-watch", params: { hours: 1.5, colour: "red" } } }),
        node("c", null, { surface: { material: "metal", params: { shine: 1 } } }),
        node("d", null, { surface: { shader: "toon", params: { bands: 1 } } }),
      ],
      effects: [{ id: "dither", params: { cell: "big" } }],
    };
    expect(codes(scene)).toEqual([
      "invalid-param@nodes.0.asset.params.scale",
      "unknown-param@nodes.1.asset.params.colour",
      "invalid-param@nodes.1.asset.params.hours",
      "unknown-param@nodes.2.surface.params.shine",
      "invalid-param@nodes.3.surface.params.bands",
      "invalid-param@effects.0.params.cell",
    ]);
  });

  it("names a surface on an object, and accepts the object's material as its parameter", () => {
    const withoutSurface = (id: string, asset: SceneNode["asset"]): SceneNode => ({ id, parent: null, position: first.position, rotation: first.rotation, scale: first.scale, asset });
    const watch: SceneNode["asset"] = { kind: "object", id: "dress-watch" };
    expect(codes(withNodes([node("a", null, { asset: watch, surface: { material: "metal" } })]))).toEqual(["surface-on-object@nodes.0.surface"]);
    expect(codes(withNodes([node("a", null, { asset: watch, surface: { shader: "toon" } })]))).toEqual(["surface-on-object@nodes.0.surface"]);
    expect(codes(withNodes([withoutSurface("a", watch), withoutSurface("b", { kind: "object", id: "crystal-cluster", params: { material: "metal" } })]))).toEqual([]);
  });

  it("names an effect that is in the stack twice, at the second", () => {
    expect(codes({ ...base, nodes: [], effects: [{ id: "dither" }, { id: "grain" }, { id: "dither", params: { cell: 4 } }] })).toEqual(["duplicate-effect@effects.2.id"]);
    expect(codes({ ...base, nodes: [], effects: [{ id: "grain" }, { id: "dither" }] })).toEqual([]);
  });

  it("rejects a parameter whose value is not a number where the schema wants one", () => {
    const notNumbers = fc.oneof(fc.string(), fc.boolean(), fc.constant(null), fc.array(fc.nat(), { maxLength: 2 }), fc.record({ a: fc.nat() }));
    fc.assert(
      fc.property(notNumbers, (value) => {
        const scene: Scene = { ...base, nodes: [node("a", null, { asset: { kind: "primitive", id: "platonic-cube", params: { scale: value } } })], effects: [{ id: "dither", params: { cell: value } }] };
        expect(codes(scene)).toEqual(["invalid-param@nodes.0.asset.params.scale", "invalid-param@effects.0.params.cell"]);
      }),
    );
  });

  it("accepts the ids that are names on every object, listed before or after their children", () => {
    expect(codes(withNodes([node("constructor", "__proto__"), node("__proto__", "toString"), node("toString", null)]))).toEqual([]);
    expect(codes(withNodes([node("a", "__proto__"), node("__proto__", null)]))).toEqual([]);
    expect(codes(withNodes([node("a", "toString")]))).toEqual(["missing-parent@nodes.0.parent"]);
    expect(codes(withNodes([node("constructor", "constructor")]))).toEqual(["cycle@nodes.0.parent"]);
  });

  it("accepts a framed solid with a shader for its faces", () => {
    expect(codes(withNodes([node("a", null, { asset: { kind: "framed", id: "platonic-cube", edges: { material: "metal" } }, surface: { shader: "toon", params: { bands: 4 } } })]))).toEqual([]);
  });

  it("names a duplicate id, a missing parent and a cycle", () => {
    expect(codes(withNodes([node("a", null), node("a", null)]))).toEqual(["duplicate-id@nodes.1.id"]);
    expect(codes(withNodes([node("a", "ghost")]))).toEqual(["missing-parent@nodes.0.parent"]);
    expect(codes(withNodes([node("a", "a")]))).toEqual(["cycle@nodes.0.parent"]);
    expect(codes(withNodes([node("a", "b"), node("b", "a")]))).toEqual(["cycle@nodes.0.parent"]);
    // A node that hangs from a cycle is not in it, and a separate cycle is a second report.
    expect(codes(withNodes([node("a", "b"), node("b", "a"), node("c", "a"), node("d", "e"), node("e", "d")]))).toEqual(["cycle@nodes.0.parent", "cycle@nodes.3.parent"]);
  });

  it("finds any one fault injected into a valid document", () => {
    const mutations: readonly ((scene: Scene, at: number) => { readonly scene: Scene; readonly expected: string })[] = [
      (scene, at) => ({ scene: { ...scene, nodes: scene.nodes.map((n, i) => (i === at ? { ...n, asset: { kind: "primitive", id: "gone" } } : n)) }, expected: `unknown-primitive@nodes.${String(at)}.asset.id` }),
      (scene, at) => ({ scene: { ...scene, nodes: scene.nodes.map((n, i) => (i === at ? { ...n, asset: { kind: "primitive", id: "platonic-cube" }, surface: { material: "gone" } } : n)) }, expected: `unknown-material@nodes.${String(at)}.surface.material` }),
      (scene, at) => ({ scene: { ...scene, nodes: scene.nodes.map((n, i) => (i === at ? { ...n, asset: { kind: "primitive", id: "platonic-cube", params: { nope: 1 } } } : n)) }, expected: `unknown-param@nodes.${String(at)}.asset.params.nope` }),
      (scene, at) => ({ scene: { ...scene, nodes: scene.nodes.map((n, i) => (i === at ? { ...n, asset: { kind: "primitive", id: "platonic-cube", params: { scale: 50 } } } : n)) }, expected: `invalid-param@nodes.${String(at)}.asset.params.scale` }),
      (scene, at) => ({ scene: { ...scene, nodes: scene.nodes.map((n, i) => (i === at ? { ...n, parent: "ghost" } : n)) }, expected: `missing-parent@nodes.${String(at)}.parent` }),
      (scene, at) => ({ scene: { ...scene, nodes: scene.nodes.map((n, i) => (i === at ? { ...n, parent: n.id } : n)) }, expected: `cycle@nodes.${String(at)}.parent` }),
      (scene) => ({ scene: { ...scene, effects: [...scene.effects, { id: "gone" }] }, expected: `unknown-effect@effects.${String(scene.effects.length)}.id` }),
    ];
    fc.assert(
      fc.property(scenes.filter((scene) => scene.nodes.length > 0), fc.nat(), fc.nat(), (scene, pick, which) => {
        const { scene: bad, expected } = (mutations[which % mutations.length] ?? mutations[0] ?? ((s) => ({ scene: s, expected: "" })))(scene, pick % scene.nodes.length);
        expect(codes(bad)).toContain(expected);
      }),
    );
  });

  it("finds a duplicate id injected into a valid document", () => {
    fc.assert(
      fc.property(scenes.filter((scene) => scene.nodes.length > 1), fc.nat(), (scene, pick) => {
        const [source, target] = [0, 1 + (pick % (scene.nodes.length - 1))];
        const bad = { ...scene, nodes: scene.nodes.map((n, i) => (i === target ? { ...n, id: scene.nodes[source]?.id ?? "" } : n)) };
        expect(codes(bad)).toContain(`duplicate-id@nodes.${String(target)}.id`);
      }),
    );
  });
});
