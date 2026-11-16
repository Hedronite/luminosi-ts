import fc from "fast-check";
import { expect, it } from "vitest";
import { lineupLayout } from "./lineup";

it("uses three columns on a phone and up to seven on a wide screen", () => {
  expect(lineupLayout(343, 13).cols).toBe(3);
  expect(lineupLayout(1100, 13).cols).toBe(7);
});

it("always has room for every material in square cells", () => {
  fc.assert(
    fc.property(fc.integer({ min: 200, max: 3000 }), fc.integer({ min: 1, max: 40 }), (width, count) => {
      const { cols, cell, height } = lineupLayout(width, count);
      expect(cols * cell).toBeCloseTo(width);
      expect((height / cell) * cols).toBeGreaterThanOrEqual(count);
    }),
  );
});
