import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { currentFixtures, fixtureScene, fixtureText, scenes } from "./arbitrary.js";
import { toCanonicalJson } from "./emit/index.js";
import { parseScene } from "./schema.js";

/** The same value with every object's keys in the opposite order. */
function reversed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversed);
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reversed(item)]));
  return value;
}

const read = (value: unknown) => {
  const result = parseScene(value);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.scene;
};

describe("toCanonicalJson", () => {
  it.each(currentFixtures)("the %s fixture is written in canonical form", (name) => {
    expect(toCanonicalJson(fixtureScene(name))).toBe(fixtureText(name));
  });

  it("starts with the format's own keys, in their order, and ends with a newline", () => {
    const text = toCanonicalJson(fixtureScene("v1"));
    expect(text.startsWith('{\n  "format": "lts-scene",\n  "version": 2,\n  "look": "neutral",\n  "seed": 0,\n  "nodes": [\n')).toBe(true);
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("gives one text whatever order the keys came in", () => {
    fc.assert(
      fc.property(scenes, (scene) => {
        expect(toCanonicalJson(read(reversed(scene)))).toBe(toCanonicalJson(scene));
      }),
    );
  });

  it("writes parameters alphabetically and numeric lists on one line", () => {
    const text = toCanonicalJson(read({ ...fixtureScene("v1"), nodes: [], effects: [{ id: "dither", params: { zeta: 1, alpha: 2 } }] }));
    expect(text).toContain('"params": {\n        "alpha": 2,\n        "zeta": 1\n      }');
    expect(toCanonicalJson(fixtureScene("framed-solid-shader"))).toContain('"position": [0, 0, 0]');
  });

  it("writes numbers in their shortest form, negative zero as -0, and reads them back exactly", () => {
    const doc = fixtureScene("framed-solid-shader");
    const scene = read({ ...doc, nodes: [{ ...doc.nodes[0], position: [-0, 1e21, 5e-324], rotation: [0.1, 1 / 3, 100], scale: [1, 1, 1] }] });
    const text = toCanonicalJson(scene);
    expect(text).toContain('"position": [-0, 1e+21, 5e-324]');
    expect(text).toContain('"rotation": [0.1, 0.3333333333333333, 100]');
    expect(read(text)).toEqual(scene);
  });
});
