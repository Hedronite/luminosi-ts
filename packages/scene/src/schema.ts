import { z } from "zod";

/** What a scene document says it is, and the version of the format this package writes and reads. */
export const SCENE_FORMAT = "lts-scene";
export const SCENE_VERSION = 2;

const number = z.number();
const vec3 = z.tuple([number, number, number]);

/** A node id: letters, digits, underscores and dashes, not starting with a dash. `constructor` and `__proto__` are ids like any other. */
const nodeId = z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_-]*$/, "an id is letters, digits, underscores and dashes, and does not start with a dash");

/** An asset id: the lowercase slug the registry uses. */
const assetId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "an asset id is a lowercase slug");

/** Parameters, by name. What they may be is the asset's own schema, which the root does not import: `checkRefs` asks. */
const params = z.record(z.string(), z.json());

/** A look by id, or the five scene colors written out. */
const hex = z.string().regex(/^#[0-9a-f]{6}$/, "a color is #rrggbb in lowercase");
const palette = z.strictObject({ base: hex, accent: hex, metal: hex, glass: hex, emissive: hex });

/**
 * What a node is: a primitive, a framed solid (a primitive drawn as faces, edge tubes and vertex beads: the faces are
 * the node's surface, the edges' material is named here, and only a framed solid has `edges`) or an object from the
 * library (the registry's own framed-solid among them). `params` are the asset's own parameters, and a framed
 * solid's are its primitive's.
 */
const asset = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("primitive"), id: assetId, params: params.optional() }),
  z.strictObject({ kind: z.literal("framed"), id: assetId, edges: z.strictObject({ material: assetId }), params: params.optional() }),
  z.strictObject({ kind: z.literal("object"), id: assetId, params: params.optional() }),
]);

/** What a node's surface is made of: a material or a surface shader, never both. An object brings its own and has none. */
const surface = z.union([z.strictObject({ material: assetId, params: params.optional() }), z.strictObject({ shader: assetId, params: params.optional() })]);

/**
 * The properties a track may drive, and the kind of value each takes. A path names one of them, and nothing else: a node's
 * transform by its id, a parameter of a node's surface, a parameter of a screen effect, or the camera.
 *
 * - `node.<id>.position` | `.rotation` | `.scale` — a vec3.
 * - `node.<id>.surface.params.<name>` — the parameter's own value. The package does not know an asset's parameters (the
 *   registry does), so the value may be a number, a string, a boolean or a vec3; `checkRefs` says whether the name exists.
 * - `effect.<effect id>.params.<name>` — the same, for a screen effect.
 * - `camera.position` | `camera.target` — a vec3; `camera.fov` — a number.
 */
export const propertyKinds = ["vec3", "number", "param"] as const;
export type PropertyKind = (typeof propertyKinds)[number];

/** What a path names: the kind of value it takes, and the node or effect it belongs to. */
export interface Property {
  readonly kind: PropertyKind;
  readonly node?: string;
  readonly effect?: string;
  readonly param?: string;
}

const TRANSFORM = /^node\.([A-Za-z0-9_][A-Za-z0-9_-]*)\.(position|rotation|scale)$/;
const NODE_PARAM = /^node\.([A-Za-z0-9_][A-Za-z0-9_-]*)\.surface\.params\.([A-Za-z0-9_][A-Za-z0-9_-]*)$/;
const EFFECT_PARAM = /^effect\.([a-z0-9]+(?:-[a-z0-9]+)*)\.params\.([A-Za-z0-9_][A-Za-z0-9_-]*)$/;

/** What a property path names, or nothing when it names no property a track may drive. */
export function propertyOf(target: string): Property | undefined {
  const transform = TRANSFORM.exec(target);
  if (transform !== null) return { kind: "vec3", node: transform[1] ?? "" };
  const nodeParam = NODE_PARAM.exec(target);
  if (nodeParam !== null) return { kind: "param", node: nodeParam[1] ?? "", param: nodeParam[2] ?? "" };
  const effectParam = EFFECT_PARAM.exec(target);
  if (effectParam !== null) return { kind: "param", effect: effectParam[1] ?? "", param: effectParam[2] ?? "" };
  if (target === "camera.position" || target === "camera.target") return { kind: "vec3" };
  if (target === "camera.fov") return { kind: "number" };
  return undefined;
}

const finiteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const vec3Value = (value: unknown): boolean => Array.isArray(value) && value.length === 3 && value.every(finiteNumber);

/** Whether a keyframe value fits the kind of property its path names. A parameter takes a number, a string, a boolean or a vec3. */
export function valueFits(kind: PropertyKind, value: unknown): boolean {
  switch (kind) {
    case "vec3":
      return vec3Value(value);
    case "number":
      return finiteNumber(value);
    case "param":
      return finiteNumber(value) || typeof value === "string" || typeof value === "boolean" || vec3Value(value);
  }
}

