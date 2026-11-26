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

  it("rejects anything but a number where a number goes, and a parameter that is not JSON", () => {
    const doc = fixtureScene("transform-hierarchy");
    const node = doc.nodes[1] ?? doc.nodes[0];
    if (node === undefined) throw new Error("fixture has no node");
    const notNumbers = fc.oneof(fc.string(), fc.boolean(), fc.constant(null), fc.constant(Number.NaN), fc.constant(Number.POSITIVE_INFINITY), fc.constant(Number.NEGATIVE_INFINITY), fc.array(fc.nat(), { maxLength: 2 }), fc.record({ a: fc.nat() }));
    fc.assert(
      fc.property(notNumbers, fc.constantFrom("position", "rotation", "scale"), fc.nat(2), (value, field, at) => {
        const part: unknown[] = [...node[field]];
        part[at] = value;
        const result = parseScene({ ...doc, nodes: [{ ...node, [field]: part }] });
        expect(result.ok).toBe(false);
        expect(!result.ok && result.issues.some((issue) => issue.path.join(".").startsWith(`nodes.0.${field}`))).toBe(true);
      }),
    );
    expect(parseScene({ ...doc, camera: { ...doc.camera, fov: Number.NaN } }).ok).toBe(false);
    expect(parseScene({ ...doc, nodes: [{ ...node, asset: { kind: "primitive", id: "platonic-cube", params: { scale: Number.NaN } } }] }).ok).toBe(false);
    expect(parseScene({ ...doc, nodes: [{ ...node, asset: { kind: "primitive", id: "platonic-cube", params: { scale: undefined } } }] }).ok).toBe(false);
  });

  it("names every issue in this package's words, never the schema library's", () => {
    fc.assert(
      fc.property(fc.oneof(fc.anything(), fc.jsonValue()), (input) => {
        const result = parseScene(input);
        expect(result.ok || result.issues.every((issue) => /^[a-z]+(-[a-z]+)*$/.test(issue.code))).toBe(true);
      }),
    );
    const doc = fixtureScene("v1");
    const result = parseScene({ ...doc, seed: "zero", ink: "neon", camera: { ...doc.camera, fov: 500 }, nodes: [{ id: "a" }] });
    expect(result.ok ? [] : result.issues.map((issue) => `${issue.code}@${issue.path.join(".")}`)).toEqual(expect.arrayContaining(["wrong-type@seed", "wrong-value@ink", "out-of-range@camera.fov", "missing-field@nodes.0.parent"]));
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

  it("supports environment kinds, intensity, rotation, and credited CC0 HDRI while defaulting omitted/empty environment to studio", () => {
    const doc = fixtureScene("v2");
    const omitted = Object.fromEntries(Object.entries(doc).filter(([k]) => k !== "environment"));
    expect(parseScene(omitted)).toMatchObject({ ok: true, scene: { environment: { kind: "studio" } } });
    expect(parseScene({ ...doc, environment: {} })).toMatchObject({ ok: true, scene: { environment: { kind: "studio" } } });

    const hdri = { url: "https://example.com/room.hdr", license: "CC0-1.0", credit: "Poly Haven" } as const;
    for (const kind of ["studio", "gallery", "dusk", "noir"] as const) {
      expect(parseScene({ ...doc, environment: { kind, intensity: 1.5, rotation: 0.75, hdri } })).toEqual({
        ok: true,
        scene: { ...doc, environment: { kind, intensity: 1.5, rotation: 0.75, hdri } },
      });
    }
    expect(parseScene({ ...doc, environment: { kind: "dusk", hdri: { url: "/envs/dusk.hdr", license: "CC0-1.0", credit: "Studio" } } }).ok).toBe(true);
    expect(parseScene({ ...doc, environment: { kind: "noir", hdri: { url: "data:application/octet-stream;base64,AA==", license: "CC0-1.0", credit: "Inline" } } }).ok).toBe(true);
    expect(parseScene({ ...doc, environment: { kind: "studio", hdri: { ...hdri, url: "javascript:alert(1)" } } }).ok).toBe(false);
    expect(parseScene({ ...doc, environment: { kind: "studio", hdri: { ...hdri, url: "//evil/room.hdr" } } }).ok).toBe(false);
    // Plaintext is refused, and so is any backslash in a root-relative path: a browser reads `/\host` as `//host`.
    for (const url of ["http://example.com/room.hdr", "HTTP://example.com/room.hdr", "/\\evil/room.hdr", "/envs\\room.hdr"]) {
      expect([url, parseScene({ ...doc, environment: { kind: "studio", hdri: { ...hdri, url } } }).ok]).toEqual([url, false]);
    }
    expect(parseScene({ ...doc, environment: { kind: "studio", hdri: { ...hdri, credit: "   " } } }).ok).toBe(false);
    expect(parseScene({ ...doc, environment: { kind: "studio", hdri: { ...hdri, credit: "  Poly Haven  " } } })).toMatchObject({ ok: true, scene: { environment: { hdri: { credit: "Poly Haven" } } } });
    expect(parseScene({ ...doc, environment: { kind: "studio", hdri: { ...hdri, license: "MIT" } } }).ok).toBe(false);
    expect(parseScene({ ...doc, environment: { kind: "studio", hdri: { ...hdri, credit: "" } } }).ok).toBe(false);
    expect(parseScene({ ...doc, environment: { kind: "studio", intensity: 11 } }).ok).toBe(false);
    expect(parseScene({ ...doc, environment: { kind: "outdoor" } }).ok).toBe(false);
  });
});
