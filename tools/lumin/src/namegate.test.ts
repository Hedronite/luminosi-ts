import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { root } from "./commands.js";
import { allowed, hashes, salt } from "./namegate.hashes.js";

/**
 * The name gate for the tracked tree. Every word token of every tracked text file is hashed with a
 * salt and compared with `hashes`, so the list of gated names is never in the repo in clear.
 *
 * Tokens are runs of letters and digits, compared case-insensitively. A hyphen or underscore joins
 * parts, and every run of one to four consecutive parts is tried too (`a-b-c` yields `a`, `b`, `c`,
 * `a-b`, `b-c`, `a-b-c`), so a hyphenated name is found and so is a name inside a longer slug.
 * Parts are also split where a lower-case letter meets an upper-case one (`fooBar` yields `foo` and
 * `bar`) and where letters meet digits (`foo2` and `2foo` both yield `foo`), so a name inside an
 * identifier, a numbered host or a versioned slug is found too.
 * Common words that are also gated names are not hashed at all: they stay under review of public
 * text, because a word-wide allow-list would hide real hits.
 */

/** Trees that are someone else's code and are never read by this gate. */
const skipped = ["assets/vendor/", "tools/img-to-object/upstream/"];

/** A vendored folder's pin is ours, not someone else's code: it is read by the gate whatever tree it is in (a pin field may carry no name, SPEC-wave9 S2). */
const isPin = (file: string): boolean => /^assets\/vendor\/[^/]+\/vendor\.json$/.test(file);

const hashToken = (token: string): string => createHash("sha256").update(salt + token.toLowerCase()).digest("hex");

const runPattern = /[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*/g;
const maxParts = 4;

/**
 * Split a part where a lower-case letter is followed by an upper-case one (`fooBar` gives `foo`,
 * `Bar`) and wherever a letter meets a digit, in either order (`foo2` gives `foo`, `2`; `2foo` gives `2`, `foo`).
 */
const boundaryParts = (part: string): readonly string[] => part.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Za-z])(?=[0-9])|(?<=[0-9])(?=[A-Za-z])/);

/** Every run of one to `maxParts` consecutive parts, joined with a hyphen. */
const windows = (parts: readonly string[]): readonly string[] => {
  const out: string[] = [];
  for (let from = 0; from < parts.length; from += 1) {
    for (let to = from + 1; to <= Math.min(parts.length, from + maxParts); to += 1) out.push(parts.slice(from, to).join("-"));
  }
  return out;
};

const partBoundary = /[a-z][A-Z]|[A-Za-z][0-9]|[0-9][A-Za-z]/;
const hasLetter = /[A-Za-z]/;
const joiner = /[-_]/;

/** Every token the gate compares in one line: the parts as written, and the parts split at camelCase and letter-digit boundaries. */
const tokensOf = (line: string): readonly string[] => {
  const out: string[] = [];
  for (const run of line.matchAll(runPattern)) {
    const text = run[0];
    // A run of digits only (most of an SVG path, say) holds no name.
    if (!hasLetter.test(text)) continue;
    const bounded = partBoundary.test(text);
    if (!bounded && !joiner.test(text)) {
      out.push(text);
      continue;
    }
    const parts = text.split(joiner);
    out.push(...windows(parts));
    if (bounded) {
      const split = parts.flatMap(boundaryParts);
      // A window of digits alone holds no name, and a long hash or checksum would otherwise add many of them.
      if (split.length !== parts.length) out.push(...windows(split).filter((window) => hasLetter.test(window)));
    }
  }
  return out;
};

interface Hit {
  readonly file: string;
  readonly line: number;
  /** The hash of the matched token (never the token), or the matched text of a pattern hit. */
  readonly what: string;
  readonly kind: "name" | "label" | "address";
}

/** Internal step labels such as a wave and step pair, and any address in the tailnet range. */
const labelPattern = /\bW[0-9]+ ?G[0-9]+\b/;
const addressPattern = /\b100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]{1,3}\.[0-9]{1,3}\b/;

/** Each distinct token is hashed once for the whole tree. */
const memo = new Map<string, string>();
const hashCached = (token: string): string => {
  let hash = memo.get(token);
  if (hash === undefined) {
    hash = hashToken(token);
    memo.set(token, hash);
  }
  return hash;
};

/** Every hit in one file's text. `gated` is the set of hashes to match. */
const scanText = (file: string, text: string, gated: ReadonlySet<string>, firstLine = 1): readonly Hit[] => {
  const hits: Hit[] = [];
  text.split("\n").forEach((content, index) => {
    const line = index + firstLine;
    const seen = new Set<string>();
    for (const token of tokensOf(content)) {
      const hash = hashCached(token);
      if (gated.has(hash) && !seen.has(hash)) {
        seen.add(hash);
        hits.push({ file, line, what: hash, kind: "name" });
      }
    }
    // Cheap guards first: both patterns need a literal the line must hold.
    const label = content.includes("W") ? labelPattern.exec(content)?.[0] : undefined;
    if (label !== undefined) hits.push({ file, line, what: label, kind: "label" });
    const address = content.includes("100.") ? addressPattern.exec(content)?.[0] : undefined;
    if (address !== undefined) hits.push({ file, line, what: address, kind: "address" });
  });
  return hits;
};

