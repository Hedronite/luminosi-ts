// `lumin mcp [--root PATH]... [--allow-write] [--allow-render]`: the scene tools as an MCP server on stdio. It reads JSON-RPC from stdin and writes it
// to stdout, and prints nothing else; a flag it cannot use is the one thing it says on stderr, before it exits with 2.
import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { serve } from "./server.js";
import type { Options } from "./tools.js";

/** What the server is started with, from the words after `mcp`, or what is wrong with them. */
export function optionsFrom(args: readonly string[]): { readonly ok: true; readonly options: Options } | { readonly ok: false; readonly error: string } {
  let parsed;
  try {
    parsed = parseArgs({ args: [...args], allowPositionals: true, options: { root: { type: "string", multiple: true }, "allow-write": { type: "boolean" }, "allow-render": { type: "boolean" } } });
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (parsed.positionals.length > 0) return { ok: false, error: `mcp takes no arguments but flags; unexpected "${parsed.positionals[0] ?? ""}"` };
  const roots: string[] = [];
  for (const given of parsed.values.root ?? []) {
    try {
      const real = realpathSync.native(resolve(given));
      if (!statSync(real).isDirectory()) return { ok: false, error: "--root is not a folder" };
      if (!roots.includes(real)) roots.push(real);
    } catch {
      return { ok: false, error: "--root is not a folder that exists" };
    }
  }
  return { ok: true, options: { roots, allowWrite: parsed.values["allow-write"] === true, allowRender: parsed.values["allow-render"] === true } };
}

/** Runs the server on this process's stdin and stdout, and gives its exit code: 0 when the input ends, 2 for flags it cannot use. */
export async function mcpMain(args: readonly string[]): Promise<number> {
  const started = optionsFrom(args);
  if (!started.ok) {
    process.stderr.write(`lumin mcp: ${started.error}. usage: lumin mcp [--root PATH]... [--allow-write] [--allow-render]\n`);
    return 2;
  }
  const emit = (line: string): Promise<void> =>
    new Promise((done, failed) => {
      process.stdout.write(`${line}\n`, (error) => {
        if (error) failed(error);
        else done();
      });
    });
  try {
    await serve(process.stdin, emit, started.options);
    return 0;
  } catch {
    // The client went away mid-write: there is no one to tell.
    return 1;
  }
}
