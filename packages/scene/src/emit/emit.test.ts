/// <reference types="node" />
import { runInNewContext } from "node:vm";
import type { Credit } from "@hedronite/lts-core";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { currentFixtures, fixtureScene } from "../arbitrary.js";
import { assetCredit, creditsFor, lookCredit } from "../credits.js";
import type { Resolve } from "../refs.js";
import { sceneSchema, type Scene, type SceneNode } from "../schema.js";
import { toTsx, toVanilla } from "./index.js";

const transform: Pick<SceneNode, "position" | "rotation" | "scale"> = { position: [1.5, -0.25, 2], rotation: [0.3, 0.5, 0], scale: [0.5, 0.5, 0.5] };

/** A document with the nodes given, in a neutral studio. */
function sceneOf(nodes: readonly SceneNode[], extra: Partial<Scene> = {}): Scene {
  return sceneSchema.parse({
    format: "lts-scene",
    version: 2,
    tracks: [],
    clips: [],
    rest: {},
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

  it("throws in the module for a look the tokens do not have, rather than drawing in another", () => {
    const code = emit(sceneOf([cube("a")], { look: "no-such-look" }));
    expect(code).toContain('throw new Error("no look named \\"no-such-look\\"")');
    expect(code).not.toContain("?? neutral");
    expect(emit(sceneOf([cube("a")], { look: "neutral" }))).not.toContain("throw new Error");
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
  it("gives the canvas a camera of near 0.1 and far 100, and passes reduced motion to the effects", () => {
    const code = toTsx(sceneOf([cube("a")], { effects: [{ id: "grain" }] }));
    expect(code).toContain("near: 0.1, far: 100");
    expect(code).toContain("reducedMotion={reducedMotion}");
    expect(code).toContain("export function Scene({ reducedMotion = false }");
    expect(toTsx(sceneOf([cube("a")]))).toContain("export function Scene() {");
  });

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

describe("credits in emitted code", () => {
  const crt = assetCredit({ id: "crt", kind: "effect", origin: { vendor: "threeui", relation: "ported", path: "src/shaders/crt/crtShaders.ts" } });
  const look = lookCredit("catppuccin");
  const real = crt === undefined || look === undefined ? [] : [look, crt];
  // The characters that end a line in JavaScript (and a few that only look like it), written by code so this file holds none of them.
  const [LS, PS, NEL, NUL] = [String.fromCharCode(0x2028), String.fromCharCode(0x2029), String.fromCharCode(0x85), String.fromCharCode(0)] as const;
  const hostile: Credit = {
    subject: "evil",
    kind: "effect",
    relation: "adopted",
    work: `A work\nimport { pwn } from "evil";\r\nwith breaks`,
    source: `https://example.com/a${LS}b`,
    pin: `abc${PS}def */ alert(1) /*`,
    license: `MIT${NEL}${NUL}x`,
    licenseUrl: "https://example.com/license\nmore",
    credit: "Someone\rElse\n// and more",
    path: "src/work.ts",
  };
  const emitters = [
    ["toTsx", toTsx],
    ["toVanilla", toVanilla],
  ] as const;

  it("has the credits of a CRT scene in a look that is credited: crt and catppuccin are both there", () => {
    expect(real).toHaveLength(2);
  });

  it.each(emitters)("%s: a scene with no credits gives the text it always gave, however none are given", (_name, emit) => {
    for (const name of currentFixtures) {
      const scene = fixtureScene(name);
      const plain = emit(scene);
      expect(emit(scene, {})).toBe(plain);
      expect(emit(scene, { credits: [] })).toBe(plain);
      expect(emit(scene, { credits: undefined })).toBe(plain);
      expect(plain).not.toContain("credits");
      expect(plain.split("\n")[1]).toMatch(/^import /);
    }
  });

  it.each(emitters)("%s: writes one // line for each credit under the generated line, and exports them as data", (_name, emit) => {
    const text = emit(fixtureScene("object-effects-ink"), { credits: real });
    const lines = text.split("\n");
    const header = lines.slice(1, lines.findIndex((line) => line.startsWith("import ")));
    expect(header).toHaveLength(real.length + 1);
    expect(header.every((line) => line.startsWith("//"))).toBe(true);
    expect(header[1]).toContain("catppuccin (look) ported:");
    expect(header[2]).toContain("crt (effect) ported:");
    for (const credit of real) {
      const line = header.find((candidate) => candidate.includes(`${credit.subject} (${credit.kind})`)) ?? "";
      for (const field of [credit.work, credit.source, credit.pin, credit.license, credit.credit]) expect(line).toContain(field);
    }
    expect(text).toContain("export const credits = [");
    expect(lines.filter((line) => line.startsWith("  { credit: ")).length).toBe(real.length);
    expect(text).toContain(`subject: ${JSON.stringify(real[1]?.subject)}`);
  });

  it.each(emitters)("%s: a line break, a separator or a */ in a credit cannot end the comment or start code", (_name, emit) => {
    for (const name of currentFixtures) {
      const text = emit(fixtureScene(name), { credits: [hostile] });
      const lines = text.split(new RegExp(`\r\n|[\n\r${LS}${PS}${NEL}]`));
      const firstImport = lines.findIndex((line) => line.startsWith("import "));
      expect(lines.slice(1, firstImport)).toHaveLength(2);
      expect(lines.slice(0, firstImport).every((line) => line.startsWith("//"))).toBe(true);
      expect(text).not.toContain("\nimport { pwn }");
      // What the credit said is data: one literal each, with its breaks escaped.
      expect(text).toContain(JSON.stringify(hostile.work));
    }
  });

  it("an emitted module's credits are the creditsFor of the scene, the same text in both emitters", () => {
    const scene = fixtureScene("object-effects-ink");
    const tsx = toTsx(scene, { credits: real });
    const vanilla = toVanilla(scene, { credits: real });
    const block = (text: string): string => text.slice(text.indexOf("export const credits = ["), text.indexOf("] as const;"));
    expect(block(tsx)).toBe(block(vanilla));
    expect(tsx.split("\n").slice(1, 4)).toEqual(vanilla.split("\n").slice(1, 4));
  });
});

describe("credited code is code, and its credits are the scene's", () => {
  const crt = assetCredit({ id: "crt", kind: "effect", origin: { vendor: "threeui", relation: "ported", path: "src/shaders/crt/crtShaders.ts" } });
  const resolve: Resolve = (kind, id) => {
    const credit = kind === "look" ? lookCredit(id) : kind === "effect" && id === "crt" ? crt : undefined;
    return credit === undefined ? {} : { credit };
  };
  const scene = sceneSchema.parse({ ...fixtureScene("object-effects-ink"), look: "catppuccin", effects: [{ id: "crt" }] });
  const [LS, PS] = [String.fromCharCode(0x2028), String.fromCharCode(0x2029)] as const;
  const hostile: Credit = {
    subject: "evil",
    kind: "effect",
    relation: "inspired",
    work: `A work\nexport const pwned = true;\r\n*/ ${LS} ${PS}`,
    source: "https://example.com/work",
    pin: "abc */ def /* ghi",
    license: "MIT",
    credit: "Someone\n// else",
    path: "src/work.ts",
  };
  const emitters = [
    ["toTsx", toTsx, "scene.tsx"],
    ["toVanilla", toVanilla, "scene.ts"],
  ] as const;

  /** The syntax diagnostics of a module as TypeScript transpiles it: a comment broken open or a literal broken shut shows here. */
  const diagnostics = (source: string, fileName: string): readonly string[] =>
    (ts.transpileModule(source, { fileName, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).diagnostics ?? []).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));

  /** The value of the module's `credits` export, read from the source and evaluated alone (the rest of the module needs the libraries), or undefined where there is none. */
  function creditsOf(source: string): unknown {
    const file = ts.createSourceFile("module.ts", source, ts.ScriptTarget.ES2023, true);
    for (const statement of file.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      const declaration = statement.declarationList.declarations.find((candidate) => candidate.name.getText(file) === "credits");
      if (declaration?.initializer === undefined) continue;
      const value = ts.isAsExpression(declaration.initializer) ? declaration.initializer.expression : declaration.initializer;
      const evaluated: unknown = runInNewContext(`(${value.getText(file)})`);
      return JSON.parse(JSON.stringify(evaluated));
    }
    return undefined;
  }

  it("has the credits of the scene to check: the CRT screen and the look", () => {
    expect(creditsFor(scene, resolve).map(({ subject }) => subject)).toEqual(["catppuccin", "crt"]);
  });

  it.each(emitters)("%s: the module transpiles with no diagnostics, and its credits export is what creditsFor gives", (_name, emit, fileName) => {
    const credits = creditsFor(scene, resolve);
    const text = emit(scene, { credits });
    expect(diagnostics(text, fileName)).toEqual([]);
    expect(creditsOf(text)).toEqual(JSON.parse(JSON.stringify(credits)));
  });

  it.each(emitters)("%s: a credit that tries to break out of its comment still transpiles clean, and comes back whole", (_name, emit, fileName) => {
    for (const name of currentFixtures) {
      const text = emit(fixtureScene(name), { credits: [hostile] });
      expect(diagnostics(text, fileName)).toEqual([]);
      expect(creditsOf(text)).toEqual([hostile]);
      expect(text).not.toMatch(/^export const pwned/m);
    }
  });

  it.each(emitters)("%s: with no credits there is no credits export, and it transpiles as it did", (_name, emit, fileName) => {
    for (const name of currentFixtures) {
      const text = emit(fixtureScene(name));
      expect(diagnostics(text, fileName)).toEqual([]);
      expect(creditsOf(text)).toBeUndefined();
    }
  });
});
