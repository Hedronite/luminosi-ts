import type { AssetMeta } from "@hedronite/lts-core";
import { Icon } from "@hedronite/lts-icons/react";
import { iconFor } from "./registry";

/** A visual for any asset. Kinds without a renderer yet show their kind name. */
export function AssetPreview({ meta, size }: { readonly meta: AssetMeta; readonly size: number }) {
  const icon = meta.kind === "icon" ? iconFor(meta.id) : undefined;
  if (icon !== undefined) {
    // Keep the drawn stroke near 2–4 px at any preview size.
    return <Icon icon={icon} size={size} strokeWidth={Math.min(2, 72 / size)} />;
  }
  return (
    <span aria-hidden="true" className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
      {meta.kind}
    </span>
  );
}
