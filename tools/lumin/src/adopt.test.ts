import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadRegistry } from "@hedronite/lts-registry";
import { digestOf } from "tool-vendor/pin";
import { resolveVendor } from "tool-vendor/resolve";
import { afterAll, describe, expect, it } from "vitest";
import { adopt, adoptSkill, licenseFor, portingSteps, study, upstreamSkillFiles } from "./adopt.js";
import { root } from "./commands.js";

const vendorDir = join(root, "assets/vendor");
const registry = loadRegistry();
const paths = { vendorDir, env: process.env };

/** A vendored folder's raw files, through the resolver as every tool finds them: with no copy fetched and none in the repository this fails, naming the fetch. */
const rawFolder = (vendor: string): string => {
  const found = resolveVendor(vendor, paths);
  if (!found.ok) throw new Error(found.error);
  return found.dir;
};

describe("adopted assets", () => {
  const adopted = registry.list().filter((asset) => asset.origin !== undefined);

  it("include the first ports", () => {
    expect(adopted.map((asset) => asset.id).sort()).toEqual(expect.arrayContaining(["crt", "soap-film"]));
  });

  it.each(adopted.map((asset) => [asset.id, asset.origin] as const))("%s names a vendored file that exists, with its credit and a license", (_, origin) => {
    if (origin === undefined) throw new Error("no origin");
    const folder = rawFolder(origin.vendor);
    expect(existsSync(join(vendorDir, origin.vendor, "CREDIT.md"))).toBe(true);
    expect(existsSync(join(folder, origin.path))).toBe(true);
    expect(licenseFor(folder, origin.path)).toBeDefined();
  });
});

describe("lumin study", () => {
  it("finds the CRT shader as a screen effect to port", () => {
    const result = study("threeui/src/shaders/crt", {}, paths);
    if (!result.ok) throw new Error(result.error);
    expect(result.data).toMatchObject({ vendor: "threeui", candidates: [{ path: "src/shaders/crt/crtShaders.ts", role: "screen-shader", kind: "effect" }] });
  });

  it("refuses folders that are not vendored", () => {
    expect(study("not-a-folder", {}, paths)).toMatchObject({ ok: false, kind: "unknown_vendor" });
    expect(study("../etc", {}, paths)).toMatchObject({ ok: false, kind: "usage" });
  });
});

describe("lumin adopt", () => {
  const context = { root, vendorDir, env: process.env, registry };

  it("plans a port with its origin, header, license and upstream closure, writing nothing on a dry run", () => {
    const result = adopt("codevember-2026/07/src/env.ts", { as: "shader", id: "studio-test", name: "Studio test", dryRun: true }, context);
    if (!result.ok) throw new Error(result.error);
    expect(result.data).toMatchObject({
      dryRun: true,
      package: "@hedronite/lts-shaders",
      origin: { vendor: "codevember-2026", path: "07/src/env.ts" },
      license: "assets/vendor/codevember-2026/LICENSE",
      upstream: ["07/src/env.ts"],
    });
    expect(existsSync(join(root, ".adopt/studio-test"))).toBe(false);
  });

  it("refuses a taken id, an unknown kind and a missing path", () => {
    expect(adopt("threeui/src/shaders/crt", { as: "effect", id: "crt", dryRun: true }, context)).toMatchObject({ ok: false, kind: "exists" });
    expect(adopt("threeui/src/shaders/crt", { as: "scene", id: "crt-two", dryRun: true }, context)).toMatchObject({ ok: false, kind: "usage" });
    expect(adopt("threeui/src/nope.ts", { as: "effect", id: "crt-two", dryRun: true }, context)).toMatchObject({ ok: false, kind: "not_found" });
  });

  it("asks GLSL ports to flip y for screenUV and to leave raw WebGL behind", () => {
    const steps = portingSteps("effect", ["glsl", "raw-webgl", "fullscreen"]).join("\n");
    expect(steps).toMatch(/screenUV/);
    expect(steps).toMatch(/RenderPipeline/);
    expect(steps).toMatch(/third-party marks/);
  });
});

