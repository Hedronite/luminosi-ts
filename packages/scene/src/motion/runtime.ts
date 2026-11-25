// The runtime: a document's tracks, driven by a clock the caller advances and by the scroll and pointer the caller hands in, started by
// their triggers. It owns no renderer, no DOM and no wall clock: `advance` is given the seconds that passed and returns what each
// animated property is worth now, so a test can step a scene to any moment and a stage can play it from its own loop.
import type { Scene, SceneTrack } from "../schema.js";
import type { ScrollState } from "./conductor.js";
import { asTrackValue, clipEasingOf, spanOf, valueAt, type TrackValue } from "./evaluate.js";

/** What the runtime reads each step: the scroll the conductor measured, the pointer, and whether the stage is seen or hovered. */
export interface MotionInput {
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
  /** 0 to 1 for a scrubbed or pointer-driven track. */
  progress: number;
  /** Whether the track is playing now. */
  started: boolean;
  /** Whether it has played out and holds its last keyframe. A track that has not started, or has been left, holds its rest value. */
  done: boolean;
  /** Whether the `load` trigger has fired: once, on the first step. */
  loaded: boolean;
  /** What the step before saw, for the two triggers that start on an edge: entering the viewport, and the pointer arriving. */
  wasInView: boolean;
  wasHovered: boolean;
}

const same = (a: TrackValue | undefined, b: TrackValue | undefined): boolean =>
  Array.isArray(a) && Array.isArray(b) ? a[0] === b[0] && a[1] === b[1] && a[2] === b[2] : a === b;

/**
 * The runtime of one document. A track starts by its trigger: `load` on the first step, `hover` on every arrival of the pointer and back
 * to its rest pose when it leaves, `in-view` when the stage is seen (once, unless its id, or its clip's, is in `replay`), and `scroll-scrub`
 * from the scroll's damped progress, so scrolling back plays it back. A track on the clock — a `time` driver — ends at its last keyframe
 * and holds it; a `scroll` or `pointer` track follows its input both ways and holds its rest value when it has none. Under reduced motion
 * nothing starts and nothing moves: every animated property holds its rest value.
 */
export function createMotion(scene: Scene, options: MotionOptions = {}): MotionRuntime {
  const replay = new Set(options.replay ?? []);
  const reduced = options.reducedMotion === true;
  /** Whether the track, or the clip it is in, was asked to play again when it is seen again. */
  const replays = (track: SceneTrack): boolean => replay.has(track.id) || scene.clips.some((clip) => clip.tracks.includes(track.id) && replay.has(clip.id));
  const played = new Map<string, Played>(scene.tracks.map((track) => [track.id, { clock: 0, progress: 0, started: false, done: false, loaded: false, wasInView: false, wasHovered: false }] as const));
  const values = new Map<string, TrackValue>();
  for (const track of scene.tracks) {
    const rest = asTrackValue(scene.rest[track.target]);
    if (rest !== undefined) values.set(track.target, rest);
  }
  let last: MotionFrame = { values, changed: false };

  const step = (seconds: number, input: Partial<Omit<MotionInput, "time">> = {}): MotionFrame => {
    // Under reduced motion nothing starts and nothing moves: every animated property holds the rest value it was given.
    if (reduced) return last;
    const dt = Math.max(0, seconds);
    let changed = false;
    /** The value of one property, set only when it is not the one it already holds. */
    const put = (target: string, value: TrackValue | undefined): void => {
      if (value === undefined || same(values.get(target), value)) return;
      values.set(target, value);
      changed = true;
    };
    for (const track of scene.tracks) {
      const state = played.get(track.id);
      if (state === undefined) continue;
      const target = track.target;
      const rest = asTrackValue(scene.rest[target]);
      const driver = track.driver ?? "time";
      const span = spanOf(track);
      const ease = clipEasingOf(scene, track);
      if (driver === "scroll") {
        // A scrub follows the scroll's damped progress both ways, and holds its rest value when there is no scroll to read.
        if (input.scroll === undefined) {
          state.started = false;
          put(target, rest);
          continue;
        }
        const across = Math.min(1, Math.max(0, input.scroll.smooth));
        state.progress = across;
        state.started = true;
        put(target, valueAt(track, across * span, ease));
        continue;
      }
      if (driver === "pointer") {
        // The pointer's x, -1 to 1 across the stage, maps over the track's span, both ways; with no pointer over the stage it rests.
        if (input.pointer === undefined) {
          state.started = false;
          put(target, rest);
          continue;
        }
        const across = Math.min(1, Math.max(0, (input.pointer.x + 1) / 2));
        state.progress = across;
        state.started = true;
        put(target, valueAt(track, across * span, ease));
        continue;
      }
      // A track on the clock: its trigger decides when it starts.
      switch (track.trigger ?? "load") {
        case "hover": {
          const over = input.hovered === true;
          if (over && !state.wasHovered) {
            state.started = true;
            state.done = false;
            state.clock = 0;
          }
          if (!over) {
            state.started = false;
            state.done = false;
          }
          state.wasHovered = over;
          break;
        }
        case "in-view": {
          const seen = input.inView === true;
          const again = replays(track);
          if (seen && !state.wasInView && !state.started && (!state.done || again)) {
            state.started = true;
            state.done = false;
            state.clock = 0;
          }
          if (!seen && again) {
            state.started = false;
            state.done = false;
          }
          state.wasInView = seen;
          break;
        }
        case "load":
        case "scroll-scrub": {
          // A track on the clock starts on the first step, whatever its trigger says.
          if (!state.loaded) {
            state.loaded = true;
            state.started = true;
            state.clock = 0;
          }
          break;
        }
      }
      if (!state.started) {
        // A track that has played out holds its last keyframe; one that has not started, or has been left, holds its rest value.
        put(target, state.done ? valueAt(track, span, ease) : rest);
        continue;
      }
      state.clock += dt;
      if (state.clock >= span) {
        state.clock = span;
        state.started = false;
        state.done = true;
      }
      put(target, valueAt(track, Math.min(state.clock, span), ease));
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
