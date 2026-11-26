import { resolveStagePostfx, toneMappingModes } from "@hedronite/lts-postfx";
// Types only: a value from this package brings its schema into the 3D set.
import type { SceneEnvironment, SceneStage } from "@hedronite/lts-scene";
import { sceneLighting, type ScenePalette } from "@hedronite/lts-tokens";
import { useId } from "react";

const field = "rounded-lg border border-line bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent";
const box = "size-6 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const roomNames: Readonly<Record<SceneEnvironment["kind"], string>> = { studio: "Studio", gallery: "Gallery", dusk: "Dusk", noir: "Noir" };
const isRoom = (value: string): value is SceneEnvironment["kind"] => Object.hasOwn(roomNames, value);
const toneNames: Readonly<Record<(typeof toneMappingModes)[number], string>> = { aces: "ACES filmic", agx: "AgX", neutral: "Neutral" };

/** `off` is a document with no stage block: the renderer keeps its own tone mapping and exposure, and nothing below applies. */
const qualities = [
  ["off", "Off: renderer defaults"],
  ["full", "Full"],
  ["lite", "Lite: no shadows, bloom or depth of field"],
] as const;

interface ToggleProps {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
}

function Toggle({ label, checked, disabled, onChange }: ToggleProps) {
  return (
    <label className="flex min-h-6 items-center gap-2 text-sm">
      <input
        type="checkbox"
        className={box}
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      {label}
    </label>
  );
}

export interface StageControlsProps {
  readonly environment: SceneEnvironment;
  readonly stage: SceneStage | undefined;
  /** The look's scene colors: its tone mapping and exposure are what the stage uses unless the document says otherwise. */
  readonly palette: ScenePalette;
  /** How far the camera is from what it looks at: where depth of field is focused when it is first turned on. */
  readonly distance: number;
  /** Offer shadows. A stage whose lights hold no key light cannot cast them. Default: true. */
  readonly shadows?: boolean;
  readonly onEnvironment: (environment: SceneEnvironment) => void;
  /** `gesture` names a drag, so a history can take its many values as one step. */
  readonly onStage: (stage: SceneStage | undefined, gesture?: string) => void;
  readonly onGestureEnd?: () => void;
}

/** The environment room and the stage quality of a scene: what its `environment` and `stage` blocks say. */
export function StageControls({ environment, stage, palette, distance, shadows = true, onEnvironment, onStage, onGestureEnd }: StageControlsProps) {
  const id = useId();
  const lighting = sceneLighting(palette);
  const quality = stage?.quality ?? "off";
  // Shadows, bloom and depth of field exist on a full stage only; tone mapping and exposure on any stage.
  const features = quality !== "full";
  const exposure = stage?.exposure ?? lighting.exposure;
  const change = (next: Partial<SceneStage>, gesture?: string): void => {
    onStage({ quality: "full", ...stage, ...next }, gesture);
  };
  /** The stage with one override taken out, so that value follows the look again. */
  const follow = (key: "toneMapping" | "exposure"): void => {
    if (stage === undefined) return;
    const next = { ...stage };
    if (key === "toneMapping") delete next.toneMapping;
    else delete next.exposure;
    onStage(next);
  };
  const shadowsOn = stage?.shadows?.enabled === true;
  const catcher = stage?.shadows?.catcher === true;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Stage</legend>
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={`${id}-room`}>Room</label>
        <select
          id={`${id}-room`}
          className={field}
          value={environment.kind}
          onChange={(event) => {
            const kind = event.target.value;
            if (isRoom(kind)) onEnvironment({ ...environment, kind });
          }}
        >
          {Object.entries(roomNames).map(([kind, name]) => (
            <option key={kind} value={kind}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={`${id}-quality`}>Quality</label>
        <select
          id={`${id}-quality`}
          className={field}
          value={quality}
          onChange={(event) => {
            const next = qualities.find(([value]) => value === event.target.value)?.[0];
            if (next === "off") onStage(undefined);
            else if (next !== undefined) change({ quality: next });
          }}
        >
          {qualities.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {shadows ? (
        <>
          <Toggle
            label="Shadows"
            checked={shadowsOn}
            disabled={features}
            onChange={(enabled) => {
              change({ shadows: { catcher, enabled } });
            }}
          />
          <Toggle
            label="Shadow catcher"
            checked={catcher}
            disabled={features || !shadowsOn}
            onChange={(on) => {
              change({ shadows: { enabled: shadowsOn, catcher: on } });
            }}
          />
        </>
      ) : null}
      <Toggle
        label="Bloom"
        checked={stage?.bloom?.enabled === true}
        disabled={features}
        onChange={(enabled) => {
          change({ bloom: { ...resolveStagePostfx({ bloom: { ...stage?.bloom, enabled: true } }).bloom, enabled } });
        }}
      />
      <Toggle
        label="Depth of field"
        checked={stage?.dof?.enabled === true}
        disabled={features}
        onChange={(enabled) => {
          // The library's own focus distance suits its own camera; from this one it could blur the whole subject.
          change({ dof: { ...resolveStagePostfx({ dof: { focus: distance, ...stage?.dof, enabled: true } }).dof, enabled } });
        }}
      />
      {/* A document with no stage keeps the renderer's own tone mapping and exposure: there is nothing here to set. */}
      {stage === undefined ? null : (
        <>
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor={`${id}-tone`}>Tone mapping</label>
            <select
              id={`${id}-tone`}
              className={field}
              value={stage.toneMapping ?? ""}
              onChange={(event) => {
                const toneMapping = toneMappingModes.find((each) => each === event.target.value);
                if (toneMapping === undefined) follow("toneMapping");
                else change({ toneMapping });
              }}
            >
              <option value="">From the look ({toneNames[lighting.toneMapping]})</option>
              {toneMappingModes.map((mode) => (
                <option key={mode} value={mode}>
                  {toneNames[mode]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor={`${id}-exposure`}>
              Exposure <output>{exposure.toFixed(2)}</output>
            </label>
            <input
              id={`${id}-exposure`}
              type="range"
              className="min-h-6 accent-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              min={0.2}
              max={3}
              step={0.05}
              value={exposure}
              onChange={(event) => {
                change({ exposure: Number(event.target.value) }, "stage.exposure");
              }}
              onPointerUp={onGestureEnd}
              onBlur={onGestureEnd}
            />
            {stage.exposure === undefined ? null : (
              <button
                type="button"
                className="min-h-6 self-start rounded border border-line px-2 py-0.5 text-xs hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent"
                onClick={() => {
                  follow("exposure");
                }}
              >
                Use the look's exposure
              </button>
            )}
          </div>
        </>
      )}
    </fieldset>
  );
}