describe("lumin adopt-skill", () => {
  // A scratch repository root, so adopting writes nowhere real; the vendored folders are the repo's own.
  const scratch = () => mkdtempSync(join(tmpdir(), "lumin-adopt-"));
  const target = "jakubkrehel-skills/skills/better-ui";
  const upstream = join(rawFolder("jakubkrehel-skills"), "skills/better-ui");

  it("plans on a dry run and writes nothing", () => {
    const at = scratch();
    expect(adoptSkill(target, { dryRun: true }, { root: at, vendorDir, env: process.env })).toMatchObject({ ok: true, data: { dryRun: true, name: "better-ui", to: ".agents/skills/better-ui" } });
    expect(existsSync(join(at, ".agents/skills/better-ui"))).toBe(false);
  });

  it("copies the skill as published, with its license and a credit naming its source", () => {
    const at = scratch();
    expect(adoptSkill(target, { dryRun: false }, { root: at, vendorDir, env: process.env })).toMatchObject({ ok: true });
    const dest = join(at, ".agents/skills/better-ui");
    const files = upstreamSkillFiles(upstream);
    expect(upstreamSkillFiles(dest)).toEqual(files);
    for (const file of files) expect(readFileSync(join(dest, file), "utf8")).toBe(readFileSync(join(upstream, file), "utf8"));
    expect(existsSync(join(dest, "LICENSE"))).toBe(true);
    expect(readFileSync(join(dest, "CREDIT.md"), "utf8")).toContain(`- **Adopted from:** assets/vendor/${target}`);
  });

  it("replaces an adopted skill only when forced, and never a skill it did not adopt", () => {
    const at = scratch();
    adoptSkill(target, { dryRun: false }, { root: at, vendorDir, env: process.env });
    expect(adoptSkill(target, { dryRun: false }, { root: at, vendorDir, env: process.env })).toMatchObject({ ok: false, kind: "exists" });
    expect(adoptSkill(target, { dryRun: false, force: true }, { root: at, vendorDir, env: process.env })).toMatchObject({ ok: true });
    const other = scratch();
    mkdirSync(join(other, ".agents/skills/better-ui"), { recursive: true });
    writeFileSync(join(other, ".agents/skills/better-ui/SKILL.md"), "---\nname: better-ui\n---\nOur own.\n");
    expect(adoptSkill(target, { dryRun: false, force: true }, { root: other, vendorDir, env: process.env })).toMatchObject({ ok: false, kind: "exists" });
  });

  it("refuses a folder with no SKILL.md", () => {
    expect(adoptSkill("jakubkrehel-skills/skills", { dryRun: true }, { root: scratch(), vendorDir, env: process.env })).toMatchObject({ ok: false, kind: "not_a_skill" });
  });
});

describe("skills in the repository", () => {
  it("that were adopted still match their vendored copies byte for byte", () => {
    const skills = join(root, ".agents/skills");
    for (const name of readdirSync(skills)) {
      const credit = join(skills, name, "CREDIT.md");
      const from = existsSync(credit) ? /^- \*\*Adopted from:\*\* (.+)$/m.exec(readFileSync(credit, "utf8"))?.[1] : undefined;
      if (from === undefined) continue;
      const files = upstreamSkillFiles(join(rawFolder(from.split("/")[2] ?? ""), from.split("/").slice(3).join("/")));
      expect(upstreamSkillFiles(join(skills, name))).toEqual(files);
      for (const file of files) expect(readFileSync(join(skills, name, file), "utf8")).toBe(readFileSync(join(rawFolder(from.split("/")[2] ?? ""), from.split("/").slice(3).join("/"), file), "utf8"));
    }
  });
});

// ---- the resolver, through study and adopt, on a folder of its own ---------------------------------------------------

const scratchRoots: string[] = [];
afterAll(() => {
  for (const dir of scratchRoots) rmSync(dir, { recursive: true, force: true });
});

const put = (dir: string, files: Readonly<Record<string, string>>): void => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
};

const SHADER = 'import * as THREE from "three";\nexport const crt = (uv: number) => uv * 2;\n';
const SKILL = "---\nname: fixture-skill\ndescription: A skill.\n---\nDo the thing.\n";

/** A repository with one fetchable folder `demo` (CREDIT.md, a license, a pin) and, per the options, raw files in it, a cache, or neither. */
function repository(options: { readonly raw?: boolean; readonly cached?: boolean; readonly kept?: boolean }) {
  const base = mkdtempSync(join(tmpdir(), "lumin-resolver-"));
  scratchRoots.push(base);
  const vendor = join(base, "assets/vendor");
  const home = join(vendor, "demo");
  const cache = join(base, "cache");
  const files = { "src/crt.ts": SHADER, "skills/fixture/SKILL.md": SKILL };
  put(home, { "CREDIT.md": "# Credit\n\n- **What:** Demo: a fixture\n- **Source:** https://github.com/someone/demo (`0123456789abcdef0123456789abcdef01234567`)\n- **License:** MIT (`LICENSE`)\n- **Credit:** Someone\n- **Pulled:** 2026-11\n", LICENSE: "MIT license text\n" });
  const content = mkdtempSync(join(tmpdir(), "lumin-resolver-content-"));
  scratchRoots.push(content);
  put(content, files);
  const contentHash = options.kept === true ? "" : digestOf(content, false).hash;
  if (options.raw === true) put(home, files);
  const pin =
    options.kept === true
      ? { schema: 1, kept: true, keptReason: "there is no repository to fetch from", source: "https://example.com/", contentHash: digestOf(home, true).hash }
      : { schema: 1, kept: false, sources: [{ source: "https://github.com/someone/demo", commit: "0123456789abcdef0123456789abcdef01234567" }], contentHash };
  put(home, { "vendor.json": `${JSON.stringify(pin)}\n` });
  if (options.cached === true) {
    put(join(cache, "demo"), { ...files, LICENSE: "MIT license text\n" });
    put(cache, { "demo.fetched.json": JSON.stringify({ schema: 1, folder: "demo", commits: ["0123456789abcdef0123456789abcdef01234567"], contentHash }) });
  }
  return { base, vendor, cache, home, env: { LTS_VENDOR_CACHE: cache } };
}

