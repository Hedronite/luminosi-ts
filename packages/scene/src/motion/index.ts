// Motion in LuminosiTS: the tracks of a scene document, evaluated. A document says what moves, when it starts and which token eases it;
// this package says what that means at a moment, given a clock the caller advances, the scroll it measured and the pointer it saw. It
// imports no renderer and no DOM, so the same runtime drives a canvas, an element and a test.
export { DAMPING, LONGEST_STEP, anchorsOf, createConductor, progressAt, type Conductor, type ScrollInput, type ScrollState } from "./conductor.js";
export { easingOf, easings, progressOf, type Easing } from "./easing.js";
export { propertyOf, valueFits } from "../schema.js";
export { clipEasingOf, spanOf, valueAt, type TrackValue } from "./evaluate.js";
export { createMotion, type MotionFrame, type MotionInput, type MotionOptions, type MotionRuntime } from "./runtime.js";
