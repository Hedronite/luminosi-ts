import { describe, expect, it } from "vitest";
import { z } from "zod";
import { inputFromArgs, sceneCommand } from "./command.js";
import { operationNamed, operations } from "./table.js";

/** The sentence of a failure, or an empty one for a success. */
const failure = (result: { readonly ok: boolean; readonly error?: string }): string => (result.ok ? "" : (result.error ?? ""));

const row = (name: string) => {
  const found = operationNamed(name);
  if (found === undefined) throw new Error(`no ${name} row`);
  return found;
};

describe("the table", () => {
  it("lists each operation once, with the four the command line has", () => {
    const names = operations.map((operation) => operation.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(["validate", "diff", "patch", "export"]));
  });

  it.each(operations.map((operation) => [operation.name, operation] as const))("%s has a summary, a zod input, readOnly, needs and positionals that are input fields", (_name, operation) => {
    expect(operation.summary.length).toBeGreaterThan(20);
    expect(operation.input).toBeInstanceOf(z.ZodType);
    expect(["none", "render", "write"]).toContain(operation.needs);
    const fields = Object.keys(z.toJSONSchema(operation.input, { io: "input", unrepresentable: "any" }).properties ?? {});
    for (const field of operation.positional) expect(fields).toContain(field);
    // A row that can write a file is not read-only, and a read-only row writes nothing.
    expect(operation.readOnly).toBe(!fields.includes("out"));
    expect(operation.readOnly ? operation.needs !== "write" : operation.needs === "write" || operation.needs === "render").toBe(true);
  });

  it("answers an input that is not its own with a usage envelope, never a throw", async () => {
    for (const operation of operations) {
      // eslint-disable-next-line no-await-in-loop -- one row at a time, so a failure names it
      expect(await operation.run(7, { resolve: () => undefined, ids: () => [], files: { read: () => ({ ok: false, failure: { kind: "failed", error: "no" } }), write: () => ({ ok: false, failure: { kind: "failed", error: "no" } }) }, stdin: () => Promise.resolve({ ok: false, failure: { kind: "failed", error: "no" } }) })).toMatchObject({ ok: false, kind: "usage", exit: 2, command: `scene ${operation.name}` });
    }
  });
});

describe("the command line's flags are the rows' own fields", () => {
  it("fills positionals in the row's order and flags by name, booleans without a value", () => {
    expect(inputFromArgs(row("patch"), ["scene.json", "--ops", "[]", "--out", "o.json", "--force"])).toEqual({ ok: true, input: { document: "scene.json", ops: "[]", out: "o.json", force: true } });
    expect(inputFromArgs(row("diff"), ["a.json", "b.json"])).toEqual({ ok: true, input: { a: "a.json", b: "b.json" } });
    expect(inputFromArgs(row("export"), ["-", "--as=tsx"])).toEqual({ ok: true, input: { document: "-", as: "tsx" } });
  });

  it("accepts every field of every row as a flag", () => {
    for (const operation of operations) {
      for (const [field, property] of Object.entries(z.toJSONSchema(operation.input, { io: "input", unrepresentable: "any" }).properties ?? {})) {
        // A flag with no value is a boolean field: force, and the render row's gpu.
        const boolean = typeof property === "object" && property.type === "boolean";
        const parsed = inputFromArgs(operation, boolean ? [`--${field}`] : [`--${field}`, "x"]);
        expect(parsed, `${operation.name} --${field}`).toEqual({ ok: true, input: { [field]: boolean ? true : "x" } });
      }
    }
  });

  it("refuses a flag the row does not have, an extra argument and a field given twice", () => {
    expect(inputFromArgs(row("validate"), ["a.json", "--bogus", "1"])).toMatchObject({ ok: false });
    expect(failure(inputFromArgs(row("validate"), ["a.json", "b.json"]))).toContain('unexpected "b.json"');
    expect(failure(inputFromArgs(row("validate"), ["a.json", "--document", "b.json"]))).toContain("twice");
  });

  it("names the operations when none, or an unknown one, is given", async () => {
    const none = await sceneCommand([]);
    expect(none).toMatchObject({ ok: false, kind: "usage", exit: 2 });
    expect(failure(none)).toContain("validate | diff | patch | export");
    const unknown = await sceneCommand(["frobnicate"]);
    expect(unknown).toMatchObject({ ok: false, kind: "usage" });
    expect(failure(unknown)).toContain('unknown scene operation "frobnicate"');
    expect(await sceneCommand(["validate", "--bogus"])).toMatchObject({ ok: false, kind: "usage", command: "scene validate" });
  });
});