/** The easing of a track is a token, never a raw curve. G5 maps each token to a curve. */
export const easingTokens = ["enter", "exit", "settle", "standard", "linear"] as const;
/** What moves a track: a clock, a scroll position, or the pointer. G4 keeps these as data; G5 reads them. */
export const trackDrivers = ["time", "scroll", "pointer"] as const;
/** What starts a track. G4 keeps these as data; G5 reads them. */
export const trackTriggers = ["load", "hover", "in-view", "scroll-scrub"] as const;

const easing = z.enum(easingTokens);

/** One keyframe: its time in the clip's own seconds, its value, and the easing that brings it to the next one. */
const keyframe = z.strictObject({
  time: z.number().min(0),
  value: z.json(),
  easing: easing.optional(),
});

/** A track: one property, its keyframes, and the driver and trigger that G5 reads. */
const track = z.strictObject({
  id: nodeId,
  target: z.string().min(1),
  keyframes: z.array(keyframe).min(1),
  driver: z.enum(trackDrivers).optional(),
  trigger: z.enum(trackTriggers).optional(),
});

/** A clip: tracks that share a time base, and the easing its keyframes take when they name none. */
const clip = z.strictObject({ id: nodeId, tracks: z.array(nodeId).min(1), easing: easing.optional() });

const node = z.strictObject({
  id: nodeId,
  /** The node this one stands in, or null for the scene's root. Its transform is relative to the parent's. */
  parent: nodeId.nullable(),
  position: vec3,
  /** Euler angles in radians, in x, y, z order. */
  rotation: vec3,
  scale: vec3,
  asset,
  surface: surface.optional(),
});

/** A screen effect and its parameters. Effects are kept in document order, and an effect appears once; the order they run in is the effect library's. */
const effect = z.strictObject({ id: assetId, params: params.optional() });

export const inkModes = ["look", "accent", "emissive", "glass"] as const;
export const environmentKinds = ["studio", "gallery", "dusk", "noir"] as const;
export type EnvironmentKind = (typeof environmentKinds)[number];
export const HDRI_LICENSE = "CC0-1.0" as const;

const isSafeHdriUrl = (value: string): boolean => {
  if (value.trim() !== value || /\s/.test(value)) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "data:";
  } catch {
    return false;
  }
};

const environmentHdri = z.strictObject({
  url: z.string().min(1).refine(isSafeHdriUrl, "an environment HDRI url must be https:, http:, data:, or root-relative"),
  license: z.literal(HDRI_LICENSE),
  credit: z.string().min(1),
});

const environment = z.strictObject({
  kind: z.enum(environmentKinds).default("studio"),
  intensity: z.number().min(0).max(10).optional(),
  rotation: z.number().optional(),
  hdri: environmentHdri.optional(),
});

/**
 * A scene document, version 1: one composition as data. The root of the package imports no three.js and no React,
 * so a document can be read, checked, migrated and written anywhere.
 */
export const sceneSchema = z.strictObject({
  format: z.literal(SCENE_FORMAT),
  version: z.literal(SCENE_VERSION),
  /** A look id, or an inline palette. */
  look: z.union([assetId, palette]),
  /** Reserved for whatever the scene will draw at random. Nothing reads it yet, so changing it changes no picture. */
  seed: z.int().min(0),
  nodes: z.array(node),
  lights: z.strictObject({ rig: z.literal("studio"), intensity: z.number().min(0).max(10) }),
  environment: environment.default({ kind: "studio" }),
  camera: z.strictObject({ position: vec3, target: vec3, fov: z.number().gt(0).lt(180) }),
  effects: z.array(effect),
  /** One-ink prints use one of the look's scene colors; "look" prints with two inks. */
  ink: z.enum(inkModes),
  /** Motion as data: every track in the document. G5 plays them; nothing here builds one. */
  tracks: z.array(track),
  /** Tracks that belong together, each in at most one clip. */
  clips: z.array(clip),
  /** The value every animated property holds when nothing drives it: the pose reduced motion shows. */
  rest: z.record(z.string(), z.json()),
});

export type Scene = z.output<typeof sceneSchema>;
export type SceneNode = Scene["nodes"][number];
export type SceneAsset = SceneNode["asset"];
export type SceneSurface = NonNullable<SceneNode["surface"]>;
export type SceneEffect = Scene["effects"][number];
export type SceneLook = Scene["look"];
export type SceneEnvironment = Scene["environment"];
export type SceneEnvironmentHdri = NonNullable<SceneEnvironment["hdri"]>;
export type SceneTrack = Scene["tracks"][number];
export type SceneTrackKeyframe = SceneTrack["keyframes"][number];
export type SceneClip = Scene["clips"][number];
export type SceneRest = Scene["rest"];
export type InkMode = (typeof inkModes)[number];

