// The MCP server and the command line are one program: for every row of the scene table and every scene fixture, what `lumin scene …` prints is,
// field for field, what the tool's structuredContent holds. The command line is the real one (a process), the server is run in this process
// as a process too (`lumin mcp`, one session a row), and each works in its own folder holding the same files, so a path in the input is the same on both sides.
// Both run under Bun: a share link is deflated by the runtime's own zlib, which Node and Bun do not write alike.
import { spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { root } from "../commands.js";
import { operations, type Operation } from "../scene/table.js";
import { bare, envelopeOf, isRecord, list, record, request, session, strings, toolCall, type Json } from "./harness.js";
import type { Options } from "./tools.js";

const bun = (args: readonly string[], options: SpawnSyncOptionsWithStringEncoding): SpawnSyncReturns<string> => spawnSync("bun", args, options);

const fixtureDir = join(root, "packages/scene/fixtures");
const fixtures = readdirSync(fixtureDir).filter((name) => name.endsWith(".json")).sort();

const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), "lts-w7-parity-")));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});
/** The command line's folder and the server's root: the same files in each, and nothing else. */
const folder = (name: string): string => {
  const path = join(scratch, name);
  cpSync(fixtureDir, path, { recursive: true });
  return path;
};
const cliHome = folder("cli");
const mcpHome = folder("mcp");
const options: Options = { roots: [mcpHome], allowWrite: true, allowRender: true };
const cliPath = join(root, "tools/lumin/src/cli.ts");

