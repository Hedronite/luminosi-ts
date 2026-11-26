/// <reference types="node" />
// Shared by the tests: a small catalog standing in for the registry, a resolver over it, and generators of scenes.
import { readFileSync } from "node:fs";
import fc from "fast-check";
import { z } from "zod";
import { migrate } from "./migrate.js";
import type { RefKind, Resolve } from "./refs.js";
import { addNode, removeNode, setEffects, setEnvironment, setInk, setLights, setLook, setStage, setSurface, setTransform, type TransformChange } from "./edit.js";
import {
  easingTokens,
  environmentKinds,
  HDRI_LICENSE,
  inkModes,
  propertyOf,
  stageQualities,
  toneMappingModes,
  trackDrivers,
  trackTriggers,
  type PropertyKind,
  type Scene,
  type SceneEffect,
  type SceneEnvironment,
  type SceneLook,
  type SceneStage,
  type SceneNode,
  type SceneResult,
  type SceneSurface,
  type SceneTrackKeyframe,
} from "./schema.js";

const none = z.object({});

const schemas: Readonly<Record<RefKind, ReadonlyMap<string, z.ZodObject>>> = {
  primitive: new Map<string, z.ZodObject>([
    ["platonic-cube", z.object({ scale: z.number().min(0.1).max(4).default(1) })],
    ["platonic-icosahedron", none],
  ]),
  object: new Map<string, z.ZodObject>([
    ["dress-watch", z.object({ hours: z.number().int().min(0).max(23).default(10), minutes: z.number().int().min(0).max(59).default(10) })],
    ["crystal-cluster", z.object({ count: z.number().int().min(1).max(24).default(8), material: z.enum(["glass", "metal"]).default("glass") })],
  ]),
  material: new Map<string, z.ZodObject>([
    ["metal", none],
    ["glass", none],
  ]),
  shader: new Map<string, z.ZodObject>([["toon", z.object({ bands: z.number().int().min(2).max(8).default(3) })]]),
  effect: new Map<string, z.ZodObject>([
    ["dither", z.object({ cell: z.number().min(2).max(12).default(3) })],
    ["grain", z.object({ amount: z.number().min(0).max(0.5).default(0.06) })],
  ]),
  look: new Map<string, z.ZodObject>([["neutral", none]]),
};

/** A resolver over the small catalog above. */
export const resolve: Resolve = (kind, id) => {
  const parameters = schemas[kind].get(id);
  return parameters === undefined ? undefined : { parameters };
};

/**
 * A resolver that knows every id the document uses and accepts the parameters it gives them, so only the structure of the
 * document is left to check.
 */
export function acceptAll(scene: Scene): Resolve {
  const keys = new Map<string, Set<string>>();
  const note = (kind: RefKind, id: string, params: Readonly<Record<string, unknown>> | undefined): void => {
    const names = keys.get(`${kind}/${id}`) ?? new Set<string>();
    for (const key of Object.keys(params ?? {})) names.add(key);
    keys.set(`${kind}/${id}`, names);
  };
  if (typeof scene.look === "string") note("look", scene.look, undefined);
  for (const { asset, surface } of scene.nodes) {
    note(asset.kind === "object" ? "object" : "primitive", asset.id, asset.params);
    if (asset.kind === "framed") note("material", asset.edges.material, undefined);
    if (surface !== undefined) note("material" in surface ? "material" : "shader", "material" in surface ? surface.material : surface.shader, surface.params);
  }
  for (const effect of scene.effects) note("effect", effect.id, effect.params);
  // A track names a parameter of a node's surface or of an effect; the resolver takes the names the document uses, whoever names them.
  const surfaces = new Map(scene.nodes.map((node) => [node.id, node.surface] as const));
  for (const track of scene.tracks) {
    const property = propertyOf(track.target);
    if (property?.param === undefined) continue;
    if (property.node !== undefined) {
      const surface = surfaces.get(property.node);
      if (surface === undefined) continue;
      note("material" in surface ? "material" : "shader", "material" in surface ? surface.material : surface.shader, { [property.param]: undefined });
    } else if (property.effect !== undefined) {
      note("effect", property.effect, { [property.param]: undefined });
    }
  }
  return (kind, id) => {
    const names = keys.get(`${kind}/${id}`);
    return names === undefined ? undefined : { parameters: z.object(Object.fromEntries([...names].map((name) => [name, z.json().optional()]))) };
  };
}