/** Tracked files and new files not ignored by git, minus the vendored trees. */
const textFiles = (): readonly string[] => {
  const listed = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return listed
    .split("\0")
    .filter((file) => file !== "" && (isPin(file) || !skipped.some((tree) => file.startsWith(tree))) && existsSync(join(root, file)))
    .sort();
};

/** How many bytes of text one part of the scan holds, at most: about a second of work on a CI runner. */
const partBytes = 1_000_000;

/** A part of the scan: a file, or the `index`th of `of` runs of lines of a file too big for one part. */
interface Slice {
  readonly file: string;
  readonly index: number;
  readonly of: number;
}

/** The slices of every file, in order, in parts of about `partBytes` each, so that no part is much slower than another. */
const partsOf = (all: readonly string[]): readonly (readonly Slice[])[] => {
  const out: Slice[][] = [];
  let current: Slice[] = [];
  let size = 0;
  const add = (slice: Slice, bytes: number): void => {
    if (current.length > 0 && size + bytes > partBytes) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(slice);
    size += bytes;
  };
  for (const file of all) {
    const bytes = statSync(join(root, file)).size;
    const of = Math.max(1, Math.ceil(bytes / partBytes));
    for (let index = 0; index < of; index += 1) add({ file, index, of }, bytes / of);
  }
  if (current.length > 0) out.push(current);
  return out;
};

/** The lines of `lines` that the `index`th of `of` slices holds: each line belongs to exactly one slice. */
const sliceOf = <T,>(lines: readonly T[], index: number, of: number): readonly T[] => lines.slice(Math.floor((lines.length * index) / of), Math.floor((lines.length * (index + 1)) / of));

/** Binary files hold a NUL byte early; they are skipped. */
const readText = (file: string): string | undefined => {
  const bytes = readFileSync(join(root, file));
  return bytes.subarray(0, 8192).includes(0) ? undefined : bytes.toString("utf8");
};

const isAllowed = (hit: Hit, list: typeof allowed = allowed): boolean =>
  hit.kind === "name" && list.some((entry) => entry.file === hit.file && entry.line === hit.line && entry.hash === hit.what);

const show = (hit: Hit): string => `${hit.file}:${String(hit.line)} ${hit.kind === "name" ? `gated name (hash ${hit.what.slice(0, 8)})` : `${hit.kind} ${hit.what}`}`;

