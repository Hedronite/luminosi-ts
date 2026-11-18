import type { AssetMeta } from "@hedronite/lts-core";
import { ChevronLeft, ChevronRight, Close } from "@hedronite/lts-icons/react";
import { snippetsFor, type Snippet } from "@hedronite/lts-registry";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { AssetPreview } from "./AssetPreview";
import { CopyButton } from "./CopyButton";
import { usePreset } from "./look";

// three.js and React Three Fiber load only when a 3D asset is opened.
const Viewport = lazy(() => import("./Viewport").then((module) => ({ default: module.Viewport })));
const ShaderViewport = lazy(() => import("./ShaderViewport").then((module) => ({ default: module.ShaderViewport })));
const EffectViewport = lazy(() => import("./EffectViewport").then((module) => ({ default: module.EffectViewport })));

const has3d = (meta: AssetMeta): boolean => meta.kind !== "icon";

const iconButton =
  "rounded-md p-1.5 hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40";

interface DetailDialogProps {
  readonly meta: AssetMeta | undefined;
  readonly onClose: () => void;
  /** Moves to the previous (-1) or next (+1) asset in the current results. */
  readonly onStep: (direction: -1 | 1) => void;
  readonly position: string;
}

/** Details and copy-ready usage for one asset, in a native modal dialog. */
export function DetailDialog({ meta, onClose, onStep, position }: DetailDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const preset = usePreset();

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (meta !== undefined && !element.open) element.showModal();
    if (meta === undefined && element.open) element.close();
  }, [meta]);

  // The descriptors the snippets come from load when an asset is first opened, in a chunk of their own.
  const [loaded, setLoaded] = useState<{ readonly id: string; readonly snippets: readonly Snippet[]; readonly failed: boolean } | undefined>(undefined);
  useEffect(() => {
    if (meta === undefined) return;
    let current = true;
    snippetsFor(meta)
      .then((found) => {
        if (current) setLoaded({ id: meta.id, snippets: found, failed: false });
      })
      .catch(() => {
        if (current) setLoaded({ id: meta.id, snippets: [], failed: true });
      });
    return () => {
      current = false;
    };
  }, [meta]);
  const snippets = meta !== undefined && loaded?.id === meta.id ? loaded.snippets : [];
  const snippetsFailed = meta !== undefined && loaded?.id === meta.id && loaded.failed;

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="detail-title"
      className="m-auto w-[min(42rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-fg backdrop:bg-black/50"
    >
      {meta === undefined ? null : (
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="detail-title" className="text-xl font-semibold">
                {meta.name}
              </h2>
              <p className="mt-1 font-mono text-sm text-fg-muted">{meta.id}</p>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => { onStep(-1); }} aria-label="Previous asset" className={iconButton}>
                <ChevronLeft size={20} />
              </button>
              <span className="min-w-14 text-center text-sm text-fg-muted">{position}</span>
              <button type="button" onClick={() => { onStep(1); }} aria-label="Next asset" className={iconButton}>
                <ChevronRight size={20} />
              </button>
              <button type="button" onClick={onClose} aria-label="Close" className={iconButton}>
                <Close size={20} />
              </button>
            </div>
          </div>

          <div className="mt-6 grid place-items-center overflow-hidden rounded-lg border border-line bg-surface-raised">
            {has3d(meta) ? (
              <Suspense
                fallback={
                  <div className="grid h-72 place-items-center">
                    <AssetPreview meta={meta} size={160} />
                  </div>
                }
              >
                {meta.kind === "shader" ? (
                  <ShaderViewport meta={meta} palette={preset.scene} />
                ) : meta.kind === "effect" ? (
                  <EffectViewport meta={meta} palette={preset.scene} />
                ) : (
                  <Viewport meta={meta} palette={preset.scene} />
                )}
              </Suspense>
            ) : (
              <div className="py-10">
                <AssetPreview meta={meta} size={96} />
              </div>
            )}
          </div>

          <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-fg-muted">Kind</dt>
            <dd>{meta.kind}</dd>
            <dt className="text-fg-muted">Package</dt>
            <dd className="font-mono">{meta.package ?? "—"}</dd>
            <dt className="text-fg-muted">Version</dt>
            <dd>{meta.version}</dd>
            <dt className="text-fg-muted">Tags</dt>
            <dd>{meta.tags.length > 0 ? meta.tags.join(", ") : "—"}</dd>
            {meta.added === undefined ? null : (
              <>
                <dt className="text-fg-muted">Added</dt>
                <dd>{meta.added}</dd>
              </>
            )}
            {meta.origin === undefined ? null : (
              <>
                <dt className="text-fg-muted">Adopted from</dt>
                <dd>
                  <a href={`?view=open-source&set=${encodeURIComponent(meta.origin.vendor)}`} className="text-fg underline decoration-accent decoration-2 underline-offset-2">
                    {meta.origin.vendor}
                  </a>{" "}
                  <span className="break-all font-mono text-xs text-fg-muted">{meta.origin.path}</span>
                  {meta.origin.note === undefined ? null : <p className="mt-1 text-fg-muted">{meta.origin.note}</p>}
                </dd>
              </>
            )}
          </dl>

          {snippetsFailed ? (
            <p role="alert" className="mt-6 text-sm text-fg-muted">
              The usage snippets could not be loaded. Reload the page and open this asset again.
            </p>
          ) : null}

          {snippets.map((snippet) => (
            <section key={snippet.label} className="mt-6" aria-label={`${snippet.label} snippet`}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{snippet.label}</h3>
                <CopyButton text={snippet.code} what={`${snippet.label} snippet`} />
              </div>
              <pre className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-surface-raised p-3 text-xs">
                <code>{snippet.code}</code>
              </pre>
            </section>
          ))}
        </div>
      )}
    </dialog>
  );
}