const number = fc.double({ noNaN: true, noDefaultInfinity: true });
const vec3 = fc.tuple(number, number, number);
const hex = fc.integer({ min: 0, max: 0xffffff }).map((n) => `#${n.toString(16).padStart(6, "0")}`);

/** Valid parameters for a few of the catalog's assets, or none. */
const cubeParams = fc.option(fc.record({ scale: fc.double({ min: 0.1, max: 4, noNaN: true }) }, { requiredKeys: [] }), { nil: undefined });

const asset = fc.oneof(
  cubeParams.map((params): SceneNode["asset"] => ({ kind: "primitive", id: "platonic-cube", ...(params === undefined ? {} : { params }) })),
  fc.constant<SceneNode["asset"]>({ kind: "primitive", id: "platonic-icosahedron" }),
  cubeParams.map((params): SceneNode["asset"] => ({ kind: "framed", id: "platonic-cube", edges: { material: "metal" }, ...(params === undefined ? {} : { params }) })),
  fc.record({ hours: fc.integer({ min: 0, max: 23 }), minutes: fc.integer({ min: 0, max: 59 }) }, { requiredKeys: [] }).map((params): SceneNode["asset"] => ({ kind: "object", id: "dress-watch", params })),
  fc.constantFrom("glass", "metal").map((material): SceneNode["asset"] => ({ kind: "object", id: "crystal-cluster", params: { material } })),
);

const surface = fc.option(
  fc.oneof(
    fc.constantFrom("metal", "glass").map((material): NonNullable<SceneNode["surface"]> => ({ material })),
    fc.integer({ min: 2, max: 8 }).map((bands): NonNullable<SceneNode["surface"]> => ({ shader: "toon", params: { bands } })),
  ),
  { nil: undefined },
);

/** Ids that are also names on every object: they must work as ids, and nothing may use an id as a key or an identifier. */
const awkward = ["constructor", "__proto__", "toString", "hasOwnProperty", "Node-With-Capitals"] as const;

/**
 * Nodes whose parents are never in a cycle (each hangs from a node drafted before it) but are listed in any order, so a
 * parent is often listed after its children. Some ids are names such as `constructor` and `__proto__`.
 */
const nodes = fc
  .array(fc.record({ asset, surface, position: vec3, rotation: vec3, scale: vec3, up: fc.nat(), name: fc.option(fc.constantFrom(...awkward), { nil: undefined }), key: fc.nat() }), { maxLength: 6 })
  .map((drafts) => {
    const used = new Set<string>();
    const ids = drafts.map(({ name }, index) => {
      const id = name !== undefined && !used.has(name) ? name : `node-${String(index)}`;
      used.add(id);
      return id;
    });
    const built = drafts.map(({ asset: drafted, surface: surfaced, position, rotation, scale, up }, index): SceneNode => ({
      id: ids[index] ?? "",
      parent: index === 0 || up % 3 === 0 ? null : (ids[up % index] ?? null),
      position,
      rotation,
      scale,
      asset: drafted,
      ...(surfaced === undefined || drafted.kind === "object" ? {} : { surface: surfaced }),
    }));
    return built.map((node, index) => ({ node, order: drafts[index]?.key ?? 0, index })).sort((x, y) => x.order - y.order || x.index - y.index).map(({ node }) => node);
  });

/** Screen effect stacks the small catalog takes: each effect once, in any order. */
const effectStacks: fc.Arbitrary<SceneEffect[]> = fc.shuffledSubarray([{ id: "dither", params: { cell: 4 } }, { id: "grain" }]);

const giantEasing = fc.constantFrom(...easingTokens);
const driver = fc.constantFrom(...trackDrivers);
const trigger = fc.constantFrom(...trackTriggers);
const finite = fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true });
const vec = fc.tuple(finite, finite, finite);

