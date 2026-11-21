import { createRegistry, registerManifest } from "@hedronite/lts-core";
import { hedronite } from "@hedronite/lts-tokens";
import { Color, NodeMaterial } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createDissolveEffect,
  createEffectMaterial,
  createFresnelGlowEffect,
  createHeightGradientEffect,
  createHologramEffect,
  createPulseEffect,
  createRefractionEffect,
  createSoapFilmEffect,
  createToonEffect,
} from "./effects.js";
import { effectIds, effectInfo } from "./info.js";
import { manifest } from "./manifest.js";

describe("effects", () => {
  it.each(effectIds)("%s builds a node material with its graph attached", (id) => {
    const material = createEffectMaterial(id);
    expect(material).toBeInstanceOf(NodeMaterial);
    expect(material.name).toBe(id);
    // Every effect is a node graph: color, emission, opacity or what shows from behind.
    const graph = "emissiveNode" in material ? material.emissiveNode : null;
    expect(material.colorNode ?? graph ?? material.backdropNode).toBeTruthy();
  });

  it("says which effects animate and which need something behind them", () => {
    expect(effectIds.filter((id) => effectInfo[id].animated === true)).toEqual(["dissolve", "hologram", "pulse", "soap-film"]);
    expect(effectIds.filter((id) => effectInfo[id].seeThrough === true)).toEqual(["hologram", "refraction", "soap-film"]);
  });

  it("draws see-through effects after the opaque scene", () => {
    expect(createRefractionEffect().material.transparent).toBe(true);
    const hologram = createHologramEffect().material;
    expect([hologram.transparent, hologram.depthWrite]).toEqual([true, false]);
    const film = createSoapFilmEffect().material;
    expect([film.transparent, film.depthWrite]).toEqual([true, false]);
  });

  it("credits the soap film to the Codevember day it was ported from", () => {
    const registry = createRegistry();
    registerManifest(registry, manifest);
    expect(registry.get("soap-film")?.origin).toMatchObject({ vendor: "codevember-2026", relation: "ported", path: "07/src/Balloon.tsx" });
    expect(registry.get("soap-film")?.added).toBe("2026-11-16");
    expect(registry.get("toon")?.origin).toBeUndefined();
    expect(() => createSoapFilmEffect({ color: 2 })).toThrow(z.ZodError);
  });

  it("cuts dissolved surface away by alpha test, at a fixed progress when given one", () => {
    const { material } = createDissolveEffect({ progress: 0.3 });
    expect(material.alphaTest).toBe(0.5);
    expect(material.opacityNode).toBeTruthy();
    expect(() => createDissolveEffect({ progress: 2 })).toThrow(z.ZodError);
  });

  it("validates parameters where they enter", () => {
    expect(() => createFresnelGlowEffect({ power: 99 })).toThrow(z.ZodError);
    expect(() => createPulseEffect({ color: "red" })).toThrow(z.ZodError);
    expect(() => createHeightGradientEffect({ minY: 1, maxY: 0 })).toThrow(RangeError);
    expect(() => createToonEffect({ bands: 2.5 })).toThrow(z.ZodError);
    expect(() => createRefractionEffect({ strength: 1 })).toThrow(z.ZodError);
    expect(() => createHologramEffect({ density: 1 })).toThrow(z.ZodError);
  });

  it("takes default colors from the token preset", () => {
    const { uniforms } = createFresnelGlowEffect({}, hedronite.scene);
    const base = uniforms["base"];
    if (!(base?.value instanceof Color)) throw new Error("the base color is not a color uniform");
    expect(base.value.equals(new Color(hedronite.scene.base))).toBe(true);
  });

  it("registers one shader asset per effect", () => {
    const registry = createRegistry();
    registerManifest(registry, manifest);
    expect(registry.list({ kind: "shader" }).map((a) => a.id)).toEqual([...effectIds]);
  });
});
