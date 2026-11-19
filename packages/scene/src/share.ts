import { toCanonicalJson } from "./emit/json.js";
import { migrate } from "./migrate.js";
import type { Scene, SceneResult } from "./schema.js";

/**
 * A scene as a piece of text that fits in a link: `s1.` (the link format's version) and then the base64url, without padding,
 * of the document's canonical JSON deflated (raw deflate, no header). Deflate is the platform's own (`CompressionStream` and
 * `DecompressionStream`, which every browser and Node have), so this package needs no library for it, and for the same reason
 * the two functions are asynchronous.
 */
export const SHARE_PREFIX = "s1.";

/** What a link may hold: the whole text of one, prefix included, in characters (16 KiB), and the document it holds once inflated, in bytes (256 KiB). */
export const SHARE_LIMITS = { link: 16 * 1024, document: 256 * 1024 } as const;

/**
 * The names of what is wrong with a link, beside the codes of `migrate` for a document that is inflated but does not read:
 * `not-a-link` (it does not start with `s1.`, so it is no link of this format), `link-too-long` (over 16 KiB, and not read at all),
 * `bad-encoding` (not base64url), `bad-compression` (not deflate) and `document-too-large` (it inflates past 256 KiB: inflation
 * stops there, so a small link that says it holds a very large text costs no more than that to refuse).
 */
const fail = (code: string, message: string): SceneResult => ({ ok: false, issues: [{ path: [], code, message }] });

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** The bytes of base64url text without padding, or undefined where it is not that. */
function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | undefined {
  // A length of 1 more than a multiple of 4 holds a partial byte, which no encoder writes.
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return undefined;
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(text.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** What a stream gives, joined, or `undefined` when it gives more than `limit` bytes: then the stream is cancelled, not read on. */
async function collect(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- a stream is read in order, and stopped at the limit
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      // eslint-disable-next-line no-await-in-loop -- the loop ends here: the stream is cancelled and nothing more is read
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.length;
  }
  return joined;
}

const streamOf = (bytes: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array<ArrayBuffer>> => new Blob([bytes]).stream();

/** A link for a document: `s1.` and the deflated canonical JSON, as base64url. Over `SHARE_LIMITS.link` characters, `decodeScene` refuses it, so a caller that shows a link checks the length. */
export async function encodeScene(scene: Scene): Promise<string> {
  const packed = await collect(streamOf(new TextEncoder().encode(toCanonicalJson(scene))).pipeThrough(new CompressionStream("deflate-raw")), Infinity);
  return `${SHARE_PREFIX}${toBase64Url(packed ?? new Uint8Array(0))}`;
}

async function decode(text: string): Promise<SceneResult> {
  if (text.length > SHARE_LIMITS.link) return fail("link-too-long", `a link is at most ${String(SHARE_LIMITS.link)} characters; this one has ${String(text.length)}`);
  if (!text.startsWith(SHARE_PREFIX)) return fail("not-a-link", `a link starts with "${SHARE_PREFIX}"`);
  const packed = fromBase64Url(text.slice(SHARE_PREFIX.length));
  if (packed === undefined) return fail("bad-encoding", "what follows the prefix is not base64url");
  let inflated: Uint8Array<ArrayBuffer> | undefined;
  try {
    inflated = await collect(streamOf(packed).pipeThrough(new DecompressionStream("deflate-raw")), SHARE_LIMITS.document);
  } catch {
    return fail("bad-compression", "what follows the prefix is not deflated data");
  }
  if (inflated === undefined) return fail("document-too-large", `the document in this link is over ${String(SHARE_LIMITS.document)} bytes`);
  try {
    return migrate(new TextDecoder("utf-8", { fatal: true }).decode(inflated));
  } catch {
    return fail("invalid-json", "the document in this link is not UTF-8 text");
  }
}

/**
 * The document in a link, as `migrate` reads one (so a link made from a version 0 document, the playground's old JSON, opens as
 * a document of the current version), or the named issues. It never throws, whatever it is given.
 */
export async function decodeScene(text: string): Promise<SceneResult> {
  if (typeof text !== "string") return fail("not-a-link", "a link is text");
  try {
    return await decode(text.trim());
  } catch (error) {
    return fail("bad-compression", error instanceof Error ? error.message : "the link could not be read");
  }
}
