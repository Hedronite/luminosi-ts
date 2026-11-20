import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { acceptAll, currentFixtures, editsOf, fixtureScene, resolve, scenes } from "./arbitrary.js";
import { addNode, removeNode, setEffects, setInk, setLights, setLook, setSurface, setTransform } from "./edit.js";
import { checkRefs } from "./refs.js";
import { parseScene, type Scene, type SceneNode, type SceneResult } from "./schema.js";

/** Freezes a value and everything in it, so that a write to it throws (these modules are strict). */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

/** The scene of a result that is ok, or a thrown error naming its issues. */
function scene(result: SceneResult): Scene {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.scene;
}

/** A result, as an edit gives it. */
const isResult = (value: unknown): value is SceneResult => typeof value === "object" && value !== null && "ok" in value && typeof value.ok === "boolean";

/**
 * An edit called with arguments of the wrong kind, which the types do not allow: what it gives back, which must be a result and not a throw.
 * (`Reflect.apply` takes any arguments, so no assertion is needed to say a wrong one.)
 */
function badly(edit: (...args: never[]) => unknown, ...args: unknown[]): SceneResult {
  const result: unknown = Reflect.apply(edit, undefined, args);
  if (!isResult(result)) throw new Error("an edit did not give a result");
  return result;
}

const codes = (result: SceneResult): string[] => (result.ok ? [] : result.issues.map((issue) => `${issue.code}@${issue.path.join(".")}`));

const tree = fixtureScene("transform-hierarchy");
const parents = tree.nodes.filter((node) => node.parent !== null);
const some = (list: readonly SceneNode[]): SceneNode => list[0] ?? (() => { throw new Error("no node"); })();

const platonic = (id: string, parent: string | null = null): SceneNode => ({ id, parent, position: [1, 2, 3], rotation: [0, 0.5, 0], scale: [1, 1, 1], asset: { kind: "primitive", id: "platonic-cube" }, surface: { material: "metal" } });