/** A value that fits a property: a vec3 for a transform or the camera, a number for a field, anything scalar-ish for a parameter. */
const valueFor = (kind: PropertyKind): fc.Arbitrary<SceneTrackKeyframe["value"]> => {
  switch (kind) {
    case "vec3":
      return vec;
    case "number":
      return number;
    case "param":
      return fc.oneof(finite, fc.string({ maxLength: 12 }), fc.boolean(), vec);
  }
};

/** Three keyframe times in order from zero, not a value the canonical text would write differently. */
const times = fc.tuple(fc.constant(0), fc.double({ min: 0.001, max: 50, noNaN: true }), fc.double({ min: 0.002, max: 100, noNaN: true }));
/** A target a document's own fields offer a track: a real path, and the kind of value it takes. */
interface Candidate {
  readonly target: string;
  readonly kind: PropertyKind;
}

/** The properties this document can animate: its nodes' transforms, the parameters its own surfaces and effects take, and the camera. */
function candidatesOf(nodes: readonly SceneNode[], effects: readonly SceneEffect[]): readonly Candidate[] {
  const found: Candidate[] = [];
  for (const node of nodes) for (const field of ["position", "rotation", "scale"] as const) found.push({ target: `node.${node.id}.${field}`, kind: "vec3" });
  for (const node of nodes) {
    const surface = node.surface;
    if (surface === undefined || !("shader" in surface)) continue;
    // The small catalog's one parameterised shader; a parameter the resolver would not know is not a target.
    if (surface.shader === "toon") found.push({ target: `node.${node.id}.surface.params.bands`, kind: "param" });
  }
  for (const effect of effects) {
    if (effect.id === "dither") found.push({ target: "effect.dither.params.cell", kind: "param" });
    if (effect.id === "grain") found.push({ target: "effect.grain.params.amount", kind: "param" });
  }
  found.push({ target: "camera.position", kind: "vec3" }, { target: "camera.target", kind: "vec3" }, { target: "camera.fov", kind: "number" });
  return found;
}

/** Tracks, clips and rest values over the properties this document offers, each track unique and in at most one clip. */
const motionFor = (nodes: readonly SceneNode[], effects: readonly SceneEffect[]): fc.Arbitrary<Pick<Scene, "tracks" | "clips" | "rest">> => {
  // One track drives one property: the candidates are unique by path, so no generated scene has two tracks on one path.
  const candidates = [...new Map(candidatesOf(nodes, effects).map((candidate) => [candidate.target, candidate])).values()];
  const keyframes = (kind: PropertyKind): fc.Arbitrary<SceneTrackKeyframe[]> =>
    fc.tuple(times, valueFor(kind), valueFor(kind), fc.option(giantEasing, { nil: undefined })).map(([at, first, second, ease]) => {
      const built: SceneTrackKeyframe[] = [{ time: at[0], value: first }];
      built.push({ time: at[1], value: second, ...(ease === undefined ? {} : { easing: ease }) });
      return built;
    });
  return fc
    .uniqueArray(
      fc.constantFrom(...candidates).chain((candidate) =>
        fc.record({ keyframes: keyframes(candidate.kind), driver: fc.option(driver, { nil: undefined }), trigger: fc.option(trigger, { nil: undefined }), easing: fc.option(giantEasing, { nil: undefined }) }).map((draft) => ({ candidate, draft })),
      ),
      { maxLength: Math.min(4, candidates.length), selector: (entry) => entry.candidate.target },
    )
    .chain((drafted) => {
      const tracks: Scene["tracks"] = drafted.map(({ candidate, draft }, index) => ({
        id: `track-${String(index)}`,
        target: candidate.target,
        keyframes: draft.keyframes,
        ...(draft.driver === undefined ? {} : { driver: draft.driver }),
        ...(draft.trigger === undefined ? {} : { trigger: draft.trigger }),
      }));
      const rest: Scene["rest"] = {};
      for (const { candidate, draft } of drafted) {
        const value = draft.keyframes[0]?.value;
        if (value !== undefined) rest[candidate.target] = value;
      }
      // Each track lands in one clip or none: the split point of the track list.
      const split = fc.nat({ max: tracks.length });
      return split.map((at) => {
        const clips: Scene["clips"] = [];
        const first = tracks.slice(0, at);
        const second = tracks.slice(at);
        if (first.length > 0) clips.push({ id: "clip-a", tracks: first.map((track) => track.id) });
        if (second.length > 0) clips.push({ id: "clip-b", tracks: second.map((track) => track.id) });
        return { tracks, clips, rest };
      });
    });
};

