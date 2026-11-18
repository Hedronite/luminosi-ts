import { createRegistry, registerManifest } from "@hedronite/lts-core";
import { contrastRatio, hedronite, neutral } from "@hedronite/lts-tokens";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { orderStack, screenEffectIds, screenEffectInfo, screenEffectSchemas } from "./effects.js";
import { texture } from "three/tsl";
import { PerspectiveCamera, Scene, Texture, Vector2, WebGPURenderer } from "three/webgpu";
import { crtNode, floatUniform as uniform, grainNode, inkUniforms, printNode, smokeField, smokeNode, vec2Uniform, writeInks, type PrintUniforms } from "./nodes.js";
import { inksFor, mixHex } from "./inks.js";
import { manifest } from "./manifest.js";
import { mergePrintSettings, printGroups, printSettings, resolveValues } from "./settings.js";
import { ScreenEffects, stackStructure, stackValues } from "./three.js";

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

  it("build for the print, grain, smoke and CRT passes without a GPU", () => {
    const inks = inkUniforms(inksFor(hedronite.scene));
    const crt = crtNode(input, uniform(0), uniform(2), inks, { curvature: uniform(1), pitch: uniform(2), aberration: uniform(1), motion: uniform(1) });
    const field = smokeField(uniform(0), inks, uniform(1));
    for (const node of [printNode(input, u, inks, new Texture(), 14), grainNode(input, uniform(0), uniform(0.06)), smokeNode(input, field), crt]) {
      expect(node.isNode).toBe(true);
    }
  });

  it("write the inks into the uniforms the passes read", () => {
    const inks = inkUniforms(inksFor(neutral.scene));
    const [before] = inks.cool;
    const was = before.value.clone();
    writeInks(inks, inksFor(hedronite.scene));
    expect(inks.cool[0]).toBe(before);
    expect(before.value.equals(was)).toBe(false);
    writeInks(inks, inksFor(neutral.scene, { monochrome: "#22c55e" }));
    expect(inks.chroma.value).toBe(0);
    expect(inks.cool[1].value.equals(inks.warm[1].value)).toBe(true);
  });
});

describe("one print pass", () => {
  const groups = (stack: Parameters<typeof orderStack>[0]) => printGroups(orderStack(stack).map((e) => e.id));
  const merge = (stack: Parameters<typeof orderStack>[0], reduced = false) => {
    const ids = orderStack(stack).map((e) => e.id);
    const [members] = printGroups(ids);
    if (members === undefined) throw new Error("no print effects");
    return mergePrintSettings(resolveValues(stack), members, reduced);
  };

  it("takes every print effect in one pass, in the order they run", () => {
    expect(groups([{ id: "lens" }, { id: "scan" }, { id: "crystallize" }, { id: "crt" }])).toEqual([["crystallize", "scan", "lens"]]);
    expect(groups([{ id: "smoke" }, { id: "grain" }])).toEqual([]);
  });

  it("keeps a second pass only when dither and ASCII both print the whole frame", () => {
    expect(groups([{ id: "dither" }, { id: "scan" }, { id: "lens" }])).toEqual([["dither", "scan", "lens"]]);
    expect(groups([{ id: "ascii" }, { id: "scan" }])).toEqual([["ascii", "scan"]]);
    expect(groups([{ id: "lens" }, { id: "ascii" }, { id: "crystallize" }, { id: "dither" }, { id: "scan" }])).toEqual([
      ["crystallize", "dither"],
      ["ascii", "scan", "lens"],
    ]);
  });

  it("merges each setting from the effect that owns it, and prints the highest level asked for", () => {
    const merged = merge([{ id: "crystallize" }, { id: "dither", params: { cell: 5, grain: 0.2 } }, { id: "scan", params: { period: 4, depth: 1 } }, { id: "lens", params: { radius: 80, depth: 2 } }]);
    expect(merged.values).toMatchObject({ uBase: 1, uIntro: 0, uAppear: 0, uDitherPx: 5, uGrain: 0.2, uScanDepth: 1, uLensRadius: 80, uLensDepth: 2 });
    // The scan's own timing wins over the crystallize's, and the intro is the crystallize's.
    expect([merged.intro, merged.scan, merged.lens]).toEqual([3.5, { period: 4, sweep: 1.8 }, true]);
    const ascii = merge([{ id: "ascii", params: { cell: 9, ramp: " .oO@", grain: 0.1 } }, { id: "lens" }]);
    expect([ascii.values.uBase, ascii.values.uAsciiPx, ascii.values.uGrain, ascii.ramp, ascii.lens]).toEqual([2, 9, 0.1, " .oO@", true]);
  });

  it("keeps the sweep of crystallize when no scan is stacked, and none under reduced motion", () => {
    expect(merge([{ id: "crystallize", params: { period: 6 } }]).scan).toEqual({ period: 6, sweep: 1.8 });
    const still = merge([{ id: "crystallize" }, { id: "scan" }, { id: "lens" }], true);
    expect([still.intro, still.scan, still.values.uIntro]).toEqual([undefined, undefined, 1]);
  });
});

