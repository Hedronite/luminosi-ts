// The runtime: a document's tracks, driven by a clock the caller advances and by the scroll and pointer the caller hands in, started by
// their triggers. It owns no renderer, no DOM and no wall clock: `advance` is given the seconds that passed and returns what each
// animated property is worth now, so a test can step a scene to any moment and a stage can play it from its own loop.
import type { Scene, SceneTrack } from "../schema.js";
import type { ScrollState } from "./conductor.js";
import { asTrackValue, clipEasingOf, spanOf, valueAt, type TrackValue } from "./evaluate.js";

/** What the runtime reads each step. Everything but the seconds is optional: a scene with no scroll track does not need a scroll. */
export interface MotionInput {
  /** Seconds since the stage started: the injected clock, never the wall clock. */
  readonly time: number;
  readonly scroll?: ScrollState;
  readonly pointer?: { readonly x: number; readonly y: number };
  readonly hovered?: boolean;
  readonly inView?: boolean;
}

/** What a step gives back: every animated property's value, and whether any of them moved since the step before. */
export interface MotionFrame {
  readonly values: ReadonlyMap<string, TrackValue>;
  readonly changed: boolean;
}

export interface MotionOptions {
  /** Tracks (or clips) whose `in-view` trigger may fire more than once. A reveal plays once unless its id is here. */
  readonly replay?: readonly string[];
  /** Under reduced motion nothing moves: every property holds its rest value and no track is started. */
  readonly reducedMotion?: boolean;
}

export interface MotionRuntime {
  /** One step of the clock: the seconds since the last step, and what the drivers read. */
  step(seconds: number, input?: Partial<Omit<MotionInput, "time">>): MotionFrame;
  /** The values as they stand, without stepping: the rest pose before anything moved. */
  readonly values: ReadonlyMap<string, TrackValue>;
  /** Whether anything is moving (a started track that has not ended): a stage with nothing moving need not draw a frame. */
  readonly moving: boolean;
}

interface Played {
  /** Seconds of clip time, for a time-driven track. */
  clock: number;
  /** 0 to 1 for a scrubbed track. */
  progress: number;
  /** Whether the track has started (its trigger fired) and not ended. */
  started: boolean;
  /** Whether an in-view trigger has already fired, for the once-by-default rule. */
  fired: boolean;
}

const same = (a: TrackValue | undefined, b: TrackValue | undefined): boolean =>
  Array.isArray(a) && Array.isArray(b) ? a[0] === b[0] && a[1] === b[1] && a[2] === b[2] : a === b;

/**
 * The runtime of one document. A track starts by its trigger: `load` on the first step, `hover` while the pointer is over the stage and
 * back to its rest pose when it leaves, `in-view` when the stage is seen (once, unless the id is in `replay`), and `scroll-scrub` from
 * the scroll's damped progress, so scrolling back plays it back. A time-driven track ends at its last keyframe and holds it.
 */
export function createMotion(scene: Scene, options: MotionOptions = {}): MotionRuntime {
  const replay = new Set(options.replay ?? []);
  const reduced = options.reducedMotion === true;
  const played = new Map<string, Played>(scene.tracks.map((track) => [track.id, { clock: 0, progress: 0, started: false, fired: false }] as const));
  const values = new Map<string, TrackValue>();
  for (const track of scene.tracks) {
    const rest = asTrackValue(scene.rest[track.target]);
    if (rest !== undefined) values.set(track.target, rest);
  }
  let elapsed = 0;
  let last: MotionFrame = { values, changed: false };

  const startOf = (track: SceneTrack, state: Played, input: MotionInput): boolean => {
    if (reduced) return false;
    switch (track.trigger ?? "load") {
      case "load":
        return true;
      case "hover":
        return input.hovered === true;
      case "in-view": {
        if (input.inView !== true) return false;
        if (state.fired && !replay.has(track.id) && !scene.clips.some((clip) => clip.tracks.includes(track.id) && replay.has(clip.id))) return false;
        return true;
      }
      case "scroll-scrub":
        return input.scroll !== undefined;
    }
  };

  const step = (seconds: number, input: Partial<Omit<MotionInput, "time">> = {}): MotionFrame => {
    const dt = Math.max(0, seconds);
    elapsed += dt;
    const full: MotionInput = { time: elapsed, ...input };
    let changed = false;
    for (const track of scene.tracks) {
      const state = played.get(track.id);
      if (state === undefined) continue;
      const driver = track.driver ?? "time";
      const span = spanOf(track);
      const fires = startOf(track, state, full);
      if (driver === "scroll") {
        // A scrub follows progress whether or not it has "started": there is no time of its own to run out.
        const progress = full.scroll?.smooth ?? 0;
        const next = Math.min(1, Math.max(0, progress));
        state.progress = next;
        state.started = fires && next > 0;
        const value = valueAt(track, next * span, clipEasingOf(scene, track));
        if (!same(values.get(track.target), value)) {
          values.set(track.target, value);
          changed = true;
        }
        continue;
      }
      const again = replay.has(track.id) || scene.clips.some((clip) => clip.tracks.includes(track.id) && replay.has(clip.id));
      if (track.trigger === "hover" && full.hovered !== true) state.started = false;
      if (fires && (!state.fired || again)) {
        state.started = true;
        state.fired = true;
        state.clock = 0;
      }
      if (!state.started) {
        const rest = asTrackValue(scene.rest[track.target]);
        if (rest !== undefined && !same(values.get(track.target), rest)) {
          values.set(track.target, rest);
          changed = true;
        }
        continue;
      }
      state.clock += driver === "pointer" ? dt * (Math.abs(full.pointer?.x ?? 0) + Math.abs(full.pointer?.y ?? 0)) : dt;
      const at = Math.min(state.clock, span);
      const value = valueAt(track, at, clipEasingOf(scene, track));
      if (!same(values.get(track.target), value)) {
        values.set(track.target, value);
        changed = true;
      }
      if (driver === "time" && at >= span) state.started = false;
    }
    last = { values, changed };
    return last;
  };

  return {
    step,
    get values() {
      return last.values;
    },
    get moving() {
      return [...played.values()].some((state) => state.started);
    },
  };
}
