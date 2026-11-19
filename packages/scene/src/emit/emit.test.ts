import { describe, expect, it } from "vitest";
import { currentFixtures, fixtureScene } from "../arbitrary.js";
import { sceneSchema, type Scene, type SceneNode } from "../schema.js";
import { toTsx, toVanilla } from "./index.js";

const transform: Pick<SceneNode, "position" | "rotation" | "scale"> = { position: [1.5, -0.25, 2], rotation: [0.3, 0.5, 0], scale: [0.5, 0.5, 0.5] };

/** A document with the nodes given, in a neutral studio. */
function sceneOf(nodes: readonly SceneNode[], extra: Partial<Scene> = {}): Scene {
  return sceneSchema.parse({
    format: "lts-scene",
    version: 1,
    look: "neutral",
    seed: 0,
    nodes,
    lights: { rig: "studio", intensity: 1.25 },
    environment: { kind: "studio" },
    camera: { position: [0, 2.2, 5.5], target: [0, 0, 0], fov: 40 },
    effects: [],
    ink: "look",
    ...extra,
  });
}

const cube = (id: string, parent: string | null = null, extra: Partial<SceneNode> = {}): SceneNode => ({
  id,
  parent,
  ...transform,
  asset: { kind: "primitive", id: "platonic-cube" },
  surface: { material: "metal" },
  ...extra,
});

/** The code with every string literal taken out: what is left is what the language reads as names. */
const withoutStrings = (code: string): string => code.replace(/"(?:[^"\\]|\\.)*"/g, '""');

const hostile = ["constructor", "__proto__", "node-1", "Node", "toString", "a_b-C"];

describe.each([
  ["toTsx", toTsx],
  ["toVanilla", toVanilla],
] as const)("%s", (_name, emit) => {
  it.each(currentFixtures)("the %s fixture gives the same text twice", (fixture) => {
    expect(emit(fixtureScene(fixture))).toBe(emit(fixtureScene(fixture)));
  });

  it("gives equal text for equal documents whatever order the keys were written in", () => {
    const scene = sceneOf([cube("a", null, { asset: { kind: "primitive", id: "platonic-cube", params: { scale: 2 } } })]);
    const shuffled = sceneSchema.parse(JSON.parse(JSON.stringify(scene, (_key, value: unknown) => (typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value))));
    expect(emit(shuffled)).toBe(emit(scene));
  });

  it("never uses a node id as a name: a hostile id is only ever a string", () => {
    const nodes = hostile.map((id, index) => cube(id, index === 0 ? null : (hostile[index - 1] ?? null)));
    const code = withoutStrings(emit(sceneOf(nodes)));
    for (const id of hostile) expect(code, `the id ${id} in code`).not.toContain(id);
    for (const id of hostile) expect(emit(sceneOf(nodes))).toContain(JSON.stringify(id));
  });

  it("writes every position, rotation and scale, and the camera and the light", () => {
    const code = emit(sceneOf([cube("a")]));
    expect(code).toContain("1.5, -0.25, 2");
    expect(code).toContain("0.3, 0.5, 0");
    expect(code).toContain("0, 2.2, 5.5");
    expect(code).toContain("1.25");
    expect(code).toContain("40");
  });

  it("carries the effects in the document's order, with their parameters, and the ink", () => {
    const code = emit(sceneOf([cube("a")], { effects: [{ id: "grain", params: { amount: 0.1 } }, { id: "dither", params: { cell: 4 } }], ink: "emissive" }));
    expect(code.indexOf('"grain"')).toBeGreaterThan(-1);
    expect(code.indexOf('"grain"')).toBeLessThan(code.indexOf('"dither"'));
    expect(code).toContain("amount: 0.1");
    expect(code).toContain("cell: 4");
    expect(code).toContain("palette.emissive");
  });

  it("writes no effect and no ink when the stack is empty", () => {
    const code = emit(sceneOf([cube("a")], { ink: "accent" }));
    expect(code).not.toContain("ScreenEffects");
    expect(code).not.toContain("palette.accent");
  });

  it("writes an inline look out, and a look by id as a lookup", () => {
    const palette = { base: "#101010", accent: "#ff6600", metal: "#b87333", glass: "#aaddff", emissive: "#ffee00" };
    expect(emit(sceneOf([cube("a")], { look: palette }))).toContain('"#ff6600"');
    expect(emit(sceneOf([cube("a")], { look: "hedronite" }))).toContain('"hedronite"');
  });

  it("stands a child under its parent even when the child is listed first", () => {
    const code = emit(sceneOf([cube("child", "parent"), cube("parent")]));
    expect(code.indexOf('"parent"')).toBeLessThan(code.indexOf('"child"'));
  });

  it("leaves out a node in a cycle, and puts a node with no parent at the root", () => {
    const code = emit(sceneOf([cube("a", "b"), cube("b", "a"), cube("c", "missing")]));
    expect(code).not.toContain('"a"');
    expect(code).not.toContain('"b"');
    expect(code).toContain('"c"');
  });
});

