import { assetKinds, type AssetMeta } from "@hedronite/lts-core";
import { Search } from "@hedronite/lts-icons/react";
import { presets } from "@hedronite/lts-tokens";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AssetPreview } from "./AssetPreview";
import { DetailDialog } from "./DetailDialog";
import { Growth } from "./Growth";
import { byNewest } from "./growthDays";
import { PresetContext, usePresetState } from "./look";
import { registry } from "./registry";
import { filterAssets, kindCounts, type KindFilter } from "./search";

// The playground loads three.js and React Three Fiber only when opened.
const Playground = lazy(() => import("./Playground").then((module) => ({ default: module.Playground })));

type View = "assets" | "playground" | "growth";
const views: readonly (readonly [View, string])[] = [
  ["assets", "Assets"],
  ["playground", "Playground"],
  ["growth", "Growth"],
];

const allAssets = registry.list();
const kinds = kindCounts(allAssets, assetKinds);

const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? "" : "s"}`;
const kindLabel = (kind: KindFilter): string => (kind === "all" ? "All" : `${kind[0]?.toUpperCase() ?? ""}${kind.slice(1)}s`);

const toggle =
  "rounded-lg border border-line px-3 py-2 text-sm aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function initialView(): View {
  const view = new URLSearchParams(window.location.search).get("view");
  return view === "playground" || view === "growth" ? view : "assets";
}

function initialSelection(): AssetMeta | undefined {
  const id = new URLSearchParams(window.location.search).get("asset");
  return id === null ? undefined : registry.get(id);
}

export function App() {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [selected, setSelected] = useState<AssetMeta | undefined>(initialSelection);
  const [preset, setPreset] = usePresetState();
  const [view, setView] = useState<View>(initialView);
  const [newest, setNewest] = useState(false);
  const opener = useRef<HTMLElement | null>(null);

  const results = useMemo(() => {
    const matches = filterAssets(allAssets, { text, kind });
    return newest ? byNewest(matches) : matches;
  }, [text, kind, newest]);
  // Stepping walks the visible results, or everything when the selection came from a deep link outside them.
  const stepList = selected !== undefined && results.includes(selected) ? results : allAssets;
  const index = selected === undefined ? -1 : stepList.indexOf(selected);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (selected === undefined) url.searchParams.delete("asset");
    else url.searchParams.set("asset", selected.id);
    if (view === "assets") url.searchParams.delete("view");
    else url.searchParams.set("view", view);
    window.history.replaceState(null, "", url);
  }, [selected, view]);

  const open = (meta: AssetMeta, trigger: HTMLElement): void => {
    opener.current = trigger;
    setSelected(meta);
  };

  const close = (): void => {
    setSelected(undefined);
    opener.current?.focus();
  };

  const step = (direction: -1 | 1): void => {
    const next = stepList[(index + direction + stepList.length) % stepList.length];
    if (next !== undefined) setSelected(next);
  };

  return (
    <PresetContext value={preset}>
      <div className="min-h-screen bg-surface text-fg">
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold">LuminosiTS catalog</h1>
              <p className="mt-1 text-fg-muted">{plural(allAssets.length, "asset")}, typed and importable.</p>
            </div>
            <div role="group" aria-label="Look" className="flex items-center gap-1">
              <span className="mr-1 text-sm text-fg-muted">Look</span>
              {presets.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={preset.id === option.id}
                  onClick={() => {
                    setPreset(option);
                  }}
                  className={toggle}
                >
                  {option.name}
                </button>
              ))}
            </div>
          </header>

          <nav aria-label="Views" className="mt-6 flex gap-1">
            {views.map(([option, label]) => (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                onClick={() => {
                  setView(option);
                }}
                className={toggle}
              >
                {label}
              </button>
            ))}
          </nav>

          {view === "playground" ? (
            <Suspense fallback={<p className="mt-6 text-fg-muted">Loading the playground…</p>}>
              <Playground />
            </Suspense>
          ) : view === "growth" ? (
            <Growth assets={allAssets} onOpen={open} />
          ) : (
          <>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <search className="relative min-w-60 flex-1">
              <label htmlFor="asset-search" className="sr-only">
                Search assets
              </label>
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-fg-muted">
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
                className="w-full rounded-lg border border-line bg-transparent py-2 pl-10 pr-3 placeholder:text-fg-muted focus-visible:outline-2 focus-visible:outline-accent"
              />
            </search>

            <label className="flex items-center gap-2 text-sm text-fg-muted">
              <input
                type="checkbox"
                checked={newest}
                onChange={(event) => {
                  setNewest(event.target.checked);
                }}
                className="accent-accent"
              />
              Newest first
            </label>

            <div role="group" aria-label="Filter by kind" className="flex flex-wrap gap-1">
              {[["all", allAssets.length] as const, ...kinds].map(([value, count]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={kind === value}
                  onClick={() => {
                    setKind(value);
                  }}
                  className={toggle}
                >
                  {kindLabel(value)} <span className="tabular-nums">{count}</span>
                </button>
              ))}
            </div>
          </div>

          <p aria-live="polite" className="mt-4 text-sm text-fg-muted">
            {results.length === allAssets.length ? "" : plural(results.length, "result")}
          </p>

          {allAssets.length === 0 ? (
            <p className="mt-4 text-fg-muted">No assets yet. They appear here as packages register them.</p>
          ) : results.length === 0 ? (
            <p className="mt-4 text-fg-muted">Nothing matches “{text}”.</p>
          ) : (
            <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
              {results.map((meta) => (
                <li key={meta.id}>
                  <button
                    type="button"
                    onClick={(event) => {
                      open(meta, event.currentTarget);
                    }}
                    className="flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-xl border border-line p-3 text-center hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <AssetPreview meta={meta} size={meta.kind === "icon" ? 32 : 56} />
                    <span className="text-sm">{meta.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          </>
          )}
        </main>
        <DetailDialog meta={selected} onClose={close} onStep={step} position={index < 0 ? "" : `${String(index + 1)} / ${String(stepList.length)}`} />
      </div>
    </PresetContext>
  );
}
