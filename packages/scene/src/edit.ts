import { checkRefs } from "./refs.js";
import {
  parseScene,
  propertyOf,
  type InkMode,
  type Scene,
  type SceneClip,
  type SceneEffect,
  type SceneLook,
  type SceneNode,
  type SceneRest,
  type SceneResult,
  type SceneSurface,
  type SceneTrack,
} from "./schema.js";

/**
 * Edits of a scene document: each is a pure function from a document to a new one, and the input is never touched. An edit
 * that would leave a document that does not read comes back as `{ ok: false, issues }`, in the words `parseScene` and
 * `checkRefs` use, and never throws; so a field a person is typing into can hand its value straight to an edit. The
 * output of an edit that succeeds has been read by `parseScene` and holds none of the structural problems `checkRefs`
 * names without a registry (`duplicate-id`, `missing-parent`, `cycle`, `duplicate-effect`, `surface-on-object`, and the
 * motion's own `bad-target`, `missing-rest` and `unknown-track`). What only the registry knows (that an id exists, that a
 * parameter is in its range) is `checkRefs`' to say, with the caller's lookup.
 *
 * Besides the codes of `parseScene` and `checkRefs`, an edit names one of its own: `unknown-node`, a node id the document
 * does not have, and `unknown-track`, a track id it does not have.
 */

/** The codes `checkRefs` gives for the structure of a document, which it can find without a registry. */
const STRUCTURE: ReadonlySet<string> = new Set([
  "duplicate-id",
  "missing-parent",
  "cycle",
  "duplicate-effect",
  "surface-on-object",
  "bad-target",
  "missing-rest",
  "unknown-track",
]);

/** A lookup that knows every id and takes any parameters, so that only the structure is left for `checkRefs` to find. */
const anything = (): Record<string, never> => ({});

/**
 * The document with the motion of what it still has: a track whose node is gone, and the rest value that went with it, are
 * gone too; so is a track on a surface parameter of a node that now has no surface. A rest value of a property no track
 * drives is the document's own state and stays. Every edit that can leave motion pointing at nothing runs through this, so
 * an edit never hands back a document whose tracks name a node it removed.
 */
/** The ids of a list of entries that may be anything at all: an edit can be handed a value the schema is about to refuse. */
function idsOf(entries: readonly unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const id: unknown = Reflect.get(entry, "id");
    if (typeof id === "string") ids.add(id);
  }
  return ids;
}

function withMotion(document: Scene, effects: readonly SceneEffect[] = document.effects): Scene {
  const nodes = document.nodes;
  const nodeIds = idsOf(document.nodes);
  const effectIds = idsOf(effects);
  const stays = (track: SceneTrack): boolean => {
    const property = propertyOf(track.target);
    if (property === undefined) return true;
    if (property.effect !== undefined) return effectIds.has(property.effect);
    if (property.node === undefined) return true;
    const node = nodes.find((candidate) => candidate.id === property.node);
    if (node === undefined) return false;
    return property.param === undefined || node.surface !== undefined;
  };
  const tracks = document.tracks.filter(stays);
  // A rest value is the document's own state, not a track's: it stays when its track leaves, and goes only when what it describes is
  // gone. (A diff that replaces a track removes it and adds it again, and the pose has to survive that.)
  const rest: Record<string, SceneRest[keyof SceneRest]> = {};
  for (const [target, value] of Object.entries(document.rest)) {
    const property = propertyOf(target);
    if (property?.node !== undefined && !nodeIds.has(property.node)) continue;
    if (property?.effect !== undefined && !effectIds.has(property.effect)) continue;
    rest[target] = value;
  }
  const kept = new Set(tracks.map((track) => track.id));
  return {
    ...document,
    effects: [...effects],
    tracks,
    rest,
    clips: document.clips.map((clip) => ({ ...clip, tracks: clip.tracks.filter((id) => kept.has(id)) })).filter((clip) => clip.tracks.length > 0),
  };
}

/** The document, read, or the issues with it: what every edit ends with. */
function read(candidate: unknown): SceneResult {
  const parsed = parseScene(candidate);
  if (!parsed.ok) return parsed;
  const issues = checkRefs(parsed.scene, anything).filter((issue) => STRUCTURE.has(issue.code));
  return issues.length === 0 ? parsed : { ok: false, issues };
}

/** An id that is no node's: named in the message when it is text, and said to be text when it is not (an object with no string form cannot be written into a message). */
const unknownNode = (id: string): SceneResult => ({
  ok: false,
  issues: [{ path: ["nodes"], code: "unknown-node", message: typeof id === "string" ? `no node has the id "${id}"` : "a node id is text" }],
});

/** An id that is no track's. */
const unknownTrack = (id: string): SceneResult => ({
  ok: false,
  issues: [{ path: ["tracks"], code: "unknown-track", message: `no track has the id "${id}"` }],
});

/** The same document with the node of this id changed by `change`, or an `unknown-node` issue. */
function changing(scene: Scene, id: string, change: (node: SceneNode) => SceneNode): SceneResult {
  if (!scene.nodes.some((node) => node.id === id)) return unknownNode(id);
  return read(withMotion({ ...scene, nodes: scene.nodes.map((node) => (node.id === id ? change(node) : node)) }));
}

/** The same document with the track of this id changed by `change`, or an `unknown-track` issue. */
function changingTrack(scene: Scene, id: string, change: (track: SceneTrack) => SceneTrack): SceneResult {
  if (!scene.tracks.some((track) => track.id === id)) return unknownTrack(id);
  return read({ ...scene, tracks: scene.tracks.map((track) => (track.id === id ? change(track) : track)) });
}

/** The transform, rotation or scale of a node that an edit changes: any of the three, each whole. */
export type TransformChange = Partial<Pick<SceneNode, "position" | "rotation" | "scale">>;

