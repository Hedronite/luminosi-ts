// The fetch (SPEC-wave9 R2): a folder's raw upstream, downloaded at the pin's full commit from GitHub's archive for that commit, written to the cache.
// It runs only when asked (`lumin vendor fetch`); no test, build or check calls it. The archive is read here, with our own reader of tar, so what is
// written is held to what the pin keeps: a path that climbs out, an absolute one, a link or a device in what is kept is an error, and what the pin leaves
// out is never written. The folder is written to a temporary folder beside the cache, hashed, compared with the pin and only then renamed into place.
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, readFileSync, statSync } from "node:fs";
import { copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { archiveUrl, digestOf, filesUnder, isLicenseBearing, keeps, type FetchablePin, type PinSource } from "./pin.js";
import { commitsOf, markerFile, readMarker, type Marker } from "./resolve.js";

export type FailureKind = "hash_mismatch" | "bad_archive" | "unsafe_path" | "network" | "bad_pin";

/** A fetch that did not happen, with a stable kind and, for a mismatch, both hashes. */
export class FetchError extends Error {
  readonly kind: FailureKind;
  readonly data: Readonly<Record<string, unknown>> | undefined;

  constructor(kind: FailureKind, message: string, data?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = "FetchError";
    this.kind = kind;
    this.data = data;
  }
}

/** Gives the bytes of the tar a source's archive holds, already gunzipped, as they arrive. The real one asks GitHub; a test gives a fixture. */
export type Download = (url: string) => Promise<AsyncIterable<Uint8Array>>;

/** The most one file, and one folder, may hold: a archive past them is not what it says it is. */
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_FILES = 200_000;

/** GitHub's archive of a commit, gunzipped as it streams. Redirects are followed; anything but a 200 is `network`. */
export const downloadArchive: Download = async (url) => {
  let response: Response;
  try {
    response = await fetch(url, { redirect: "follow", headers: { "user-agent": "lumin-vendor-fetch" }, signal: AbortSignal.timeout(15 * 60_000) });
  } catch (error: unknown) {
    throw new FetchError("network", `${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok || response.body === null) throw new FetchError("network", `${url}: the server answered ${String(response.status)}`);
  return response.body.pipeThrough(new DecompressionStream("gzip"));
};

// ---- tar -----------------------------------------------------------------------------------------------------------

const BLOCK = 512;

/** A reader over a stream of chunks: a number of bytes at a time, or skipped, with what is left kept for the next call. */
class Reader {
  readonly #iterator: AsyncIterator<Uint8Array>;
  #chunks: Buffer[] = [];
  #length = 0;

  constructor(source: AsyncIterable<Uint8Array>) {
    this.#iterator = source[Symbol.asyncIterator]();
  }

  async #more(): Promise<boolean> {
    const next = await this.#iterator.next();
    if (next.done === true) return false;
    const chunk = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength);
    this.#chunks.push(chunk);
    this.#length += chunk.length;
    return true;
  }

  /** Whether the stream has nothing more. */
  async atEnd(): Promise<boolean> {
    while (this.#length === 0) {
      // eslint-disable-next-line no-await-in-loop -- reads the stream until it gives a byte or ends
      if (!(await this.#more())) return true;
    }
    return false;
  }

  /** Exactly `count` bytes. A stream that ends first is a truncated archive. */
  async take(count: number): Promise<Buffer> {
    while (this.#length < count) {
      // eslint-disable-next-line no-await-in-loop -- reads the stream until it has the bytes
      if (!(await this.#more())) throw new FetchError("bad_archive", "the archive ends in the middle of an entry (a truncated download)");
    }
    const all = this.#chunks.length === 1 ? (this.#chunks[0] ?? Buffer.alloc(0)) : Buffer.concat(this.#chunks);
    this.#chunks = [all.subarray(count)];
    this.#length = all.length - count;
    return all.subarray(0, count);
  }

  /** Drops `count` bytes without holding them. */
  async skip(count: number): Promise<void> {
    let left = count;
    while (left > 0) {
      // eslint-disable-next-line no-await-in-loop -- reads the stream until the bytes are past
      if (this.#length === 0 && !(await this.#more())) throw new FetchError("bad_archive", "the archive ends in the middle of an entry (a truncated download)");
      const first = this.#chunks[0];
      if (first === undefined) continue;
      const drop = Math.min(left, first.length);
      this.#chunks[0] = first.subarray(drop);
      if (drop === first.length) this.#chunks.shift();
      this.#length -= drop;
      left -= drop;
    }
  }

  /** Reads to the end of the stream, so a damaged gzip tail is found too. */
  async drain(): Promise<void> {
    this.#chunks = [];
    this.#length = 0;
    // eslint-disable-next-line no-await-in-loop -- reads the stream to its end
    while (await this.#more()) {
      this.#chunks = [];
      this.#length = 0;
    }
  }
}

type EntryType = "file" | "directory" | "symlink" | "hardlink" | "other";

/** One entry of the archive, its path as the archive gave it. */
export interface TarEntry {
  readonly path: string;
  readonly type: EntryType;
  readonly size: number;
  readonly mode: number;
}

const text = (block: Buffer, from: number, to: number): string => {
  const raw = block.toString("utf8", from, to);
  const end = raw.indexOf("\0");
  return end === -1 ? raw : raw.slice(0, end);
};

/** A number in a header field: octal text, or (a size past 8 GiB) base 256 with the top bit set. */
function numberIn(block: Buffer, from: number, to: number): number {
  if (((block[from] ?? 0) & 0x80) !== 0) {
    let value = (block[from] ?? 0) & 0x7f;
    for (let at = from + 1; at < to; at += 1) value = value * 256 + (block[at] ?? 0);
    return value;
  }
  const digits = text(block, from, to).trim();
  if (digits === "") return 0;
  if (!/^[0-7]+$/.test(digits)) throw new FetchError("bad_archive", "a header holds a number that is not octal");
  return Number.parseInt(digits, 8);
}

const kindOf = (flag: string): EntryType => {
  switch (flag) {
    case "0":
    case "\0":
    case "7":
      return "file";
    case "5":
      return "directory";
    case "2":
      return "symlink";
    case "1":
      return "hardlink";
    default:
      return "other";
  }
};

/** The `key=value` records of a pax header body: each is `LENGTH key=value\n`, the length counting its own digits. */
function paxRecords(body: Buffer): ReadonlyMap<string, string> {
  const records = new Map<string, string>();
  let at = 0;
  while (at < body.length) {
    const space = body.indexOf(0x20, at);
    const length = space === -1 ? Number.NaN : Number.parseInt(body.toString("utf8", at, space), 10);
    if (!Number.isInteger(length) || length < 1 || at + length > body.length) throw new FetchError("bad_archive", "a pax header is not well formed");
    const record = body.toString("utf8", space + 1, at + length - 1);
    const equals = record.indexOf("=");
    if (equals > 0) records.set(record.slice(0, equals), record.slice(equals + 1));
    at += length;
  }
  return records;
}

/** What the archive's own headers say, for a check on its origin: the commit GitHub writes into the global pax header. */
export interface TarFacts {
  readonly comment: string | undefined;
}

/** Reads a tar stream. `select` decides, from an entry's header, whether its bytes are wanted; `accept` is given the bytes of those that are. */
export async function readTar(
  source: AsyncIterable<Uint8Array>,
  handlers: { readonly select: (entry: TarEntry) => boolean; readonly accept: (entry: TarEntry, data: Buffer) => Promise<void> },
): Promise<TarFacts> {
  const reader = new Reader(source);
  let comment: string | undefined;
  let nextPath: string | undefined;
  let nextSize: number | undefined;
  let zeros = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- a tar is read in order
    if (await reader.atEnd()) break;
    // eslint-disable-next-line no-await-in-loop -- a tar is read in order
    const header = await reader.take(BLOCK);
    if (header.every((byte) => byte === 0)) {
      zeros += 1;
      if (zeros === 2) break;
      continue;
    }
    zeros = 0;
    let sum = 0;
    for (let at = 0; at < BLOCK; at += 1) sum += at >= 148 && at < 156 ? 0x20 : (header[at] ?? 0);
    if (sum !== numberIn(header, 148, 156)) throw new FetchError("bad_archive", "a header's checksum does not match: the archive is damaged");
    const flag = text(header, 156, 157);
    const declared = numberIn(header, 124, 136);
    const size = nextSize ?? declared;
    const padding = (BLOCK - (declared % BLOCK)) % BLOCK;
    if (flag === "x" || flag === "g" || flag === "L" || flag === "K") {
      if (declared > 1024 * 1024) throw new FetchError("bad_archive", "an extended header is too large");
      // eslint-disable-next-line no-await-in-loop -- a tar is read in order
      const body = await reader.take(declared);
      // eslint-disable-next-line no-await-in-loop -- a tar is read in order
      await reader.skip(padding);
      if (flag === "L") nextPath = body.toString("utf8").replace(/\0+$/, "");
      else if (flag === "x" || flag === "g") {
        const records = paxRecords(body);
        if (flag === "g") comment = records.get("comment") ?? comment;
        else {
          nextPath = records.get("path") ?? nextPath;
          const sizeText = records.get("size");
          if (sizeText !== undefined) nextSize = Number.parseInt(sizeText, 10);
        }
      }
      continue;
    }
    const prefix = text(header, 345, 500);
    const named = text(header, 0, 100);
    const ustar = text(header, 257, 262) === "ustar";
    const path = nextPath ?? (ustar && prefix !== "" ? `${prefix}/${named}` : named);
    nextPath = undefined;
    nextSize = undefined;
    const entry: TarEntry = { path, type: kindOf(flag), size, mode: numberIn(header, 100, 108) };
    // Only a file has bytes after its header; a folder, a link and a device have none.
    const body = entry.type === "file" ? size : 0;
    const trailing = (BLOCK - (body % BLOCK)) % BLOCK;
    if (entry.type === "file" && handlers.select(entry)) {
      if (size > MAX_FILE_BYTES) throw new FetchError("bad_archive", `${path} is ${String(size)} bytes: more than a vendored file may be`);
      // eslint-disable-next-line no-await-in-loop -- a tar is read in order
      const data = await reader.take(size);
      // eslint-disable-next-line no-await-in-loop -- a tar is read in order
      await reader.skip(trailing);
      // eslint-disable-next-line no-await-in-loop -- a tar is read in order
      await handlers.accept(entry, data);
    } else if (entry.type !== "file" && entry.type !== "directory" && handlers.select(entry)) {
      // A link or a device in what the pin keeps: it is never made.
      throw new FetchError("unsafe_path", `${path} is a ${entry.type}: a vendored folder holds only files`);
    } else {
      // eslint-disable-next-line no-await-in-loop -- a tar is read in order
      await reader.skip(body + trailing);
    }
  }
  await reader.drain();
  return { comment };
}

// ---- one folder ----------------------------------------------------------------------------------------------------

/** A path of an archive entry, under the archive's own top folder, as a path inside the repository's tree. `undefined` for the top folder itself. */
function inRepository(path: string, top: string): string | undefined {
  const parts = path.split("/");
  if (parts[0] !== top) throw new FetchError("bad_archive", `${path} is not under the archive's own folder (${top})`);
  const rest = parts.slice(1);
  if (rest.length > 0 && rest[rest.length - 1] === "") rest.pop();
  return rest.length === 0 ? undefined : rest.join("/");
}

/** A path that may be written: no empty part, no `.` or `..`, no backslash, NUL or drive. Anything else is an error, named. */
function checkSafe(path: string): void {
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..") || path.includes("\\") || path.includes("\0") || /^[A-Za-z]:/.test(path)) {
    throw new FetchError("unsafe_path", `${path} would be written outside the folder, or by a name that is not a plain relative path`);
  }
}

interface Tally {
  files: number;
  bytes: number;
}

/** One source: its archive read into `dest`, with only what the pin keeps. */
async function extract(source: PinSource, dest: string, download: Download, tally: Tally): Promise<void> {
  const url = archiveUrl(source);
  const repository = source.source.slice(source.source.lastIndexOf("/") + 1);
  const stream = await download(url);
  const seen = new Set<string>();
  const topOf = (path: string): string => {
    const top = path.split("/")[0] ?? "";
    if (!top.toLowerCase().startsWith(`${repository.toLowerCase()}-`) || !top.endsWith(`-${source.commit}`)) {
      throw new FetchError("bad_archive", `${path} is not in the archive's own folder (${repository}-${source.commit}): this is not the archive of ${source.commit}`);
    }
    return top;
  };
  const facts = await readTar(stream, {
    select: (entry) => {
      const path = inRepository(entry.path, topOf(entry.path));
      return path !== undefined && keeps(source, path);
    },
    accept: async (entry, data) => {
      const path = inRepository(entry.path, topOf(entry.path)) ?? "";
      checkSafe(path);
      const key = path.normalize("NFC").toLowerCase();
      if (seen.has(key)) throw new FetchError("unsafe_path", `${path} appears twice (or differs from another path only in case)`);
      seen.add(key);
      tally.files += 1;
      tally.bytes += data.length;
      if (tally.files > MAX_FILES || tally.bytes > MAX_TOTAL_BYTES) throw new FetchError("bad_archive", `the archive holds more than a vendored folder may (${String(MAX_FILES)} files, ${String(MAX_TOTAL_BYTES)} bytes)`);
      const to = join(dest, source.into ?? "", path);
      await mkdir(dirname(to), { recursive: true });
      await writeFile(to, data, { flag: "wx" });
      chmodSync(to, (entry.mode & 0o111) === 0 ? 0o644 : 0o755);
    },
  });
  if (facts.comment !== undefined && /^[0-9a-f]{40}$/.test(facts.comment) && facts.comment !== source.commit) {
    throw new FetchError("bad_archive", `the archive says it is commit ${facts.comment}, not ${source.commit}`);
  }
}

/** What one fetched folder holds. */
export interface Fetched {
  readonly folder: string;
  readonly commits: readonly string[];
  /** Every file the cache holds, license-bearing ones too. */
  readonly files: number;
  readonly bytes: number;
  readonly contentHash: string;
}

export interface FetchContext {
  /** The repository's assets/vendor: where the overlay files are. */
  readonly vendorDir: string;
  readonly cacheDir: string;
  readonly download: Download;
}

async function copyOverlay(vendorDir: string, folder: string, overlay: readonly string[], dest: string): Promise<void> {
  for (const path of overlay) {
    checkSafe(path);
    const from = join(vendorDir, folder, path);
    if (!existsSync(from) || !statSync(from).isFile()) throw new FetchError("bad_pin", `assets/vendor/${folder}/vendor.json: the overlay ${path} is not a file in the repository`);
    // eslint-disable-next-line no-await-in-loop -- a few files, one at a time
    await mkdir(dirname(join(dest, path)), { recursive: true });
    // eslint-disable-next-line no-await-in-loop -- a few files, one at a time
    await copyFile(from, join(dest, path));
  }
}

/** Every file a folder holds, and its bytes. */
function tallyOf(dir: string): Tally {
  const paths = filesUnder(dir);
  return { files: paths.length, bytes: paths.reduce((sum, path) => sum + statSync(join(dir, path)).size, 0) };
}

/**
 * Fetches a folder to `<cache>/<folder>/`: every source's archive, what the pin keeps of it, the overlay over it, then the hash. A hash that is not
 * the pin's is an error with both hashes and nothing in the cache. The folder appears by a rename, so a fetch that stops leaves the cache as it was.
 */
export async function fetchFolder(folder: string, pin: FetchablePin, context: FetchContext): Promise<Fetched> {
  await mkdir(context.cacheDir, { recursive: true });
  const temp = join(context.cacheDir, `.tmp-${folder}-${randomUUID()}`);
  try {
    const tally: Tally = { files: 0, bytes: 0 };
    for (const source of pin.sources) {
      // eslint-disable-next-line no-await-in-loop -- the sources of a folder share its temporary folder, one at a time
      await extract(source, temp, context.download, tally);
    }
    await mkdir(temp, { recursive: true });
    await copyOverlay(context.vendorDir, folder, pin.overlay ?? [], temp);
    const actual = digestOf(temp, false).hash;
    if (actual !== pin.contentHash) {
      throw new FetchError("hash_mismatch", `assets/vendor/${folder}: the fetched files hash to ${actual}, the pin says ${pin.contentHash}; nothing was written to the cache`, { folder, expected: pin.contentHash, actual });
    }
    const held = tallyOf(temp);
    const target = join(context.cacheDir, folder);
    await rm(markerFile(context.cacheDir, folder), { force: true });
    const old = join(context.cacheDir, `.old-${folder}-${randomUUID()}`);
    if (existsSync(target)) await rename(target, old);
    await rename(temp, target);
    await rm(old, { recursive: true, force: true });
    const marker: Marker = { schema: 1, folder, commits: [...commitsOf(pin)], contentHash: pin.contentHash };
    const pending = `${markerFile(context.cacheDir, folder)}.${randomUUID()}.tmp`;
    await writeFile(pending, `${JSON.stringify(marker, null, 2)}\n`);
    await rename(pending, markerFile(context.cacheDir, folder));
    return { folder, commits: commitsOf(pin), files: held.files, bytes: held.bytes, contentHash: pin.contentHash };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

/** What `verify` found in a cached folder. */
export interface Verified {
  readonly folder: string;
  readonly contentHash: string;
  readonly files: number;
  /** The license-bearing files of the repository that the cache lacks or holds with other bytes. */
  readonly licenseDifferences: readonly string[];
}

/** Whether a cached folder still matches its pin, offline: its hash recomputed, and the repository's license-bearing files compared with the cache's (R12). */
export function verifyFolder(folder: string, pin: FetchablePin, vendorDir: string, cacheDir: string): Verified {
  if (readMarker(cacheDir, folder) === undefined) throw new FetchError("bad_pin", `${folder} has no fetch marker in the cache: fetch it again`);
  const cached = join(cacheDir, folder);
  const digest = digestOf(cached, false);
  if (digest.hash !== pin.contentHash) {
    throw new FetchError("hash_mismatch", `assets/vendor/${folder}: the cached files hash to ${digest.hash}, the pin says ${pin.contentHash}`, { folder, expected: pin.contentHash, actual: digest.hash });
  }
  const own = join(vendorDir, folder);
  const differences = filesUnder(own)
    .filter(isLicenseBearing)
    .filter((path) => !existsSync(join(cached, path)) || !readFileSync(join(own, path)).equals(readFileSync(join(cached, path))));
  return { folder, contentHash: digest.hash, files: digest.files, licenseDifferences: differences };
}
