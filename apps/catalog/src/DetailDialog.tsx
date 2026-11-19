import type { AssetDescriptor, AssetMeta, Snippet } from "@hedronite/lts-core";
import { ChevronLeft, ChevronRight, Close, Icon } from "@hedronite/lts-icons/react";
import { loadDescriptors } from "@hedronite/lts-registry";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AssetPreview } from "./AssetPreview";
import { CopyButton } from "./CopyButton";
import { usePreset } from "./look";
import type * as paramFit from "./paramFit";
import { useParamsQuery, writeParamsText } from "./paramsAddress";
import { iconFor } from "./registry";

// three.js and React Three Fiber load only when a 3D asset is opened.
const Viewport = lazy(() => import("./Viewport").then((module) => ({ default: module.Viewport })));
const ShaderViewport = lazy(() => import("./ShaderViewport").then((module) => ({ default: module.ShaderViewport })));
const EffectViewport = lazy(() => import("./EffectViewport").then((module) => ({ default: module.EffectViewport })));
// The parameter panel loads only when the detail view of an asset with parameters opens.
const ParameterPanel = lazy(() => import("./ParameterPanel"));

const has3d = (meta: AssetMeta): boolean => meta.kind !== "icon";

const iconButton =
  "rounded-md p-1.5 hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40";

/** What a parameter that rebuilds the asset rebuilds, in words for the panel's notice. */
const nounFor = (meta: AssetMeta): string => (meta.kind === "shader" ? "shader" : meta.kind === "effect" ? "screen effect" : "asset");

/** An icon drawn with the parameters in force: its size, its stroke and its accessible name. Until they have loaded, the preview the gallery shows. */
function IconView({ meta, values }: { readonly meta: AssetMeta; readonly values: Readonly<Record<string, unknown>> | undefined }) {
  const icon = meta.kind === "icon" ? iconFor(meta.id) : undefined;
  if (icon === undefined || values === undefined) return <AssetPreview meta={meta} size={96} />;
  const { size, strokeWidth, title } = values;
  return <Icon icon={icon} size={typeof size === "number" ? size : 24} strokeWidth={typeof strokeWidth === "number" ? strokeWidth : 2} {...(typeof title === "string" ? { title } : {})} />;
}

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

  // The descriptor (its parameters, and the code that shows how to use the asset) loads when an asset is first opened, in a chunk of its own, with the code that fits an address to it.
  const [loaded, setLoaded] = useState<{ readonly id: string; readonly descriptor: AssetDescriptor | undefined; readonly fit: typeof paramFit | undefined } | undefined>(undefined);
  useEffect(() => {
    if (meta === undefined) return;
    let current = true;
    Promise.all([loadDescriptors(), import("./paramFit")])
      .then(([registry, fit]) => {
        if (current) setLoaded({ id: meta.id, descriptor: registry.get(meta.id), fit });
      })
      .catch(() => {
        if (current) setLoaded({ id: meta.id, descriptor: undefined, fit: undefined });
      });
    return () => {
      current = false;
    };
  }, [meta]);
  const ready = meta !== undefined && loaded?.id === meta.id ? loaded : undefined;
  const descriptor = ready?.descriptor;
  const fit = ready?.fit;
  const failed = ready !== undefined && (descriptor === undefined || fit === undefined);

  // The address's `params`, fitted to this asset: it is what the panel edits, and what the view, the icon and the snippets show.
  const query = useParamsQuery();
  const overrides = useMemo(() => (descriptor === undefined || fit === undefined ? undefined : fit.fitParams(descriptor, query)), [descriptor, fit, query]);
  const start = useMemo(() => (descriptor === undefined || fit === undefined ? undefined : fit.startValues(descriptor)), [descriptor, fit]);
  const values = useMemo(() => (start === undefined || overrides === undefined ? undefined : { ...start, ...overrides }), [start, overrides]);

  // A parameter with no default (a color that follows the look) cannot be written back live: when one is cleared, the view is built again.
  const [watch, setWatch] = useState<{ readonly overrides: typeof overrides; readonly epoch: number }>({ overrides: undefined, epoch: 0 });
  if (watch.overrides !== overrides) {
    const dropped = descriptor !== undefined && fit !== undefined && watch.overrides !== undefined && overrides !== undefined && fit.dropsUnset(descriptor, watch.overrides, overrides);
    setWatch({ overrides, epoch: dropped ? watch.epoch + 1 : watch.epoch });
  }

  // A parameter value belongs to the asset it was set on: another asset starts from its defaults, and a closed view leaves none in the address.
  const owner = useRef<string | undefined>(undefined);
  useEffect(() => {
    const id = meta?.id;
    if (owner.current !== undefined && owner.current !== id) writeParamsText("");
    owner.current = id;
  }, [meta?.id]);

  // The usage code for the parameters in force. Code whose template takes no parameters (a shader's) gets a snippet that lists them, so the code shows what the view shows.
  const snippets = useMemo((): readonly Snippet[] => {
    if (descriptor === undefined || fit === undefined || overrides === undefined) return [];
    const plain = descriptor.snippets();
    try {
      const own = descriptor.snippets(overrides);
      const extra = fit.changedParameters(overrides);
      return extra === undefined || JSON.stringify(own) !== JSON.stringify(plain) ? own : [...own, extra];
    } catch {
      return plain;
    }
  }, [descriptor, fit, overrides]);
  const snippetsFailed = failed;
  const hasParameters = descriptor !== undefined && descriptor.fields.length > 0;

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
                {values === undefined ? (
                  <div className="grid h-72 place-items-center">
                    <AssetPreview meta={meta} size={160} />
                  </div>
                ) : meta.kind === "shader" ? (
                  <ShaderViewport meta={meta} palette={preset.scene} params={values} epoch={watch.epoch} />
                ) : meta.kind === "effect" ? (
                  <EffectViewport meta={meta} palette={preset.scene} params={values} />
                ) : (
                  <Viewport meta={meta} palette={preset.scene} />
                )}
              </Suspense>
            ) : (
              <div className="grid min-h-48 place-items-center py-10">
                <IconView meta={meta} values={values} />
              </div>
            )}
          </div>

          {hasParameters && fit !== undefined && start !== undefined && overrides !== undefined ? (
            <Suspense fallback={null}>
              <ParameterPanel key={meta.id} described={descriptor} assetId={meta.id} noun={nounFor(meta)} overrides={overrides} start={start} />
            </Suspense>
          ) : null}

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
