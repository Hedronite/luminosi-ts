import type { AssetMeta } from "@hedronite/lts-core";
import { iconPacks } from "@hedronite/lts-icons/packs";
import { ChevronLeft, ExternalLink } from "@hedronite/lts-icons/react";
import { useEffect, useState } from "react";
import { vendored } from "./generated/vendor";
import { vendorProvenance } from "./generated/vendorProvenance";
import { Markdown } from "./Markdown";
import { registry } from "./registry";
import { commitUrl, formatBytes, kindTitles, packFromSet, policyTitles, shortCommit, type VendorEntry, type VendorItem, type VendorKind, type VendorPage } from "./vendored";

const kinds: readonly VendorKind[] = ["icons", "components", "demos", "engines", "skills"];

const button =
  "inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
// Links read in the text color, marked by an accent underline or icon: accent text falls short of 4.5:1 in some looks.
const linkButton = `${button} text-fg`;

interface Place {
  readonly set?: string;
  readonly item?: string;
  readonly page?: string;
}

function initialPlace(): Place {
  const params = new URLSearchParams(window.location.search);
  const set = params.get("set");
  const item = params.get("item");
  const page = params.get("page");
  return { ...(set === null ? {} : { set }), ...(item === null ? {} : { item }), ...(page === null ? {} : { page }) };
}

type OpenAsset = (meta: AssetMeta, trigger: HTMLElement) => void;

/** Library assets ported from a vendored folder (or one item in it), by their origin. */
const adoptedFrom = (vendor: string, item?: string): readonly AssetMeta[] =>
  registry.list().filter((meta) => meta.origin?.vendor === vendor && (item === undefined || meta.origin.path.startsWith(`${item}/`)));

const packsOf = (entry: VendorEntry) => (entry.packPrefix === undefined ? [] : iconPacks.filter((pack) => packFromSet(pack.id, entry.packPrefix ?? "")));

