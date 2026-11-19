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
const node = (id: string, parent: string | null, extra: Partial<SceneNode> = {}): SceneNode => ({ ...first, id, parent, asset: { kind: "primitive", id: "platonic-cube" }, surface: { material: "metal" }, ...extra });

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
        node("b", null, { asset: { kind: "object", id: "no-such" }, surface: { shader: "no-such" } }),
        node("c", null, { asset: { kind: "framed", id: "platonic-cube", edges: { material: "no-such" } }, surface: { material: "no-such" } }),
      ],
      effects: [{ id: "no-such" }],
    };
    expect(codes(scene)).toEqual([
      "unknown-look@look",
      "unknown-primitive@nodes.0.asset.id",
      "unknown-object@nodes.1.asset.id",
      "unknown-shader@nodes.1.surface.shader",
      "unknown-material@nodes.2.asset.edges.material",
      "unknown-material@nodes.2.surface.material",
      "unknown-effect@effects.0.id",
    ]);
  });

  it("names a parameter the asset does not have and a value outside its schema", () => {
    const scene: Scene = {
      ...base,
      nodes: [
        node("a", null, { asset: { kind: "primitive", id: "platonic-cube", params: { scale: 99 } } }),
        node("b", null, { asset: { kind: "object", id: "dress-watch", params: { hours: 1.5, colour: "red" } }, surface: { shader: "toon", params: { bands: 1 } } }),
        node("c", null, { surface: { material: "metal", params: { shine: 1 } } }),
      ],
      effects: [{ id: "dither", params: { cell: "big" } }],
    };
    expect(codes(scene)).toEqual([
      "invalid-param@nodes.0.asset.params.scale",
      "unknown-param@nodes.1.asset.params.colour",
      "invalid-param@nodes.1.asset.params.hours",
      "invalid-param@nodes.1.surface.params.bands",
      "unknown-param@nodes.2.surface.params.shine",
      "invalid-param@effects.0.params.cell",
    ]);
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
      (scene, at) => ({ scene: { ...scene, nodes: scene.nodes.map((n, i) => (i === at ? { ...n, surface: { material: "gone" } } : n)) }, expected: `unknown-material@nodes.${String(at)}.surface.material` }),
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
