import type { EffectClock } from "@hedronite/lts-shaders/three";
import { createContext, type ReactNode } from "react";

/** The clock the surface shaders under it read time from; none means three's wall clock. */
export const EffectClockContext = createContext<EffectClock | undefined>(undefined);

/**
 * Gives every surface shader beneath it one clock to read time from, in place of three's wall clock. A stage that
 * pauses owns a clock, writes seconds to its `value` while it runs and leaves it alone while it is held, and
 * its shaders hold still with it. Make one with `createEffectClock` from `@hedronite/lts-shaders/three`. Swapping
 * the clock rebuilds the shaders under it.
 */
export function EffectClockProvider({ clock, children }: { readonly clock: EffectClock; readonly children: ReactNode }) {
  return <EffectClockContext value={clock}>{children}</EffectClockContext>;
}
