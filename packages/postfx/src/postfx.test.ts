import { createRegistry, registerManifest } from "@hedronite/lts-core";
import { contrastRatio, hedronite, neutral } from "@hedronite/lts-tokens";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { orderStack, screenEffectIds, screenEffectInfo, screenEffectSchemas } from "./effects.js";
import { texture } from "three/tsl";
import { Texture, Vector2 } from "three/webgpu";
import { floatUniform as uniform, grainNode, printNode, smokeNode, vec2Uniform, type PrintUniforms } from "./nodes.js";
import { inksFor, mixHex } from "./inks.js";
import { manifest } from "./manifest.js";
import { printSettings } from "./settings.js";

describe("inks", () => {
  it("gives the Hedronite look hedronite.com's lapis and copper", () => {
    const inks = inksFor(hedronite.scene);
    expect(inks.cool[1]).toBe("#3b5bd9");
    expect(inks.warm[1]).toBe("#c07b42");
    // Each ramp runs dark to light.
    for (const ramp of [inks.cool, inks.warm]) {
      expect(contrastRatio(ramp[0], "#000000")).toBeLessThan(contrastRatio(ramp[1], "#000000"));
      expect(contrastRatio(ramp[1], "#000000")).toBeLessThan(contrastRatio(ramp[2], "#000000"));
    }
  });

  it("prints in one ink when asked", () => {
    const inks = inksFor(neutral.scene, { monochrome: "#22c55e" });
    expect(inks.cool).toEqual(inks.warm);
    expect(inks.cool[1]).toBe("#22c55e");
    expect(inks.chroma).toBe(0);
    expect(inksFor(neutral.scene).chroma).toBeGreaterThan(0);
  });

  it("mixes in sRGB", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#3b5bd9", "#3b5bd9", 0.3)).toBe("#3b5bd9");
  });
});

describe("stacks", () => {
  it("run smoke behind, prints in the middle and grain on top, each once", () => {
    const ordered = orderStack([{ id: "grain" }, { id: "lens" }, { id: "smoke" }, { id: "dither", params: { cell: 4 } }, { id: "dither" }]);
    expect(ordered.map((e) => e.id)).toEqual(["smoke", "dither", "lens", "grain"]);
    expect(ordered[1]).toEqual({ id: "dither", params: { cell: 4 } });
  });

  it("know every effect", () => {
    expect([...screenEffectIds].sort()).toEqual(Object.keys(screenEffectSchemas).sort());
    expect(Object.keys(screenEffectInfo).sort()).toEqual([...screenEffectIds].sort());
  });
});

describe("print settings", () => {
  it("prints dither or ASCII everywhere", () => {
    expect(printSettings({ id: "dither", params: { cell: 5 } }, false).values).toMatchObject({ uBase: 1, uDitherPx: 5 });
    const ascii = printSettings({ id: "ascii", params: { ramp: " .oO@" } }, false);
    expect([ascii.values.uBase, ascii.ramp]).toEqual([2, " .oO@"]);
  });

  it("sweeps, unless motion is reduced", () => {
    expect(printSettings({ id: "scan", params: { period: 4 } }, false).scan).toEqual({ period: 4, sweep: 1.8 });
    expect(printSettings({ id: "scan" }, true).scan).toBeUndefined();
  });

  it("starts the crystallize intro fully printed and settles to the clean render", () => {
    const moving = printSettings({ id: "crystallize" }, false);
    expect([moving.values.uIntro, moving.values.uAppear, moving.intro]).toEqual([0, 0, 3.5]);
    const still = printSettings({ id: "crystallize" }, true);
    expect([still.values.uIntro, still.values.uAppear, still.intro]).toEqual([1, 1, undefined]);
  });

  it("follows the pointer only for the lens", () => {
    expect(printSettings({ id: "lens", params: { radius: 80 } }, false)).toMatchObject({ lens: true, values: { uLensRadius: 80 } });
    expect(printSettings({ id: "dither" }, false).lens).toBe(false);
    expect(() => printSettings({ id: "grain" }, false)).toThrow();
  });

  it("validates parameters where they enter", () => {
    expect(() => printSettings({ id: "dither", params: { cell: 99 } }, false)).toThrow(z.ZodError);
    expect(() => printSettings({ id: "ascii", params: { ramp: "x" } }, false)).toThrow(z.ZodError);
    expect(() => printSettings({ id: "ascii", params: { ramp: " ░▒▓█" } }, false)).toThrow(z.ZodError);
  });
});

describe("node graphs", () => {
  const input = texture(new Texture());
  const u: PrintUniforms = {
    time: uniform(0),
    dpr: uniform(1),
    base: uniform(1),
    intro: uniform(1),
    appear: uniform(1),
    scan: uniform(-1),
    scanDepth: uniform(2),
    lens: uniform(0),
    lensRadius: uniform(118),
    lensDepth: uniform(1),
    grain: uniform(0.07),
    ditherPx: uniform(3),
    asciiPx: uniform(11),
    mouse: vec2Uniform(new Vector2(-10, -10)),
  };

  it("build for the print, grain and smoke passes without a GPU", () => {
    for (const node of [printNode(input, u, inksFor(hedronite.scene), new Texture(), 14), grainNode(input, uniform(0), 0.06), smokeNode(input, uniform(0), inksFor(hedronite.scene), 1)]) {
      expect(node.isNode).toBe(true);
    }
  });
});

it("registers one effect asset per screen effect", () => {
  const registry = createRegistry();
  registerManifest(registry, manifest);
  expect(registry.list({ kind: "effect" }).map((a) => a.id)).toEqual([...screenEffectIds].sort());
});
