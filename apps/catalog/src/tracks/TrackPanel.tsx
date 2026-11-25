import {
  addTrack,
  easingTokens,
  removeClip,
  removeRest,
  removeTrack,
  setClip,
  setRest,
  setTrackKeyframes,
  setTrackMotion,
  trackDrivers,
  trackTriggers,
  type Scene,
  type SceneClip,
  type SceneResult,
  type SceneTrack,
  type SceneTrackKeyframe,
} from "@hedronite/lts-scene";
import { useId, useRef, useState } from "react";
import { axes, fromField, readField, shown, toField, type Axis } from "../TransformPanel";
import { defaultOf, freeId, isDriver, isEasingToken, isRotation, isTrigger, kindOf, nodeOf, numberOf, textOf, triple, valueOfText, withAxis, withoutEasing, type MotionValue } from "./values";

/** The class a text, number or select field carries: the house style of the panels beside this one. */
const input = "rounded-md border border-line bg-surface-raised px-2 py-1 text-sm text-fg focus-visible:outline-2 focus-visible:outline-accent aria-[invalid=true]:border-red-600";
const quiet = "text-xs text-fg-muted";
/** A button never under 24 by 24 CSS pixels — the catalog's target size — however short its word. */
const button = "min-h-6 rounded-md border border-line px-2 py-1 text-xs hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40";
const accept = "min-h-6 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";
/** A box in the panel: a row of a list, or a form. */
const card = "flex flex-col gap-2 rounded-md border border-line p-2 break-all";
/** A row of controls inside a box. */
const line = "flex flex-wrap items-end gap-2";
const stack = "flex flex-col gap-2";
/** The name of each axis of a vec3 as a field shows it (`X`), and as a gesture key spells it (`x`). */
const axisNames: Readonly<Record<Axis, string>> = { 0: "X", 1: "Y", 2: "Z" };
const axisParts: Readonly<Record<Axis, string>> = { 0: "x", 1: "y", 2: "z" };
/** What one press of an arrow key moves a time or a number by. */
const STEP = 0.1;
/** How far after the last keyframe a keyframe added to a track lands. */
const AFTER = 0.5;

/** A number with the noise of binary fractions dropped: how a step, and a time added after the last keyframe, are worked out. */
const exact = (value: number): number => Number(value.toFixed(10));

/** What the panel does with an edit: the playground's own `commit`, which pushes a change the document takes and reports one it refuses. */
type Commit = (result: SceneResult, key?: string) => void;

/** What every box of the panel is given: the document, and the way an edit becomes the document. */
interface BoxProps {
  readonly doc: Scene;
  readonly commit: Commit;
}

/** The options of a field that may say nothing: the empty choice first, then one per token in the document's own order. */
const noneThen = (tokens: readonly string[], none: string): readonly (readonly [string, string])[] => [["", none], ...tokens.map((token): readonly [string, string] => [token, token])];

interface NumberFieldProps {
  /** The id the visible label points at. */
  readonly id: string;
  readonly label: string;
  /** The number the document holds, in the field's own unit. */
  readonly value: number;
  /** What one press of an arrow key moves it by. */
  readonly step: number;
  readonly onValue: (value: number) => void;
}

/** A labelled number field: text while it is being typed (so "-", "1." and "" are allowed on the way to a number), read on every keystroke that is one, and stepped by the arrow keys. */
function NumberField({ id, label, value, step, onValue }: NumberFieldProps) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const typed = draft === undefined ? undefined : readField(draft);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={quiet}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step="any"
        value={draft ?? shown(value)}
        aria-invalid={draft !== undefined && typed === undefined ? true : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          const read = readField(event.target.value);
          if (read !== undefined) onValue(read);
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          setDraft(undefined);
          onValue(exact(value + (event.key === "ArrowUp" ? step : -step)));
        }}
        onBlur={() => {
          setDraft(undefined);
        }}
        className={`${input} w-20 tabular-nums`}
      />
    </div>
  );
}

interface SelectFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly (readonly [string, string])[];
  readonly onChoose: (value: string) => void;
}

