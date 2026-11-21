// `lumin vendor fetch [FOLDER...] [--force]` and `lumin vendor verify [FOLDER...]`: the raw upstream files of the vendored folders, fetched by pin into the
// cache (`.vendor/`, or $LTS_VENDOR_CACHE) and checked offline. Fetching happens here, when this command is run, and nowhere else (SPEC-wave9 R2).
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { downloadArchive, fetchFolder, FetchError, verifyFolder, type Download } from "tool-vendor/fetch";
import { digestOf, readPin } from "tool-vendor/pin";
import { cacheDirFor, cacheHolds, commitsOf, CACHE_ENV, type ResolveContext } from "tool-vendor/resolve";
import { fail, ok, type Envelope } from "./envelope.js";

export interface VendorContext extends ResolveContext {
  /** Where an archive comes from; GitHub's, unless a test gives its own. */
  readonly download?: Download;
}

/** The folders under assets/vendor that have a pin, sorted. */
const pinned = (vendorDir: string): readonly string[] =>
  existsSync(vendorDir) ? readdirSync(vendorDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(vendorDir, entry.name, "vendor.json"))).map((entry) => entry.name).sort() : [];

/** The cache as the envelope names it: a path the user set is theirs to see; the default is `.vendor`. */
const cacheName = (context: ResolveContext): string => (context.env?.[CACHE_ENV] ?? "") === "" ? ".vendor" : (context.env?.[CACHE_ENV] ?? ".vendor");

const failure = (command: string, error: unknown, done: readonly unknown[]): Envelope => {
  if (error instanceof FetchError) return fail(command, error.kind, error.message, { data: { ...error.data, folders: done } });
  return fail(command, "failed", error instanceof Error ? error.message : String(error), { data: { folders: done } });
};

/** The folders asked for, or all of them; an unknown one is the envelope that says so. */
function targets(command: string, asked: readonly string[], vendorDir: string): readonly string[] | Envelope {
  const known = pinned(vendorDir);
  const unknown = asked.filter((folder) => !known.includes(folder));
  if (unknown.length > 0) return fail(command, "unknown_vendor", `no pinned folder ${unknown.join(", ")} under assets/vendor`, { matches: known.filter((folder) => unknown.some((name) => folder.includes(name.slice(0, 4)))).slice(0, 5) });
  return asked.length > 0 ? [...new Set(asked)] : known;
}

async function fetchAll(folders: readonly string[], force: boolean, context: VendorContext): Promise<Envelope> {
  const command = "vendor fetch";
  const cacheDir = cacheDirFor(context);
  const done: unknown[] = [];
  for (const folder of folders) {
    const pin = readPin(context.vendorDir, folder);
    if (pin === undefined) return fail(command, "unknown_vendor", `assets/vendor/${folder} has no vendor.json`);
    if (pin.kept) {
      done.push({ folder, status: "kept", contentHash: pin.contentHash });
      continue;
    }
    if (!force && cacheHolds(cacheDir, folder, pin)) {
      done.push({ folder, status: "cached", commits: commitsOf(pin), contentHash: pin.contentHash });
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop -- one folder at a time: each is a large download
      const fetched = await fetchFolder(folder, pin, { vendorDir: context.vendorDir, cacheDir, download: context.download ?? downloadArchive });
      done.push({ ...fetched, status: "fetched" });
    } catch (error: unknown) {
      return failure(command, error, done);
    }
  }
  return ok(command, { cache: cacheName(context), folders: done });
}

function verifyAll(asked: readonly string[], folders: readonly string[], context: VendorContext): Envelope {
  const command = "vendor verify";
  const cacheDir = cacheDirFor(context);
  const done: unknown[] = [];
  const missing: string[] = [];
  for (const folder of folders) {
    const pin = readPin(context.vendorDir, folder);
    if (pin === undefined) return fail(command, "unknown_vendor", `assets/vendor/${folder} has no vendor.json`);
    if (pin.kept) {
      const actual = digestOf(join(context.vendorDir, folder), true).hash;
      if (actual !== pin.contentHash) return fail(command, "hash_mismatch", `assets/vendor/${folder}: the folder hashes to ${actual}, the pin says ${pin.contentHash}`, { data: { folder, expected: pin.contentHash, actual } });
      done.push({ folder, status: "kept", contentHash: actual });
      continue;
    }
    if (!cacheHolds(cacheDir, folder, pin)) {
      missing.push(folder);
      continue;
    }
    try {
      const checked = verifyFolder(folder, pin, context.vendorDir, cacheDir);
      if (checked.licenseDifferences.length > 0) {
        return fail(command, "license_changed", `assets/vendor/${folder}: the license-bearing files ${checked.licenseDifferences.join(", ")} differ from upstream's (the cache's copies)`, { data: { folder, differences: checked.licenseDifferences } });
      }
      done.push({ folder, status: "verified", contentHash: checked.contentHash, files: checked.files });
    } catch (error: unknown) {
      return failure(command, error, done);
    }
  }
  // A folder asked for by name must be there; and nothing verified at all is not a pass.
  if (asked.length > 0 && missing.length > 0) return fail(command, "not_fetched", `${missing.join(", ")} is not fetched: run \`bun run vendor:fetch ${missing.join(" ")}\``, { data: { folders: done } });
  if (done.length === 0) return fail(command, "not_fetched", "nothing is fetched to verify: run `bun run vendor:fetch`");
  return ok(command, { cache: cacheName(context), folders: done, notFetched: missing });
}

/** `lumin vendor ACTION [FOLDER...]`. */
export async function vendorCommand(action: string, asked: readonly string[], options: { readonly force: boolean }, context: VendorContext): Promise<Envelope> {
  if (action !== "fetch" && action !== "verify") return fail("vendor", "usage", "vendor fetch [FOLDER...] [--force] | vendor verify [FOLDER...]");
  const command = `vendor ${action}`;
  const folders = targets(command, asked, context.vendorDir);
  if ("ok" in folders) return folders;
  return action === "fetch" ? fetchAll(folders, options.force, context) : verifyAll(asked, folders, context);
}
