import type { AssetMeta } from "@hedronite/lts-core";
import { Icon } from "@hedronite/lts-icons/react";
import { isMaterialId } from "@hedronite/lts-materials";
import { iconFor, shapeFor } from "./registry";
import { Swatch } from "./Swatch";
import { Wireframe } from "./Wireframe";

/** A static visual for any asset. Kinds without a renderer yet show their kind name. */
export function AssetPreview({ meta, size }: { readonly meta: AssetMeta; readonly size: number }) {
  const icon = meta.kind === "icon" ? iconFor(meta.id) : undefined;
  if (icon !== undefined) {
    // Keep the drawn stroke near 2–4 px at any preview size.
    return <Icon icon={icon} size={size} strokeWidth={Math.min(2, 72 / size)} />;
  }
  const shape = meta.kind === "primitive" || meta.kind === "object" ? shapeFor(meta.id) : undefined;
  if (shape !== undefined) {
    return <Wireframe shape={shape} size={size} />;
  }
  if (meta.kind === "material" && isMaterialId(meta.id)) {
    return <Swatch id={meta.id} size={size} />;
  }
  return (
    <span aria-hidden="true" className="text-xs uppercase tracking-wide text-fg-muted">
      {meta.kind}
    </span>
  );
}
