import { iconPacks } from "@hedronite/lts-icons/packs";
import { ChevronLeft, ExternalLink } from "@hedronite/lts-icons/react";
import { useEffect, useState } from "react";
import { vendored } from "./generated/vendor";
import { Markdown } from "./Markdown";
import { formatBytes, kindTitles, packFromSet, type VendorEntry, type VendorItem, type VendorKind, type VendorPage } from "./vendored";

const kinds: readonly VendorKind[] = ["icons", "components", "demos", "skills"];

const button =
  "inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const linkButton = `${button} text-accent`;

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

const packsOf = (entry: VendorEntry) => (entry.packPrefix === undefined ? [] : iconPacks.filter((pack) => packFromSet(pack.id, entry.packPrefix ?? "")));

/** The open-source material vendored into LuminosiTS, with each folder's license and credit. */
export function OpenSource({ onBrowsePack }: { readonly onBrowsePack: (packId: string) => void }) {
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
    return <Folder entry={entry} go={go} onBrowsePack={onBrowsePack} />;
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

function summary(entry: VendorEntry): string {
  const packs = packsOf(entry);
  const count = packs.length > 0 ? `${String(packs.length)} pack${packs.length === 1 ? "" : "s"}` : entry.items.length > 0 ? `${String(entry.items.length)} ${entry.kind === "skills" ? "skill" : "demo"}${entry.items.length === 1 ? "" : "s"}` : `${String(entry.files)} files`;
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

function Folder({ entry, go, onBrowsePack }: { readonly entry: VendorEntry; readonly go: (place: Place) => void; readonly onBrowsePack: (packId: string) => void }) {
  const packs = packsOf(entry);
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
          <a href={entry.sourceUrl} className="text-accent underline underline-offset-2" rel="noreferrer">
            {entry.source.replace(/`/g, "")}
          </a>
        </dd>
        <dt className="text-fg-muted">Pulled</dt>
        <dd>{entry.pulled}</dd>
        <dt className="text-fg-muted">Size</dt>
        <dd>
          {String(entry.files)} files, {formatBytes(entry.bytes)}
        </dd>
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

      {entry.items.length === 0 ? null : (
        <section aria-labelledby="folder-items" className="mt-6">
          <h3 id="folder-items" className="font-semibold">
            {entry.kind === "skills" ? "Skills" : "Demos"}
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
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line p-4">
      <span className="font-medium">{item.name}</span>
      <span className="line-clamp-4 text-sm text-fg-muted">{item.description}</span>
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
const withoutTitle = (page: VendorPage): string => {
  const match = /^#\s+(.+)\n?/.exec(page.markdown);
  return match?.[1]?.trim() === page.title ? page.markdown.slice(match[0].length) : page.markdown;
};

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
        <Markdown
          markdown={withoutTitle(page)}
          path={page.path}
          repo={entry.repo}
          pages={pages.map((candidate) => candidate.path)}
          onPage={(path) => {
            go(at(path));
          }}
        />
      </div>
    </article>
  );
}
