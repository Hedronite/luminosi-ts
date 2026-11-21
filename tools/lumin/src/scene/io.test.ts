import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { root } from "../commands.js";
import type { Envelope } from "../envelope.js";
import { closestIds, diskFiles, jsonSyntaxError, lineAndColumn, MAX_DOCUMENT_BYTES, nodeContext, parseText, type Context } from "./io.js";
import { operationNamed } from "./table.js";

const ctx = await nodeContext();
const scratch = mkdtempSync(join(tmpdir(), "lts-w7-io-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const fixture = (name: string): string => join(root, "packages/scene/fixtures", `${name}.json`);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const objectOf = (text: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error("not an object");
  return parsed;
};
const inlineOf = (path: string): Record<string, unknown> => objectOf(readFileSync(path, "utf8"));

const validate = async (document: string | Record<string, unknown>, context: Context = ctx): Promise<Envelope> => {
  const row = operationNamed("validate");
  if (row === undefined) throw new Error("no validate row");
  return row.run({ document }, context);
};

const withStdin = (text: string): Context => ({ ...ctx, stdin: () => Promise.resolve({ ok: true, value: text }) });

describe("a document reads the same from a path, from stdin and inline", () => {
  it.each(["v1", "v0", "transform-hierarchy", "object-effects-ink"])("%s", async (name) => {
    const text = readFileSync(fixture(name), "utf8");
    const byPath = await validate(fixture(name));
    const byStdin = await validate("-", withStdin(text));
    const inline = await validate(inlineOf(fixture(name)));
    expect(byPath.ok).toBe(true);
    expect(byStdin).toEqual(byPath);
    expect(inline).toEqual(byPath);
  });

  it("and an invalid one reports the same issues by each way in", async () => {
    const text = readFileSync(fixture("primitives-in-materials"), "utf8").replace('"platonic-cube"', '"platonic-cub"').replace('"look": "neutral"', '"look": "neutrl"');
    const path = join(scratch, "invalid.json");
    writeFileSync(path, text);
    const byPath = await validate(path);
    expect(byPath.ok).toBe(false);
    expect(await validate("-", withStdin(text))).toEqual(byPath);
    expect(await validate(objectOf(text))).toEqual(byPath);
  });
});

describe("the size cap", () => {
  const base = readFileSync(fixture("v1"), "utf8");
  const padded = (bytes: number): string => base + " ".repeat(bytes - Buffer.byteLength(base));

  it("takes a document of exactly the cap, and refuses one byte more, untruncated, from a path", async () => {
    const exact = join(scratch, "exact.json");
    const over = join(scratch, "over.json");
    writeFileSync(exact, padded(MAX_DOCUMENT_BYTES));
    writeFileSync(over, padded(MAX_DOCUMENT_BYTES + 1));
    expect((await validate(exact)).ok).toBe(true);
    const refused = await validate(over);
    expect(refused).toMatchObject({ ok: false, kind: "too_large", exit: 1 });
    expect(JSON.stringify(refused)).not.toContain("lts-scene");
    expect(refused.ok ? "" : refused.error).toContain(String(MAX_DOCUMENT_BYTES + 1));
  });

  it("refuses an inline object over the cap", async () => {
    const refused = await validate({ ...inlineOf(fixture("v1")), padding: "x".repeat(MAX_DOCUMENT_BYTES) });
    expect(refused).toMatchObject({ ok: false, kind: "too_large" });
  });

  it("refuses stdin over the cap and reads none of the rest (through the command line)", () => {
    const argv = [join(root, "tools/lumin/src/cli.ts"), "scene", "validate", "-"];
    const run = (text: string) => spawnSync("bun", argv, { input: text, encoding: "utf8", cwd: root });
    const refused = run(padded(MAX_DOCUMENT_BYTES + 1));
    expect(refused.status).toBe(1);
    expect(JSON.parse(refused.stdout)).toMatchObject({ ok: false, kind: "too_large" });
    const exact = run(padded(MAX_DOCUMENT_BYTES));
    expect(exact.status).toBe(0);
  }, 20_000);
});

describe("JSON that is not JSON says where", () => {
  const cases: readonly (readonly [string, string, number, number])[] = [
    ["an empty text", "", 1, 1],
    ["an object left open", "{", 1, 2],
    ["a trailing comma in an object", '{"a":1,}', 1, 8],
    ["a missing colon", '{"a" 1}', 1, 6],
    ["a bare word cut short, on line 2", '{\n  "a": tru\n}', 2, 11],
    ["a missing comma", '{"a": 1 2}', 1, 9],
    ["a trailing comma in a list, on line 3", "[1,\n2,\n]", 3, 1],
    ["a line break in a string", '{"a":"x\ny"}', 1, 8],
    ["text after the document", "{} x", 1, 4],
    ["a bad escape", '{"a":"\\q"}', 1, 8],
    ["a leading zero", "[01]", 1, 3],
    ["lines ended by CRLF", '{\r\n "a" 1}', 2, 6],
  ];
  it.each(cases)("%s", (_name, text, line, column) => {
    const parsed = parseText(text);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.failure.kind).toBe("invalid");
    expect(parsed.failure.data).toMatchObject({ valid: false, line, column });
    expect(parsed.failure.error).toContain(`line ${String(line)}, column ${String(column)}`);
  });

  it("answers as JSON.parse does, for any text", () => {
    const parses = (text: string): boolean => {
      try {
        JSON.parse(text);
        return true;
      } catch {
        return false;
      }
    };
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.json(), fc.json().map((text) => text.slice(0, -1)), fc.json().map((text) => `${text.slice(0, 1)} ${text.slice(1)}x`)), (text) => {
        expect(jsonSyntaxError(text) === undefined).toBe(parses(text));
      }),
      { numRuns: 300 },
    );
  });

  it("counts a line and a column from 1", () => {
    expect(lineAndColumn("abc\ndef", 0)).toEqual({ line: 1, column: 1 });
    expect(lineAndColumn("abc\ndef", 5)).toEqual({ line: 2, column: 2 });
  });
});