/** The studio rig's fields that an edit changes. */
export type LightsChange = Partial<Scene["lights"]>;

/** The document with `node` added after the others. Its id must be new and its parent, if it has one, a node already there. */
export function addNode(scene: Scene, node: SceneNode): SceneResult {
  return read({ ...scene, nodes: [...scene.nodes, node] });
}

/** The document without the node of this id and every node that stands in it, however deep: no node is left with a parent that is gone. */
export function removeNode(scene: Scene, id: string): SceneResult {
  if (!scene.nodes.some((node) => node.id === id)) return unknownNode(id);
  const gone = new Set<string>([id]);
  // Each pass takes the nodes that stand in a node already taken, until none does.
  for (let grown = true; grown; ) {
    grown = false;
    for (const node of scene.nodes) {
      if (node.parent !== null && gone.has(node.parent) && !gone.has(node.id)) {
        gone.add(node.id);
        grown = true;
      }
    }
  }
  return read(withMotion({ ...scene, nodes: scene.nodes.filter((node) => !gone.has(node.id)) }));
}

/** The node with its position, rotation or scale replaced, each one given. The others stay as they are. */
export function setTransform(scene: Scene, id: string, change: TransformChange): SceneResult {
  return changing(scene, id, (node) => ({
    ...node,
    ...(change.position === undefined ? {} : { position: change.position }),
    ...(change.rotation === undefined ? {} : { rotation: change.rotation }),
    ...(change.scale === undefined ? {} : { scale: change.scale }),
  }));
}

/** The node with this surface, or with none when `surface` is undefined. An object has no surface (`surface-on-object`). */
export function setSurface(scene: Scene, id: string, surface: SceneSurface | undefined): SceneResult {
  const node = scene.nodes.find((candidate) => candidate.id === id);
  if (node === undefined) return unknownNode(id);
  // Built field by field rather than by omitting `surface`: a node with a key set to undefined would have the key and fail the shape.
  const next: SceneNode =
    surface === undefined
      ? { id: node.id, parent: node.parent, position: node.position, rotation: node.rotation, scale: node.scale, asset: node.asset }
      : { ...node, surface };
  return read(withMotion({ ...scene, nodes: scene.nodes.map((candidate) => (candidate.id === id ? next : candidate)) }));
}

/** The document with this screen effect stack, in this order: each effect once. A track on an effect that left goes with it. */
export function setEffects(scene: Scene, effects: readonly SceneEffect[]): SceneResult {
  // A value that is not a list never reaches `withMotion`: it goes to `read` as it came, and the schema names it.
  if (!Array.isArray(effects)) return read({ ...scene, effects });
  return read(withMotion(scene, effects));
}

/** The document printed with this ink. */
export function setInk(scene: Scene, ink: InkMode): SceneResult {
  return read({ ...scene, ink });
}

/** The document with the studio rig's fields replaced, each one given. */
export function setLights(scene: Scene, change: LightsChange): SceneResult {
  return read({ ...scene, lights: { ...scene.lights, ...change } });
}

/** The document in this look: a look id, or the five scene colors. */
export function setLook(scene: Scene, look: SceneLook): SceneResult {
  return read({ ...scene, look });
}

/** The document with `track` added after the others. Its id must be new, and its path, its keyframes and its rest value must read. */
export function addTrack(scene: Scene, track: SceneTrack): SceneResult {
  return read({ ...scene, tracks: [...scene.tracks, track] });
}

/** The document without the track of this id: its clip loses it, and a rest value nothing else drives goes with it. */
export function removeTrack(scene: Scene, id: string): SceneResult {
  if (!scene.tracks.some((track) => track.id === id)) return unknownTrack(id);
  return read(withMotion({ ...scene, tracks: scene.tracks.filter((track) => track.id !== id) }));
}

/** The track with these keyframes, and this easing token on the keyframes that name none. */
export function setTrackKeyframes(scene: Scene, id: string, keyframes: SceneTrack["keyframes"]): SceneResult {
  return changingTrack(scene, id, (track) => ({ ...track, keyframes }));
}

/** The track with this driver or trigger, or with none when the field is null: the document says nothing rather than nothing-yet. */
export function setTrackMotion(scene: Scene, id: string, change: { readonly driver?: SceneTrack["driver"]; readonly trigger?: SceneTrack["trigger"] }): SceneResult {
  return changingTrack(scene, id, (track) => {
    const next = { ...track };
    if ("driver" in change) {
      if (change.driver === undefined) delete next.driver;
      else next.driver = change.driver;
    }
    if ("trigger" in change) {
      if (change.trigger === undefined) delete next.trigger;
      else next.trigger = change.trigger;
    }
    return next;
  });
}

/** The document with a rest value for this property: the pose reduced motion holds. */
export function setRest(scene: Scene, target: string, value: unknown): SceneResult {
  return read({ ...scene, rest: { ...scene.rest, [target]: value } });
}

/** The document without the rest value for this property, unless a track drives it (that would be `missing-rest`). */
export function removeRest(scene: Scene, target: string): SceneResult {
  const rest = Object.fromEntries(Object.entries(scene.rest).filter(([key]) => key !== target));
  return read({ ...scene, rest });
}

/** The document with a clip added, or the clip of this id replaced; its tracks must exist. */
export function setClip(scene: Scene, clip: SceneClip): SceneResult {
  const others = scene.clips.filter((existing) => existing.id !== clip.id);
  return read({ ...scene, clips: [...others, clip] });
}

/** The document without the clip of this id: its tracks stay, each free to join another clip. */
export function removeClip(scene: Scene, id: string): SceneResult {
  return read({ ...scene, clips: scene.clips.filter((clip) => clip.id !== id) });
}
