import { assetKinds, type AssetMeta } from "@hedronite/lts-core";
import { Search } from "@hedronite/lts-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AssetPreview } from "./AssetPreview";
import { DetailDialog } from "./DetailDialog";
import { registry } from "./registry";
import { filterAssets, kindCounts, type KindFilter } from "./search";

const allAssets = registry.list();
const kinds = kindCounts(allAssets, assetKinds);

const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? "" : "s"}`;

function initialSelection(): AssetMeta | undefined {
  const id = new URLSearchParams(window.location.search).get("asset");
  return id === null ? undefined : registry.get(id);
}

export function App() {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [selected, setSelected] = useState<AssetMeta | undefined>(initialSelection);
  const opener = useRef<HTMLElement | null>(null);

  const results = useMemo(() => filterAssets(allAssets, { text, kind }), [text, kind]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (selected === undefined) url.searchParams.delete("asset");
    else url.searchParams.set("asset", selected.id);
    window.history.replaceState(null, "", url);
  }, [selected]);

  const open = (meta: AssetMeta, trigger: HTMLElement): void => {
    opener.current = trigger;
    setSelected(meta);
  };

  const close = (): void => {
    setSelected(undefined);
    opener.current?.focus();
  };

  return (
    <div className="min-h-screen bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
        <header>
          <h1 className="text-2xl font-semibold">LuminosiTS catalog</h1>
          <p className="mt-1 text-neutral-600 dark:text-neutral-400">{plural(allAssets.length, "asset")}, typed and importable.</p>
        </header>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <search className="relative min-w-60 flex-1">
            <label htmlFor="asset-search" className="sr-only">
              Search assets
            </label>
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-neutral-500">
              <Search size={18} />
            </span>
            <input
              id="asset-search"
              type="search"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
              }}
              placeholder="Search by name or tag"
              className="w-full rounded-lg border border-neutral-300 bg-transparent py-2 pl-10 pr-3 dark:border-neutral-700"
            />
          </search>

          <div role="group" aria-label="Filter by kind" className="flex gap-1">
            {[["all", allAssets.length] as const, ...kinds].map(([value, count]) => (
              <button
                key={value}
                type="button"
                aria-pressed={kind === value}
                onClick={() => {
                  setKind(value);
                }}
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm aria-pressed:border-neutral-900 aria-pressed:bg-neutral-900 aria-pressed:text-white dark:border-neutral-700 dark:aria-pressed:border-neutral-100 dark:aria-pressed:bg-neutral-100 dark:aria-pressed:text-neutral-900"
              >
                {value === "all" ? "All" : `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}s`} <span className="opacity-60">{count}</span>
              </button>
            ))}
          </div>
        </div>

        <p aria-live="polite" className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
          {results.length === allAssets.length ? "" : plural(results.length, "result")}
        </p>

        {allAssets.length === 0 ? (
          <p className="mt-4 text-neutral-500">No assets yet. They appear here as packages register them.</p>
        ) : results.length === 0 ? (
          <p className="mt-4 text-neutral-600 dark:text-neutral-400">Nothing matches “{text}”.</p>
        ) : (
          <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
            {results.map((meta) => (
              <li key={meta.id}>
                <button
                  type="button"
                  onClick={(event) => {
                    open(meta, event.currentTarget);
                  }}
                  className="flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-xl border border-neutral-200 p-3 text-center hover:border-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-neutral-800 dark:hover:border-neutral-600"
                >
                  <AssetPreview meta={meta} size={32} />
                  <span className="text-sm">{meta.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
      <DetailDialog meta={selected} onClose={close} />
    </div>
  );
}
