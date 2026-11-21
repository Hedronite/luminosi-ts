// What the MCP tests share: a scripted client that runs a session against the server in this process, and the few helpers for reading what comes back.
import { Readable } from "node:stream";
import { serve } from "./server.js";
import type { Options } from "./tools.js";

export type Json = Record<string, unknown>;

export const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** A value that must be an object. */
export function record(value: unknown): Json {
  if (!isRecord(value)) throw new Error("not an object");
  return value;
}

/** A value that must be a list. */
export function list(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error("not a list");
  return value;
}

/** A request, as a client writes it. */
export const request = (id: number | string, method: string, params?: unknown): Json => ({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });

/** A tool call, as a client writes it. */
export const toolCall = (id: number, name: string, args?: Json): Json => request(id, "tools/call", { name, ...(args === undefined ? {} : { arguments: args }) });

/** The options of a server with nothing given: no root, no writing, no rendering. */
export const bare: Options = { roots: [], allowWrite: false, allowRender: false };

/** Runs a session: each message is a line the client sends (an object is written as JSON, a string as it is), and the lines the server wrote come back, parsed. The server has ended when this returns. */
export async function session(options: Options, messages: readonly (Json | string)[]): Promise<readonly Json[]> {
  const input = Readable.from([Buffer.from(messages.map((message) => (typeof message === "string" ? message : JSON.stringify(message))).join("\n") + "\n")]);
  const lines: string[] = [];
  await serve(
    input,
    (line) => {
      lines.push(line);
      return Promise.resolve();
    },
    options,
  );
  return lines.map((line) => record(JSON.parse(line)));
}

/** The one reply to a single message. */
export async function ask(options: Options, message: Json | string): Promise<Json> {
  const replies = await session(options, [message]);
  const [only] = replies;
  if (replies.length !== 1 || only === undefined) throw new Error(`expected one reply, got ${String(replies.length)}`);
  return only;
}

/** A tool's `result`, which must be there. */
export async function callTool(options: Options, name: string, args?: Json): Promise<Json> {
  return record((await ask(options, toolCall(1, name, args)))["result"]);
}

/** The envelope a call answered with. */
export async function envelopeOf(options: Options, name: string, args?: Json): Promise<Json> {
  return record((await callTool(options, name, args))["structuredContent"]);
}

/** Every string anywhere in a value, keys included. */
export function strings(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (isRecord(value)) return Object.entries(value).flatMap(([key, item]) => [key, ...strings(item)]);
  return [];
}
