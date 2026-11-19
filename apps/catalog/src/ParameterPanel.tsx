import type { ParameterField } from "@hedronite/lts-core";
import { useState } from "react";
import { accepts, formatParams, shownFields, structuralParams, withEdit, type Described, type Values } from "./paramFit";
import { writeParamsText } from "./paramsAddress";

const input = "rounded-md border border-line bg-surface-raised px-2 py-1 text-sm text-fg focus-visible:outline-2 focus-visible:outline-accent aria-[invalid=true]:border-red-600";
const quiet = "text-xs text-fg-muted";
const small =
  "rounded-md border border-line px-2 py-1 text-xs hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40";

/** The decimals a step has, so a slider's value is not written as 0.30000000000000004. */
const decimals = (step: number | undefined): number => (step === undefined ? 6 : Math.min(8, (String(step).split(".")[1] ?? "").length));

interface FieldProps {
  /** The id the visible label points at: the number input's. */
  readonly id: string;
  readonly field: ParameterField;
  /** The value now in force; undefined for a parameter with no default that has not been set. */
  readonly value: unknown;
  readonly set: boolean;
  readonly rebuilds: boolean;
  /** Applies a value, or clears one with undefined. False when the asset's schema does not take it. */
  readonly apply: (value: unknown) => boolean;
}

interface ControlProps extends FieldProps {
  /** The note that says the parameter rebuilds the asset, when it does. */
  readonly describedBy: string | undefined;
}

function NumberControl({ id, field, value, set, describedBy, apply }: ControlProps) {
  // Text being typed, kept until the field loses focus, so "1." and "" can be typed on the way to a value.
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [refused, setRefused] = useState(false);
  const number = typeof value === "number" ? value : undefined;
  const bounded = field.min !== undefined && field.max !== undefined;
  const places = decimals(field.step);
  const shown = draft ?? (number === undefined ? "" : String(number));
  return (
    <div className="flex items-center gap-3">
      {bounded ? (
        <input
          type="range"
          aria-label={`${field.label}, slider`}
          aria-describedby={describedBy}
          min={field.min}
          max={field.max}
          step={field.step ?? "any"}
          value={number ?? field.min}
          onChange={(event) => {
            setDraft(undefined);
            setRefused(!apply(Number(Number(event.target.value).toFixed(places))));
          }}
          className="min-w-0 flex-1 accent-accent"
        />
      ) : null}
      <input
        id={id}
        type="number"
        aria-describedby={describedBy}
        aria-invalid={refused}
        min={field.min}
        max={field.max}
        step={field.step ?? "any"}
        value={shown}
        placeholder={set ? undefined : "not set"}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          if (text.trim() === "") {
            // Emptied: a parameter with no default goes back to unset; one with a default waits for a number.
            setRefused(field.default !== undefined);
            if (field.default === undefined) apply(undefined);
            return;
          }
          setRefused(!apply(Number(text)));
        }}
        onBlur={() => {
          setDraft(undefined);
        }}
        className={`${input} w-24`}
      />
    </div>
  );
}

function ColorControl({ id, value, set, describedBy, apply }: ControlProps) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="color"
        id={id}
        aria-describedby={describedBy}
        value={typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "#808080"}
        onChange={(event) => {
          apply(event.target.value);
        }}
        className="h-8 w-12 cursor-pointer rounded-md border border-line bg-surface-raised p-0.5 focus-visible:outline-2 focus-visible:outline-accent"
      />
      <span className={quiet}>{set && typeof value === "string" ? value : "from the look"}</span>
    </div>
  );
}

function ChoiceControl({ id, field, value, describedBy, apply }: ControlProps) {
  return (
    <select
      id={id}
      aria-describedby={describedBy}
      value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
      onChange={(event) => {
        const chosen = field.options?.find((option) => String(option) === event.target.value);
        if (chosen !== undefined) apply(chosen);
      }}
      className={`${input} max-w-full`}
    >
      {field.options?.map((option) => (
        <option key={String(option)} value={String(option)}>
          {String(option)}
        </option>
      ))}
    </select>
  );
}

function SwitchControl({ id, value, describedBy, apply }: ControlProps) {
  return (
    <input
      type="checkbox"
      role="switch"
      id={id}
      aria-describedby={describedBy}
      checked={value === true}
      onChange={(event) => {
        apply(event.target.checked);
      }}
      className="size-5 accent-accent"
    />
  );
}

function TextControl({ id, field, value, set, describedBy, apply }: ControlProps) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [refused, setRefused] = useState(false);
  // Text applies when it is done (Enter, or leaving the field): a half-typed ramp would rebuild the asset on every key.
  const commit = (): void => {
    if (draft === undefined) return;
    // Emptied: a parameter with no default is unset again.
    setRefused(draft === "" ? field.default !== undefined : !apply(draft));
    if (draft === "" && field.default === undefined) apply(undefined);
    setDraft(undefined);
  };
  return (
    <input
      type="text"
      id={id}
      aria-describedby={describedBy}
      aria-invalid={refused}
      value={draft ?? (typeof value === "string" ? value : "")}
      placeholder={set ? undefined : "not set"}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
      className={`${input} w-full font-mono`}
    />
  );
}

