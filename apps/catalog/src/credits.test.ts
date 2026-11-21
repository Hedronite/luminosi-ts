import { assetCredit, creditsFor, lookCredit, type Resolve, type Scene } from "@hedronite/lts-scene";
import { toTsx, toVanilla } from "@hedronite/lts-scene/emit";
import { loadDescriptors } from "@hedronite/lts-registry";
import { describe, expect, it } from "vitest";
import { creditsOf } from "./credits";

const scene = (change: Partial<Scene>): Scene => ({
  format: "lts-scene",
  version: 1,
  look: "neutral",
  seed: 0,
  nodes: [{ id: "node-1", parent: null, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], asset: { kind: "primitive", id: "platonic-cube" }, surface: { material: "satin" } }],
  lights: { rig: "studio", intensity: 1 },
  environment: { kind: "studio" },
  camera: { position: [0, 2.2, 5.5], target: [0, 0, 0], fov: 40 },
  effects: [],
  ink: "look",
  ...change,
});

/** A scene that uses three credited things: the tokyo-night look, the soap-film shader and the crt screen effect. */
const credited = scene({
  look: "tokyo-night",
  nodes: [{ id: "node-1", parent: null, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], asset: { kind: "primitive", id: "platonic-cube" }, surface: { shader: "soap-film" } }],
  effects: [{ id: "crt" }],
});

describe("creditsOf, the Playground's credits", () => {
  it("lists the work of others a scene uses, sorted by subject, each with its source and license", () => {
    const credits = creditsOf(credited);
    expect(credits.map((credit) => credit.subject)).toEqual(["crt", "soap-film", "tokyo-night"]);
    expect(credits.map((credit) => credit.kind)).toEqual(["effect", "shader", "look"]);
    for (const credit of credits) {
      expect(credit.source).toMatch(/^https:\/\//);
      expect(credit.license.length).toBeGreaterThan(0);
    }
  });

  it("is what the command line reads from the descriptors: the same credits for the same scene", async () => {
    const descriptors = await loadDescriptors();
    const viaDescriptors: Resolve = (kind, id) => {
      if (kind === "look") {
        const credit = lookCredit(id);
        return credit === undefined ? {} : { credit };
      }
      const descriptor = descriptors.get(id);
      if (descriptor?.meta.kind !== kind) return undefined;
      const credit = assetCredit(descriptor.meta);
      return credit === undefined ? {} : { credit };
    };
    expect(creditsOf(credited)).toEqual(creditsFor(credited, viaDescriptors));
  });

  it("has none for a scene that uses only our own work, so its code has no header", () => {
    const own = scene({});
    expect(creditsOf(own)).toEqual([]);
    expect(toTsx(own, { credits: creditsOf(own) })).toBe(toTsx(own));
    expect(toVanilla(own, { credits: creditsOf(own) })).toBe(toVanilla(own));
  });

  it("puts the credits in the code the Playground shows", () => {
    for (const code of [toTsx(credited, { credits: creditsOf(credited) }), toVanilla(credited, { credits: creditsOf(credited) })]) {
      expect(code).toContain("// This scene uses the work of others, credited here:");
      expect(code).toContain("// - soap-film (shader)");
      expect(code).toContain("export const credits = [");
    }
  });

  it("finds nothing under a name Object.prototype has", () => {
    expect(creditsOf(scene({ look: "__proto__", nodes: [{ id: "node-1", parent: null, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], asset: { kind: "primitive", id: "constructor" }, surface: { material: "toString" } }] }))).toEqual([]);
  });
});
