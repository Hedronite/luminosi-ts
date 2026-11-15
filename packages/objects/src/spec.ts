import { isMaterialId, type MaterialId } from "@hedronite/lts-materials";
import { isPrimitiveId, type PrimitiveId } from "@hedronite/lts-primitives";
import { parseHex, type Hex, type ScenePalette } from "@hedronite/lts-tokens";
import { z } from "zod";

/**
 * An object described as data: parts (shapes with transforms and a parent), the materials they use
 * and named sockets. `createObjectFromSpec` builds it; image reconstruction emits it. Everything is
 * plain JSON, so a spec can be generated, diffed, reviewed and stored as source.
 *
 * Units are scene units (about one unit across for a hand-held object). Rotations are XYZ Euler
 * angles in radians. A part's `position` and `rotation` place its pivot relative to its parent, and
 * its children follow them. `shapePosition`, `shapeRotation` and `scale` place the part's own shape
 * inside that pivot and never reach its children, so a squashed part can't skew what hangs from it.
 */

/** Coordinates and sizes stay within this, so a bad spec can't produce a scene a kilometre wide. */
const LIMIT = 1000;

const slug = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "expected a lowercase slug");
const coordinate = z.number().min(-LIMIT).max(LIMIT);
const length = z.number().positive().max(LIMIT);
const radius = z.number().min(0).max(LIMIT);
const vec3 = z.tuple([coordinate, coordinate, coordinate]);
const segments = (min: number, max: number, fallback: number) => z.int().min(min).max(max).default(fallback);
const unit = z.number().min(0).max(1);

const paletteKeys = ["base", "accent", "metal", "glass", "emissive"] as const satisfies readonly (keyof ScenePalette)[];

const primitiveId = z.custom<PrimitiveId>((value) => typeof value === "string" && isPrimitiveId(value), "unknown primitive id");
const materialId = z.custom<MaterialId>((value) => typeof value === "string" && isMaterialId(value), "unknown material preset");

const shapeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("primitive"), id: primitiveId }),
  z.object({ type: z.literal("box"), size: z.tuple([length, length, length]) }),
  z
    .object({ type: z.literal("cylinder"), radiusTop: radius, radiusBottom: radius, height: length, segments: segments(3, 128, 32) })
    .refine((c) => c.radiusTop > 0 || c.radiusBottom > 0, "a cylinder needs at least one non-zero radius"),
  z.object({ type: z.literal("sphere"), radius: length, widthSegments: segments(3, 128, 32), heightSegments: segments(2, 64, 16) }),
  z.object({
    type: z.literal("torus"),
    radius: length,
    tube: length,
    radialSegments: segments(3, 64, 12),
    tubularSegments: segments(3, 256, 48),
    arc: z
      .number()
      .positive()
      .max(2 * Math.PI)
      .default(2 * Math.PI),
  }),
  /** A profile turned about the y axis: [radius, y] points, radius >= 0. */
  z.object({ type: z.literal("lathe"), points: z.array(z.tuple([radius, coordinate])).min(2).max(512), segments: segments(3, 256, 48) }),
  /** Custom indexed triangles: xyz triples, and three vertex indices per triangle. */
  z
    .object({
      type: z.literal("mesh"),
      positions: z
        .array(coordinate)
        .min(9)
        .max(3 * 65_536),
      indices: z
        .array(z.int().min(0))
        .min(3)
        .max(3 * 131_072),
    })
    .superRefine((mesh, ctx) => {
      if (mesh.positions.length % 3 !== 0) ctx.addIssue({ code: "custom", message: "positions must be xyz triples", path: ["positions"] });
      if (mesh.indices.length % 3 !== 0) ctx.addIssue({ code: "custom", message: "indices must come three per triangle", path: ["indices"] });
      const vertices = Math.floor(mesh.positions.length / 3);
      if (mesh.indices.some((i) => i >= vertices)) ctx.addIssue({ code: "custom", message: `an index is past the last vertex (${String(vertices - 1)})`, path: ["indices"] });
    }),
]);

