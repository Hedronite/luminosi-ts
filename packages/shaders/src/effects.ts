import { neutral, type ScenePalette } from "@hedronite/lts-tokens";
import {
  abs,
  dot,
  float,
  floor,
  mix,
  mx_noise_float,
  normalView,
  oneMinus,
  positionLocal,
  positionViewDirection,
  pow,
  saturate,
  screenUV,
  sin,
  smoothstep,
  step,
  time,
  uniform,
  viewportSharedTexture,
} from "three/tsl";
import { AdditiveBlending, Color, DoubleSide, MeshBasicNodeMaterial, MeshStandardNodeMaterial, Vector3, type NodeMaterial } from "three/webgpu";
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
}

export const effectInfo: Record<EffectId, EffectInfo> = {
  dissolve: { name: "Dissolve", tags: ["animated", "noise", "transition"], animated: true },
  "fresnel-glow": { name: "Fresnel glow", tags: ["rim", "glow"] },
  "height-gradient": { name: "Height gradient", tags: ["gradient", "color"] },
  hologram: { name: "Hologram", tags: ["animated", "transparent", "scanlines"], animated: true, seeThrough: true },
  pulse: { name: "Pulse", tags: ["animated", "emissive"], animated: true },
  refraction: { name: "Refraction", tags: ["transparent", "glass", "screen-space"], seeThrough: true },
  toon: { name: "Toon outline", tags: ["stylized", "outline", "flat"] },
};

/** Lights the rim of a surface, where it turns away from the viewer. */
export function createFresnelGlowMaterial(params: EffectParams<"fresnel-glow"> = {}, palette: ScenePalette = neutral.scene): MeshStandardNodeMaterial {
  const p = effectSchemas["fresnel-glow"].parse(params);
  const material = new MeshStandardNodeMaterial({ name: "fresnel-glow", color: new Color(p.base ?? palette.base), roughness: 0.5 });
  const facing = saturate(dot(normalView, positionViewDirection));
  material.emissiveNode = uniform(new Color(p.glow ?? palette.emissive)).mul(pow(oneMinus(facing), p.power)).mul(p.intensity);
  return material;
}

/** Blends two colors from bottom to top in the object's own space. */
export function createHeightGradientMaterial(params: EffectParams<"height-gradient"> = {}, palette: ScenePalette = neutral.scene): MeshStandardNodeMaterial {
  const p = effectSchemas["height-gradient"].parse(params);
  if (p.minY >= p.maxY) throw new RangeError(`minY (${String(p.minY)}) must be below maxY (${String(p.maxY)})`);
  const material = new MeshStandardNodeMaterial({ name: "height-gradient", roughness: 0.45 });
  material.colorNode = mix(uniform(new Color(p.bottom ?? palette.base)), uniform(new Color(p.top ?? palette.accent)), smoothstep(p.minY, p.maxY, positionLocal.y));
  return material;
}

/** Glows in and out over time. Needs continuous rendering while visible. */
export function createPulseMaterial(params: EffectParams<"pulse"> = {}, palette: ScenePalette = neutral.scene): MeshStandardNodeMaterial {
  const p = effectSchemas.pulse.parse(params);
  const glow = new Color(p.color ?? palette.emissive);
  const material = new MeshStandardNodeMaterial({ name: "pulse", color: glow.clone().multiplyScalar(0.3), roughness: 0.6 });
  material.emissiveNode = uniform(glow).mul(sin(time.mul(p.speed)).mul(0.5).add(0.5)).mul(p.intensity);
  return material;
}

/**
 * Flat light bands with an ink line at the silhouette, unlit, so it reads the same in any lighting.
 * The line comes from how far the surface turns away from the viewer, so smooth shapes get the cleanest
 * lines; flat-faced ones ink whole faces near the edge.
 */
