import { describe, expect, it } from "vitest";
import { fixtureScene } from "./arbitrary.js";
import { anchorsOf, createConductor, progressAt } from "./motion/conductor.js";
import { easingOf } from "./motion/easing.js";
import { spanOf, valueAt } from "./motion/evaluate.js";
import { createMotion, type MotionRuntime } from "./motion/runtime.js";
import type { Scene, SceneTrack } from "./schema.js";

const base = (tracks: readonly SceneTrack[], rest: Scene["rest"]): Scene => {
  const scene = fixtureScene("tracks");
  return { ...scene, tracks: [...tracks], clips: [], rest };
};
const NODE = fixtureScene("tracks").nodes[0]?.id ?? "";
const isVec3 = (value: unknown): value is readonly [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every((one) => typeof one === "number");
/** A vec3 a runtime drew, or a failed expectation: the runtime holds `TrackValue`, and a transform is a vec3. */
const vec3At = (motion: MotionRuntime, target: string): readonly [number, number, number] => {
  const value = motion.values.get(target);
  if (!isVec3(value)) throw new Error(`no vec3 at "${target}"`);
  return value;
};
const rise: SceneTrack = {
  id: "rise",
  target: `node.${NODE}.position`,
  keyframes: [
    { time: 0, value: [0, 2, 0], easing: "enter" },
    { time: 1, value: [0, 0, 0] },
  ],
  driver: "time",
  trigger: "load",
};

describe("the easing tokens", () => {
  it("each runs from 0 to 1, and only linear is the identity", () => {
    for (const token of ["enter", "exit", "settle", "standard", "linear"] as const) {
      const curve = easingOf(token);
      expect(curve(0)).toBeCloseTo(0, 6);
      expect(curve(1)).toBeCloseTo(1, 6);
    }
    expect(easingOf("linear")(0.25)).toBeCloseTo(0.25, 6);
    expect(easingOf("enter")(0.25)).toBeGreaterThan(0.25);
    expect(easingOf(undefined)(0.5)).toBeCloseTo(easingOf("standard")(0.5), 6);
  });
});

describe("a track's value at a moment", () => {
  it("clamps at both ends, and interpolates between keyframes with the token the first one names", () => {
    expect(valueAt(rise, -1)).toEqual([0, 2, 0]);
    expect(valueAt(rise, 3)).toEqual([0, 0, 0]);
    expect(valueAt(rise, 0.5)).toEqual([0, 2 * (1 - easingOf("enter")(0.5)), 0]);
    expect(spanOf(rise)).toBe(1);
  });
  it("holds a value with no midway point, which is a stepped keyframe", () => {
    const stepped: SceneTrack = { id: "ink", target: `node.${NODE}.surface.params.bands`, keyframes: [{ time: 0, value: "a" }, { time: 1, value: "b" }] };
    expect(valueAt(stepped, 0.4)).toBe("a");
    expect(valueAt(stepped, 1)).toBe("b");
  });
});

describe("the scroll conductor", () => {
  const anchors = [0, 100, 200];
  it("gives progress from the anchors, between them and at the ends", () => {
    expect(progressAt(anchors, 0, 200)).toBe(0);
    expect(progressAt(anchors, 150, 200)).toBeCloseTo(1.5, 6);
    expect(progressAt(anchors, 200, 200)).toBe(2);
    expect(progressAt(anchors, 900, 200)).toBe(2);
  });
  it("damps toward the exact progress, clamps the step and takes its direction from the scroll", () => {
    const conductor = createConductor();
    conductor.step({ anchors, scrollY: 0, maxScroll: 200 }, 1 / 60);
    const quick = conductor.step({ anchors, scrollY: 100, maxScroll: 200 }, 1);
    // A step longer than 1/30 s is clamped, so the smooth value cannot jump all the way.
    expect(quick.smooth).toBeLessThan(quick.progress);
    expect(quick.direction).toBe(1);
    const back = conductor.step({ anchors, scrollY: 0, maxScroll: 200 }, 1 / 60);
    expect(back.direction).toBe(-1);
  });
  it("snaps under reduced motion", () => {
    const conductor = createConductor();
    const state = conductor.step({ anchors, scrollY: 150, maxScroll: 200 }, 1 / 60, true);
    expect(state.smooth).toBe(state.progress);
  });
  it("measures anchors from section offsets, rising", () => {
    const measured = anchorsOf([{ offsetTop: 0, offsetHeight: 400 }, { offsetTop: 400, offsetHeight: 600 }], 800, 2000);
    expect(measured[0]).toBe(0);
    expect(measured[1]).toBeGreaterThan(0);
  });
});

describe("the runtime", () => {
  const rest: Scene["rest"] = { [`node.${NODE}.position`]: [0, 0, 0] };

  it("plays a load track from the injected clock and holds its last value", () => {
    const motion = createMotion(base([rise], rest));
    const y = (): number => vec3At(motion, `node.${NODE}.position`)[1];
    expect(y()).toBe(0);
    motion.step(0.1);
    expect(y()).toBeGreaterThan(0);
    motion.step(0.6);
    expect(y()).toBeGreaterThan(0);
    motion.step(1);
    expect(y()).toBe(0);
    expect(motion.moving).toBe(false);
  });

  it("moves with the time it is given, not with the time it takes", () => {
    const slow = createMotion(base([rise], rest));
    slow.step(0.2);
    const quick = createMotion(base([rise], rest));
    quick.step(0.2);
    expect(quick.values.get(`node.${NODE}.position`)).toEqual(slow.values.get(`node.${NODE}.position`));
  });

  it("fires in-view once unless its id is asked for, and only when the stage is seen", () => {
    const reveal: SceneTrack = { ...rise, id: "reveal", trigger: "in-view" };
    const once = createMotion(base([reveal], rest));
    once.step(0.5, { inView: false });
    expect(once.values.get(`node.${NODE}.position`)).toEqual([0, 0, 0]);
    once.step(0.1, { inView: true });
    once.step(1, { inView: true });
    const settled = once.values.get(`node.${NODE}.position`);
    once.step(1, { inView: false });
    once.step(1, { inView: true });
    expect(once.values.get(`node.${NODE}.position`)).toEqual(settled);
    const again = createMotion(base([reveal], rest), { replay: ["reveal"] });
    again.step(0.1, { inView: true });
    again.step(1, { inView: true });
    again.step(1, { inView: false });
    again.values.get(`node.${NODE}.position`);
    again.step(0.2, { inView: true });
    expect(vec3At(again, `node.${NODE}.position`)[1]).toBeGreaterThan(0);
  });

  it("returns a hover track to its rest pose when the pointer leaves", () => {
    const hover: SceneTrack = { ...rise, id: "lift", trigger: "hover" };
    const motion = createMotion(base([hover], rest));
    motion.step(0.5, { hovered: false });
    expect(motion.values.get(`node.${NODE}.position`)).toEqual([0, 0, 0]);
    motion.step(0.5, { hovered: true });
    expect(vec3At(motion, `node.${NODE}.position`)[1]).toBeGreaterThan(0);
    motion.step(0.1, { hovered: false });
    expect(motion.values.get(`node.${NODE}.position`)).toEqual([0, 0, 0]);
  });

  it("scrubs with the scroll both ways", () => {
    const scrub: SceneTrack = { ...rise, id: "chapter", driver: "scroll", trigger: "scroll-scrub" };
    const motion = createMotion(base([scrub], rest));
    motion.step(0.1, { scroll: { progress: 0, smooth: 0, direction: 1 } });
    expect(motion.values.get(`node.${NODE}.position`)).toEqual([0, 2, 0]);
    motion.step(0.1, { scroll: { progress: 1, smooth: 1, direction: 1 } });
    expect(motion.values.get(`node.${NODE}.position`)).toEqual([0, 0, 0]);
    motion.step(0.1, { scroll: { progress: 0, smooth: 0, direction: -1 } });
    expect(motion.values.get(`node.${NODE}.position`)).toEqual([0, 2, 0]);
  });

  it("moves nothing under reduced motion, and holds the rest pose", () => {
    const motion = createMotion(base([rise], rest), { reducedMotion: true });
    const frame = motion.step(1, { inView: true, hovered: true, scroll: { progress: 1, smooth: 1, direction: 1 } });
    expect(frame.changed).toBe(false);
    expect(motion.values.get(`node.${NODE}.position`)).toEqual([0, 0, 0]);
    expect(motion.moving).toBe(false);
  });

  it("plays a spin as data, as a full turn whose ends meet", () => {
    const spin: SceneTrack = {
      id: "spin",
      target: `node.${NODE}.rotation`,
      keyframes: [{ time: 0, value: [0, 0, 0], easing: "linear" }, { time: 4, value: [0, Math.PI * 2, 0], easing: "linear" }],
      driver: "time",
      trigger: "load",
    };
    const motion = createMotion(base([spin], { [`node.${NODE}.rotation`]: [0, 0, 0] }));
    motion.step(2);
    const half = vec3At(motion, `node.${NODE}.rotation`)[1];
    expect(half).toBeCloseTo(Math.PI, 3);
    motion.step(2);
    const full = vec3At(motion, `node.${NODE}.rotation`)[1];
    expect(Math.cos(full)).toBeCloseTo(Math.cos(0), 3);
  });

  it("plays a bob as data, rising to a crest and coming back to rest", () => {
    const bob: SceneTrack = {
      id: "bob",
      target: `node.${NODE}.position`,
      keyframes: [
        { time: 0, value: [0, 0, 0], easing: "linear" },
        { time: 1, value: [0, 0.08, 0], easing: "linear" },
        { time: 2, value: [0, 0, 0] },
      ],
      driver: "time",
      trigger: "load",
    };
    const motion = createMotion(base([bob], rest));
    motion.step(1);
    const crest = vec3At(motion, `node.${NODE}.position`)[1];
    expect(crest).toBeCloseTo(0.08, 6);
    motion.step(1);
    const restY = vec3At(motion, `node.${NODE}.position`)[1];
    expect(restY).toBeCloseTo(0, 6);
  });
});

/** A track that climbs from 0 to 5 over half a second on the clock, with no easing: the arithmetic of the tests below is exact. */
const climb = (over: Partial<SceneTrack> = {}): SceneTrack => ({
  id: "climb",
  target: `node.${NODE}.position`,
  keyframes: [
    { time: 0, value: [0, 0, 0], easing: "linear" },
    { time: 0.5, value: [0, 5, 0], easing: "linear" },
  ],
  driver: "time",
  trigger: "load",
  ...over,
});

describe("the runtime's triggers and drivers", () => {
  const rest: Scene["rest"] = { [`node.${NODE}.position`]: [0, 0, 0] };
  const yOf = (motion: MotionRuntime): number => vec3At(motion, `node.${NODE}.position`)[1];

  it("holds a finished time track at its last keyframe instead of snapping back to rest", () => {
    const motion = createMotion(base([climb()], rest));
    motion.step(0.25);
    expect(yOf(motion)).toBeCloseTo(2.5, 6);
    motion.step(0.25);
    expect(yOf(motion)).toBeCloseTo(5, 6);
    const after = motion.step(0.25);
    expect(yOf(motion)).toBeCloseTo(5, 6);
    expect(after.changed).toBe(false);
    expect(motion.moving).toBe(false);
  });

  it("starts a hover track on every arrival of the pointer, and returns it to rest when it leaves", () => {
    const motion = createMotion(base([climb({ id: "lift", trigger: "hover" })], rest));
    motion.step(0.5, { hovered: false });
    expect(yOf(motion)).toBe(0);
    motion.step(0.25, { hovered: true });
    expect(yOf(motion)).toBeCloseTo(2.5, 6);
    motion.step(0.25, { hovered: false });
    expect(yOf(motion)).toBe(0);
    motion.step(0.25, { hovered: true });
    expect(yOf(motion)).toBeCloseTo(2.5, 6);
  });

  it("plays an in-view track across many frames without restarting it, and re-arms only when asked to replay", () => {
    const once = createMotion(base([climb({ id: "reveal", trigger: "in-view" })], rest));
    for (let frame = 0; frame < 6; frame += 1) once.step(0.1, { inView: true });
    expect(yOf(once)).toBeCloseTo(5, 6);
    once.step(0.1, { inView: true });
    expect(yOf(once)).toBeCloseTo(5, 6);
    once.step(0.1, { inView: false });
    once.step(0.1, { inView: true });
    expect(yOf(once)).toBeCloseTo(5, 6);

    const again = createMotion(base([climb({ id: "reveal", trigger: "in-view" })], rest), { replay: ["reveal"] });
    for (let frame = 0; frame < 6; frame += 1) again.step(0.1, { inView: true });
    expect(yOf(again)).toBeCloseTo(5, 6);
    again.step(0.1, { inView: false });
    again.step(0.1, { inView: true });
    expect(yOf(again)).toBeCloseTo(1, 6);
  });

  it("maps the pointer over the track's span both ways, and reports nothing when the pointer is still", () => {
    const leaning = climb({ id: "lean", driver: "pointer", trigger: "load", keyframes: [{ time: 0, value: [0, 0, 0], easing: "linear" }, { time: 2, value: [0, 8, 0], easing: "linear" }] });
    const motion = createMotion(base([leaning], rest));
    motion.step(0.1);
    expect(yOf(motion)).toBe(0);
    motion.step(0.1, { pointer: { x: 0, y: 0 } });
    expect(yOf(motion)).toBeCloseTo(4, 6);
    expect(motion.step(0.1, { pointer: { x: 0, y: 0 } }).changed).toBe(false);
    expect(motion.moving, "a pointer that has not moved moves nothing").toBe(false);
    motion.step(0.1, { pointer: { x: 1, y: 0 } });
    expect(yOf(motion)).toBeCloseTo(8, 6);
    motion.step(0.1, { pointer: { x: -1, y: 0 } });
    expect(yOf(motion)).toBeCloseTo(0, 6);
  });

  it("holds every driver at its rest value under reduced motion, the scroll and the pointer among them", () => {
    const motion = createMotion(base([climb({ id: "sweep", driver: "scroll", trigger: "scroll-scrub" }), climb({ id: "lean", driver: "pointer" }), climb({ id: "lift", trigger: "hover" })], rest), { reducedMotion: true });
    const frame = motion.step(1, { scroll: { progress: 0.5, smooth: 0.5, direction: 1 }, pointer: { x: 1, y: 0 }, hovered: true, inView: true });
    expect(frame.changed).toBe(false);
    expect(yOf(motion)).toBe(0);
    expect(motion.moving).toBe(false);
  });
});