/** The open-source material vendored into LuminosiTS, with each folder's license and credit. */
export function OpenSource({ onBrowsePack, onOpenAsset }: { readonly onBrowsePack: (packId: string) => void; readonly onOpenAsset: OpenAsset }) {
  const [place, setPlace] = useState<Place>(initialPlace);
  const entry = vendored.find((candidate) => candidate.id === place.set);
  const item = entry?.items.find((candidate) => candidate.id === place.item);
  const pages: readonly VendorPage[] = item?.pages ?? (entry?.readme === undefined ? [] : [entry.readme]);
  const page = place.page === undefined ? undefined : pages.find((candidate) => candidate.path === place.page);

  useEffect(() => {
    const url = new URL(window.location.href);
    for (const key of ["set", "item", "page"] as const) {
      const value = place[key];
      if (value === undefined) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    window.history.replaceState(null, "", url);
  }, [place]);

  const go = (next: Place): void => {
    setPlace(next);
    window.scrollTo({ top: 0 });
  };

  if (entry !== undefined && page !== undefined) {
    return <Reader entry={entry} item={item} pages={pages} page={page} go={go} />;
  }
  if (entry !== undefined) {
    return <Folder entry={entry} go={go} onBrowsePack={onBrowsePack} onOpenAsset={onOpenAsset} />;
  }

  return (
    <section aria-labelledby="open-source-title" className="mt-6">
      <h2 id="open-source-title" className="text-lg font-semibold">
        Open source
      </h2>
      <p className="mt-1 max-w-prose text-sm text-fg-muted">
        Open-source work by others, kept in LuminosiTS as published. None of it is LuminosiTS's own: each folder keeps its license, and its authors get the credit.
      </p>
      {kinds.map((kind) => {
        const group = vendored.filter((candidate) => candidate.kind === kind);
        if (group.length === 0) return null;
        return (
          <section key={kind} aria-labelledby={`kind-${kind}`} className="mt-6">
            <h3 id={`kind-${kind}`} className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
              {kindTitles[kind]}
            </h3>
            <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    onClick={() => {
                      go({ set: candidate.id });
                    }}
                    className="flex h-full w-full flex-col gap-2 overflow-hidden rounded-xl border border-line p-4 text-left hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {candidate.preview === undefined ? null : (
                      <img src={`${import.meta.env.BASE_URL}${candidate.preview}`} alt="" className="-mx-4 -mt-4 mb-1 aspect-video w-[calc(100%+2rem)] max-w-none object-cover" loading="lazy" />
                    )}
                    <span className="font-medium">{candidate.name}</span>
                    <span className="text-sm text-fg-muted">{candidate.what}</span>
                    <span className="mt-auto text-xs text-fg-muted">
                      {summary(candidate)} · by {candidate.credit}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </section>
  );
}

const itemWord = (entry: VendorEntry): string => (entry.kind === "skills" ? "skill" : entry.kind === "demos" ? "demo" : "item");

function summary(entry: VendorEntry): string {
  const packs = packsOf(entry);
  const count = packs.length > 0 ? `${String(packs.length)} pack${packs.length === 1 ? "" : "s"}` : entry.items.length > 0 ? `${String(entry.items.length)} ${itemWord(entry)}${entry.items.length === 1 ? "" : "s"}` : `${String(entry.files)} files`;
  return `${count} · ${shortLicense(entry.license)}`;
}

/** "MIT (`LICENSE`); fonts …" → "MIT". */
const shortLicense = (license: string): string => license.split(/[;(]/)[0]?.trim() ?? license;

function Back({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={button}>
      <ChevronLeft size={16} />
      {label}
    </button>
  );
}

function Folder({ entry, go, onBrowsePack, onOpenAsset }: { readonly entry: VendorEntry; readonly go: (place: Place) => void; readonly onBrowsePack: (packId: string) => void; readonly onOpenAsset: OpenAsset }) {
  const provenance = vendorProvenance[entry.id];
  const packs = packsOf(entry);
  const adopted = adoptedFrom(entry.id);
  return (
    <section aria-labelledby="folder-title" className="mt-6">
      <Back
        label="Open source"
        onClick={() => {
          go({});
        }}
      />
      <h2 id="folder-title" className="mt-4 text-xl font-semibold">
        {entry.name}
      </h2>
      <p className="mt-1 max-w-prose text-fg-muted">{entry.what}</p>
      {entry.preview === undefined ? null : <img src={`${import.meta.env.BASE_URL}${entry.preview}`} alt={`${entry.name} preview`} className="mt-4 w-full max-w-2xl rounded-xl border border-line" />}

      <dl data-testid="folder-credit" className="mt-4 grid max-w-2xl grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-fg-muted">Credit</dt>
        <dd>{entry.credit}</dd>
        <dt className="text-fg-muted">License</dt>
        <dd>{entry.license.replace(/`/g, "")}</dd>
        <dt className="text-fg-muted">Source</dt>
        <dd className="min-w-0 break-words">
          <a href={entry.sourceUrl} className="text-fg underline decoration-accent decoration-2 underline-offset-2" rel="noreferrer">
            {entry.source.replace(/`/g, "")}
          </a>
        </dd>
        <dt className="text-fg-muted">Pulled</dt>
        <dd>{entry.pulled}</dd>
        <dt className="text-fg-muted">Size</dt>
        <dd>
          {String(entry.files)} files, {formatBytes(entry.bytes)}
        </dd>
        {provenance === undefined ? null : (
          <>
            <dt className="text-fg-muted">License id</dt>
            <dd data-testid="folder-license-id">{provenance.license}</dd>
            <dt className="text-fg-muted">Policy</dt>
            <dd>
              <ul data-testid="folder-policies" className="flex flex-col gap-0.5">
                {provenance.policies.map((policy) => (
                  <li key={`${policy.class}:${policy.spdx}`}>
                    {policyTitles[policy.class]} · {policy.spdx}
                    {policy.files.length === 0 ? (
                      <span className="text-fg-muted"> (every path no other row names)</span>
                    ) : (
                      <span className="font-mono text-xs text-fg-muted"> ({policy.files.join(", ")})</span>
                    )}
                  </li>
                ))}
              </ul>
            </dd>
            <dt className="text-fg-muted">Sources</dt>
            <dd data-testid="folder-sources">
              {provenance.sources.length === 0 ? (
                <span>No repository: {provenance.keptReason ?? "the folder stays in the repo"}</span>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {provenance.sources.map((source) => (
                    <li key={source.repo} className="min-w-0 break-words">
                      <a href={commitUrl(source)} className="text-fg underline decoration-accent decoration-2 underline-offset-2" rel="noreferrer">
                        {source.repo.replace(/^https:\/\//, "")} at {shortCommit(source.commit)}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </dd>
            <dt className="text-fg-muted">Changes</dt>
            <dd data-testid="folder-transformations">
              {provenance.transformations.length === 0 ? (
                <span>None: the folder is upstream as published.</span>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {provenance.transformations.map((change) => (
                    <li key={`${change.kind}:${change.paths.join(",")}`}>
                      <span className="font-mono text-xs">{change.kind}</span> {change.paths.join(", ")} — {change.reason}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
            <dt className="text-fg-muted">Vendored</dt>
            <dd data-testid="folder-vendored">
              {provenance.fetched ? "Fetched by pin" : "Kept in the repo"}, {provenance.vendoredOn}, reviewed by {provenance.reviewer}
            </dd>
          </>
        )}
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        {entry.link === undefined ? null : (
          <a href={entry.link} className={linkButton} rel="noreferrer">
            Visit {new URL(entry.link).hostname} <ExternalLink size={16} />
          </a>
        )}
        {entry.readme === undefined ? null : (
          <button
            type="button"
            onClick={() => {
              go({ set: entry.id, ...(entry.readme === undefined ? {} : { page: entry.readme.path }) });
            }}
            className={button}
          >
            Read the README
          </button>
        )}
      </div>

      {packs.length === 0 ? null : (
        <section aria-labelledby="folder-packs" className="mt-6">
          <h3 id="folder-packs" className="font-semibold">
            Icon packs from this set
          </h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {packs.map((pack) => (
              <li key={pack.id}>
                <button
                  type="button"
                  onClick={() => {
                    onBrowsePack(pack.id);
                  }}
                  className={button}
                >
                  {pack.name} <span className="tabular-nums text-fg-muted">{String(pack.count)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {adopted.length === 0 ? null : (
        <section aria-labelledby="folder-adopted" className="mt-6">
          <h3 id="folder-adopted" className="font-semibold">
            In the library
          </h3>
          <p className="mt-1 text-sm text-fg-muted">Ported from this folder into LuminosiTS, rewritten to the library's rules and credited here.</p>
          <ul className="mt-2 grid gap-3 md:grid-cols-2">
            {adopted.map((meta) => (
              <li key={meta.id} className="flex flex-col gap-1.5 rounded-xl border border-line p-4">
                <button
                  type="button"
                  onClick={(event) => {
                    onOpenAsset(meta, event.currentTarget);
                  }}
                  className="self-start font-medium text-fg underline decoration-accent decoration-2 underline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {meta.name} <span className="font-normal text-fg-muted">({meta.kind})</span>
                </button>
                <span className="break-all font-mono text-xs text-fg-muted">from {meta.origin?.path}</span>
                {meta.origin?.commit === undefined ? null : (
                  <span className="break-all text-xs text-fg-muted">
                    at{" "}
                    <a
                      href={`${provenance?.sources.find((source) => source.commit === meta.origin?.commit)?.repo ?? entry.sourceUrl}/tree/${meta.origin.commit}`}
                      className="text-fg underline decoration-accent decoration-2 underline-offset-2"
                      rel="noreferrer"
                    >
                      {shortCommit(meta.origin.commit)}
                    </a>
                    {meta.origin.license === undefined ? null : ` · ${meta.origin.license}`}
                  </span>
                )}
                {meta.origin?.transformations === undefined ? null : (
                  <ul className="flex flex-col gap-0.5 text-sm text-fg-muted">
                    {meta.origin.transformations.map((change) => (
                      <li key={change}>{change}</li>
                    ))}
                  </ul>
                )}
                {meta.origin?.note === undefined ? null : <span className="text-sm text-fg-muted">{meta.origin.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {entry.items.length === 0 ? null : (
        <section aria-labelledby="folder-items" className="mt-6">
          <h3 id="folder-items" className="font-semibold">
            {entry.kind === "skills" ? "Skills" : entry.kind === "demos" ? "Demos" : "Read"}
          </h3>
          <ul className="mt-2 grid gap-3 md:grid-cols-2">
            {entry.items.map((candidate) => (
              <ItemCard key={candidate.id} entry={entry} item={candidate} go={go} />
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function ItemCard({ entry, item, go }: { readonly entry: VendorEntry; readonly item: VendorItem; readonly go: (place: Place) => void }) {
  const first = item.pages[0];
  const ported = adoptedFrom(entry.id, item.id);
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line p-4">
      <span className="font-medium">{item.name}</span>
      {ported.length === 0 ? null : <span className="text-xs text-fg-muted">In the library: {ported.map((meta) => meta.name).join(", ")}</span>}
      <span className="line-clamp-4 text-sm text-fg-muted" title={item.description}>{item.description}</span>
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        {first === undefined ? null : (
          <button
            type="button"
            onClick={() => {
              go({ set: entry.id, item: item.id, page: first.path });
            }}
            className={button}
            aria-label={`Read ${item.name}`}
          >
            Read{item.pages.length > 1 ? ` (${String(item.pages.length)} pages)` : ""}
          </button>
        )}
        {item.link === undefined ? null : (
          <a href={item.link} className={linkButton} rel="noreferrer" aria-label={`Open the ${item.name} demo on the author's site`}>
            Live demo <ExternalLink size={16} />
          </a>
        )}
      </div>
    </li>
  );
}

/** The page's Markdown without a leading `# Title` that repeats the heading above it. */
const withoutTitle = (page: VendorPage, markdown: string): string => {
  const match = /^#\s+(.+)\n?/.exec(markdown);
  return match?.[1]?.trim() === page.title ? markdown.slice(match[0].length) : markdown;
};

// Each folder's Markdown is its own module, loaded when one of its pages is opened.
const pageModules = import.meta.glob<{ readonly markdown: Readonly<Record<string, string>> }>("./generated/vendor-pages/*.ts");

/** A folder's Markdown by page path, once loaded; undefined while loading; an Error if it failed. */
function useFolderMarkdown(id: string): Readonly<Record<string, string>> | Error | undefined {
  const [loaded, setLoaded] = useState<{ readonly id: string; readonly value: Readonly<Record<string, string>> | Error } | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const load = pageModules[`./generated/vendor-pages/${id}.ts`];
    if (load === undefined) return undefined;
    load().then(
      (module) => {
        if (live) setLoaded({ id, value: module.markdown });
      },
      (error: unknown) => {
        if (live) setLoaded({ id, value: error instanceof Error ? error : new Error(String(error)) });
      },
    );
    return () => {
      live = false;
    };
  }, [id]);
  return loaded?.id === id ? loaded.value : undefined;
}

function Reader({
  entry,
  item,
  pages,
  page,
  go,
}: {
  readonly entry: VendorEntry;
  readonly item: VendorItem | undefined;
  readonly pages: readonly VendorPage[];
  readonly page: VendorPage;
  readonly go: (place: Place) => void;
}) {
  const at = (path: string): Place => ({ set: entry.id, ...(item === undefined ? {} : { item: item.id }), page: path });
  const folder = useFolderMarkdown(entry.id);
  const markdown = folder === undefined || folder instanceof Error ? undefined : folder[page.path];
  return (
    <article aria-labelledby="reader-title" className="mt-6">
      <Back
        label={entry.name}
        onClick={() => {
          go({ set: entry.id });
        }}
      />
      <p className="mt-4 text-sm text-fg-muted">
        {entry.name}
        {item === undefined ? "" : ` · ${item.name}`} · {entry.license.replace(/`/g, "")} · {entry.credit}
      </p>
      <h2 id="reader-title" className="mt-1 text-xl font-semibold">
        {page.title}
      </h2>
      {pages.length > 1 ? (
        <div className="mt-3 flex flex-col gap-1 text-sm text-fg-muted sm:max-w-sm">
          <label htmlFor="reader-page">Page</label>
          <select
            id="reader-page"
            value={page.path}
            onChange={(event) => {
              go(at(event.target.value));
            }}
            className="rounded-md border border-line bg-surface-raised px-2 py-1.5 text-fg focus-visible:outline-2 focus-visible:outline-accent"
          >
            {pages.map((candidate) => (
              <option key={candidate.path} value={candidate.path}>
                {candidate.title}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="mt-4 border-t border-line pt-4">
        {folder instanceof Error ? <p className="text-fg">Couldn't load this page: {folder.message}</p> : null}
        {folder === undefined ? <p className="text-fg-muted">Loading…</p> : null}
        {markdown === undefined ? null : (
        <Markdown
          markdown={withoutTitle(page, markdown)}
          path={page.path}
          repo={entry.repo}
          pages={pages.map((candidate) => candidate.path)}
          onPage={(path) => {
            go(at(path));
          }}
        />
        )}
      </div>
    </article>
  );
}