/** A labelled select of `[value, label]` pairs. */
function SelectField({ id, label, value, options, onChoose }: SelectFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={quiet}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          onChoose(event.target.value);
        }}
        className={`${input} max-w-full`}
      >
        {options.map(([option, text]) => (
          <option key={option} value={option}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}

interface Vec3FieldProps {
  readonly base: string;
  readonly label: string;
  /** Whether the path is a node's rotation: shown in degrees, held in radians. */
  readonly rotation: boolean;
  readonly value: unknown;
  /** The value with one axis given; `part` names the axis the edit came from, for the gesture key. */
  readonly onValue: (value: MotionValue, part: string) => void;
}

/** A vec3 as three labelled number fields: one per axis, each reachable, typeable and steppable on its own. */
function Vec3Field({ base, label, rotation, value, onValue }: Vec3FieldProps) {
  const at = triple(value);
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className={quiet}>
        {label}
        {rotation ? " (degrees)" : ""}
      </legend>
      <div className="flex flex-wrap gap-2">
        {axes.map((axis) => (
          <NumberField
            key={axis}
            id={`${base}-${axisNames[axis]}`}
            label={`${label} ${axisNames[axis]}`}
            value={rotation ? toField("rotation", at[axis]) : at[axis]}
            step={rotation ? 1 : STEP}
            onValue={(next) => {
              onValue(withAxis(at, axis, rotation ? fromField("rotation", next) : next), axisParts[axis]);
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}

interface ParamFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: unknown;
  readonly onValue: (value: MotionValue) => void;
}

/**
 * A parameter's value as text: a number, a word, `true` or `false`, or three numbers in brackets. Read on every keystroke that is one of
 * those, and said to be invalid while it is not — a half-typed value is left alone until it is a value.
 */
function ParamField({ id, label, value, onValue }: ParamFieldProps) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [refused, setRefused] = useState(false);
  const hint = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={quiet}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        aria-describedby={hint}
        aria-invalid={refused ? true : undefined}
        value={draft ?? textOf(value)}
        onChange={(event) => {
          const typed = event.target.value;
          setDraft(typed);
          const read = valueOfText(typed);
          setRefused(typed.trim() !== "" && read === undefined);
          if (read !== undefined) onValue(read);
        }}
        onBlur={() => {
          setDraft(undefined);
          setRefused(false);
        }}
        className={`${input} w-full font-mono`}
      />
      <span id={hint} className="sr-only">
        A number, some text, true or false, or three numbers in brackets.
      </span>
    </div>
  );
}

interface ValueFieldProps {
  readonly base: string;
  readonly label: string;
  /** The path the value belongs to: what says whether it is a vec3, a number or a parameter. */
  readonly target: string;
  readonly value: unknown;
  readonly onValue: (value: MotionValue, part: string) => void;
}

/** The control a value takes from the kind of property its path names: three number fields for a vec3 (degrees for a rotation), one for a number, and a text field for a parameter. */
function ValueField({ base, label, target, value, onValue }: ValueFieldProps) {
  const kind = kindOf(target);
  switch (kind) {
    case "vec3":
      return <Vec3Field base={base} label={label} rotation={isRotation(target)} value={value} onValue={onValue} />;
    case "number":
      return (
        <NumberField
          id={base}
          label={label}
          value={numberOf(value)}
          step={STEP}
          onValue={(next) => {
            onValue(next, "");
          }}
        />
      );
    case "param":
      return (
        <ParamField
          id={base}
          label={label}
          value={value}
          onValue={(next) => {
            onValue(next, "");
          }}
        />
      );
  }
}

interface KeyframeRowProps extends BoxProps {
  readonly track: SceneTrack;
  /** The keyframe's place in its track. */
  readonly at: number;
  readonly keyframe: SceneTrackKeyframe;
}

/** One keyframe of one track: the time it lands on, and the value it holds in the field its track's path asks for. */
function KeyframeRow({ doc, commit, track, at, keyframe }: KeyframeRowProps) {
  const base = useId();
  const number = at + 1;
  /** Writes the track's keyframes with one of them changed; `part` names the field the edit came from, so a run of edits in one field is one step to undo. */
  const write = (keyframes: SceneTrack["keyframes"], part: string): void => {
    commit(setTrackKeyframes(doc, track.id, keyframes), `track.${track.id}.keyframe.${String(at)}.${part}`);
  };
  return (
    <li className={line}>
      <NumberField
        id={`${base}-time`}
        label={`Keyframe ${String(number)} time`}
        value={keyframe.time}
        step={STEP}
        onValue={(time) => {
          write(
            track.keyframes.map((one, index) => (index === at ? { ...one, time } : one)),
            "time",
          );
        }}
      />
      <ValueField
        base={`${base}-value`}
        label={`Keyframe ${String(number)} value`}
        target={track.target}
        value={keyframe.value}
        onValue={(value, part) => {
          write(
            track.keyframes.map((one, index) => (index === at ? { ...one, value } : one)),
            part === "" ? "value" : `value.${part}`,
          );
        }}
      />
      {track.keyframes.length > 1 ? (
        <button
          type="button"
          onClick={() => {
            // Taking a keyframe away is a step of its own, not a run of edits in one field.
            commit(setTrackKeyframes(doc, track.id, track.keyframes.filter((_one, index) => index !== at)));
          }}
          className={button}
        >
          <span className="sr-only">{`Keyframe ${String(number)} of track ${track.id} `}</span>
          Remove
        </button>
      ) : null}
    </li>
  );
}

/** One track: what it drives, the easing its keyframes share, what moves and starts it, and its keyframes, each one editable. */
function TrackRow({ doc, commit, track }: BoxProps & { readonly track: SceneTrack }) {
  const base = useId();
  const named = track.keyframes.map((keyframe) => keyframe.easing);
  const mixed = named.some((token) => token !== named[0]);
  const easing = mixed ? "" : named[0] ?? "";
  const last = track.keyframes[track.keyframes.length - 1];
  const kind = kindOf(track.target);
  const writeEasing = (token: (typeof easingTokens)[number] | undefined): void => {
    commit(
      setTrackKeyframes(
        doc,
        track.id,
        track.keyframes.map((keyframe) => (token === undefined ? withoutEasing(keyframe) : { ...keyframe, easing: token })),
      ),
      `track.${track.id}.easing`,
    );
  };
  return (
    <li className={card}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm">{track.id}</span>
        <button
          type="button"
          onClick={() => {
            commit(removeTrack(doc, track.id));
          }}
          className={button}
        >
          <span className="sr-only">{`Track ${track.id} `}</span>
          Remove
        </button>
      </div>
      <span className={`break-all font-mono ${quiet}`}>{track.target}</span>
      <div className={line}>
        <SelectField
          id={`${base}-driver`}
          label="Driver"
          value={track.driver ?? ""}
          options={noneThen(trackDrivers, "Not said")}
          onChoose={(next) => {
            commit(setTrackMotion(doc, track.id, { driver: isDriver(next) ? next : undefined }), `track.${track.id}.driver`);
          }}
        />
        <SelectField
          id={`${base}-trigger`}
          label="Start"
          value={track.trigger ?? ""}
          options={noneThen(trackTriggers, "Not said")}
          onChoose={(next) => {
            commit(setTrackMotion(doc, track.id, { trigger: isTrigger(next) ? next : undefined }), `track.${track.id}.trigger`);
          }}
        />
        <SelectField
          id={`${base}-easing`}
          label="Easing"
          value={easing}
          options={noneThen(easingTokens, mixed ? "Mixed" : "None")}
          onChoose={(next) => {
            writeEasing(isEasingToken(next) ? next : undefined);
          }}
        />
      </div>
      <ul className={stack}>
        {track.keyframes.map((keyframe, at) => (
          <KeyframeRow key={at} doc={doc} commit={commit} track={track} at={at} keyframe={keyframe} />
        ))}
      </ul>
      <button
        type="button"
        onClick={() => {
          const time = last === undefined ? 0 : exact(last.time + AFTER);
          const at = last === undefined ? defaultOf(kind) : triple(last.value);
          commit(setTrackKeyframes(doc, track.id, [...track.keyframes, { time, value: at }]));
        }}
        className={button}
      >
        Add keyframe
      </button>
    </li>
  );
}

/** The form that adds a track: its id, the property it drives (by path, or from a node), the time and value of its first keyframe, and its easing. */
function AddTrackForm({ doc, commit }: BoxProps) {
  const base = useId();
  const count = useRef(0);
  const [id, setId] = useState("");
  const [target, setTarget] = useState("");
  const [time, setTime] = useState(0);
  const [value, setValue] = useState<MotionValue>([0, 0, 0]);
  const [easing, setEasing] = useState("");
  const path = target.trim();
  const kind = kindOf(path);
  const node = nodeOf(path);
  const suggested = freeId(
    doc.tracks.map((track) => track.id),
    "track",
  );
  /** A new target of another kind takes the value that kind starts at, so the field always holds something the property takes. */
  const setPath = (next: string): void => {
    setTarget(next);
    const nextKind = kindOf(next.trim());
    if (nextKind !== kind) setValue(defaultOf(nextKind));
  };
  const add = (): void => {
    if (path === "") return;
    count.current += 1;
    // One press is one step to undo, however many edits it takes.
    const key = `track.add#${String(count.current)}`;
    // A property with no rest value yet takes one first: a track refuses a target the document holds no pose for. The two edits are one step.
    const rest = Object.hasOwn(doc.rest, path) ? undefined : setRest(doc, path, value);
    if (rest !== undefined) {
      if (!rest.ok) {
        commit(rest, key);
        return;
      }
      commit(rest, key);
    }
    const token = isEasingToken(easing) ? easing : undefined;
    const track: SceneTrack = {
      id: id.trim() === "" ? suggested : id.trim(),
      target: path,
      keyframes: [{ time, value, ...(token === undefined ? {} : { easing: token }) }],
    };
    const result = addTrack(rest === undefined ? doc : rest.scene, track);
    commit(result, key);
    if (result.ok) setId("");
  };
  return (
    <div className={card}>
      <div className={line}>
        <div className="flex grow flex-col gap-1">
          <label htmlFor={`${base}-id`} className={quiet}>
            Id
          </label>
          <input
            id={`${base}-id`}
            type="text"
            value={id}
            placeholder={suggested}
            aria-describedby={`${base}-id-note`}
            onChange={(event) => {
              setId(event.target.value);
            }}
            className={`${input} w-full font-mono`}
          />
          <span id={`${base}-id-note`} className={quiet}>
            Left empty, the track is called {suggested}.
          </span>
        </div>
        <SelectField
          id={`${base}-node`}
          label="Node"
          value={node}
          options={[["", "No node"], ...doc.nodes.map((one): readonly [string, string] => [one.id, one.id])]}
          onChoose={(next) => {
            setPath(next === "" ? "" : `node.${next}.position`);
          }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${base}-target`} className={quiet}>
          Target
        </label>
        <input
          id={`${base}-target`}
          type="text"
          value={target}
          placeholder="node.<id>.position"
          onChange={(event) => {
            setPath(event.target.value);
          }}
          className={`${input} w-full font-mono`}
        />
        <span className={quiet}>One of node.&lt;id&gt;.position | .rotation | .scale, node.&lt;id&gt;.surface.params.&lt;name&gt;, effect.&lt;id&gt;.params.&lt;name&gt;, camera.position | .target | .fov.</span>
      </div>
      <div className={line}>
        <NumberField
          id={`${base}-time`}
          label="Time"
          value={time}
          step={STEP}
          onValue={(next) => {
            setTime(next);
          }}
        />
        <ValueField
          base={`${base}-value`}
          label="Value"
          target={path}
          value={value}
          onValue={(next) => {
            setValue(next);
          }}
        />
        <SelectField
          id={`${base}-easing`}
          label="Easing"
          value={easing}
          options={noneThen(easingTokens, "None")}
          onChoose={(next) => {
            setEasing(next);
          }}
        />
      </div>
      <button type="button" disabled={path === ""} onClick={add} className={accept}>
        Add track
      </button>
    </div>
  );
}

/** One property's rest value: the pose reduced motion holds for it, and the track that drives it when one does. */
function RestRow({ doc, commit, target }: BoxProps & { readonly target: string }) {
  const base = useId();
  const driven = doc.tracks.find((track) => track.target === target);
  return (
    <li className={card}>
      <ValueField
        base={base}
        label={target}
        target={target}
        value={doc.rest[target]}
        onValue={(value, part) => {
          commit(setRest(doc, target, value), part === "" ? `rest.${target}` : `rest.${target}.${part}`);
        }}
      />
      <div className={line}>
        {driven === undefined ? (
          <button
            type="button"
            onClick={() => {
              commit(removeRest(doc, target));
            }}
            className={button}
          >
            <span className="sr-only">{`Rest for ${target} `}</span>
            Remove
          </button>
        ) : (
          <span className={quiet}>Driven by {driven.id}</span>
        )}
      </div>
    </li>
  );
}

/** One clip: the tracks that play together, the easing on the clip, and the way a free track joins it. */
function ClipRow({ doc, commit, clip }: BoxProps & { readonly clip: SceneClip }) {
  const base = useId();
  const free = doc.tracks.map((track) => track.id).filter((id) => !doc.clips.some((one) => one.tracks.includes(id)));
  /** The clip with these tracks: the document adds or replaces a clip by id, so every change to one is written whole. */
  const write = (tracks: readonly string[], easing: (typeof easingTokens)[number] | undefined): void => {
    commit(setClip(doc, { id: clip.id, tracks: [...tracks], ...(easing === undefined ? {} : { easing }) }));
  };
  return (
    <li className={card}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm">{clip.id}</span>
        <button
          type="button"
          onClick={() => {
            commit(removeClip(doc, clip.id));
          }}
          className={button}
        >
          <span className="sr-only">{`Clip ${clip.id} `}</span>
          Remove
        </button>
      </div>
      <ul className="flex flex-wrap gap-2">
        {clip.tracks.map((id) => (
          <li key={id} className="flex items-center gap-1 rounded-md border border-line px-2 py-1">
            <span className="font-mono text-xs">{id}</span>
            <button
              type="button"
              onClick={() => {
                write(
                  clip.tracks.filter((one) => one !== id),
                  clip.easing,
                );
              }}
              className={button}
            >
              <span className="sr-only">{`Track ${id} in clip ${clip.id} `}</span>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className={line}>
        <SelectField
          id={`${base}-easing`}
          label="Easing"
          value={clip.easing ?? ""}
          options={noneThen(easingTokens, "None")}
          onChoose={(next) => {
            write(clip.tracks, isEasingToken(next) ? next : undefined);
          }}
        />
        {free.length === 0 ? null : (
          <SelectField
            id={`${base}-join`}
            label="Add a track to the clip"
            value=""
            options={[["", "Choose a track"], ...free.map((id): readonly [string, string] => [id, id])]}
            onChoose={(next) => {
              if (next !== "") write([...clip.tracks, next], clip.easing);
            }}
          />
        )}
      </div>
    </li>
  );
}

/** The form that adds a clip: its id, and the first track that joins it. */
function AddClipForm({ doc, commit }: BoxProps) {
  const base = useId();
  const [id, setId] = useState("");
  const [track, setTrack] = useState("");
  const [easing, setEasing] = useState("");
  const free = doc.tracks.map((one) => one.id).filter((id) => !doc.clips.some((clip) => clip.tracks.includes(id)));
  const suggested = freeId(
    doc.clips.map((clip) => clip.id),
    "clip",
  );
  return (
    <div className={card}>
      <div className={line}>
        <div className="flex grow flex-col gap-1">
          <label htmlFor={`${base}-id`} className={quiet}>
            Id
          </label>
          <input
            id={`${base}-id`}
            type="text"
            value={id}
            placeholder={suggested}
            aria-describedby={`${base}-id-note`}
            onChange={(event) => {
              setId(event.target.value);
            }}
            className={`${input} w-full font-mono`}
          />
          <span id={`${base}-id-note`} className={quiet}>
            Left empty, the clip is called {suggested}.
          </span>
        </div>
        <SelectField
          id={`${base}-track`}
          label="Track"
          value={track}
          options={[["", "No track"], ...free.map((one): readonly [string, string] => [one, one])]}
          onChoose={(next) => {
            setTrack(next);
          }}
        />
        <SelectField
          id={`${base}-easing`}
          label="Easing"
          value={easing}
          options={noneThen(easingTokens, "None")}
          onChoose={(next) => {
            setEasing(next);
          }}
        />
      </div>
      <button
        type="button"
        onClick={() => {
          const token = isEasingToken(easing) ? easing : undefined;
          const result = setClip(doc, {
            id: id.trim() === "" ? suggested : id.trim(),
            tracks: track === "" ? [] : [track],
            ...(token === undefined ? {} : { easing: token }),
          });
          commit(result);
          if (result.ok) setId("");
        }}
        className={accept}
      >
        Add clip
      </button>
    </div>
  );
}

interface TrackPanelProps {
  /** The document being edited. */
  readonly doc: Scene;
  /** What makes an edit the document: the playground's own `commit`, so every edit here is one step to undo and a refusal is reported beside the stage. */
  readonly commit: Commit;
}

/**
 * The document's motion, as numbers: each track's property path, keyframes (a time and a value each), driver, trigger and easing; the rest pose
 * reduced motion holds for every animated property; and the clips that play tracks together. There is no curve editor: a value is typed into a
 * field, three of them for a vec3 and one for a number or a parameter. Every field is labelled and reachable by the keyboard, each control is at
 * least 24 by 24 CSS pixels, and every edit goes through `commit` — so an edit the document refuses is reported in the playground's own note panel
 * rather than thrown, and no edit reaches the document without a step to undo it.
 */
export function TrackPanel({ doc, commit }: TrackPanelProps) {
  const title = useId();
  const paths = [...new Set([...Object.keys(doc.rest), ...doc.tracks.map((track) => track.target)])];
  return (
    <section aria-labelledby={title} className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <h3 id={title} className="text-sm font-medium">
        Tracks
      </h3>
      <p className={quiet}>
        Motion as data: a track drives one property from its keyframes, a rest value is the pose reduced motion holds, and a clip names the tracks that play
        together.
      </p>
      {doc.tracks.length === 0 ? (
        <p className={quiet}>Nothing moves yet: a track added below drives one property of the document.</p>
      ) : (
        <ul className={stack}>
          {doc.tracks.map((track) => (
            <TrackRow key={track.id} doc={doc} commit={commit} track={track} />
          ))}
        </ul>
      )}
      <fieldset className={stack}>
        <legend className="text-xs font-medium">Add a track</legend>
        <AddTrackForm doc={doc} commit={commit} />
      </fieldset>
      <fieldset className={stack}>
        <legend className="text-xs font-medium">Rest</legend>
        <p className={quiet}>Every animated property has one: a number, some text, true or false, or three numbers in brackets.</p>
        {paths.length === 0 ? (
          <p className={quiet}>No rest values yet: adding a track writes one for the property it drives.</p>
        ) : (
          <ul className={stack}>
            {paths.map((target) => (
              <RestRow key={target} doc={doc} commit={commit} target={target} />
            ))}
          </ul>
        )}
      </fieldset>
      <fieldset className={stack}>
        <legend className="text-xs font-medium">Clips</legend>
        {doc.clips.length === 0 ? (
          <p className={quiet}>No clips yet: a clip plays the tracks that join it together.</p>
        ) : (
          <ul className={stack}>
            {doc.clips.map((clip) => (
              <ClipRow key={clip.id} doc={doc} commit={commit} clip={clip} />
            ))}
          </ul>
        )}
        <AddClipForm doc={doc} commit={commit} />
      </fieldset>
    </section>
  );
}
