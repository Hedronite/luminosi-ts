import type { ToneMapping } from "@hedronite/lts-tokens";

export const stageQualities = ["full", "lite"] as const;
export type StageQuality = (typeof stageQualities)[number];

export const toneMappingModes = ["aces", "agx", "neutral"] as const;
export type ToneMappingMode = ToneMapping;

export interface StageBloomConfig {
  readonly enabled?: boolean | undefined;
  readonly threshold?: number | undefined;
  readonly gain?: number | undefined;
  readonly radius?: number | undefined;
}

export interface StageDofConfig {
  readonly enabled?: boolean | undefined;
  readonly focus?: number | undefined;
  readonly aperture?: number | undefined;
  readonly focalLength?: number | undefined;
}

export interface StagePostfxConfig {
  readonly quality?: StageQuality | undefined;
  readonly bloom?: StageBloomConfig | undefined;
  readonly dof?: StageDofConfig | undefined;
}

export interface ResolvedStageBloom {
  readonly enabled: boolean;
  readonly threshold: number;
  readonly gain: number;
  readonly radius: number;
}

export interface ResolvedStageDof {
  readonly enabled: boolean;
  readonly focus: number;
  readonly aperture: number;
  readonly focalLength: number;
}

export interface ResolvedStagePostfx {
  readonly quality: StageQuality;
  readonly bloom: ResolvedStageBloom;
  readonly dof: ResolvedStageDof;
}

/**
 * Resolves stage post-processing defaults (`3d-metal-material` bloom defaults and Codevember-inspired DoF defaults).
 * Under `"lite"` quality, bloom and depth of field are always disabled.
 */
export function resolveStagePostfx(stage?: StagePostfxConfig): ResolvedStagePostfx {
  const quality: StageQuality = stage?.quality ?? "full";
  const full = quality === "full";
  return {
    quality,
    bloom: {
      enabled: full && stage?.bloom?.enabled === true,
      threshold: stage?.bloom?.threshold ?? 5,
      gain: stage?.bloom?.gain ?? 0.22,
      radius: stage?.bloom?.radius ?? 0.35,
    },
    dof: {
      enabled: full && stage?.dof?.enabled === true,
      focus: stage?.dof?.focus ?? 5.5,
      aperture: stage?.dof?.aperture ?? 1,
      focalLength: stage?.dof?.focalLength ?? 2.5,
    },
  };
}

export function hasStagePostfx(stage?: StagePostfxConfig): boolean {
  const resolved = resolveStagePostfx(stage);
  return resolved.bloom.enabled || resolved.dof.enabled;
}
