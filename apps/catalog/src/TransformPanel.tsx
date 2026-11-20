import type { SceneNode, TransformChange } from "@hedronite/lts-scene";
import { useId, useRef, useState } from "react";

/** The three transforms a node has, each three numbers: where it is, how it is turned and how big it is, all relative to its parent. */
export type Group = "position" | "rotation" | "scale";
export type Axis = 0 | 1 | 2;

export const groups: readonly Group[] = ["position", "rotation", "scale"];
export const axes: readonly Axis[] = [0, 1, 2];
const axisName = ["X", "Y", "Z"] as const;
const title: Readonly<Record<Group, string>> = { position: "Position", rotation: "Rotation", scale: "Scale" };

/** What one press of an arrow key moves a field by, in the field's own unit: a tenth of a unit, a degree. Shift is ten times that, Alt a tenth. */
const STEP: Readonly<Record<Group, number>> = { position: 0.1, rotation: 1, scale: 0.1 };
const COARSE = 10;
const FINE = 0.1;

/** The document holds rotations in radians; the field shows degrees. Position and scale are the same in both. */
export const toField = (group: Group, value: number): number => (group === "rotation" ? (value * 180) / Math.PI : value);
export const fromField = (group: Group, value: number): number => (group === "rotation" ? (value * Math.PI) / 180 : value);

/** A value as a field shows it when it is not being typed into: at most six decimals, with no trailing zeros. */
export const shown = (value: number): string => String(Number(value.toFixed(6)));

/** The number in text a person typed, or undefined where it is not one (empty, partial, or not finite). */
export function readField(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * The change that sets one axis of one transform of `node` to `value` (in the field's unit), and nothing else: the other two axes
 * keep the exact numbers they have, so editing one field never moves another by a rounding.
 */
export function withAxis(node: SceneNode, group: Group, axis: Axis, value: number): TransformChange {
  const current = node[group];
  const next: [number, number, number] = [current[0], current[1], current[2]];
  next[axis] = fromField(group, value);
  switch (group) {
    case "position":
      return { position: next };
    case "rotation":
      return { rotation: next };
    case "scale":
      return { scale: next };
  }
}

/** The change one press of an arrow key makes: from the exact number the field has, one step up (`direction` 1) or down (-1), larger with Shift and smaller with Alt. */
export function nudged(node: SceneNode, group: Group, axis: Axis, direction: 1 | -1, modifier: { readonly shift?: boolean; readonly alt?: boolean } = {}): TransformChange {
  const amount = STEP[group] * (modifier.shift === true ? COARSE : modifier.alt === true ? FINE : 1);
  // Ten decimals drop the noise of 0.1 + 0.2 and are far below what a document needs (1e-9).
  return withAxis(node, group, axis, Number((toField(group, node[group][axis]) + direction * amount).toFixed(10)));
}

const input = "w-24 rounded-md border border-line bg-surface-raised px-2 py-1 text-sm text-fg tabular-nums focus-visible:outline-2 focus-visible:outline-accent aria-[invalid=true]:border-red-600";

interface AxisFieldProps {
  readonly id: string;
  readonly label: string;
  /** The value the document has, in the field's unit. */
  readonly value: number;
  readonly onValue: (value: number) => void;
  readonly onNudge: (direction: 1 | -1, modifier: { readonly shift: boolean; readonly alt: boolean }) => void;
  readonly onEnd: () => void;
}

function AxisField({ id, label, value, onValue, onNudge, onEnd }: AxisFieldProps) {
  // The text being typed, kept until the field loses focus, so "-", "1." and "" can be typed on the way to a number.
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const invalid = draft !== undefined && readField(draft) === undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-fg-muted">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step="any"
        value={draft ?? shown(value)}
        aria-invalid={invalid ? true : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          const typed = readField(event.target.value);
          if (typed !== undefined) onValue(typed);
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          setDraft(undefined);
          onNudge(event.key === "ArrowUp" ? 1 : -1, { shift: event.shiftKey, alt: event.altKey });
        }}
        onBlur={() => {
          setDraft(undefined);
          onEnd();
        }}
        className={input}
      />
    </div>
  );
}

export interface TransformPanelProps {
  /** The node being edited, or null when none is selected. */
  readonly node: SceneNode | null;
  /** How the node reads in the scene list. */
  readonly label?: string;
  /**
   * A change to one transform of the node. `gesture` names the run of changes it belongs to (one node's one field, until the field loses
   * focus), and is the key a history folds them into one step by.
   */
  readonly onChange: (change: TransformChange, gesture: string) => void;
  /** The field being edited lost focus: the gesture is over. */
  readonly onGestureEnd: () => void;
}

/**
 * Edits one node's position, rotation (degrees in the field, radians in the document) and scale, each of the three axes in a labelled field. The
 * numbers are relative to the node's parent, as the document holds them, and a node nested in another says so. Arrow keys nudge the focused field.
 */
export function TransformPanel({ node, label, onChange, onGestureEnd }: TransformPanelProps) {
  const base = useId();
  const count = useRef(0);
  if (node === null) {
    return (
      <section aria-label="Transform" className="rounded-lg border border-line p-3 text-sm text-fg-muted">
        Select a node in the scene list to move, turn or scale it.
      </section>
    );
  }
  const end = (): void => {
    count.current += 1;
    onGestureEnd();
  };
  const gesture = (group: Group, axis: Axis): string => `${node.id}.${group}.${axisName[axis]}#${String(count.current)}`;
  return (
    <section aria-label="Transform" className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <h3 className="text-sm font-medium">Transform{label === undefined ? "" : `: ${label}`}</h3>
      {node.parent === null ? null : <p className="text-xs text-fg-muted">Relative to {node.parent}</p>}
      {groups.map((group) => (
        <fieldset key={group} className="flex flex-col gap-1">
          <legend className="text-xs font-medium">
            {title[group]}
            {group === "rotation" ? " (degrees)" : ""}
          </legend>
          <div className="flex flex-wrap gap-2">
            {axes.map((axis) => (
              <AxisField
                key={axis}
                id={`${base}-${group}-${axisName[axis]}`}
                label={`${title[group]} ${axisName[axis]}`}
                value={toField(group, node[group][axis])}
                onValue={(value) => {
                  onChange(withAxis(node, group, axis, value), gesture(group, axis));
                }}
                onNudge={(direction, modifier) => {
                  onChange(nudged(node, group, axis, direction, modifier), gesture(group, axis));
                }}
                onEnd={end}
              />
            ))}
          </div>
        </fieldset>
      ))}
    </section>
  );
}
