import { checkRefs } from "./refs.js";
import { parseScene, type InkMode, type Scene, type SceneEffect, type SceneLook, type SceneNode, type SceneResult, type SceneSurface } from "./schema.js";

/**
 * Edits of a scene document: each is a pure function from a document to a new one, and the input is never touched. An edit
 * that would leave a document that does not read comes back as `{ ok: false, issues }`, in the words `parseScene` and
 * `checkRefs` use, and never throws; so a field a person is typing into can hand its value straight to an edit. The
 * output of an edit that succeeds has been read by `parseScene` and holds none of the structural problems `checkRefs`
 * names without a registry (`duplicate-id`, `missing-parent`, `cycle`, `duplicate-effect`, `surface-on-object`). What only the
 * registry knows (that an id exists, that a parameter is in its range) is `checkRefs`' to say, with the caller's lookup.
 *
 * Besides the codes of `parseScene` and `checkRefs`, an edit names one of its own: `unknown-node`, a node id the document does not have.
 */

/** The codes `checkRefs` gives for the structure of a document, which it can find without a registry. */
const STRUCTURE: ReadonlySet<string> = new Set(["duplicate-id", "missing-parent", "cycle", "duplicate-effect", "surface-on-object"]);

/** A lookup that knows every id and takes any parameters, so that only the structure is left for `checkRefs` to find. */
const anything = (): Record<string, never> => ({});

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

/** The same document with the node of this id changed by `change`, or an `unknown-node` issue. */
function changing(scene: Scene, id: string, change: (node: SceneNode) => unknown): SceneResult {
  if (!scene.nodes.some((node) => node.id === id)) return unknownNode(id);
  return read({ ...scene, nodes: scene.nodes.map((node) => (node.id === id ? change(node) : node)) });
}

/** The node as a record, less one key: a key left out, where `undefined` would say it is there and empty. */
const without = (node: SceneNode, key: string): Record<string, unknown> => Object.fromEntries(Object.entries(node).filter(([name]) => name !== key));

/** The position, rotation and scale of a node that an edit changes: any of the three, each whole. */
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
  return read({ ...scene, nodes: scene.nodes.filter((node) => !gone.has(node.id)) });
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
  return changing(scene, id, (node) => (surface === undefined ? without(node, "surface") : { ...node, surface }));
}

/** The document with this screen effect stack, in this order: each effect once. */
export function setEffects(scene: Scene, effects: readonly SceneEffect[]): SceneResult {
  return read({ ...scene, effects });
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
