import type { z } from "zod";
import { orderStack, screenEffectSchemas, type ScreenEffectConfig, type ScreenEffectId } from "./effects.js";

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

/** Every parameter of every screen effect, as its schema parses it. */
export type ScreenEffectValues = { [Id in ScreenEffectId]: z.output<(typeof screenEffectSchemas)[Id]> };

/** New values for some parameters of some effects in the stack: what `ScreenEffects.setParams` takes. */
export type ScreenEffectUpdate = { [Id in ScreenEffectId]?: Partial<ScreenEffectValues[Id]> };

/** The parameters in force for the effects in a stack, each complete (defaults filled in). */
export type StackValues = { [Id in ScreenEffectId]?: ScreenEffectValues[Id] | undefined };

/** Every parameter of every effect in `stack`, defaults filled in, in the order the stack runs. */
export function resolveValues(stack: readonly ScreenEffectConfig[]): StackValues {
  const values: StackValues = {};
  for (const effect of orderStack(stack)) {
    switch (effect.id) {
      case "dither":
        values.dither = screenEffectSchemas.dither.parse(effect.params ?? {});
        break;
      case "ascii":
        values.ascii = screenEffectSchemas.ascii.parse(effect.params ?? {});
        break;
      case "grain":
        values.grain = screenEffectSchemas.grain.parse(effect.params ?? {});
        break;
      case "scan":
        values.scan = screenEffectSchemas.scan.parse(effect.params ?? {});
        break;
      case "lens":
        values.lens = screenEffectSchemas.lens.parse(effect.params ?? {});
        break;
      case "crystallize":
        values.crystallize = screenEffectSchemas.crystallize.parse(effect.params ?? {});
        break;
      case "smoke":
        values.smoke = screenEffectSchemas.smoke.parse(effect.params ?? {});
        break;
      case "crt":
        values.crt = screenEffectSchemas.crt.parse(effect.params ?? {});
        break;
    }
  }
  return values;
}

/** The effects that print: they share one pass (two when dither and ASCII both print the whole frame). */
export type PrintId = "crystallize" | "dither" | "ascii" | "scan" | "lens";
const printIds: readonly ScreenEffectId[] = ["crystallize", "dither", "ascii", "scan", "lens"];

export function isPrintId(id: ScreenEffectId): id is PrintId {
  return printIds.includes(id);
}

const ditherPart = (p: ScreenEffectValues["dither"]): PrintSettings => ({ values: { ...resting, uBase: 1, uDitherPx: p.cell, uGrain: p.grain }, ramp: RAMP, lens: false });
const asciiPart = (p: ScreenEffectValues["ascii"]): PrintSettings => ({ values: { ...resting, uBase: 2, uAsciiPx: p.cell, uGrain: p.grain }, ramp: p.ramp, lens: false });
const lensPart = (p: ScreenEffectValues["lens"]): PrintSettings => ({ values: { ...resting, uLensRadius: p.radius, uLensDepth: p.depth }, ramp: RAMP, lens: true });
const scanPart = (p: ScreenEffectValues["scan"], reduced: boolean): PrintSettings => {
  const values = { ...resting, uScanDepth: p.depth };
  return reduced ? { values, ramp: RAMP, lens: false } : { values, ramp: RAMP, lens: false, scan: { period: Math.max(p.period, p.sweep), sweep: p.sweep } };
};
const crystallizePart = (p: ScreenEffectValues["crystallize"], reduced: boolean): PrintSettings => {
  if (reduced) return { values: resting, ramp: RAMP, lens: false };
  const values = { ...resting, uIntro: 0, uAppear: 0 };
  return p.period > 0 ? { values, ramp: RAMP, lens: false, intro: p.intro, scan: { period: Math.max(p.period, 1.8), sweep: 1.8 } } : { values, ramp: RAMP, lens: false, intro: p.intro };
};

