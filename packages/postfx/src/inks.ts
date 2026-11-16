import { parseHex, type Hex, type ScenePalette } from "@hedronite/lts-tokens";

/**
 * The inks a print uses: a cool ramp for pixels that lean blue, a warm ramp for those that lean red,
 * a hot white for the brightest, and the rule color for the scan hairline and the lens ring.
 * Each ramp runs dark, mid, light.
 */
export interface Inks {
  readonly cool: readonly [Hex, Hex, Hex];
  readonly warm: readonly [Hex, Hex, Hex];
  readonly hot: Hex;
  readonly rule: Hex;
  /** How far an ASCII glyph leans toward the source's own color: some for two inks, none for one. */
  readonly chroma: number;
}

export interface InkOptions {
  /** The cool ink's mid tone. Default: the scene's emissive color. */
  readonly cool?: Hex;
  /** The warm ink's mid tone. Default: the scene's accent color. */
  readonly warm?: Hex;
  /** Print in one ink only, like a single-color screen print. Overrides cool and warm. */
  readonly monochrome?: Hex;
}

const toHex = (rgb: readonly [number, number, number]): Hex =>
  `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;

/** Mixes two colors in sRGB: t = 0 is `a`, t = 1 is `b`. */
export function mixHex(a: Hex, b: Hex, t: number): Hex {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

const ramp = (mid: Hex): readonly [Hex, Hex, Hex] => [mixHex(mid, "#000000", 0.55), mid, mixHex(mid, "#ffffff", 0.5)];

/**
 * Inks from a token preset's scene colors. With the Hedronite preset this gives the hedronite.com
 * inks: lapis (#1b2962, #3b5bd9, #9dadec) and copper (#56371e, #c07b42, #e0bda1).
 */
export function inksFor(scene: ScenePalette, options: InkOptions = {}): Inks {
  const cool = options.monochrome ?? options.cool ?? scene.emissive;
  const warm = options.monochrome ?? options.warm ?? scene.accent;
  return { cool: ramp(cool), warm: ramp(warm), hot: mixHex(warm, "#ffffff", 0.88), rule: mixHex(warm, "#ffffff", 0.5), chroma: options.monochrome === undefined ? 0.35 : 0 };
}
