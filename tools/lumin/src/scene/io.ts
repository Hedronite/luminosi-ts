// Reading a scene document for the scene operations: from a path, from stdin (`-`) or given inline. Whatever the way in,
// the document is read, migrated, parsed and checked against the registry the same way, so the way in changes nothing.
import { randomUUID } from "node:crypto";
import { closeSync, constants, lstatSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { loadDescriptors } from "@hedronite/lts-registry";
import { assetCredit, checkRefs, lookCredit, migrate, SCENE_VERSION, SHARE_LIMITS, type RefKind, type Resolve, type Scene } from "@hedronite/lts-scene";
import { presets } from "@hedronite/lts-tokens";
import { distance } from "../commands.js";
import { fail, type Envelope } from "../envelope.js";

/** The most a document may be, in bytes: what a document inflated from a link may be. A larger one is refused unread, never cut to fit. */
export const MAX_DOCUMENT_BYTES: number = SHARE_LIMITS.document;

/** A document by path, by `-` (read stdin), or the document itself. */
export type Source = string | { readonly [key: string]: unknown };

/** One thing wrong with a document, in the words of the scene package, with the closest ids where an id is unknown. */
export interface ReportedIssue {
  readonly path: readonly (string | number)[];
  readonly code: string;
  readonly message: string;
  readonly matches?: readonly string[];
  /** For a JSON syntax error: where, counting from 1. */
  readonly line?: number;
  readonly column?: number;
}

/** What went wrong, as the envelope will say it. */
export interface Failure {
  readonly kind: string;
  readonly error: string;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly matches?: readonly string[];
}

export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: Failure };

const good = <T>(value: T): Outcome<T> => ({ ok: true, value });
const bad = <T>(kind: string, error: string, data?: Readonly<Record<string, unknown>>): Outcome<T> => ({ ok: false, failure: { kind, error, ...(data === undefined ? {} : { data }) } });

/** The failure as an envelope for `command`. */
export const failureEnvelope = (command: string, failure: Failure): Envelope =>
  fail(command, failure.kind, failure.error, { ...(failure.matches === undefined ? {} : { matches: failure.matches }), ...(failure.data === undefined ? {} : { data: failure.data }) });

/** What the operations touch outside themselves: the files they read and write. MCP's server gives a version that holds them to its roots. */
export interface Files {
  read(path: string): Outcome<string>;
  write(path: string, text: string, force: boolean): Outcome<number>;
  /**
   * Writes bytes that are not text (a PNG). A new path is made with `O_EXCL | O_NOFOLLOW`, so a link put there after the path was judged is refused
   * and never followed; with `force` a temporary file is written beside it and renamed over it, so a link at the path is replaced, not followed.
   */
  writeBytes(path: string, bytes: Uint8Array, force: boolean): Outcome<number>;
  /** Whether anything is at the path, a link included (a link that leads nowhere is something there). */
  exists(path: string): Outcome<boolean>;
}

/** What an operation is run with: how ids resolve, which files it may touch, and where stdin is. */
export interface Context {
  readonly resolve: Resolve;
  /** Every id of a kind, for the closest ids of a mistyped one. */
  readonly ids: (kind: RefKind) => readonly string[];
  readonly files: Files;
  readonly stdin: () => Promise<Outcome<string>>;
}

/** A document of the current version, read: and, when it was older, the version it was. */
export interface Loaded {
  readonly scene: Scene;
  readonly version: number;
  readonly migratedFrom?: number;
}

const tooLarge = <T>(what: string, size: string): Outcome<T> => bad("too_large", `${what} is ${size}; a scene document is at most ${String(MAX_DOCUMENT_BYTES)} bytes, and a larger one is refused, not cut`);

const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);

/** The text of bytes, or a failure when they are not UTF-8. A leading byte order mark is not part of the text. */
function decode(bytes: Uint8Array): Outcome<string> {
  try {
    return good(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes).replace(BOM, ""));
  } catch {
    return bad("invalid", "the document is not UTF-8 text");
  }
}

