import { createRegistry, registerManifest } from "@hedronite/lts-core";
import { hedronite } from "@hedronite/lts-tokens";
import { Color, NodeMaterial } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createDissolveMaterial,
  createEffectMaterial,
  createFresnelGlowMaterial,
  createHeightGradientMaterial,
  createHologramMaterial,
  createPulseMaterial,
  createRefractionMaterial,
  createSoapFilmMaterial,
  createToonMaterial,
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
    expect(createRefractionMaterial().transparent).toBe(true);
    const hologram = createHologramMaterial();
    expect([hologram.transparent, hologram.depthWrite]).toEqual([true, false]);
    const film = createSoapFilmMaterial();
    expect([film.transparent, film.depthWrite]).toEqual([true, false]);
  });

  it("credits the soap film to the Codevember day it was ported from", () => {
    const registry = createRegistry();
    registerManifest(registry, manifest);
    expect(registry.get("soap-film")?.origin).toMatchObject({ vendor: "codevember-2026", path: "07/src/Balloon.tsx" });
    expect(registry.get("soap-film")?.added).toBe("2026-11-16");
    expect(registry.get("toon")?.origin).toBeUndefined();
    expect(() => createSoapFilmMaterial({ color: 2 })).toThrow(z.ZodError);
  });

  it("cuts dissolved surface away by alpha test, at a fixed progress when given one", () => {
    const material = createDissolveMaterial({ progress: 0.3 });
    expect(material.alphaTest).toBe(0.5);
    expect(material.opacityNode).toBeTruthy();
    expect(() => createDissolveMaterial({ progress: 2 })).toThrow(z.ZodError);
  });

  it("validates parameters where they enter", () => {
    expect(() => createFresnelGlowMaterial({ power: 99 })).toThrow(z.ZodError);
    expect(() => createPulseMaterial({ color: "red" })).toThrow(z.ZodError);
    expect(() => createHeightGradientMaterial({ minY: 1, maxY: 0 })).toThrow(RangeError);
    expect(() => createToonMaterial({ bands: 2.5 })).toThrow(z.ZodError);
    expect(() => createRefractionMaterial({ strength: 1 })).toThrow(z.ZodError);
    expect(() => createHologramMaterial({ density: 1 })).toThrow(z.ZodError);
  });

  it("takes default colors from the token preset", () => {
    const material = createFresnelGlowMaterial({}, hedronite.scene);
    expect(material.color.equals(new Color(hedronite.scene.base))).toBe(true);
  });

  it("registers one shader asset per effect", () => {
    const registry = createRegistry();
    registerManifest(registry, manifest);
    expect(registry.list({ kind: "shader" }).map((a) => a.id)).toEqual([...effectIds]);
  });
});
