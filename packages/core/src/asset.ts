import { z } from "zod";

/** The kinds of asset LuminosiTS ships. */
export const assetKinds = ["icon", "primitive", "object", "scene", "material", "shader"] as const;

export const assetKindSchema = z.enum(assetKinds);

export type AssetKind = z.infer<typeof assetKindSchema>;

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const semver = /^\d+\.\d+\.\d+$/;
const scopedPackage = /^@[a-z0-9-]+\/[a-z0-9-]+$/;

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
});

/** Metadata every registered asset carries. Parsed when an asset is registered; frozen after. */
export const assetMetaSchema = assetMetaFields.readonly();

export type AssetMeta = z.infer<typeof assetMetaSchema>;
