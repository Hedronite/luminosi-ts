// What changed between two scene documents, keyed by node id, and the edit operations that make the change.
import type { Scene, SceneClip, SceneEffect, SceneNode, SceneTrack } from "@hedronite/lts-scene";
import type { Op } from "./edits.js";

type Path = readonly (string | number)[];

/** One change: where (a node by its id, never by its place in the list), what kind, and the value before and after. */
interface Change {
  readonly path: Path;
  readonly kind: "added" | "removed" | "changed";
  readonly before?: unknown;
  readonly after?: unknown;
}

export interface Diff {
  /** True when nothing differs: the order of the node list is not a difference. */
  readonly same: boolean;
  /** False when some change is one the eight edit operations cannot say; then `ops` do not reproduce the second document, and `unexpressed` names what they leave out. */
  readonly complete: boolean;
  readonly changes: readonly Change[];
  readonly ops: readonly Op[];
  readonly unexpressed: readonly Path[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const byCode = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

/** Equal as documents are: numbers by `Object.is` (so -0 and 0 differ, as the canonical text writes them differently), lists in order, objects by key. */
export function equal(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Object.is(a, b);
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((item, i) => equal(item, b[i]));
  if (isRecord(a)) {
    if (!isRecord(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]));
  }
  return a === b;
}

/** Changes inside two values: objects are compared key by key, and anything else (a list, a number, a string) whole. */
function walk(before: unknown, after: unknown, path: Path, out: Change[]): void {
  if (equal(before, after)) return;
  if (isRecord(before) && isRecord(after)) {
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(byCode)) {
      const there = [...path, key];
      if (!Object.hasOwn(before, key)) out.push({ path: there, kind: "added", after: after[key] });
      else if (!Object.hasOwn(after, key)) out.push({ path: there, kind: "removed", before: before[key] });
      else walk(before[key], after[key], there, out);
    }
    return;
  }
  out.push({ path, kind: "changed", before, after });
}

/** Nodes, matched by id and listed by id. */
function nodeChanges(a: Scene, b: Scene, out: Change[]): void {
  const before = new Map(a.nodes.map((node) => [node.id, node] as const));
  const after = new Map(b.nodes.map((node) => [node.id, node] as const));
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort(byCode)) {
    const was = before.get(id);
    const now = after.get(id);
    if (was === undefined) out.push({ path: ["nodes", id], kind: "added", after: now });
    else if (now === undefined) out.push({ path: ["nodes", id], kind: "removed", before: was });
    else walk(was, now, ["nodes", id], out);
  }
}

/** Effects, matched by id; a stack that differs only in order is one change at `effects`. */
function effectChanges(a: readonly SceneEffect[], b: readonly SceneEffect[], out: Change[]): void {
  const before = new Map(a.map((effect) => [effect.id, effect] as const));
  const after = new Map(b.map((effect) => [effect.id, effect] as const));
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort(byCode)) {
    const was = before.get(id);
    const now = after.get(id);
    if (was === undefined) out.push({ path: ["effects", id], kind: "added", after: now });
    else if (now === undefined) out.push({ path: ["effects", id], kind: "removed", before: was });
    else walk(was, now, ["effects", id], out);
  }
  const kept = (list: readonly SceneEffect[], other: ReadonlyMap<string, SceneEffect>): string[] => list.filter((effect) => other.has(effect.id)).map((effect) => effect.id);
  if (!equal(kept(a, after), kept(b, before))) out.push({ path: ["effects"], kind: "changed", before: a.map((effect) => effect.id), after: b.map((effect) => effect.id) });
}

/**
 * The operations that turn `a`'s nodes into `b`'s. A node whose parent or asset changed is removed and added again (the edit
 * operations have no other way to say it), and so is each node that stood in it, since a removal takes them too. Node order is
 * not a difference, so added nodes go at the end, parents before their children.
 */
