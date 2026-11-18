// The screen effects as TSL node graphs, for three's WebGPURenderer (which falls back to WebGL 2).
// Ported from hedronite.com's GLSL (CrystalFx and NoiseField): the same print levels, inks, Bayer
// matrix, glyph ramp, sweep, loupe and smoke, written as nodes so surface shaders (TSL materials) and
// screen effects can share one renderer.
import { abs, clamp, convertToTexture, cos, distance, dot, exp, float, floor, fract, length, max, min, mix, pow, screenSize, screenUV, select, sin, smoothstep, step, texture, uniform, vec2, vec3, vec4 } from "three/tsl";
import { Color, Vector3, type Node, type Texture, type TextureNode, type Vector2 } from "three/webgpu";
import type { Inks } from "./inks.js";

const floatUniform = (value: number) => uniform(value);
const vec2Uniform = (value: Vector2) => uniform(value);
const vec3Uniform = (value: Vector3) => uniform(value);
export type FloatUniform = ReturnType<typeof floatUniform>;
type Vec2Uniform = ReturnType<typeof vec2Uniform>;
type Vec3Uniform = ReturnType<typeof vec3Uniform>;
export { floatUniform, vec2Uniform };

/**
 * The inks as uniforms, shared by every pass of one stack. A pass reads them, so writing a new set
 * (`writeInks`) recolours the next frame without rebuilding any pass.
 */
export interface InkUniforms {
  readonly cool: readonly [Vec3Uniform, Vec3Uniform, Vec3Uniform];
  readonly warm: readonly [Vec3Uniform, Vec3Uniform, Vec3Uniform];
  readonly hot: Vec3Uniform;
  readonly rule: Vec3Uniform;
  readonly chroma: FloatUniform;
}

/** An ink as a linear-RGB vec3 uniform (Color converts from sRGB hex). */
const ink = (hex: string): Vec3Uniform => {
  const c = new Color(hex);
  return vec3Uniform(new Vector3(c.r, c.g, c.b));
};
const setInk = (target: Vec3Uniform, hex: string): void => {
  const c = new Color(hex);
  target.value.set(c.r, c.g, c.b);
};

export function inkUniforms(inks: Inks): InkUniforms {
  return {
    cool: [ink(inks.cool[0]), ink(inks.cool[1]), ink(inks.cool[2])],
    warm: [ink(inks.warm[0]), ink(inks.warm[1]), ink(inks.warm[2])],
    hot: ink(inks.hot),
    rule: ink(inks.rule),
    chroma: floatUniform(inks.chroma),
  };
}

const setRamp = (target: InkUniforms["cool"], hex: Inks["cool"]): void => {
  setInk(target[0], hex[0]);
  setInk(target[1], hex[1]);
  setInk(target[2], hex[2]);
};

/** Writes a new set of inks into the uniforms the passes read. */
export function writeInks(target: InkUniforms, inks: Inks): void {
  setRamp(target.cool, inks.cool);
  setRamp(target.warm, inks.warm);
  setInk(target.hot, inks.hot);
  setInk(target.rule, inks.rule);
  target.chroma.value = inks.chroma;
}

/** The uniforms an effect's clocks and the pointer drive each frame. */
export interface PrintUniforms {
  readonly time: FloatUniform;
  readonly dpr: FloatUniform;
  readonly base: FloatUniform;
  readonly intro: FloatUniform;
  readonly appear: FloatUniform;
  readonly scan: FloatUniform;
  readonly scanDepth: FloatUniform;
  readonly lens: FloatUniform;
  readonly lensRadius: FloatUniform;
  readonly lensDepth: FloatUniform;
  readonly grain: FloatUniform;
  readonly ditherPx: FloatUniform;
  readonly asciiPx: FloatUniform;
  readonly mouse: Vec2Uniform;
}

type FloatNode = Node<"float">;
type Vec2Node = Node<"vec2">;
type Vec3Node = Node<"vec3">;

/** `then` where `condition` holds, else `otherwise`, for vec3s (TSL's select is typed for floats and vec4s). */
const pick3 = (condition: Node<"bool">, then: Vec3Node, otherwise: Vec3Node): Vec3Node => mix(otherwise, then, select(condition, 1, 0));

/** Sine-free hash (Dave Hoskins, hash12): stays finite where mediump is fp16. */
function hash(p: Vec2Node): FloatNode {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031));
  // p3 += dot(p3, p3.yzx + 33.33), written as an expression: assignment only works inside an Fn.
  const q = p3.add(dot(p3, p3.yzx.add(33.33)));
  return fract(q.x.add(q.y).mul(q.z));
}

