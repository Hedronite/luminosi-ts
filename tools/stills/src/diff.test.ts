import { describe, expect, it } from "vitest";
import { difference } from "./diff.js";
import type { Picture } from "./png.js";

const picture = (width: number, height: number, rgba: readonly number[]): Picture => ({ width, height, rgba: Uint8Array.from(rgba) });

describe("difference", () => {
  it("finds nothing between a picture and itself", () => {
    const a = picture(2, 1, [1, 2, 3, 255, 4, 5, 6, 255]);
    expect(difference(a, a)).toEqual({ changedPixels: 0, pixels: 2, maxChannel: 0, meanChannel: 0 });
  });

  it("counts changed pixels, the largest channel step and the mean", () => {
    const a = picture(2, 1, [0, 0, 0, 255, 10, 10, 10, 255]);
    const b = picture(2, 1, [3, 0, 0, 255, 10, 10, 14, 255]);
    // two pixels differ; steps are 3 and 4 over 8 channels
    expect(difference(a, b)).toEqual({ changedPixels: 2, pixels: 2, maxChannel: 4, meanChannel: 7 / 8 });
  });

  it("refuses pictures of different sizes", () => {
    expect(() => difference(picture(1, 1, [0, 0, 0, 0]), picture(2, 1, [0, 0, 0, 0, 0, 0, 0, 0]))).toThrow("differ in size");
  });
});
