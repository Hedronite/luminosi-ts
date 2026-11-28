import { lookCredits, vendorCredits, type Credit } from "@hedronite/lts-core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { scenes } from "./arbitrary.js";
import { assetCredit, creditsFor, lookCredit } from "./credits.js";
import type { RefKind, Resolve } from "./refs.js";
import { sceneSchema, type Scene, type SceneNode } from "./schema.js";

const crtOrigin = { vendor: "threeui", relation: "ported", path: "src/shaders/crt/crtShaders.ts" } as const;
const crt = assetCredit({ id: "crt", kind: "effect", origin: crtOrigin });
const catppuccin = lookCredit("catppuccin");

/** A resolver that knows every id, takes any parameters, and credits the refs it is told to. */
const crediting = (credits: Readonly<Record<string, Credit>>): Resolve => {
  return (kind: RefKind, id: string) => {
    const credit = credits[`${kind}/${id}`];
    return credit === undefined ? {} : { credit };
  };
};

const node = (id: string, extra: Partial<SceneNode> = {}): SceneNode => ({ id, parent: null, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], asset: { kind: "primitive", id: "platonic-cube" }, surface: { material: "metal" }, ...extra });

const sceneOf = (extra: Partial<Scene> = {}): Scene =>
  sceneSchema.parse({ format: "lts-scene", version: 2, tracks: [], clips: [], rest: {}, look: "neutral", seed: 0, nodes: [node("a")], lights: { rig: "studio", intensity: 1 }, environment: { kind: "studio" }, camera: { position: [0, 2, 5], target: [0, 0, 0], fov: 40 }, effects: [], ink: "look", ...extra });

const made = (subject: string, kind: Credit["kind"]): Credit => ({ subject, kind, relation: "adopted", work: `Work of ${subject}`, source: "https://example.com/work", pin: "abc123", license: "MIT", credit: "Someone", path: "src/work.ts" });

describe("a credit for an asset or a look", () => {
  it("is built from the origin and the vendor's credit: how it stands to the work, where in it, and what the work is", () => {
    expect(crt).toEqual({ ...vendorCredits["threeui"], subject: "crt", kind: "effect", relation: "ported", path: "src/shaders/crt/crtShaders.ts" });
  });

  it("is none for an asset with no origin, and for a vendor with no credit", () => {
    expect(assetCredit({ id: "grain", kind: "effect" })).toBeUndefined();
    expect(assetCredit({ id: "x", kind: "effect", origin: { ...crtOrigin, vendor: "no-such-vendor" } })).toBeUndefined();
  });

  it("is never read off a table's prototype: a vendor or a look named like one of its properties has none", () => {
    for (const name of ["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf"]) {
      expect(assetCredit({ id: "x", kind: "effect", origin: { ...crtOrigin, vendor: name } })).toBeUndefined();
      expect(lookCredit(name)).toBeUndefined();
    }
  });

  it("is a look's own entry, and none for a look of ours", () => {
    expect(catppuccin).toEqual(lookCredits["catppuccin"]);
    expect(lookCredit("neutral")).toBeUndefined();
  });
});

describe("creditsFor", () => {
  it("gives the credit of a credited effect and a credited look, sorted by subject", () => {
    if (crt === undefined || catppuccin === undefined) throw new Error("no credit for crt or catppuccin");
    const resolve = crediting({ "effect/crt": crt, "look/catppuccin": catppuccin });
    const found = creditsFor(sceneOf({ look: "catppuccin", effects: [{ id: "grain" }, { id: "crt" }] }), resolve);
    expect(found.map(({ subject }) => subject)).toEqual(["catppuccin", "crt"]);
    expect(found).toEqual([catppuccin, crt]);
  });

  it("gives none for an uncredited scene, for a look written out, and for a credited thing the scene does not use", () => {
    if (crt === undefined) throw new Error("no credit for crt");
    const resolve = crediting({ "effect/crt": crt, "look/catppuccin": made("catppuccin", "look") });
    expect(creditsFor(sceneOf(), resolve)).toEqual([]);
    expect(creditsFor(sceneOf({ look: { base: "#101010", accent: "#ff0000", metal: "#cccccc", glass: "#88aacc", emissive: "#ffee00" } }), resolve)).toEqual([]);
    expect(creditsFor(sceneOf({ effects: [{ id: "grain" }] }), resolve)).toEqual([]);
  });

  it("names each credited thing once, however many times the scene uses it", () => {
    const resolve = crediting({ "material/glass": made("glass", "material") });
    const nodes = [node("a", { surface: { material: "glass" } }), node("b", { surface: { material: "glass" } }), node("c", { surface: { material: "glass" } })];
    expect(creditsFor(sceneOf({ nodes }), resolve).map(({ subject }) => subject)).toEqual(["glass"]);
  });

  it("looks in every place a scene uses something: look, asset, object, framed edges, surface material, surface shader, effect", () => {
    const table = {
      "look/neutral": made("neutral-look", "look"),
      "primitive/platonic-cube": made("platonic-cube", "primitive"),
      "object/dress-watch": made("dress-watch", "object"),
      "material/ceramic": made("ceramic", "material"),
      "material/glass": made("glass", "material"),
      "shader/toon": made("toon", "shader"),
      "effect/dither": made("dither", "effect"),
    };
    const nodes: SceneNode[] = [
      node("a", { surface: { material: "glass" } }),
      node("b", { asset: { kind: "object", id: "dress-watch" } }),
      node("c", { asset: { kind: "framed", id: "platonic-cube", edges: { material: "ceramic" } }, surface: { shader: "toon" } }),
    ];
    const found = creditsFor(sceneOf({ nodes, effects: [{ id: "dither" }] }), crediting(table));
    expect(found.map(({ subject }) => subject)).toEqual(["ceramic", "dither", "dress-watch", "glass", "neutral-look", "platonic-cube", "toon"]);
  });

  it("is sorted and has one credit for each thing the scene uses, for any scene", () => {
    fc.assert(
      fc.property(scenes, (scene) => {
        const all: Resolve = (kind, id) => ({ credit: made(`${kind}-${id}`, kind === "look" ? "look" : kind === "finish" ? "material" : kind) });
        const found = creditsFor(scene, all);
        const subjects = found.map(({ subject }) => subject);
        expect(subjects).toEqual([...subjects].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
        expect(new Set(subjects).size).toBe(subjects.length);
        // The refs the scene makes, counted again here, one credit each.
        const refs = new Set<string>(typeof scene.look === "string" ? [`look/${scene.look}`] : []);
        for (const { asset, surface } of scene.nodes) {
          refs.add(`${asset.kind === "object" ? "object" : "primitive"}/${asset.id}`);
          if (asset.kind === "framed") refs.add(`material/${asset.edges.material}`);
          if (surface !== undefined) refs.add("material" in surface ? `material/${surface.material}` : `shader/${surface.shader}`);
        }
        for (const effect of scene.effects) refs.add(`effect/${effect.id}`);
        expect(found).toHaveLength(refs.size);
      }),
      { numRuns: 100 },
    );
  });
});
