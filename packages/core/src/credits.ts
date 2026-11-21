import { z } from "zod";
import { assetKindSchema, originPathSchema, originRelationSchema } from "./asset.js";

const text = z.string().min(1).max(2000);
/** Plain text, as a person would write it in a header comment: no Markdown code, so no backticks. */
const plain = text.regex(/^[^`]+$/, "plain text, without backticks");
/** An address, and only a secure one. */
const address = z.url({ protocol: /^https$/ }).max(500);

const vendorCreditFields = z.object({
  /** What the work is (the CREDIT.md "What" line). */
  work: text,
  /** Where the work lives: its address. */
  source: address,
  /** The commit, or the version and hash, the work was taken at. Several repositories: each commit is named by its repository. */
  pin: text,
  /** The terms it is under, as plain text with an SPDX id where one fits. It names no file of the work. */
  license: plain,
  /** The page of the license, for licenses that ask for a link (CC BY 4.0). */
  licenseUrl: address.optional(),
  /** Who made it. */
  credit: plain,
});

/**
 * What a vendored folder's CREDIT.md says of the work it holds, one entry per folder (`vendorCredits`, generated from those files).
 * The pin is the upstream commit, or the release version with the hash of the folder as vendored.
 */
export const vendorCreditSchema = vendorCreditFields.readonly();

export type VendorCredit = z.infer<typeof vendorCreditSchema>;

/**
 * One credit a scene's code carries: the thing the scene uses (`subject`, of `kind`: an asset kind, or a look), how it stands to the work
 * it came from (`relation`), that work as its credit states it, and the file in that work it came from (`path`).
 */
export const creditSchema = vendorCreditFields
  .extend({
    /** The id of the asset or look that carries the credit. */
    subject: z.string().min(1).max(200),
    kind: z.union([assetKindSchema, z.literal("look")]),
    relation: originRelationSchema,
    /** A path inside the credited work, by the rules of an asset's `origin.path`. */
    path: originPathSchema,
  })
  .readonly();

export type Credit = z.infer<typeof creditSchema>;
