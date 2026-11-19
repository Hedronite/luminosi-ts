import { z } from "zod";
import { ringLayout } from "./layout.js";
import { headerOf, parseScene, readJson, SCENE_FORMAT, SCENE_VERSION, type SceneIssue, type SceneResult } from "./schema.js";

/** The look a version 0 document had, since it named none: the default. */
const V0_LOOK = "neutral";

/** How big the playground drew each kind of placement: primitives and framed solids are about a unit across, objects are built larger. */
const V0_SCALE = { shape: 0.5, object: 0.6 } as const;

/** Where the playground's camera stood. A version 0 document did not say, so it stands there. */
const V0_CAMERA = { position: [0, 2.2, 5.5], target: [0, 0, 0], fov: 40 } as const;

const assetName = z.string();

/**
 * Version 0: the playground's `toJson` output from before the scene document. Placements had no ids and no positions
 * (the playground put them on a ring), no camera, no look and no seed; the effects were a bare list of ids.
 */
const v0 = z.strictObject({
  lightIntensity: z.number(),
  placements: z.array(
    z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("primitive"), primitive: assetName, material: assetName, shader: assetName.optional() }),
      z.strictObject({ kind: z.literal("framed"), primitive: assetName, faces: assetName, edges: assetName, shader: assetName.optional() }),
      z.strictObject({ kind: z.literal("object"), object: assetName, material: assetName.optional() }),
    ]),
  ),
  effects: z.array(assetName).optional(),
  ink: z.enum(["look", "accent", "emissive", "glass"]).optional(),
});

type V0 = z.output<typeof v0>;

/** Version 0 as a version 1 document, not yet checked: positions from the ring, ids by order. */
function fromV0(old: V0): Record<string, unknown> {
  const positions = ringLayout(old.placements.length);
  const nodes = old.placements.map((placement, i) => {
    const scale = placement.kind === "object" ? V0_SCALE.object : V0_SCALE.shape;
    const base = { id: `node-${String(i + 1)}`, parent: null, position: positions[i] ?? [0, 0, 0], rotation: [0, 0, 0], scale: [scale, scale, scale] };
    switch (placement.kind) {
      case "primitive":
        return { ...base, asset: { kind: "primitive", id: placement.primitive }, surface: placement.shader === undefined ? { material: placement.material } : { shader: placement.shader } };
      case "framed":
        return { ...base, asset: { kind: "framed", id: placement.primitive, edges: { material: placement.edges } }, surface: placement.shader === undefined ? { material: placement.faces } : { shader: placement.shader } };
      case "object":
        return { ...base, asset: { kind: "object", id: placement.object, ...(placement.material === undefined ? {} : { params: { material: placement.material } }) } };
    }
  });
  return {
    format: SCENE_FORMAT,
    version: 1,
    look: V0_LOOK,
    seed: 0,
    nodes,
    lights: { rig: "studio", intensity: old.lightIntensity },
    environment: { kind: "studio" },
    camera: { position: [...V0_CAMERA.position], target: [...V0_CAMERA.target], fov: V0_CAMERA.fov },
    effects: (old.effects ?? []).map((id) => ({ id })),
    ink: old.ink ?? "look",
  };
}

/**
 * One step of the table: reads a document of version `from`, in that version's own terms, and writes it as the next
 * version's. The last step's output is checked against the current schema. A new version adds a step here, a fixture
 * for the version it leaves behind, and nothing else.
 */
const steps: readonly { readonly from: number; readonly up: (document: unknown) => { readonly ok: true; readonly next: unknown } | { readonly ok: false; readonly issues: readonly SceneIssue[] } }[] = [
  {
    from: 0,
    up: (document) => {
      const parsed = v0.safeParse(document);
      if (parsed.success) return { ok: true, next: fromV0(parsed.data) };
      return { ok: false, issues: parsed.error.issues.map((issue) => ({ path: issue.path.filter((key): key is string | number => typeof key !== "symbol"), code: issue.code, message: issue.message })) };
    },
  },
];

/** The version of a document: its `version` when it declares the format, 0 when it declares neither (the playground's JSON), nothing otherwise. */
function versionOf(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const header = headerOf(value);
  if (header.format === undefined && header.version === undefined) return 0;
  return header.format === SCENE_FORMAT && typeof header.version === "number" && Number.isInteger(header.version) ? header.version : undefined;
}

/**
 * Reads a scene document of any version, from a value or JSON text, and brings it up to the current one. A document
 * already current comes back as it parses, so `migrate` of its own output is the same document. Version 0 is the
 * playground's JSON from before the format existed (it declares neither format nor version). Like `parseScene` it
 * never throws on user input.
 */
export function migrate(input: unknown): SceneResult {
  const read = readJson(input);
  if (!read.ok) return read;
  let document = read.value;
  const version = versionOf(document);
  if (version === undefined) return parseScene(document);
  if (version > SCENE_VERSION) return { ok: false, issues: [{ path: ["version"], code: "unsupported-version", message: `this reads versions up to ${String(SCENE_VERSION)}; this document is version ${String(version)}` }] };
  for (const step of steps.filter((candidate) => candidate.from >= version)) {
    const stepped = step.up(document);
    if (!stepped.ok) return stepped;
    document = stepped.next;
  }
  return parseScene(document);
}
