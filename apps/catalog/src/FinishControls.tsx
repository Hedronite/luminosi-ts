import { finishList, finishSchemas, isFinishId, type FinishId, type MaterialId } from "@hedronite/lts-materials";
import { materialPreset } from "@hedronite/lts-materials";
import { useId } from "react";

const field = "rounded-lg border border-line bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent min-h-6 min-w-[4.5rem]";

export interface FinishChoice {
  readonly id: FinishId;
  readonly params: Record<string, number | string | boolean>;
}

/** Finishes whose declared presets include `material`, in catalog order. */
export function finishesForMaterial(material: MaterialId): readonly (typeof finishList)[number][] {
  return finishList.filter((row) => row.presets.includes(material));
}

/** Default params for a finish, from its schema. */
export function defaultFinishParams(id: FinishId): FinishChoice["params"] {
  return { ...(finishSchemas[id].parse({}) as FinishChoice["params"]) };
}

export interface FinishControlsProps {
  readonly material: MaterialId;
  readonly value: FinishChoice | undefined;
  readonly hint?: string;
  readonly onChange: (next: FinishChoice | undefined) => void;
}

/** Labelled finish picker: lists only finishes that belong on this material preset. */
export function FinishControls({ material, value, hint, onChange }: FinishControlsProps) {
  const id = useId();
  const options = finishesForMaterial(material);
  if (options.length === 0) return null;
  const selected = value?.id ?? "";
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-finish`}>Finish</label>
        <select
          id={`${id}-finish`}
          className={field}
          value={selected}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "") onChange(undefined);
            else if (isFinishId(next)) onChange({ id: next, params: defaultFinishParams(next) });
          }}
        >
          <option value="">None</option>
          {options.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
        {hint === undefined ? null : (
          <p className="text-fg-muted" role="status">
            {hint}
          </p>
        )}
      </div>
      {value === undefined ? null : (
        <label className="flex flex-col gap-1">
          <span>
            Strength <output>{Number(value.params.strength ?? 0.5).toFixed(2)}</output>
          </span>
          <input
            type="range"
            className="min-h-6 accent-accent"
            min={0}
            max={1}
            step={0.05}
            value={Number(value.params.strength ?? 0.5)}
            onChange={(event) => {
              onChange({ ...value, params: { ...value.params, strength: Number(event.target.value) } });
            }}
          />
        </label>
      )}
    </div>
  );
}

export interface FinishApplyResult {
  readonly material: MaterialId;
  readonly finish: FinishChoice | undefined;
  readonly hint?: string;
}

/**
 * Playground rule: keep the node's material when the finish allows it; otherwise take the finish's first declared preset.
 */
export function finishForNode(material: MaterialId, choice: FinishChoice | undefined): FinishApplyResult {
  if (choice === undefined) return { material, finish: undefined };
  const meta = finishList.find((row) => row.id === choice.id);
  const presets = meta?.presets ?? [];
  if (presets.includes(material)) return { material, finish: choice };
  const next = presets[0];
  if (next === undefined) return { material, finish: choice };
  return { material: next, finish: choice, hint: `Switched surface to ${materialPreset(next).name} so this finish reads as intended.` };
}