// The pin: assets/vendor/<folder>/vendor.json, the machine-readable record of where a folder's raw files come from. A fetchable folder names
// each upstream repository at a full commit with the paths it keeps (`include`) and drops (`exclude`), the files that were edited after
// vendoring (`overlay`) and the hash of what results. A kept folder (no repository or archive exists upstream) names its site, a reason, and its hash.
// Everything here is pure or reads the disk; nothing reaches the network (fetch.ts does, only when asked).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/** A path or glob under a source's root: no leading slash, no `..`, no backslash. `dir/` stands for the directory and all it holds. */
const globText = z
  .string()
  .min(1)
  .refine((text) => !text.startsWith("/") && !text.includes("\\") && !text.includes("\0") && !text.split("/").includes(".."), "a glob is relative, with no `..` and no backslash");

const relativePath = z
  .string()
  .min(1)
  .refine((text) => !text.startsWith("/") && !text.endsWith("/") && !text.includes("\\") && !text.includes("\0") && !text.split("/").some((part) => part === ".." || part === "." || part === ""), "a path is relative, without `..` or empty parts");

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "64 hex digits");

/** One upstream repository at one commit, and what is kept from it. */
const sourceSchema = z.strictObject({
  /** The repository's address: https://github.com/OWNER/REPO. */
  source: z.string().regex(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/, "https://github.com/OWNER/REPO"),
  /** The full commit: 40 hex digits, never a short one, a branch or a tag. */
  commit: z.string().regex(/^[0-9a-f]{40}$/, "a full 40-hex commit"),
  /** The folder inside the vendored folder this repository's files go to, when the folder holds several repositories. */
  into: relativePath.optional(),
  /** The paths kept; absent means everything. */
  include: z.array(globText).min(1).optional(),
  /** The paths left out, from what `include` keeps. */
  exclude: z.array(globText).min(1).optional(),
});
export type PinSource = z.infer<typeof sourceSchema>;

/** Which license covers which paths of the folder (tools/vendor/src/policy.ts says what each license permits). The paths are the folder's own, with `/`. */
const licenseEntrySchema = z
  .strictObject({
    /** An SPDX id or expression (`MIT`, `MIT OR Apache-2.0`), or a `LicenseRef-` id where SPDX has none. */
    spdx: z.string().min(1),
    paths: z.array(globText).min(1).optional(),
    /** Every path of the folder no other entry names. One per folder at most. */
    remainder: z.literal(true).optional(),
  })
  .refine((entry) => (entry.paths === undefined) !== (entry.remainder === undefined), "an entry names `paths` or is the `remainder`, not both and not neither");
export type LicenseEntry = z.infer<typeof licenseEntrySchema>;
/** One change a folder makes to upstream: paths kept as published, paths left out, or a file edited after vendoring. */
const transformationSchema = z
  .strictObject({
    kind: z.enum(["exclude", "include", "overlay"]),
    paths: z.array(globText).min(1),
    reason: z.string().min(1),
  })
  .readonly();
export type PinTransformation = z.infer<typeof transformationSchema>;
/** Where a folder came from and who vouched for it, beside what it holds. */
const provenanceFields = {
  /** The folder's license as one SPDX expression (distinct ids joined with AND). */
  license: z.string().min(1).optional(),
  transformations: z.array(transformationSchema).optional(),
  /** YYYY-MM, or YYYY-MM-DD where the folder's CREDIT.md gives the day. */
  vendoredOn: z
    .string()
    .regex(/^\d{4}-\d{2}(?:-\d{2})?$/, "YYYY-MM or YYYY-MM-DD")
    .optional(),
  reviewer: z
    .string()
    .regex(/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9]))*$/, "a GitHub login")
    .optional(),
};
/** What a pin says of where a folder came from: all four fields, as every real pin carries them. */
export interface Provenance {
  readonly license: string;
  readonly transformations: readonly PinTransformation[];
  readonly vendoredOn: string;
  readonly reviewer: string;
}
/**
 * A pin's provenance, insisting it is all there. The schema allows a pin without it (the resolver and the fetch read
 * pins that predate provenance), but the generator and the check call this, so a folder missing any of the four fails.
 */
export function provenanceOf(pin: Pin, where: string): Provenance {
  const missing = (["license", "transformations", "vendoredOn", "reviewer"] as const).filter((field) => pin[field] === undefined);
  if (missing.length > 0) throw new Error(`${where}: no ${missing.join(", ")}`);
  if (pin.license === undefined || pin.transformations === undefined || pin.vendoredOn === undefined || pin.reviewer === undefined) {
    throw new Error(`${where}: incomplete provenance`);
  }
  return {
    license: pin.license,
    transformations: pin.transformations,
    vendoredOn: pin.vendoredOn,
    reviewer: pin.reviewer,
  };
}

const fetchable = z
  .strictObject({
    schema: z.literal(1),
    kept: z.literal(false),
    sources: z.array(sourceSchema).min(1),
    /** Files that stay in the repository, edited after vendoring: they are laid over the fetched tree before the hash. */
    overlay: z.array(relativePath).min(1).optional(),
    contentHash: sha256Hex,
    licenses: z.array(licenseEntrySchema).min(1).optional(),
    ...provenanceFields,
  })
  .superRefine((pin, context) => {
    if (pin.sources.length === 1) return;
    const places = pin.sources.map((source) => source.into);
    if (places.some((place) => place === undefined) || new Set(places).size !== places.length) {
      context.addIssue({ code: "custom", message: "a folder with several sources gives each its own `into`", path: ["sources"] });
    }
  });

