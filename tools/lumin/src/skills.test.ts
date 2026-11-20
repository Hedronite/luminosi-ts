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

  // One process each: a test that starts two Nushell processes takes twice as long as one that starts one, and these are two separate facts.
  it("lumin-new object plans a forge workspace on a dry run", () => {
    const dir = mkdtempSync(join(tmpdir(), "lumin-"));
    const image = join(dir, "lamp.png");
    writeFileSync(image, "not really a png");
    const planned = runSkill("lumin-new", ["object", "lumin-test-lamp", "--from-image", image, "--dry-run"]);
    expect(planned.code).toBe(0);
    expect(JSON.stringify(planned.envelope.data)).toContain('"dryRun":true');
  });

  it("lumin-new object refuses a missing source", () => {
    const refused = runSkill("lumin-new", ["object", "lumin-test-lamp"]);
    expect(refused.code).toBe(2);
    expect(refused.envelope.kind).toBe("usage");
  });

  describe("lumin-ui", () => {
    const fixture = (name: string, body: string): string => {
      const dir = mkdtempSync(join(tmpdir(), "lumin-ui-"));
      const file = join(dir, name);
      writeFileSync(file, body);
      return file;
    };
    const rulesOf = (data: unknown): string[] => {
      const findings: unknown = typeof data === "object" && data !== null && "findings" in data ? data.findings : [];
      return Array.isArray(findings) ? findings.map((f: unknown) => (typeof f === "object" && f !== null && "rule" in f ? String(f.rule) : "")) : [];
    };

    it("rules lists the rule table", () => {
      const { code, envelope } = runSkill("lumin-ui", ["rules", "--area", "a11y"]);
      expect(code).toBe(0);
      expect(JSON.stringify(envelope.data)).toContain('"id":"a11y.pointer-only"');
      expect(JSON.stringify(envelope.data)).not.toContain('"area":"copy"');
    });

    it("scan finds what a broken component breaks, and nothing in a clean one", () => {
      const broken = fixture(
        "Broken.tsx",
        `import { Close } from "@hedronite/lts-icons/react";
export const Broken = () => (
  <section>
    <div onClick={() => {}} className="outline-none animate-spin">Open</div>
    <button className="bg-blue-500 transition-all"><Close /></button>
    <img src="a.png" />
    <span className="text-[10px] truncate">Long name</span>
    <button>OK</button>
  </section>
);`,
      );
      const { code, envelope } = runSkill("lumin-ui", ["scan", broken]);
      expect(code).toBe(0);
      expect(rulesOf(envelope.data).sort()).toEqual(
        ["a11y.focus-hidden", "a11y.img-alt", "a11y.pointer-only", "a11y.unnamed-control", "color.primitive", "copy.vague-action", "motion.no-reduce", "type.off-scale", "type.tiny-text", "type.truncated-unreachable", "ui.transition-all"].sort(),
      );
      const clean = fixture(
        "Clean.tsx",
        `export const Clean = ({ label }: { label: string }) => (
  <label className="flex gap-2">
    <input type="checkbox" />
    <button type="button" className="bg-accent text-on-accent focus-visible:outline-2 focus-visible:outline-accent">{label}</button>
  </label>
);`,
      );
      expect(rulesOf(runSkill("lumin-ui", ["scan", clean]).envelope.data)).toEqual([]);
    });

    it("scan reads CSS: a removed outline and an animation with no reduced-motion rule", () => {
      const css = fixture("bad.css", "button:focus { outline: none; }\n@keyframes spin { to { rotate: 1turn; } }\n");
      expect(rulesOf(runSkill("lumin-ui", ["scan", css]).envelope.data).sort()).toEqual(["a11y.focus-hidden", "motion.no-reduce"]);
    });

    it("contrast measures every token pair the UI uses, in every look and scheme", () => {
      const { code, envelope } = runSkill("lumin-ui", ["contrast"]);
      expect(code).toBe(0);
      const rows: unknown = envelope.data;
      expect(Array.isArray(rows) && rows.length).toBeGreaterThan(3);
      expect(JSON.stringify(rows)).toContain('"fg":"fg-muted","bg":"surface"');
      expect(JSON.stringify(rows)).toMatch(/"of":[1-9]\d/);
      // One run that starts `bun` twice and reads every UI file: 2.57 to 3.12 s on CI (2.80 to 2.93 s on main), so three times the largest reading, rounded up to 5 s.
    }, 10_000);

    it("scope works against HEAD", () => {
      expect(runSkill("lumin-ui", ["scope", "--against", "HEAD"]).envelope.ok).toBe(true);
    });

    it("a diff review works against HEAD", () => {
      const review = runSkill("lumin-ui", ["review", "--against", "HEAD"]);
      expect(review.code).toBe(0);
      expect(JSON.stringify(review.envelope.data)).toContain('"mode":"diff"');
    });

    it("render without a server says so", () => {
      const offline = runSkill("lumin-ui", ["render", "--url", "http://127.0.0.1:9"]);
      expect(offline.code).toBe(1);
      expect(offline.envelope.kind).toBe("no_server");
    });
  });

  it("lumin-check runs one step and reports it", () => {
    const { code, envelope } = runSkill("lumin-check", ["--only", "icons:check"]);
    expect(code).toBe(0);
    expect(JSON.stringify(envelope.data)).toContain('"step":"icons:check"');
  });
});
