import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createRandom } from "./random.js";

const take = (seed: number, n: number): number[] => {
  const random = createRandom(seed);
  return Array.from({ length: n }, () => random.next());
};

describe("createRandom", () => {
  it("repeats its sequence for the same seed and differs for another", () => {
    expect(take(42, 20)).toEqual(take(42, 20));
    expect(take(42, 20)).not.toEqual(take(43, 20));
  });

  it("stays in [0, 1) and covers the interval evenly enough", () => {
    const values = take(7, 10000);
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });

  it("keeps range and int within their bounds for any seed", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: 0, max: 1000 }), (seed, min, span) => {
        const random = createRandom(seed);
        const r = random.range(min, min + span + 1);
        expect(r).toBeGreaterThanOrEqual(min);
        expect(r).toBeLessThan(min + span + 1);
        const i = random.int(min, min + span);
        expect(Number.isInteger(i)).toBe(true);
        expect(i).toBeGreaterThanOrEqual(min);
        expect(i).toBeLessThanOrEqual(min + span);
      }),
    );
  });

  it("picks from a list and refuses an empty one", () => {
    const random = createRandom(1);
    expect(["a", "b", "c"]).toContain(random.pick(["a", "b", "c"]));
    expect(() => random.pick([])).toThrow(RangeError);
  });
});
