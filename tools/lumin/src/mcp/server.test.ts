import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { operations } from "../scene/table.js";
import { MAX_DOCUMENT_BYTES } from "../scene/io.js";
import { root as installRoot } from "../commands.js";
import { ask, bare, callTool, envelopeOf, isRecord, list, record, request, session, strings, toolCall, type Json } from "./harness.js";
import { MAX_LINE, PROTOCOL_VERSIONS } from "./server.js";
import type { Options } from "./tools.js";

const fixtures = join(installRoot, "packages/scene/fixtures");
const inline = (name: string): Json => record(JSON.parse(readFileSync(join(fixtures, `${name}.json`), "utf8")));

const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), "lts-w7-mcp-")));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});
const home = join(scratch, "home");
const beyond = join(scratch, "beyond");
mkdirSync(home);
mkdirSync(beyond);
writeFileSync(join(home, "v1.json"), readFileSync(join(fixtures, "v1.json")));
writeFileSync(join(home, "other.json"), readFileSync(join(fixtures, "transform-hierarchy.json")));
writeFileSync(join(beyond, "secret-doc.json"), readFileSync(join(fixtures, "v1.json")));
symlinkSync(join(beyond, "secret-doc.json"), join(home, "leak.json"));
symlinkSync(beyond, join(home, "leak-dir"));

const escapes: readonly (readonly [string, string])[] = [
  ["a parent path", "../beyond/secret-doc.json"],
  ["an absolute path", join(beyond, "secret-doc.json")],
  ["a system file", "/etc/hosts"],
  ["a link out", "leak.json"],
  ["a link to a folder out", "leak-dir/secret-doc.json"],
];

const reading: Options = { roots: [home], allowWrite: false, allowRender: false };
const writing: Options = { ...reading, allowWrite: true };
const rendering: Options = { ...writing, allowRender: true };

const names = async (options: Options): Promise<readonly string[]> => {
  const tools = list(record(record(await ask(options, request(1, "tools/list")))["result"])["tools"]);
  return tools.map((tool) => String(record(tool)["name"]));
};