const bayer2 = (a: Vec2Node): FloatNode => {
  const f = floor(a);
  return fract(f.x.mul(0.5).add(f.y.mul(f.y).mul(0.75)));
};
const bayer4 = (a: Vec2Node): FloatNode => bayer2(a.mul(0.5)).mul(0.25).add(bayer2(a));
const bayer8 = (a: Vec2Node): FloatNode => bayer4(a.mul(0.5)).mul(0.25).add(bayer2(a));

/** Linear HDR → a printable 0..1 tone. */
const tone = (rgb: Vec3Node): FloatNode => float(1).sub(exp(dot(rgb, vec3(0.2126, 0.7152, 0.0722)).mul(-1.7)));

/**
 * The print pass over `input`. Stylization level s: 0 the clean frame, 1 dither, 2 ASCII; each effect
 * raises s everywhere (base), during the intro, in the scan band or inside the lens, and levels
 * dissolve cell by cell.
 */
export function printNode(input: TextureNode, u: PrintUniforms, inks: InkUniforms, atlas: Texture, glyphs: number) {
  const res = screenSize;
  const uv = screenUV;
  const px = uv.mul(res);
  const here = input.sample(uv);
  const [c0, c1, c2] = inks.cool;
  const [w0, w1, w2] = inks.warm;
  const { hot, rule, chroma } = inks;

  // Dither: an 8×8 Bayer dot matrix in two ink ramps, square dots with a gutter.
  const dPx = u.ditherPx.mul(u.dpr);
  const dGrid = uv.mul(res).div(dPx);
  const dCell = floor(dGrid);
  const ds = input.sample(dCell.add(0.5).mul(dPx).div(res));
  const dRaw = tone(ds.rgb);
  const dEmpty = ds.a.lessThan(0.04).and(dRaw.lessThan(0.12));
  const dT = clamp(dRaw.mul(1.1).add(ds.a.mul(0.16)), 0, 1);
  const level = floor(dT.mul(3.6).add(bayer8(dCell)));
  const dWarm = ds.r.greaterThan(ds.b.mul(1.08));
  const dColor = pick3(
    level.greaterThanEqual(4),
    hot,
    pick3(level.greaterThanEqual(3), pick3(dWarm, w2, c2), pick3(level.greaterThanEqual(2), pick3(dWarm, w1, c1), pick3(dWarm, w0, c0))),
  );
  const dF = fract(dGrid);
  const mark = step(dF.x, 0.78).mul(step(dF.y, 0.78));
  const dither = select(dEmpty.or(level.lessThan(1)), vec4(0), vec4(dColor.mul(mark), mark));

  // ASCII: a glyph ramp by tone, tinted toward the source's own color unless the print is one ink.
  const aPx = u.asciiPx.mul(u.dpr);
  const aGrid = uv.mul(res).div(aPx);
  const aCell = floor(aGrid);
  const as = input.sample(aCell.add(0.5).mul(aPx).div(res));
  const aRaw = tone(as.rgb);
  const aEmpty = as.a.lessThan(0.04).and(aRaw.lessThan(0.12));
  const aT = clamp(pow(aRaw, 0.7).mul(1.25).add(as.a.mul(0.2)), 0, 0.999);
  const index = floor(aT.mul(glyphs));
  const aF = fract(aGrid);
  const glyph = texture(atlas, vec2(index.add(aF.x).div(glyphs), aF.y)).r;
  const peak = max(max(as.r, as.g), as.b);
  const sourceColor = pick3(peak.greaterThan(1e-4), as.rgb.div(max(peak, 1e-4)), vec3(0));
  const ink = pick3(as.r.greaterThan(as.b.mul(1.08)), mix(w1, w2, aT), mix(c1, c2, aT));
  const aColor = mix(mix(ink, sourceColor, chroma).mul(aT.mul(0.6).add(0.7)), hot, smoothstep(0.82, 1, aT));
  const ascii = select(aEmpty.or(index.lessThan(1)), vec4(0), vec4(aColor.mul(glyph), glyph));

  // Where to print, and how deep.
  const s0 = max(u.base, float(2).mul(float(1).sub(u.intro)));
  const bandDistance = abs(uv.y.sub(u.scan));
  const sweeping = u.scan.greaterThan(-0.5);
  const s1 = select(sweeping, max(s0, u.scanDepth.mul(float(1).sub(smoothstep(0, 0.11, bandDistance)))), s0);
  const edge = smoothstep(0, 0.18, uv.x).mul(smoothstep(1, 0.82, uv.x));
  const life = smoothstep(1.15, 0.95, u.scan).mul(smoothstep(-0.15, 0.05, u.scan));
  const hairline = select(sweeping, float(1).sub(smoothstep(0, u.dpr.mul(1.2), abs(px.y.sub(u.scan.mul(res.y))))).mul(edge).mul(life).mul(0.8), float(0));
  const r = u.lensRadius.mul(u.dpr);
  const lensDistance = px.distance(u.mouse.mul(res));
  const inside = float(1).sub(smoothstep(r.mul(0.88), r, lensDistance));
  const ring = float(1).sub(smoothstep(0, u.dpr.mul(1.4), abs(lensDistance.sub(r)))).mul(u.lens);
  const s = max(s1, inside.mul(u.lens).mul(u.lensDepth));
  const ruleAmount = max(ring, hairline);

  // Dissolve cell by cell, the intro scatter, grain, then the rules.
  const cellNoise = hash(floor(px.div(u.dpr.mul(5))));
  const printed = select(s.lessThanEqual(1), select(cellNoise.lessThan(s), dither, here), select(cellNoise.lessThan(s.sub(1)), ascii, dither));
  const appeared = printed.mul(select(u.appear.lessThan(0.999), step(hash(floor(px.div(u.dpr.mul(8))).add(7)), u.appear), float(1)));
  const grained = vec4(appeared.rgb.add(hash(px.add(fract(u.time).mul(91))).sub(0.5).mul(u.grain).mul(appeared.a).mul(step(0.001, s))), appeared.a);
  const ruled = vec4(mix(grained.rgb, rule, ruleAmount), max(grained.a, ruleAmount));
  return select(s.lessThan(0.001).and(ruleAmount.lessThan(0.001)), here, ruled);
}

