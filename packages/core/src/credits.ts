import { z } from "zod";
import { assetKindSchema, originRelationSchema } from "./asset.js";

const text = z.string().min(1).max(2000);

/**
 * What a vendored folder's CREDIT.md says of the work it holds, one entry per folder (`vendorCredits`, generated from those files).
 * The pin is the upstream commit, or the release version with the hash of the folder as vendored; a source with several pins lists them all.
 */
const vendorCreditFields = z.object({
  /** What the work is (the CREDIT.md "What" line). */
  work: text,
  /** Where the work lives: its address. */
  source: z.url(),
  /** The commit, or the version and hash, the folder was taken at. */
  pin: text,
  /** The terms it is under, as the CREDIT.md states them. */
  license: text,
  /** Who made it. */
  credit: text,
});

export const vendorCreditSchema = vendorCreditFields.readonly();

export type VendorCredit = z.infer<typeof vendorCreditSchema>;

/**
 * One credit a scene's code carries: the thing the scene uses (`subject`, of `kind`: an asset kind, or a look), how it stands to the work
 * it came from (`relation`), that work as its folder's credit states it, and the file in that work it came from (`path`).
 */
export const creditSchema = vendorCreditFields
  .extend({
    /** The id of the asset or look that carries the credit. */
    subject: z.string().min(1).max(200),
    kind: z.union([assetKindSchema, z.literal("look")]),
    relation: originRelationSchema,
    /** A path inside the credited work; empty when the credit is for the work as a whole. */
    path: z.string().max(500),
  })
  .readonly();

export type Credit = z.infer<typeof creditSchema>;
