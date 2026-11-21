import type { OriginRelation } from "@hedronite/lts-core";
import { z } from "zod";

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

/** Parameters for each effect, validated where they enter. Colors default to the token preset's scene colors. */
export const effectSchemas = {
  "fresnel-glow": z.object({
    base: hex.optional(),
    glow: hex.optional(),
    /** Higher is a thinner rim. 0.5 to 8. */
    power: z.number().min(0.5).max(8).default(2.5),
    intensity: z.number().min(0).max(10).default(2),
  }),
  "height-gradient": z.object({
    bottom: hex.optional(),
    top: hex.optional(),
    minY: z.number().default(-1),
    maxY: z.number().default(1),
  }),
  pulse: z.object({
    color: hex.optional(),
    /** Radians per second. */
    speed: z.number().min(0).max(20).default(2),
    intensity: z.number().min(0).max(10).default(1.5),
  }),
  toon: z.object({
    color: hex.optional(),
    ink: hex.optional(),
    /** Flat light bands, darkest to lightest. */
    bands: z.number().int().min(2).max(6).default(3),
    /** How far in from the silhouette the ink line reaches. 0 is no line. */
    outline: z.number().min(0).max(0.6).default(0.3),
  }),
  refraction: z.object({
    tint: hex.optional(),
    /** How far the view behind bends, as a share of the screen. */
    strength: z.number().min(0).max(0.3).default(0.08),
    /** How much of what's behind shows through, against the surface's own lit color. */
    clarity: z.number().min(0).max(1).default(0.85),
  }),
  dissolve: z.object({
    color: hex.optional(),
    edge: hex.optional(),
    /** Noise frequency: higher breaks the surface into smaller pieces. */
    scale: z.number().min(0.5).max(12).default(3),
    edgeWidth: z.number().min(0.01).max(0.3).default(0.08),
    /** Radians per second while it animates. */
    speed: z.number().min(0).max(5).default(0.6),
    /** A fixed amount dissolved, 0 to 1. Without it the surface dissolves and re-forms over time. */
    progress: z.number().min(0).max(1).optional(),
  }),
  hologram: z.object({
    color: hex.optional(),
    /** Scan lines per unit of height. */
    density: z.number().min(5).max(400).default(40),
    /** How fast the lines climb, in radians per second. */
    speed: z.number().min(0).max(10).default(1.5),
    intensity: z.number().min(0).max(10).default(1.5),
  }),
  "soap-film": z.object({
    /** The pale sheen the film's colors sit in. Default: the scene's glass color. */
    tint: hex.optional(),
    /** How much of the interference rainbow shows against the pale sheen. 0 to 1. */
    color: z.number().min(0).max(1).default(0.4),
    /** Turns of the rainbow across the film's range of thickness. */
    bands: z.number().min(0.5).max(4).default(1.6),
    /** How fast the thickness swirls. */
    speed: z.number().min(0).max(1).default(0.025),
    /** How bright the film reads edge on. */
    sheen: z.number().min(0).max(1).default(0.3),
  }),
} as const;

export type EffectId = keyof typeof effectSchemas;
export type EffectParams<Id extends EffectId> = z.input<(typeof effectSchemas)[Id]>;

export function isEffectId(id: string): id is EffectId {
  return Object.hasOwn(effectSchemas, id);
}

export const effectIds: readonly EffectId[] = Object.keys(effectSchemas).filter(isEffectId).sort();

export interface EffectInfo {
  readonly name: string;
  readonly tags: readonly string[];
  /** Changes over time, so it needs continuous rendering while visible. */
  readonly animated?: boolean;
  /** Shows the scene behind it, so it reads only with something there. */
  readonly seeThrough?: boolean;
  /** The day it joined the library (YYYY-MM-DD). Default: 2026-11-15, when the first shaders landed. */
  readonly added?: string;
  /** Set when it was ported from open-source work in assets/vendor. */
  readonly origin?: { readonly vendor: string; readonly relation: OriginRelation; readonly path: string; readonly note: string };
}

export const effectInfo: Record<EffectId, EffectInfo> = {
  dissolve: { name: "Dissolve", tags: ["animated", "noise", "transition"], animated: true },
  "fresnel-glow": { name: "Fresnel glow", tags: ["rim", "glow"] },
  "height-gradient": { name: "Height gradient", tags: ["gradient", "color"] },
  hologram: { name: "Hologram", tags: ["animated", "transparent", "scanlines"], animated: true, seeThrough: true },
  pulse: { name: "Pulse", tags: ["animated", "emissive"], animated: true },
  "soap-film": {
    name: "Soap film",
    tags: ["animated", "transparent", "iridescent", "thin-film"],
    animated: true,
    seeThrough: true,
    added: "2026-11-16",
    origin: {
      vendor: "codevember-2026",
      relation: "ported",
      path: "07/src/Balloon.tsx",
      note: "The soap film from Hollow's balloon (a thin-film rainbow set by a swirling thickness that thins toward the rim, over a pale sheen) for any surface, without the paint; a key-light glint stands in for its studio map.",
    },
  },
  refraction: { name: "Refraction", tags: ["transparent", "glass", "screen-space"], seeThrough: true },
  toon: { name: "Toon outline", tags: ["stylized", "outline", "flat"] },
};
