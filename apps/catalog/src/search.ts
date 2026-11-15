import type { AssetKind, AssetMeta } from "@hedronite/lts-core";

export type KindFilter = AssetKind | "all";

export interface Query {
  readonly text: string;
  readonly kind: KindFilter;
}

/** Assets matching every search word (in name, id or tags) and the kind filter, in registry order. */
export function filterAssets(assets: readonly AssetMeta[], query: Query): readonly AssetMeta[] {
  const words = query.text.trim().toLowerCase().split(/\s+/).filter((word) => word.length > 0);
  return assets.filter(
    (asset) =>
      (query.kind === "all" || asset.kind === query.kind) &&
      words.every(
        (word) => asset.name.toLowerCase().includes(word) || asset.id.includes(word) || asset.tags.some((tag) => tag.includes(word)),
      ),
  );
}

/** The kinds present, with counts, in the order assetKinds lists them. */
export function kindCounts(assets: readonly AssetMeta[], order: readonly AssetKind[]): readonly (readonly [AssetKind, number])[] {
  return order
    .map((kind): readonly [AssetKind, number] => [kind, assets.filter((asset) => asset.kind === kind).length])
    .filter(([, count]) => count > 0);
}
