import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adopt, adoptSkill, licenseFor, portingSteps, study, upstreamSkillFiles } from "./adopt.js";
import { root } from "./commands.js";
import { loadRegistry } from "./registry.js";

const vendorDir = join(root, "assets/vendor");
const registry = loadRegistry();

describe("adopted assets", () => {
  const adopted = registry.list().filter((asset) => asset.origin !== undefined);

  it("include the first ports", () => {
    expect(adopted.map((asset) => asset.id).sort()).toEqual(expect.arrayContaining(["crt", "soap-film"]));
  });

  it.each(adopted.map((asset) => [asset.id, asset.origin] as const))("%s names a vendored file that exists, with its credit and a license", (_, origin) => {
    if (origin === undefined) throw new Error("no origin");
    const folder = join(vendorDir, origin.vendor);
    expect(existsSync(join(folder, "CREDIT.md"))).toBe(true);
    expect(existsSync(join(folder, origin.path))).toBe(true);
    expect(licenseFor(folder, origin.path)).toBeDefined();
  });
});

describe("lumin study", () => {
  it("finds the CRT shader as a screen effect to port", () => {
    const result = study("threeui/src/shaders/crt", {}, { vendorDir });
    if (!result.ok) throw new Error(result.error);
    expect(result.data).toMatchObject({ vendor: "threeui", candidates: [{ path: "src/shaders/crt/crtShaders.ts", role: "screen-shader", kind: "effect" }] });
  });

  it("refuses folders that are not vendored", () => {
    expect(study("not-a-folder", {}, { vendorDir })).toMatchObject({ ok: false, kind: "unknown_vendor" });
    expect(study("../etc", {}, { vendorDir })).toMatchObject({ ok: false, kind: "usage" });
  });
});

describe("lumin adopt", () => {
  const context = { root, vendorDir, registry };

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
  const upstream = join(vendorDir, target);

  it("plans on a dry run and writes nothing", () => {
    const at = scratch();
    expect(adoptSkill(target, { dryRun: true }, { root: at, vendorDir })).toMatchObject({ ok: true, data: { dryRun: true, name: "better-ui", to: ".agents/skills/better-ui" } });
    expect(existsSync(join(at, ".agents/skills/better-ui"))).toBe(false);
  });

  it("copies the skill as published, with its license and a credit naming its source", () => {
    const at = scratch();
    expect(adoptSkill(target, { dryRun: false }, { root: at, vendorDir })).toMatchObject({ ok: true });
    const dest = join(at, ".agents/skills/better-ui");
    const files = upstreamSkillFiles(upstream);
    expect(upstreamSkillFiles(dest)).toEqual(files);
    for (const file of files) expect(readFileSync(join(dest, file), "utf8")).toBe(readFileSync(join(upstream, file), "utf8"));
    expect(existsSync(join(dest, "LICENSE"))).toBe(true);
    expect(readFileSync(join(dest, "CREDIT.md"), "utf8")).toContain(`- **Adopted from:** assets/vendor/${target}`);
  });

  it("replaces an adopted skill only when forced, and never a skill it did not adopt", () => {
    const at = scratch();
    adoptSkill(target, { dryRun: false }, { root: at, vendorDir });
    expect(adoptSkill(target, { dryRun: false }, { root: at, vendorDir })).toMatchObject({ ok: false, kind: "exists" });
    expect(adoptSkill(target, { dryRun: false, force: true }, { root: at, vendorDir })).toMatchObject({ ok: true });
    const other = scratch();
    mkdirSync(join(other, ".agents/skills/better-ui"), { recursive: true });
    writeFileSync(join(other, ".agents/skills/better-ui/SKILL.md"), "---\nname: better-ui\n---\nOur own.\n");
    expect(adoptSkill(target, { dryRun: false, force: true }, { root: other, vendorDir })).toMatchObject({ ok: false, kind: "exists" });
  });

  it("refuses a folder with no SKILL.md", () => {
    expect(adoptSkill("jakubkrehel-skills/skills", { dryRun: true }, { root: scratch(), vendorDir })).toMatchObject({ ok: false, kind: "not_a_skill" });
  });
});

describe("skills in the repository", () => {
  it("that were adopted still match their vendored copies byte for byte", () => {
    const skills = join(root, ".agents/skills");
    for (const name of readdirSync(skills)) {
      const credit = join(skills, name, "CREDIT.md");
      const from = existsSync(credit) ? /^- \*\*Adopted from:\*\* (.+)$/m.exec(readFileSync(credit, "utf8"))?.[1] : undefined;
      if (from === undefined) continue;
      const files = upstreamSkillFiles(join(root, from));
      expect(upstreamSkillFiles(join(skills, name))).toEqual(files);
      for (const file of files) expect(readFileSync(join(skills, name, file), "utf8")).toBe(readFileSync(join(root, from, file), "utf8"));
    }
  });
});
