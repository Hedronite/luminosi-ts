// What a track is worth at a moment: its keyframes interpolated by the token each one names, and a value that is not a number or a
// vec3 held until the next keyframe (`stepped`), because a string has no midway point.
import { easingOf, type Easing } from "./easing.js";
import type { Scene, SceneTrack } from "../schema.js";

/** A value a track can hold: the kinds the schema accepts for a property. */
export type TrackValue = readonly number[] | number | string | boolean;

const isVec3 = (value: unknown): value is readonly number[] => Array.isArray(value) && value.length === 3 && value.every((one) => typeof one === "number");

/**
 * A value read from a document as a track can hold it, or `undefined` when it holds something else: the schema gives
 * back `JSON`, and narrowing it is what keeps a cast out of every read.
 */
export const asTrackValue = (value: unknown): TrackValue | undefined => {
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
  return isVec3(value) ? value : undefined;
};

const mix = (from: number, to: number, t: number): number => from + (to - from) * t;

/**
 * The value a track has at `time` seconds, in the track's own time base: before the first keyframe it is the first, after the last it is the
 * last, and between two it is the eased interpolation of their values. A pair whose values are not two numbers or two vec3s holds the
 * earlier one (a string has no midway point), which is what a stepped keyframe means.
 */
export function valueAt(track: SceneTrack, time: number, defaultEasing?: string): TrackValue {
  const frames = track.keyframes;
  const first = frames[0];
  if (first === undefined) throw new Error("a track has keyframes");
  const start = asTrackValue(first.value);
  if (start === undefined) throw new Error("a keyframe holds a value a track can hold");
  if (time <= first.time) return start;
  for (let at = 1; at < frames.length; at += 1) {
    const previous = frames[at - 1];
    const next = frames[at];
    if (previous === undefined || next === undefined || time > next.time) continue;
    const from = asTrackValue(previous.value);
    const to = asTrackValue(next.value);
    if (from === undefined || to === undefined) continue;
    const span = next.time - previous.time;
    const raw = span <= 0 ? 1 : (time - previous.time) / span;
    const ease: Easing = easingOf(previous.easing ?? defaultEasing);
    if (raw >= 1) return to;
    const t = ease(raw);
    if (typeof from === "number" && typeof to === "number") return mix(from, to, t);
    if (isVec3(from) && isVec3(to)) return [mix(from[0] ?? 0, to[0] ?? 0, t), mix(from[1] ?? 0, to[1] ?? 0, t), mix(from[2] ?? 0, to[2] ?? 0, t)];
    return from;
  }
  const last = frames[frames.length - 1];
  if (last === undefined) throw new Error("a track has keyframes");
  const end = asTrackValue(last.value);
  if (end === undefined) throw new Error("a keyframe holds a value a track can hold");
  return end;
}

/** How long a track lasts, in seconds: the last keyframe's time. */
export const spanOf = (track: SceneTrack): number => track.keyframes[track.keyframes.length - 1]?.time ?? 0;

/** The easing a clip gives its tracks: the token it names, for a track whose keyframes name none. */
export function clipEasingOf(scene: Scene, track: SceneTrack): string | undefined {
  const clip = scene.clips.find((candidate) => candidate.tracks.includes(track.id));
  return clip?.easing;
}