export function createToonMaterial(params: EffectParams<"toon"> = {}, palette: ScenePalette = neutral.scene): MeshBasicNodeMaterial {
  const p = effectSchemas.toon.parse(params);
  const material = new MeshBasicNodeMaterial({ name: "toon" });
  const color = uniform(new Color(p.color ?? palette.accent));
  // A fixed key light from the upper right, in view space, so the bands don't swim as the view turns.
  const light = uniform(new Vector3(0.5, 0.7, 0.6).normalize());
  const lit = saturate(dot(normalView, light));
  const band = saturate(floor(lit.mul(p.bands)).div(p.bands - 1));
  const shade = mix(color.mul(0.35), color, band);
  const facing = saturate(dot(normalView, positionViewDirection));
  material.colorNode = mix(shade, uniform(new Color(p.ink ?? "#000000")), step(facing, p.outline));
  return material;
}

/**
 * Bends whatever was drawn behind the surface, read back from the screen, and tints it. Cheaper than
 * physical transmission and works on any background, but it can only bend what is already on screen.
 */
export function createRefractionMaterial(params: EffectParams<"refraction"> = {}, palette: ScenePalette = neutral.scene): MeshStandardNodeMaterial {
  const p = effectSchemas.refraction.parse(params);
  // Transparent so it draws after the opaque scene it reads from.
  const material = new MeshStandardNodeMaterial({ name: "refraction", roughness: 0.05, metalness: 0, transparent: true });
  const behind = viewportSharedTexture(screenUV.add(normalView.xy.mul(-p.strength))).rgb;
  material.backdropNode = behind.mul(uniform(new Color(p.tint ?? palette.glass)));
  material.backdropAlphaNode = float(p.clarity);
  return material;
}

/** Eats the surface away along a noise field, with a glowing edge where it burns. Animates unless `progress` is set. */
export function createDissolveMaterial(params: EffectParams<"dissolve"> = {}, palette: ScenePalette = neutral.scene): MeshStandardNodeMaterial {
  const p = effectSchemas.dissolve.parse(params);
  const material = new MeshStandardNodeMaterial({ name: "dissolve", color: new Color(p.color ?? palette.base), roughness: 0.5, side: DoubleSide, alphaTest: 0.5 });
  // MaterialX noise sits mostly within ±0.7; map it near 0 to 1.
  const noise = mx_noise_float(positionLocal.mul(p.scale)).mul(0.6).add(0.5);
  // Animated, it swings between nearly whole and about two-thirds gone, so the shape always reads.
  const threshold = p.progress === undefined ? sin(time.mul(p.speed)).mul(0.25).add(0.4) : float(p.progress);
  material.opacityNode = step(threshold, noise);
  const burn = oneMinus(smoothstep(0, p.edgeWidth, noise.sub(threshold)));
  material.emissiveNode = uniform(new Color(p.edge ?? palette.emissive)).mul(burn).mul(3);
  return material;
}

/** See-through and additive, brightest at the rim, with scan lines climbing it and a faint flicker. */
export function createHologramMaterial(params: EffectParams<"hologram"> = {}, palette: ScenePalette = neutral.scene): MeshBasicNodeMaterial {
  const p = effectSchemas.hologram.parse(params);
  const material = new MeshBasicNodeMaterial({ name: "hologram", transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  const rim = pow(oneMinus(saturate(abs(dot(normalView, positionViewDirection)))), 2);
  const lines = smoothstep(0.2, 0.8, sin(positionLocal.y.mul(p.density).add(time.mul(p.speed))).mul(0.5).add(0.5));
  const flicker = sin(time.mul(23)).mul(0.04).add(0.96);
  material.colorNode = uniform(new Color(p.color ?? palette.emissive)).mul(p.intensity);
  material.opacityNode = rim.mul(0.8).add(0.15).mul(lines.mul(0.6).add(0.4)).mul(flicker);
  return material;
}

/** The material for any effect id, with its default parameters. */
export function createEffectMaterial(id: EffectId, palette: ScenePalette = neutral.scene): NodeMaterial {
  switch (id) {
    case "dissolve":
      return createDissolveMaterial({}, palette);
    case "hologram":
      return createHologramMaterial({}, palette);
    case "refraction":
      return createRefractionMaterial({}, palette);
    case "toon":
      return createToonMaterial({}, palette);
    case "fresnel-glow":
      return createFresnelGlowMaterial({}, palette);
    case "height-gradient":
      return createHeightGradientMaterial({}, palette);
    case "pulse":
      return createPulseMaterial({}, palette);
  }
}
