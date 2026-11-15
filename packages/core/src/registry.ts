import { assetMetaSchema, type AssetKind, type AssetMeta } from "./asset.js";

/** Thrown when an asset id is registered twice. */
export class DuplicateAssetError extends Error {
  override readonly name = "DuplicateAssetError";
  readonly id: string;

  constructor(id: string) {
    super(`asset "${id}" is already registered`);
    this.id = id;
  }
}

export interface AssetFilter {
  readonly kind?: AssetKind;
  readonly tag?: string;
}

export interface Registry {
  /** Parses `input`, stores it, and returns the frozen metadata. Throws on invalid input or a duplicate id. */
  register(input: unknown): AssetMeta;
  get(id: string): AssetMeta | undefined;
  /** Every matching asset, sorted by id. */
  list(filter?: AssetFilter): readonly AssetMeta[];
}

export function createRegistry(): Registry {
  const assets = new Map<string, AssetMeta>();

  return {
    register(input) {
      const meta = assetMetaSchema.parse(input);
      if (assets.has(meta.id)) {
        throw new DuplicateAssetError(meta.id);
      }
      assets.set(meta.id, meta);
      return meta;
    },
    get: (id) => assets.get(id),
    list(filter = {}) {
      const matches = (meta: AssetMeta): boolean =>
        (filter.kind === undefined || meta.kind === filter.kind) &&
        (filter.tag === undefined || meta.tags.includes(filter.tag));
      return [...assets.values()].filter(matches).sort((a, b) => (a.id < b.id ? -1 : 1));
    },
  };
}