describe("the session", () => {
  it("initializes, takes the notification in silence, and answers ping, list and call in order, then ends at the end of its input", async () => {
    const replies = await session(reading, [
      request(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } }),
      { jsonrpc: "2.0", method: "notifications/initialized" },
      request(2, "ping"),
      request(3, "tools/list"),
      toolCall(4, "scene_validate", { document: inline("v1") }),
    ]);
    expect(replies.map((reply) => reply["id"])).toEqual([1, 2, 3, 4]);
    const [initialized, pong, listed, called] = replies.map((reply) => record(reply["result"]));
    expect(initialized).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "lumin" } });
    expect(typeof initialized?.["instructions"]).toBe("string");
    expect(pong).toEqual({});
    expect(list(listed?.["tools"]).length).toBeGreaterThan(0);
    expect(called).toMatchObject({ isError: false, structuredContent: { ok: true, command: "scene validate" } });
    for (const reply of replies) expect(reply["jsonrpc"]).toBe("2.0");
  });

  it("answers an unknown protocol version with the newest it speaks, and a known one with that one", async () => {
    const echoed = await Promise.all(PROTOCOL_VERSIONS.map(async (version) => record(record(await ask(bare, request(1, "initialize", { protocolVersion: version })))["result"])["protocolVersion"]));
    expect(echoed).toEqual([...PROTOCOL_VERSIONS]);
    expect(record(record(await ask(bare, request(1, "initialize", { protocolVersion: "1999-01-01" })))["result"])["protocolVersion"]).toBe(PROTOCOL_VERSIONS[0]);
    expect(record(record(await ask(bare, request(1, "initialize")))["result"])["protocolVersion"]).toBe(PROTOCOL_VERSIONS[0]);
  });

  it("keeps a string id as it is, and answers each request once", async () => {
    const replies = await session(bare, [request("a-1", "ping"), request(7, "ping")]);
    expect(replies).toEqual([
      { jsonrpc: "2.0", id: "a-1", result: {} },
      { jsonrpc: "2.0", id: 7, result: {} },
    ]);
  });

  it("answers errors with the JSON-RPC codes, and goes on", async () => {
    const replies = await session(bare, ["{not json", "[1,2]", '"text"', JSON.stringify({ jsonrpc: "1.0", id: 5, method: "ping" }), JSON.stringify({ jsonrpc: "2.0", id: 6 }), request(7, "no/such/method"), request(8, "tools/call", { arguments: {} }), request(9, "tools/call", { name: "scene_validate", arguments: [] }), request(10, "ping")]);
    expect(replies.map((reply) => [reply["id"], record(reply["error"] ?? {})["code"]])).toEqual([
      [null, -32700],
      [null, -32600],
      [null, -32600],
      [5, -32600],
      [6, -32600],
      [7, -32601],
      [8, -32602],
      [9, -32602],
      [10, undefined],
    ]);
  });

  it("says nothing to a notification, an unknown one included, nor to a response", async () => {
    expect(await session(bare, [{ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } }, { jsonrpc: "2.0", method: "no/such" }, { jsonrpc: "2.0", id: 3, result: {} }, "", "   "])).toEqual([]);
  });

  it("answers a line over the cap with one error, skips it to its end and serves the next", async () => {
    const replies = await session(bare, [`{"jsonrpc":"2.0","id":1,"method":"ping","pad":"${"x".repeat(MAX_LINE)}"}`, request(2, "ping")]);
    expect(replies).toHaveLength(2);
    expect(replies[0]).toMatchObject({ id: null, error: { code: -32600 } });
    expect(replies[1]).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
  });

  it("takes a line of exactly the cap, but not one byte more", async () => {
    const frame = (pad: number): string => JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", pad: "x".repeat(pad) });
    const room = MAX_LINE - Buffer.byteLength(frame(0));
    expect(await session(bare, [frame(room)])).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }]);
    expect(await session(bare, [frame(room + 1)])).toMatchObject([{ id: null, error: { code: -32600 } }]);
  });
});

describe("the tools", () => {
  it("are one per table row, and the two asset tools, with no render and no file fields unless the server may", async () => {
    const rows = operations.filter((row) => row.needs !== "render").map((row) => `scene_${row.name}`);
    expect(await names(bare)).toEqual([...rows, "asset_search", "asset_show"]);
    // Rendering is listed only with both flags: either one alone does not list it.
    expect(await names({ ...reading, allowRender: true })).toEqual([...rows, "asset_search", "asset_show"]);
    expect(await names(writing)).toEqual([...rows, "asset_search", "asset_show"]);
    expect(await names(rendering)).toEqual([...operations.map((row) => `scene_${row.name}`), "asset_search", "asset_show"]);
  });

  it("do not offer out or force until the server may write", async () => {
    const schema = async (options: Options, name: string): Promise<Json> => {
      const tools = list(record(record(await ask(options, request(1, "tools/list")))["result"])["tools"]).map(record);
      const found = tools.find((tool) => tool["name"] === name);
      if (found === undefined) throw new Error(`no ${name}`);
      return record(found["inputSchema"]);
    };
    const fields = async (options: Options, name: string): Promise<string[]> => Object.keys(record((await schema(options, name))["properties"])).filter((field) => field === "out" || field === "force");
    expect(await Promise.all(["scene_patch", "scene_export"].map((name) => fields(reading, name)))).toEqual([[], []]);
    expect(await Promise.all(["scene_patch", "scene_export"].map((name) => fields(writing, name)))).toEqual([["out", "force"], ["out", "force"]]);
  });

  it("have a schema that closes the object, caps every string, and says nothing of stdin", async () => {
    const tools = list(record(record(await ask(rendering, request(1, "tools/list")))["result"])["tools"]).map(record);
    expect(tools.length).toBe(operations.length + 2);
    const unbounded = (schema: unknown): readonly string[] => {
      if (Array.isArray(schema)) return schema.flatMap(unbounded);
      if (!isRecord(schema)) return [];
      const here = schema["type"] === "string" && typeof schema["maxLength"] !== "number" ? [JSON.stringify(schema)] : [];
      return [...here, ...Object.values(schema).flatMap(unbounded)];
    };
    const found = tools.map((tool) => {
      const schema = record(tool["inputSchema"]);
      return [String(tool["name"]), schema["type"], schema["additionalProperties"], unbounded(schema), /stdin/i.test(JSON.stringify(schema)), typeof tool["description"], Object.keys(record(tool["annotations"])).sort()];
    });
    expect(found).toEqual(tools.map((tool) => [String(tool["name"]), "object", false, [], false, "string", ["destructiveHint", "idempotentHint", "openWorldHint", "readOnlyHint"]]));
  });

  it("mark a write as such only when the server may write", async () => {
    const hints = async (options: Options): Promise<Json> => {
      const tools = list(record(record(await ask(options, request(1, "tools/list")))["result"])["tools"]).map(record);
      return Object.fromEntries(tools.map((tool) => [String(tool["name"]), record(tool["annotations"])["readOnlyHint"]]));
    };
    expect(await hints(reading)).toMatchObject({ scene_validate: true, scene_diff: true, scene_patch: true, scene_export: true, asset_search: true, asset_show: true });
    expect(await hints(rendering)).toMatchObject({ scene_validate: true, scene_patch: false, scene_export: false, scene_render: false, asset_show: true });
  });
});

