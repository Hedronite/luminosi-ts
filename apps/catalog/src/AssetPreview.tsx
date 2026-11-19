import type { AssetMeta } from "@hedronite/lts-core";
import { Icon } from "@hedronite/lts-icons/react";
import { isMaterialId } from "@hedronite/lts-materials";
import { isSceneKitId } from "@hedronite/lts-scenes";
import { useState } from "react";
import { SceneThumb } from "./SceneThumb";
import { iconFor, shapeFor } from "./registry";
import { Swatch } from "./Swatch";
import { Wireframe } from "./Wireframe";

/** Set at build (vite.config.ts) from the poster files, so a poster that changed is fetched again. */
declare const __POSTERS_VERSION__: string;

/**
 * The kinds with a poster: everything drawn in 3D (icons are drawn as vectors). The same list `validate` checks posters for
 * (tools/assets/src/posters.ts), where the build requires a poster for each; here it only decides which tiles ask for one.
 */
const posterKinds: ReadonlySet<string> = new Set(["primitive", "material", "object", "shader", "effect", "scene"]);

/** What a 3D asset shows before there is a poster for it: a stand-in shape, or its kind name where it has none. */
function StandIn({ meta, size }: { readonly meta: AssetMeta; readonly size: number }) {
  const shape = meta.kind === "primitive" || meta.kind === "object" ? shapeFor(meta.id, meta.kind) : undefined;
  if (shape !== undefined) {
    return <Wireframe shape={shape} size={size} />;
  }
  if (meta.kind === "material" && isMaterialId(meta.id)) {
    return <Swatch id={meta.id} size={size} />;
  }
  const kit = meta.id.replace(/^scene-/, "");
  if (meta.kind === "scene" && isSceneKitId(kit)) {
    return <SceneThumb id={kit} size={size} />;
  }
  return (
    <span aria-hidden="true" className="text-xs uppercase tracking-wide text-fg-muted">
      {meta.kind}
    </span>
  );
}

/**
 * The still the rig made for a 3D asset, drawn at `size` CSS pixels from a file twice that. It is the tile's picture and loads when
 * the tile nears the screen; its size is on the element, so nothing moves when it arrives. Served under its asset's own name
 * (vite.config.ts), so the gallery carries no list of them; one that does not load (an asset whose poster is not made yet) gives way to the stand-in.
 */
function Poster({ meta, size }: { readonly meta: AssetMeta; readonly size: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <StandIn meta={meta} size={size} />;
  return (
    <img
      src={`/posters/${meta.id}.webp?v=${__POSTERS_VERSION__}`}
      width={size}
      height={size}
      alt={`${meta.name} preview`}
      loading="lazy"
      decoding="async"
      onError={() => {
        setFailed(true);
      }}
      className="shrink-0 rounded-md"
    />
  );
}

/** A static visual for any asset: an icon is drawn, and a 3D asset shows its poster. */
export function AssetPreview({ meta, size }: { readonly meta: AssetMeta; readonly size: number }) {
  const icon = meta.kind === "icon" ? iconFor(meta.id) : undefined;
  if (icon !== undefined) {
    // Keep the drawn stroke near 2–4 px at any preview size.
    return <Icon icon={icon} size={size} strokeWidth={Math.min(2, 72 / size)} />;
  }
  return posterKinds.has(meta.kind) ? <Poster meta={meta} size={size} /> : <StandIn meta={meta} size={size} />;
}
