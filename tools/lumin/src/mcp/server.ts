// The server of `lumin mcp`: newline-delimited JSON-RPC 2.0 over stdio (the MCP stdio transport), by hand, with no SDK. It answers `initialize`,
// `ping`, `tools/list` and `tools/call`, takes `notifications/initialized` and every other notification in silence, and ends at the end of its input.
// What it writes to its output is JSON-RPC messages, one to a line, and nothing else; it writes nothing to stderr.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTools, type Options, type Tools } from "./tools.js";

/** The longest line the server reads, in bytes. A longer one is answered with an error and skipped to its end; nothing of it is parsed. */
export const MAX_LINE = 1_048_576;

/** The protocol versions the server speaks, newest first. A client that asks for one of them gets it, and any other gets the newest. */
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

const NAME = "lumin";

type Id = string | number | null;
type Message = { readonly jsonrpc: "2.0"; readonly id: Id; readonly result: unknown } | { readonly jsonrpc: "2.0"; readonly id: Id; readonly error: { readonly code: number; readonly message: string } };

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const answer = (id: Id, result: unknown): Message => ({ jsonrpc: "2.0", id, result });
const refuse = (id: Id, code: number, message: string): Message => ({ jsonrpc: "2.0", id, error: { code, message } });

/** What a line of input is: its text, or the fact that it was over `MAX_LINE`. */
type Line = { readonly text: string } | { readonly tooLong: true };

/** The lines of a byte stream, split on newlines. A line over `MAX_LINE` is reported once, as soon as it is over, and skipped to its end without being kept. */
async function* linesOf(input: AsyncIterable<unknown>): AsyncGenerator<Line> {
  let chunks: Buffer[] = [];
  let size = 0;
  let skipping = false;
  const take = (): Line => {
    const text = Buffer.concat(chunks).toString("utf8").replace(/\r$/, "");
    chunks = [];
    size = 0;
    return { text };
  };
  for await (const raw of input) {
    let rest = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw));
    for (;;) {
      const newline = rest.indexOf(0x0a);
      const piece = newline === -1 ? rest : rest.subarray(0, newline);
      if (!skipping) {
        size += piece.length;
        if (size > MAX_LINE) {
          skipping = true;
          chunks = [];
          size = 0;
          yield { tooLong: true };
        } else chunks.push(piece);
      }
      if (newline === -1) break;
      if (skipping) skipping = false;
      else yield take();
      rest = rest.subarray(newline + 1);
    }
  }
  if (!skipping && size > 0) yield take();
}

/** The version this server speaks that answers what a client asked for. */
const negotiated = (asked: unknown): string => PROTOCOL_VERSIONS.find((version) => version === asked) ?? PROTOCOL_VERSIONS[0];

function instructions(options: Options): string {
  const roots = options.roots.length === 0 ? "no root was given, so a document is passed inline and no file is read or written" : "a document is passed inline, or as a path under a root (a relative path is taken from the first root)";
  return `LuminosiTS scene tools: read, compare, edit and export a scene document (an lts-scene JSON), and look up library assets. Here ${roots}. Writing a file ${options.allowWrite ? "is allowed under a root, to a new path unless force is set" : "is not allowed (the server was started without --allow-write)"}. Rendering ${options.allowRender && options.allowWrite ? "is on" : "is off"}. A result is the envelope the lumin command line prints, in structuredContent.`;
}

/** The version of the lumin package, read once. */
let version: string | undefined;
function serverVersion(): string {
  if (version !== undefined) return version;
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(import.meta.dirname, "../../package.json"), "utf8"));
    version = isRecord(manifest) && typeof manifest["version"] === "string" ? manifest["version"] : "0.0.0";
  } catch {
    version = "0.0.0";
  }
  return version;
}

/** Answers one message: a reply, or nothing for a notification and for anything that is not a request. */
async function handle(text: string, tools: Tools, options: Options): Promise<Message | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refuse(null, PARSE_ERROR, "the line is not JSON");
  }
  if (!isRecord(parsed)) return refuse(null, INVALID_REQUEST, "a message is a JSON object (batches are not part of MCP)");
  const { id, method, params } = parsed;
  const valid = id === undefined || typeof id === "string" || (typeof id === "number" && Number.isFinite(id));
  if (!valid || parsed["jsonrpc"] !== "2.0") return refuse(typeof id === "string" || typeof id === "number" ? id : null, INVALID_REQUEST, 'a message has "jsonrpc": "2.0" and an id that is a string or a number');
  // A response to a request the server never made is not a request: nothing is said.
  if (method === undefined) return id !== undefined && ("result" in parsed || "error" in parsed) ? undefined : refuse(typeof id === "string" || typeof id === "number" ? id : null, INVALID_REQUEST, "a request has a method");
  if (typeof method !== "string") return refuse(typeof id === "string" || typeof id === "number" ? id : null, INVALID_REQUEST, "a method is a string");
  // A notification has no id and gets no answer, whatever it says.
  if (id === undefined) return undefined;
  switch (method) {
    case "initialize":
      return answer(id, { protocolVersion: negotiated(isRecord(params) ? params["protocolVersion"] : undefined), capabilities: { tools: { listChanged: false } }, serverInfo: { name: NAME, version: serverVersion() }, instructions: instructions(options) });
    case "ping":
      return answer(id, {});
    case "tools/list":
      return answer(id, { tools: tools.list() });
    case "tools/call": {
      if (!isRecord(params) || typeof params["name"] !== "string") return refuse(id, INVALID_PARAMS, "tools/call takes a name and arguments");
      const args = params["arguments"] ?? {};
      if (!isRecord(args)) return refuse(id, INVALID_PARAMS, "arguments is an object");
      try {
        const called = tools.call(params["name"], args);
        return called === undefined ? refuse(id, INVALID_PARAMS, "unknown tool") : answer(id, await called);
      } catch {
        return refuse(id, INTERNAL_ERROR, "the call failed");
      }
    }
    default:
      return refuse(id, METHOD_NOT_FOUND, "method not found");
  }
}

/** Serves one client: reads lines from `input`, writes each reply with `emit`, and returns when the input ends. Requests are answered one at a time, in order. */
export async function serve(input: AsyncIterable<unknown>, emit: (line: string) => Promise<void>, options: Options): Promise<void> {
  const tools = createTools(options);
  for await (const line of linesOf(input)) {
    const reply = "tooLong" in line ? refuse(null, INVALID_REQUEST, `a line is at most ${String(MAX_LINE)} bytes: this one was over, and was skipped`) : line.text.trim() === "" ? undefined : await handle(line.text, tools, options);
    if (reply !== undefined) await emit(JSON.stringify(reply));
  }
}
