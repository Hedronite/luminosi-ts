// `lumin mcp --allow-render --allow-write` (tools/lumin/src/mcp), run for real as a client runs it: a scene document under a root is drawn to a PNG under that
// root by the `scene_render` tool, in headless Chromium on software WebGL, and the result is the same picture the command line draws, in an envelope that says its
// `out` as it was given and holds no absolute path. The tool is held to its flags and its roots: a path outside the root, and a path that is there, are refused
// before a browser starts. It needs the catalog built (bun run build). The file is named render.spec.ts so the run against a served container leaves it out with the other render spec.
import { spawnSync, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { decodePng } from "../../tools/stills/src/png.js";

const bun = (args: readonly string[], options: SpawnSyncOptionsWithStringEncoding): SpawnSyncReturns<string> => spawnSync("bun", args, options);

const root = join(import.meta.dirname, "../..");
const cli = join(root, "tools/lumin/src/cli.ts");
const base = realpathSync(mkdtempSync(join(tmpdir(), "lts-mcp-render-")));
const home = join(base, "home");
test.afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const record = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error("not an object");
  return value;
};
const everyString = (value: unknown): string[] => (typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(everyString) : isRecord(value) ? Object.values(value).flatMap(everyString) : []);

/** A session of the server as a client runs it: the lines it is sent, the replies it gives, and how it ended. */
function session(flags: readonly string[], messages: readonly Record<string, unknown>[]): { readonly replies: readonly Record<string, unknown>[]; readonly status: number | null; readonly stderr: string } {
  const done = bun([cli, "mcp", ...flags], { input: `${messages.map((message) => JSON.stringify(message)).join("\n")}\n`, encoding: "utf8", cwd: base, maxBuffer: 64 * 1024 * 1024 });
  return { replies: done.stdout.split("\n").filter((line) => line !== "").map((line) => record(JSON.parse(line))), status: done.status, stderr: done.stderr };
}
const call = (id: number, args: Record<string, unknown>): Record<string, unknown> => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "scene_render", arguments: args } });
const resultOf = (reply: Record<string, unknown> | undefined): Record<string, unknown> => record(record(reply)["result"]);
const envelopeOf = (reply: Record<string, unknown> | undefined): Record<string, unknown> => record(resultOf(reply)["structuredContent"]);

test("scene_render draws a document under a root to a PNG under it, as the command line draws it, and holds to its flags and its roots", () => {
  test.setTimeout(300_000);
  cpSync(join(root, "packages/scene/fixtures"), home, { recursive: true });
  const flags = ["--root", home, "--allow-write", "--allow-render"];
  const { replies, status, stderr } = session(flags, [
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    call(2, { document: "transform-hierarchy.json", out: "frame.png" }),
    call(3, { document: "transform-hierarchy.json", out: "frame.png" }),
    call(4, { document: "transform-hierarchy.json", out: "../outside.png", force: true }),
    call(5, { document: "transform-hierarchy.json", out: "frame.png", force: true, width: 320, height: 192 }),
    call(6, { document: { format: "lts-scene", version: 1 }, out: "bad.png" }),
  ]);
  expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
  expect(replies.map((reply) => reply["id"])).toEqual([1, 2, 3, 4, 5, 6]);

  const listed = record(record(replies[0])["result"])["tools"];
  expect(Array.isArray(listed) && listed.map((tool) => record(tool)["name"])).toContain("scene_render");

  const first = envelopeOf(replies[1]);
  expect(resultOf(replies[1])["isError"]).toBe(false);
  expect(first).toMatchObject({ ok: true, command: "scene render", data: { out: "frame.png", width: 512, height: 512 } });
  const bytes = readFileSync(join(home, "frame.png"));
  expect(record(first["data"])["sha256"], "the digest is of the file written, under the root").toBe(createHash("sha256").update(bytes).digest("hex"));
  expect(record(first["data"])["renderer"]).toMatch(/swiftshader/i);
  expect(decodePng(bytes).width).toBe(512);

  // The same document, drawn by the command line, is the same picture.
  const printed = record(JSON.parse(bun([cli, "scene", "render", "transform-hierarchy.json", "--out", "cli.png"], { encoding: "utf8", cwd: home, maxBuffer: 16 * 1024 * 1024 }).stdout));
  expect(record(printed["data"])["sha256"], "the tool and the command line draw the same bytes").toBe(record(first["data"])["sha256"]);

  // A path that is there is refused unless force is given, and the file is not touched.
  expect(envelopeOf(replies[2])).toMatchObject({ ok: false, kind: "exists" });
  expect(resultOf(replies[2])["isError"]).toBe(true);
  // A path out of the root is the one fixed no_root, even with force, and nothing is written there.
  expect(envelopeOf(replies[3])).toMatchObject({ ok: false, kind: "no_root" });
  expect(existsSync(join(base, "outside.png"))).toBe(false);
  // With force the file is replaced, at the size asked.
  expect(envelopeOf(replies[4])).toMatchObject({ ok: true, data: { out: "frame.png", width: 320, height: 192 } });
  expect(decodePng(readFileSync(join(home, "frame.png"))).width).toBe(320);
  // A document that is not one is refused before the browser starts, and no file is made.
  expect(envelopeOf(replies[5])).toMatchObject({ ok: false, kind: "invalid" });
  expect(existsSync(join(home, "bad.png"))).toBe(false);

  expect(replies.flatMap(everyString).filter((text) => text.includes(base) || text.includes(root)), "no output holds a path of the machine").toEqual([]);
});

test("scene_render is not there without both flags: not listed, and a call is a protocol error", () => {
  for (const flags of [["--root", home, "--allow-render"], ["--root", home, "--allow-write"], ["--root", home]]) {
    const { replies } = session(flags, [{ jsonrpc: "2.0", id: 1, method: "tools/list" }, call(2, { document: "transform-hierarchy.json", out: "never.png" })]);
    const listed = record(record(replies[0])["result"])["tools"];
    expect(Array.isArray(listed) && listed.map((tool) => record(tool)["name"]), flags.join(" ")).not.toContain("scene_render");
    expect(record(replies[1])["error"], flags.join(" ")).toMatchObject({ code: -32602 });
    expect(existsSync(join(home, "never.png"))).toBe(false);
  }
});