describe("a call", () => {
  it("returns the envelope as structuredContent, the same JSON on one line as content, and isError false for ok", async () => {
    const result = await callTool(reading, "scene_validate", { document: "v1.json" });
    expect(result["structuredContent"]).toEqual({ ok: true, command: "scene validate", data: { valid: true, version: 2, migratedFrom: 1, issues: [] } });
    expect(result["content"]).toEqual([{ type: "text", text: JSON.stringify(result["structuredContent"]) }]);
    expect(String(record(list(result["content"])[0])["text"])).not.toContain("\n");
    expect(result["isError"]).toBe(false);
  });

  it("is isError exactly when the envelope is not ok, and the failure is the same envelope the command line prints", async () => {
    const result = await callTool(reading, "scene_validate", { document: { format: "lts-scene", version: 2, look: "no-such-look", seed: 0, nodes: [] } });
    expect(result["isError"]).toBe(true);
    expect(result["structuredContent"]).toMatchObject({ ok: false, command: "scene validate", kind: "invalid", exit: 1 });
    expect(record(result["structuredContent"])["ok"]).toBe(false);
  });

  it("with no arguments is a usage result, not a protocol error", async () => {
    const result = await callTool(bare, "scene_validate");
    expect(result).toMatchObject({ isError: true, structuredContent: { ok: false, kind: "usage", exit: 2 } });
  });

  it("is a protocol error for a tool that is not listed: an unknown name, and render without both flags", async () => {
    const asks: readonly (readonly [Options, string])[] = [[bare, "scene_nothing"], [bare, "scene_render"], [{ ...reading, allowRender: true }, "scene_render"], [writing, "scene_render"], [bare, "asset_nothing"]];
    const replies = await Promise.all(asks.map(([options, name]) => ask(options, toolCall(1, name, { document: inline("v1"), out: "x.png" }))));
    expect(replies.map((reply) => [reply["id"], record(reply["error"])["code"]])).toEqual(asks.map(() => [1, -32602]));
  });

  it("runs the asset tools: the same envelope as lumin search and lumin show, and a usage result for a bad input", async () => {
    expect(await envelopeOf(bare, "asset_search", { query: "glass", limit: 3 })).toMatchObject({ ok: true, command: "search", data: { query: "glass" } });
    expect(await envelopeOf(bare, "asset_show", { id: "no-such-asset-xyz" })).toMatchObject({ ok: false, kind: "unknown_asset", command: "show" });
    expect(await envelopeOf(bare, "asset_search", { query: "glass", kind: "nonsense" })).toMatchObject({ ok: false, kind: "usage" });
    expect(await envelopeOf(bare, "asset_search", { query: "x".repeat(201) })).toMatchObject({ ok: false, kind: "usage", command: "search" });
    expect(await envelopeOf(bare, "asset_search", { query: "glass", extra: 1 })).toMatchObject({ ok: false, kind: "usage" });
    expect(await envelopeOf(bare, "asset_show", {})).toMatchObject({ ok: false, kind: "usage", command: "show" });
  });
});