const stages: fc.Arbitrary<SceneStage> = fc
  .record({
    quality: fc.constantFrom(...stageQualities),
    shadows: fc.option(fc.record({ enabled: fc.boolean(), catcher: fc.boolean() }), { nil: undefined }),
    bloom: fc.option(fc.record({ enabled: fc.boolean(), threshold: fc.double({ min: 0, max: 20, noNaN: true }), gain: fc.double({ min: 0, max: 4, noNaN: true }), radius: fc.double({ min: 0, max: 1, noNaN: true }) }), { nil: undefined }),
    dof: fc.option(fc.record({ enabled: fc.boolean(), focus: fc.double({ min: 0.1, max: 100, noNaN: true }), aperture: fc.double({ min: 0, max: 10, noNaN: true }), focalLength: fc.double({ min: 0.1, max: 50, noNaN: true }) }), { nil: undefined }),
    toneMapping: fc.option(fc.constantFrom(...toneMappingModes), { nil: undefined }),
    exposure: fc.option(fc.double({ min: 0.1, max: 10, noNaN: true }), { nil: undefined }),
  })
  .map(({ quality, shadows, bloom, dof, toneMapping, exposure }): SceneStage => ({
    quality,
    ...(shadows === undefined ? {} : { shadows }),
    ...(bloom === undefined ? {} : { bloom }),
    ...(dof === undefined ? {} : { dof }),
    ...(toneMapping === undefined ? {} : { toneMapping }),
    ...(exposure === undefined ? {} : { exposure }),
  }));

const environments: fc.Arbitrary<SceneEnvironment> = fc
  .record({
    kind: fc.constantFrom(...environmentKinds),
    intensity: fc.option(fc.double({ min: 0, max: 10, noNaN: true }), { nil: undefined }),
    rotation: fc.option(fc.double({ min: -Math.PI * 2, max: Math.PI * 2, noNaN: true, noDefaultInfinity: true }), { nil: undefined }),
    hdri: fc.option(
      fc.record({
        url: fc.constantFrom("https://example.com/studio.hdr", "data:application/octet-stream;base64,AA==", "/assets/env.hdr"),
        license: fc.constant(HDRI_LICENSE),
        credit: fc.constantFrom("Poly Haven (Greg Zaal)", "AmbientCG"),
      }),
      { nil: undefined },
    ),
  })
  .map(({ kind, intensity, rotation, hdri }): SceneEnvironment => ({
    kind,
    ...(intensity === undefined ? {} : { intensity }),
    ...(rotation === undefined ? {} : { rotation }),
    ...(hdri === undefined ? {} : { hdri }),
  }));

/** Valid documents that pass `checkRefs` against `resolve`. */
export const scenes: fc.Arbitrary<Scene> = fc
  .record({
    format: fc.constant("lts-scene" as const),
    version: fc.constant(2 as const),
    look: fc.oneof(fc.constant("neutral"), fc.record({ base: hex, accent: hex, metal: hex, glass: hex, emissive: hex })),
    seed: fc.nat(),
    nodes,
    lights: fc.record({ rig: fc.constant("studio" as const), intensity: fc.double({ min: 0, max: 10, noNaN: true }) }),
    environment: environments,
    stage: fc.option(stages, { nil: undefined }),
    camera: fc.record({ position: vec3, target: vec3, fov: fc.double({ min: 1, max: 179, noNaN: true }) }),
    effects: effectStacks,
    ink: fc.constantFrom(...inkModes),
  })
  .chain((document) => motionFor(document.nodes, document.effects).map((motion) => ({ ...document, ...motion })));

/** The text of a fixture file. */
export const fixtureText = (name: string): string => readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8");

/** A fixture of the current version, read: a version 1 fixture comes up through the migration. */
export function fixtureScene(name: string): Scene {
  const result = migrate(fixtureText(name));
  if (!result.ok) throw new Error(`fixture ${name}: ${JSON.stringify(result.issues)}`);
  return result.scene;
}

