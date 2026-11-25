// Motion in LuminosiTS: the tracks of a scene document, evaluated. A document says what moves, when it starts and which token eases it;
// this package says what that means at a moment, given a clock the caller advances, the scroll it measured and the pointer it saw. It
// imports no renderer and no DOM, so the same runtime drives a canvas, an element and a test.
export { createMotion, type MotionInput } from "./runtime.js";
export { propertyOf } from "../schema.js";
export { type TrackValue } from "./evaluate.js";