describe("the caps", () => {
  it("refuse a string over its length as a usage result", async () => {
    expect(await envelopeOf(reading, "scene_validate", { document: "x".repeat(4097) })).toMatchObject({ ok: false, kind: "usage", command: "scene validate" });
    expect(await envelopeOf(reading, "scene_export", { document: "v1.json", as: "x".repeat(10_000) })).toMatchObject({ ok: false, kind: "usage" });
    expect(await envelopeOf(writing, "scene_patch", { document: "v1.json", ops: "[]", out: "o".repeat(4097) })).toMatchObject({ ok: false, kind: "usage" });
  });

  it("refuse a document over the document cap as too_large, inline, and are not cut", async () => {
    const big = { ...inline("v1"), padding: "x".repeat(MAX_DOCUMENT_BYTES) };
    expect(await envelopeOf(reading, "scene_validate", { document: big })).toMatchObject({ ok: false, kind: "too_large" });
  });

  it("refuse an unknown field, and a field of the wrong type", async () => {
    expect(await envelopeOf(reading, "scene_validate", { document: "v1.json", surprise: true })).toMatchObject({ ok: false, kind: "usage" });
    expect(await envelopeOf(reading, "scene_export", { document: "v1.json", as: 7 })).toMatchObject({ ok: false, kind: "usage" });
  });
});

describe("what the roots hold", () => {
  it.each(escapes)("a document by %s is the one fixed no_root, whatever the tool", async (_label, path) => {
    const results = [
      await envelopeOf(reading, "scene_validate", { document: path }),
      await envelopeOf(reading, "scene_diff", { a: path, b: "v1.json" }),
      await envelopeOf(reading, "scene_diff", { a: "v1.json", b: path }),
      await envelopeOf(reading, "scene_patch", { document: path, ops: "[]" }),
      await envelopeOf(reading, "scene_export", { document: path, as: "json" }),
    ];
    for (const result of results) {
      expect(result).toMatchObject({ ok: false, kind: "no_root", exit: 1 });
      expect(strings(result).join("\n")).not.toContain("secret-doc");
      expect(strings(result).join("\n")).not.toContain(scratch);
    }
    expect(new Set(results.map((result) => result["error"])).size).toBe(1);
  });

  it("a path is not-found only inside a root: the same call outside is no_root", async () => {
    expect(await envelopeOf(reading, "scene_validate", { document: "missing-here.json" })).toMatchObject({ ok: false, kind: "not_found" });
    expect(await envelopeOf(reading, "scene_validate", { document: "../beyond/missing.json" })).toMatchObject({ ok: false, kind: "no_root" });
  });

  it("a server with no root reads no file", async () => {
    expect(await envelopeOf(bare, "scene_validate", { document: "v1.json" })).toMatchObject({ ok: false, kind: "no_root" });
    expect(await envelopeOf(bare, "scene_validate", { document: join(home, "v1.json") })).toMatchObject({ ok: false, kind: "no_root" });
    expect(await envelopeOf(bare, "scene_validate", { document: inline("v1") })).toMatchObject({ ok: true });
  });

  it("stdin is refused: - is a usage result, and nothing is read", async () => {
    const result = await envelopeOf(reading, "scene_validate", { document: "-" });
    expect(result).toMatchObject({ ok: false, kind: "usage" });
  });

  it("reads a document by path under the root, relative or absolute", async () => {
    expect(await envelopeOf(reading, "scene_validate", { document: "v1.json" })).toMatchObject({ ok: true });
    expect(await envelopeOf(reading, "scene_validate", { document: join(home, "v1.json") })).toMatchObject({ ok: true });
  });
});

