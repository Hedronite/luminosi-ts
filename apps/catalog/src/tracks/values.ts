import { easingTokens, propertyOf, trackDrivers, trackTriggers, type PropertyKind, type SceneTrackKeyframe } from "@hedronite/lts-scene";

/**
 * A motion value as the document holds it and as a field shows it: a number, some text, `true` or `false`, or three numbers for a
 * vec3. A triple is a plain, mutable array — the document's own value type is JSON, which a readonly array is not — and every edit
 * builds a fresh one, so a value read out of the document is never written back into it.
 */
export type MotionValue = number | string | boolean | number[];

/** Text a parameter takes that is not JSON at all: one bare word, like a color name or the name of a blend. */
const BARE_WORD = /^[^\s{}[\]",\\]+$/;

/** What a path names, as the kind of value it takes. A path that names no property at all reads as a parameter, so its field still takes a value and the edit says what is wrong with the path. */
export const kindOf = (target: string): PropertyKind => propertyOf(target)?.kind ?? "param";

/** Whether a path names a node's rotation: the document holds it in radians, and the fields show degrees, as the transform panel beside this one does. */
export const isRotation = (target: string): boolean => propertyOf(target)?.kind === "vec3" && target.endsWith(".rotation");

/** The id of the node a path belongs to, or "" for a path that names no node: the camera's, an effect's parameter, or nothing at all. */
export const nodeOf = (target: string): string => propertyOf(target)?.node ?? "";

/** Whether a value the document holds is a number a field can show. */
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Whether a value is three finite numbers: what a vec3 property takes, in a keyframe and in the rest pose alike. */
const isTriple = (value: unknown): value is readonly [number, number, number] => Array.isArray(value) && value.length === 3 && value.every((item: unknown) => isNumber(item));

/** Three numbers as a fresh triple, and anything else as the origin: what a field can be built from when the document holds something else there. */
export const triple = (value: unknown): [number, number, number] => (isTriple(value) ? [value[0], value[1], value[2]] : [0, 0, 0]);

/** The number a value is, or 0 for one that is not: a number field the document holds something else in shows zero rather than nothing. */
export const numberOf = (value: unknown): number => (isNumber(value) ? value : 0);

/** A value with one axis given, as a fresh triple: the other two keep the exact numbers they have. */
export const withAxis = (value: unknown, axis: 0 | 1 | 2, next: number): [number, number, number] => {
  const at = triple(value);
  at[axis] = next;
  return at;
};

/** The value a property of this kind starts at: the origin for a vec3, and zero for a number or a parameter. */
export const defaultOf = (kind: PropertyKind): MotionValue => (kind === "vec3" ? [0, 0, 0] : 0);

/** A value as its field shows it: JSON, so text is quoted and a triple is bracketed. Nothing for a value the document does not hold at all. */
export const textOf = (value: unknown): string => (value === undefined ? "" : JSON.stringify(value));

/**
 * What a person typed, read as a value: a JSON number, text, `true` or `false`, or a bracketed triple, and failing that a bare word as
 * text (a parameter like `gold` is not JSON). Nothing comes back for an empty field or a half-typed one, so a field being typed into
 * never applies a value nobody typed.
 */
export const valueOfText = (text: string): MotionValue | undefined => {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  try {
    const read: unknown = JSON.parse(trimmed);
    if (typeof read === "number" || typeof read === "string" || typeof read === "boolean") return read;
    if (isTriple(read)) return [read[0], read[1], read[2]];
    return undefined;
  } catch {
    // Not JSON at all: a bare word is the text a parameter like "gold" holds.
    return BARE_WORD.test(trimmed) ? trimmed : undefined;
  }
};

/** A keyframe with no easing of its own: the field is left out rather than written as a default the document never named. */
export const withoutEasing = (keyframe: SceneTrackKeyframe): SceneTrackKeyframe => {
  const { easing: _easing, ...rest } = keyframe;
  return rest;
};

/** Whether text names one of the easing tokens a keyframe may carry. */
export const isEasingToken = (value: string): value is (typeof easingTokens)[number] => easingTokens.some((token) => token === value);

/** Whether text names one of the things that may drive a track. */
export const isDriver = (value: string): value is (typeof trackDrivers)[number] => trackDrivers.some((driver) => driver === value);

/** Whether text names one of the things that may start a track. */
export const isTrigger = (value: string): value is (typeof trackTriggers)[number] => trackTriggers.some((trigger) => trigger === value);

/** An id of this prefix that none of `taken` uses: `track-1`, `track-2`, … */
export const freeId = (taken: readonly string[], prefix: string): string => {
  const used = new Set(taken);
  let next = taken.length + 1;
  while (used.has(`${prefix}-${String(next)}`)) next += 1;
  return `${prefix}-${String(next)}`;
};