function nodeOps(a: Scene, b: Scene): Op[] {
  const after = new Map(b.nodes.map((node) => [node.id, node] as const));
  const children = new Map<string, string[]>();
  for (const node of a.nodes) if (node.parent !== null) children.set(node.parent, [...(children.get(node.parent) ?? []), node.id]);
  const replaced = new Set(a.nodes.filter((node) => { const now = after.get(node.id); return now !== undefined && (node.parent !== now.parent || !equal(node.asset, now.asset)); }).map((node) => node.id));
  const gone = new Set<string>();
  const drop = (id: string): void => {
    if (gone.has(id)) return;
    gone.add(id);
    for (const child of children.get(id) ?? []) drop(child);
  };
  const ops: Op[] = [];
  for (const node of a.nodes) {
    if ((!after.has(node.id) || replaced.has(node.id)) && !gone.has(node.id)) {
      ops.push({ op: "removeNode", id: node.id });
      drop(node.id);
    }
  }
  for (const node of a.nodes) {
    const now = after.get(node.id);
    if (now === undefined || gone.has(node.id)) continue;
    const change = { ...(equal(node.position, now.position) ? {} : { position: now.position }), ...(equal(node.rotation, now.rotation) ? {} : { rotation: now.rotation }), ...(equal(node.scale, now.scale) ? {} : { scale: now.scale }) };
    if (Object.keys(change).length > 0) ops.push({ op: "setTransform", id: node.id, change });
    if (!equal(node.surface, now.surface)) ops.push({ op: "setSurface", id: node.id, ...(now.surface === undefined ? {} : { surface: now.surface }) });
  }
  const present = new Set(a.nodes.filter((node) => !gone.has(node.id)).map((node) => node.id));
  const pending = b.nodes.filter((node) => !present.has(node.id));
  const waiting = new Set(pending.map((node) => node.id));
  const placed = new Set<string>();
  const place = (node: SceneNode): void => {
    if (placed.has(node.id)) return;
    placed.add(node.id);
    const parent = node.parent === null ? undefined : after.get(node.parent);
    if (parent !== undefined && waiting.has(parent.id)) place(parent);
    ops.push({ op: "addNode", node });
  };
  for (const node of pending) place(node);
  return ops;
}

/** Tracks, matched by id: a change of what a track drives, or of its driver or trigger, is said by removing it and adding it again. */
function trackChanges(a: readonly SceneTrack[], b: readonly SceneTrack[], out: Change[]): void {
  const before = new Map(a.map((track) => [track.id, track] as const));
  const after = new Map(b.map((track) => [track.id, track] as const));
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort(byCode)) {
    const was = before.get(id);
    const now = after.get(id);
    if (was === undefined) out.push({ path: ["tracks", id], kind: "added", after: now });
    else if (now === undefined) out.push({ path: ["tracks", id], kind: "removed", before: was });
    else walk(was, now, ["tracks", id], out);
  }
}

/** Clips, matched by id. */
function clipChanges(a: readonly SceneClip[], b: readonly SceneClip[], out: Change[]): void {
  const before = new Map(a.map((clip) => [clip.id, clip] as const));
  const after = new Map(b.map((clip) => [clip.id, clip] as const));
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort(byCode)) {
    const was = before.get(id);
    const now = after.get(id);
    if (was === undefined) out.push({ path: ["clips", id], kind: "added", after: now });
    else if (now === undefined) out.push({ path: ["clips", id], kind: "removed", before: was });
    else walk(was, now, ["clips", id], out);
  }
}

/**
 * The motion operations, in two halves with the node operations between them. When any of the motion differs, it is replaced whole —
 * every clip of `a`, every track of `a`, and every rest value `b` does not have leave; then `b`'s rest values, `b`'s tracks and `b`'s clips
 * arrive in `b`'s own order. Nothing is matched piecemeal because `addTrack` and `setClip` append: a track that stayed while one was
 * replaced would sit in a different place, and the document would differ from `b` by its order alone.
 */