describe("writing", () => {
  it("is refused without --allow-write, by out or by force, with a fixed answer, and nothing is written", async () => {
    const asks: readonly Json[] = [{ out: "written-a.json" }, { out: "../beyond/written-a.json" }, { force: true }, { out: "written-a.json", force: true }];
    const answers = await Promise.all(asks.map(async (args) => [await envelopeOf(reading, "scene_patch", { document: "v1.json", ops: "[]", ...args }), await envelopeOf(reading, "scene_export", { document: "v1.json", as: "json", ...args })]));
    for (const [patch, exported] of answers) {
      expect(patch).toMatchObject({ ok: false, kind: "write_not_allowed", command: "scene patch" });
      expect(exported).toMatchObject({ ok: false, kind: "write_not_allowed", command: "scene export" });
      expect(patch?.["error"]).toBe(exported?.["error"]);
    }
    expect(() => readFileSync(join(home, "written-a.json"))).toThrow();
    expect(() => readFileSync(join(beyond, "written-a.json"))).toThrow();
  });

  it("without out, still returns the result in the reply", async () => {
    expect(await envelopeOf(reading, "scene_patch", { document: "v1.json", ops: '[{"op":"setInk","ink":"glass"}]' })).toMatchObject({ ok: true, data: { applied: 1 } });
    expect(await envelopeOf(reading, "scene_export", { document: "v1.json", as: "json" })).toMatchObject({ ok: true, data: { as: "json" } });
  });

  it("writes a new file under a root, and says its out as given, with no absolute path", async () => {
    const result = await envelopeOf(writing, "scene_export", { document: "v1.json", as: "json", out: "made.json" });
    expect(result).toMatchObject({ ok: true, data: { as: "json", out: "made.json" } });
    expect(readFileSync(join(home, "made.json"), "utf8")).toContain('"lts-scene"');
    expect(await envelopeOf(writing, "scene_export", { document: "v1.json", as: "json", out: "made.json" })).toMatchObject({ ok: false, kind: "exists" });
    expect(await envelopeOf(writing, "scene_export", { document: "v1.json", as: "json", out: "made.json", force: true })).toMatchObject({ ok: true });
    const absolute = await envelopeOf(writing, "scene_export", { document: "v1.json", as: "json", out: join(home, "made-abs.json") });
    expect(absolute).toMatchObject({ ok: true, data: { out: "made-abs.json" } });
    expect(strings(absolute).join("\n")).not.toContain(scratch);
  });

  it.each(escapes)("never writes out by %s", async (_label, path) => {
    const result = await envelopeOf(writing, "scene_patch", { document: "v1.json", ops: "[]", out: path, force: true });
    expect(result).toMatchObject({ ok: false, kind: "no_root" });
    expect(strings(result).join("\n")).not.toContain(scratch);
    expect(readFileSync(join(beyond, "secret-doc.json"), "utf8")).toContain('"lts-scene"');
  });

  it("does not render a file out of a root either: the out is held to a root before the browser is asked for", async () => {
    const paths = ["../beyond/frame.png", join(beyond, "frame.png"), "leak-dir/frame.png", "leak.json"];
    const results = await Promise.all(paths.map((path) => envelopeOf(rendering, "scene_render", { document: "v1.json", out: path, force: true })));
    expect(results.map((result) => result["kind"])).toEqual(paths.map(() => "no_root"));
    expect(results.flatMap(strings).filter((text) => text.includes(scratch))).toEqual([]);
    expect(readFileSync(join(beyond, "secret-doc.json"), "utf8")).toContain('"lts-scene"');
  });

  it("refuses a render to a path that is there without force, before the browser starts, and never says the path", async () => {
    writeFileSync(join(home, "there.png"), "not a png");
    const result = await envelopeOf(rendering, "scene_render", { document: "v1.json", out: "there.png" });
    expect(result).toMatchObject({ ok: false, kind: "exists", command: "scene render" });
    expect(readFileSync(join(home, "there.png"), "utf8")).toBe("not a png");
    expect(strings(result).join("\n")).not.toContain(scratch);
  });

  it("answers a render input that is wrong with usage or invalid, before the browser starts", async () => {
    expect(await envelopeOf(rendering, "scene_render", { document: "v1.json" })).toMatchObject({ ok: false, kind: "usage" });
    expect(await envelopeOf(rendering, "scene_render", { document: "v1.json", out: "x.png", width: 99_999 })).toMatchObject({ ok: false, kind: "usage" });
    expect(await envelopeOf(rendering, "scene_render", { document: { not: "a scene" }, out: "x.png" })).toMatchObject({ ok: false, kind: "invalid" });
  });
});