/** One thing wrong with a document: where, what kind of wrong, and a sentence for a person. */
export interface SceneIssue {
  /** Keys and indexes from the document's root: `["nodes", 2, "asset", "id"]`. */
  readonly path: readonly (string | number)[];
  /**
   * A short stable name. Of the shape: "invalid-json", "wrong-format", "unsupported-version", "missing-field", "wrong-type",
   * "wrong-value", "out-of-range", "bad-format", "no-match", "unknown-key". Of the motion in a document: "bad-target" (a
   * property path that names nothing a track may drive, or a node, surface or effect that is not there), "missing-rest" (an
   * animated property with no rest value, or a rest value that does not fit its path) and "unknown-track" (a clip naming a
   * track that is not there). Of the references (`checkRefs`): "unknown-material", "unknown-param", "duplicate-id", "cycle"
   * and the rest listed there.
   */
  readonly code: string;
  readonly message: string;
}

export type SceneResult = { readonly ok: true; readonly scene: Scene } | { readonly ok: false; readonly issues: readonly SceneIssue[] };

/**
 * The problems in a document's motion that the shape alone cannot see: whether each track's property path names something
 * in this document, whether its keyframes run forward from zero, whether each value fits its property, whether each clip
 * names tracks that exist, and whether every animated property has a rest value. Read after the shape, so every field is
 * there. The codes are "bad-target", "missing-rest", "unknown-track" and "duplicate-id", each at its own path.
 */
export function structureIssues(scene: Scene): readonly SceneIssue[] {
  const issues: SceneIssue[] = [];
  const nodes = new Map(scene.nodes.map((node) => [node.id, node] as const));
  const effects = new Set(scene.effects.map((effect) => effect.id));
  const targets = new Map<string, Property>();

  const seen = new Set<string>();
  scene.tracks.forEach((track, index) => {
    const idPath = ["tracks", index, "id"];
    if (seen.has(track.id)) issues.push({ path: idPath, code: "duplicate-id", message: `"${track.id}" is another track's id` });
    seen.add(track.id);

    const targetPath = ["tracks", index, "target"];
    const property = propertyOf(track.target);
    if (property === undefined) {
      issues.push({
        path: targetPath,
        code: "bad-target",
        message: `"${track.target}" names no property: a track drives node.<id>.position|rotation|scale, node.<id>.surface.params.<name>, effect.<id>.params.<name>, or camera.position|target|fov`,
      });
    } else if (property.node !== undefined && !nodes.has(property.node)) {
      issues.push({ path: targetPath, code: "bad-target", message: `no node has the id "${property.node}"` });
    } else if (property.node !== undefined && property.param !== undefined && nodes.get(property.node)?.surface === undefined) {
      issues.push({ path: targetPath, code: "bad-target", message: `the node "${property.node}" has no surface, so it has no parameters` });
    } else if (property.effect !== undefined && !effects.has(property.effect)) {
      issues.push({ path: targetPath, code: "bad-target", message: `no effect has the id "${property.effect}"` });
    } else if (targets.has(track.target)) {
      issues.push({ path: targetPath, code: "bad-target", message: `"${track.target}" is already driven by another track: one track drives one property` });
    } else {
      targets.set(track.target, property);
    }

    let previous = -1;
    track.keyframes.forEach((keyframe, at) => {
      if (at === 0 && keyframe.time !== 0) issues.push({ path: ["tracks", index, "keyframes", at, "time"], code: "out-of-range", message: "the first keyframe is at time 0" });
      else if (keyframe.time <= previous) issues.push({ path: ["tracks", index, "keyframes", at, "time"], code: "out-of-range", message: "each keyframe is later than the one before it" });
      previous = keyframe.time;
      if (property !== undefined && !valueFits(property.kind, keyframe.value)) {
        issues.push({ path: ["tracks", index, "keyframes", at, "value"], code: "wrong-type", message: `"${track.target}" takes a ${property.kind === "param" ? "number, string, boolean or vec3" : property.kind}` });
      }
    });
  });

  const clipIds = new Set<string>();
  const claimed = new Map<string, string>();
  scene.clips.forEach((clip, index) => {
    if (clipIds.has(clip.id)) issues.push({ path: ["clips", index, "id"], code: "duplicate-id", message: `"${clip.id}" is another clip's id` });
    clipIds.add(clip.id);
    clip.tracks.forEach((trackId, at) => {
      if (!seen.has(trackId)) issues.push({ path: ["clips", index, "tracks", at], code: "unknown-track", message: `no track has the id "${trackId}"` });
      const owner = claimed.get(trackId);
      if (owner !== undefined) issues.push({ path: ["clips", index, "tracks", at], code: "duplicate-id", message: `"${trackId}" is already in the clip "${owner}"` });
      else claimed.set(trackId, clip.id);
    });
  });

  for (const [target, value] of Object.entries(scene.rest)) {
    const property = propertyOf(target);
    if (property === undefined) {
      issues.push({ path: ["rest", target], code: "bad-target", message: `"${target}" names no property, so it has no rest value` });
      continue;
    }
    if (property.node !== undefined && !nodes.has(property.node)) {
      issues.push({ path: ["rest", target], code: "bad-target", message: `no node has the id "${property.node}"` });
      continue;
    }
    if (property.node !== undefined && property.param !== undefined && nodes.get(property.node)?.surface === undefined) {
      issues.push({ path: ["rest", target], code: "bad-target", message: `the node "${property.node}" has no surface, so it has no parameters` });
      continue;
    }
    if (property.effect !== undefined && !effects.has(property.effect)) {
      issues.push({ path: ["rest", target], code: "bad-target", message: `no effect has the id "${property.effect}"` });
      continue;
    }
    if (!valueFits(property.kind, value)) issues.push({ path: ["rest", target], code: "wrong-type", message: `the rest value of "${target}" takes a ${property.kind === "param" ? "number, string, boolean or vec3" : property.kind}` });
  }
  for (const track of scene.tracks) {
    if (!Object.hasOwn(scene.rest, track.target)) {
      issues.push({ path: ["rest"], code: "missing-rest", message: `"${track.target}" is animated and has no rest value: reduced motion has nothing to hold` });
    }
  }

  return issues;
}

