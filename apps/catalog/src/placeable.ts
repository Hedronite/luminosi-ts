import { loadDescriptors } from "@hedronite/lts-registry";
import { useEffect, useState } from "react";

/** An object the playground and the Effects stage can place, as its descriptor describes it. */
export interface Placeable {
  readonly id: string;
  readonly name: string;
  /** Whether its descriptor takes a `material`, so the playground offers one. */
  readonly takesMaterial: boolean;
}

/**
 * Every object that can stand on a stage: the objects whose parameters all have defaults and need no source. An
 * object that takes a model `url` (the glTF) is not placeable here. The descriptors load on the first call.
 */
export async function loadPlaceable(): Promise<readonly Placeable[]> {
  const registry = await loadDescriptors();
  return registry
    .list({ kind: "object" })
    .filter((descriptor) => !descriptor.fields.some((field) => field.key === "url"))
    .map((descriptor) => ({ id: descriptor.meta.id, name: descriptor.meta.name, takesMaterial: descriptor.fields.some((field) => field.key === "material") }));
}

/** The placeable objects, empty until their descriptors have loaded, and `failed` when they could not be. */
export function usePlaceable(): { readonly objects: readonly Placeable[]; readonly failed: boolean } {
  const [state, setState] = useState<{ readonly objects: readonly Placeable[]; readonly failed: boolean }>({ objects: [], failed: false });
  useEffect(() => {
    let current = true;
    loadPlaceable().then(
      (objects) => {
        if (current) setState({ objects, failed: false });
      },
      () => {
        if (current) setState({ objects: [], failed: true });
      },
    );
    return () => {
      current = false;
    };
  }, []);
  return state;
}