const kept = z.strictObject({
  schema: z.literal(1),
  kept: z.literal(true),
  /** Why the folder's files stay in the repository. */
  keptReason: z.string().min(20),
  /** Where it came from: a site, when there is no repository or archive. */
  source: z.string().regex(/^https:\/\//, "an https address"),
  version: z.string().min(1).optional(),
  contentHash: sha256Hex,
  licenses: z.array(licenseEntrySchema).min(1).optional(),
  ...provenanceFields,
});

export const pinSchema = z.discriminatedUnion("kept", [fetchable, kept]);
export type Pin = z.infer<typeof pinSchema>;
export type FetchablePin = Extract<Pin, { readonly kept: false }>;

/** Reads a pin's JSON; throws, naming `where` and the first problem. */
export function parsePin(json: unknown, where: string): Pin {
  const parsed = pinSchema.safeParse(json);
  if (parsed.success) return parsed.data;
  const first = parsed.error.issues[0];
  throw new Error(`${where}: ${first === undefined ? "not a pin" : `${first.path.join(".") || "(pin)"}: ${first.message}`}`);
}

/** Where a folder's pin is. */
export const pinFile = (vendorDir: string, folder: string): string => join(vendorDir, folder, "vendor.json");

/** A folder's pin, or undefined when it has none. A pin that is there and wrong throws. */
export function readPin(vendorDir: string, folder: string): Pin | undefined {
  const file = pinFile(vendorDir, folder);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  const json: unknown = JSON.parse(text);
  return parsePin(json, `assets/vendor/${folder}/vendor.json`);
}

// ---- globs ---------------------------------------------------------------------------------------------------------

const compiled = new Map<string, RegExp>();

/** A glob as a regular expression: `*` is any run but a slash, `?` one such character, `**` any run of folders; `dir/` is the directory and all it holds. */
function globExpression(pattern: string): RegExp {
  const cached = compiled.get(pattern);
  if (cached !== undefined) return cached;
  const text = pattern.endsWith("/") ? `${pattern}**` : pattern;
  let out = "";
  for (let at = 0; at < text.length; at += 1) {
    const char = text.charAt(at);
    if (char === "*" && text.charAt(at + 1) === "*") {
      const slash = text.charAt(at + 2) === "/";
      out += slash ? "(?:.*/)?" : ".*";
      at += slash ? 2 : 1;
    } else if (char === "*") out += "[^/]*";
    else if (char === "?") out += "[^/]";
    else out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const expression = new RegExp(`^${out}$`, "s");
  compiled.set(pattern, expression);
  return expression;
}

/** Whether a path under a source's root matches a glob. */
export const matchesGlob = (pattern: string, path: string): boolean => globExpression(pattern).test(path);

/** Whether a source keeps a path: inside `include` (when there is one) and not inside `exclude`. */
export const keeps = (source: Pick<PinSource, "include" | "exclude">, path: string): boolean =>
  (source.include === undefined || source.include.some((pattern) => matchesGlob(pattern, path))) && !(source.exclude ?? []).some((pattern) => matchesGlob(pattern, path));

// ---- the content hash ------------------------------------------------------------------------------------------------

/**
 * A license-bearing file (the policy of a folder's own licenses): it stays in the repository at its own path, whatever its depth, and the hash leaves it out.
 * LICENSE*, NOTICE*, COPYING*, *LICENSES*.md and THIRD_PARTY_NOTICES*, by the file's own name.
 */
export const isLicenseBearing = (path: string): boolean => /^(?:LICENSE|NOTICE|COPYING|THIRD_PARTY_NOTICES)|^[^/]*LICENSES[^/]*\.md$/.test(path.slice(path.lastIndexOf("/") + 1));

/** Whether the hash covers a file of a folder: not CREDIT.md or vendor.json (the folder's own), not .DS_Store, and, for a fetchable folder, not a license-bearing file. */
export function hashed(path: string, isKept: boolean): boolean {
  if (path === "CREDIT.md" || path === "vendor.json" || path.slice(path.lastIndexOf("/") + 1) === ".DS_Store") return false;
  return isKept || !isLicenseBearing(path);
}

/** Every file under a folder, as paths relative to it with `/`, sorted. A link, a device or anything but a file or a folder throws. */
export function filesUnder(dir: string): readonly string[] {
  const found: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(join(dir, at), { withFileTypes: true })) {
      const path = at === "" ? entry.name : `${at}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) found.push(path);
      else throw new Error(`${join(dir, path)} is not a file or a folder (a link or a device): a vendored folder holds only files`);
    }
  };
  walk("");
  return found.sort();
}

/** What a folder's hash covers: the files hashed, and their bytes. */
export interface Digest {
  readonly hash: string;
  readonly files: number;
  readonly bytes: number;
}

/**
 * The content hash (SPEC-wave9 R3): the sha256 of the folder's `sha256  path` lines, one per hashed file, sorted by path. `isKept` is R10: a kept
 * folder leaves out only CREDIT.md, vendor.json and .DS_Store.
 */
export function digestOf(dir: string, isKept: boolean): Digest {
  const paths = filesUnder(dir).filter((path) => hashed(path, isKept));
  let bytes = 0;
  const lines = paths.map((path) => {
    const data = readFileSync(join(dir, path));
    bytes += data.length;
    return `${createHash("sha256").update(data).digest("hex")}  ${path}\n`;
  });
  return { hash: createHash("sha256").update(lines.join("")).digest("hex"), files: paths.length, bytes };
}

/** The address GitHub serves a commit's archive from. */
export function archiveUrl(source: PinSource): string {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)$/.exec(source.source);
  if (match === null) throw new Error(`${source.source}: not a GitHub repository address`);
  return `https://codeload.github.com/${match[1] ?? ""}/${match[2] ?? ""}/tar.gz/${source.commit}`;
}
