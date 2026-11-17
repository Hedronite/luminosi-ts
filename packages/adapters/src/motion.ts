import { useSyncExternalStore } from "react";

const query = "(prefers-reduced-motion: reduce)";

const subscribe = (change: () => void): (() => void) => {
  const list = window.matchMedia(query);
  list.addEventListener("change", change);
  return () => {
    list.removeEventListener("change", change);
  };
};

/**
 * Whether the viewer asked for reduced motion; follows the setting while the page is open. False on
 * the server and before hydration. `ScreenEffectsPass` uses it when you do not pass `reducedMotion`.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
