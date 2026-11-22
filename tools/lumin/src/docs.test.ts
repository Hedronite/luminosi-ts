import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assetKinds } from "@hedronite/lts-core";
import { describe, expect, it } from "vitest";
import { packages, root } from "./commands.js";

const read = (path: string): string => readFileSync(join(root, path), "utf8");

/** The `name` and `dir` of each row `lumin packages` prints. */
const actualPackages = (): readonly { readonly name: string; readonly dir: string }[] => {
  const envelope = packages();
  const rows: unknown = envelope.ok ? envelope.data : undefined;
  if (!Array.isArray(rows)) throw new Error("lumin packages did not return a list");
  return rows.map((row: unknown) => {
    const name = typeof row === "object" && row !== null && "name" in row ? row.name : undefined;
    const dir = typeof row === "object" && row !== null && "dir" in row ? row.dir : undefined;
    if (typeof name !== "string" || typeof dir !== "string") throw new Error("a package row has no name or dir");
    return { name, dir };
  });
};

/** The rows of the README's package table: `| \`dir\` | \`@scope/name\` | ... |`. */
const readmePackages = (): readonly { readonly name: string; readonly dir: string }[] =>
  [...read("README.md").matchAll(/^\| `([a-z0-9-]+)` \| `(@[^`]+)` \|/gm)].map((match) => ({ dir: `packages/${match[1] ?? ""}`, name: match[2] ?? "" }));

const byName = (a: { readonly name: string }, b: { readonly name: string }): number => a.name.localeCompare(b.name);

describe("README", () => {
  it("lists exactly the packages `lumin packages` finds, by directory and name", () => {
    expect([...readmePackages()].sort(byName)).toEqual([...actualPackages()].sort(byName));
  });

  it("lists exactly the apps in apps/", () => {
    const section = /\*\*Apps \(not published\):\*\*\n([\s\S]*?)\n\n/.exec(read("README.md"))?.[1] ?? "";
    const listed = [...section.matchAll(/^- `([a-z0-9-]+)` — /gm)].map((match) => match[1] ?? "").sort();
    const apps = readdirSync(join(root, "apps"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    expect(listed).toEqual(apps);
  });
});

describe("the lumin skill", () => {
  it("lists every asset kind, in the order of the core's list", () => {
    const line = read(".agents/skills/lumin/SKILL.md").split("\n").find((l) => l.startsWith("Kinds: "));
    const listed = [...(line ?? "").matchAll(/`([a-z]+)`/g)].map((match) => match[1] ?? "");
    expect(listed).toEqual([...assetKinds]);
  });
});

describe("vendored trees stay out of agent discovery", () => {
  const trees = ["assets/vendor", "tools/img-to-object/upstream"];
  /** The fetched cache, ignored in the same places; it holds raw upstream and is never in the repository. */
  const ignored = [...trees, ".vendor"];

  it("Claude Code skips CLAUDE.md files and rules under both trees (claudeMdExcludes)", () => {
    const settings: unknown = JSON.parse(read(".claude/settings.json"));
    const excludes = typeof settings === "object" && settings !== null && "claudeMdExcludes" in settings ? settings.claudeMdExcludes : undefined;
    expect(excludes).toEqual(ignored.map((tree) => `**/${tree}/**`));
  });

  it("Cursor is told to ignore both trees (.cursorignore)", () => {
    const lines = read(".cursorignore").split("\n").filter((line) => line.trim() !== "" && !line.startsWith("#"));
    expect(lines).toEqual(ignored.map((tree) => `${tree}/`));
  });

  it("no harness config folder sits inside either tree (nested skills and rules are discovered there)", () => {
    const harnessDirs = new Set([".claude", ".cursor", ".grok", ".agents", ".claude-plugin"]);
    const found = trees.flatMap((tree) =>
      readdirSync(join(root, tree), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isDirectory() && harnessDirs.has(entry.name) && !join(entry.parentPath, entry.name).includes("node_modules"))
        .map((entry) => join(entry.parentPath, entry.name)),
    );
    expect(found).toEqual([]);
  });
});