/** Film grain over the whole frame: over what's drawn, and faint light specks where nothing is. Premultiplied. */
export function grainNode(input: TextureNode, time: FloatUniform, amount: FloatUniform) {
  const c = input.sample(screenUV);
  const n = hash(screenUV.mul(screenSize).add(fract(time).mul(91))).sub(0.5);
  const speck = max(n, 0).mul(amount);
  return vec4(c.rgb.add(n.mul(amount).mul(c.a)).add(speck.mul(float(1).sub(c.a))), c.a.add(speck.mul(float(1).sub(c.a))));
}

/**
 * The smoke field on its own: domain-warped fBm in the cool ink with warm embers, premultiplied, from the
 * screen position alone (it does not read the scene). `smokeField` draws it into a half-size target, since
 * soft smoke hides the upsample and the fBm is the costliest fragment work in the stack.
 */
function smokeFieldNode(time: FloatUniform, inks: InkUniforms, intensity: FloatUniform) {
  const noise = (p: Vec2Node): FloatNode => {
    const i = floor(p);
    const f = fract(p);
    const w = f.mul(f).mul(vec2(3).sub(f.mul(2)));
    return mix(mix(hash(i), hash(i.add(vec2(1, 0))), w.x), mix(hash(i.add(vec2(0, 1))), hash(i.add(vec2(1, 1))), w.x), w.y);
  };
  const fbm = (start: Vec2Node): FloatNode => {
    let p = start;
    let v: FloatNode = float(0);
    let a = 0.5;
    for (let octave = 0; octave < 5; octave++) {
      v = v.add(noise(p).mul(a));
      p = vec2(p.x.mul(0.8).add(p.y.mul(-0.6)), p.x.mul(0.6).add(p.y.mul(0.8))).mul(2.02);
      a *= 0.5;
    }
    return v;
  };
  const p = screenUV.mul(vec2(screenSize.x.div(screenSize.y), 1)).mul(1.8);
  const t = time.mul(0.03);
  const q = vec2(fbm(p.add(vec2(0, t))), fbm(p.add(vec2(5.2, 1.3)).sub(t)));
  const r = vec2(fbm(p.add(q.mul(3.6)).add(vec2(1.7, 9.2)).add(t.mul(1.4))), fbm(p.add(q.mul(3.6)).add(vec2(8.3, 2.8)).sub(t.mul(0.9))));
  const f = fbm(p.add(r.mul(3.2)));
  const body = smoothstep(0.55, 0.95, f);
  const filament = pow(smoothstep(0.62, 0.86, f).mul(float(1).sub(smoothstep(0.86, 1, f))), 1.6);
  // Copper gathers toward the lower right; screenUV.y grows downward.
  const warmth = smoothstep(0.35, 1.05, screenUV.x.mul(0.7).add(screenUV.y.mul(0.55)).add(r.x.sub(0.5).mul(0.6)));
  const smoke = mix(inks.cool[1], inks.warm[1], warmth.mul(0.7));
  // hedronite.com's blend, which it also drew at 90% opacity.
  const a = clamp(body.mul(0.2).add(filament.mul(0.42)).mul(intensity.mul(0.9)), 0, 1);
  return vec4(smoke.mul(a), a);
}

/** How much of the screen's width and height the smoke target takes: a quarter of the pixels. */
export const SMOKE_SCALE = 0.5;

/** The smoke field in a half-size render target; sampling it upsamples with the texture's linear filter. */
export function smokeField(time: FloatUniform, inks: InkUniforms, intensity: FloatUniform): TextureNode {
  return convertToTexture(smokeFieldNode(time, inks, intensity), null, null, { resolutionScale: SMOKE_SCALE });
}

