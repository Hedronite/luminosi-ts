import type { AssetMeta } from "@hedronite/lts-core";
import { isScreenEffectId, screenEffectInfo, screenEffectSchemas, type ScreenEffectConfig, type ScreenEffectId } from "@hedronite/lts-postfx";
import type { ScenePalette } from "@hedronite/lts-tokens";
import { useMemo } from "react";
import { EffectStage } from "./EffectStage";
import { useStageEffects } from "./stageEffects";

/** Whether `value` is an effect as a stack takes it: its id with parameters that pass that effect's own schema. */
const isStackEntry = (value: { readonly id: ScreenEffectId; readonly params?: unknown }): value is ScreenEffectConfig => screenEffectSchemas[value.id].safeParse(value.params ?? {}).success;

/**
 * The detail view for a screen effect: a framed solid under that one effect. `params` is every parameter in force (the panel's
 * edits and the address's `?params=` over what the stage shows by default): a change of it writes the effect's uniforms in place,
 * and only the ASCII ramp builds the passes again. Parameters its schema does not take leave the stage as it was.
 */
export function EffectViewport({ meta, palette, params }: { readonly meta: AssetMeta; readonly palette: ScenePalette; readonly params: Readonly<Record<string, unknown>> }) {
  const id = meta.id;
  const ids = useMemo((): readonly ScreenEffectId[] => (isScreenEffectId(id) ? [id] : []), [id]);
  const staged = useStageEffects(ids);
  const effects = useMemo((): readonly ScreenEffectConfig[] => {
    if (!isScreenEffectId(id)) return staged;
    const own = { id, params };
    return isStackEntry(own) ? [own] : staged;
  }, [id, params, staged]);
  return <EffectStage effects={effects} palette={palette} label={`${meta.name}, a screen effect over a framed solid.${isScreenEffectId(id) && screenEffectInfo[id].interactive === true ? " Point at it to open the lens." : ""}`} />;
}
