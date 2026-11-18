import type { EffectClock } from "@hedronite/lts-shaders/three";
import { useState } from "react";
import { uniform } from "three/tsl";

/**
 * One time uniform for a stage's surface shaders to read, in seconds, and the function that writes it. Hand `write` to
 * `StageClock` (as `writeShaderTime`) so a held stage's shaders hold still. The uniform comes from three's `uniform`,
 * not `createEffectClock`, so a stage does not load the shader builders just to own a clock.
 */
export function useShaderClock(): { readonly clock: EffectClock; readonly write: (seconds: number) => void } {
  const [held] = useState(() => {
    const clock = uniform(0);
    return {
      clock,
      write: (seconds: number): void => {
        clock.value = seconds;
      },
    };
  });
  return held;
}
