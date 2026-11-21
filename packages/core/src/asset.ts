import { z } from "zod";

/**
 * Every kind an asset can have, by id. The seven LuminosiTS ships are listed here; a package that adds one
 * extends this interface, so its id type-checks everywhere a kind is taken, and registers it with `registerKind`:
 *
 *     declare module "@hedronite/lts-core" {
 *       interface AssetKindMap { sound: true }
 *     }
 *     registerKind("sound");
 */
export interface AssetKindMap {
  readonly icon: true;
  readonly primitive: true;
  readonly object: true;
  readonly scene: true;
  readonly material: true;
  readonly shader: true;
  readonly effect: true;
}

export type AssetKind = keyof AssetKindMap;

/** The kinds LuminosiTS ships, in the order the catalog lists them. They are registered by default. */
export const assetKinds = ["icon", "primitive", "object", "scene", "material", "shader", "effect"] as const satisfies readonly AssetKind[];

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const semver = /^\d+\.\d+\.\d+$/;
const scopedPackage = /^@[a-z0-9-]+\/[a-z0-9-]+$/;

const registered = new Set<string>(assetKinds);

/**
 * Makes `kind` a kind assets can have. The seven shipped kinds are registered already; registering one again does
 * nothing, so a module that registers its kind can be loaded twice. The id must be declared in `AssetKindMap` first.
 */
export function registerKind(kind: AssetKind): void {
  if (!slug.test(kind)) throw new RangeError(`kind "${kind}" is not a lowercase slug`);
  registered.add(kind);
}

/** True if `value` is a registered kind. */
export function isAssetKind(value: unknown): value is AssetKind {
  return typeof value === "string" && registered.has(value);
}

/** Every registered kind: the shipped ones in catalog order, then any added, in the order they were registered. */
export function registeredKinds(): readonly AssetKind[] {
  return [...registered].filter(isAssetKind);
}

/** A registered kind. Checked when metadata is parsed, so a kind registered later is accepted from then on. */
export const assetKindSchema = z.custom<AssetKind>(isAssetKind, {
  error: (issue) => `Invalid kind ${JSON.stringify(issue.input)}: expected one of ${registeredKinds().join(", ")}`,
});

/**
 * Where an adopted asset came from: a folder under assets/vendor and the file (or folder) in it that the
 * asset was ported from. The folder's CREDIT.md and LICENSE carry the author and the terms; the vendor
 * tool checks that both exist, and the catalog links the asset to its source.
 */
/** A path inside a credited work: forward slashes, no leading slash, nothing that climbs out. */
export const originPathSchema = z.string().regex(/^(?!\/)(?!.*\.\.)[\w./@ -]+$/);

export const originRelations = ["ported", "adopted", "inspired"] as const;

/** How the asset stands to the work it came from: ported (rewritten for LuminosiTS), adopted (used as published) or inspired by (made after it). */
export const originRelationSchema = z.enum(originRelations);

export type OriginRelation = z.infer<typeof originRelationSchema>;

export const assetOriginSchema = z
  .object({
    vendor: z.string().regex(slug),
    /** Ported, adopted or inspired by. Every origin says which. */
    relation: originRelationSchema,
    /** A path inside the vendored folder, with forward slashes and no leading slash. */
    path: originPathSchema,
    /** What was taken and what was changed, in a sentence. */
    note: z.string().min(1).optional(),
  })
  .readonly();

export type AssetOrigin = z.infer<typeof assetOriginSchema>;

/** The fields every asset carries. `assetMetaSchema` is the frozen form used for registration. */
export const assetMetaFields = z.object({
  id: z.string().regex(slug),
  kind: assetKindSchema,
  name: z.string().min(1),
  tags: z.array(z.string().regex(slug)).readonly().default([]),
  version: z.string().regex(semver),
  /** The package that ships the asset. Set by `registerManifest`. */
  package: z.string().regex(scopedPackage).optional(),
  /** The date the asset was added (YYYY-MM-DD), for growth views. */
  added: z.iso.date().optional(),
  /** Set when the asset was ported from open-source work in assets/vendor. */
  origin: assetOriginSchema.optional(),
});

/** Metadata every registered asset carries. Parsed when an asset is registered; frozen after. */
export const assetMetaSchema = assetMetaFields.readonly();

export type AssetMeta = z.infer<typeof assetMetaSchema>;
