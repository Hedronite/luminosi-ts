import { expect, test } from "@playwright/test";
import type { Picture } from "../../tools/stills/src/png.js";
import { looseDistance, looseFails, looseRatio, MARGIN, strictDistance, strictFails } from "./metrics.js";

// A node-only spec (no page): the golden check's measures on pictures made up here.
const SIZE = 512;
const BACKGROUND = 245;

/** A background-coloured picture with a filled rectangle of `color` at (x, y). */
function picture(rectangle?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly color: readonly [number, number, number] }): Picture {
  const rgba = new Uint8Array(SIZE * SIZE * 4).fill(BACKGROUND);
  for (let at = 3; at < rgba.length; at += 4) rgba[at] = 255;
  if (rectangle !== undefined) {
    for (let y = rectangle.y; y < rectangle.y + rectangle.h; y += 1) {
      for (let x = rectangle.x; x < rectangle.x + rectangle.w; x += 1) rgba.set(rectangle.color, (y * SIZE + x) * 4);
    }
  }
  return { width: SIZE, height: SIZE, rgba };
}

const subject = { x: 160, y: 160, w: 128, h: 128, color: [120, 140, 200] } as const;

test("a picture is at no distance from itself, strictly or loosely", () => {
  const a = picture(subject);
  expect(strictFails(strictDistance(a, a))).toBe(false);
  expect(looseDistance(a, a)).toEqual({ tone: 0, local: 0, coverage: 0 });
});

test("the strict check fails on a single changed channel", () => {
  const a = picture(subject);
  const b = picture(subject);
  b.rgba[0] = 244;
  expect(strictDistance(a, b)).toMatchObject({ changedPixels: 1, maxChannel: 1 });
  expect(strictFails(strictDistance(a, b))).toBe(true);
});

test("the loose check ignores a one-pixel edge and fails a blank, a recolour, a missing part and a moved subject", () => {
  const golden = picture(subject);
  expect(looseFails(looseDistance(picture({ ...subject, w: 129 }), golden)), "an edge a pixel wider").toBe(false);
  expect(looseFails(looseDistance(picture(), golden)), "blank").toBe(true);
  expect(looseFails(looseDistance(picture({ ...subject, color: [200, 140, 120] }), golden)), "recoloured").toBe(true);
  expect(looseFails(looseDistance(picture({ ...subject, w: 64 }), golden)), "half missing").toBe(true);
  expect(looseFails(looseDistance(picture({ ...subject, x: 176, y: 170 }), golden)), "moved").toBe(true);
});

test("a named asset has its own loose bar, and the common bar holds for every other", () => {
  const golden = picture(subject);
  // Every other pixel one step lighter: a tone distance of 0.5, past the common bar (0.28) and inside ascii's.
  const grainy = picture(subject);
  for (let pixel = 0; pixel < SIZE * SIZE; pixel += 2) for (let channel = 0; channel < 3; channel += 1) grainy.rgba[pixel * 4 + channel] = (grainy.rgba[pixel * 4 + channel] ?? 0) + 1;
  const grain = looseDistance(grainy, golden);
  expect(grain.tone).toBeCloseTo(0.5, 5);
  expect(looseFails(grain, "any other asset")).toBe(true);
  expect(looseFails(grain, "ascii")).toBe(false);
  expect(looseRatio(grain, "ascii")).toBeCloseTo(0.5 / 0.55, 5);
  expect(looseRatio(grain)).toBeGreaterThan(MARGIN);
  // The named asset's bar is no escape from a blank canvas.
  expect(looseFails(looseDistance(picture(), golden), "ascii")).toBe(true);
});

test("pictures of different sizes are an error, not a distance", () => {
  const small: Picture = { width: 1, height: 1, rgba: new Uint8Array(4) };
  expect(() => looseDistance(small, picture())).toThrow("differ in size");
  expect(() => strictDistance(small, picture())).toThrow("differ in size");
});