/** The value of JSON text. */
function parsed(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

/** The fields a row's input has. */
const fieldsOf = (row: Operation): readonly string[] => Object.keys(z.toJSONSchema(row.input, { io: "input", unrepresentable: "any" }).properties ?? {});

/** A row's input as words for the command line: the positional fields in the row's order, then each other field as a flag. */
function argvOf(row: Operation, input: Json): readonly string[] {
  // Only the positionals the input has: a field left out is no argument, so the command line says what the tool says.
  const positionals = row.positional.filter((name) => Object.hasOwn(input, name)).map((name) => String(input[name]));
  const flags = Object.entries(input)
    .filter(([name]) => !row.positional.includes(name))
    .flatMap(([name, value]) => (value === true ? [`--${name}`] : [`--${name}`, String(value)]));
  return [...positionals, ...flags];
}

/** What the command line prints for an input, parsed, and its exit code. */
function cli(row: Operation, input: Json): { readonly stdout: unknown; readonly status: number | null } {
  const done = bun([join(root, "tools/lumin/src/cli.ts"), "scene", row.name, ...argvOf(row, input)], { encoding: "utf8", cwd: cliHome, maxBuffer: 16 * 1024 * 1024 });
  return { stdout: JSON.parse(done.stdout), status: done.status };
}

interface Case {
  readonly label: string;
  readonly input: Json;
}

const ops = '[{"op":"setInk","ink":"glass"}]';

/** The inputs a row is run with: every fixture, and the ways the row can be wrong. A row this file does not know is given each fixture as its `document` (and as `a` and `b`), so a new row is held to parity at once. */
function casesFor(row: Operation): readonly Case[] {
  const next = (name: string): string => fixtures[(fixtures.indexOf(name) + 1) % fixtures.length] ?? name;
  switch (row.name) {
    case "validate":
      return [...fixtures.map((name) => ({ label: name, input: { document: name } })), { label: "missing file", input: { document: "no-such.json" } }];
    case "diff":
      return [...fixtures.map((name) => ({ label: `${name} with ${next(name)}`, input: { a: name, b: next(name) } })), { label: "a document with itself", input: { a: "v1.json", b: "v1.json" } }, { label: "a missing document", input: { a: "no-such.json", b: "v1.json" } }];
    case "patch":
      return [
        ...fixtures.map((name) => ({ label: name, input: { document: name, ops } })),
        { label: "no ops given", input: { document: "v1.json", ops: "[]" } },
        { label: "ops that are not JSON", input: { document: "v1.json", ops: "[{" } },
        { label: "to out", input: { document: "v1.json", ops, out: "patched.json" } },
        { label: "to out again", input: { document: "v1.json", ops, out: "patched.json" } },
        { label: "to out with force", input: { document: "v1.json", ops, out: "patched.json", force: true } },
      ];
    case "export":
      return [
        ...fixtures.flatMap((name) => ["tsx", "vanilla", "json", "link"].map((as) => ({ label: `${name} as ${as}`, input: { document: name, as } }))),
        { label: "to out", input: { document: "v1.json", as: "tsx", out: "exported.tsx" } },
        { label: "to out again", input: { document: "v1.json", as: "tsx", out: "exported.tsx" } },
        { label: "to out with force", input: { document: "v1.json", as: "tsx", out: "exported.tsx", force: true } },
      ];
    case "render":
      // What a render says before it starts a browser: the same on both sides. Drawing one is the e2e's.
      return [
        { label: "no out", input: { document: "v1.json" } },
        { label: "a side over the cap", input: { document: "v1.json", out: "r.png", width: "99999" } },
        { label: "a document that is not one", input: { document: "no-such.json", out: "r.png" } },
      ];
    default: {
      const fields = fieldsOf(row);
      const documents = fixtures.map((name) => ({ label: name, input: Object.fromEntries(fields.filter((field) => ["document", "a", "b"].includes(field)).map((field) => [field, name])) }));
      return [{ label: "no input", input: {} }, ...documents];
    }
  }
}

/** What `lumin mcp` writes for a session of calls, one tool call each (id 1, 2, …), by a real process: the server has ended, cleanly and quietly, when this returns. */
function mcpSession(name: string, inputs: readonly Json[]): readonly Json[] {
  const input = `${inputs.map((args, index) => JSON.stringify(toolCall(index + 1, name, args))).join("\n")}\n`;
  const done = bun([cliPath, "mcp", "--root", mcpHome, "--allow-write", "--allow-render"], { input, encoding: "utf8", cwd: scratch, maxBuffer: 64 * 1024 * 1024 });
  expect(done.stderr).toBe("");
  expect(done.status).toBe(0);
  return done.stdout.split("\n").filter((line) => line !== "").map((line) => record(JSON.parse(line)));
}

/** For each case of a row: what the command line printed and what the tool answered. */
function runBoth(row: Operation): readonly { readonly label: string; readonly printed: { readonly stdout: unknown; readonly status: number | null }; readonly answered: Json }[] {
  const cases = casesFor(row);
  const printed = cases.map(({ input }) => cli(row, input));
  const replies = mcpSession(`scene_${row.name}`, cases.map(({ input }) => input));
  expect(replies).toHaveLength(cases.length);
  return cases.map(({ label }, index) => ({ label, printed: printed[index] ?? { stdout: undefined, status: null }, answered: record(replies[index]?.["result"]) }));
}

describe("the command line and the MCP tool give the same envelope", () => {
  for (const row of operations) {
    it(`${row.name}: every input, the process and the server equal field for field`, () => {
      const both = runBoth(row);
      expect(both.length).toBeGreaterThan(0);
      for (const { label, printed, answered } of both) {
        expect(answered["structuredContent"], `${row.name}: ${label}`).toEqual(printed.stdout);
        // `content` is the same JSON on one line, and `isError` is true exactly when the envelope is not ok.
        const ok = isRecord(printed.stdout) && printed.stdout["ok"] === true;
        expect(answered["content"], `${row.name}: ${label}`).toEqual([{ type: "text", text: JSON.stringify(printed.stdout) }]);
        expect(answered["isError"], `${row.name}: ${label}`).toBe(!ok);
        // A failure's exit is in the envelope, and is what the process exits with.
        expect(printed.status, `${row.name}: ${label}`).toBe(ok ? 0 : record(printed.stdout)["exit"]);
      }
    }, 120_000);
  }

  it("has a success and a failure among the inputs of the rows that have them", () => {
    for (const row of operations.filter((candidate) => ["validate", "diff", "patch", "export"].includes(candidate.name))) {
      const outcomes = runBoth(row).map(({ answered }) => record(answered["structuredContent"])["ok"]);
      expect([row.name, [...new Set(outcomes)].sort()]).toEqual([row.name, [false, true]]);
    }
  }, 120_000);
});

describe("the tools and the table", () => {
  it("have a tool for every row and a row for every tool, in the table's order, with the asset tools besides", async () => {
    const listed = list(record(record((await session(options, [request(1, "tools/list")]))[0])["result"])["tools"]).map((tool) => String(record(tool)["name"]));
    expect(listed.filter((name) => name.startsWith("scene_"))).toEqual(operations.map((row) => `scene_${row.name}`));
    expect(listed.filter((name) => !name.startsWith("scene_"))).toEqual(["asset_search", "asset_show"]);
  });

  it("describe each row with its own summary and take its input fields as their properties", async () => {
    const tools = list(record(record((await session(options, [request(1, "tools/list")]))[0])["result"])["tools"]).map(record);
    for (const row of operations) {
      const tool = tools.find((candidate) => candidate["name"] === `scene_${row.name}`);
      expect([row.name, tool === undefined]).toEqual([row.name, false]);
      expect(String(tool?.["description"])).toContain(row.summary);
      expect(Object.keys(record(record(tool?.["inputSchema"])["properties"])).sort()).toEqual([...fieldsOf(row)].sort());
    }
  });

  it("find the assets the same as the command line", () => {
    const search: readonly (readonly [string[], Json])[] = [
      [["glass"], { query: "glass" }],
      [["glass", "--kind", "material", "--limit", "3"], { query: "glass", kind: "material", limit: 3 }],
      [["zzzzqqq"], { query: "zzzzqqq" }],
    ];
    const printed = search.map(([argv]) => parsed(bun([cliPath, "search", ...argv], { encoding: "utf8", cwd: root }).stdout));
    const answered = mcpSession("asset_search", search.map(([, input]) => input));
    expect(answered.map((reply) => record(record(reply["result"])["structuredContent"]))).toEqual(printed);
    const ids = ["no-such-asset-q", "platonic-cube", "glass"];
    const shown = ids.map((id) => parsed(bun([cliPath, "show", id], { encoding: "utf8", cwd: root }).stdout));
    expect(mcpSession("asset_show", ids.map((id) => ({ id }))).map((reply) => record(record(reply["result"])["structuredContent"]))).toEqual(shown);
  }, 60_000);

  it("print no absolute path in what they say, for the fixtures", async () => {
    const seen = await Promise.all(operations.filter((row) => row.needs === "none").flatMap((row) => casesFor(row).map(({ input }) => envelopeOf(options, `scene_${row.name}`, input))));
    expect(seen.flatMap(strings).filter((text) => text.includes(scratch) || text.includes(root))).toEqual([]);
    expect(readFileSync(join(mcpHome, "v1.json"), "utf8")).toContain("lts-scene");
    expect(await envelopeOf(bare, "asset_search", { query: "glass" })).toMatchObject({ ok: true });
  });
});

describe("the process", () => {
  const run = (flags: readonly string[], input: string) => bun([cliPath, "mcp", ...flags], { input, encoding: "utf8", cwd: scratch });

  it("writes JSON-RPC lines and nothing else to stdout, nothing to stderr, and exits 0 at the end of its input", () => {
    const done = run(["--root", mcpHome], [request(1, "initialize", { protocolVersion: "2025-06-18" }), { jsonrpc: "2.0", method: "notifications/initialized" }, request(2, "tools/list"), toolCall(3, "scene_validate", { document: "v1.json" }), "{broken"].map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n"));
    expect(done.status).toBe(0);
    expect(done.stderr).toBe("");
    const lines = done.stdout.split("\n");
    expect(lines.pop()).toBe("");
    const messages = lines.map((line) => record(JSON.parse(line)));
    expect(messages.map((message) => message["id"])).toEqual([1, 2, 3, null]);
    expect(messages.every((message) => message["jsonrpc"] === "2.0")).toBe(true);
  });

  it("ends at once for an input with nothing in it", () => {
    const done = run([], "");
    expect(done).toMatchObject({ status: 0, stdout: "", stderr: "" });
  });

  // A preload that records every process started and every connection or listener opened, and says so in a file; a control proves it sees them.
  const preload = join(scratch, "trace.preload.mjs");
  const trace = (name: string): string => join(scratch, `${name}.trace`);
  writeFileSync(
    preload,
    `import cp from "node:child_process";
import net from "node:net";
import { appendFileSync } from "node:fs";
const note = (kind, what) => appendFileSync(process.env.LUMIN_TRACE, JSON.stringify({ kind, what }) + "\\n");
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  const real = cp[name];
  cp[name] = function (...args) { note("process", name); return real.apply(this, args); };
}
for (const [owner, name] of [[net.Socket.prototype, "connect"], [net.Server.prototype, "listen"]]) {
  const real = owner[name];
  owner[name] = function (...args) { note("network", name); return real.apply(this, args); };
}
for (const name of ["spawn", "spawnSync", "listen", "connect", "serve", "udpSocket"]) {
  const real = Bun[name];
  Bun[name] = function (...args) { note(name.startsWith("spawn") ? "process" : "network", "Bun." + name); return real.apply(this, args); };
}
const realFetch = globalThis.fetch;
globalThis.fetch = (...args) => { note("network", "fetch"); return realFetch(...args); };
`,
  );
  const traced = (name: string, args: readonly string[], input: string) => {
    const file = trace(name);
    const done = bun(["--preload", preload, ...args], { input, encoding: "utf8", cwd: scratch, env: { ...process.env, LUMIN_TRACE: file } });
    const lines = (() => {
      try {
        return readFileSync(file, "utf8").split("\n").filter((line) => line !== "");
      } catch {
        return [];
      }
    })();
    return { done, seen: lines.map((line) => record(JSON.parse(line))["kind"]) };
  };

  it("the trace sees a process started and a connection opened (the control)", () => {
    const { seen } = traced("control", ["-e", 'import cp from "node:child_process"; import net from "node:net"; cp.spawnSync("true"); Bun.spawnSync(["true"]); net.createServer().listen(0, "127.0.0.1", function () { this.close(); });'], "");
    expect([seen.includes("process"), seen.includes("network")]).toEqual([true, true]);
  });

  it("starts no process and opens no connection to answer every tool but a render, with every root and flag but the render's", () => {
    const calls = [
      request(1, "initialize", { protocolVersion: "2025-06-18" }),
      request(2, "tools/list"),
      ...fixtures.flatMap((name, index) => [toolCall(10 + index, "scene_validate", { document: name }), toolCall(30 + index, "scene_export", { document: name, as: "link" }), toolCall(50 + index, "scene_patch", { document: name, ops })]),
      toolCall(80, "scene_diff", { a: "v1.json", b: "v0.json" }),
      toolCall(81, "scene_export", { document: "v1.json", as: "tsx", out: "traced.tsx" }),
      toolCall(82, "asset_search", { query: "glass" }),
      toolCall(83, "asset_show", { id: "button-primary" }),
      toolCall(84, "scene_validate", { document: "../elsewhere.json" }),
    ];
    for (const flags of [["--root", mcpHome], ["--root", mcpHome, "--allow-write"], ["--root", mcpHome, "--allow-write", "--allow-render"]]) {
      const { done, seen } = traced(`read-${String(flags.length)}`, [cliPath, "mcp", ...flags], calls.map((call) => JSON.stringify(call)).join("\n"));
      expect(done.status).toBe(0);
      expect(done.stdout.split("\n").filter((line) => line !== "")).toHaveLength(calls.length);
      expect([flags.join(" "), seen]).toEqual([flags.join(" "), []]);
    }
  }, 60_000);

  it("says one line on stderr and exits 2 for a flag it cannot use, a missing root and an argument", () => {
    for (const flags of [["--bogus"], ["--root", join(scratch, "no-such-folder")], ["--root", join(mcpHome, "v1.json")], ["stray"], ["--root"]]) {
      const done = run(flags, "");
      expect([flags.join(" "), done.status, done.stdout, done.stderr.split("\n").filter((line) => line !== "").length]).toEqual([flags.join(" "), 2, "", 1]);
      expect(done.stderr).not.toContain(scratch);
    }
  });
});
