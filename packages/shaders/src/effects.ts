import { neutral, type ScenePalette } from "@hedronite/lts-tokens";
import {
  abs,
  cos,
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
  reflectView,
  saturate,
  screenUV,
  sin,
  smoothstep,
  step,
  time,
  uniform,
  vec3,
  viewportSharedTexture,
} from "three/tsl";
import { AdditiveBlending, Color, DoubleSide, MeshBasicNodeMaterial, MeshStandardNodeMaterial, Vector3, type NodeMaterial } from "three/webgpu";
import { effectSchemas, type EffectId, type EffectParams } from "./info.js";

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

/** See-through and additive, brightest at the rim, with scan lines climbing it. Steady: nothing in it flashes. */
export function createHologramMaterial(params: EffectParams<"hologram"> = {}, palette: ScenePalette = neutral.scene): MeshBasicNodeMaterial {
  const p = effectSchemas.hologram.parse(params);
  const material = new MeshBasicNodeMaterial({ name: "hologram", transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  const rim = pow(oneMinus(saturate(abs(dot(normalView, positionViewDirection)))), 2);
  const lines = smoothstep(0.2, 0.8, sin(positionLocal.y.mul(p.density).add(time.mul(p.speed))).mul(0.5).add(0.5));
  material.colorNode = uniform(new Color(p.color ?? palette.emissive)).mul(p.intensity);
  material.opacityNode = rim.mul(0.8).add(0.15).mul(lines.mul(0.6).add(0.4));
  return material;
}

/**
 * A soap bubble's film: the rainbow of light bouncing between the film's two faces, its color set by how
 * thick the film is there, which swirls slowly and runs thinner toward the rim, over a faint pale sheen,
 * with a glint where it mirrors the key light. Clear, so it reads over something.
 *
 * Adopted from Codevember 2026 by Theo Tillberg (https://github.com/ttillberg/codevember-2026),
 * 07/src/Balloon.tsx (filmMaterial), under MIT. The upstream notice: assets/vendor/codevember-2026/LICENSE.
 */
export function createSoapFilmMaterial(params: EffectParams<"soap-film"> = {}, palette: ScenePalette = neutral.scene): MeshBasicNodeMaterial {
  const p = effectSchemas["soap-film"].parse(params);
  const material = new MeshBasicNodeMaterial({ name: "soap-film", transparent: true, depthWrite: false, side: DoubleSide });
  const edgeOn = saturate(oneMinus(abs(dot(normalView, positionViewDirection))));
  const swirl = mx_noise_float(positionLocal.mul(1.4).add(vec3(0, time.mul(p.speed), 0)));
  // In bands: each whole step of thickness is one turn of the rainbow.
  const thickness = swirl.mul(0.35).add(0.5).add(edgeOn.mul(0.7));
  const rainbow = cos(thickness.mul(Math.PI * 2 * p.bands).add(vec3(0, 2.1, 4.2))).mul(0.5).add(0.5);
  const film = mix(rainbow, uniform(new Color(p.tint ?? palette.glass)), 1 - p.color);
  // The film mirrors only bright things: here the studio's key light, upper right.
  const key = uniform(new Vector3(0.5, 0.7, 0.6).normalize());
  const glint = smoothstep(0.93, 0.99, dot(reflectView, key));
  material.colorNode = mix(film, vec3(1), glint);
  material.opacityNode = saturate(edgeOn.mul(edgeOn).mul(p.sheen).add(0.03).add(glint));
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
    case "soap-film":
      return createSoapFilmMaterial({}, palette);
  }
}