/** Where in a text a JSON syntax error is, as a line and a column counted from 1. */
export function lineAndColumn(text: string, offset: number): { readonly line: number; readonly column: number } {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  return { line, column: offset - (before.lastIndexOf("\n") + 1) + 1 };
}

class Stopped extends Error {
  readonly offset: number;
  constructor(offset: number, message: string) {
    super(message);
    this.offset = offset;
  }
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/**
 * The first place a text stops being JSON, and why, or undefined for JSON. `JSON.parse` says where in some engines and not in others, so
 * this reads the text itself (a small descent over the grammar) and the answer is the same everywhere.
 */
export function jsonSyntaxError(text: string): { readonly offset: number; readonly message: string } | undefined {
  let at = 0;
  const found = (): string => (at >= text.length ? "the end of the text" : JSON.stringify(text[at]));
  const stop = (message: string): never => {
    throw new Stopped(at, message);
  };
  const space = (): void => {
    while (at < text.length && " \t\n\r".includes(text[at] ?? "x")) at += 1;
  };
  const expect = (what: string): never => stop(`expected ${what}, found ${found()}`);
  const word = (literal: string): void => {
    for (const expected of literal) {
      if (text[at] !== expected) expect(`"${literal}"`);
      at += 1;
    }
  };
  const string = (): void => {
    at += 1;
    for (;;) {
      const c = text[at];
      if (c === undefined) stop("the string is never closed");
      else if (c === '"') {
        at += 1;
        return;
      } else if (c === "\\") {
        const next = text[at + 1];
        if (next !== undefined && '"\\/bfnrt'.includes(next)) at += 2;
        else if (next === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(at + 2, at + 6))) at += 6;
        else {
          at += 1;
          stop("a backslash in a string must start an escape");
        }
      } else if (c.charCodeAt(0) < 0x20) stop("a line break or control character inside a string");
      else at += 1;
    }
  };
  const value = (depth: number): void => {
    if (depth > 256) stop("the document is nested too deeply");
    space();
    const c = text[at];
    if (c === "{") {
      at += 1;
      space();
      if (text[at] === "}") {
        at += 1;
        return;
      }
      for (;;) {
        space();
        if (text[at] !== '"') expect("a key in double quotes");
        string();
        space();
        if (text[at] !== ":") expect('":"');
        at += 1;
        value(depth + 1);
        space();
        if (text[at] === ",") at += 1;
        else if (text[at] === "}") {
          at += 1;
          return;
        } else expect('"," or "}"');
      }
    } else if (c === "[") {
      at += 1;
      space();
      if (text[at] === "]") {
        at += 1;
        return;
      }
      for (;;) {
        value(depth + 1);
        space();
        if (text[at] === ",") at += 1;
        else if (text[at] === "]") {
          at += 1;
          return;
        } else expect('"," or "]"');
      }
    } else if (c === '"') string();
    else if (c === "t") word("true");
    else if (c === "f") word("false");
    else if (c === "n") word("null");
    else {
      NUMBER.lastIndex = at;
      if (NUMBER.exec(text) === null) expect("a value");
      at = NUMBER.lastIndex;
    }
  };
  try {
    value(0);
    space();
    if (at < text.length) stop(`the document ends before ${found()}`);
    return undefined;
  } catch (error) {
    if (error instanceof Stopped) return { offset: error.offset, message: error.message };
    throw error;
  }
}

/** The value of JSON text, or an `invalid` failure that says where the syntax stops being JSON. */
export function parseText(text: string): Outcome<unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return good(value);
  } catch (error) {
    const found = jsonSyntaxError(text) ?? { offset: 0, message: error instanceof Error ? error.message : "not JSON" };
    const { line, column } = lineAndColumn(text, found.offset);
    const message = `not JSON at line ${String(line)}, column ${String(column)}: ${found.message}`;
    const issue: ReportedIssue = { path: [], code: "invalid-json", message: found.message, line, column };
    return bad("invalid", message, { valid: false, line, column, issues: [issue] });
  }
}