describe("every edit", () => {
  it("gives a document that reads and holds no structural problem, for any edit of any valid document", () => {
    fc.assert(
      fc.property(
        scenes.chain((start) => fc.tuple(fc.constant(start), editsOf(start))),
        ([start, edit]) => {
          const result = edit.run(start);
          expect(result.ok, `${edit.name}: ${JSON.stringify(codes(result))}`).toBe(true);
          const out = scene(result);
          expect(parseScene(out).ok).toBe(true);
          expect(checkRefs(out, resolve)).toEqual([]);
          expect(checkRefs(out, acceptAll(out))).toEqual([]);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("holds up over a run of edits, each made on what the last gave", () => {
    fc.assert(
      fc.property(scenes, fc.gen(), (start, gen) => {
        let current = start;
        for (let step = 0; step < 6; step += 1) {
          const edit = gen(editsOf, current);
          const result = edit.run(current);
          expect(result.ok, `${edit.name}: ${JSON.stringify(codes(result))}`).toBe(true);
          current = scene(result);
          expect(checkRefs(current, resolve)).toEqual([]);
        }
      }),
      { numRuns: 12 },
    );
  });

  it("leaves the document it was given exactly as it was", () => {
    fc.assert(
      fc.property(
        scenes.chain((start) => fc.tuple(fc.constant(start), editsOf(start))),
        ([start, edit]) => {
          const before = structuredClone(start);
          // A frozen document throws on any write, even one into a parameter record.
          edit.run(deepFreeze(structuredClone(start)));
          expect(start).toEqual(before);
        },
      ),
    );
  });

  it("shares no object with the document it was given, so a later write to one cannot reach the other", () => {
    fc.assert(
      fc.property(
        scenes.chain((start) => fc.tuple(fc.constant(start), editsOf(start))),
        ([start, edit]) => {
          const result = edit.run(start);
          const shared: string[] = [];
          const walk = (before: unknown, after: unknown, path: string): void => {
            if (typeof before !== "object" || before === null || typeof after !== "object" || after === null) return;
            if (before === after) shared.push(path);
            for (const key of Object.keys(before)) walk(Reflect.get(before, key), Reflect.get(after, key), `${path}.${key}`);
          };
          walk(start, scene(result), "");
          expect(shared).toEqual([]);
        },
      ),
    );
  });

  it.each(currentFixtures)("holds on the %s fixture: each edit reads, and the fixture is unchanged", (name) => {
    const fixture = fixtureScene(name);
    const before = structuredClone(fixture);
    fc.assert(
      fc.property(editsOf(fixture), (edit) => {
        const result = edit.run(deepFreeze(structuredClone(fixture)));
        expect(codes(result)).toEqual([]);
      }),
      { numRuns: 40 },
    );
    expect(fixture).toEqual(before);
  });

  it("never throws for a value of the wrong kind in any field: bad arguments are issues", () => {
    const start = fixtureScene("v1");
    const id = some(start.nodes).id;
    fc.assert(
      fc.property(fc.anything(), (wrong) => {
        const results = [
          badly(addNode, start, wrong),
          badly(removeNode, start, wrong),
          badly(setTransform, start, id, { position: wrong }),
          badly(setTransform, start, wrong, {}),
          badly(setSurface, start, id, wrong),
          badly(setEffects, start, wrong),
          badly(setInk, start, wrong),
          badly(setLights, start, { intensity: wrong }),
          badly(setLook, start, wrong),
        ];
        // An edit that is ok has given a document that reads; one that is not has named what is wrong.
        expect(results.map((result) => (result.ok ? parseScene(result.scene).ok : result.issues.length > 0))).toEqual(results.map(() => true));
      }),
      { numRuns: 60 },
    );
  });
});

describe("an id that has no string form", () => {
  it("is an issue, not a throw, where an edit would write it into its message", () => {
    // fast-check found this one: an object whose toString is not a function cannot be turned into text.
    const hostile = { toString: false };
    const start = fixtureScene("v1");
    expect(codes(badly(removeNode, start, hostile))).toEqual(["unknown-node@nodes"]);
    expect(codes(badly(setTransform, start, hostile, {}))).toEqual(["unknown-node@nodes"]);
    expect(codes(badly(setSurface, start, hostile, undefined))).toEqual(["unknown-node@nodes"]);
  });
});

describe("addNode", () => {
  it("adds the node after the others, under a node that is there, and the same node is in the document", () => {
    const node = platonic("fresh", some(parents).id);
    const out = scene(addNode(tree, node));
    expect(out.nodes).toHaveLength(tree.nodes.length + 1);
    expect(out.nodes.at(-1)).toEqual(node);
    expect(out.nodes.slice(0, -1)).toEqual(tree.nodes);
  });

  it("refuses an id that is taken, a parent that is not there, and says where", () => {
    expect(codes(addNode(tree, platonic(some(tree.nodes).id)))).toEqual([`duplicate-id@nodes.${String(tree.nodes.length)}.id`]);
    expect(codes(addNode(tree, platonic("fresh", "nowhere")))).toEqual([`missing-parent@nodes.${String(tree.nodes.length)}.parent`]);
    // A node under itself is its own ancestor.
    expect(codes(addNode(tree, platonic("fresh", "fresh")))).toEqual([`cycle@nodes.${String(tree.nodes.length)}.parent`]);
  });

  it("refuses a surface on an object and a node that is not a node", () => {
    const object: SceneNode = { ...platonic("obj"), asset: { kind: "object", id: "dress-watch" } };
    expect(codes(addNode(tree, object))).toEqual([`surface-on-object@nodes.${String(tree.nodes.length)}.surface`]);
    expect(codes(badly(addNode, tree, { ...platonic("x"), position: [0, 0] }))).toHaveLength(1);
  });

  it("takes ids that are also names on every object", () => {
    const start = fixtureScene("v1");
    const out = scene(addNode(scene(addNode(start, platonic("__proto__"))), platonic("constructor", "__proto__")));
    expect(out.nodes.map((node) => node.id).slice(-2)).toEqual(["__proto__", "constructor"]);
    expect(codes(removeNode(out, "__proto__"))).toEqual([]);
    expect(scene(removeNode(out, "__proto__")).nodes).toHaveLength(start.nodes.length);
  });
});

describe("removeNode", () => {
  it("takes the node and every node that stands in it, however deep, and no other", () => {
    const root = some(tree.nodes.filter((node) => node.parent === null));
    const out = scene(removeNode(tree, root.id));
    const gone = new Set([root.id]);
    for (let grown = true; grown; ) {
      grown = false;
      for (const node of tree.nodes) {
        if (node.parent !== null && gone.has(node.parent) && !gone.has(node.id)) {
          gone.add(node.id);
          grown = true;
        }
      }
    }
    expect(out.nodes).toEqual(tree.nodes.filter((node) => !gone.has(node.id)));
    expect(gone.size).toBeGreaterThan(1);
    expect(checkRefs(out, acceptAll(tree))).toEqual([]);
  });

  it("takes a grandchild's whole line even when the children are listed before their parent", () => {
    // The nodes in an order where a child comes first: c under b under a, listed c, b, a.
    const listed: Scene = { ...fixtureScene("v1"), nodes: [platonic("c", "b"), platonic("b", "a"), platonic("a"), platonic("alone")] };
    expect(scene(removeNode(listed, "a")).nodes.map((node) => node.id)).toEqual(["alone"]);
    expect(scene(removeNode(listed, "b")).nodes.map((node) => node.id)).toEqual(["a", "alone"]);
  });

  it("removes only that node when it has no children, and names an id that is not there", () => {
    const leaf = some(tree.nodes.filter((node) => !tree.nodes.some((other) => other.parent === node.id)));
    expect(scene(removeNode(tree, leaf.id)).nodes).toEqual(tree.nodes.filter((node) => node.id !== leaf.id));
    expect(codes(removeNode(tree, "nowhere"))).toEqual(["unknown-node@nodes"]);
  });
});

describe("setTransform", () => {
  it("replaces the fields given and keeps the rest, and the other nodes are as they were", () => {
    const target = some(tree.nodes);
    const out = scene(setTransform(tree, target.id, { position: [9, 8, 7], scale: [2, 2, 2] }));
    const moved = out.nodes.find((node) => node.id === target.id);
    expect(moved).toEqual({ ...target, position: [9, 8, 7], scale: [2, 2, 2] });
    expect(moved?.rotation).toEqual(target.rotation);
    expect(out.nodes.filter((node) => node.id !== target.id)).toEqual(tree.nodes.filter((node) => node.id !== target.id));
  });

  it("refuses a number that is not one, and a node that is not there", () => {
    const target = some(tree.nodes);
    expect(codes(setTransform(tree, target.id, { position: [Number.NaN, 0, 0] }))).toHaveLength(1);
    expect(codes(setTransform(tree, target.id, { scale: [Infinity, 1, 1] }))).toHaveLength(1);
    expect(codes(setTransform(tree, "nowhere", { position: [0, 0, 0] }))).toEqual(["unknown-node@nodes"]);
  });
});

describe("setSurface", () => {
  const primitive = some(fixtureScene("primitives-in-materials").nodes.filter((node) => node.asset.kind === "primitive"));
  const base = fixtureScene("primitives-in-materials");

  it("gives a node a material or a shader, and takes the surface away when given none", () => {
    expect(scene(setSurface(base, primitive.id, { shader: "toon", params: { bands: 4 } })).nodes.find((node) => node.id === primitive.id)?.surface).toEqual({ shader: "toon", params: { bands: 4 } });
    const bare = scene(setSurface(base, primitive.id, undefined)).nodes.find((node) => node.id === primitive.id);
    expect(bare).toBeDefined();
    expect(bare !== undefined && "surface" in bare).toBe(false);
  });

  it("refuses a surface on an object, and says where", () => {
    const withObject = fixtureScene("object-effects-ink");
    const object = some(withObject.nodes.filter((node) => node.asset.kind === "object"));
    const index = withObject.nodes.indexOf(object);
    expect(codes(setSurface(withObject, object.id, { material: "metal" }))).toEqual([`surface-on-object@nodes.${String(index)}.surface`]);
    expect(codes(setSurface(withObject, object.id, undefined))).toEqual([]);
  });
});

describe("setEffects", () => {
  const base = fixtureScene("object-effects-ink");

  it("replaces the stack, in the order given", () => {
    expect(scene(setEffects(base, [{ id: "grain" }, { id: "dither", params: { cell: 4 } }])).effects.map((effect) => effect.id)).toEqual(["grain", "dither"]);
    expect(scene(setEffects(base, [])).effects).toEqual([]);
  });

  it("refuses an effect twice", () => {
    expect(codes(setEffects(base, [{ id: "grain" }, { id: "grain" }]))).toEqual(["duplicate-effect@effects.1.id"]);
  });
});

describe("setInk, setLights and setLook", () => {
  const base = fixtureScene("v1");

  it("change only their own field", () => {
    expect(scene(setInk(base, "glass"))).toEqual({ ...base, ink: "glass" });
    expect(scene(setLights(base, { intensity: 2.5 }))).toEqual({ ...base, lights: { ...base.lights, intensity: 2.5 } });
    expect(scene(setLook(base, "neutral"))).toEqual({ ...base, look: "neutral" });
    const palette = { base: "#111111", accent: "#222222", metal: "#333333", glass: "#444444", emissive: "#555555" };
    expect(scene(setLook(base, palette)).look).toEqual(palette);
  });

  it("refuse a value outside the schema, whatever its type", () => {
    expect(codes(setLights(base, { intensity: 11 }))).toEqual(["out-of-range@lights.intensity"]);
    expect(codes(setLights(base, { intensity: -1 }))).toEqual(["out-of-range@lights.intensity"]);
    expect(codes(setLights(base, { intensity: Number.NaN }))).toHaveLength(1);
    expect(codes(badly(setInk, base, "sparkle"))).toHaveLength(1);
    expect(codes(badly(setLook, base, { base: "red" }))).not.toEqual([]);
    expect(codes(setLook(base, "Not A Slug"))).not.toEqual([]);
  });
});
