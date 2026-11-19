import type { Picture } from "./png.js";

/** How far two pictures of one size are apart. */
export interface Difference {
  /** Pixels where any channel differs. */
  readonly changedPixels: number;
  readonly pixels: number;
  /** The largest difference in one channel, 0 to 255. */
  readonly maxChannel: number;
  /** The mean difference over every channel of every pixel, 0 to 255. */
  readonly meanChannel: number;
}

/** Compares two pictures pixel by pixel. Pictures of different sizes are not comparable: that is an error, not a difference. */
export function difference(a: Picture, b: Picture): Difference {
  if (a.width !== b.width || a.height !== b.height) throw new RangeError(`pictures differ in size: ${String(a.width)}x${String(a.height)} and ${String(b.width)}x${String(b.height)}`);
  const pixels = a.width * a.height;
  let changedPixels = 0;
  let maxChannel = 0;
  let sum = 0;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    let changed = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs((a.rgba[pixel * 4 + channel] ?? 0) - (b.rgba[pixel * 4 + channel] ?? 0));
      if (delta === 0) continue;
      changed = true;
      sum += delta;
      if (delta > maxChannel) maxChannel = delta;
    }
    if (changed) changedPixels += 1;
  }
  return { changedPixels, pixels, maxChannel, meanChannel: pixels === 0 ? 0 : sum / (pixels * 4) };
}
