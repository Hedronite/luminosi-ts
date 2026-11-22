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

/** The four classes the license policy knows (tools/vendor/src/policy.ts). */
export const policyClassSchema = z.enum(["adopt", "adopt-with-attribution", "showcase-only", "forbidden"]);
export type PolicyClass = z.infer<typeof policyClassSchema>;
/** One change a vendored folder makes to upstream: paths kept as published, paths left out, or a file edited after. */
export const transformationSchema = z
  .object({
    kind: z.enum(["exclude", "include", "layout", "overlay"]),
    /** The paths or globs it names, as the pin states them. */
    paths: z.array(z.string().min(1)).min(1).readonly(),
    reason: z.string().min(1),
  })
  .readonly();
export type Transformation = z.infer<typeof transformationSchema>;
/** One license class in a folder: the class, the license, and the paths or globs the pin says it covers. */
export const licensePolicyRowSchema = z
  .object({
    class: policyClassSchema,
    spdx: z.string().min(1),
    /** The declared paths or globs; empty means every path no other row covers. */
    files: z.array(z.string().min(1)).readonly(),
    /** How many of the folder's files this row covers. */
    fileCount: z.number().int().nonnegative(),
  })
  .readonly();
/** Where a vendored folder came from and what was done to it (generated/vendorProvenance.ts, for the Open source view). */
export const vendorProvenanceSchema = z
  .object({
    /** The folder's license as one SPDX expression (its distinct ids joined with AND). */
    license: z.string().min(1),
    licenseIds: z.array(z.string().min(1)).min(1).readonly(),
    /** One row per class and license, most permissive first. */
    policies: z.array(licensePolicyRowSchema).min(1).readonly(),
    /** How many files the folder holds, as its pin counts them. */
    totalFiles: z.number().int().nonnegative(),
    fetched: z.boolean(),
    keptReason: z.string().min(1).optional(),
    transformations: z.array(transformationSchema).readonly(),
    sources: z
      .array(z.object({ repo: address, commit: z.string().regex(/^[0-9a-f]{40}$/) }).readonly())
      .readonly(),
    /** YYYY-MM, or YYYY-MM-DD where the folder's CREDIT.md gives the day. */
    vendoredOn: z.string().regex(/^\d{4}-\d{2}(?:-\d{2})?$/),
    reviewer: z.string().min(1),
  })
  .readonly();
export type VendorProvenance = z.infer<typeof vendorProvenanceSchema>;
/** A folder's credit as its generated data carries it: the CREDIT.md line plus the pin's commit and license id. */
export const vendorCreditRecordSchema = vendorCreditFields
  .extend({
    /** Every source the folder came from, at its pinned commit; empty for a kept folder. */
    sources: z
      .array(z.object({ repo: address, commit: z.string().regex(/^[0-9a-f]{40}$/) }).readonly())
      .readonly(),
    /** The folder's license as one SPDX expression. */
    licenseId: z.string().min(1),
  })
  .readonly();
export type VendorCreditRecord = z.infer<typeof vendorCreditRecordSchema>;
