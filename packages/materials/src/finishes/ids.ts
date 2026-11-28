import type { MaterialId } from "../presets.js";

export const finishIds = ["brushed", "frost", "grain", "orange-peel", "weave"] as const;
export type FinishId = (typeof finishIds)[number];

export function isFinishId(id: string): id is FinishId {
  return (finishIds as readonly string[]).includes(id);
}

export interface FinishMeta {
  readonly id: FinishId;
  readonly name: string;
  readonly tags: readonly string[];
  /** Target material presets; catalog and R8 use the first entry. */
  readonly presets: readonly MaterialId[];
}

export const finishList: readonly FinishMeta[] = [
  { id: "brushed", name: "Brushed", tags: ["metal", "anisotropic"], presets: ["metal", "metal-brushed"] },
  { id: "weave", name: "Weave", tags: ["cloth", "normal"], presets: ["fabric", "satin"] },
  { id: "grain", name: "Grain", tags: ["wood", "roughness"], presets: ["satin", "matte"] },
  { id: "orange-peel", name: "Orange peel", tags: ["paint", "normal"], presets: ["clearcoat", "ceramic"] },
  { id: "frost", name: "Frost", tags: ["glass", "roughness"], presets: ["glass", "glass-frosted"] },
];

/** Default parameter values for each finish (matches schema `.parse({})`). */
export const finishDefaultParams: Readonly<Record<FinishId, Readonly<Record<string, number>>>> = {
  brushed: { scale: 8, strength: 0.5, direction: 0 },
  weave: { scale: 16, strength: 0.78, direction: 0 },
  grain: { scale: 12, strength: 0.85 },
  "orange-peel": { scale: 12, strength: 0.75 },
  frost: { scale: 8, strength: 0.5 },
};