describe("what is not a scene document", () => {
  it.each([
    ["an array", "[]"],
    ["a string", '"abc"'],
    ["a number", "7"],
    ["null", "null"],
  ])("%s is invalid at the root, not a throw", async (_name, text) => {
    const path = join(scratch, "not-an-object.json");
    writeFileSync(path, text);
    expect(await validate(path)).toMatchObject({ ok: false, kind: "invalid", data: { valid: false, issues: [{ path: [], code: "wrong-type" }] } });
  });

  it("a byte order mark is not part of the text", async () => {
    const path = join(scratch, "bom.json");
    writeFileSync(path, `${String.fromCharCode(0xfeff)}${readFileSync(fixture("v1"), "utf8")}`);
    expect((await validate(path)).ok).toBe(true);
  });

  it("text that is not UTF-8 is invalid", async () => {
    const path = join(scratch, "latin1.json");
    writeFileSync(path, Buffer.from([0x7b, 0x22, 0xe9, 0x22, 0x3a, 0x31, 0x7d]));
    expect(await validate(path)).toMatchObject({ ok: false, kind: "invalid" });
  });

  it("a missing file and a folder are named, and the path is not echoed", async () => {
    const missing = await validate(join(scratch, "nope.json"));
    expect(missing).toMatchObject({ ok: false, kind: "not_found" });
    expect(JSON.stringify(missing)).not.toContain(scratch);
    expect(await validate(scratch)).toMatchObject({ ok: false, kind: "failed" });
  });

  it("a version that is not this one is named, with the version it declared", async () => {
    const future = { ...inlineOf(fixture("v1")), version: 5 };
    expect(await validate(future)).toMatchObject({ ok: false, kind: "invalid", data: { valid: false, version: 5, issues: [{ path: ["version"], code: "unsupported-version" }] } });
  });
});

describe("writing", () => {
  it("takes a new path, refuses an existing one, and replaces it with force", () => {
    const path = join(scratch, "out.json");
    expect(diskFiles.write(path, "one", false)).toEqual({ ok: true, value: 3 });
    expect(diskFiles.write(path, "two", false)).toMatchObject({ ok: false, failure: { kind: "exists" } });
    expect(readFileSync(path, "utf8")).toBe("one");
    expect(diskFiles.write(path, "three", true)).toEqual({ ok: true, value: 5 });
    expect(readFileSync(path, "utf8")).toBe("three");
  });

  it("does not make a folder", () => {
    expect(diskFiles.write(join(scratch, "missing-folder", "out.json"), "x", false)).toMatchObject({ ok: false, failure: { kind: "failed" } });
    mkdirSync(join(scratch, "made"));
    expect(diskFiles.write(join(scratch, "made", "out.json"), "x", false).ok).toBe(true);
  });
});

describe("the closest ids", () => {
  const ids = ["platonic-cube", "platonic-cone", "platonic-icosahedron", "metal", "ceramic"];
  it("name a mistyped id's neighbours, nearest first", () => {
    expect(closestIds("platonic-cub", ids)[0]).toBe("platonic-cube");
    expect(closestIds("metall", ids)).toContain("metal");
    expect(closestIds("zzzzzzzz", ids)).toEqual([]);
  });
});
