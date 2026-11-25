// The easing tokens a scene names, as curves. A document never holds a curve: `easing` says which one, and this is the only place
// a token becomes a function. Each takes a progress from 0 to 1 and gives the eased progress.

export type Easing = (progress: number) => number;

/** Decelerating: fast at first, settling at the end. */
const enter: Easing = (t) => 1 - (1 - t) ** 3;
/** Accelerating: slow at first, quick at the end, and shorter than an entrance. */
const exit: Easing = (t) => t ** 3;
/** Decelerating with no overshoot, softer than `enter`: the last beat of a hero. */
const settle: Easing = (t) => 1 - (1 - t) ** 2;
/** A gentle ease-out with a soft start: hovers and UI state, the default. */
const standard: Easing = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
/** No curve at all: a scrubbed track damps through its driver, so an ease on top of it would read as lag. */
const linear: Easing = (t) => t;

export const easings: Readonly<Record<string, Easing>> = { enter, exit, settle, standard, linear };

/** The curve a token names, or `standard` when a document names none. */
export const easingOf = (token: string | undefined): Easing => (token === undefined ? standard : (easings[token] ?? standard));
