// The scroll conductor: a document's scroll position as a progress from 0 to 1, damped, with its direction. Nothing here reads the DOM:
// the caller hands it the anchors it measured, the scroll position and the scrollable height, and it gives back what the scene should
// draw. That is what makes a scrubbed scene reversible, the same on a fast machine and a slow one, and testable without a browser.
/** How fast the damped copy catches the exact one: about 5 settles in a third of a second. */
export const DAMPING = 5;
/** The longest step one frame may take, in seconds: a stall does not jump the scene. */
export const LONGEST_STEP = 1 / 30;

/** Where the scroll is: the exact progress, the damped one it draws, and which way it is going. */
export interface ScrollState {
  readonly progress: number;
  readonly smooth: number;
  readonly direction: -1 | 0 | 1;
}

/** What the conductor reads each frame. */
export interface ScrollInput {
  /** The scroll positions of the scene's anchors, rising, the first 0 and the last the end. */
  readonly anchors: readonly number[];
  readonly scrollY: number;
  readonly maxScroll: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** The exact progress at a scroll position: between two anchors it is their index plus how far between them the position is. */
export function progressAt(anchors: readonly number[], scrollY: number, maxScroll: number): number {
  if (anchors.length < 2) return 0;
  const y = clamp(scrollY, 0, maxScroll);
  const first = anchors[0] ?? 0;
  if (y <= first) return 0;
  for (let at = 0; at < anchors.length - 1; at += 1) {
    const here = anchors[at] ?? 0;
    const next = anchors[at + 1] ?? here;
    if (y <= next) return at + clamp((y - here) / Math.max(1, next - here), 0, 1);
  }
  return anchors.length - 1;
}

/** A conductor, kept between frames: it holds the damped state and the direction it last moved in. */
export interface Conductor {
  /** One frame: where the scroll is now, and how long the frame took. Under reduced motion the damped copy is the exact one. */
  step(input: ScrollInput, seconds: number, reducedMotion?: boolean): ScrollState;
  readonly state: ScrollState;
}

/** A conductor that starts at the top of the document. */
export function createConductor(): Conductor {
  let state: ScrollState = { progress: 0, smooth: 0, direction: 0 };
  let previousY: number | undefined;
  return {
    get state() {
      return state;
    },
    step(input, seconds, reducedMotion = false) {
      const progress = progressAt(input.anchors, input.scrollY, input.maxScroll);
      const delta = previousY === undefined ? 0 : input.scrollY - previousY;
      previousY = input.scrollY;
      const direction: -1 | 0 | 1 = Math.abs(delta) > 0.25 ? (delta > 0 ? 1 : -1) : state.direction;
      const dt = clamp(seconds, 0, LONGEST_STEP);
      const smooth = reducedMotion ? progress : state.smooth + (progress - state.smooth) * (1 - Math.exp(-DAMPING * dt));
      state = { progress, smooth: Math.abs(smooth - progress) < 0.0001 ? progress : smooth, direction };
      return state;
    },
  };
}

/** The anchors of a document's sections, measured from their offsets: the first is the top, each other its midpoint, the last the end. */
export function anchorsOf(sections: readonly { readonly offsetTop: number; readonly offsetHeight: number }[], viewport: number, maxScroll: number): number[] {
  if (sections.length === 0) return [0, Math.max(1, maxScroll)];
  const found = sections.map((section, index) => (index === 0 ? 0 : clamp(section.offsetTop + section.offsetHeight / 2 - viewport / 2, 0, maxScroll)));
  const rising: number[] = [];
  for (const [index, anchor] of found.entries()) rising.push(index === 0 ? anchor : Math.max(anchor, (rising[index - 1] ?? 0) + 1));
  return rising;
}
