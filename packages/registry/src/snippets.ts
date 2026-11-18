import type { AssetMeta, Snippet } from "@hedronite/lts-core";
import { loadDescriptors } from "./lazy.js";

export type { Snippet } from "@hedronite/lts-core";

/**
 * Copy-ready usage for an asset: its descriptor's templates filled in for its default parameters, or for `params`
 * (parsed by the descriptor, so a wrong one rejects). An asset with no descriptor has none. The descriptors load on the
 * first call.
 */
export async function snippetsFor(meta: AssetMeta, params?: unknown): Promise<readonly Snippet[]> {
  return (await loadDescriptors()).get(meta.id)?.snippets(params) ?? [];
}
