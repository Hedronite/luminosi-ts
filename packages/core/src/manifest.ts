import { z } from "zod";
import { assetMetaFields, type AssetMeta } from "./asset.js";
import { DuplicateAssetError, type Registry } from "./registry.js";

/** The assets one package ships. */
export const manifestSchema = z
  .object({
    package: z.string().regex(/^@[a-z0-9-]+\/[a-z0-9-]+$/),
    assets: z.array(assetMetaFields.omit({ package: true })).readonly(),
  })
  .readonly();

export type Manifest = z.infer<typeof manifestSchema>;

/**
 * Parses `input` as a manifest and registers every asset under the manifest's package.
 * All or nothing: if any asset is invalid or its id is taken, nothing is registered.
 */
export function registerManifest(registry: Registry, input: unknown): readonly AssetMeta[] {
  const manifest = manifestSchema.parse(input);
  const seen = new Set<string>();
  for (const asset of manifest.assets) {
    if (seen.has(asset.id) || registry.get(asset.id) !== undefined) {
      throw new DuplicateAssetError(asset.id);
    }
    seen.add(asset.id);
  }
  return manifest.assets.map((asset) => registry.register({ ...asset, package: manifest.package }));
}