describe("screen effects", () => {
  // Nothing here draws, and a real renderer needs a DOM: this one is only asked for its pixel ratio while the passes are built.
  const renderer = ((): WebGPURenderer => {
    const stub: unknown = Object.create(WebGPURenderer.prototype);
    if (!(stub instanceof WebGPURenderer)) throw new Error("no renderer");
    stub.getPixelRatio = () => 2;
    return stub;
  })();
  const build = (stack: Parameters<typeof orderStack>[0], options: { reducedMotion?: boolean } = {}) => new ScreenEffects(renderer, new Scene(), new PerspectiveCamera(), stack, options);

  it("runs scan, lens and crystallize as one print pass", () => {
    const stack = [{ id: "scan" }, { id: "lens" }, { id: "crystallize" }] as const;
    const runner = build(stack);
    expect(runner.passes).toEqual(["print"]);
    // Each effect used to be a pass over the one before, and each pass after the first read a target of its own.
    expect(runner["targets"]).toHaveLength(0);
    runner.dispose();
  });

  it("gives smoke a half-size target of its own and the rest of the stack the targets between its passes", () => {
    const runner = build([{ id: "smoke" }, { id: "dither" }, { id: "ascii" }, { id: "scan" }, { id: "crt" }, { id: "grain" }]);
    expect(runner.passes).toEqual(["smoke", "print", "print", "crt", "grain"]);
    // The smoke field, plus the output of the passes that something reads: smoke, both prints, the tube.
    expect(runner["targets"]).toHaveLength(5);
    runner.dispose();
  });

  it("writes parameters into the uniforms without rebuilding the pipeline", () => {
    const runner = build([{ id: "scan" }, { id: "lens" }, { id: "dither" }, { id: "smoke" }, { id: "crt" }, { id: "grain" }]);
    const pipeline = runner.pipeline;
    // A new graph would ask the pipeline to compile again.
    const flag = pipeline.needsUpdate;
    const u = runner["prints"][0]?.uniforms;
    if (u === undefined) throw new Error("no print pass");
    expect([u.lensRadius.value, u.ditherPx.value, u.scanDepth.value]).toEqual([118, 3, 2]);
    runner.setParams({ lens: { radius: 60 }, dither: { cell: 6 }, scan: { depth: 1 }, smoke: { intensity: 2 }, crt: { curvature: 0.5 }, grain: { amount: 0.2 } });
    expect([u.lensRadius.value, u.ditherPx.value, u.scanDepth.value]).toEqual([60, 6, 1]);
    expect([runner["smokeIntensity"].value, runner["crt"].curvature.value, runner["grainAmount"].value]).toEqual([2, 0.5, 0.2]);
    // A parameter left out keeps its value, and a later partial update does not undo an earlier one.
    runner.setParams({ lens: { depth: 2 } });
    expect([u.lensRadius.value, u.lensDepth.value]).toEqual([60, 2]);
    expect(runner.pipeline).toBe(pipeline);
    expect(pipeline.needsUpdate).toBe(flag);
    runner.dispose();
  });

  it("changes the scan's timing in place", () => {
    const runner = build([{ id: "scan" }]);
    const state = runner["prints"][0];
    expect(state?.scan).toEqual({ period: 9, sweep: 1.8 });
    runner.setParams({ scan: { period: 3, sweep: 1 } });
    expect(state?.scan).toEqual({ period: 3, sweep: 1 });
    runner.dispose();
  });

  it("ignores an effect that is not in the stack, and refuses a bad value or a new ramp before changing anything", () => {
    const runner = build([{ id: "lens" }, { id: "ascii", params: { ramp: " .oO@" } }]);
    const u = runner["prints"][0]?.uniforms;
    runner.setParams({ crt: { curvature: 2 } });
    expect(() => {
      runner.setParams({ lens: { radius: 80 }, ascii: { cell: 99 } });
    }).toThrow(z.ZodError);
    expect(u?.lensRadius.value).toBe(118);
    expect(() => {
      runner.setParams({ ascii: { ramp: " .:#" } });
    }).toThrow(/ramp/);
    runner.setParams({ ascii: { ramp: " .oO@", cell: 14 } });
    expect(u?.asciiPx.value).toBe(14);
    runner.dispose();
  });

  it("recolours in place", () => {
    const runner = build([{ id: "dither" }]);
    const ink = runner["inks"].cool[1];
    const was = ink.value.clone();
    runner.setInks(inksFor(hedronite.scene));
    expect(runner["inks"].cool[1]).toBe(ink);
    expect(ink.value.equals(was)).toBe(false);
    runner.dispose();
  });

  it("holds the CRT still under reduced motion, whatever setParams says", () => {
    const runner = build([{ id: "crt" }], { reducedMotion: true });
    expect(runner["crt"].motion.value).toBe(0);
    runner.setParams({ crt: { motion: 1 } });
    expect(runner["crt"].motion.value).toBe(0);
    runner.dispose();
  });
});

