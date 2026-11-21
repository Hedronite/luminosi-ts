// The tools of `lumin mcp`: one per row of the scene table (the row's zod input is the tool's input schema and its `run` is the tool's body, so for the
// same input the tool and the command line give the same envelope), and two read-only asset tools that wrap `lumin search` and `lumin show`.
// What a client may not do is refused here, before a row runs: writing a file without `--allow-write`, rendering without both `--allow-render`
// and `--allow-write`, and any path outside the roots. A tool that is not listed is not callable.
import { sep } from "node:path";
import { z } from "zod";
import { assetKinds } from "@hedronite/lts-core";
import { root as installRoot, search, show } from "../commands.js";
import { fail, type Envelope } from "../envelope.js";
import { failureEnvelope, nodeContext, type Context } from "../scene/io.js";
import { operations, type Operation } from "../scene/table.js";
import { locate, NO_STDIN, rootFiles, WRITE_NOT_ALLOWED } from "./roots.js";

/** What a server is started with. */
export interface Options {
  /** The real paths of the roots, in the order given. */
  readonly roots: readonly string[];
  readonly allowWrite: boolean;
  readonly allowRender: boolean;
}

/** A tool as `tools/list` gives it. */
interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly annotations: { readonly readOnlyHint: boolean; readonly destructiveHint: boolean; readonly idempotentHint: boolean; readonly openWorldHint: boolean };
}

/** A tool's answer: the envelope as the structured result, the same JSON on one line as the text, and `isError` exactly when the envelope is not ok. */
interface ToolResult {
  readonly [key: string]: unknown;
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly structuredContent: Readonly<Record<string, unknown>>;
  readonly isError: boolean;
}

/** The tools of a server: what it lists, and how a call is answered (undefined for a name it does not list). */
export interface Tools {
  readonly list: () => readonly Tool[];
  readonly call: (name: string, args: Readonly<Record<string, unknown>>) => Promise<ToolResult> | undefined;
}

/** The longest any string in a tool's input may be, where its row sets no shorter. */
const STRING_MAX = 4096;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Every string of a schema gets a `maxLength`: the row's own where it set one, and `STRING_MAX` where it did not. */
function capped(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(capped);
  if (!isRecord(schema)) return schema;
  const copy: Record<string, unknown> = Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, capped(value)]));
  if (copy["type"] === "string" && copy["maxLength"] === undefined) copy["maxLength"] = STRING_MAX;
  return copy;
}

/** The JSON Schema of an input: the zod schema's own, with the fields of a file left out when the server writes none, a cap on every string and stdin taken out of the words. */
function schemaOf(input: z.ZodType, left: readonly string[] = []): Readonly<Record<string, unknown>> {
  const schema = capped(z.toJSONSchema(input, { io: "input", unrepresentable: "any" }));
  if (!isRecord(schema)) throw new Error("an input schema is an object");
  const properties = isRecord(schema["properties"]) ? Object.fromEntries(Object.entries(schema["properties"]).filter(([name]) => !left.includes(name)).map(([name, property]) => [name, mcpWords(property)])) : {};
  const required = Array.isArray(schema["required"]) ? schema["required"].filter((name) => typeof name === "string" && !left.includes(name)) : [];
  return { ...schema, properties, ...(required.length === 0 ? {} : { required }), additionalProperties: false };
}

/** A document's words as a tool says them: a path under a root, with no stdin. */
function mcpWords(property: unknown): unknown {
  if (!isRecord(property) || typeof property["description"] !== "string") return property;
  return { ...property, description: property["description"].replace('a path, "-" for stdin, or the document', "a path under a root, or the document") };
}

/** The envelope as a tool's result. It goes through JSON, so it is exactly what the command line prints. */
function resultOf(envelope: Envelope): ToolResult {
  const text = JSON.stringify(envelope);
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error("an envelope is an object");
  return { content: [{ type: "text", text }], structuredContent: parsed, isError: !envelope.ok };
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Takes the places of the machine out of a string: a path under a root is shown from its root, and one under the install or the working folder from there. */
function scrubString(text: string, places: readonly (readonly [string, string])[], bases: readonly string[]): string {
  let out = text;
  for (const [from, to] of places) out = out.split(from).join(to);
  for (const base of bases) out = out.replace(new RegExp(`${escape(base)}${escape(sep)}`, "g"), "").replace(new RegExp(`${escape(base)}(?![\\w.-])`, "g"), ".");
  return out;
}

/** The paths of an unexpected failure's message (`failed` carries an exception's text, which can name a path of the machine) made into `<path>`. */
const PATHS = /(?<![\w:./~-])\/(?:[\w.@+-]+\/)*[\w.@+-]+/g;

/** Whether a value is an envelope: the shape `fail` and `ok` make. */
function isEnvelope(value: unknown): value is Envelope {
  if (!isRecord(value) || typeof value["command"] !== "string") return false;
  return value["ok"] === true || (value["ok"] === false && typeof value["error"] === "string" && typeof value["kind"] === "string" && typeof value["exit"] === "number");
}

function scrub(value: unknown, change: (text: string) => string): unknown {
  if (typeof value === "string") return change(value);
  if (Array.isArray(value)) return value.map((item) => scrub(item, change));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item, change)]));
  return value;
}

