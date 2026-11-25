import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
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

interface Eval {
  readonly id: string;
  readonly prompt: string;
  readonly answer: string;
  readonly must: readonly string[];
}

const isEval = (value: unknown): value is Eval =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "string" &&
  "prompt" in value &&
  typeof value.prompt === "string" &&
  "answer" in value &&
  typeof value.answer === "string" &&
  "must" in value &&
  Array.isArray(value.must) &&
  value.must.every((fact: unknown) => typeof fact === "string");

describe("lumin-motion", () => {
  const dir = join(canon, "lumin-motion");
  const read = (name: string): string => readFileSync(join(dir, name), "utf8");
  // What the skill says, without its credit: the answers must stand on the skill's own terms, and the credit is the one place a source may be named.
  const body = files(dir)
    .filter((file) => file.endsWith(".md") && !file.endsWith("CREDIT.md"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n")
    .toLowerCase();
  const parsed: unknown = JSON.parse(read("evals.json"));
  const cases: readonly Eval[] =
    typeof parsed === "object" && parsed !== null && "cases" in parsed && Array.isArray(parsed.cases) ? parsed.cases.filter(isEval) : [];
  // The negative half of the eval set: names that must not appear, kept in the data beside the facts that must.
  const never: readonly string[] =
    typeof parsed === "object" && parsed !== null && "never" in parsed && Array.isArray(parsed.never)
      ? parsed.never.filter((word: unknown): word is string => typeof word === "string")
      : [];

  it("carries ten fixed prompts, each with an answer and the facts it needs", () => {
    expect(cases).toHaveLength(10);
    for (const one of cases) {
      expect(one.prompt.length).toBeGreaterThan(20);
      expect(one.answer.length).toBeGreaterThan(40);
      expect(one.must.length).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(cases.map((one) => [one.id, one] as const))("%s: the skill holds every fact its answer needs", (_id, one) => {
    expect(one.must.filter((fact) => !body.includes(fact.toLowerCase()))).toEqual([]);
  });

  it("names nothing on the eval set's never list in its own text", () => {
    // The document is the source of truth: a skill that sent an agent to a library would contradict it, and a brand would be someone else's.
    expect(never.length).toBeGreaterThanOrEqual(4);
    expect(never.filter((word) => body.includes(word.toLowerCase()))).toEqual([]);
  });

  it("credits the work it is inspired by, with the pin and its license", () => {
    const credit = read("CREDIT.md");
    expect(credit).toContain("inspired by");
    expect(credit).toContain("https://github.com/MengTo/Skills");
    expect(credit).toContain("a7f25b25e9e15e1944f9fe6d69d943f77a155ef7");
    expect(credit).toContain("assets/vendor/mengto-skills");
    expect(credit).toContain("MIT");
  });

  it("is a skill a person can follow before the schema that lands later", () => {
    // The track document is G4: the skill says so and names the step each piece arrives in, so no answer reads as if it shipped already.
    expect(body).toContain("g4");
    expect(body).toContain("g5");
    expect(body).toContain("g6");
    expect(body).toContain("not in the schema yet");
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

  describe("lumin-scene", () => {
    const cli = (args: readonly string[], input?: string) => {
      const argv = [join(root, "tools/lumin/src/cli.ts"), "scene", ...args];
      return spawnSync("bun", argv, { cwd: root, encoding: "utf8", ...(input === undefined ? {} : { input }) });
    };
    const viaSkill = (args: readonly string[], input?: string) => spawnSync("nu", [join(canon, "lumin-scene/lumin-scene.nu"), ...args], { cwd: root, encoding: "utf8", ...(input === undefined ? {} : { input }) });
    const fixture = (name: string): string => join(root, "packages/scene/fixtures", `${name}.json`);
    // Each document a case writes goes in a directory of its own, and they are all removed after.
    const made: string[] = [];
    afterAll(() => {
      for (const dir of made) rmSync(dir, { recursive: true, force: true });
    });
    const planted = (): string => {
      const dir = mkdtempSync(join(tmpdir(), "lumin-scene-"));
      made.push(dir);
      const file = join(dir, "planted.json");
      writeFileSync(file, readFileSync(fixture("primitives-in-materials"), "utf8").replace('"platonic-cube"', '"platonic-cub"'));
      return file;
    };
    // A document that uses three credited things: the tokyo-night look, the soap-film shader and the crt screen effect.
    const credited = (): string => {
      const dir = mkdtempSync(join(tmpdir(), "lumin-scene-"));
      made.push(dir);
      const file = join(dir, "credited.json");
      const text = readFileSync(fixture("framed-solid-shader"), "utf8")
        .replace('"look": "neutral"', '"look": "tokyo-night"')
        .replace('"shader": "toon",', '"shader": "soap-film",')
        .replace(/"params": \{\s*"bands": 4\s*\}/, '"params": {}')
        .replace('"effects": []', '"effects": [{ "id": "crt" }]');
      writeFileSync(file, text);
      return file;
    };
    const stdinText = readFileSync(join(root, "packages/scene/fixtures/v1.json"), "utf8");

    // The skill prints the CLI's own line, the same bytes, and exits with the same code. Each case starts `bun` twice and `nu` once.
    const cases: readonly (readonly [string, () => readonly string[], number, string | undefined])[] = [
      ["validate a document", () => ["validate", fixture("v1")], 0, undefined],
      ["validate a version 0 document, migrated", () => ["validate", fixture("v0")], 0, undefined],
      ["validate a document with an unknown id", () => ["validate", planted()], 1, undefined],
      ["validate from stdin", () => ["validate", "-"], 0, stdinText],
      ["diff two documents", () => ["diff", fixture("v1"), fixture("transform-hierarchy")], 0, undefined],
      ["patch", () => ["patch", fixture("v1"), "--ops", '[{"op":"setInk","ink":"accent"}]'], 0, undefined],
      ["patch with a failing step", () => ["patch", fixture("v1"), "--ops", '[{"op":"setInk","ink":"accent"},{"op":"removeNode","id":"ghost"}]'], 1, undefined],
      ["export as tsx", () => ["export", fixture("v1"), "--as", "tsx"], 0, undefined],
      ["export as a link", () => ["export", fixture("v1"), "--as=link"], 0, undefined],
      ["export with no --as", () => ["export", fixture("v1")], 2, undefined],
      ["diff with one document", () => ["diff", fixture("v1")], 2, undefined],
      ["credits of a document that uses credited work", () => ["credits", credited()], 0, undefined],
      ["credits of a document that uses none", () => ["credits", fixture("v1")], 0, undefined],
      ["credits from stdin", () => ["credits", "-"], 0, stdinText],
      ["credits of a document with an unknown id", () => ["credits", planted()], 1, undefined],
      ["credits with no document", () => ["credits"], 2, undefined],
      ["export as tsx, with the credits", () => ["export", credited(), "--as", "tsx"], 0, undefined],
      ["export as a vanilla module, with the credits", () => ["export", credited(), "--as=vanilla"], 0, undefined],
      // A render that is refused before a browser starts: the same bytes and the same exit through the skill, with no build or browser needed.
      ["render with no --out", () => ["render", fixture("v1")], 2, undefined],
      ["render of a document with an unknown id", () => ["render", planted(), "--out", join(tmpdir(), "lumin-scene-never.png")], 1, undefined],
      ["render with a side over the cap", () => ["render", fixture("v1"), "--out", join(tmpdir(), "lumin-scene-never.png"), "--width", "99999"], 2, undefined],
      ["render with a side that is not a number", () => ["render", fixture("v1"), "--out", join(tmpdir(), "lumin-scene-never.png"), "--height=tall"], 2, undefined],
      ["render to a path that is there", () => ["render", fixture("v1"), "--out", fixture("v1")], 1, undefined],
      ["render with no document", () => ["render", "--out", join(tmpdir(), "lumin-scene-never.png")], 2, undefined],
    ];
    it.each(cases)("%s: the skill prints the CLI's envelope exactly", (_name, args, code, input) => {
      const words = args();
      const direct = cli(words, input);
      const wrapped = viaSkill(words, input);
      expect(direct.status).toBe(code);
      expect(wrapped.status).toBe(code);
      expect(wrapped.stdout).toBe(direct.stdout);
      const envelope: unknown = JSON.parse(direct.stdout);
      expect(isEnvelope(envelope) && envelope.command.startsWith("scene ")).toBe(true);
    }, 30_000);

    it("with no subcommand says which there are, as an envelope with exit 2", () => {
      const result = viaSkill([]);
      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, kind: "usage", exit: 2 });
    }, 20_000);
  });

  describe("lumin-adopt: the vendor commands, offline", () => {
    // A cache of its own and an empty one: nothing is fetched, and the calls below touch no network (a refused ask, and a verify of nothing).
    const empty = mkdtempSync(join(tmpdir(), "lumin-vendor-cache-"));
    afterAll(() => {
      rmSync(empty, { recursive: true, force: true });
    });
    const env = { ...process.env, LTS_VENDOR_CACHE: empty };
    const cli = (args: readonly string[]) => spawnSync("bun", [join(root, "tools/lumin/src/cli.ts"), ...args], { cwd: root, encoding: "utf8", env });
    const viaSkill = (args: readonly string[]) => spawnSync("nu", [join(canon, "lumin-adopt/lumin-adopt.nu"), ...args], { cwd: root, encoding: "utf8", env });

    it.each([
      ["fetch of a folder that is not pinned", ["vendor", "fetch", "no-such-folder"], ["fetch", "no-such-folder"], 1, "unknown_vendor", "no-such-folder"],
      ["verify of a folder that is not fetched", ["vendor", "verify", "lucide"], ["verify", "lucide"], 1, "not_fetched", "bun run vendor:fetch lucide"],
    ] as const)("%s: the same bytes and the same exit through the skill and the command line", (_name, cliArgs, skillArgs, code, kind, hint) => {
      const direct = cli(cliArgs);
      expect(direct.status).toBe(code);
      expect(JSON.parse(direct.stdout)).toMatchObject({ ok: false, kind, exit: code });
      expect(direct.stdout).toContain(hint);
      const wrapped = viaSkill(skillArgs);
      expect(wrapped.status).toBe(code);
      expect(wrapped.stdout).toBe(direct.stdout);
    }, 30_000);

    it.each([
      ["an unknown vendor action", ["vendor", "sync"]],
      ["no vendor action", ["vendor"]],
    ] as const)("%s is a usage error with exit 2", (_name, cliArgs) => {
      const direct = cli(cliArgs);
      expect(direct.status).toBe(2);
      expect(JSON.parse(direct.stdout)).toMatchObject({ ok: false, kind: "usage", exit: 2 });
    }, 30_000);

    it("the skill with no subcommand says there are fetch and verify among them", () => {
      const result = viaSkill([]);
      expect(result.status).toBe(2);
      expect(result.stdout).toContain("fetch | verify");
    }, 30_000);
  });

  it("lumin-check runs one step and reports it", () => {
    const { code, envelope } = runSkill("lumin-check", ["--only", "icons:check"]);
    expect(code).toBe(0);
    expect(JSON.stringify(envelope.data)).toContain('"step":"icons:check"');
  });
});

describe("the lumin-scene skill", () => {
  const skillText = readFileSync(join(canon, "lumin-scene/SKILL.md"), "utf8");

  it("is thin: a short SKILL.md beside lumin-scene.nu, named for its folder", () => {
    expect(skillText.split("\n").length).toBeLessThanOrEqual(60);
    expect(skillText).toMatch(/^name: lumin-scene$/m);
    expect(readdirSync(join(canon, "lumin-scene")).sort()).toEqual(["SKILL.md", "lumin-scene.nu"]);
  });

  it.each(["README.md", "STACK.md"])("is the primary path in %s: the skill is named before the command line", (file) => {
    const text = readFileSync(join(root, file), "utf8");
    expect(text.indexOf("lumin-scene.nu")).toBeGreaterThan(-1);
    expect(text.indexOf("lumin-scene.nu")).toBeLessThan(text.indexOf("bun run lumin scene"));
  });

  it("is listed in AGENTS.md", () => {
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("- `lumin-scene`:");
  });
});