const materialSchema = z.object({
  preset: materialId,
  /** Which palette color to take, instead of the preset's own. */
  color: z.enum(paletteKeys).optional(),
  /** 0 is black, 1 the palette color, 2 white. */
  shade: z.number().min(0).max(2).optional(),
  roughness: unit.optional(),
  metalness: unit.optional(),
});

const transform = {
  position: vec3.default([0, 0, 0]),
  rotation: vec3.default([0, 0, 0]),
};

const partSchema = z.object({
  id: slug,
  /** A part declared earlier in `parts`. Without one, the part hangs from the root. */
  parent: slug.optional(),
  shape: shapeSchema,
  /** A key of `materials`. */
  material: slug,
  ...transform,
  /** The shape's offset inside the pivot. */
  shapePosition: vec3.default([0, 0, 0]),
  /** The shape's rotation inside the pivot, applied before `scale`. */
  shapeRotation: vec3.default([0, 0, 0]),
  /** The shape's size factors. */
  scale: z.tuple([length, length, length]).default([1, 1, 1]),
});

/** A named attachment point: where something else (a strap, a light, a label) can be mounted. */
const socketSchema = z.object({ id: slug, parent: slug.optional(), ...transform });

export const objectSpecSchema = z
  .object({
    format: z.literal("lts-object-spec"),
    version: z.literal(1),
    id: slug,
    name: z.string().min(1).max(80),
    materials: z.record(slug, materialSchema),
    parts: z.array(partSchema).min(1).max(512),
    sockets: z.array(socketSchema).max(64).default([]),
  })
  .superRefine((spec, ctx) => {
    const declared = new Set<string>();
    const used = new Set<string>();
    spec.parts.forEach((part, i) => {
      if (declared.has(part.id)) ctx.addIssue({ code: "custom", message: `duplicate part id "${part.id}"`, path: ["parts", i, "id"] });
      if (part.parent !== undefined && !declared.has(part.parent)) {
        ctx.addIssue({ code: "custom", message: `parent "${part.parent}" must be a part declared before "${part.id}"`, path: ["parts", i, "parent"] });
      }
      if (!Object.hasOwn(spec.materials, part.material)) ctx.addIssue({ code: "custom", message: `unknown material "${part.material}"`, path: ["parts", i, "material"] });
      declared.add(part.id);
      used.add(part.material);
    });
    for (const key of Object.keys(spec.materials)) {
      if (!used.has(key)) ctx.addIssue({ code: "custom", message: `material "${key}" is not used by any part`, path: ["materials", key] });
    }
    const sockets = new Set<string>();
    spec.sockets.forEach((socket, i) => {
      if (declared.has(socket.id) || sockets.has(socket.id)) ctx.addIssue({ code: "custom", message: `socket id "${socket.id}" is already taken`, path: ["sockets", i, "id"] });
      if (socket.parent !== undefined && !declared.has(socket.parent)) ctx.addIssue({ code: "custom", message: `unknown parent part "${socket.parent}"`, path: ["sockets", i, "parent"] });
      sockets.add(socket.id);
    });
  });

export type ObjectSpec = z.output<typeof objectSpecSchema>;
export type ObjectShape = z.output<typeof shapeSchema>;
export type ObjectMaterial = z.output<typeof materialSchema>;
export type ObjectPart = z.output<typeof partSchema>;

/** Parses and checks a spec from untrusted input (JSON, a generator). Throws a `ZodError` naming every problem. */
export function parseObjectSpec(input: unknown): ObjectSpec {
  return objectSpecSchema.parse(input);
}

/** As `parseObjectSpec`, but returns the result instead of throwing. */
export function safeParseObjectSpec(input: unknown): z.ZodSafeParseResult<ObjectSpec> {
  return objectSpecSchema.safeParse(input);
}

const hexByte = (value: number): string =>
  Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, "0");

/** Darkens toward black (shade < 1) or lightens toward white (shade > 1), in sRGB. */
export function shadeHex(hex: string, shade: number): Hex {
  const channels = parseHex(hex).map((c) => (shade <= 1 ? c * shade : c + (255 - c) * (shade - 1)));
  return `#${channels.map(hexByte).join("")}`;
}
