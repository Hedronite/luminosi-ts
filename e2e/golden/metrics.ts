import { difference, type Difference } from "../../tools/stills/src/diff.js";
import type { Picture } from "../../tools/stills/src/png.js";

/**
 * How the golden check measures a frame against its golden.
 *
 * Strict (the real GPU, the machine the goldens were made on): the frames are byte-identical from run to run, so the bar is the noise, which is none.
 * Loose (software WebGL in CI, a different renderer from the one that made the goldens): the two pictures are compared coarsely, in
 * 16 by 16 blocks, on three numbers, so an edge drawn a pixel differently or a gradient rounded another way does not count and a
 * missing, moved or recoloured subject does.
 */

/**
 * The strict check counts a pixel changed when any channel differs at all (the rig's `difference`, a per-pixel threshold of zero) and
 * fails when any pixel did: two runs of the rig on one machine never differ by a pixel (STACK.md, "Still frames"), so the bar is the noise, which is none.
 */
const STRICT_CHANGED_PIXELS = 0;

/** What the stage's background is, so the rig's subject can be told from it: the neutral look's raised surface, #f5f5f5. */
const BACKGROUND = 245;
/** A pixel belongs to the subject when a channel is this far from the background. */
const COVERAGE_STEP = 16;
/** The picture is compared in this many blocks a side (32 pixels of the rig's 512). */
const BLOCKS = 16;

/**
 * The loose bars: a frame fails above any of them. Each is the largest distance any asset's SwiftShader frame measured from its golden
 * on the tree they were made on (tone 0.183, local 2.567, coverage 0.003; e2e/golden measurements in STACK.md, "Golden images"),
 * times a margin of about 1.5, so a different machine's software renderer can differ by half as much again and still pass. Every plant
 * (blank, recoloured, missing part, moved camera) measured at least 2.1 times those maxima on one of the three, for every asset.
 */
const LOOSE_BAR = { tone: 0.28, local: 3.9, coverage: 0.005 } as const;

/**
 * Two screen effects measured further from their golden on the CI runner (Linux) than on the machine the bars came from: ascii (tone 0.439,
 * coverage 0.0205) and crystallize (tone 0.263, coverage 0.0055), against 0.19 and 0.0033 for every other asset. Their bars are the CI run's own
 * distances times about 1.5, for the numbers that exceeded the common bar. Every plant still fails them (STACK.md, "Golden images"), the
 * ascii plants by the least: a moved camera 1.04 times and a missing part 1.12 times its bar.
 */
const LOOSE_OVERRIDES: Readonly<Record<string, Partial<Record<keyof typeof LOOSE_BAR, number>>>> = {
  ascii: { tone: 0.66, coverage: 0.031 },
  crystallize: { tone: 0.4, coverage: 0.0083 },
};

export const strictDistance = difference;

export const strictFails = (distance: Difference): boolean => distance.changedPixels > STRICT_CHANGED_PIXELS;

export interface LooseDistance {
  /** Mean over the blocks of the difference in the block's mean colour (mean of the three channels), 0 to 255: the picture as a whole. */
  readonly tone: number;
  /** The largest such difference in any one block, 0 to 255: a part of the picture. */
  readonly local: number;
  /** Mean over the blocks of the difference in subject coverage (the share of the block that is not background), 0 to 1. */
  readonly coverage: number;
}

interface Blocked {
  readonly color: Float64Array;
  readonly cover: Float64Array;
}

function blocked(picture: Picture): Blocked {
  if (picture.width % BLOCKS !== 0 || picture.height % BLOCKS !== 0) throw new RangeError(`a ${String(picture.width)}x${String(picture.height)} picture does not divide into ${String(BLOCKS)} blocks`);
  const across = picture.width / BLOCKS;
  const down = picture.height / BLOCKS;
  const color = new Float64Array(BLOCKS * BLOCKS * 3);
  const cover = new Float64Array(BLOCKS * BLOCKS);
  for (let y = 0; y < picture.height; y += 1) {
    for (let x = 0; x < picture.width; x += 1) {
      const block = Math.floor(y / down) * BLOCKS + Math.floor(x / across);
      const at = (y * picture.width + x) * 4;
      let away = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        const value = picture.rgba[at + channel] ?? 0;
        color[block * 3 + channel] = (color[block * 3 + channel] ?? 0) + value;
        away = Math.max(away, Math.abs(value - BACKGROUND));
      }
      if (away > COVERAGE_STEP) cover[block] = (cover[block] ?? 0) + 1;
    }
  }
  const area = across * down;
  return { color: color.map((sum) => sum / area), cover: cover.map((count) => count / area) };
}

export function looseDistance(frame: Picture, golden: Picture): LooseDistance {
  sameSize(frame, golden);
  const a = blocked(frame);
  const b = blocked(golden);
  let tone = 0;
  let local = 0;
  let coverage = 0;
  for (let block = 0; block < BLOCKS * BLOCKS; block += 1) {
    let step = 0;
    for (let channel = 0; channel < 3; channel += 1) step += Math.abs((a.color[block * 3 + channel] ?? 0) - (b.color[block * 3 + channel] ?? 0)) / 3;
    tone += step;
    local = Math.max(local, step);
    coverage += Math.abs((a.cover[block] ?? 0) - (b.cover[block] ?? 0));
  }
  return { tone: tone / (BLOCKS * BLOCKS), local, coverage: coverage / (BLOCKS * BLOCKS) };
}

export function looseFails(distance: LooseDistance, asset?: string): boolean {
  const bar = { ...LOOSE_BAR, ...(asset === undefined ? {} : LOOSE_OVERRIDES[asset]) };
  return distance.tone > bar.tone || distance.local > bar.local || distance.coverage > bar.coverage;
}

function sameSize(a: Picture, b: Picture): void {
  if (a.width !== b.width || a.height !== b.height) throw new RangeError(`pictures differ in size: ${String(a.width)}x${String(a.height)} and ${String(b.width)}x${String(b.height)}`);
}
