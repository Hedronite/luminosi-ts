import type { AssetOrigin, VendorProvenance } from "@hedronite/lts-core";

/** How an asset stands to the work it came from, in the words the dialog uses: the same three relations the credit labels name. */
export const relationWords: Readonly<Record<AssetOrigin["relation"], string>> = {
  ported: "Ported: rewritten for LuminosiTS",
  adopted: "Adopted: used as it was published",
  inspired: "Inspired by: the technique, written here",
};

/**
 * The repository and commit an origin's path came from, as the folder's own record names them, and nothing when the record does not name
 * them: the source at the origin's commit, or the folder's one source when the origin names no commit. A folder with several sources and
 * no commit from the origin says nothing, because picking one of them would print a repository the path may not have come from.
 */
export function sourceOf(origin: AssetOrigin, folder: VendorProvenance): { readonly repo: string; readonly commit: string } | undefined {
  if (origin.commit !== undefined) return folder.sources.find((source) => source.commit === origin.commit);
  return folder.sources.length === 1 ? folder.sources[0] : undefined;
}