/** The smoke behind what the scene drew: the (upsampled) `field` under the scene's own pixels. Premultiplied. */
export function smokeNode(input: TextureNode, field: TextureNode) {
  const scene = input.sample(screenUV);
  const smoke = field.sample(screenUV);
  const behind = float(1).sub(scene.a);
  return vec4(scene.rgb.mul(scene.a).add(smoke.rgb.mul(behind)), scene.a.add(smoke.a.mul(behind)));
}

/** The CRT tube's settings, as uniforms. */
export interface CrtUniforms {
  readonly curvature: FloatUniform;
  readonly pitch: FloatUniform;
  readonly aberration: FloatUniform;
  readonly motion: FloatUniform;
}

/** 1 below `from`, 0 above `to` (from < to): smoothstep run backwards, which WGSL leaves undefined. */
const fall = (from: number, to: number, x: FloatNode): FloatNode => float(1).sub(smoothstep(from, to, x));

/**
 * The scene on a CRT tube: barrel glass, red and blue split toward the corners, scan lines, an aperture
 * grille, a rolling bar, a soft sheen and the room around the glass, in the look's cool ink. Opaque.
 *
 * Adopted from ThreeUI Community by Meng To / ThreeUI (https://github.com/MengTo/threeui),
 * src/shaders/crt/crtShaders.ts, under MIT. The upstream notice: assets/vendor/threeui/LICENSE.
 * Ported from GLSL to TSL over any scene's frame instead of its own typed-text canvas; the line and
 * triad sizes are in CSS pixels, and the colors come from the inks rather than the original's green.
 */
export function crtNode(input: TextureNode, time: FloatUniform, dpr: FloatUniform, inks: InkUniforms, p: CrtUniforms) {
  // Push each point out by the square of the other axis: the bulge of the glass.
  const c = screenUV.mul(2).sub(1);
  const uv = c.add(c.mul(c.yx.mul(c.yx)).mul(vec2(p.curvature.mul(0.115), p.curvature.mul(0.165)))).mul(0.5).add(0.5);
  const within = step(vec2(0), uv).mul(step(uv, vec2(1)));
  const edge = min(uv, vec2(1).sub(uv));
  const inside = within.x.mul(within.y).mul(smoothstep(0, 0.02, min(edge.x, edge.y)));
  const dir = uv.sub(0.5);
  const split = dir.mul(dot(dir, dir).mul(0.012).add(0.0016).mul(p.aberration));
  // The scene over the tube's dark phosphor; the input is premultiplied.
  const phosphor = inks.cool[0].mul(0.02);
  const at = (q: Vec2Node): Vec3Node => {
    const s = input.sample(q);
    return s.rgb.add(phosphor.mul(float(1).sub(s.a)));
  };
  let col: Vec3Node = vec3(at(uv.add(split)).x, at(uv).y, at(uv.sub(split)).z);
  const lines = sin(uv.y.mul(Math.PI).mul(screenSize.y.div(dpr).div(p.pitch)).add(time.mul(p.motion.mul(4))));
  col = col.mul(mix(float(0.7), float(1), lines.mul(lines)));
  const triad = screenUV.x.mul(screenSize.x).div(dpr).mul(float((Math.PI * 2) / 2.75).div(p.pitch));
  col = col.mul(cos(vec3(triad).add(vec3(0, 2.094, 4.188))).mul(0.34).add(0.66)).mul(1.34);
  // The original's y ran from the bottom, screenUV's from the top: the bar still rolls upward.
  const roll = fract(float(1).sub(uv.y).mul(0.5).sub(time.mul(p.motion.mul(0.07))));
  col = col.add(smoothstep(0, 0.05, roll).mul(fall(0.05, 0.18, roll)).mul(p.motion.mul(0.045)));
  const sheen = fall(0, 0.55, distance(uv, vec2(0.5, 0.85)));
  col = col.add(mix(vec3(1), inks.cool[2], 0.45).mul(sheen.mul(0.03)));
  col = col.mul(mix(float(0.42), float(1), fall(0.3, 0.98, length(dir.mul(vec2(1.05, 1))))));
  col = col.mul(float(1).sub(sin(time.mul(8)).mul(p.motion.mul(0.028))));
  col = col.add(hash(screenUV.mul(screenSize).add(fract(time.mul(0.37)).mul(91))).sub(0.5).mul(0.022));
  const spill = fall(0.18, 0.85, length(screenUV.sub(0.5))).mul(0.05);
  const room = inks.cool[0].mul(0.03).add(inks.cool[1].mul(spill.mul(0.5)));
  return vec4(max(mix(room, col, inside), vec3(0.004)), 1);
}