/** The raw value of a source: parsed text, or the inline object. Its size is held to the cap before anything is parsed. */
async function acquire(source: Source, ctx: Context): Promise<Outcome<unknown>> {
  if (typeof source === "object") {
    let size: number;
    try {
      size = Buffer.byteLength(JSON.stringify(source));
    } catch {
      return bad("invalid", "the inline document is not JSON");
    }
    return size > MAX_DOCUMENT_BYTES ? tooLarge("the inline document", `${String(size)} bytes`) : good(source);
  }
  const read = source === "-" ? await ctx.stdin() : ctx.files.read(source);
  return read.ok ? parseText(read.value) : read;
}

/** The version a document says it has: 0 for a document that says neither format nor version (the playground's old JSON), nothing where it is not a number. */
function declaredVersion(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const format: unknown = Reflect.get(value, "format");
  const version: unknown = Reflect.get(value, "version");
  if (format === undefined && version === undefined) return 0;
  return typeof version === "number" && Number.isInteger(version) ? version : undefined;
}

const KIND_OF: Readonly<Record<string, RefKind>> = {
  "unknown-primitive": "primitive",
  "unknown-object": "object",
  "unknown-material": "material",
  "unknown-shader": "shader",
  "unknown-effect": "effect",
  "unknown-look": "look",
};

/** The candidates nearest in spelling to `id`, nearest first: a few edits away, or one holding the other. */
export function closestIds(id: string, candidates: readonly string[], limit = 5): readonly string[] {
  const scored = candidates
    .map((candidate) => ({ candidate, d: distance(id, candidate), within: candidate.includes(id) || id.includes(candidate) }))
    .filter(({ candidate, d, within }) => within || d <= Math.max(2, Math.ceil(candidate.length * 0.3)));
  return scored
    .sort((x, y) => x.d - y.d || (x.candidate < y.candidate ? -1 : 1))
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

/** The value at a path of keys and indexes, or undefined. */
function at(root: unknown, path: readonly (string | number)[]): unknown {
  let current = root;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = Reflect.get(current, key);
  }
  return current;
}

/** What `checkRefs` finds against the registry, as issues, with the closest ids on every unknown one. */
export function refIssues(scene: Scene, ctx: Context): readonly ReportedIssue[] {
  return checkRefs(scene, ctx.resolve).map((issue) => {
    const kind = KIND_OF[issue.code];
    const named = kind === undefined ? undefined : at(scene, issue.path);
    return { path: issue.path, code: issue.code, message: issue.message, ...(kind === undefined || typeof named !== "string" ? {} : { matches: closestIds(named, ctx.ids(kind)) }) };
  });
}

/** The summary line of a list of issues: how many, and the first. */
export function summary(issues: readonly ReportedIssue[]): string {
  const first = issues[0];
  const where = first === undefined || first.path.length === 0 ? "" : `${first.path.join(".")}: `;
  return `${String(issues.length)} issue${issues.length === 1 ? "" : "s"}${first === undefined ? "" : `; first, ${where}${first.message}`}`;
}

/** The `invalid` failure for a document with issues. */
function invalid(issues: readonly ReportedIssue[], version?: number): Outcome<never> {
  return bad("invalid", summary(issues), { valid: false, ...(version === undefined ? {} : { version }), issues });
}

/**
 * Reads a document from a path, stdin or an inline object, and brings it up to the current version, parses it and checks its ids and
 * parameters against the registry. Over `MAX_DOCUMENT_BYTES` it is `too_large`; bad JSON is `invalid` with a line and a column;
 * a document with problems is `invalid` with every one of them. Nothing here throws on the document.
 */
export async function loadDocument(source: Source, ctx: Context): Promise<Outcome<Loaded>> {
  const raw = await acquire(source, ctx);
  if (!raw.ok) return raw;
  const { value } = raw;
  const declared = declaredVersion(value);
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid([{ path: [], code: "wrong-type", message: "a scene document is a JSON object" }]);
  const read = migrate(value);
  if (!read.ok) return invalid(read.issues, declared);
  const issues = refIssues(read.scene, ctx);
  if (issues.length > 0) return invalid(issues, declared);
  return good({ scene: read.scene, version: SCENE_VERSION, ...(declared !== undefined && declared < SCENE_VERSION ? { migratedFrom: declared } : {}) });
}

