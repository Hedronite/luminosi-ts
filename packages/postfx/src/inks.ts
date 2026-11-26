import { BLACK, mixHex, WHITE, type Hex, type ScenePalette } from "@hedronite/lts-tokens";

export { mixHex };

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

// Pure luminance mix endpoints (tokens BLACK/WHITE) anchor the dark/light ramp extremes for any print hue.
const ramp = (mid: Hex): readonly [Hex, Hex, Hex] => [mixHex(mid, BLACK, 0.55), mid, mixHex(mid, WHITE, 0.5)];

/**
 * Inks from a token preset's scene colors. With the Hedronite preset this gives the hedronite.com
 * inks: lapis (#1b2962, #3b5bd9, #9dadec) and copper (#56371e, #c07b42, #e0bda1).
 */
export function inksFor(scene: ScenePalette, options: InkOptions = {}): Inks {
  const cool = options.monochrome ?? options.cool ?? scene.emissive;
  const warm = options.monochrome ?? options.warm ?? scene.accent;
  return { cool: ramp(cool), warm: ramp(warm), hot: mixHex(warm, WHITE, 0.88), rule: mixHex(warm, WHITE, 0.5), chroma: options.monochrome === undefined ? 0.35 : 0 };
}
