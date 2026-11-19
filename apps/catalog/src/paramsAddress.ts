import { useSyncExternalStore } from "react";

/** Fired on `window` when this page rewrites the address's `params` itself: `replaceState` makes no `popstate`. */
const CHANGED = "lts-params";

const listen = (notify: () => void): (() => void) => {
  window.addEventListener("popstate", notify);
  window.addEventListener(CHANGED, notify);
  return () => {
    window.removeEventListener("popstate", notify);
    window.removeEventListener(CHANGED, notify);
  };
};

/** The page's `params` query value, live: it changes when the address does (back and forward, a script that pushes a new one and fires `popstate`, or an edit in the panel). */
export function useParamsQuery(): string {
  return useSyncExternalStore(listen, () => new URLSearchParams(window.location.search).get("params") ?? "");
}

/** Puts `text` in the address as the `params` value, or takes the value out for an empty one, with `replaceState`: an edit adds no history entry. */
export function writeParamsText(text: string): void {
  const url = new URL(window.location.href);
  if (text === "") url.searchParams.delete("params");
  else url.searchParams.set("params", text);
  if (url.href === window.location.href) return;
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new Event(CHANGED));
}
