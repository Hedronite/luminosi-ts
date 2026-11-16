import { screenEffectSchemas, type ScreenEffectConfig } from "./effects.js";

/** The print pass's numeric uniforms. Stylization level: 0 the clean render, 1 dither, 2 ASCII. */
interface PrintValues {
  /** The level everywhere. */
  readonly uBase: number;
  /** Intro progress: 0 is fully printed as ASCII, 1 is settled. */
  readonly uIntro: number;
  /** Intro scatter: how many ASCII cells have appeared, 0 to 1. */
  readonly uAppear: number;
  /** The scan band's height on screen, 0 to 1, or -1 when no sweep is running. */
  readonly uScan: number;
  readonly uScanDepth: number;
  readonly uLens: number;
  readonly uLensRadius: number;
  readonly uLensDepth: number;
  readonly uGrain: number;
  readonly uDitherPx: number;
  readonly uAsciiPx: number;
}

export interface PrintSettings {
  readonly values: PrintValues;
  readonly ramp: string;
  /** Seconds the intro takes, when there is one. */
  readonly intro?: number;
  /** Seconds between sweeps and per sweep, when it sweeps. */
  readonly scan?: { readonly period: number; readonly sweep: number };
  /** Whether it follows the pointer. */
  readonly lens: boolean;
}

const RAMP = " .,:;-=+*xo%#@";
const resting: PrintValues = { uBase: 0, uIntro: 1, uAppear: 1, uScan: -1, uScanDepth: 2, uLens: 0, uLensRadius: 118, uLensDepth: 1, uGrain: 0.07, uDitherPx: 3, uAsciiPx: 11 };

/** How a print effect sets the pass up. With reduced motion there is no intro and no sweep. */
export function printSettings(effect: ScreenEffectConfig, reduced: boolean): PrintSettings {
  switch (effect.id) {
    case "dither": {
      const p = screenEffectSchemas.dither.parse(effect.params ?? {});
      return { values: { ...resting, uBase: 1, uDitherPx: p.cell, uGrain: p.grain }, ramp: RAMP, lens: false };
    }
    case "ascii": {
      const p = screenEffectSchemas.ascii.parse(effect.params ?? {});
      return { values: { ...resting, uBase: 2, uAsciiPx: p.cell, uGrain: p.grain }, ramp: p.ramp, lens: false };
    }
    case "scan": {
      const p = screenEffectSchemas.scan.parse(effect.params ?? {});
      const values = { ...resting, uScanDepth: p.depth };
      return reduced ? { values, ramp: RAMP, lens: false } : { values, ramp: RAMP, lens: false, scan: { period: Math.max(p.period, p.sweep), sweep: p.sweep } };
    }
    case "lens": {
      const p = screenEffectSchemas.lens.parse(effect.params ?? {});
      return { values: { ...resting, uLensRadius: p.radius, uLensDepth: p.depth }, ramp: RAMP, lens: true };
    }
    case "crystallize": {
      const p = screenEffectSchemas.crystallize.parse(effect.params ?? {});
      if (reduced) return { values: resting, ramp: RAMP, lens: false };
      const values = { ...resting, uIntro: 0, uAppear: 0 };
      return p.period > 0 ? { values, ramp: RAMP, lens: false, intro: p.intro, scan: { period: Math.max(p.period, 1.8), sweep: 1.8 } } : { values, ramp: RAMP, lens: false, intro: p.intro };
    }
    case "smoke":
    case "grain":
      throw new Error(`${effect.id} is not a print effect`);
  }
}
