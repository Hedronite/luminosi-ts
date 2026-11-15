import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { defaultBox, fitFrustum, parseEmbedParams, type CameraExtent } from "./embedFit.js";

/** Where a camera-space point lands in pixels under a frustum. */
const toPixel = (f: { left: number; right: number; top: number; bottom: number }, w: number, h: number, x: number, y: number): readonly [number, number] => [
  ((x - f.left) / (f.right - f.left)) * w,
  ((f.top - y) / (f.top - f.bottom)) * h,
];

describe("fitFrustum", () => {
  it("lands the extent's top and bottom on the box, centered, at one scale", () => {
    const length = fc.double({ min: 0.01, max: 50, noNaN: true });
    const unit = fc.double({ min: 0.05, max: 0.45, noNaN: true });
    fc.assert(
      fc.property(length, length, fc.double({ min: -10, max: 10, noNaN: true }), unit, unit, fc.integer({ min: 64, max: 2048 }), fc.integer({ min: 64, max: 2048 }), (ew, eh, offset, cx, cy, w, h) => {
        const extent: CameraExtent = { minX: offset, maxX: offset + ew, minY: -offset, maxY: -offset + eh };
        const box = { x0: cx, y0: cy, x1: cx + 0.5, y1: cy + 0.5 };
        const f = fitFrustum(extent, box, w, h);
        const [, top] = toPixel(f, w, h, 0, extent.maxY);
        const [, bottom] = toPixel(f, w, h, 0, extent.minY);
        expect(top).toBeCloseTo(box.y0 * h, 6);
        expect(bottom).toBeCloseTo(box.y1 * h, 6);
        const [left] = toPixel(f, w, h, extent.minX, 0);
        const [right] = toPixel(f, w, h, extent.maxX, 0);
        expect((left + right) / 2).toBeCloseTo(((box.x0 + box.x1) / 2) * w, 6);
        // One scale: world units per pixel match across and down.
        expect((f.right - f.left) / w).toBeCloseTo((f.top - f.bottom) / h, 9);
      }),
      { numRuns: 200 },
    );
  });

  it("keeps a too-wide object too wide instead of squeezing it into the box", () => {
    const f = fitFrustum({ minX: -2, maxX: 2, minY: -0.5, maxY: 0.5 }, { x0: 0.4, y0: 0.4, x1: 0.6, y1: 0.6 }, 100, 100);
    const [left] = toPixel(f, 100, 100, -2, 0);
    const [right] = toPixel(f, 100, 100, 2, 0);
    expect(right - left).toBeCloseTo(80, 6);
  });

  it("rejects an empty image or box", () => {
    expect(() => fitFrustum({ minX: 0, maxX: 1, minY: 0, maxY: 1 }, { x0: 0, y0: 0.5, x1: 1, y1: 0.5 }, 100, 100)).toThrow(RangeError);
    expect(() => fitFrustum({ minX: 0, maxX: 1, minY: 0, maxY: 1 }, { x0: 0, y0: 0, x1: 1, y1: 1 }, 0, 100)).toThrow(RangeError);
  });
});

describe("defaultBox", () => {
  it("centers the object and fills 80% of the limiting side", () => {
    const box = defaultBox({ minX: 0, maxX: 2, minY: 0, maxY: 1 }, 400, 400);
    expect(box.x1 - box.x0).toBeCloseTo(0.8, 9);
    expect(box.y1 - box.y0).toBeCloseTo(0.4, 9);
    expect((box.x0 + box.x1) / 2).toBeCloseTo(0.5, 9);
  });
});

describe("parseEmbedParams", () => {
  it("reads the parameters and fills defaults", () => {
    const p = parseEmbedParams("?spec=/specs/a.json&width=600&height=800&bg=%23f4f4f5&yaw=30&pitch=10&fit=0.1,0.2,0.9,0.8&look=hedron");
    expect(p).toEqual({ spec: "/specs/a.json", look: "hedron", width: 600, height: 800, background: "#f4f4f5", yaw: 30, pitch: 10, fit: { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.8 } });
    expect(parseEmbedParams("?spec=/a.json")).toMatchObject({ look: "neutral", width: 512, height: 512, background: "#ffffff", yaw: 0, pitch: 0, fit: undefined });
  });

  it("only loads same-origin paths", () => {
    expect(() => parseEmbedParams("?spec=https://example.com/a.json")).toThrow(RangeError);
    expect(() => parseEmbedParams("?spec=//example.com/a.json")).toThrow(RangeError);
    expect(() => parseEmbedParams("")).toThrow(RangeError);
  });

  it("rejects bad numbers, colors and boxes", () => {
    expect(() => parseEmbedParams("?spec=/a.json&width=9999")).toThrow(RangeError);
    expect(() => parseEmbedParams("?spec=/a.json&bg=red")).toThrow(RangeError);
    expect(() => parseEmbedParams("?spec=/a.json&fit=0.5,0.5,0.4,0.9")).toThrow(RangeError);
    expect(() => parseEmbedParams("?spec=/a.json&fit=0,0,1")).toThrow(RangeError);
    expect(() => parseEmbedParams("?spec=/a.json&pitch=90")).toThrow(RangeError);
  });
});