describe("study, adopt and adopt-skill read raw files through the resolver", () => {
  it("study reads the cache, and the same output comes from the repository's raw files", () => {
    const cached = repository({ cached: true });
    const raw = repository({ raw: true });
    const fromCache = study("demo/src", {}, { vendorDir: cached.vendor, env: cached.env });
    const fromRepo = study("demo/src", {}, { vendorDir: raw.vendor, env: raw.env });
    expect(fromCache).toMatchObject({ ok: true, data: { vendor: "demo", files: 1 } });
    expect(fromCache).toEqual(fromRepo);
  });

  it("says `not_fetched`, naming the command, when there is no cache and no raw file", () => {
    const none = repository({});
    for (const result of [study("demo/src", {}, { vendorDir: none.vendor, env: none.env }), adopt("demo/src/crt.ts", { as: "effect", id: "fixture-crt", dryRun: true }, { root: none.base, vendorDir: none.vendor, env: none.env, registry }), adoptSkill("demo/skills/fixture", { dryRun: true }, { root: none.base, vendorDir: none.vendor, env: none.env })]) {
      const naming: unknown = expect.stringContaining("bun run vendor:fetch demo");
      expect(result).toMatchObject({ ok: false, kind: "not_fetched", exit: 1, error: naming });
    }
  });

  it("prefers the cache to the repository's files, and a cache for another pin is not read", () => {
    const both = repository({ raw: true, cached: true });
    put(both.home, { "src/crt.ts": `${SHADER}export const extra = 1;\n` });
    expect(study("demo/src", {}, { vendorDir: both.vendor, env: both.env })).toMatchObject({ ok: true, data: { modules: [{ lines: 3 }] } });
    put(both.cache, { "demo.fetched.json": JSON.stringify({ schema: 1, folder: "demo", commits: ["f".repeat(40)], contentHash: "0".repeat(64) }) });
    expect(study("demo/src", {}, { vendorDir: both.vendor, env: both.env })).toMatchObject({ ok: true, data: { modules: [{ lines: 4 }] } });
  });

  it("plans an adopt from the cache with the license named in the repository, and copies the files from the cache and the credit from the repository", () => {
    const world = repository({ cached: true });
    const context = { root: world.base, vendorDir: world.vendor, env: world.env, registry };
    expect(adopt("demo/src/crt.ts", { as: "effect", id: "fixture-crt", dryRun: true }, context)).toMatchObject({ ok: true, data: { license: "assets/vendor/demo/LICENSE", upstream: ["src/crt.ts"] } });
    expect(adopt("demo/src/crt.ts", { as: "effect", id: "fixture-crt", dryRun: false }, context)).toMatchObject({ ok: true });
    expect(readFileSync(join(world.base, ".adopt/fixture-crt/upstream/src/crt.ts"), "utf8")).toBe(SHADER);
    expect(readFileSync(join(world.base, ".adopt/fixture-crt/upstream/LICENSE"), "utf8")).toBe("MIT license text\n");
    expect(readFileSync(join(world.base, ".adopt/fixture-crt/upstream/CREDIT.md"), "utf8")).toContain("Demo: a fixture");
  });

  it("adopts a skill from the cache", () => {
    const world = repository({ cached: true });
    expect(adoptSkill("demo/skills/fixture", { dryRun: false }, { root: world.base, vendorDir: world.vendor, env: world.env })).toMatchObject({ ok: true, data: { name: "fixture-skill" } });
    expect(readFileSync(join(world.base, ".agents/skills/fixture-skill/SKILL.md"), "utf8")).toBe(SKILL);
    expect(readFileSync(join(world.base, ".agents/skills/fixture-skill/CREDIT.md"), "utf8")).toContain("- **Adopted from:** assets/vendor/demo/skills/fixture");
  });

  it("reads a kept folder where it is in the repository", () => {
    const world = repository({ kept: true, raw: true });
    expect(study("demo/src", {}, { vendorDir: world.vendor, env: world.env })).toMatchObject({ ok: true, data: { vendor: "demo", files: 1 } });
  });
});
