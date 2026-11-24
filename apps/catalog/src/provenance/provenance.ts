import type { AssetOrigin, VendorProvenance } from "@hedronite/lts-core";

/** How an asset stands to the work it came from, in the words the dialog uses: the same three relations the credit labels name. */
export const relationWords: Readonly<Record<AssetOrigin["relation"], string>> = {
  ported: "Ported: rewritten for LuminosiTS",
  adopted: "Adopted: used as it was published",
  inspired: "Inspired by: the technique, written here",
};

/**
 * The repository and commit an origin's path came from, as the folder's own record names them: the source at the origin's exact commit,
 * or the folder's one source when the origin names no commit (a kept folder has none).
 */
export function sourceOf(origin: AssetOrigin, folder: VendorProvenance): { readonly repo: string; readonly commit: string } | undefined {
  return folder.sources.find((source) => source.commit === origin.commit) ?? folder.sources[0];
}
