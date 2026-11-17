import { existsSync, readdirSync, readFileSync } from "node:fs";
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

describe("adopted skills", () => {
  const skills = join(root, ".agents/skills");
  const adopted = readdirSync(skills).flatMap((name) => {
    const credit = join(skills, name, "CREDIT.md");
    const from = existsSync(credit) ? /^- \*\*Adopted from:\*\* (.+)$/m.exec(readFileSync(credit, "utf8"))?.[1] : undefined;
    return from === undefined ? [] : [[name, from] as const];
  });

  it("include the interface review skills", () => {
    expect(adopted.map(([name]) => name)).toEqual(expect.arrayContaining(["interface-review", "better-ui", "better-accessibility"]));
  });

  it.each(adopted)("%s matches its vendored copy byte for byte, with its license", (name, from) => {
    const upstream = join(root, from);
    const files = upstreamSkillFiles(upstream);
    expect(upstreamSkillFiles(join(skills, name))).toEqual(files);
    for (const file of files) expect(readFileSync(join(skills, name, file), "utf8")).toBe(readFileSync(join(upstream, file), "utf8"));
    expect(readdirSync(join(skills, name)).some((file) => /^LICEN[CS]E/i.test(file))).toBe(true);
  });

  it("replaces an adopted skill only when forced", () => {
    expect(adoptSkill("jakubkrehel-skills/skills/better-ui", { dryRun: true }, { root, vendorDir })).toMatchObject({ ok: false, kind: "exists" });
  });
});
