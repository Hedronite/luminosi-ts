// The table: every scene operation, defined once. The command line dispatches through it, and so will the MCP server: a row's
// zod input is the one source of the CLI's flags and of a tool's input schema, and `run` is the one body, so for the same input
// the two print the same envelope. A later step adds a row here (render, credits) and nowhere else.
import { z } from "zod";
import { fail, type Envelope } from "../envelope.js";
import { opNames } from "./edits.js";
import { MAX_DOCUMENT_BYTES, type Context } from "./io.js";
import { diff, exportKinds, exportScene, patch, validate } from "./ops.js";
import { MAX_SIDE, renderOperation } from "./render.js";

/** What a call needs beyond reading: nothing, a browser to render with, or permission to write a file. */
type Needs = "none" | "render" | "write";

/** A row as it is written: the input schema decides the type `run` is given. */
interface Definition<S extends z.ZodType> {
  /** The name after `scene` on the command line, and after `scene_` for a tool. */
  readonly name: string;
  readonly summary: string;
  readonly input: S;
  /** The input fields the command line fills from its positional arguments, in order. */
  readonly positional: readonly string[];
  /** True when no call of it changes anything outside the process. A row that can write a file is not read-only. */
  readonly readOnly: boolean;
  readonly needs: Needs;
  readonly run: (input: z.output<S>, ctx: Context) => Promise<Envelope>;
}

/** A row as it is kept: `run` takes any input, checks it against the row's schema and answers a bad one with a `usage` envelope. */
export interface Operation {
  readonly name: string;
  readonly summary: string;
  readonly input: z.ZodType;
  readonly positional: readonly string[];
  readonly readOnly: boolean;
  readonly needs: Needs;
  readonly run: (input: unknown, ctx: Context) => Promise<Envelope>;
}

const PATH_MAX = 4096;

/** A document: a path, `-` for stdin, or the document itself. */
const document = z.union([z.string().min(1).max(PATH_MAX), z.record(z.string(), z.unknown())], { error: 'a document is a path, "-" for stdin, or the JSON object itself' }).describe(`a path, "-" for stdin, or the document (a JSON object, at most ${String(MAX_DOCUMENT_BYTES)} bytes)`);

const out = z.string().min(1).max(PATH_MAX).optional().describe("write the result here instead of returning it; a new path unless force is set");
const force = z.boolean().optional().describe("replace the file named by out if it exists");

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** What was wrong with an input, a sentence for each: a field left out says it is required, rather than what a union would say. */
const usage = (error: z.ZodError, raw: unknown): string =>
  error.issues
    .map((issue) => {
      const [first] = issue.path;
      const missing = issue.path.length === 1 && typeof first === "string" && isRecord(raw) && !Object.hasOwn(raw, first);
      return missing ? `${first} is required` : `${issue.path.length === 0 ? "" : `${issue.path.join(".")}: `}${issue.message}`;
    })
    .join("; ");

function row<S extends z.ZodType>(definition: Definition<S>): Operation {
  return {
    ...definition,
    run: (raw, ctx) => {
      const parsed = definition.input.safeParse(raw);
      return parsed.success ? definition.run(parsed.data, ctx) : Promise.resolve(fail(`scene ${definition.name}`, "usage", usage(parsed.error, raw)));
    },
  };
}

export const operations: readonly Operation[] = [
  row({
    name: "validate",
    summary: "Read a document, migrate it, parse it and check its ids and parameters against the library; every problem with its path, and the closest ids for an unknown one.",
    input: z.strictObject({ document }),
    positional: ["document"],
    readOnly: true,
    needs: "none",
    run: validate,
  }),
  row({
    name: "diff",
    summary: "What differs between two documents, keyed by node id, and the edit operations that make the first into the second (complete: false when some change has none).",
    input: z.strictObject({ a: document, b: document }),
    positional: ["a", "b"],
    readOnly: true,
    needs: "none",
    run: diff,
  }),
  row({
    name: "patch",
    summary: `Apply edit operations (${opNames.join(", ")}) in order, atomically; the input is never modified.`,
    input: z.strictObject({
      document,
      ops: z
        .union([z.string().max(MAX_DOCUMENT_BYTES), z.array(z.unknown())], { error: "ops is a JSON array of edits, or JSON text of one" })
        .describe('the edits, in order: [{ "op": "setInk", "ink": "accent" }, { "op": "removeNode", "id": "node-1" }, { "op": "setTransform", "id": "node-2", "change": { "position": [0, 1, 0] } }, …]; the fields of each are the arguments of the package function of that name'),
      out,
      force,
    }),
    positional: ["document"],
    readOnly: false,
    needs: "write",
    run: patch,
  }),
  row({
    name: "export",
    summary: "Write a document as React code, a vanilla module, canonical JSON or a share link.",
    input: z.strictObject({ document, as: z.enum(exportKinds).describe("tsx, vanilla, json or link"), out, force }),
    positional: ["document"],
    readOnly: false,
    needs: "write",
    run: exportScene,
  }),
  row({
    name: "render",
    summary: "Draw a document to a PNG with the catalog's own scene renderer (headless Chromium on software GL, or the machine's GPU with gpu); needs the catalog built. A frame with nothing in it is refused as blank.",
    input: z.strictObject({
      document,
      out: z.string().min(1).max(PATH_MAX).describe("the PNG to write; a file that is there is replaced"),
      width: z.union([z.number().int().min(1).max(MAX_SIDE), z.string().regex(/^\d{1,5}$/, "a whole number of pixels")]).optional().describe(`pixels, 1 to ${String(MAX_SIDE)}; 512 by default`),
      height: z.union([z.number().int().min(1).max(MAX_SIDE), z.string().regex(/^\d{1,5}$/, "a whole number of pixels")]).optional().describe(`pixels, 1 to ${String(MAX_SIDE)}; 512 by default`),
      gpu: z.boolean().optional().describe("draw on the machine's GPU, not software GL"),
    }),
    positional: ["document"],
    // It writes a file (`out`), so by this table's own rule it is not read-only; what it needs beyond that is the browser.
    readOnly: false,
    needs: "render",
    run: renderOperation,
  }),
];

/** The row of a name, or undefined. */
export const operationNamed = (name: string): Operation | undefined => operations.find((operation) => operation.name === name);
