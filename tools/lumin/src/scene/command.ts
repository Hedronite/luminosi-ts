// `lumin scene OPERATION [FILE…] [--flag value]`: the command line's way into the table. The flags are the row's own input fields, found by
// asking the row's schema, so a field added to a row is a flag with no other change.
import { parseArgs, type ParseArgsConfig } from "node:util";
import { z } from "zod";
import { fail, type Envelope } from "../envelope.js";
import { nodeContext } from "./io.js";
import { operationNamed, operations, type Operation } from "./table.js";

const usage = `scene operations: ${operations.map((operation) => operation.name).join(" | ")}. Each takes a document as a path, or - for stdin: scene validate FILE | scene diff A B | scene patch FILE --ops JSON [--out PATH --force] | scene export FILE --as tsx|vanilla|json|link [--out PATH --force]`;

/** The row's input fields, and which are booleans (the others take a value). */
function fieldsOf(operation: Operation): { readonly names: readonly string[]; readonly booleans: ReadonlySet<string> } {
  const schema = z.toJSONSchema(operation.input, { io: "input", unrepresentable: "any" });
  const properties = schema.properties ?? {};
  return { names: Object.keys(properties), booleans: new Set(Object.entries(properties).filter(([, property]) => typeof property === "object" && property.type === "boolean").map(([name]) => name)) };
}

/** The input a row is given from the words after its name: positionals in the row's order, then flags by field name. */
export function inputFromArgs(operation: Operation, args: readonly string[]): { readonly ok: true; readonly input: Record<string, unknown> } | { readonly ok: false; readonly error: string } {
  const { names, booleans } = fieldsOf(operation);
  const options: NonNullable<ParseArgsConfig["options"]> = Object.fromEntries(names.map((name) => [name, { type: booleans.has(name) ? ("boolean" as const) : ("string" as const) }]));
  let parsed;
  try {
    parsed = parseArgs({ args: [...args], allowPositionals: true, options });
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (parsed.positionals.length > operation.positional.length) return { ok: false, error: `scene ${operation.name} takes ${operation.positional.length === 0 ? "no positional arguments" : operation.positional.join(" ")}; unexpected "${parsed.positionals[operation.positional.length] ?? ""}"` };
  const input: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(parsed.values)) if (value !== undefined) input[name] = value;
  for (const [index, value] of parsed.positionals.entries()) {
    const name = operation.positional[index] ?? "";
    if (name in input) return { ok: false, error: `${name} is given twice, as an argument and as --${name}` };
    input[name] = value;
  }
  return { ok: true, input };
}

/** Runs `scene …` and gives its envelope. */
export async function sceneCommand(argv: readonly string[]): Promise<Envelope> {
  const [name, ...rest] = argv;
  if (name === undefined) return fail("scene", "usage", usage);
  const operation = operationNamed(name);
  if (operation === undefined) return fail("scene", "usage", `unknown scene operation "${name}". ${usage}`);
  const input = inputFromArgs(operation, rest);
  if (!input.ok) return fail(`scene ${operation.name}`, "usage", input.error);
  return operation.run(input.input, await nodeContext());
}
