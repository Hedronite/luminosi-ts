import type { EffectId, EffectParams } from "@hedronite/lts-shaders";
import type { EffectClock, EffectHandle } from "@hedronite/lts-shaders/three";
import type { ScenePalette } from "@hedronite/lts-tokens";
import { useThree } from "@react-three/fiber";
import { useContext, useEffect, useRef, useState } from "react";
import type { Material } from "three";
import { EffectClockContext } from "./effectClock.js";

/** A surface shader's parameters on a component: any parameter of the shader, by name. A missing one takes its default. */
export type ShaderParams = EffectParams<EffectId>;

interface Built {
  readonly shader: EffectId;
  readonly palette: ScenePalette;
  readonly clock: EffectClock | undefined;
  readonly generation: number;
  readonly effect: EffectHandle;
}

/**
 * The surface shader's material, built when it is needed and freed when it changes or the component
 * unmounts. The shader code loads on demand (a dynamic import), so a page that never asks for one
 * never downloads three's WebGPU build. Undefined until it is ready, and whenever `shader` is
 * undefined.
 *
 * `params` moves the shader live: a change writes its uniforms in place, with no new material. Only a
 * structural parameter (a toon shader's `bands`, whether a dissolve has a fixed `progress`) builds it again.
 */
export function useEffectMaterial(shader: EffectId | undefined, palette: ScenePalette, params?: ShaderParams): Material | undefined {
  const invalidate = useThree((state) => state.invalidate);
  const clock = useContext(EffectClockContext);
  const [built, setBuilt] = useState<Built | undefined>(undefined);
  // Bumped when `set` says a parameter is baked in, so the shader is built again with the current ones.
  const [generation, setGeneration] = useState(0);
  // The parameters as text, so a new object literal with the same values writes nothing.
  const key = JSON.stringify(params ?? {});
  const latest = useRef(params);
  // Declared before the effects that read it, so they see this render's parameters.
  useEffect(() => {
    latest.current = params;
  });
  useEffect(() => {
    if (shader === undefined) return undefined;
    let cancelled = false;
    let made: EffectHandle | undefined;
    import("@hedronite/lts-shaders/three").then(
      ({ createEffect }) => {
        if (cancelled) return;
        made = createEffect(shader, latest.current ?? {}, palette, clock === undefined ? {} : { clock });
        setBuilt({ shader, palette, clock, generation, effect: made });
        invalidate();
      },
      (error: unknown) => {
        if (!cancelled) console.error(`could not load the ${shader} shader`, error);
      },
    );
    return () => {
      cancelled = true;
      made?.dispose();
    };
  }, [shader, palette, clock, generation, invalidate]);
  // A material built for an earlier shader, palette or clock is never shown for the current one.
  const current = built !== undefined && built.shader === shader && built.palette === palette && built.clock === clock && built.generation === generation ? built : undefined;
  useEffect(() => {
    if (current === undefined) return;
    try {
      if (current.effect.set(latest.current ?? {})) invalidate();
      else setGeneration((previous) => previous + 1);
    } catch (error) {
      // A value the shader's schema refuses leaves it as it was: a bad prop does not take the scene down.
      console.error(`the ${current.shader} shader refused its parameters`, error);
    }
  }, [current, key, invalidate]);
  return current?.effect.material;
}