/** An envelope with no absolute path in it: the places of the roots, the working folder and the install named from where they begin, and a path in an exception's message hidden. */
function withoutPaths(envelope: Envelope, options: Options, places: readonly (readonly [string, string])[]): Envelope {
  const bases = [...options.roots, process.cwd(), installRoot].filter((base) => base.length > 1);
  const clean = scrub(envelope, (text) => scrubString(text, places, bases));
  if (!isEnvelope(clean)) return envelope;
  return clean.ok || clean.kind !== "failed" ? clean : { ...clean, error: clean.error.replace(PATHS, "<path>") };
}

/** The two asset tools. They read the registry and nothing else: no file, no network, no process. */
const assetSearch = z.strictObject({
  query: z.string().min(1).max(200).describe("words to look for in the asset names, tags and descriptions"),
  kind: z.string().max(64).optional().describe(`only this kind: ${assetKinds.join(", ")}`),
  limit: z.number().int().min(1).max(100).optional().describe("at most this many rows; 10 by default"),
});
const assetShow = z.strictObject({ id: z.string().min(1).max(200).describe("an asset id, such as button-primary") });

interface Entry {
  readonly tool: Tool;
  readonly run: (args: Readonly<Record<string, unknown>>) => Promise<Envelope>;
}

const usage = (command: string, error: z.ZodError): Envelope =>
  fail(command, "usage", error.issues.map((issue) => `${issue.path.length === 0 ? "" : `${issue.path.join(".")}: `}${issue.message}`).join("; "));

/** The tools of a server started with `options`. */
export function createTools(options: Options): Tools {
  let context: Promise<Context> | undefined;
  /** The scene context: the registry, files held to the roots, and no stdin. Loaded when the first call needs it. */
  const sceneContext = (): Promise<Context> => {
    context ??= nodeContext().then((base) => ({ ...base, files: rootFiles(options.roots, options.allowWrite), stdin: () => Promise.resolve({ ok: false as const, failure: NO_STDIN }) }));
    return context;
  };

  const rowTool = (row: Operation): Entry => {
    const command = `scene ${row.name}`;
    const writes = row.needs !== "none" && !row.readOnly;
    const fields = writes && !options.allowWrite ? ["out", "force"] : [];
    const description = writes && options.allowWrite ? `${row.summary} A file is written only under a root; a path that is there needs force.` : row.summary;
    const tool: Tool = {
      name: `scene_${row.name}`,
      description,
      inputSchema: schemaOf(row.input, fields),
      annotations: { readOnlyHint: row.readOnly || !options.allowWrite, destructiveHint: writes && options.allowWrite, idempotentHint: row.readOnly, openWorldHint: false },
    };
    const run = async (args: Readonly<Record<string, unknown>>): Promise<Envelope> => {
      if (!options.allowWrite && ("out" in args || "force" in args)) return failureEnvelope(command, WRITE_NOT_ALLOWED);
      let given: Record<string, unknown> = { ...args };
      const places: (readonly [string, string])[] = [];
      const { out } = args;
      if (typeof out === "string" && out.length > 0 && out.length <= STRING_MAX) {
        // The file is found on disk, under a root, before the row runs, and the row is given where it is: it writes there, and what it says of `out` is shown from the root.
        const at = locate(options.roots, out, "write");
        if (!at.ok) return failureEnvelope(command, at.failure);
        given = { ...given, out: at.value.real };
        places.push([at.value.real, at.value.display]);
      }
      return withoutPaths(await row.run(given, await sceneContext()), options, places);
    };
    return { tool, run };
  };

  const searchTool: Entry = {
    tool: {
      name: "asset_search",
      description: "Find library assets by words: the closest matches first, each with its id, kind and package. The same as `lumin search`.",
      inputSchema: schemaOf(assetSearch),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    run: (args) => {
      const parsed = assetSearch.safeParse(args);
      const envelope = parsed.success ? search(parsed.data.query, { ...(parsed.data.kind === undefined ? {} : { kind: parsed.data.kind }), ...(parsed.data.limit === undefined ? {} : { limit: parsed.data.limit }) }) : usage("search", parsed.error);
      return Promise.resolve(withoutPaths(envelope, options, []));
    },
  };
  const showTool: Entry = {
    tool: {
      name: "asset_show",
      description: "One library asset by id: what it is, its parameters and its snippets. The same as `lumin show`.",
      inputSchema: schemaOf(assetShow),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    run: (args) => {
      const parsed = assetShow.safeParse(args);
      return (parsed.success ? show(parsed.data.id) : Promise.resolve(usage("show", parsed.error))).then((envelope) => withoutPaths(envelope, options, []));
    },
  };

  // A row that needs the browser is listed, and callable, only when the server may render and may write the PNG.
  const entries: readonly Entry[] = [...operations.filter((row) => row.needs !== "render" || (options.allowRender && options.allowWrite)).map(rowTool), searchTool, showTool];
  const byName = new Map(entries.map((entry) => [entry.tool.name, entry]));
  return {
    list: () => entries.map((entry) => entry.tool),
    call: (name, args) => {
      const entry = byName.get(name);
      return entry === undefined ? undefined : entry.run(args).then(resultOf);
    },
  };
}