describe("toTsx", () => {
  it("names the components over the adapters, and gives a parent's children a group", () => {
    const code = toTsx(sceneOf([cube("a"), cube("b", "a", { asset: { kind: "object", id: "dress-watch", params: { hours: 3 } }, surface: undefined })]));
    expect(code).toContain('import { LibraryObject, PrimitiveMesh, StudioLights } from "@hedronite/lts-adapters";');
    expect(code).toContain("<group");
    expect(code).toContain("hours: 3");
  });

  it("multiplies a node's scale by the scale parameter when nothing stands under it", () => {
    expect(toTsx(sceneOf([cube("a", null, { asset: { kind: "primitive", id: "platonic-cube", params: { scale: 2 } } })]))).toContain("scale={[1, 1, 1]}");
  });
});

describe("toVanilla", () => {
  it("imports from the libraries' three entries and never from the scene package or the adapters", () => {
    for (const fixture of currentFixtures) {
      const code = toVanilla(fixtureScene(fixture));
      expect(code).not.toMatch(/lts-scene|lts-adapters|createScene|react/);
      expect(code).toContain('from "@hedronite/lts-primitives/three"');
    }
  });

  it("builds a framed solid's edges in the accent of the look, as the adapter does", () => {
    const code = toVanilla(sceneOf([cube("a", null, { asset: { kind: "framed", id: "archimedean-cuboctahedron", edges: { material: "metal" } } })]));
    expect(code).toContain("createFramedSolid");
    expect(code).toContain("look.accent");
  });

  it("draws as createScene does: a camera of near 0.1 and far 100, and an aspect read from the renderer at each render", () => {
    const code = toVanilla(sceneOf([cube("a")]));
    expect(code).toContain("new PerspectiveCamera(40, 1, 0.1, 100)");
    expect(code).toMatch(/render: \(delta\) => \{\n\s+renderer\.getSize\(size\);/);
    expect(code).toContain("camera.aspect = size.x / size.y;");
    expect(code).toContain("pmrem.fromScene(room, 0.04)");
    expect(code).toContain("createStudioLights({ intensity: 1.25 })");
  });

  it("scales a primitive's geometry by its scale parameter and a framed solid whole, both uniformly", () => {
    const primitive = toVanilla(sceneOf([cube("a", null, { asset: { kind: "primitive", id: "platonic-cube", params: { scale: 2 } } })]));
    expect(primitive).toContain("geometry0.scale(2, 2, 2);");
    const framed = toVanilla(sceneOf([cube("a", null, { asset: { kind: "framed", id: "platonic-cube", edges: { material: "metal" }, params: { scale: 1.5 } } })]));
    expect(framed).toContain("object0.scale.setScalar(1.5);");
  });

  it("fills each effect's parameters from its own schema, and passes no monochrome for the look's own inks", () => {
    const code = toVanilla(sceneOf([cube("a")], { effects: [{ id: "dither", params: { cell: 4 } }, { id: "grain" }], ink: "look" }));
    expect(code).toContain('screenEffectSchemas["dither"].parse({ cell: 4 })');
    expect(code).toContain('screenEffectSchemas["grain"].parse({})');
    expect(code).not.toContain("monochrome");
  });

  it("reads time from the clock it is given, and from three's own when it is given none", () => {
    const code = toVanilla(sceneOf([cube("a", null, { surface: { shader: "toon", params: { bands: 4 } } })]));
    expect(code).toContain("options.clock === undefined ? {} : { clock: options.clock }");
    expect(code).not.toContain("uniform(");
  });
});
