import { time } from "three/tsl";
import { Color, MeshStandardNodeMaterial, type Node, type NodeMaterial } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createEffect, createEffectClock, createEffectMaterial, type EffectHandle } from "./effects.js";
import { effectIds, effectInfo, effectSchemas, type EffectId } from "./info.js";

/** One value for every live parameter of every effect, none of them the default. Structural parameters are not here. */
const moves: Readonly<Record<EffectId, Readonly<Record<string, number | string>>>> = {
  "fresnel-glow": { power: 4, intensity: 5, base: "#112233", glow: "#445566" },
  "height-gradient": { minY: -2, maxY: 3, bottom: "#112233", top: "#445566" },
  pulse: { speed: 7, intensity: 4, color: "#112233" },
  toon: { outline: 0.5, color: "#112233", ink: "#445566" },
  refraction: { strength: 0.2, clarity: 0.5, tint: "#112233" },
  dissolve: { scale: 8, edgeWidth: 0.2, speed: 2, color: "#112233", edge: "#445566" },
  hologram: { density: 100, speed: 5, intensity: 3, color: "#112233" },
  "soap-film": { color: 0.9, bands: 3, speed: 0.5, sheen: 0.8, tint: "#112233" },
};

/** Parameters baked into the graph, which `set` hands back for a rebuild. */
const structural: Readonly<Record<EffectId, readonly string[]>> = {
  "fresnel-glow": [],
  "height-gradient": [],
  pulse: [],
  toon: ["bands"],
  refraction: [],
  dissolve: ["progress"],
  hologram: [],
  "soap-film": [],
};

/** A uniform's value as a plain thing to compare: the number, or a color as its hex digits. */
const value = (handle: EffectHandle, key: string): unknown => {
  const uniform = handle.uniforms[key]?.value;
  return uniform instanceof Color ? uniform.getHexString() : uniform;
};

const nodesUnder = (root: Node | null): Node[] => {
  const found: Node[] = [];
  root?.traverse((node) => {
    found.push(node);
  });
  return found;
};

const graph = (material: NodeMaterial): Node[] =>
  [material.colorNode, material.opacityNode, material.backdropNode, material instanceof MeshStandardNodeMaterial ? material.emissiveNode : null].flatMap((root) => nodesUnder(root));

