import type { AssetMeta } from "@hedronite/lts-core";
import { Close } from "@hedronite/lts-icons/react";
import { useEffect, useRef } from "react";
import { AssetPreview } from "./AssetPreview";
import { CopyButton } from "./CopyButton";
import { iconFor } from "./registry";
import { snippetsFor } from "./snippets";

/** Details and copy-ready usage for one asset, in a native modal dialog. */
export function DetailDialog({ meta, onClose }: { readonly meta: AssetMeta | undefined; readonly onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (meta !== undefined && !element.open) element.showModal();
    if (meta === undefined && element.open) element.close();
  }, [meta]);

  const snippets = meta === undefined ? [] : snippetsFor(meta, iconFor(meta.id));

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="detail-title"
      className="m-auto w-[min(42rem,calc(100vw-2rem))] rounded-xl border border-neutral-200 bg-white p-0 text-neutral-900 backdrop:bg-black/50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100"
    >
      {meta === undefined ? null : (
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="detail-title" className="text-xl font-semibold">
                {meta.name}
              </h2>
              <p className="mt-1 font-mono text-sm text-neutral-600 dark:text-neutral-400">{meta.id}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1.5 hover:bg-neutral-100 focus-visible:outline-2 dark:hover:bg-neutral-800"
            >
              <Close size={20} />
            </button>
          </div>

          <div className="mt-6 grid place-items-center rounded-lg border border-neutral-200 py-10 dark:border-neutral-800">
            <AssetPreview meta={meta} size={96} />
          </div>

          <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-neutral-600 dark:text-neutral-400">Kind</dt>
            <dd>{meta.kind}</dd>
            <dt className="text-neutral-600 dark:text-neutral-400">Package</dt>
            <dd className="font-mono">{meta.package ?? "—"}</dd>
            <dt className="text-neutral-600 dark:text-neutral-400">Version</dt>
            <dd>{meta.version}</dd>
            <dt className="text-neutral-600 dark:text-neutral-400">Tags</dt>
            <dd>{meta.tags.length > 0 ? meta.tags.join(", ") : "—"}</dd>
            {meta.added === undefined ? null : (
              <>
                <dt className="text-neutral-600 dark:text-neutral-400">Added</dt>
                <dd>{meta.added}</dd>
              </>
            )}
          </dl>

          {snippets.map((snippet) => (
            <section key={snippet.label} className="mt-6" aria-label={`${snippet.label} snippet`}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{snippet.label}</h3>
                <CopyButton text={snippet.code} what={`${snippet.label} snippet`} />
              </div>
              <pre className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-neutral-100 p-3 text-xs dark:bg-neutral-900">
                <code>{snippet.code}</code>
              </pre>
            </section>
          ))}
        </div>
      )}
    </dialog>
  );
}
