import { parameterFields, type ParameterField } from "@hedronite/lts-core";
import { z } from "zod";
import { type MaterialId } from "../presets.js";
import { finishList, type FinishId, type FinishMeta } from "./ids.js";

const direction = z.number().min(0).max(360).default(0);
/** Noise feature size in surface units; higher is finer detail. */
const scale = z.number().min(0.5).max(40).default(8);
const peelScale = z.number().min(0.5).max(40).default(12);
const peelStrength = z.number().min(0).max(1).default(0.75);
const weaveScale = z.number().min(0.5).max(40).default(16);
const grainScale = z.number().min(0.5).max(40).default(12);
/** How strongly the finish changes the surface, 0 to 1. */
const strength = z.number().min(0).max(1).default(0.5);
const weaveStrength = z.number().min(0).max(1).default(0.78);
const grainStrength = z.number().min(0).max(1).default(0.85);

export const finishSchemas = {
  brushed: z.object({ scale, strength, direction }),
  weave: z.object({ scale: weaveScale, strength: weaveStrength, direction }),
  grain: z.object({ scale: grainScale, strength: grainStrength }),
  "orange-peel": z.object({ scale: peelScale, strength: peelStrength }),
  frost: z.object({ scale, strength }),
} as const;

export type { FinishId, FinishMeta } from "./ids.js";
export { finishIds, finishList, isFinishId } from "./ids.js";
export type FinishParams<Id extends FinishId = FinishId> = z.input<(typeof finishSchemas)[Id]>;

export interface FinishDescriptorData {
  readonly meta: FinishMeta;
  readonly presets: readonly MaterialId[];
  readonly parameters: (typeof finishSchemas)[FinishId];
  readonly fields: readonly ParameterField[];
  readonly defaults: Readonly<Record<string, unknown>>;
}

/** Catalog-ready finish metadata and parameter bounds, without three.js. */
export function finishDescriptors(): readonly FinishDescriptorData[] {
  return finishList.map((meta) => {
    const parameters = finishSchemas[meta.id];
    return {
      meta,
      presets: meta.presets,
      parameters,
      fields: parameterFields(parameters),
      defaults: Object.freeze({ ...parameters.parse({}) }),
    };
  });
}

/** One finish's descriptor entry. */
export function finishDescriptor(id: FinishId): FinishDescriptorData {
  const found = finishDescriptors().find((candidate) => candidate.meta.id === id);
  if (found === undefined) throw new RangeError(`unknown finish "${id}"`);
  return found;
}