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

/** One ranked search result. */
export interface RankedAsset {
  readonly asset: AssetMeta;
  /** Higher is closer: 100 exact id, 80 name, 60 id or name prefix, 40 name word, 20 tag or substring. */
  readonly score: number;
}

/** Assets ranked by how closely they match `text`; ties keep registry order. Empty text matches nothing. */
export function rankAssets(assets: readonly AssetMeta[], text: string, kind: KindFilter = "all"): readonly RankedAsset[] {
  const q = text.trim().toLowerCase();
  if (q.length === 0) return [];
  const score = (asset: AssetMeta): number => {
    const name = asset.name.toLowerCase();
    if (asset.id === q) return 100;
    if (name === q) return 80;
    if (asset.id.startsWith(q) || name.startsWith(q)) return 60;
    if (name.split(/\s+/).some((word) => word.startsWith(q))) return 40;
    if (asset.tags.some((tag) => tag.includes(q)) || asset.id.includes(q) || name.includes(q)) return 20;
    return 0;
  };
  return assets
    .filter((asset) => kind === "all" || asset.kind === kind)
    .map((asset) => ({ asset, score: score(asset) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
}
