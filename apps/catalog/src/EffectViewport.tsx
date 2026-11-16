import type { AssetMeta } from "@hedronite/lts-core";
import { isScreenEffectId, type ScreenEffectConfig } from "@hedronite/lts-postfx";
import type { ScenePalette } from "@hedronite/lts-tokens";
import { useMemo } from "react";
import { EffectStage } from "./EffectStage";

/** The detail view for a screen effect: a framed solid under that one effect. */
export function EffectViewport({ meta, palette, paletteId }: { readonly meta: AssetMeta; readonly palette: ScenePalette; readonly paletteId: string }) {
  const id = meta.id;
  // The scan sweeps every 3 s here instead of 9, so a visitor sees it soon.
  const effects = useMemo((): readonly ScreenEffectConfig[] => (isScreenEffectId(id) ? [id === "scan" ? { id, params: { period: 3 } } : { id }] : []), [id]);
  return <EffectStage effects={effects} palette={palette} paletteId={paletteId} label={`${meta.name}, a screen effect over a framed solid.${id === "lens" ? " Point at it to open the lens." : ""}`} />;
}
