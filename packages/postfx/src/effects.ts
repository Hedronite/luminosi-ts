import { z } from "zod";

/**
 * Screen effects: passes over the rendered frame, ported from hedronite.com's crystal pass (dither,
 * ASCII, the scan sweep, the lens and the load-time crystallization) and its smoke field. Each takes
 * its inks from the token preset, so the Hedronite look prints lapis and copper and any other look
 * prints in its own colors.
 */
export const screenEffectSchemas = {
  dither: z.object({
    /** Dot cell size in CSS pixels. */
    cell: z.number().min(2).max(12).default(3),
    grain: z.number().min(0).max(0.3).default(0.07),
  }),
  ascii: z.object({
    /** Glyph cell size in CSS pixels. */
    cell: z.number().min(6).max(32).default(11),
    /** Glyphs from faintest to densest; the first is blank. */
    ramp: z
      .string()
      .min(2)
      .max(32)
      .regex(/^[\x20-\x7e]+$/, "printable ASCII only")
      .default(" .,:;-=+*xo%#@"),
    grain: z.number().min(0).max(0.3).default(0.05),
  }),
  grain: z.object({
    amount: z.number().min(0).max(0.5).default(0.06),
  }),
  scan: z.object({
    /** Seconds from one sweep to the next. */
    period: z.number().min(1).max(60).default(9),
    /** Seconds a sweep takes to cross the frame. */
    sweep: z.number().min(0.3).max(10).default(1.8),
    /** What the band prints at its heart: 1 dither, 2 ASCII (with dither at its edges). */
    depth: z.union([z.literal(1), z.literal(2)]).default(2),
  }),
  lens: z.object({
    /** Loupe radius in CSS pixels. */
    radius: z.number().min(24).max(400).default(118),
    /** What the loupe prints: 1 dither, 2 ASCII. */
    depth: z.union([z.literal(1), z.literal(2)]).default(1),
  }),
  crystallize: z.object({
    /** Seconds for the whole intro: scattered ASCII settling through dither into the clean render. */
    intro: z.number().min(1).max(15).default(3.5),
    /** Seconds between scan sweeps once it has settled; 0 for none. */
    period: z.number().min(0).max(60).default(9),
  }),
  smoke: z.object({
    speed: z.number().min(0).max(4).default(1),
    intensity: z.number().min(0).max(3).default(1),
  }),
  crt: z.object({
    /** How far the glass bulges: 0 is a flat screen. */
    curvature: z.number().min(0).max(2).default(1),
    /** CSS pixels from one scan line to the next; the shadow-mask triads are 2.75 times as wide. */
    pitch: z.number().min(1.5).max(8).default(2),
    /** How far red and blue split toward the corners. */
    aberration: z.number().min(0).max(4).default(1),
    /** The rolling bar, line crawl and flicker. 0 holds the picture still. */
    motion: z.number().min(0).max(1).default(1),
  }),
} as const;

export type ScreenEffectId = keyof typeof screenEffectSchemas;
export type ScreenEffectParams<Id extends ScreenEffectId> = z.input<(typeof screenEffectSchemas)[Id]>;

export function isScreenEffectId(id: string): id is ScreenEffectId {
  return Object.hasOwn(screenEffectSchemas, id);
}

/** Every screen effect, in the order passes are stacked: smoke behind, prints, then grain on top. */
export const screenEffectIds: readonly ScreenEffectId[] = ["smoke", "crystallize", "dither", "ascii", "scan", "lens", "crt", "grain"];

export interface ScreenEffectInfo {
  readonly name: string;
  readonly tags: readonly string[];
  /** Follows the pointer (or a tap). */
  readonly interactive?: boolean;
  /** Changes over time, so it needs continuous rendering while visible. */
  readonly animated?: boolean;
  /** The day it joined the library (YYYY-MM-DD). Default: 2026-11-15, when the first effects landed. */
  readonly added?: string;
  /** Set when it was ported from open-source work in assets/vendor. */
  readonly origin?: { readonly vendor: string; readonly path: string; readonly note: string };
}

export const screenEffectInfo: Record<ScreenEffectId, ScreenEffectInfo> = {
  smoke: { name: "Smoke", tags: ["noise", "background", "fbm"], animated: true },
  crystallize: { name: "Crystallize", tags: ["intro", "ascii", "dither", "hedronite"], animated: true },
  dither: { name: "Dither", tags: ["bayer", "print", "dot-matrix"], animated: true },
  ascii: { name: "ASCII", tags: ["glyphs", "print", "terminal"], animated: true },
  scan: { name: "Scan sweep", tags: ["sweep", "ascii", "hedronite"], animated: true },
  lens: { name: "Lens", tags: ["loupe", "pointer", "hedronite"], interactive: true, animated: true },
  crt: {
    name: "CRT screen",
    tags: ["retro", "scanlines", "barrel", "chromatic-aberration"],
    animated: true,
    added: "2026-11-16",
    origin: {
      vendor: "threeui",
      path: "src/shaders/crt/crtShaders.ts",
      note: "The tube from ThreeUI's CRT background (barrel glass, RGB split, scan lines, aperture grille, rolling bar, vignette) as a TSL pass over any scene, tinted by the look's inks; its boot text is left behind.",
    },
  },
  grain: { name: "Film grain", tags: ["noise", "grain"], animated: true },
};

/** One effect in a stack, with optional parameters. */
export type ScreenEffectConfig = { [Id in ScreenEffectId]: { readonly id: Id; readonly params?: ScreenEffectParams<Id> } }[ScreenEffectId];

/** Puts a stack in canonical order (smoke behind, grain on top) and drops repeats, keeping the first of each. */
export function orderStack(stack: readonly ScreenEffectConfig[]): readonly ScreenEffectConfig[] {
  const first = new Map<ScreenEffectId, ScreenEffectConfig>();
  for (const effect of stack) if (!first.has(effect.id)) first.set(effect.id, effect);
  return [...first.values()].sort((a, b) => screenEffectIds.indexOf(a.id) - screenEffectIds.indexOf(b.id));
}