describe("the name gate", () => {
  const fake = new Set([hashToken("zzplanted")]);
  const files = textFiles();
  const parts = partsOf(files);

  it("matches whole words, case-insensitively, and nothing inside a longer word", () => {
    expect(scanText("a.md", "the ZzPlanted host", fake)).toHaveLength(1);
    expect(scanText("a.md", "the zzplanteds host and azzplanted", fake)).toEqual([]);
    expect(scanText("a.md", "zzplanted.example, `zzplanted`, (zzplanted)", fake)).toHaveLength(1);
  });

  it("finds a name inside a camelCase identifier, and not inside a longer lower-case word", () => {
    expect(scanText("a.ts", "const myZzplantedHost = 1;", fake)).toHaveLength(1);
    expect(scanText("a.ts", "const zzplantedHost = 1;", fake)).toHaveLength(1);
    expect(scanText("a.ts", "const hostZzplanted = 1;", fake)).toHaveLength(1);
    expect(scanText("a.ts", "const hostzzplanted = 1; const myZzplantedsHost = 2;", fake)).toEqual([]);
    const pair = new Set([hashToken("zz-planted")]);
    expect(scanText("a.ts", "const myZzPlantedHost = 1;", pair)).toHaveLength(1);
  });

  it("finds a name that has digits after it or before it, and not one inside a longer word", () => {
    expect(scanText("a.md", "ssh zzplanted2", fake)).toHaveLength(1);
    expect(scanText("a.md", "ssh 2zzplanted", fake)).toHaveLength(1);
    expect(scanText("a.md", "ssh zzplanted22 and ZZPLANTED7x", fake)).toHaveLength(1);
    expect(scanText("a.ts", "const zzplanted2Host = 1; const host2Zzplanted = 2;", fake)).toHaveLength(1);
    expect(scanText("a.md", "ssh zzplanted-2 or zzplanted_2", fake)).toHaveLength(1);
    expect(scanText("a.md", "ssh azzplanted2 or 2zzplanteds or 2azzplanted", fake)).toEqual([]);
    // A gated name that itself holds a digit is still found as written.
    expect(scanText("a.md", "run on zz9planted", new Set([hashToken("zz9planted")]))).toHaveLength(1);
  });

  it("finds a hyphenated name, a name in a slug and a name after an underscore", () => {
    const hyphenated = new Set([hashToken("zz-planted-box")]);
    expect(scanText("a.md", "run on zz-planted-box today", hyphenated)).toHaveLength(1);
    expect(scanText("a.md", "run on zz-planted-boxes today", hyphenated)).toEqual([]);
    expect(scanText("a.md", "notes-from-zzplanted-run", fake)).toHaveLength(1);
    expect(scanText("a.md", "ZZPLANTED_host", fake)).toHaveLength(1);
  });

  it("finds a planted name in a Markdown file and a TypeScript file alike", () => {
    const prefix = (([...fake][0]) ?? "").slice(0, 8);
    expect(scanText("docs/plant.md", "Deployed on zzplanted.\n", fake).map(show)).toEqual([`docs/plant.md:1 gated name (hash ${prefix})`]);
    expect(scanText("src/plant.ts", 'export const host = "zzplanted";\n', fake)).toHaveLength(1);
  });

  it("finds an internal step label and a tailnet address", () => {
    // Built from parts so this file holds no label or address itself.
    const label = (wave: string, step: string, glue = " "): string => `added in W${wave}${glue}G${step}`;
    const address = (...octets: readonly number[]): string => `ssh ${octets.join(".")}`;
    expect(scanText("a.md", label("1", "4"), new Set())).toHaveLength(1);
    expect(scanText("a.md", label("12", "3", ""), new Set())).toHaveLength(1);
    expect(scanText("a.md", address(100, 70, 1, 2), new Set())).toHaveLength(1);
    expect(scanText("a.md", address(100, 127, 255, 255), new Set())).toHaveLength(1);
    expect(scanText("a.md", [address(100, 128, 0, 1), address(100, 63, 1, 1), address(1100, 70, 1, 2)].join(" and "), new Set())).toEqual([]);
  });

  it("allows one place only: the same file and line and the same hash", () => {
    const hit = scanText("LICENSE", "x zzplanted", fake)[0];
    const hash = [...fake][0] ?? "";
    expect(hit).toBeDefined();
    if (hit === undefined) return;
    expect(isAllowed(hit)).toBe(false);
    expect(isAllowed(hit, [{ file: "LICENSE", line: 1, hash }])).toBe(true);
    expect(isAllowed(hit, [{ file: "LICENSE", line: 2, hash }])).toBe(false);
    expect(isAllowed(hit, [{ file: "README.md", line: 1, hash }])).toBe(false);
    expect(isAllowed(hit, [{ file: "LICENSE", line: 1, hash: hashToken("other") }])).toBe(false);
    // A second gated word on the allowed line is still a hit.
    const both = scanText("LICENSE", "zzplanted zzother", new Set([hash, hashToken("zzother")]));
    expect(both.filter((entry) => !isAllowed(entry, [{ file: "LICENSE", line: 1, hash }]))).toHaveLength(1);
  });

  it("keeps the hashed list well formed and the allow-list free of stale entries", () => {
    expect(hashes.every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
    expect(new Set(hashes).size).toBe(hashes.length);
    const stale = allowed.filter((entry) => {
      const text = existsSync(join(root, entry.file)) ? readText(entry.file) : undefined;
      if (text === undefined) return true;
      return !scanText(entry.file, text, new Set(hashes)).some((hit) => hit.line === entry.line && hit.what === entry.hash);
    });
    expect(stale).toEqual([]);
  });

  it("reads every vendored folder's pin, and no other file of a vendored tree", () => {
    expect(files.filter(isPin).length).toBeGreaterThanOrEqual(11);
    expect(files.filter((file) => file.startsWith("assets/vendor/") && !isPin(file))).toEqual([]);
  });

  it("splits the tree into parts that together hold every file, and every line of a file, once", () => {
    const seen = new Map<string, number>();
    for (const slice of parts.flat()) seen.set(slice.file, (seen.get(slice.file) ?? 0) + 1 / slice.of);
    expect([...seen.keys()]).toEqual(files);
    expect([...seen.values()].every((count) => Math.abs(count - 1) < 1e-9)).toBe(true);
    expect(parts.every((part) => part.length > 0)).toBe(true);
    const lines = Array.from({ length: 1003 }, (_, line) => line);
    for (const of of [1, 2, 3, 7]) expect(Array.from({ length: of }, (_, index) => sliceOf(lines, index, of)).flat()).toEqual(lines);
  });

  // The whole tree in one test took longer than a unit test should: icon packs alone are most of its bytes. Each part is a test of its own, so
  // a slow runner stretches a part and not one test past its limit, and a failure names the files of the part that found it.
  parts.forEach((part, index) => {
    const first = part[0];
    const last = part.at(-1);
    it(`finds no gated name, step label or tailnet address in a part of the tracked text files outside the vendored trees (${String(index + 1)} of ${String(parts.length)}: ${first?.file ?? ""} to ${last?.file ?? ""})`, () => {
      const gated = new Set(hashes);
      const hits: Hit[] = [];
      for (const { file, index: at, of } of part) {
        const text = readText(file);
        if (text === undefined) continue;
        if (of === 1) {
          hits.push(...scanText(file, text, gated));
          continue;
        }
        const lines = text.split("\n");
        const before = Math.floor((lines.length * at) / of);
        hits.push(...scanText(file, sliceOf(lines, at, of).join("\n"), gated, before + 1));
      }
      expect(hits.filter((hit) => !isAllowed(hit)).map(show)).toEqual([]);
    });
  });
});
