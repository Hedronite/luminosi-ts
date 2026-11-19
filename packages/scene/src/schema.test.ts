import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { currentFixtures, fixtureScene, fixtureText, scenes } from "./arbitrary.js";
import { toCanonicalJson } from "./emit/index.js";
import { parseScene, SCENE_VERSION } from "./schema.js";

describe("parseScene", () => {
  it.each(currentFixtures)("reads the %s fixture, from text and from a value", (name) => {
    const text = parseScene(fixtureText(name));
    expect(text.ok).toBe(true);
    expect(parseScene(fixtureScene(name))).toEqual(text);
  });

  it("never throws, whatever it is given", () => {
    fc.assert(
      fc.property(fc.oneof(fc.anything(), fc.jsonValue(), fc.string(), fc.json()), (input) => {
        const result = parseScene(input);
        expect(result.ok || result.issues.length > 0).toBe(true);
      }),
    );
  });

  it("names text that is not JSON", () => {
    expect(parseScene("{")).toMatchObject({ ok: false, issues: [{ path: [], code: "invalid-json" }] });
  });

  it("names another format and another version, and does not guess at them", () => {
    const doc = fixtureScene("v1");
    expect(parseScene({ ...doc, format: "other" })).toMatchObject({ ok: false, issues: [{ path: ["format"], code: "wrong-format" }] });
    expect(parseScene({ ...doc, version: SCENE_VERSION + 1 })).toMatchObject({ ok: false, issues: [{ path: ["version"], code: "unsupported-version" }] });
    expect(parseScene(fixtureText("v0"))).toMatchObject({ ok: false, issues: [{ path: ["format"], code: "wrong-format" }] });
  });

  it("puts every problem at its own path", () => {
    const doc = fixtureScene("framed-solid-shader");
    const result = parseScene({
      ...doc,
      seed: -1,
      lights: { ...doc.lights, intensity: 11, extra: true },
      camera: { ...doc.camera, fov: 0 },
      nodes: [{ ...doc.nodes[0], position: [0, 0], asset: { kind: "framed", id: "Not A Slug", edges: { material: "metal" } }, surface: { material: "metal", shader: "toon" } }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const paths = result.issues.map((issue) => issue.path.join("."));
    for (const path of ["seed", "lights.intensity", "lights.extra", "camera.fov", "nodes.0.position", "nodes.0.asset.id", "nodes.0.surface"]) expect(paths).toContain(path);
    expect(result.issues.find((issue) => issue.path.join(".") === "lights.extra")?.code).toBe("unknown-key");
  });

  it("allows edges only on a framed solid, and requires it there", () => {
    const doc = fixtureScene("framed-solid-shader");
    const asOf = (asset: unknown): unknown => ({ ...doc, nodes: [{ ...doc.nodes[0], asset }] });
    expect(parseScene(asOf({ kind: "primitive", id: "platonic-cube", edges: { material: "metal" } })).ok).toBe(false);
    expect(parseScene(asOf({ kind: "object", id: "framed-solid", edges: { material: "metal" } })).ok).toBe(false);
    expect(parseScene(asOf({ kind: "framed", id: "platonic-cube" })).ok).toBe(false);
    expect(parseScene(asOf({ kind: "framed", id: "platonic-cube", edges: { material: "metal" } })).ok).toBe(true);
    expect(parseScene(asOf({ kind: "object", id: "framed-solid", params: { solid: "dodecahedron" } })).ok).toBe(true);
  });

  it("rejects a color that is not #rrggbb, and a surface with both a material and a shader", () => {
    const doc = fixtureScene("v1");
    expect(parseScene({ ...doc, look: { base: "#fff", accent: "#000000", metal: "#000000", glass: "#000000", emissive: "#000000" } }).ok).toBe(false);
    expect(parseScene({ ...doc, nodes: [{ ...doc.nodes[0], surface: { material: "metal", shader: "toon" } }] }).ok).toBe(false);
  });

  it("round-trips: the canonical text of any valid document reads back as that document", () => {
    fc.assert(
      fc.property(scenes, (scene) => {
        expect(parseScene(scene)).toEqual({ ok: true, scene });
        expect(parseScene(toCanonicalJson(scene))).toEqual({ ok: true, scene });
      }),
    );
  });
});
