import {
  abs,
  cos,
  float,
  mix,
  mx_noise_float,
  normalView,
  oneMinus,
  positionLocal,
  saturate,
  sin,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import { finishSchemas, type FinishId } from "./info.js";

const DEG = Math.PI / 180;

type FloatUniform = ReturnType<typeof uniform<"float">>;
type ColorUniform = ReturnType<typeof uniform<"color">>;

interface FinishBindings {
  readonly scale: FloatUniform;
  readonly strength: FloatUniform;
  readonly direction?: FloatUniform;
}

export interface FinishGraph {
  readonly modulates: readonly ("roughness" | "normal" | "anisotropy" | "color")[];
  readonly bindings: FinishBindings;
  readonly roughnessNode?: unknown;
  readonly normalNode?: unknown;
  readonly anisotropyNode?: unknown;
  readonly colorNode?: unknown;
}

function directionBasis(direction: FloatUniform) {
  const angle = direction.mul(DEG);
  const dir = vec2(cos(angle), sin(angle));
  const across = vec2(dir.y.negate(), dir.x);
  return { dir, across };
}

function finishDrive(strength: FloatUniform) {
  return saturate(strength);
}

function noiseNormal(scale: FloatUniform, strength: FloatUniform, factor = 0.6) {
  const scaled = positionLocal.mul(scale);
  const center = mx_noise_float(scaled);
  const dx = mx_noise_float(scaled.add(vec3(0.02, 0, 0))).sub(center);
  const dy = mx_noise_float(scaled.add(vec3(0, 0.02, 0))).sub(center);
  const dz = mx_noise_float(scaled.add(vec3(0, 0, 0.02))).sub(center);
  return normalView.add(vec3(dx, dy, dz).mul(strength.mul(factor))).normalize();
}

/** Builds procedural finish nodes; the caller wires them onto a physical node material. */
export function buildFinishGraph(id: FinishId, params: unknown, baseRoughness: number, baseColor: ColorUniform): FinishGraph {
  const baseRough = float(baseRoughness);
  switch (id) {
    case "brushed": {
      const p = finishSchemas.brushed.parse(params);
      const scale = uniform(p.scale);
      const strength = uniform(p.strength);
      const direction = uniform(p.direction);
      const { across } = directionBasis(direction);
      const streak = sin(positionLocal.dot(across).mul(scale)).mul(0.5).add(0.5);
      const drive = finishDrive(strength);
      const modulated = mix(baseRough, float(0.02), streak.mul(1));
      return {
        modulates: ["roughness"],
        bindings: { scale, strength, direction },
        roughnessNode: mix(baseRough, modulated, drive),
        colorNode: baseColor,
      };
    }
    case "weave": {
      const p = finishSchemas.weave.parse(params);
      const scale = uniform(p.scale);
      const strength = uniform(p.strength);
      const direction = uniform(p.direction);
      const { dir, across } = directionBasis(direction);
      const u = positionLocal.dot(dir).mul(scale);
      const v = positionLocal.dot(across).mul(scale);
      const warp = abs(sin(u)).mul(0.5).add(0.5);
      const weft = abs(sin(v)).mul(0.5).add(0.5);
      const basket = warp.mul(weft);
      const drive = finishDrive(strength);
      const bumpU = cos(u.mul(2)).mul(1.05);
      const bumpV = cos(v.mul(2)).mul(1.05);
      const lift = basket.sub(float(0.35)).mul(2.4);
      const woven = normalView.add(vec3(bumpU, bumpV, lift)).normalize();
      const roughMod = mix(baseRough, float(0.98), basket.mul(0.82));
      return {
        modulates: ["normal", "roughness"],
        bindings: { scale, strength, direction },
        normalNode: mix(normalView, woven, drive),
        roughnessNode: mix(baseRough, roughMod, drive),
        colorNode: baseColor,
      };
    }
    case "grain": {
      const p = finishSchemas.grain.parse(params);
      const scale = uniform(p.scale);
      const strength = uniform(p.strength);
      const grainAxis = vec3(0.9, 0.12, 0.05);
      const along = positionLocal.dot(grainAxis).mul(scale);
      const bands = sin(along.mul(2.8)).mul(0.5).add(0.5);
      const pore = mx_noise_float(positionLocal.mul(scale.mul(2.2))).mul(0.35).add(0.65);
      const grain = saturate(bands.mul(pore));
      const drive = finishDrive(strength);
      const ripple = sin(along.mul(4)).mul(0.28);
      const modColor = saturate(
        baseColor.mul(oneMinus(grain.mul(0.68))).mul(float(1).add(grain.mul(0.32))),
      );
      const modNormal = normalView.add(vec3(ripple.mul(1.28), ripple.mul(0.22), grain.sub(0.5).mul(0.58))).normalize();
      const roughMod = mix(baseRough, float(0.98), grain.mul(1.05));
      return {
        modulates: ["roughness", "color", "normal"],
        bindings: { scale, strength },
        roughnessNode: mix(baseRough, roughMod, drive),
        colorNode: mix(baseColor, modColor, drive),
        normalNode: mix(normalView, modNormal, drive),
      };
    }
    case "orange-peel": {
      const p = finishSchemas["orange-peel"].parse(params);
      const scale = uniform(p.scale);
      const strength = uniform(p.strength);
      const drive = finishDrive(strength);
      const peeled = noiseNormal(scale, strength, 1.4);
      return {
        modulates: ["normal"],
        bindings: { scale, strength },
        normalNode: mix(normalView, peeled, drive),
        colorNode: baseColor,
      };
    }
    case "frost": {
      const p = finishSchemas.frost.parse(params);
      const scale = uniform(p.scale);
      const strength = uniform(p.strength);
      const noise = mx_noise_float(positionLocal.mul(scale));
      const micro = saturate(abs(noise)).mul(strength);
      const drive = finishDrive(strength);
      const frosted = float(0.22);
      const roughMod = mix(baseRough, frosted, micro.mul(0.85));
      const frostedNormal = noiseNormal(scale, strength, 0.45);
      return {
        modulates: ["roughness", "normal"],
        bindings: { scale, strength },
        roughnessNode: mix(baseRough, roughMod, drive),
        normalNode: mix(normalView, frostedNormal, drive),
        colorNode: baseColor,
      };
    }
    default:
      throw new RangeError(`unknown finish "${String(id)}"`);
  }
}