/** The short name of what is wrong, in this package's words rather than the schema library's. */
function nameOf(issue: z.ZodError["issues"][number]): string {
  switch (issue.code) {
    case "invalid_type":
      return /received undefined/.test(issue.message) ? "missing-field" : "wrong-type";
    case "invalid_value":
      return "wrong-value";
    case "too_small":
    case "too_big":
      return "out-of-range";
    case "invalid_format":
      return "bad-format";
    case "invalid_union":
      return "no-match";
    case "custom":
    case "invalid_element":
    case "invalid_key":
    case "not_multiple_of":
    case "unrecognized_keys":
      return "invalid";
  }
}

/** The issues of a failed schema parse as `SceneIssue`s: a path, a named code and a sentence for each. */
export const issuesOf = (error: z.ZodError): readonly SceneIssue[] =>
  error.issues.flatMap((issue): SceneIssue[] => {
    const path = issue.path.filter((key): key is string | number => typeof key !== "symbol");
    // A key the schema does not have is one issue per key, so each is named at its own path.
    if (issue.code === "unrecognized_keys") return issue.keys.map((key) => ({ path: [...path, key], code: "unknown-key", message: `"${key}" is not a field of this object` }));
    return [{ path, code: nameOf(issue), message: issue.message }];
  });

/** The value of JSON text, or the value as it came. Text that is not JSON is an issue, not an exception. */
export function readJson(input: unknown): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly issues: readonly SceneIssue[] } {
  if (typeof input !== "string") return { ok: true, value: input };
  try {
    const value: unknown = JSON.parse(input);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, issues: [{ path: [], code: "invalid-json", message: error instanceof Error ? error.message : "not JSON" }] };
  }
}

/** What a value says it is: its `format` and `version` fields, whatever they hold. */
export function headerOf(value: object): { readonly format: unknown; readonly version: unknown } {
  const format: unknown = Reflect.get(value, "format");
  const version: unknown = Reflect.get(value, "version");
  return { format, version };
}

/**
 * Reads a scene document of the current version, from a value or from JSON text. It never throws on user input: a
 * document with problems comes back as `{ ok: false, issues }`. A document of another version is one issue
 * ("unsupported-version"); `migrate` brings an older one up. It checks the shape only: `checkRefs` checks the ids.
 */
export function parseScene(input: unknown): SceneResult {
  const read = readJson(input);
  if (!read.ok) return read;
  const value = read.value;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const header = headerOf(value);
    if (header.format !== SCENE_FORMAT) return { ok: false, issues: [{ path: ["format"], code: "wrong-format", message: `format is "${SCENE_FORMAT}"` }] };
    if (header.version !== SCENE_VERSION) return { ok: false, issues: [{ path: ["version"], code: "unsupported-version", message: `this reads version ${String(SCENE_VERSION)}; migrate an older document first` }] };
  }
  const parsed = sceneSchema.safeParse(value);
  if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) };
  const structure = structureIssues(parsed.data);
  return structure.length === 0 ? { ok: true, scene: parsed.data } : { ok: false, issues: structure };
}
