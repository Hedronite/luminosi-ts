import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { root } from "./commands.js";

const canon = join(root, ".agents/skills");
const harnesses = [".claude/skills", ".cursor/skills", ".grok/skills"];

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

describe("skill copies", () => {
  it.each(harnesses)("%s matches .agents/skills byte for byte (run scripts/sync-skills)", (harness) => {
    const expected = files(canon).map((f) => relative(canon, f)).sort();
    const actual = files(join(root, harness)).map((f) => relative(join(root, harness), f)).sort();
    expect(actual).toEqual(expected);
    for (const file of expected) expect(readFileSync(join(root, harness, file), "utf8")).toBe(readFileSync(join(canon, file), "utf8"));
  });
});

const nu = spawnSync("nu", ["--version"], { encoding: "utf8" });
const hasNu = nu.status === 0;
if (!hasNu && process.env["LUMIN_REQUIRE_NU"] === "1") throw new Error("LUMIN_REQUIRE_NU=1 but `nu` is not on PATH");

interface Run {
  readonly code: number | null;
  readonly envelope: { ok: boolean; command: string; kind?: string; exit?: number; matches?: string[]; data?: unknown };
}

const isEnvelope = (value: unknown): value is Run["envelope"] => typeof value === "object" && value !== null && "ok" in value && "command" in value;

const runSkill = (skill: string, args: readonly string[]): Run => {
  const result = spawnSync("nu", [join(canon, skill, `${skill}.nu`), ...args], { cwd: root, encoding: "utf8" });
  const line = result.stdout.trim().split("\n").filter((l) => l.startsWith("{")).at(-1) ?? "{}";
  const parsed: unknown = JSON.parse(line);
  const envelope = isEnvelope(parsed) ? parsed : { ok: false, command: "" };
  return { code: result.status, envelope };
};

describe.runIf(hasNu)("skills through Nushell", () => {
  it("lumin search returns ranked rows and exits 0", () => {
    const { code, envelope } = runSkill("lumin", ["search", "cube", "--limit", "3"]);
    expect(code).toBe(0);
    expect(envelope.ok).toBe(true);
    expect(JSON.stringify(envelope.data)).toContain('"score"');
  });

  it("lumin show of an unknown id exits 1 with matches", () => {
    const { code, envelope } = runSkill("lumin", ["show", "platonic-cub"]);
    expect(code).toBe(1);
    expect(envelope.kind).toBe("unknown_asset");
    expect(envelope.matches).toContain("platonic-cube");
  });

  it("lumin list with an unknown kind exits 2", () => {
    const { code, envelope } = runSkill("lumin", ["list", "--kind", "sound"]);
    expect(code).toBe(2);
    expect(envelope.kind).toBe("usage");
  });

  it("lumin-new icon --dry-run returns the plan", () => {
    const dir = mkdtempSync(join(tmpdir(), "lumin-"));
    const svg = join(dir, "dash.svg");
    writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 12h14"/></svg>');
    const { code, envelope } = runSkill("lumin-new", ["icon", "lumin-test-dash", "--name", "Dash", "--tags", "action", "--svg", svg, "--dry-run"]);
    expect(code).toBe(0);
    expect(JSON.stringify(envelope.data)).toContain('"dryRun":true');
  });

  it("lumin-check runs one step and reports it", () => {
    const { code, envelope } = runSkill("lumin-check", ["--only", "icons:check"]);
    expect(code).toBe(0);
    expect(JSON.stringify(envelope.data)).toContain('"step":"icons:check"');
  });
});
