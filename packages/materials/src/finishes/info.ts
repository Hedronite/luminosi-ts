import { parameterFields, type ParameterField } from "@hedronite/lts-core";
import { z } from "zod";

const direction = z.number().min(0).max(360).default(0);
/** Noise feature size in surface units; higher is finer detail. */
const scale = z.number().min(0.5).max(40).default(8);
/** How strongly the finish changes the surface, 0 to 1. */
const strength = z.number().min(0).max(1).default(0.5);

export const finishSchemas = {
  brushed: z.object({ scale, strength, direction }),
  weave: z.object({ scale, strength, direction }),
  grain: z.object({ scale, strength }),
  "orange-peel": z.object({ scale, strength }),
  frost: z.object({ scale, strength }),
} as const;

export type FinishId = keyof typeof finishSchemas;
export type FinishParams<Id extends FinishId = FinishId> = z.input<(typeof finishSchemas)[Id]>;

export function isFinishId(id: string): id is FinishId {
  return Object.hasOwn(finishSchemas, id);
}

export const finishIds = Object.keys(finishSchemas).filter(isFinishId).sort();

export interface FinishMeta {
  readonly id: FinishId;
  readonly name: string;
  readonly tags: readonly string[];
}

export const finishList: readonly FinishMeta[] = [
  { id: "brushed", name: "Brushed", tags: ["metal", "anisotropic"] },
  { id: "weave", name: "Weave", tags: ["cloth", "normal"] },
  { id: "grain", name: "Grain", tags: ["wood", "roughness"] },
  { id: "orange-peel", name: "Orange peel", tags: ["paint", "normal"] },
  { id: "frost", name: "Frost", tags: ["glass", "roughness"] },
];

export interface FinishDescriptorData {
  readonly meta: FinishMeta;
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