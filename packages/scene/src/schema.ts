import { z } from "zod";

/** What a scene document says it is, and the version of the format this package writes and reads. */
export const SCENE_FORMAT = "lts-scene";
export const SCENE_VERSION = 1;

const number = z.number();
const vec3 = z.tuple([number, number, number]);

/** A node id: letters, digits, dashes and underscores, starting with a letter or digit. */
const nodeId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "an id is letters, digits, dashes and underscores");

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

/** A screen effect and its parameters. Effects run in the order they are listed. */
const effect = z.strictObject({ id: assetId, params: params.optional() });

export const inkModes = ["look", "accent", "emissive", "glass"] as const;

/**
 * A scene document, version 1: one composition as data. The root of the package imports no three.js and no React,
 * so a document can be read, checked, migrated and written anywhere.
 */
export const sceneSchema = z.strictObject({
  format: z.literal(SCENE_FORMAT),
  version: z.literal(SCENE_VERSION),
  /** A look id, or an inline palette. */
  look: z.union([assetId, palette]),
  /** Seeds whatever the scene draws at random. */
  seed: z.int().min(0),
  nodes: z.array(node),
  lights: z.strictObject({ rig: z.literal("studio"), intensity: z.number().min(0).max(10) }),
  environment: z.strictObject({ kind: z.literal("studio") }),
  camera: z.strictObject({ position: vec3, target: vec3, fov: z.number().gt(0).lt(180) }),
  effects: z.array(effect),
  /** One-ink prints use one of the look's scene colors; "look" prints with two inks. */
  ink: z.enum(inkModes),
});

export type Scene = z.output<typeof sceneSchema>;
export type SceneNode = Scene["nodes"][number];
export type SceneAsset = SceneNode["asset"];
export type SceneSurface = NonNullable<SceneNode["surface"]>;
export type SceneEffect = Scene["effects"][number];
export type SceneLook = Scene["look"];
export type InkMode = (typeof inkModes)[number];

/** One thing wrong with a document: where, what kind of wrong, and a sentence for a person. */
export interface SceneIssue {
  /** Keys and indexes from the document's root: `["nodes", 2, "asset", "id"]`. */
  readonly path: readonly (string | number)[];
  /** A short stable name: "invalid_type", "unsupported-version", "unknown-material", "cycle". */
  readonly code: string;
  readonly message: string;
}

export type SceneResult = { readonly ok: true; readonly scene: Scene } | { readonly ok: false; readonly issues: readonly SceneIssue[] };

const issuesOf = (error: z.ZodError): readonly SceneIssue[] =>
  error.issues.flatMap((issue): SceneIssue[] => {
    const path = issue.path.filter((key): key is string | number => typeof key !== "symbol");
    // A key the schema does not have is one issue per key, so each is named at its own path.
    if (issue.code === "unrecognized_keys") return issue.keys.map((key) => ({ path: [...path, key], code: "unknown-key", message: `"${key}" is not a field of this object` }));
    return [{ path, code: issue.code, message: issue.message }];
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
  return parsed.success ? { ok: true, scene: parsed.data } : { ok: false, issues: issuesOf(parsed.error) };
}
