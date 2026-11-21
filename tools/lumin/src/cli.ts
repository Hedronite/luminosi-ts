// lumin: the LuminosiTS agent CLI. Prints one JSON envelope and exits with its code.
//   bun tools/lumin/src/cli.ts <command> [args] [--flag=value]
// The lumin skills (.agents/skills/lumin*) wrap this with Nushell. See SKILL.md there.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { boundaries, budgets, check, iconPacks, kinds, list, newIcon, packages, root, search, show } from "./commands.js";
import { fail, ok, type Envelope } from "./envelope.js";

const usage = "commands: kinds | scene validate|diff|patch|export|render (a scene document: lumin scene, or the lumin-scene skill) | mcp [--root PATH]... [--allow-write] [--allow-render] (the scene and asset tools over stdio, for an MCP client) | list [--kind --package --tag --limit --newest] | search QUERY [--kind --limit] | show ID | packages | icon-packs | budgets | boundaries [--package] | check [--only a,b --keep-going] | new-icon ID --name N --tags a,b (--svg FILE | --stdin) [--dry-run] | new-object ID (--from-image IMG | --from-workspace DIR) [--name N --tags a,b --dry-run] | review-object --spec FILE --reference IMG [--out DIR --look L --yaw D --pitch D] | study VENDOR[/PATH] [--limit] | adopt VENDOR/PATH --as KIND --id ID [--name N --dry-run] | adopt-skill VENDOR/SKILL-DIR [--dry-run --force] | ui-facts FILE... | ui-render --url URL [--views a,b] (for the lumin-ui skill)";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString("utf8");
}

async function run(argv: readonly string[]): Promise<Envelope> {
  const [command = "", ...rest] = argv;
  // The scene operations take their flags from the operation table, so they are read before the fixed list below.
  if (command === "scene") return (await import("./scene/command.js")).sceneCommand(rest);
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
        "from-image": { type: "string" },
        "from-workspace": { type: "string" },
        spec: { type: "string" },
        reference: { type: "string" },
        out: { type: "string" },
        look: { type: "string" },
        yaw: { type: "string" },
        pitch: { type: "string" },
        as: { type: "string" },
        id: { type: "string" },
        force: { type: "boolean" },
        url: { type: "string" },
        views: { type: "string" },
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
    case "icon-packs":
      return iconPacks();
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
    case "new-object": {
      const id = positionals[0];
      if (id === undefined) return fail("new-object", "usage", "new-object needs an id");
      // Loaded on demand: it brings in the review loop (Playwright), which the other commands don't need.
      const { newObject } = await import("./objects.js");
      return newObject(
        id,
        {
          ...(values["from-image"] === undefined ? {} : { fromImage: values["from-image"] }),
          ...(values["from-workspace"] === undefined ? {} : { fromWorkspace: values["from-workspace"] }),
          ...(values.name === undefined ? {} : { name: values.name }),
          ...(values.tags === undefined ? {} : { tags: csv(values.tags) }),
          dryRun: values["dry-run"] === true,
        },
        { root },
      );
    }
    case "review-object": {
      if (values.spec === undefined || values.reference === undefined) return fail("review-object", "usage", "review-object needs --spec FILE and --reference IMG");
      const angle = (value: string | undefined, label: string): number | undefined => {
        if (value === undefined) return undefined;
        const n = Number(value);
        if (!Number.isFinite(n)) throw new RangeError(`--${label} must be a number of degrees`);
        return n;
      };
      let yaw: number | undefined;
      let pitch: number | undefined;
      try {
        yaw = angle(values.yaw, "yaw");
        pitch = angle(values.pitch, "pitch");
      } catch (error: unknown) {
        return fail("review-object", "usage", error instanceof Error ? error.message : String(error));
      }
      const { reviewObjectCommand } = await import("./objects.js");
      return reviewObjectCommand(
        {
          spec: values.spec,
          reference: values.reference,
          ...(values.out === undefined ? {} : { out: values.out }),
          ...(values.look === undefined ? {} : { look: values.look }),
          ...(yaw === undefined ? {} : { yaw }),
          ...(pitch === undefined ? {} : { pitch }),
        },
        { root },
      );
    }
    case "ui-facts": {
      if (positionals.length === 0) return fail("ui-facts", "usage", "ui-facts needs one or more .tsx files");
      const missing = positionals.filter((file) => !existsSync(file));
      if (missing.length > 0) return fail("ui-facts", "not_found", `no such file: ${missing.join(", ")}`);
      const { uiFactsFor } = await import("./uifacts.js");
      return ok("ui-facts", uiFactsFor(positionals));
    }
    case "ui-render": {
      if (values.url === undefined) return fail("ui-render", "usage", "ui-render needs --url, a running catalog (bun run --filter catalog preview)");
      const { catalogViews, renderAudit } = await import("./uirender.js");
      const views = csv(values.views);
      const unknown = views.filter((view) => !catalogViews.some((known) => known === view));
      if (unknown.length > 0) return fail("ui-render", "usage", `unknown view: ${unknown.join(", ")}; one of ${catalogViews.join(", ")}`);
      try {
        return ok("ui-render", await renderAudit(values.url, views.length > 0 ? views : catalogViews));
      } catch (error: unknown) {
        return fail("ui-render", "no_server", `could not audit ${values.url}: ${error instanceof Error ? error.message.split("\n")[0] ?? "" : String(error)}`);
      }
    }
    case "study":
    case "adopt":
    case "adopt-skill": {
      const target = positionals[0];
      if (target === undefined) return fail(command, "usage", `${command} needs a vendored path, such as threeui/src/shaders/crt`);
      const { adopt, adoptSkill, study } = await import("./adopt.js");
      const vendorDir = join(root, "assets/vendor");
      if (command === "adopt-skill") return adoptSkill(target, { dryRun: values["dry-run"] === true, force: values.force === true }, { root, vendorDir });
      if (command === "study") return study(target, limit === undefined ? {} : { limit }, { vendorDir });
      const { loadRegistry } = await import("@hedronite/lts-registry");
      return adopt(
        target,
        { ...(values.as === undefined ? {} : { as: values.as }), ...(values.id === undefined ? {} : { id: values.id }), ...(values.name === undefined ? {} : { name: values.name }), dryRun: values["dry-run"] === true },
        { root, vendorDir, registry: loadRegistry() },
      );
    }
    default:
      return fail(command || "lumin", "usage", command === "" ? usage : `unknown command "${command}". ${usage}`);
  }
}

if (process.argv[2] === "mcp") {
  // The MCP server speaks JSON-RPC on stdout for as long as its input lasts, so it prints no envelope of its own; it ends when stdin does.
  process.exitCode = await (await import("./mcp/command.js")).mcpMain(process.argv.slice(3));
} else {
  const envelope = await run(process.argv.slice(2));
  console.log(JSON.stringify(envelope));
  process.exit(envelope.ok ? 0 : envelope.exit);
}