function motionOps(a: Scene, b: Scene): { readonly leaving: readonly Op[]; readonly arriving: readonly Op[] } {
  const unchanged = equal(a.tracks, b.tracks) && equal(a.clips, b.clips) && equal(a.rest, b.rest);
  if (unchanged) return { leaving: [], arriving: [] };
  const leaving: Op[] = [
    ...a.clips.map((clip): Op => ({ op: "removeClip", id: clip.id })),
    ...a.tracks.map((track): Op => ({ op: "removeTrack", id: track.id })),
    ...Object.keys(a.rest)
      .filter((target) => !Object.hasOwn(b.rest, target))
      .map((target): Op => ({ op: "removeRest", target })),
  ];
  // Every rest value of `b` is set again, not only the ones that differ: `removeTrack` takes the rest value it held with it, so a
  // track that leaves while its pose stays would otherwise lose that pose between the two halves of the diff.
  const arriving: Op[] = [
    ...Object.entries(b.rest).map(([target, value]): Op => ({ op: "setRest", target, value })),
    ...b.tracks.map((track): Op => ({ op: "addTrack", track })),
    ...b.clips.map((clip): Op => ({ op: "setClip", clip })),
  ];
  return { leaving, arriving };
}

/** The sections of a document the edit operations have no word for. */
const INEXPRESSIBLE: ReadonlySet<string> = new Set(["format", "version", "seed", "camera"]);

/** The operations that turn `a` into `b`, other than the ones for nodes. */
function sceneOps(a: Scene, b: Scene): Op[] {
  return [
    ...(equal(a.look, b.look) ? [] : [{ op: "setLook" as const, look: b.look }]),
    ...(a.ink === b.ink ? [] : [{ op: "setInk" as const, ink: b.ink }]),
    ...(equal(a.lights, b.lights) ? [] : [{ op: "setLights" as const, change: b.lights }]),
    ...(equal(a.environment, b.environment) ? [] : [{ op: "setEnvironment" as const, environment: b.environment }]),
    ...(equal(a.stage, b.stage) ? [] : [{ op: "setStage" as const, stage: b.stage }]),
    ...(equal(a.effects, b.effects) ? [] : [{ op: "setEffects" as const, effects: b.effects }]),
  ];
}

/**
 * What differs between two valid documents. Changes are keyed by node id and listed in a fixed order: the document's sections in their
 * order, nodes and effects by id, keys alphabetically. `ops` are the package's edit operations that make `a` into `b`, as far as they
 * can: a change of the seed or the camera has no operation, so it is in `changes` and in `unexpressed`, and `complete` is false.
 */
export function diffScenes(a: Scene, b: Scene): Diff {
  const changes: Change[] = [];
  walk(a.look, b.look, ["look"], changes);
  walk(a.seed, b.seed, ["seed"], changes);
  nodeChanges(a, b, changes);
  walk(a.lights, b.lights, ["lights"], changes);
  walk(a.environment, b.environment, ["environment"], changes);
  walk(a.stage, b.stage, ["stage"], changes);
  walk(a.camera, b.camera, ["camera"], changes);
  effectChanges(a.effects, b.effects, changes);
  trackChanges(a.tracks, b.tracks, changes);
  clipChanges(a.clips, b.clips, changes);
  walk(a.rest, b.rest, ["rest"], changes);
  walk(a.ink, b.ink, ["ink"], changes);
  const unexpressed = changes.filter((change) => INEXPRESSIBLE.has(String(change.path[0]))).map((change) => change.path);
  const motion = motionOps(a, b);
  return {
    same: changes.length === 0,
    complete: unexpressed.length === 0,
    changes,
    ops: [...motion.leaving, ...sceneOps(a, b), ...nodeOps(a, b), ...motion.arriving],
    unexpressed,
  };
}
