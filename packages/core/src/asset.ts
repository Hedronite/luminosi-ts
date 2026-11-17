import { z } from "zod";

/** The kinds of asset LuminosiTS ships. */
export const assetKinds = ["icon", "primitive", "object", "scene", "material", "shader", "effect"] as const;

export const assetKindSchema = z.enum(assetKinds);

export type AssetKind = z.infer<typeof assetKindSchema>;

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const semver = /^\d+\.\d+\.\d+$/;
const scopedPackage = /^@[a-z0-9-]+\/[a-z0-9-]+$/;

/**
 * Where an adopted asset came from: a folder under assets/vendor and the file (or folder) in it that the
 * asset was ported from. The folder's CREDIT.md and LICENSE carry the author and the terms; the vendor
 * tool checks that both exist, and the catalog links the asset to its source.
 */
export const assetOriginSchema = z
  .object({
    vendor: z.string().regex(slug),
    /** A path inside the vendored folder, with forward slashes and no leading slash. */
    path: z.string().regex(/^(?!\/)(?!.*\.\.)[\w./@ -]+$/),
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