describe("no output holds an absolute path", () => {
  it("across the whole battery of calls, failures and successes", async () => {
    const calls: readonly (readonly [Options, string, Json])[] = [
      [reading, "scene_validate", { document: "v1.json" }],
      [reading, "scene_validate", { document: "missing.json" }],
      [reading, "scene_validate", { document: "../beyond/secret-doc.json" }],
      [reading, "scene_validate", { document: join(home, "other.json") }],
      [reading, "scene_diff", { a: "v1.json", b: "other.json" }],
      [reading, "scene_patch", { document: "v1.json", ops: '[{"op":"setInk","ink":"glass"}]' }],
      [reading, "scene_patch", { document: "v1.json", ops: "[]", out: "x.json" }],
      [writing, "scene_export", { document: "v1.json", as: "tsx", out: join(home, "abs.tsx"), force: true }],
      [writing, "scene_export", { document: "v1.json", as: "link" }],
      [rendering, "scene_render", { document: "v1.json", out: "there.png" }],
      [bare, "asset_search", { query: "glass" }],
      [bare, "asset_show", { id: "no-such-asset" }],
      [bare, "asset_show", { id: "platonic-cube" }],
      [bare, "asset_show", { id: "glass" }],
    ];
    const out = await Promise.all(calls.map(([options, name, args]) => envelopeOf(options, name, args)));
    const everything = out.flatMap(strings);
    expect(everything.length).toBeGreaterThan(50);
    const places = [scratch, home, beyond, installRoot, process.cwd(), tmpdir()];
    expect(places.map((place) => [place, everything.filter((text) => text.includes(place))])).toEqual(places.map((place) => [place, []]));
    expect(everything.filter((text) => /(^|[\s"'(=:])\/(Users|home|private|var|tmp|etc|opt|usr)\//.test(text))).toEqual([]);
  });
});

describe("the server's own files", () => {
  // The calls that start a process or reach a network are the render's, in render.ts, and nothing here names one: the one place a browser is started is behind two flags.
  it("name no way to start a process or to open a connection", () => {
    const sources = readdirSync(import.meta.dirname).filter((name) => name.endsWith(".ts") && !name.includes(".test.") && name !== "harness.ts");
    expect(sources).toEqual(expect.arrayContaining(["command.ts", "roots.ts", "server.ts", "tools.ts"]));
    const read = (name: string): string => readFileSync(join(import.meta.dirname, name), "utf8");
    const way = /child_process|Bun\.(spawn|listen|connect|serve|udpSocket)|node:(net|http|https|http2|dgram|dns|tls)|\bfetch\(|WebSocket|XMLHttpRequest/;
    expect(sources.filter((name) => way.test(read(name)))).toEqual([]);
  });

  it("write to stdout in one place only, the command's, and never with console", () => {
    const sources = readdirSync(import.meta.dirname).filter((name) => name.endsWith(".ts") && !name.includes(".test.") && name !== "harness.ts");
    const read = (name: string): string => readFileSync(join(import.meta.dirname, name), "utf8");
    expect(sources.filter((name) => /console\.|process\.stdout/.test(read(name)))).toEqual(["command.ts"]);
    expect(sources.filter((name) => /console\./.test(read(name)))).toEqual([]);
  });
});