/** Why a file was not written, in the words every write gives. */
function notWritten(error: unknown): Outcome<never> {
  const code = error instanceof Error && "code" in error ? error.code : undefined;
  if (code === "EEXIST" || code === "ELOOP") return bad("exists", "that file exists; name a new path, or pass --force to replace it");
  if (code === "ENOENT") return bad("failed", "the folder for that file does not exist");
  return bad("failed", "the file could not be written");
}

/** Files on disk, as the command line sees them. A path is never echoed in a failure beyond what the caller typed. */
export const diskFiles: Files = {
  read(path) {
    try {
      const stat = statSync(path);
      if (!stat.isFile()) return bad("failed", "that path is not a file");
      if (stat.size > MAX_DOCUMENT_BYTES) return tooLarge("the file", `${String(stat.size)} bytes (nothing was read)`);
      return decode(readFileSync(path));
    } catch (error) {
      return error instanceof Error && "code" in error && error.code === "ENOENT" ? bad("not_found", "no such file") : bad("failed", "the file could not be read");
    }
  },
  write(path, text, force) {
    try {
      writeFileSync(path, text, { flag: force ? "w" : "wx" });
      return good(Buffer.byteLength(text));
    } catch (error) {
      return notWritten(error);
    }
  },
  writeBytes(path, bytes, force) {
    const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL;
    if (!force) {
      try {
        const file = openSync(path, flags | constants.O_NOFOLLOW, 0o666);
        try {
          writeFileSync(file, bytes);
        } finally {
          closeSync(file);
        }
        return good(bytes.length);
      } catch (error) {
        return notWritten(error);
      }
    }
    const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
    try {
      const file = openSync(temp, flags, 0o666);
      try {
        writeFileSync(file, bytes);
      } finally {
        closeSync(file);
      }
      renameSync(temp, path);
      return good(bytes.length);
    } catch (error) {
      rmSync(temp, { force: true });
      return notWritten(error);
    }
  },
  exists(path) {
    try {
      lstatSync(path);
      return good(true);
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code === "ENOENT" || code === "ENOTDIR") return good(false);
      return bad("failed", "the path could not be looked at");
    }
  },
};

/** Stdin, read up to the cap and no further. */
async function readStdin(): Promise<Outcome<string>> {
  if (process.stdin.isTTY) return bad("usage", "`-` reads the document from stdin, and stdin is a terminal: pipe it in");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += piece.length;
    if (size > MAX_DOCUMENT_BYTES) {
      process.stdin.destroy();
      return tooLarge("stdin", `over ${String(MAX_DOCUMENT_BYTES)} bytes (the rest was not read)`);
    }
    chunks.push(piece);
  }
  return decode(Buffer.concat(chunks));
}

/** The context the command line runs with, whose ids resolve with the credit of the work they came from: the registry's descriptors, the looks the tokens ship, files on disk and process stdin. */
export async function nodeContext(): Promise<Context> {
  const registry = await loadDescriptors();
  const looks = presets.map((preset) => preset.id);
  return {
    resolve: (kind, id) => {
      if (kind === "look") {
        const credit = lookCredit(id);
        return looks.includes(id) ? (credit === undefined ? {} : { credit }) : undefined;
      }
      const descriptor = registry.get(id);
      if (descriptor?.meta.kind !== kind) return undefined;
      const credit = assetCredit(descriptor.meta);
      return credit === undefined ? descriptor : { parameters: descriptor.parameters, credit };
    },
    ids: (kind) => (kind === "look" ? looks : registry.list().filter((descriptor) => descriptor.meta.kind === kind).map((descriptor) => descriptor.meta.id)),
    files: diskFiles,
    stdin: readStdin,
  };
}
