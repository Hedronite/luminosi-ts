import { finishList } from "@hedronite/lts-materials/finishes/ids";
import { materialPreset, type MaterialId } from "@hedronite/lts-materials";
import type { FinishChoice } from "./FinishControls.js";

export interface FinishApplyResult {
  readonly material: MaterialId;
  readonly finish: FinishChoice | undefined;
  readonly hint?: string;
}

/** Playground rule: keep the node's material when the finish allows it; otherwise take the finish's first declared preset. */
export function finishForNode(material: MaterialId, choice: FinishChoice | undefined): FinishApplyResult {
  if (choice === undefined) return { material, finish: undefined };
  const meta = finishList.find((row) => row.id === choice.id);
  const presets = meta?.presets ?? [];
  if (presets.includes(material)) return { material, finish: choice };
  const next = presets[0];
  if (next === undefined) return { material, finish: choice };
  return { material: next, finish: choice, hint: `Switched surface to ${materialPreset(next).name} so this finish reads as intended.` };
}