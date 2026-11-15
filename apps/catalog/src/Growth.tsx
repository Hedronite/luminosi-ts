import { assetKinds, type AssetMeta } from "@hedronite/lts-core";
import { AssetPreview } from "./AssetPreview";
import { growth } from "./growthDays";

const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? "" : "s"}`;

/** How the library grew: assets grouped by the day they were added, newest first. */
export function Growth({ assets, onOpen }: { readonly assets: readonly AssetMeta[]; readonly onOpen: (meta: AssetMeta, trigger: HTMLElement) => void }) {
  const days = growth(assets, assetKinds);
  return (
    <section aria-labelledby="growth-title" className="mt-6">
      <h2 id="growth-title" className="text-lg font-semibold">
        Growth
      </h2>
      {days.length === 0 ? <p className="mt-2 text-fg-muted">No dated assets yet.</p> : null}
      <ol className="mt-4 flex flex-col gap-8">
        {days.map((day) => (
          <li key={day.date}>
            <h3 className="font-medium">
              <time dateTime={day.date}>{day.date}</time>
            </h3>
            <p className="text-sm text-fg-muted">{day.byKind.map(([kind, n]) => plural(n, kind)).join(", ")}</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {day.assets.map((meta) => (
                <li key={meta.id}>
                  <button
                    type="button"
                    onClick={(event) => {
                      onOpen(meta, event.currentTarget);
                    }}
                    className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-sm hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <AssetPreview meta={meta} size={20} />
                    {meta.name}
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
