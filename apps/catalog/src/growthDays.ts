import type { AssetKind, AssetMeta } from "@hedronite/lts-core";

export interface GrowthDay {
  readonly date: string;
  readonly assets: readonly AssetMeta[];
  readonly byKind: readonly (readonly [AssetKind, number])[];
}

/** Assets grouped by the day they were added, newest day first. Assets without a date are left out. */
export function growth(assets: readonly AssetMeta[], order: readonly AssetKind[]): readonly GrowthDay[] {
  const days = new Map<string, AssetMeta[]>();
  for (const asset of assets) {
    if (asset.added === undefined) continue;
    days.set(asset.added, [...(days.get(asset.added) ?? []), asset]);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([date, list]) => ({
      date,
      assets: list,
      byKind: order.map((kind): readonly [AssetKind, number] => [kind, list.filter((a) => a.kind === kind).length]).filter(([, n]) => n > 0),
    }));
}

/** Newest first; ties (same day) keep their registry order, which is by id. */
export function byNewest(assets: readonly AssetMeta[]): readonly AssetMeta[] {
  return [...assets].sort((a, b) => (b.added ?? "").localeCompare(a.added ?? ""));
}
