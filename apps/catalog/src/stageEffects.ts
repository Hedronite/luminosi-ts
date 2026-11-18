import type { DescriptorRegistry } from "@hedronite/lts-core";
import { screenEffectSchemas, type ScreenEffectConfig, type ScreenEffectId } from "@hedronite/lts-postfx";
import { loadDescriptors } from "@hedronite/lts-registry";
import { useEffect, useMemo, useState } from "react";

/** Whether `value` is an effect as a stack takes it: its id with parameters that pass that effect's own schema. */
const isStackEntry = (value: { readonly id: ScreenEffectId; readonly params?: unknown }): value is ScreenEffectConfig => screenEffectSchemas[value.id].safeParse(value.params ?? {}).success;

/** One effect as a stack takes it: with the parameters its descriptor's preview names for a stage, or with none. */
function entry(id: ScreenEffectId, stage: Readonly<Record<string, unknown>> | undefined): ScreenEffectConfig {
  const shown = stage === undefined ? { id } : { id, params: stage };
  return isStackEntry(shown) ? shown : { id };
}

/**
 * The stack that puts these effects on show, each with the parameters its descriptor's `preview` gives a stage (the scan
 * sweeps every few seconds, so it comes round while someone looks). The descriptors load on first use: until they have, the
 * effects run with their defaults, and the stack updates in place when they arrive.
 */
export function useStageEffects(ids: readonly ScreenEffectId[]): readonly ScreenEffectConfig[] {
  const [registry, setRegistry] = useState<DescriptorRegistry | undefined>(undefined);
  useEffect(() => {
    let current = true;
    loadDescriptors().then(
      (loaded) => {
        if (current) setRegistry(loaded);
      },
      () => undefined, // the stage that builds from the same descriptors reports the failure
    );
    return () => {
      current = false;
    };
  }, []);
  return useMemo(() => ids.map((id) => entry(id, registry?.get(id)?.preview?.stage)), [ids, registry]);
}