/** One control for one parameter: the label, the typed control, what it does to the asset when it rebuilds, and a way to clear one that has no default. */
function Control(props: FieldProps) {
  const { id, field, rebuilds, set, apply } = props;
  const note = `${id}-note`;
  const clearable = field.default === undefined && field.optional && set;
  const describedBy = rebuilds ? note : undefined;
  const shared = { ...props, describedBy };
  const control = (() => {
    switch (field.type) {
      case "number":
      case "integer":
        return <NumberControl {...shared} />;
      case "color":
        return <ColorControl {...shared} />;
      case "choice":
        return <ChoiceControl {...shared} />;
      case "boolean":
        return <SwitchControl {...shared} />;
      case "string":
        return <TextControl {...shared} />;
    }
  })();
  return (
    <div className="grid gap-1" data-parameter={field.key}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm">
          {field.label}
        </label>
        <span className="flex items-center gap-2">
          {rebuilds ? (
            <span id={note} className={quiet}>
              Rebuilds the asset
            </span>
          ) : null}
          {clearable ? (
            <button
              type="button"
              onClick={() => {
                apply(undefined);
              }}
              className={small}
            >
              Clear<span className="sr-only"> {field.label}</span>
            </button>
          ) : null}
        </span>
      </div>
      {control}
    </div>
  );
}

export interface ParameterPanelProps {
  readonly described: Described;
  /** The asset's id: which of its parameters are baked into it (see `structuralParams`). */
  readonly assetId: string;
  /** What the asset is when a parameter rebuilds it: "shader", "screen effect". */
  readonly noun: string;
  /** What the address holds, fitted to the asset. */
  readonly overrides: Values;
  /** What the asset shows with nothing in the address. */
  readonly start: Values;
}

/** Parameter fields grouped by `group` in the order the groups first appear; those with no group come first. */
function grouped(fields: readonly ParameterField[]): readonly (readonly [string | undefined, readonly ParameterField[]])[] {
  const groups = new Map<string | undefined, ParameterField[]>();
  for (const field of fields) groups.set(field.group, [...(groups.get(field.group) ?? []), field]);
  return [...groups].sort(([a], [b]) => (a === undefined ? 0 : 1) - (b === undefined ? 0 : 1));
}

/**
 * The parameter panel: one control for each parameter of the asset, made from its schema and its `fields` hints (a number is
 * a slider and a number input, a color a color input, a choice a select, a boolean a switch, text a text input), grouped as
 * the hints group them. An edit goes to the address (`?params=`), and the viewport, the usage snippets and this panel all
 * read it from there. Its own lazy chunk: it loads when the detail view of an asset with parameters opens.
 */
export default function ParameterPanel({ described, assetId, noun, overrides, start }: ParameterPanelProps) {
  const [notice, setNotice] = useState("");
  const structural = structuralParams[assetId] ?? [];
  const values = { ...start, ...overrides };
  const edit = (field: ParameterField, value: unknown): boolean => {
    if (value !== undefined && !accepts(described, field.key, value)) return false;
    writeParamsText(formatParams(withEdit(start, overrides, field.key, value)));
    setNotice(structural.includes(field.key) ? `${field.label} is built into the ${noun}, so changing it rebuilds the ${noun}.` : "");
    return true;
  };
  const changed = Object.keys(overrides).length > 0;
  return (
    <section aria-labelledby="parameters-title" className="mt-6">
      <div className="flex items-center justify-between gap-3">
        <h3 id="parameters-title" className="text-sm font-medium">
          Parameters
        </h3>
        <button
          type="button"
          disabled={!changed}
          onClick={() => {
            writeParamsText("");
            setNotice("");
          }}
          className={small}
        >
          Reset to defaults
        </button>
      </div>
      <p role="status" className={`mt-1 min-h-4 ${quiet}`}>
        {notice}
      </p>
      <div className="mt-2 grid gap-4">
        {grouped(shownFields(described)).map(([group, fields]) => {
          const controls = fields.map((field) => (
            <Control
              key={field.key}
              id={`parameter-${field.key}`}
              field={field}
              value={values[field.key]}
              set={Object.hasOwn(values, field.key) && values[field.key] !== undefined}
              rebuilds={structural.includes(field.key)}
              apply={(value) => edit(field, value)}
            />
          ));
          return group === undefined ? (
            <div key="" className="grid gap-3">
              {controls}
            </div>
          ) : (
            <fieldset key={group} className="grid gap-3 rounded-lg border border-line p-3">
              <legend className="px-1 text-xs uppercase tracking-wide text-fg-muted">{group}</legend>
              {controls}
            </fieldset>
          );
        })}
      </div>
    </section>
  );
}
