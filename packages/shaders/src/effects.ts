import { neutral, type ScenePalette } from "@hedronite/lts-tokens";
import {
  abs,
  cos,
  dot,
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
import { z } from "zod";
import { effectSchemas, type EffectId, type EffectParams } from "./info.js";

/** A float uniform that holds time in seconds. Whoever owns it writes `.value`; three's wall clock (`time`) is what a shader reads when it is given none. */
export type EffectClock = typeof time;

/** A clock a stage can drive, so a paused stage's shaders hold still. Starts at `seconds`. */
export function createEffectClock(seconds = 0): EffectClock {
  return uniform(seconds);
}

export interface EffectOptions {
  /** Where the shader reads time from. Default: three's wall clock. */
  readonly clock?: EffectClock;
}

type FloatUniform = ReturnType<typeof uniform<"float">>;
type ColorUniform = ReturnType<typeof uniform<"color">>;

/**
 * A surface shader and the handles to change it while it draws. Every numeric and color parameter is a
 * uniform: `set` writes it in place, with no new material and no recompile. The handle owns `material`.
 */
export interface EffectHandle<Id extends EffectId = EffectId, Material extends NodeMaterial = NodeMaterial> {
  readonly id: Id;
  readonly material: Material;
  /** The parameters that are baked into the graph. A change to one needs a new effect, and `set` says so. */
  readonly structural: readonly string[];
  /** The live uniform for each parameter that has one, by parameter name. Read-only for callers; `set` is how to write them. */
  readonly uniforms: Readonly<Record<string, FloatUniform | ColorUniform>>;
  /**
   * Writes the parameters named in `partial` and leaves the rest alone. Each is validated against the effect's schema, so a
   * value out of range throws and nothing is written. Returns true once every one is applied in place. Returns false, having
   * written nothing, when `partial` changes a structural parameter: build a new effect with the merged parameters.
   */
  set(partial: EffectParams<Id>): boolean;
  /** Frees the material. The clock, if one was given, belongs to its owner. */
  dispose(): void;
}

interface Bindings {
  readonly numbers: Readonly<Record<string, FloatUniform>>;
  readonly colors: Readonly<Record<string, ColorUniform>>;
  /** Baked in: setting one to the value it has is nothing to do, setting it to another needs a rebuild. */
  readonly fixed: Readonly<Record<string, unknown>>;
  readonly structural: readonly string[];
  /** The colors that came from the look, not from the caller: parameter name to the scene color it follows. */
  readonly roles?: Readonly<Record<string, keyof ScenePalette>>;
  /** Rules that span parameters, checked on what the numbers would be after the write. Throws to refuse. */
  readonly check?: (read: (key: string) => unknown) => void;
}

/** For each color the look supplies a default for: its role, kept only where the caller gave no color of their own. */
const followsLook = (given: Readonly<Record<string, unknown>>, roles: Readonly<Record<string, keyof ScenePalette>>): Record<string, keyof ScenePalette> =>
  Object.fromEntries(Object.entries(roles).filter(([key]) => given[key] === undefined));

/** The colors of each effect that follow the look, by name: a color the caller sets leaves the list. */
const following = new WeakMap<object, Map<string, keyof ScenePalette>>();

function effectHandle<Id extends EffectId, Material extends NodeMaterial>(id: Id, material: Material, bindings: Bindings): EffectHandle<Id, Material> {
  const roles = new Map(Object.entries(bindings.roles ?? {}));
  const shape: Readonly<Record<string, z.ZodType>> = effectSchemas[id].shape;
  const uniforms: Record<string, FloatUniform | ColorUniform> = { ...bindings.numbers, ...bindings.colors };
  const handle: EffectHandle<Id, Material> = {
    id,
    material,
    structural: bindings.structural,
    uniforms,
    set: (partial) => {
      const next = new Map<string, unknown>();
      for (const [key, raw] of Object.entries(partial)) {
        if (raw === undefined) continue;
        const field = shape[key];
        if (field === undefined) throw new RangeError(`${id} has no parameter "${key}"`);
        next.set(key, z.parse(field, raw));
      }
      bindings.check?.((key) => (next.has(key) ? next.get(key) : (bindings.numbers[key]?.value ?? bindings.fixed[key])));
      for (const [key, value] of next) {
        const inPlace = Object.hasOwn(bindings.numbers, key) || Object.hasOwn(bindings.colors, key) || (Object.hasOwn(bindings.fixed, key) && Object.is(bindings.fixed[key], value));
        if (!inPlace) return false;
      }
      for (const [key, value] of next) {
        const number = bindings.numbers[key];
        const color = bindings.colors[key];
        if (number !== undefined && typeof value === "number") number.value = value;
        else if (color !== undefined && typeof value === "string") {
          color.value.set(value);
          // A color the caller sets is theirs: a change of look leaves it be.
          roles.delete(key);
        }
      }
      return true;
    },
    dispose: () => {
      material.dispose();
    },
  };
  following.set(handle, roles);
  return handle;
}

/**
 * Recolors an effect in place from a look: the colors that took their default from the look follow it, as if the effect
 * had been made in it. Colors the caller gave, or has since set, stay as they are. Nothing is rebuilt, so the program
 * is the same. The caller asks for a new frame.
 */
export function applyPalette(effect: EffectHandle, palette: ScenePalette): void {
  for (const [key, role] of following.get(effect) ?? []) {
    const color = effect.uniforms[key]?.value;
    if (color instanceof Color) color.set(palette[role]);
  }
}

/** Lights the rim of a surface, where it turns away from the viewer. */
export function createFresnelGlowEffect(params: EffectParams<"fresnel-glow"> = {}, palette: ScenePalette = neutral.scene): EffectHandle<"fresnel-glow", MeshStandardNodeMaterial> {
  const p = effectSchemas["fresnel-glow"].parse(params);
  const power = uniform(p.power);
  const intensity = uniform(p.intensity);
  const base = uniform(new Color(p.base ?? palette.base));
  const glow = uniform(new Color(p.glow ?? palette.emissive));
  const material = new MeshStandardNodeMaterial({ name: "fresnel-glow", roughness: 0.5 });
  material.colorNode = base;
  const facing = saturate(dot(normalView, positionViewDirection));
  material.emissiveNode = glow.mul(pow(oneMinus(facing), power)).mul(intensity);
  return effectHandle("fresnel-glow", material, { numbers: { power, intensity }, colors: { base, glow }, roles: followsLook(p, { base: "base", glow: "emissive" }), fixed: {}, structural: [] });
}

/** Blends two colors from bottom to top in the object's own space. */
export function createHeightGradientEffect(params: EffectParams<"height-gradient"> = {}, palette: ScenePalette = neutral.scene): EffectHandle<"height-gradient", MeshStandardNodeMaterial> {
  const p = effectSchemas["height-gradient"].parse(params);
  if (p.minY >= p.maxY) throw new RangeError(`minY (${String(p.minY)}) must be below maxY (${String(p.maxY)})`);
  const minY = uniform(p.minY);
  const maxY = uniform(p.maxY);
  const bottom = uniform(new Color(p.bottom ?? palette.base));
  const top = uniform(new Color(p.top ?? palette.accent));
  const material = new MeshStandardNodeMaterial({ name: "height-gradient", roughness: 0.45 });
  material.colorNode = mix(bottom, top, smoothstep(minY, maxY, positionLocal.y));
  return effectHandle("height-gradient", material, {
    numbers: { minY, maxY },
    colors: { bottom, top },
    roles: followsLook(p, { bottom: "base", top: "accent" }),
    fixed: {},
    structural: [],
    check: (read) => {
      const low = read("minY");
      const high = read("maxY");
      if (typeof low === "number" && typeof high === "number" && low >= high) throw new RangeError(`minY (${String(low)}) must be below maxY (${String(high)})`);
    },
  });
}

/** Glows in and out over time. Needs continuous rendering while visible. */
export function createPulseEffect(params: EffectParams<"pulse"> = {}, palette: ScenePalette = neutral.scene, { clock = time }: EffectOptions = {}): EffectHandle<"pulse", MeshStandardNodeMaterial> {
  const p = effectSchemas.pulse.parse(params);
  const speed = uniform(p.speed);
  const intensity = uniform(p.intensity);
  const color = uniform(new Color(p.color ?? palette.emissive));
  const material = new MeshStandardNodeMaterial({ name: "pulse", roughness: 0.6 });
  material.colorNode = color.mul(0.3);
  material.emissiveNode = color.mul(sin(clock.mul(speed)).mul(0.5).add(0.5)).mul(intensity);
  return effectHandle("pulse", material, { numbers: { speed, intensity }, colors: { color }, roles: followsLook(p, { color: "emissive" }), fixed: {}, structural: [] });
}

/**
 * Flat light bands with an ink line at the silhouette, unlit, so it reads the same in any lighting.
 * The line comes from how far the surface turns away from the viewer, so smooth shapes get the cleanest
 * lines; flat-faced ones ink whole faces near the edge. The number of `bands` is structural.
 */
export function createToonEffect(params: EffectParams<"toon"> = {}, palette: ScenePalette = neutral.scene): EffectHandle<"toon", MeshBasicNodeMaterial> {
  const p = effectSchemas.toon.parse(params);
  const material = new MeshBasicNodeMaterial({ name: "toon" });
  const outline = uniform(p.outline);
  const color = uniform(new Color(p.color ?? palette.accent));
  const ink = uniform(new Color(p.ink ?? "#000000"));
  // A fixed key light from the upper right, in view space, so the bands don't swim as the view turns.
  const light = uniform(new Vector3(0.5, 0.7, 0.6).normalize());
  const lit = saturate(dot(normalView, light));
  const band = saturate(floor(lit.mul(p.bands)).div(p.bands - 1));
  const shade = mix(color.mul(0.35), color, band);
  const facing = saturate(dot(normalView, positionViewDirection));
  material.colorNode = mix(shade, ink, step(facing, outline));
  return effectHandle("toon", material, { numbers: { outline }, colors: { color, ink }, roles: followsLook(p, { color: "accent" }), fixed: { bands: p.bands }, structural: ["bands"] });
}

/**
 * Bends whatever was drawn behind the surface, read back from the screen, and tints it. Cheaper than
 * physical transmission and works on any background, but it can only bend what is already on screen.
 */
export function createRefractionEffect(params: EffectParams<"refraction"> = {}, palette: ScenePalette = neutral.scene): EffectHandle<"refraction", MeshStandardNodeMaterial> {
  const p = effectSchemas.refraction.parse(params);
  const strength = uniform(p.strength);
  const clarity = uniform(p.clarity);
  const tint = uniform(new Color(p.tint ?? palette.glass));
  // Transparent so it draws after the opaque scene it reads from.
  const material = new MeshStandardNodeMaterial({ name: "refraction", roughness: 0.05, metalness: 0, transparent: true });
  const behind = viewportSharedTexture(screenUV.add(normalView.xy.mul(strength.negate()))).rgb;
  material.backdropNode = behind.mul(tint);
  material.backdropAlphaNode = clarity;
  return effectHandle("refraction", material, { numbers: { strength, clarity }, colors: { tint }, roles: followsLook(p, { tint: "glass" }), fixed: {}, structural: [] });
}

/**
 * Eats the surface away along a noise field, with a glowing edge where it burns. Animates unless `progress` is set.
 * Whether `progress` is set is structural; once it is, its value moves live.
 */
export function createDissolveEffect(params: EffectParams<"dissolve"> = {}, palette: ScenePalette = neutral.scene, { clock = time }: EffectOptions = {}): EffectHandle<"dissolve", MeshStandardNodeMaterial> {
  const p = effectSchemas.dissolve.parse(params);
  const scale = uniform(p.scale);
  const edgeWidth = uniform(p.edgeWidth);
  const speed = uniform(p.speed);
  const progress = p.progress === undefined ? undefined : uniform(p.progress);
  const color = uniform(new Color(p.color ?? palette.base));
  const edge = uniform(new Color(p.edge ?? palette.emissive));
  const material = new MeshStandardNodeMaterial({ name: "dissolve", roughness: 0.5, side: DoubleSide, alphaTest: 0.5 });
  material.colorNode = color;
  // MaterialX noise sits mostly within ±0.7; map it near 0 to 1.
  const noise = mx_noise_float(positionLocal.mul(scale)).mul(0.6).add(0.5);
  // Animated, it swings between nearly whole and about two-thirds gone, so the shape always reads.
  const threshold = progress ?? sin(clock.mul(speed)).mul(0.25).add(0.4);
  material.opacityNode = step(threshold, noise);
  const burn = oneMinus(smoothstep(0, edgeWidth, noise.sub(threshold)));
  material.emissiveNode = edge.mul(burn).mul(3);
  return effectHandle("dissolve", material, {
    numbers: { scale, edgeWidth, speed, ...(progress === undefined ? {} : { progress }) },
    colors: { color, edge },
    roles: followsLook(p, { color: "base", edge: "emissive" }),
    fixed: {},
    structural: ["progress"],
  });
}

/** See-through and additive, brightest at the rim, with scan lines climbing it. Steady: nothing in it flashes. */
export function createHologramEffect(params: EffectParams<"hologram"> = {}, palette: ScenePalette = neutral.scene, { clock = time }: EffectOptions = {}): EffectHandle<"hologram", MeshBasicNodeMaterial> {
  const p = effectSchemas.hologram.parse(params);
  const density = uniform(p.density);
  const speed = uniform(p.speed);
  const intensity = uniform(p.intensity);
  const color = uniform(new Color(p.color ?? palette.emissive));
  const material = new MeshBasicNodeMaterial({ name: "hologram", transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  const rim = pow(oneMinus(saturate(abs(dot(normalView, positionViewDirection)))), 2);
  const lines = smoothstep(0.2, 0.8, sin(positionLocal.y.mul(density).add(clock.mul(speed))).mul(0.5).add(0.5));
  material.colorNode = color.mul(intensity);
  material.opacityNode = rim.mul(0.8).add(0.15).mul(lines.mul(0.6).add(0.4));
  return effectHandle("hologram", material, { numbers: { density, speed, intensity }, colors: { color }, roles: followsLook(p, { color: "emissive" }), fixed: {}, structural: [] });
}

/**
 * A soap bubble's film: the rainbow of light bouncing between the film's two faces, its color set by how
 * thick the film is there, which swirls slowly and runs thinner toward the rim, over a faint pale sheen,
 * with a glint where it mirrors the key light. Clear, so it reads over something.
 *
 * Adopted from Codevember 2026 by Theo Tillberg (https://github.com/ttillberg/codevember-2026),
 * 07/src/Balloon.tsx (filmMaterial), under MIT. The upstream notice: assets/vendor/codevember-2026/LICENSE.
 */
export function createSoapFilmEffect(params: EffectParams<"soap-film"> = {}, palette: ScenePalette = neutral.scene, { clock = time }: EffectOptions = {}): EffectHandle<"soap-film", MeshBasicNodeMaterial> {
  const p = effectSchemas["soap-film"].parse(params);
  const amount = uniform(p.color);
  const bands = uniform(p.bands);
  const speed = uniform(p.speed);
  const sheen = uniform(p.sheen);
  const tint = uniform(new Color(p.tint ?? palette.glass));
  const material = new MeshBasicNodeMaterial({ name: "soap-film", transparent: true, depthWrite: false, side: DoubleSide });
  const edgeOn = saturate(oneMinus(abs(dot(normalView, positionViewDirection))));
  const swirl = mx_noise_float(positionLocal.mul(1.4).add(vec3(0, clock.mul(speed), 0)));
  // In bands: each whole step of thickness is one turn of the rainbow.
  const thickness = swirl.mul(0.35).add(0.5).add(edgeOn.mul(0.7));
  const rainbow = cos(thickness.mul(bands.mul(Math.PI * 2)).add(vec3(0, 2.1, 4.2))).mul(0.5).add(0.5);
  const film = mix(rainbow, tint, oneMinus(amount));
  // The film mirrors only bright things: here the studio's key light, upper right.
  const key = uniform(new Vector3(0.5, 0.7, 0.6).normalize());
  const glint = smoothstep(0.93, 0.99, dot(reflectView, key));
  material.colorNode = mix(film, vec3(1), glint);
  material.opacityNode = saturate(edgeOn.mul(edgeOn).mul(sheen).add(0.03).add(glint));
  return effectHandle("soap-film", material, { numbers: { color: amount, bands, speed, sheen }, colors: { tint }, roles: followsLook(p, { tint: "glass" }), fixed: {}, structural: [] });
}

/** The effect for any id. `params` are validated against that effect's schema; missing ones take its defaults. */
export function createEffect(id: EffectId, params: unknown = {}, palette: ScenePalette = neutral.scene, options: EffectOptions = {}): EffectHandle {
  switch (id) {
    case "dissolve":
      return createDissolveEffect(effectSchemas.dissolve.parse(params), palette, options);
    case "hologram":
      return createHologramEffect(effectSchemas.hologram.parse(params), palette, options);
    case "refraction":
      return createRefractionEffect(effectSchemas.refraction.parse(params), palette);
    case "toon":
      return createToonEffect(effectSchemas.toon.parse(params), palette);
    case "fresnel-glow":
      return createFresnelGlowEffect(effectSchemas["fresnel-glow"].parse(params), palette);
    case "height-gradient":
      return createHeightGradientEffect(effectSchemas["height-gradient"].parse(params), palette);
    case "pulse":
      return createPulseEffect(effectSchemas.pulse.parse(params), palette, options);
    case "soap-film":
      return createSoapFilmEffect(effectSchemas["soap-film"].parse(params), palette, options);
  }
}

/** The material for any effect id, with its default parameters, for a caller that never changes them. The caller disposes it. */
export function createEffectMaterial(id: EffectId, palette: ScenePalette = neutral.scene): NodeMaterial {
  return createEffect(id, {}, palette).material;
}
