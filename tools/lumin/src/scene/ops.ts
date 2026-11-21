// The bodies of the scene operations: each takes its parsed input and a context and gives an envelope. The table (table.ts) is where they are named.
import type { Credit } from "@hedronite/lts-core";
import { creditsFor, encodeScene, SHARE_LIMITS, type Scene } from "@hedronite/lts-scene";
import { toCanonicalJson, toTsx, toVanilla } from "@hedronite/lts-scene/emit";
import { fail, ok, type Envelope } from "../envelope.js";
import { diffScenes } from "./diff.js";
import { applyOps, MAX_OPS } from "./edits.js";
import { failureEnvelope, loadDocument, MAX_DOCUMENT_BYTES, parseText, type Context, type Failure, type Source } from "./io.js";

/** The ways a document can be written out. */
export const exportKinds = ["tsx", "vanilla", "json", "link"] as const;
export type ExportKind = (typeof exportKinds)[number];

/** `valid`, the version, and what migrating did; or every issue, each with its path. Exits 1 for an invalid document. */
export async function validate(input: { readonly document: Source }, ctx: Context): Promise<Envelope> {
  const loaded = await loadDocument(input.document, ctx);
  if (!loaded.ok) return failureEnvelope("scene validate", loaded.failure);
  const { version, migratedFrom } = loaded.value;
  return ok("scene validate", { valid: true, version, ...(migratedFrom === undefined ? {} : { migratedFrom }), issues: [] });
}

const withWhich = (which: "a" | "b", failure: Failure): Failure => ({ ...failure, data: { which, ...failure.data } });

/** What differs between two documents, and the operations that make the first into the second. */
export async function diff(input: { readonly a: Source; readonly b: Source }, ctx: Context): Promise<Envelope> {
  if (input.a === "-" && input.b === "-") return fail("scene diff", "usage", "only one of the two documents can come from stdin");
  const a = await loadDocument(input.a, ctx);
  if (!a.ok) return failureEnvelope("scene diff", withWhich("a", a.failure));
  const b = await loadDocument(input.b, ctx);
  if (!b.ok) return failureEnvelope("scene diff", withWhich("b", b.failure));
  const { same, complete, changes, ops, unexpressed } = diffScenes(a.value.scene, b.value.scene);
  return ok("scene diff", {
    same,
    complete,
    changes,
    ops,
    unexpressed,
    ...(complete ? {} : { note: "ops do not reproduce the second document: the changes listed in unexpressed have no edit operation, so applying ops leaves them as they were in the first" }),
  });
}

/** The operations of a patch: a list, or JSON text of one. A text that is not JSON says where, and a list that is too long is refused. */
function operationsOf(ops: string | readonly unknown[]): { readonly ok: true; readonly ops: readonly unknown[] } | { readonly ok: false; readonly failure: Failure } {
  let list: unknown = ops;
  if (typeof ops === "string") {
    if (Buffer.byteLength(ops) > MAX_DOCUMENT_BYTES) return { ok: false, failure: { kind: "too_large", error: `the operations are over ${String(MAX_DOCUMENT_BYTES)} bytes` } };
    const parsed = parseText(ops);
    if (!parsed.ok) return { ok: false, failure: parsed.failure };
    list = parsed.value;
  }
  if (!Array.isArray(list)) return { ok: false, failure: { kind: "invalid", error: "the operations are a JSON array of edits, each { \"op\": \"setInk\", … }" } };
  if (list.length > MAX_OPS) return { ok: false, failure: { kind: "too_large", error: `a patch holds at most ${String(MAX_OPS)} operations, and this one has ${String(list.length)}` } };
  return { ok: true, ops: list };
}

/** Writes `text` to `out` when it is given, and says so; otherwise hands `whole` back for stdout. */
function deliver(command: string, ctx: Context, text: string, out: string | undefined, force: boolean | undefined, whole: Readonly<Record<string, unknown>>, written: Readonly<Record<string, unknown>>): Envelope {
  if (out === undefined) return ok(command, whole);
  const wrote = ctx.files.write(out, text, force === true);
  return wrote.ok ? ok(command, { ...written, out, bytes: wrote.value }) : failureEnvelope(command, wrote.failure);
}

/**
 * The document with the operations applied in order, atomically: the first step that fails is the answer (its index and issues) and
 * no document comes back. The input is never modified. The result is in the envelope, or written to `out`, a new path unless `force`.
 */
export async function patch(input: { readonly document: Source; readonly ops: string | readonly unknown[]; readonly out?: string | undefined; readonly force?: boolean | undefined }, ctx: Context): Promise<Envelope> {
  const loaded = await loadDocument(input.document, ctx);
  if (!loaded.ok) return failureEnvelope("scene patch", loaded.failure);
  const operations = operationsOf(input.ops);
  if (!operations.ok) return failureEnvelope("scene patch", operations.failure);
  const applied = applyOps(loaded.value.scene, operations.ops, ctx);
  if (!applied.ok) return fail("scene patch", "invalid", applied.error, { data: { valid: false, index: applied.index, issues: applied.issues } });
  return deliver("scene patch", ctx, toCanonicalJson(applied.scene), input.out, input.force, { applied: operations.ops.length, document: applied.scene }, { applied: operations.ops.length });
}

function textOf(scene: Scene, as: ExportKind, credited: readonly Credit[]): string | Promise<string> {
  switch (as) {
    case "tsx":
      return toTsx(scene, { credits: credited });
    case "vanilla":
      return toVanilla(scene, { credits: credited });
    case "json":
      return toCanonicalJson(scene);
    case "link":
      return encodeScene(scene);
  }
}

/**
 * The work of others a document uses: its look, its assets, its materials, shaders and effects that came from vendored work, each with
 * what it is, where it lives, at what pin, under which license, and whose it is. An empty list is a document that uses none.
 */
export async function credits(input: { readonly document: Source }, ctx: Context): Promise<Envelope> {
  const loaded = await loadDocument(input.document, ctx);
  if (!loaded.ok) return failureEnvelope("scene credits", loaded.failure);
  const list = creditsFor(loaded.value.scene, ctx.resolve);
  return ok("scene credits", { count: list.length, credits: list });
}

/**
 * The document as React code, as a vanilla module, as canonical JSON or as a share link; a link over 16 KiB is refused. React code and a
 * vanilla module carry the credits of what the document uses (a header of comments and a credits export) unless noCredits is set, which is for tests.
 */
export async function exportScene(input: { readonly document: Source; readonly as: ExportKind; readonly noCredits?: boolean | undefined; readonly out?: string | undefined; readonly force?: boolean | undefined }, ctx: Context): Promise<Envelope> {
  const loaded = await loadDocument(input.document, ctx);
  if (!loaded.ok) return failureEnvelope("scene export", loaded.failure);
  const text = await textOf(loaded.value.scene, input.as, input.noCredits === true ? [] : creditsFor(loaded.value.scene, ctx.resolve));
  if (input.as === "link" && text.length > SHARE_LIMITS.link) {
    return fail("scene export", "too_large", `the link is ${String(text.length)} characters; a link is at most ${String(SHARE_LIMITS.link)}, so export as json instead`);
  }
  return deliver("scene export", ctx, text, input.out, input.force, { as: input.as, bytes: Buffer.byteLength(text), text }, { as: input.as });
}
