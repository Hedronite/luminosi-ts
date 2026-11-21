import { lookCredits, vendorCredits, type AssetKind, type AssetOrigin, type Credit } from "@hedronite/lts-core";
import type { RefKind, Resolve } from "./refs.js";
import type { Scene } from "./schema.js";

/** A row of a table by an id that may be any text: an id such as `constructor` is a key, never a name the table's prototype has. */
const row = <T>(table: Readonly<Record<string, T>>, id: string): T | undefined => (Object.hasOwn(table, id) ? table[id] : undefined);

/**
 * The credit of an asset that came from vendored work: its origin says how it stands to the work (ported, adopted, inspired by) and
 * which file it came from, and the generated table says what the work is, where it lives, at what pin, under which license and whose it is.
 * An asset with no origin, or whose vendor has no entry, has none.
 */
export function assetCredit(asset: { readonly id: string; readonly kind: AssetKind; readonly origin?: AssetOrigin | undefined }): Credit | undefined {
  const { origin } = asset;
  const work = origin === undefined ? undefined : row(vendorCredits, origin.vendor);
  if (origin === undefined || work === undefined) return undefined;
  return { ...work, subject: asset.id, kind: asset.kind, relation: origin.relation, path: origin.path };
}

/** The credit of a look that is someone else's work, or undefined for one of ours or one that is not a look. */
export const lookCredit = (id: string): Credit | undefined => row(lookCredits, id);

const compare = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

/**
 * The credits of everything a scene uses: its look, each node's asset, the material of a framed solid's edges, each surface's
 * material or shader, and each screen effect, as `resolve` knows them (`Resolved.credit`). One for each distinct credited thing, however
 * many times the scene uses it, sorted by subject; an uncredited scene has none.
 */
export function creditsFor(scene: Scene, resolve: Resolve): readonly Credit[] {
  const found = new Map<string, Credit>();
  const note = (kind: RefKind, id: string): void => {
    const credit = resolve(kind, id)?.credit;
    if (credit !== undefined) found.set(`${kind}/${id}`, credit);
  };
  if (typeof scene.look === "string") note("look", scene.look);
  for (const { asset, surface } of scene.nodes) {
    note(asset.kind === "object" ? "object" : "primitive", asset.id);
    if (asset.kind === "framed") note("material", asset.edges.material);
    if (surface !== undefined) {
      if ("material" in surface) note("material", surface.material);
      else note("shader", surface.shader);
    }
  }
  for (const effect of scene.effects) note("effect", effect.id);
  return [...found.values()].sort((a, b) => compare(a.subject, b.subject) || compare(a.kind, b.kind));
}
