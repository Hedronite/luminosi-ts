import type { AssetMeta } from "@hedronite/lts-core";
import { isScreenEffectId, screenEffectInfo, type ScreenEffectId } from "@hedronite/lts-postfx";
import type { ScenePalette } from "@hedronite/lts-tokens";
import { useMemo } from "react";
import { EffectStage } from "./EffectStage";
import { useStageEffects } from "./stageEffects";

/** The detail view for a screen effect: a framed solid under that one effect. */
export function EffectViewport({ meta, palette, paletteId }: { readonly meta: AssetMeta; readonly palette: ScenePalette; readonly paletteId: string }) {
  const id = meta.id;
  const ids = useMemo((): readonly ScreenEffectId[] => (isScreenEffectId(id) ? [id] : []), [id]);
  const effects = useStageEffects(ids);
  return <EffectStage effects={effects} palette={palette} paletteId={paletteId} label={`${meta.name}, a screen effect over a framed solid.${isScreenEffectId(id) && screenEffectInfo[id].interactive === true ? " Point at it to open the lens." : ""}`} />;
}