/** Every fixture of the current version. */
/** The fixtures of the current version. `v1` is not one: it is the document the migration brings up. */
export const currentFixtures = ["primitives-in-materials", "framed-solid-shader", "object-effects-ink", "transform-hierarchy", "tracks"] as const;

/** The scene of a result, or a thrown error naming its issues: for a test that expects the document to read. */
export function sceneOf(result: SceneResult): Scene {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.scene;
}

/** One edit of a document, as a name and what it does to a document: made by `editsOf`, run by the tests. */
export interface Edit {
  readonly name: string;
  readonly run: (scene: Scene) => SceneResult;
}

const looks: fc.Arbitrary<SceneLook> = fc.oneof(fc.constant("neutral"), fc.record({ base: hex, accent: hex, metal: hex, glass: hex, emissive: hex }));
const transforms: fc.Arbitrary<TransformChange> = fc.record({ position: vec3, rotation: vec3, scale: vec3 }, { requiredKeys: [] });
const concreteSurface: fc.Arbitrary<SceneSurface> = fc.oneof(
  fc.constantFrom("glass", "metal").map((material): SceneSurface => ({ material })),
  fc.integer({ min: 2, max: 8 }).map((bands): SceneSurface => ({ shader: "toon", params: { bands } })),
);

/** A node id that none of `taken` has. */
function freshId(taken: readonly string[], seed: number): string {
  let id = `added-${String(seed)}`;
  while (taken.includes(id)) id += "x";
  return id;
}

/**
 * Edits that suit a document, each with valid arguments: a node of the catalog added under one that is there (or at the root),
 * a node removed, moved or given a surface (not an object, which takes none), an effect stack, an ink, a light and a look.
 */
export function editsOf(scene: Scene): fc.Arbitrary<Edit> {
  const ids = scene.nodes.map((node) => node.id);
  const surfaced = scene.nodes.filter((node) => node.asset.kind !== "object").map((node) => node.id);
  const parents: fc.Arbitrary<string | null> = ids.length === 0 ? fc.constant(null) : fc.option(fc.constantFrom(...ids), { nil: null });
  const choices: fc.Arbitrary<Edit>[] = [
    fc.record({ asset, surface, position: vec3, rotation: vec3, scale: vec3, parent: parents, seed: fc.nat() }).map(
      ({ asset: drafted, surface: chosen, position, rotation, scale, parent, seed }): Edit => ({
        name: "addNode",
        run: (current) =>
          addNode(current, { id: freshId(current.nodes.map((node) => node.id), seed), parent, position, rotation, scale, asset: drafted, ...(chosen === undefined || drafted.kind === "object" ? {} : { surface: chosen }) }),
      }),
    ),
    effectStacks.map((stack): Edit => ({ name: "setEffects", run: (current) => setEffects(current, stack) })),
    fc.constantFrom(...inkModes).map((ink): Edit => ({ name: "setInk", run: (current) => setInk(current, ink) })),
    fc.double({ min: 0, max: 10, noNaN: true }).map((intensity): Edit => ({ name: "setLights", run: (current) => setLights(current, { intensity }) })),
    environments.map((environment): Edit => ({ name: "setEnvironment", run: (current) => setEnvironment(current, environment) })),
    fc.option(stages, { nil: undefined }).map((stage): Edit => ({ name: "setStage", run: (current) => setStage(current, stage) })),
    looks.map((look): Edit => ({ name: "setLook", run: (current) => setLook(current, look) })),
  ];
  if (ids.length > 0) {
    choices.push(
      fc.constantFrom(...ids).map((id): Edit => ({ name: "removeNode", run: (current) => removeNode(current, id) })),
      fc.tuple(fc.constantFrom(...ids), transforms).map(([id, change]): Edit => ({ name: "setTransform", run: (current) => setTransform(current, id, change) })),
    );
  }
  if (surfaced.length > 0) {
    choices.push(fc.tuple(fc.constantFrom(...surfaced), fc.option(concreteSurface, { nil: undefined })).map(([id, chosen]): Edit => ({ name: "setSurface", run: (current) => setSurface(current, id, chosen) })));
  }
  return fc.oneof(...choices);
}
