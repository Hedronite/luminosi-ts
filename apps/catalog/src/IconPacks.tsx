import { iconToSvg, packIconToSvg, type IconPackInfo, type PackIcon as PackIconData } from "@hedronite/lts-icons";
import { allIcons } from "@hedronite/lts-icons/manifest";
import { iconPacks, loadIconPack } from "@hedronite/lts-icons/packs";
import { PackIcon } from "@hedronite/lts-icons/react";
import { useEffect, useMemo, useState } from "react";
import { CopyButton } from "./CopyButton";

interface Loaded {
  readonly pack: IconPackInfo;
  readonly icons: readonly PackIconData[];
}

/** LuminosiTS's own icons, shown as a pack beside the open-source ones. */
const CORE = "core";
const corePack: IconPackInfo = {
  id: CORE,
  name: "LuminosiTS core",
  description: "LuminosiTS's own icons: one 24-unit grid, one 2-unit round stroke.",
  count: allIcons.length,
  license: "MIT OR Apache-2.0",
  credit: "LuminosiTS",
  source: "https://github.com/Hedronite/luminosi-ts",
};
const pascal = (camel: string): string => camel.replace(/^./, (c) => c.toUpperCase());
const camel = (id: string): string => id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const coreIcons: readonly PackIconData[] = allIcons.map((icon) => ({
  id: icon.id,
  name: icon.name,
  importName: camel(icon.id),
  viewBox: "0 0 24 24",
  paint: { fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" },
  paths: icon.paths.map((d) => ({ d })),
}));
const coreById = new Map(allIcons.map((icon) => [icon.id, icon]));
const coreLoaded: Loaded = { pack: corePack, icons: coreIcons };
const allPacks: readonly IconPackInfo[] = [corePack, ...iconPacks];

const initialPack = (): string => {
  const id = new URLSearchParams(window.location.search).get("pack");
  return allPacks.some((pack) => pack.id === id) ? (id ?? CORE) : CORE;
};

const svgOf = (packId: string, icon: PackIconData): string => {
  const core = packId === CORE ? coreById.get(icon.id) : undefined;
  return core === undefined ? packIconToSvg(icon, { title: icon.name }) : iconToSvg(core, { title: icon.name });
};

const snippetOf = (packId: string, icon: PackIconData): string =>
  packId === CORE
    ? `import { ${pascal(icon.importName)} } from "@hedronite/lts-icons/react";\n\n<${pascal(icon.importName)} title="${icon.name}" />`
    : `import { ${icon.importName} } from "@hedronite/lts-icons/packs/${packId}";\nimport { PackIcon } from "@hedronite/lts-icons/react";\n\n<PackIcon icon={${icon.importName}} title="${icon.name}" />`;

/** Our own icons and other people's open-source sets: pick a pack, search it, copy an icon. Packs load on demand. */
export function IconPacks({ startPack }: { readonly startPack?: string | undefined }) {
  const [packId, setPackId] = useState(() => (startPack !== undefined && allPacks.some((pack) => pack.id === startPack) ? startPack : initialPack()));
  // Keyed by pack id, so switching packs shows "Loading…" without resetting state in the effect.
  const [result, setResult] = useState<{ readonly id: string; readonly loaded?: Loaded; readonly failed?: string } | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PackIconData | undefined>(undefined);
  const info = allPacks.find((pack) => pack.id === packId);
  const loaded = packId === CORE ? coreLoaded : result?.id === packId ? result.loaded : undefined;
  const failed = result?.id === packId ? result.failed : undefined;

  useEffect(() => {
    let live = true;
    const url = new URL(window.location.href);
    url.searchParams.set("pack", packId);
    window.history.replaceState(null, "", url);
    const load = loadIconPack[packId];
    if (load === undefined) return undefined;
    load().then(
      (module) => {
        if (live) setResult({ id: packId, loaded: module });
      },
      (error: unknown) => {
        if (live) setResult({ id: packId, failed: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [packId]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (loaded === undefined) return [];
    return q === "" ? loaded.icons : loaded.icons.filter((icon) => icon.id.includes(q) || icon.name.toLowerCase().includes(q));
  }, [loaded, query]);

  return (
    <section aria-labelledby="packs-title" className="mt-6">
      <h2 id="packs-title" className="text-lg font-semibold">
        Icons
      </h2>
      <p className="mt-1 max-w-prose text-sm text-fg-muted">
        LuminosiTS's own icons, and open-source sets by others converted to LuminosiTS data. Each open-source pack keeps its own license; credit its authors when you use it.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 text-sm text-fg-muted">
          <label htmlFor="pack-select">Pack</label>
          <select
            id="pack-select"
            value={packId}
            onChange={(event) => {
              setPackId(event.target.value);
              setQuery("");
              setSelected(undefined);
            }}
            className="rounded-md border border-line bg-surface-raised px-2 py-1.5 text-fg focus-visible:outline-2 focus-visible:outline-accent"
          >
            <optgroup label="LuminosiTS">
              <option value={CORE}>
                {corePack.name} ({String(corePack.count)})
              </option>
            </optgroup>
            <optgroup label="Open source">
              {iconPacks.map((pack) => (
                <option key={pack.id} value={pack.id}>
                  {pack.name} ({String(pack.count)})
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <div className="flex min-w-0 basis-60 flex-1 flex-col gap-1 text-sm text-fg-muted">
          <label htmlFor="pack-search">Search this pack</label>
          <input
            id="pack-search"
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="arrow, cart, cloud…"
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-fg placeholder:text-fg-muted focus-visible:outline-2 focus-visible:outline-accent"
          />
        </div>
      </div>

      {info === undefined ? null : (
        <p className="mt-3 max-w-prose text-sm" data-testid="pack-credit">
          <span className="font-medium">{info.name}</span> · {info.description} · License <span className="font-medium">{info.license}</span> · Credit: {info.credit} ·{" "}
          <a href={info.source} className="text-accent-text underline decoration-accent decoration-2 underline-offset-2">
            source
          </a>
        </p>
      )}

      {failed === undefined ? null : <p className="mt-4 text-fg">Couldn't load this pack: {failed}</p>}
      {loaded === undefined && failed === undefined ? <p className="mt-4 text-fg-muted">Loading…</p> : null}

      {loaded === undefined ? null : (
        <>
          <p className="mt-4 text-sm text-fg-muted" aria-live="polite">
            {shown.length === loaded.icons.length ? `${String(loaded.icons.length)} icons` : `${String(shown.length)} of ${String(loaded.icons.length)} icons`}
          </p>
          <ul aria-label={`${loaded.pack.name} icons`} className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2">
            {shown.map((icon) => (
              <li key={icon.id} className="[content-visibility:auto] [contain-intrinsic-size:auto_5.5rem]">
                <button
                  type="button"
                  aria-pressed={selected?.id === icon.id}
                  onClick={() => {
                    setSelected(icon);
                  }}
                  className="flex h-full w-full flex-col items-center gap-2 rounded-lg border border-line px-2 py-3 text-xs hover:bg-surface-raised aria-pressed:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <PackIcon icon={icon} size={28} />
                  <span className="w-full truncate text-center" title={icon.name}>{icon.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {selected === undefined || loaded === undefined ? null : (
        <aside aria-label={`${selected.name}, from ${loaded.pack.name}`} className="sticky bottom-4 mt-6 rounded-xl border border-line bg-surface-raised p-4 shadow-lg">
          <div className="flex flex-wrap items-center gap-4">
            <PackIcon icon={selected} size={56} title={selected.name} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{selected.name}</p>
              <p className="text-sm text-fg-muted">
                <code>{selected.id}</code> · {loaded.pack.name} · {loaded.pack.license} · {loaded.pack.credit}
              </p>
            </div>
            <CopyButton text={svgOf(loaded.pack.id, selected)} what={`SVG of ${selected.name}`} />
          </div>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-surface p-3 text-sm">
            <code>{snippetOf(loaded.pack.id, selected)}</code>
          </pre>
        </aside>
      )}
    </section>
  );
}