describe("effect handles", () => {
  it.each(effectIds)("%s: every parameter is either a uniform it moves or a structural one it names", (id) => {
    const handle = createEffect(id);
    const parameters = Object.keys(effectSchemas[id].shape).sort();
    expect([...Object.keys(moves[id]), ...structural[id]].sort()).toEqual(parameters);
    expect([...handle.structural]).toEqual([...structural[id]]);
    for (const key of Object.keys(moves[id])) expect(handle.uniforms).toHaveProperty(key);
  });

  describe.each(effectIds)("%s", (id) => {
    it.each(Object.entries(moves[id]))("sets %s in place, with no new material", (key, next) => {
      const handle = createEffect(id);
      const { material } = handle;
      const version = material.version;
      expect(handle.set(Object.fromEntries([[key, next]]))).toBe(true);
      expect(handle.material).toBe(material);
      expect(material.version).toBe(version);
      expect(value(handle, key)).toBe(typeof next === "string" ? new Color(next).getHexString() : next);
    });

    it("sets several at once and leaves the ones it was not given", () => {
      const handle = createEffect(id);
      const untouched = Object.fromEntries(Object.keys(moves[id]).map((key) => [key, value(handle, key)]));
      const [first, ...rest] = Object.entries(moves[id]);
      if (first === undefined) throw new Error("no parameters");
      expect(handle.set(Object.fromEntries(rest))).toBe(true);
      expect(value(handle, first[0])).toEqual(untouched[first[0]]);
      for (const [key] of rest) expect(value(handle, key)).not.toEqual(untouched[key]);
    });

    it("writes nothing when a value is invalid", () => {
      const handle = createEffect(id);
      const names = Object.keys(moves[id]);
      const [color] = Object.entries(moves[id]).find(([, next]) => typeof next === "string") ?? [];
      if (color === undefined) throw new Error(`${id} has no color parameter`);
      const before = names.map((name) => value(handle, name));
      // The rest of the call is valid: one bad value refuses all of it.
      expect(() => handle.set({ ...moves[id], [color]: "red" })).toThrow(z.ZodError);
      expect(names.map((name) => value(handle, name))).toEqual(before);
    });

    it("refuses a parameter it does not have", () => {
      expect(() => createEffect(id).set(Object.fromEntries([["nonsense", 1]]))).toThrow(RangeError);
    });

    it("frees its material", () => {
      const handle = createEffect(id);
      let freed = 0;
      handle.material.addEventListener("dispose", () => {
        freed += 1;
      });
      handle.dispose();
      expect(freed).toBe(1);
    });
  });

  it("holds a number to its bounds, and writes none of a call that has one out of range", () => {
    const handle = createEffect("fresnel-glow");
    expect(() => handle.set({ power: 4, intensity: 99 })).toThrow(z.ZodError);
    expect(value(handle, "power")).toBe(2.5);
    expect(() => handle.set({ power: 0.1 })).toThrow(z.ZodError);
  });

  it("keeps the gradient's range ordered, whichever end moves", () => {
    const handle = createEffect("height-gradient", { minY: 0, maxY: 1 });
    expect(() => handle.set({ minY: 2 })).toThrow(RangeError);
    expect(() => handle.set({ maxY: -2 })).toThrow(RangeError);
    expect(handle.set({ minY: 0.5, maxY: 4 })).toBe(true);
    expect([value(handle, "minY"), value(handle, "maxY")]).toEqual([0.5, 4]);
  });

  it("leaves a structural parameter alone when it is set to the value it has, and hands back a rebuild when it is not", () => {
    const toon = createEffect("toon", { bands: 3 });
    expect(toon.set({ bands: 3, outline: 0.1 })).toBe(true);
    expect(value(toon, "outline")).toBe(0.1);
    expect(toon.set({ bands: 5, outline: 0.4 })).toBe(false);
    expect(value(toon, "outline")).toBe(0.1);
  });

  it("moves a dissolve's progress live once it has one, and says a rebuild is needed to give it one", () => {
    const fixed = createEffect("dissolve", { progress: 0.2 });
    expect(fixed.set({ progress: 0.8 })).toBe(true);
    expect(value(fixed, "progress")).toBe(0.8);
    const animated = createEffect("dissolve");
    expect(animated.uniforms).not.toHaveProperty("progress");
    expect(animated.set({ progress: 0.5, speed: 3 })).toBe(false);
    expect(value(animated, "speed")).toBe(0.6);
  });

  describe("time", () => {
    const animated = effectIds.filter((id) => effectInfo[id].animated === true);

    it.each(animated)("%s reads the clock it is given, not three's wall clock", (id) => {
      const clock = createEffectClock();
      const { material } = createEffect(id, {}, undefined, { clock });
      expect(graph(material)).toContain(clock);
      expect(graph(material)).not.toContain(time);
    });

    it.each(animated)("%s reads three's wall clock when given none", (id) => {
      expect(graph(createEffect(id).material)).toContain(time);
    });

    it.each(effectIds.filter((id) => !animated.includes(id)))("%s has no time in it", (id) => {
      const clock = createEffectClock();
      const { material } = createEffect(id, {}, undefined, { clock });
      expect(graph(material)).not.toContain(clock);
      expect(graph(material)).not.toContain(time);
    });

    it("starts a clock where it is told and leaves writing it to its owner", () => {
      const clock = createEffectClock(2.5);
      expect(clock.value).toBe(2.5);
      const effect = createEffect("pulse", {}, undefined, { clock });
      effect.dispose();
      clock.value = 4;
      expect(clock.value).toBe(4);
    });
  });

  it("still gives the default material for an id, as the snippet shows", () => {
    for (const id of effectIds) {
      const material = createEffectMaterial(id);
      expect(material.name).toBe(id);
      material.dispose();
    }
  });
});
