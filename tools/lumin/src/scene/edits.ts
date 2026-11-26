// The package's edit operations as data: the format `patch` reads and `diff` writes. Each is one call of a function of `@hedronite/lts-scene`.
import {
  addNode,
  addTrack,
  removeClip,
  removeRest,
  setClip,
  removeNode,
  removeTrack,
  sceneSchema,
  setRest,
  setEffects,
  setEnvironment,
  setInk,
  setLights,
  setLook,
  setStage,
  setSurface,
  setTrackKeyframes,
  setTransform,
  type Scene,
  type SceneResult,
} from "@hedronite/lts-scene";
import { z } from "zod";
import { refIssues, summary, type Context, type ReportedIssue } from "./io.js";

const node = sceneSchema.shape.nodes.element;

/** The most operations one patch may hold. */
export const MAX_OPS = 1000;

/** One edit, by name. The fields are the arguments of the package function of that name, after the document. */
const opSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("addNode"), node }),
  z.strictObject({ op: z.literal("removeNode"), id: node.shape.id }),
  z.strictObject({ op: z.literal("setTransform"), id: node.shape.id, change: z.strictObject({ position: node.shape.position.optional(), rotation: node.shape.rotation.optional(), scale: node.shape.scale.optional() }) }),
  z.strictObject({ op: z.literal("setSurface"), id: node.shape.id, surface: node.shape.surface }),
  z.strictObject({ op: z.literal("setEffects"), effects: sceneSchema.shape.effects }),
  z.strictObject({ op: z.literal("setEnvironment"), environment: sceneSchema.shape.environment }),
  z.strictObject({ op: z.literal("setStage"), stage: sceneSchema.shape.stage }),
  z.strictObject({ op: z.literal("setInk"), ink: sceneSchema.shape.ink }),
  z.strictObject({ op: z.literal("setLights"), change: sceneSchema.shape.lights.partial() }),
  z.strictObject({ op: z.literal("setLook"), look: sceneSchema.shape.look }),
  // Motion, as data: a track added or removed whole, its keyframes replaced, and a rest value set.
  z.strictObject({ op: z.literal("addTrack"), track: sceneSchema.shape.tracks.element }),
  z.strictObject({ op: z.literal("removeTrack"), id: sceneSchema.shape.tracks.element.shape.id }),
  z.strictObject({ op: z.literal("setKeyframes"), id: sceneSchema.shape.tracks.element.shape.id, keyframes: sceneSchema.shape.tracks.element.shape.keyframes }),
  z.strictObject({ op: z.literal("setRest"), target: z.string().min(1), value: z.json() }),
  z.strictObject({ op: z.literal("removeRest"), target: z.string().min(1) }),
  z.strictObject({ op: z.literal("setClip"), clip: sceneSchema.shape.clips.element }),
  z.strictObject({ op: z.literal("removeClip"), id: sceneSchema.shape.clips.element.shape.id }),
]);

export type Op = z.output<typeof opSchema>;

/** The names of the operations, in the order of the package's edit module. */
export const opNames = ["addNode", "removeNode", "setTransform", "setSurface", "setEffects", "setEnvironment", "setStage", "setInk", "setLights", "setLook", "addTrack", "removeTrack", "setKeyframes", "setRest", "removeRest", "setClip", "removeClip"] as const;

/** One operation applied to a document: the package function of that name. */
function applyOp(scene: Scene, op: Op): SceneResult {
  switch (op.op) {
    case "addNode":
      return addNode(scene, op.node);
    case "removeNode":
      return removeNode(scene, op.id);
    case "setTransform": {
      const { position, rotation, scale } = op.change;
      return setTransform(scene, op.id, { ...(position === undefined ? {} : { position }), ...(rotation === undefined ? {} : { rotation }), ...(scale === undefined ? {} : { scale }) });
    }
    case "setSurface":
      return setSurface(scene, op.id, op.surface);
    case "setEffects":
      return setEffects(scene, op.effects);
    case "setEnvironment":
      return setEnvironment(scene, op.environment);
    case "setStage":
      return setStage(scene, op.stage);
    case "setInk":
      return setInk(scene, op.ink);
    case "setLights": {
      const { rig, intensity } = op.change;
      return setLights(scene, { ...(rig === undefined ? {} : { rig }), ...(intensity === undefined ? {} : { intensity }) });
    }
    case "setLook":
      return setLook(scene, op.look);
    case "addTrack":
      return addTrack(scene, op.track);
    case "removeTrack":
      return removeTrack(scene, op.id);
    case "setKeyframes":
      return setTrackKeyframes(scene, op.id, op.keyframes);
    case "setRest":
      return setRest(scene, op.target, op.value);
    case "removeRest":
      return removeRest(scene, op.target);
    case "setClip":
      return setClip(scene, op.clip);
    case "removeClip":
      return removeClip(scene, op.id);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export type Applied = { readonly ok: true; readonly scene: Scene } | { readonly ok: false; readonly index: number; readonly issues: readonly ReportedIssue[]; readonly error: string };

const stepFailed = (index: number, issues: readonly ReportedIssue[]): Applied => ({ ok: false, index, issues, error: `operation ${String(index)} failed; ${summary(issues)}` });

/**
 * The operations applied in order, atomically: the first that fails (its shape, its edit, or the ids and parameters it brings, which are
 * checked against the registry after each) is the result, with its index, and no document comes back. The input is never touched.
 */
export function applyOps(scene: Scene, ops: readonly unknown[], ctx: Context): Applied {
  let current = scene;
  for (const [index, raw] of ops.entries()) {
    const named: unknown = isRecord(raw) ? raw["op"] : undefined;
    if (!opNames.some((name) => name === named)) {
      return stepFailed(index, [{ path: ["op"], code: "unknown-operation", message: typeof named === "string" ? `no operation "${named}"; they are ${opNames.join(", ")}` : `an operation is an object with an "op" naming one of ${opNames.join(", ")}` }]);
    }
    const parsed = opSchema.safeParse(raw);
    if (!parsed.success) return stepFailed(index, parsed.error.issues.map((issue) => ({ path: issue.path.filter((key): key is string | number => typeof key !== "symbol"), code: "bad-operation", message: issue.message })));
    const result = applyOp(current, parsed.data);
    if (!result.ok) return stepFailed(index, result.issues);
    const issues = refIssues(result.scene, ctx);
    if (issues.length > 0) return stepFailed(index, issues);
    current = result.scene;
  }
  return { ok: true, scene: current };
}
