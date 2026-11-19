/// <reference types="node" />
import { existsSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { acceptAll, currentFixtures, fixtureScene, fixtureText, sceneOf, scenes } from "./arbitrary.js";
import { toCanonicalJson } from "./emit/index.js";
import { ringLayout } from "./layout.js";
import { migrate } from "./migrate.js";
import { checkRefs } from "./refs.js";
import { SCENE_VERSION } from "./schema.js";

const word = fc.constantFrom("platonic-cube", "platonic-octahedron", "archimedean-cuboctahedron");
const material = fc.constantFrom("metal", "glass", "satin");
const placement = fc.oneof(
  fc.record({ kind: fc.constant("primitive"), primitive: word, material }),
  fc.record({ kind: fc.constant("primitive"), primitive: word, material, shader: fc.constantFrom("toon", "hologram") }),
  fc.record({ kind: fc.constant("framed"), primitive: word, faces: material, edges: material }),
  fc.record({ kind: fc.constant("framed"), primitive: word, faces: material, edges: material, shader: fc.constantFrom("toon", "pulse") }),
  fc.record({ kind: fc.constant("object"), object: fc.constantFrom("dress-watch", "your-desk-lamp") }),
  fc.record({ kind: fc.constant("object"), object: fc.constant("crystal-cluster"), material }),
);
const version0 = fc.record({ lightIntensity: fc.double({ min: 0.2, max: 2.5, noNaN: true }), placements: fc.array(placement, { maxLength: 8 }) }, { requiredKeys: ["lightIntensity", "placements"] }).chain((base) =>
  fc.oneof(fc.constant(base), fc.record({ effects: fc.subarray(["dither", "grain", "smoke"]), ink: fc.constantFrom("look", "accent", "emissive", "glass") }).map((extra) => ({ ...base, ...extra }))),
);

describe("migrate", () => {
  it("has a fixture for every version, and each reaches the current one", () => {
    for (let version = 0; version <= SCENE_VERSION; version += 1) {
      expect(existsSync(new URL(`../fixtures/v${String(version)}.json`, import.meta.url)), `fixtures/v${String(version)}.json`).toBe(true);
      expect(toCanonicalJson(sceneOf(migrate(fixtureText(`v${String(version)}`))))).toBe(fixtureText(`v${String(SCENE_VERSION)}`));
    }
  });

  it("makes the playground's ring explicit: positions from ringLayout, scales as the playground drew them", () => {
    const result = migrate(fixtureText("v0"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ring = ringLayout(5);
    expect(result.scene.nodes.map((node) => node.position)).toEqual(ring);
    expect(result.scene.nodes.map((node) => node.scale[0])).toEqual([0.5, 0.5, 0.5, 0.6, 0.6]);
    expect(result.scene.nodes.map((node) => node.id)).toEqual(["node-1", "node-2", "node-3", "node-4", "node-5"]);
    expect(result.scene.effects).toEqual([{ id: "dither" }, { id: "grain" }]);
    expect(result.scene).toMatchObject({ ink: "accent", lights: { rig: "studio", intensity: 1.2 }, look: "neutral", seed: 0 });
  });

  it("maps a version 0 placement onto the framed and surface shapes", () => {
    const result = migrate(fixtureText("v0"));
    if (!result.ok) throw new Error("v0 fixture does not migrate");
    expect(result.scene.nodes[1]).toMatchObject({ asset: { kind: "primitive", id: "platonic-octahedron" }, surface: { shader: "toon" } });
    expect(result.scene.nodes[2]).toMatchObject({ asset: { kind: "framed", id: "archimedean-cuboctahedron", edges: { material: "metal" } }, surface: { material: "glass" } });
    expect(result.scene.nodes[3]).toMatchObject({ asset: { kind: "object", id: "crystal-cluster", params: { material: "glass" } } });
    expect(result.scene.nodes[4]).not.toHaveProperty("surface");
  });

  it("brings any version 0 document to a valid one, with unique ids and no cycle", () => {
    fc.assert(
      fc.property(version0, (old) => {
        const result = migrate(old);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.scene.nodes).toHaveLength(old.placements.length);
        expect(checkRefs(result.scene, acceptAll(result.scene))).toEqual([]);
        expect(result.scene.lights.intensity).toBe(old.lightIntensity);
      }),
    );
  });

  it("is idempotent: a current document is returned as it is, and migrating twice is migrating once", () => {
    fc.assert(
      fc.property(scenes, (scene) => {
        const once = migrate(scene);
        expect(once).toEqual({ ok: true, scene });
        expect(migrate(toCanonicalJson(scene))).toEqual(once);
      }),
    );
    fc.assert(
      fc.property(version0, (old) => {
        const once = migrate(old);
        expect(migrate(sceneOf(once))).toEqual(once);
      }),
    );
  });

  it.each(currentFixtures)("leaves the %s fixture as it is", (name) => {
    expect(migrate(fixtureText(name))).toEqual({ ok: true, scene: fixtureScene(name) });
  });

  it("names a version it does not know, a document of no version it can read, and bad version 0 fields", () => {
    expect(migrate({ ...fixtureScene("v1"), version: SCENE_VERSION + 1 })).toMatchObject({ ok: false, issues: [{ path: ["version"], code: "unsupported-version" }] });
    expect(migrate({ format: "other", version: 1 })).toMatchObject({ ok: false, issues: [{ path: ["format"], code: "wrong-format" }] });
    expect(migrate("{")).toMatchObject({ ok: false, issues: [{ code: "invalid-json" }] });
    const bad = migrate({ lightIntensity: "bright", placements: [{ kind: "primitive", primitive: "platonic-cube" }], effects: "dither" });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const paths = bad.issues.map((issue) => issue.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["lightIntensity", "placements.0.material", "effects"]));
  });

  it("never throws", () => {
    fc.assert(
      fc.property(fc.oneof(fc.anything(), fc.jsonValue(), fc.string()), (input) => {
        expect(typeof migrate(input).ok).toBe("boolean");
      }),
    );
  });
});
