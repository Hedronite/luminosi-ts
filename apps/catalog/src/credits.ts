// The credits of a scene, as the catalog knows them. This module holds the credit tables, so the Playground loads it with `import("./credits")`
// when its code view opens, and the catalog's 3D bundle does not carry them until then (see useCredits.ts).
import { assetCredit, creditsFor, lookCredit, type Resolve, type Scene } from "@hedronite/lts-scene";
import { registry } from "./registry";

/** Each id's credit, where it is someone else's work: a look's own, or an asset's built from its origin and its vendor's entry. */
const resolve: Resolve = (kind, id) => {
  if (kind === "look") {
    const credit = lookCredit(id);
    return credit === undefined ? {} : { credit };
  }
  const meta = registry.get(id);
  if (meta?.kind !== kind) return undefined;
  const credit = assetCredit(meta);
  return credit === undefined ? {} : { credit };
};

/** The credits of what `scene` uses, as the lumin command line's `scene credits` lists them. */
export const creditsOf = (scene: Scene) => creditsFor(scene, resolve);
