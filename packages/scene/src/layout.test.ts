import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ringLayout } from "./layout.js";

describe("ringLayout", () => {
  it("is nothing for none and the origin for one", () => {
    expect(ringLayout(0)).toEqual([]);
    expect(ringLayout(1)).toEqual([[0, 0, 0]]);
  });

  it("puts the first at the back and four on a ring of the playground's radius", () => {
    const [first, second, third, fourth] = ringLayout(4);
    const radius = 0.6 / Math.sin(Math.PI / 4);
    expect(first?.[0]).toBeCloseTo(0, 12);
    expect(first?.[2]).toBeCloseTo(-radius, 12);
    expect(second?.[0]).toBeCloseTo(radius, 12);
    expect(third?.[2]).toBeCloseTo(radius, 12);
    expect(fourth?.[0]).toBeCloseTo(-radius, 12);
  });

  it("keeps neighbours apart, on one level, on one ring", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 64 }), (count) => {
        const points = ringLayout(count);
        expect(points).toHaveLength(count);
        const radius = Math.hypot(points[0]?.[0] ?? 0, points[0]?.[2] ?? 0);
        points.forEach(([x, y, z], i) => {
          expect(y).toBe(0);
          expect(Math.hypot(x, z)).toBeCloseTo(radius, 9);
          const [nx, , nz] = points[(i + 1) % count] ?? [0, 0, 0];
          expect(Math.hypot(x - nx, z - nz)).toBeGreaterThanOrEqual(1.2 - 1e-9);
        });
      }),
    );
  });
});
