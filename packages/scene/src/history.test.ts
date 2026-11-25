import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { currentFixtures, editsOf, fixtureScene, scenes } from "./arbitrary.js";
import { toCanonicalJson } from "./emit/json.js";
import { setLights } from "./edit.js";
import { canRedo, canUndo, createHistory, endGesture, HISTORY_CAP, push, redo, undo, type SceneHistory } from "./history.js";
import { parseScene, type Scene } from "./schema.js";

/** Each document is told apart by one number, its light, so a run of distinct documents is easy to make and to read. */
const lit = (intensity: number): Scene => {
  const result = setLights(fixtureScene("v1"), { intensity });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.scene;
};
const level = (history: SceneHistory): number => history.present.lights.intensity;
const levels = (documents: readonly Scene[]): number[] => documents.map((document) => document.lights.intensity);

/** A document with no negative zero in it: `JSON.stringify` writes -0 as 0, and a history is held as the objects themselves. */
const plain = (scene: Scene): Scene => {
  // A replacer, not text replacement: -0 can end an object or an array as well as precede a comma, and a "-0" inside a string is a string.
  const result = parseScene(JSON.parse(JSON.stringify(scene, (_key, value: unknown) => (Object.is(value, -0) ? 0 : value))));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.scene;
};

/** A history made by a run of pushes. */
const pushed = (start: Scene, rest: readonly Scene[]): SceneHistory => rest.reduce((history, scene) => push(history, scene), createHistory(start));

describe("a history", () => {
  it("starts at a document with nothing to undo and nothing to redo", () => {
    const start = createHistory(lit(1));
    expect([canUndo(start), canRedo(start)]).toEqual([false, false]);
    expect(undo(start)).toBe(start);
    expect(redo(start)).toBe(start);
  });

  it("steps back to the document before, forward again to the one after, one step at a time", () => {
    let history = pushed(lit(1), [lit(2), lit(3), lit(4)]);
    expect(level(history)).toBe(4);
    history = undo(history);
    expect([level(history), canUndo(history), canRedo(history)]).toEqual([3, true, true]);
    history = undo(undo(history));
    expect([level(history), canUndo(history)]).toEqual([1, false]);
    history = redo(history);
    expect(level(history)).toBe(2);
    history = redo(redo(history));
    expect([level(history), canRedo(history)]).toEqual([4, false]);
    expect(redo(history)).toBe(history);
  });

  it("forgets what was undone when something new is pushed", () => {
    const back = undo(undo(pushed(lit(1), [lit(2), lit(3)])));
    expect(canRedo(back)).toBe(true);
    const branched = push(back, lit(9));
    expect(canRedo(branched)).toBe(false);
    expect(levels(branched.past)).toEqual([1]);
    expect(level(undo(branched))).toBe(1);
  });

  it("drops the oldest when the 101st step is pushed, and keeps the newest hundred", () => {
    expect(HISTORY_CAP).toBe(100);
    const all = Array.from({ length: 150 }, (_, index) => lit((index + 1) / 100));
    const history = pushed(lit(0), all);
    expect(history.past).toHaveLength(100);
    expect(level(history)).toBe(1.5);
    // The 150 pushes put 150 documents before the present one (the start and the first 149); the oldest 50 are gone.
    expect(levels(history.past)[0]).toBe(0.5);
    expect(levels(history.past).at(-1)).toBe(1.49);
    let walked = history;
    let steps = 0;
    while (canUndo(walked)) {
      walked = undo(walked);
      steps += 1;
    }
    expect([steps, level(walked)]).toEqual([100, 0.5]);
    // And redo brings every one of them back.
    while (canRedo(walked)) walked = redo(walked);
    expect(level(walked)).toBe(1.5);
    expect(walked.past).toHaveLength(100);
  });

  it("keeps exactly the cap at 100 pushes and drops the oldest at 101", () => {
    const hundred = pushed(lit(0), Array.from({ length: 100 }, (_, index) => lit((index + 1) / 100)));
    expect(hundred.past).toHaveLength(100);
    expect(levels(hundred.past)[0]).toBe(0);
    const more = push(hundred, lit(5));
    expect(more.past).toHaveLength(100);
    expect(levels(more.past)[0]).toBe(0.01);
  });
});

describe("coalescing", () => {
  it("folds consecutive changes with one key into one step", () => {
    let history = createHistory(lit(1));
    for (const intensity of [2, 3, 4, 5]) history = push(history, lit(intensity), "node-1.position");
    expect(levels(history.past)).toEqual([1]);
    expect(level(history)).toBe(5);
    expect(level(undo(history))).toBe(1);
    expect(level(redo(undo(history)))).toBe(5);
  });

  it("starts another step for another key, for no key, after an undo or a redo, and after the gesture is ended", () => {
    const base = push(createHistory(lit(1)), lit(2), "a");
    expect(levels(push(base, lit(3), "b").past)).toEqual([1, 2]);
    expect(levels(push(base, lit(3)).past)).toEqual([1, 2]);
    expect(levels(push(endGesture(base), lit(3), "a").past)).toEqual([1, 2]);
    // An undo and a redo end the gesture: the next change with the same key is a step of its own.
    expect(levels(push(redo(undo(base)), lit(3), "a").past)).toEqual([1, 2]);
    const branched = push(undo(base), lit(3), "a");
    expect(levels(branched.past)).toEqual([1]);
    expect(branched.future).toEqual([]);
  });

  it("never grows the history while a gesture goes on, and a long one is still one step", () => {
    let history = createHistory(lit(0));
    for (let index = 1; index <= 500; index += 1) history = push(history, lit(index / 1000), "drag");
    expect(history.past).toHaveLength(1);
    expect(level(undo(history))).toBe(0);
  });

  it("makes a step of a change with no key, always, even when the same document comes twice", () => {
    const history = push(push(createHistory(lit(1)), lit(2)), lit(2));
    expect(history.past).toHaveLength(2);
  });
});

