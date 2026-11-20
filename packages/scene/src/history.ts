import type { Scene } from "./schema.js";

/** The most steps back a history keeps: the 101st change drops the oldest. */
export const HISTORY_CAP = 100;

/**
 * What can be undone and redone of a scene: the documents before the present one (oldest first), the present one, and the
 * documents an undo has stepped back over (the next one first). It holds documents and one string, nothing else, so it
 * survives `JSON.stringify` and `JSON.parse` and holds no built object, however it was made. `gesture` is the key of the
 * run of changes the present document ends, or null when no run is open (see `push`).
 */
export interface SceneHistory {
  readonly past: readonly Scene[];
  readonly present: Scene;
  readonly future: readonly Scene[];
  readonly gesture: string | null;
}

/** A history that starts at this document: nothing to undo, nothing to redo. */
export const createHistory = (scene: Scene): SceneHistory => ({ past: [], present: scene, future: [], gesture: null });

export const canUndo = (history: SceneHistory): boolean => history.past.length > 0;
export const canRedo = (history: SceneHistory): boolean => history.future.length > 0;

/**
 * Makes `scene` the present document, as one step that an undo takes back. What was undone is gone (nothing is left to redo).
 *
 * A change with a `key` that is the key of the change just before it, with no undo, redo or `endGesture` between, folds into
 * that step instead of making another: one node's one field, edited again and again during one drag, or one run of key
 * presses, is one step. A key names a gesture, so the caller ends a gesture (`endGesture`, or a new key) when it is over;
 * two drags of one field one after the other would be one step under one key. A change with no key is always a step.
 */
export function push(history: SceneHistory, scene: Scene, key?: string): SceneHistory {
  if (key !== undefined && history.gesture === key) return { ...history, present: scene, future: [] };
  return { past: [...history.past, history.present].slice(-HISTORY_CAP), present: scene, future: [], gesture: key ?? null };
}

/** The history at the end of a gesture: the next change with the same key is a step of its own. */
export const endGesture = (history: SceneHistory): SceneHistory => (history.gesture === null ? history : { ...history, gesture: null });

/** One step back: the document before the present one, which becomes the next to redo. With nothing to undo, the history as it is. */
export function undo(history: SceneHistory): SceneHistory {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future], gesture: null };
}

/** One step forward again: the document an undo stepped back over. With nothing to redo, the history as it is. */
export function redo(history: SceneHistory): SceneHistory {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present].slice(-HISTORY_CAP), present: next, future: rest, gesture: null };
}
