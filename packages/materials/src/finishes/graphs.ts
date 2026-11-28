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
import { type MaterialPreset } from "../presets.js";

const DEG = Math.PI / 180;

type FloatUniform = ReturnType<typeof uniform<"float">>;
type ColorUniform = ReturnType<typeof uniform<"color">>;

interface FinishBindings {
  readonly scale: FloatUniform;
  readonly strength: FloatUniform;
  readonly direction?: FloatUniform;
}

export interface FinishGraph {
  readonly modulates: readonly ("roughness" | "normal" | "anisotropy" | "color" | "transmission" | "clearcoat")[];
  readonly bindings: FinishBindings;
  readonly roughnessNode?: unknown;
  readonly normalNode?: unknown;
  readonly anisotropyNode?: unknown;
  readonly colorNode?: unknown;
  readonly transmissionNode?: unknown;
  readonly clearcoatNormalNode?: unknown;
  readonly sheenRoughnessNode?: unknown;
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
export function buildFinishGraph(
  id: FinishId,
  params: unknown,
  preset: MaterialPreset,
  baseColor: ColorUniform,
): FinishGraph {
  const baseRough = float(preset.roughness);
  const baseTrans = float(preset.transmission ?? 0);
  switch (id) {
    case "brushed": {
      const p = finishSchemas.brushed.parse(params);
      const scale = uniform(p.scale);
      const strength = uniform(p.strength);
      const direction = uniform(p.direction);
      const { across } = directionBasis(direction);
      const softCloth = saturate(baseRough.sub(0.7).mul(3.5));
      const streak = sin(positionLocal.dot(across).mul(scale.mul(float(1).add(softCloth.mul(0.45))))).mul(0.5).add(0.5);
      const drive = finishDrive(strength);
      const roughTarget = mix(float(0.02), float(0.24), softCloth);
      const modulated = mix(baseRough, roughTarget, streak.mul(1.42));
      const dielectric = float(1).sub(float(preset.metalness));
      const brushNormal = normalView
        .add(vec3(streak.sub(0.5).mul(0.58), streak.sub(0.5).mul(0.12), streak.sub(0.5).mul(0.32)))
        .normalize();
      const brushTint = baseColor.mul(float(1).add(streak.sub(0.5).mul(0.34).mul(dielectric)));
      const { dir } = directionBasis(direction);
      const brushAniso = vec2(dir.x, dir.y).mul(streak.sub(0.5).mul(2.65));
      const sheenBase = float(preset.sheenRoughness ?? 1);
      const sheenStreak = mix(sheenBase, streak.mul(0.38).add(0.08), drive.mul(dielectric.mul(softCloth)));
      return {
        modulates: ["roughness", "normal", "color", "anisotropy"],
        bindings: { scale, strength, direction },
        roughnessNode: mix(baseRough, modulated, drive),
        normalNode: mix(normalView, brushNormal, drive.mul(dielectric.mul(1.32))),
        colorNode: mix(baseColor, brushTint, drive.mul(dielectric.mul(0.92))),
        anisotropyNode: mix(vec2(0, 0), brushAniso, drive.mul(dielectric)),
        ...((preset.sheen ?? 0) > 0.01 ? { sheenRoughnessNode: sheenStreak } : {}),
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
      const bumpU = cos(u.mul(2)).mul(1.35);
      const bumpV = cos(v.mul(2)).mul(1.35);
      const lift = basket.sub(float(0.22)).mul(3.15);
      const woven = normalView.add(vec3(bumpU, bumpV, lift)).normalize();
      const roughMod = mix(baseRough, float(0.99), basket.mul(0.92));
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
      const peelBump = mx_noise_float(positionLocal.mul(scale.mul(1.4)));
      const peelCrest = saturate(peelBump.mul(1.35).sub(0.35));
      const peeled = normalView
        .add(
          vec3(
            sin(positionLocal.x.mul(scale.mul(0.9))).mul(0.82),
            sin(positionLocal.y.mul(scale.mul(1.1))).mul(0.82),
            peelCrest.mul(2.15),
          ).mul(strength.mul(1.62)),
        )
        .normalize();
      const coatNormal = noiseNormal(scale, strength, 2.4);
      const coatRipple = mix(normalView, coatNormal, saturate(strength.mul(1.1)));
      const peelTint = baseColor.mul(float(1).add(peelCrest.mul(0.24)));
      const hasClearcoat = (preset.clearcoat ?? 0) > 0.01;
      return {
        modulates: hasClearcoat ? ["normal", "clearcoat", "color"] : ["normal", "roughness", "color"],
        bindings: { scale, strength },
        roughnessNode: mix(baseRough, mix(baseRough, float(0.58), peelCrest), drive.mul(hasClearcoat ? 0.25 : 0.52)),
        normalNode: mix(normalView, peeled, hasClearcoat ? drive.mul(0.45) : drive.mul(1.08)),
        clearcoatNormalNode: hasClearcoat ? mix(normalView, coatRipple, drive) : undefined,
        colorNode: mix(baseColor, peelTint, drive.mul(hasClearcoat ? 0.72 : 0.82)),
      };
    }
    case "frost": {
      const p = finishSchemas.frost.parse(params);
      const scale = uniform(p.scale);
      const strength = uniform(p.strength);
      const dielectric = float(1).sub(float(preset.metalness));
      const softCloth = saturate(baseRough.sub(0.7).mul(3.5));
      const flake = saturate(
        abs(mx_noise_float(positionLocal.mul(scale.mul(2.4).mul(float(1).add(softCloth.mul(0.25))))))
          .mul(mx_noise_float(positionLocal.mul(scale.mul(0.65))).mul(0.5).add(0.5)),
      );
      const micro = saturate(flake.mul(strength.mul(1.65)).add(strength.mul(0.2)).add(dielectric.mul(0.1)));
      const drive = finishDrive(strength);
      const frostRough = mix(baseRough, float(0.94), micro.mul(1.28));
      const frostShade = baseColor
        .mul(float(1).add(micro.mul(0.38).add(dielectric.mul(0.12))))
        .mul(float(1).sub(micro.mul(0.16).add(dielectric.mul(0.06))));
      const frostedNormal = noiseNormal(scale, strength, 2.35);
      const frostDrive = drive.mul(float(1).add(dielectric.mul(0.32)));
      const modulates: FinishGraph["modulates"] =
        (preset.transmission ?? 0) > 0.01
          ? ["roughness", "normal", "transmission", "color"]
          : ["roughness", "normal", "color"];
      const frostTrans =
        (preset.transmission ?? 0) > 0.01
          ? mix(baseTrans, baseTrans.mul(float(0.68)), micro.mul(0.45))
          : undefined;
      const sheenBase = float(preset.sheenRoughness ?? 1);
      const frostSheen = mix(sheenBase, float(0.96), drive.mul(micro).mul(softCloth));
      return {
        modulates,
        bindings: { scale, strength },
        roughnessNode: mix(baseRough, frostRough, frostDrive),
        normalNode: mix(normalView, frostedNormal, frostDrive),
        colorNode: mix(baseColor, frostShade, frostDrive),
        ...((preset.sheen ?? 0) > 0.01 ? { sheenRoughnessNode: frostSheen } : {}),
        ...(frostTrans === undefined
          ? {}
          : { transmissionNode: mix(baseTrans, frostTrans, finishDrive(strength)) }),
      };
    }
    default:
      throw new RangeError(`unknown finish "${String(id)}"`);
  }
}