describe("the properties of a history", () => {
  const history = fc.array(scenes, { maxLength: 6 }).chain((pastScenes) => scenes.map((present) => pushed(present, pastScenes)));

  it("undo after push gives the previous document back, and redo gives the pushed one again", () => {
    fc.assert(
      fc.property(history, scenes, (before, next) => {
        const pushedOnto = push(before, next);
        expect(undo(pushedOnto).present).toEqual(before.present);
        expect(undo(pushedOnto).past).toEqual(before.past);
        expect(redo(undo(pushedOnto)).present).toEqual(next);
        expect(canRedo(pushedOnto)).toBe(false);
      }),
    );
  });

  it("undo then redo, and redo then undo, are the history it was", () => {
    fc.assert(
      fc.property(history, (made) => {
        const back = undo(made);
        expect(redo(back)).toEqual(canUndo(made) ? { ...made, gesture: null } : made);
        expect(undo(redo(back)).present).toEqual(back.present);
      }),
    );
  });

  it("holds at most the cap, however many are pushed, and every undo lands on a document that was pushed", () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 1000 }), { minLength: 100, maxLength: 108 }), (steps) => {
        const made = pushed(lit(0), steps.map((step, index) => lit((step + index) / 2000)));
        expect(made.past.length).toBeLessThanOrEqual(HISTORY_CAP);
        const walked: number[] = [];
        for (let at = made; canUndo(at); at = undo(at)) walked.push(level(undo(at)));
        expect(walked).toEqual(levels(made.past).reverse());
      }),
      { numRuns: 4 },
    );
  });

  it("leaves one step for a gesture of any length, and the last change of it is what stays", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 10, noNaN: true }), { minLength: 1, maxLength: 20 }), (values) => {
        const start = lit(1);
        const folded = values.reduce((made, value) => push(made, lit(value), "gesture"), createHistory(start));
        expect(folded.past).toEqual([start]);
        expect(level(folded)).toBe(values.at(-1));
      }),
    );
  });

  it("keeps only documents: every entry survives a JSON round trip, and so does the whole history", () => {
    fc.assert(
      fc.property(history, (made) => {
        const clean: SceneHistory = { ...made, past: made.past.map(plain), present: plain(made.present), future: made.future.map(plain) };
        const through: unknown = JSON.parse(JSON.stringify(clean));
        expect(through).toEqual(clean);
        for (const entry of [...clean.past, clean.present, ...clean.future]) expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
      }),
      { numRuns: 20 },
    );
  });

  it.each(currentFixtures)("keeps the %s fixture, and a run of edits of it, as documents a JSON round trip does not change", (name) => {
    fc.assert(
      fc.property(fc.gen(), (gen) => {
        let current = fixtureScene(name);
        let made = createHistory(current);
        for (let step = 0; step < 6; step += 1) {
          const result = gen(editsOf, current).run(current);
          if (!result.ok) throw new Error(JSON.stringify(result.issues));
          current = result.scene;
          made = push(made, current);
        }
        made = undo(undo(made));
        const clean: SceneHistory = { ...made, past: made.past.map(plain), present: plain(made.present), future: made.future.map(plain) };
        expect(JSON.parse(JSON.stringify(clean))).toEqual(clean);
        for (const entry of [...made.past, made.present, ...made.future]) expect(parseScene(JSON.parse(toCanonicalJson(entry))).ok).toBe(true);
      }),
      { numRuns: 6 },
    );
  });

  it("is a history a check of the round trip would fail if an entry held more than data", () => {
    // The entries the check is for: an object with a method and a class instance are not what JSON gives back.
    const withMethod: Scene = { ...fixtureScene("v1"), seed: 0 };
    Object.defineProperty(withMethod, "keep", { value: () => 1, enumerable: true });
    const held = push(createHistory(fixtureScene("v1")), withMethod);
    expect(JSON.parse(JSON.stringify(held.present))).not.toEqual(held.present);
    const instance = new (class Holder { readonly scene = fixtureScene("v1"); readonly children = [new Date(0)]; })();
    expect(JSON.parse(JSON.stringify(instance))).not.toEqual(instance);
  });

  it("is never changed by an undo or a redo: the history it was given keeps its documents", () => {
    const made = pushed(lit(1), [lit(2), lit(3)]);
    const snapshot = structuredClone(made);
    undo(made);
    redo(undo(made));
    push(made, lit(7));
    expect(made).toEqual(snapshot);
  });
});