/** How one print effect alone sets a pass up. With reduced motion there is no intro and no sweep. */
export function printSettings(effect: ScreenEffectConfig, reduced: boolean): PrintSettings {
  switch (effect.id) {
    case "dither":
      return ditherPart(screenEffectSchemas.dither.parse(effect.params ?? {}));
    case "ascii":
      return asciiPart(screenEffectSchemas.ascii.parse(effect.params ?? {}));
    case "scan":
      return scanPart(screenEffectSchemas.scan.parse(effect.params ?? {}), reduced);
    case "lens":
      return lensPart(screenEffectSchemas.lens.parse(effect.params ?? {}));
    case "crystallize":
      return crystallizePart(screenEffectSchemas.crystallize.parse(effect.params ?? {}), reduced);
    case "smoke":
    case "grain":
    case "crt":
      throw new Error(`${effect.id} is not a print effect`);
  }
}

/**
 * How a stack's print effects divide into passes, each a list of effects in canonical order. One pass
 * takes them all, since a pass can raise the stylization level everywhere (dither, ASCII), over time
 * (crystallize), in a band (scan) and under the pointer (lens) at once and print the highest level
 * each pixel asks for. A second pass only when dither and ASCII both print the whole frame: the ASCII
 * pass then reads the dithered frame, as the stack did when every effect was its own pass.
 */
export function printGroups(ids: readonly ScreenEffectId[]): readonly (readonly PrintId[])[] {
  const prints = ids.filter(isPrintId);
  if (prints.length === 0) return [];
  if (!prints.includes("dither") || !prints.includes("ascii")) return [prints];
  // Canonical order puts the intro and the dither ahead of the ASCII, the sweep and the lens.
  return [prints.filter((id) => id === "crystallize" || id === "dither"), prints.filter((id) => id !== "crystallize" && id !== "dither")];
}

/**
 * The settings of one pass that does the work of the effects in `members` (print effects, with their
 * parameters in `values`). Each setting comes from the effect that owns it: the level everywhere is the
 * highest asked for, the intro and the sweep come from crystallize and scan (scan's own timing if both
 * sweep), the loupe from lens, the cell sizes and ramp from dither and ASCII, and the grain from the
 * highest full-frame level.
 */
export function mergePrintSettings(values: StackValues, members: readonly PrintId[], reduced: boolean): PrintSettings {
  const dither = members.includes("dither") && values.dither !== undefined ? ditherPart(values.dither) : undefined;
  const ascii = members.includes("ascii") && values.ascii !== undefined ? asciiPart(values.ascii) : undefined;
  const scan = members.includes("scan") && values.scan !== undefined ? scanPart(values.scan, reduced) : undefined;
  const lens = members.includes("lens") && values.lens !== undefined ? lensPart(values.lens) : undefined;
  const crystallize = members.includes("crystallize") && values.crystallize !== undefined ? crystallizePart(values.crystallize, reduced) : undefined;
  const grained = ascii ?? dither;
  const sweeping = scan?.scan === undefined ? crystallize : scan;
  const merged: PrintValues = {
    ...resting,
    uBase: Math.max(0, dither?.values.uBase ?? 0, ascii?.values.uBase ?? 0),
    uIntro: crystallize?.values.uIntro ?? 1,
    uAppear: crystallize?.values.uAppear ?? 1,
    uScanDepth: scan?.values.uScanDepth ?? resting.uScanDepth,
    uLensRadius: lens?.values.uLensRadius ?? resting.uLensRadius,
    uLensDepth: lens?.values.uLensDepth ?? resting.uLensDepth,
    uGrain: grained?.values.uGrain ?? resting.uGrain,
    uDitherPx: dither?.values.uDitherPx ?? resting.uDitherPx,
    uAsciiPx: ascii?.values.uAsciiPx ?? resting.uAsciiPx,
  };
  return {
    values: merged,
    ramp: ascii?.ramp ?? RAMP,
    ...(crystallize?.intro === undefined ? {} : { intro: crystallize.intro }),
    ...(sweeping?.scan === undefined ? {} : { scan: sweeping.scan }),
    lens: lens !== undefined,
  };
}
