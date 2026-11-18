import { useSyncExternalStore } from "react";

/** The page's `params` query value, live: it changes when the address does (back and forward, or a script that pushes a new one and fires `popstate`). */
export function useParamsQuery(): string {
  return useSyncExternalStore(
    (listen) => {
      window.addEventListener("popstate", listen);
      return () => {
        window.removeEventListener("popstate", listen);
      };
    },
    () => new URLSearchParams(window.location.search).get("params") ?? "",
  );
}

/** A value from a pair: a number when it reads as one, else the text (a color such as "%23ff8800" arrives decoded as "#ff8800"). */
const valueOf = (text: string): number | string => (text.trim() !== "" && Number.isFinite(Number(text)) ? Number(text) : text);

/**
 * Reads a `params` value into parameters: a JSON object (`{"density":80}`), or pairs joined by commas (`density=80,speed=3`).
 * Nothing comes back for an empty or unreadable value. The shader's schema is what judges the values: `set` refuses a name
 * or a value it does not take.
 */
export function shaderParams(text: string): Readonly<Record<string, unknown>> | undefined {
  const read = ((): unknown => {
    if (text.trim().startsWith("{")) {
      try {
        return JSON.parse(text);
      } catch {
        return undefined;
      }
    }
    const pairs = text.split(",").map((pair): [string, string] => [pair.slice(0, Math.max(pair.indexOf("="), 0)).trim(), pair.slice(pair.indexOf("=") + 1)]);
    return Object.fromEntries(pairs.filter(([name]) => name !== "").map(([name, value]) => [name, valueOf(value)]));
  })();
  if (typeof read !== "object" || read === null || Array.isArray(read)) return undefined;
  const entries = Object.entries(read);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}
