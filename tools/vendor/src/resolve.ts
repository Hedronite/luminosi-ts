// The resolver: the one function every tool uses to find a vendored folder's raw files (SPEC-wave9 A10).
//   a kept folder      its folder in the repository
//   a fetched folder   the cache, when it holds a copy that was verified against the pin
//   a folder with raw files still in the repository (until the raw tree leaves) the repository folder
//   otherwise          `not_fetched`, which names the command that fixes it
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { hashed, readPin, type FetchablePin, type Pin } from "./pin.js";

/** The environment variable that moves the cache, for a clone, a CI job or a test that wants its own. */
export const CACHE_ENV = "LTS_VENDOR_CACHE";

export interface ResolveContext {
  /** The repository's assets/vendor. */
  readonly vendorDir: string;
  /** The process environment, or a stand-in. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** The cache's folder: $LTS_VENDOR_CACHE, or `.vendor/` at the repository root (beside assets/). */
export function cacheDirFor(context: ResolveContext): string {
  const given = context.env?.[CACHE_ENV];
  return given === undefined || given === "" ? join(context.vendorDir, "..", "..", ".vendor") : given;
}

/** What a fetch writes beside a folder in the cache once the folder is whole and matched its hash: the commits and the hash it matched. */
export const markerSchema = z.strictObject({
  schema: z.literal(1),
  folder: z.string(),
  commits: z.array(z.string()),
  contentHash: z.string(),
});
export type Marker = z.infer<typeof markerSchema>;

export const markerFile = (cacheDir: string, folder: string): string => join(cacheDir, `${folder}.fetched.json`);

/** The marker of a cached folder, or undefined when there is none or it is not one. */
export function readMarker(cacheDir: string, folder: string): Marker | undefined {
  try {
    const json: unknown = JSON.parse(readFileSync(markerFile(cacheDir, folder), "utf8"));
    const parsed = markerSchema.safeParse(json);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** The commits a pin names, in order. */
export const commitsOf = (pin: FetchablePin): readonly string[] => pin.sources.map((source) => source.commit);

/** Whether the cache holds a copy of the folder that was verified against this very pin (so a pin that changed has no copy until it is fetched again). */
export function cacheHolds(cacheDir: string, folder: string, pin: FetchablePin): boolean {
  const marker = readMarker(cacheDir, folder);
  return marker !== undefined && marker.folder === folder && marker.contentHash === pin.contentHash && marker.commits.join(",") === commitsOf(pin).join(",") && existsSync(join(cacheDir, folder));
}

/** Whether the repository folder still holds raw upstream files: anything beyond CREDIT.md, vendor.json, license-bearing files and the overlay. */
export function holdsRaw(repoFolder: string, pin: Pin): boolean {
  const stays = new Set(pin.kept ? [] : (pin.overlay ?? []));
  const walk = (at: string): boolean =>
    readdirSync(join(repoFolder, at), { withFileTypes: true }).some((entry) => {
      const path = at === "" ? entry.name : `${at}/${entry.name}`;
      if (entry.isDirectory()) return walk(path);
      return hashed(path, false) && !stays.has(path);
    });
  return walk("");
}

export type Resolution =
  | { readonly ok: true; readonly dir: string; readonly via: "kept" | "cache" | "repo" }
  | { readonly ok: false; readonly kind: "not_fetched"; readonly error: string };

/** The directory that holds a folder's raw files, or the error that says to fetch it. A folder with no pin is a plain folder of the repository. */
export function resolveVendor(folder: string, context: ResolveContext): Resolution {
  const repoFolder = join(context.vendorDir, folder);
  const pin = readPin(context.vendorDir, folder);
  if (pin === undefined) return { ok: true, dir: repoFolder, via: "repo" };
  if (pin.kept) return { ok: true, dir: repoFolder, via: "kept" };
  const cacheDir = cacheDirFor(context);
  if (cacheHolds(cacheDir, folder, pin)) return { ok: true, dir: join(cacheDir, folder), via: "cache" };
  if (existsSync(repoFolder) && holdsRaw(repoFolder, pin)) return { ok: true, dir: repoFolder, via: "repo" };
  return { ok: false, kind: "not_fetched", error: `assets/vendor/${folder}'s raw files are not fetched: run \`bun run vendor:fetch ${folder}\`` };
}
