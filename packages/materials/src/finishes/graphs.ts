import {
  abs,
  cos,
  float,
  mx_noise_float,
  normalView,
  oneMinus,
  positionLocal,
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
  switch (id) {
    case "brushed": {
      const p = finishSchemas.brushed.parse(params);
      const scale = uniform(p.scale);
      const strength = uniform(p.strength);
      const direction = uniform(p.direction);
      const { dir, across } = directionBasis(direction);
      const streak = sin(positionLocal.dot(across).mul(scale)).mul(0.5).add(0.5);
      const baseRough = float(baseRoughness);
      return {
        modulates: ["anisotropy", "roughness"],
        bindings: { scale, strength, direction },
        roughnessNode: baseRough.mul(oneMinus(streak.mul(strength).mul(0.35))),
        anisotropyNode: dir.mul(strength.mul(0.95).add(0.05)),
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
      const fabric = sin(u).mul(sin(v));
      const lift = fabric.mul(strength.mul(0.25));
      return {
        modulates: ["normal"],
        bindings: { scale, strength, direction },
        normalNode: normalView.add(vec3(lift, lift.mul(0.6), lift.mul(0.2))).normalize(),
        colorNode: baseColor,
      };
    }
    case "grain": {
      const p = finishSchemas.grain.parse(params);
      const scale = uniform(p.scale);
      const strength = uniform(p.strength);
      const ring = sin(positionLocal.length().mul(scale.mul(0.65))).mul(0.5).add(0.5);
      const streak = sin(positionLocal.y.mul(scale).add(positionLocal.x.mul(scale.mul(0.35)))).mul(0.5).add(0.5);
      const grain = ring.mul(0.55).add(streak.mul(0.45));
      const baseRough = float(baseRoughness);
      return {
        modulates: ["roughness", "color"],
        bindings: { scale, strength },
        roughnessNode: baseRough.mul(oneMinus(grain.mul(strength.mul(0.45)))).add(grain.mul(strength.mul(0.12))),
        colorNode: baseColor.mul(oneMinus(grain.mul(strength.mul(0.18))).add(0.5)),
      };
    }
    case "orange-peel": {
      const p = finishSchemas["orange-peel"].parse(params);
      const scale = uniform(p.scale);
      const strength = uniform(p.strength);
      return {
        modulates: ["normal"],
        bindings: { scale, strength },
        normalNode: noiseNormal(scale, strength),
        colorNode: baseColor,
      };
    }
    case "frost": {
      const p = finishSchemas.frost.parse(params);
      const scale = uniform(p.scale);
      const strength = uniform(p.strength);
      const noise = mx_noise_float(positionLocal.mul(scale));
      const micro = abs(noise).mul(strength);
      const baseRough = float(baseRoughness);
      return {
        modulates: ["roughness", "normal"],
        bindings: { scale, strength },
        roughnessNode: baseRough.mul(micro.mul(0.85).add(oneMinus(strength).mul(0.35))),
        normalNode: noiseNormal(scale, strength, 0.45),
        colorNode: baseColor,
      };
    }
    default:
      throw new RangeError(`unknown finish "${String(id)}"`);
  }
}