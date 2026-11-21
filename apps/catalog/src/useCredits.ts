import type { Credit } from "@hedronite/lts-core";
import type { Scene } from "@hedronite/lts-scene";
import { useEffect, useState } from "react";

/** The credit data is loading, could not be loaded, or is here with the function that reads a scene's credits from it. */
export type CreditsState =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "ready"; readonly creditsOf: (scene: Scene) => readonly Credit[] };

/**
 * Loads the credit tables (a chunk of their own, so the 3D bundle does not carry them) when the code view mounts. The code that carries credits
 * is not shown until they are here: code shown before then would leave out what it owes, and a copy of it would too.
 */
export function useCredits(): CreditsState {
  const [state, setState] = useState<CreditsState>({ status: "loading" });
  useEffect(() => {
    let current = true;
    import("./credits").then(
      ({ creditsOf }) => {
        if (current) setState({ status: "ready", creditsOf });
      },
      () => {
        if (current) setState({ status: "failed" });
      },
    );
    return () => {
      current = false;
    };
  }, []);
  return state;
}