describe("stack structure", () => {
  it("is the same for the same effects and ramps, whatever their values, order or repeats", () => {
    const a = stackStructure([{ id: "lens", params: { radius: 50 } }, { id: "scan" }, { id: "dither", params: { cell: 4 } }]);
    const b = stackStructure([{ id: "dither" }, { id: "scan", params: { period: 3 } }, { id: "lens" }, { id: "lens" }]);
    expect(b).toBe(a);
  });

  it("changes with an effect, an ASCII ramp or reduced motion", () => {
    const base = stackStructure([{ id: "scan" }]);
    expect(stackStructure([{ id: "scan" }, { id: "lens" }])).not.toBe(base);
    expect(stackStructure([{ id: "scan" }], true)).not.toBe(base);
    expect(stackStructure([{ id: "ascii" }])).not.toBe(stackStructure([{ id: "ascii", params: { ramp: " .#" } }]));
    expect(stackStructure([{ id: "ascii", params: { cell: 9 } }])).toBe(stackStructure([{ id: "ascii" }]));
  });

  it("gives every parameter of every effect, defaults filled in", () => {
    expect(stackValues([{ id: "lens", params: { radius: 50 } }, { id: "grain" }])).toEqual({ lens: { radius: 50, depth: 1 }, grain: { amount: 0.06 } });
  });
});

it("credits the CRT tube to the ThreeUI shader it was ported from", () => {
  const registry = createRegistry();
  registerManifest(registry, manifest);
  expect(registry.get("crt")?.origin).toMatchObject({ vendor: "threeui", path: "src/shaders/crt/crtShaders.ts" });
  expect(registry.get("dither")?.origin).toBeUndefined();
  expect(() => screenEffectSchemas.crt.parse({ pitch: 0.5 })).toThrow();
});

it("registers one effect asset per screen effect", () => {
  const registry = createRegistry();
  registerManifest(registry, manifest);
  expect(registry.list({ kind: "effect" }).map((a) => a.id)).toEqual([...screenEffectIds].sort());
});
