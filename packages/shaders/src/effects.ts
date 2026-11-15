import { neutral, type ScenePalette } from "@hedronite/lts-tokens";
import { dot, mix, normalView, oneMinus, positionLocal, positionViewDirection, pow, saturate, sin, smoothstep, time, uniform } from "three/tsl";
import { Color, MeshStandardNodeMaterial } from "three/webgpu";
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
} as const;

export type EffectId = keyof typeof effectSchemas;
export type EffectParams<Id extends EffectId> = z.input<(typeof effectSchemas)[Id]>;

export function isEffectId(id: string): id is EffectId {
  return Object.hasOwn(effectSchemas, id);
}

export const effectIds: readonly EffectId[] = Object.keys(effectSchemas).filter(isEffectId).sort();

export const effectInfo: Record<EffectId, { readonly name: string; readonly tags: readonly string[] }> = {
  "fresnel-glow": { name: "Fresnel glow", tags: ["rim", "glow"] },
  "height-gradient": { name: "Height gradient", tags: ["gradient", "color"] },
  pulse: { name: "Pulse", tags: ["animated", "emissive"] },
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

/** The material for any effect id, with its default parameters. */
export function createEffectMaterial(id: EffectId, palette: ScenePalette = neutral.scene): MeshStandardNodeMaterial {
  switch (id) {
    case "fresnel-glow":
      return createFresnelGlowMaterial({}, palette);
    case "height-gradient":
      return createHeightGradientMaterial({}, palette);
    case "pulse":
      return createPulseMaterial({}, palette);
  }
}
