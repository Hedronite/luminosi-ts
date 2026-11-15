// lumin: the LuminosiTS agent CLI. Prints one JSON envelope and exits with its code.
//   bun tools/lumin/src/cli.ts <command> [args] [--flag=value]
// The lumin skills (.agents/skills/lumin*) wrap this with Nushell. See SKILL.md there.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { boundaries, budgets, check, kinds, list, newIcon, packages, search, show } from "./commands.js";
import { fail, type Envelope } from "./envelope.js";

const usage = "commands: kinds | list [--kind --package --tag --limit --newest] | search QUERY [--kind --limit] | show ID | packages | budgets | boundaries [--package] | check [--only a,b --keep-going] | new-icon ID --name N --tags a,b (--svg FILE | --stdin) [--dry-run]";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString("utf8");
}

async function run(argv: readonly string[]): Promise<Envelope> {
  const [command = "", ...rest] = argv;
  let parsed;
  try {
    parsed = parseArgs({
      args: [...rest],
      allowPositionals: true,
      options: {
        kind: { type: "string" },
        package: { type: "string" },
        tag: { type: "string" },
        limit: { type: "string" },
        newest: { type: "boolean" },
        only: { type: "string" },
        "keep-going": { type: "boolean" },
        name: { type: "string" },
        tags: { type: "string" },
        svg: { type: "string" },
        stdin: { type: "boolean" },
        "dry-run": { type: "boolean" },
      },
    });
  } catch (error: unknown) {
    return fail(command || "lumin", "usage", error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  const limit = values.limit === undefined ? undefined : Number.parseInt(values.limit, 10);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) return fail(command, "usage", "--limit must be a positive integer");
  const csv = (value: string | undefined): readonly string[] => (value ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
  switch (command) {
    case "kinds":
      return kinds();
    case "list":
      return list({ ...(values.kind === undefined ? {} : { kind: values.kind }), ...(values.package === undefined ? {} : { package: values.package }), ...(values.tag === undefined ? {} : { tag: values.tag }), ...(limit === undefined ? {} : { limit }), newest: values.newest === true });
    case "search":
      return search(positionals.join(" "), { ...(values.kind === undefined ? {} : { kind: values.kind }), ...(limit === undefined ? {} : { limit }) });
    case "show":
      return positionals[0] === undefined ? fail("show", "usage", "show needs an asset id") : show(positionals[0]);
    case "packages":
      return packages();
    case "budgets":
      return budgets();
    case "boundaries":
      return boundaries(values.package);
    case "check":
      return check({ only: csv(values.only), keepGoing: values["keep-going"] === true });
    case "new-icon": {
      const id = positionals[0];
      if (id === undefined) return fail("new-icon", "usage", "new-icon needs an id");
      let svg: string;
      if (values.stdin === true) svg = await readStdin();
      else if (values.svg !== undefined) svg = readFileSync(values.svg, "utf8");
      else return fail("new-icon", "usage", "pass the SVG with --svg FILE or --stdin");
      return newIcon(id, { name: values.name ?? "", tags: csv(values.tags), svg, dryRun: values["dry-run"] === true });
    }
    default:
      return fail(command || "lumin", "usage", command === "" ? usage : `unknown command "${command}". ${usage}`);
  }
}

const envelope = await run(process.argv.slice(2));
console.log(JSON.stringify(envelope));
process.exit(envelope.ok ? 0 : envelope.exit);
