// lumin study and lumin adopt: learning from vendored open-source work, and porting a piece of it into the
// library with its credit. Study reads; adopt plans the port, and (without --dry-run) opens a gitignored
// workspace holding the upstream files, their license and the plan, for the porting work itself.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import type { Registry } from "@hedronite/lts-core";
import { firstUrl, parseCredit, parseFrontMatter, type Credit } from "tool-vendor/parse";
import { fail, ok, type Envelope } from "./envelope.js";
import { readSources, studyFiles, studyRoot, type StudiedModule, type Technique } from "./study.js";

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The kinds a port can become, the package that holds each and where in it a port goes. */
const adoptTargets = {
  shader: { package: "@hedronite/lts-shaders", files: ["packages/shaders/src/effects.ts"] },
  effect: { package: "@hedronite/lts-postfx", files: ["packages/postfx/src/effects.ts", "packages/postfx/src/nodes.ts", "packages/postfx/src/three.ts"] },
  material: { package: "@hedronite/lts-materials", files: ["packages/materials/src/presets.ts"] },
  primitive: { package: "@hedronite/lts-primitives", files: ["packages/primitives/src/catalog.ts"] },
  object: { package: "@hedronite/lts-objects", files: ["assets/src/objects/objects.json"] },
} as const;
export type AdoptKind = keyof typeof adoptTargets;
const isAdoptKind = (value: string): value is AdoptKind => Object.hasOwn(adoptTargets, value);

interface Vendored {
  readonly vendor: string;
  /** The path inside the vendored folder ("" for the folder itself). */
  readonly path: string;
  readonly folder: string;
  readonly credit: Credit;
}

/** Splits `vendor/path` and checks the folder is a vendored one with its CREDIT.md, and the path exists. */
function locate(command: string, target: string, vendorDir: string): Vendored | Envelope {
  const [vendor = "", ...rest] = target.split("/").filter((part) => part !== "");
  const path = rest.join("/");
  if (!slug.test(vendor) || rest.includes("..")) return fail(command, "usage", `"${target}" is not a vendored path: give FOLDER or FOLDER/PATH under assets/vendor`);
  const folder = join(vendorDir, vendor);
  const creditFile = join(folder, "CREDIT.md");
  if (!existsSync(creditFile)) {
    const known = existsSync(vendorDir) ? readdirSync(vendorDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];
    return fail(command, "unknown_vendor", `no vendored folder "${vendor}" (with a CREDIT.md) under assets/vendor`, { matches: known.filter((name) => name.includes(vendor.slice(0, 4))).slice(0, 5) });
  }
  if (path !== "" && !existsSync(join(folder, path))) return fail(command, "not_found", `assets/vendor/${vendor} has no ${path}`);
  return { vendor, path, folder, credit: parseCredit(readFileSync(creditFile, "utf8"), `assets/vendor/${vendor}/CREDIT.md`) };
}

const isEnvelope = (value: Vendored | Envelope): value is Envelope => "ok" in value;

/** The license file that governs `path`: the nearest LICENSE* from it up to the vendored folder. */
export function licenseFor(folder: string, path: string): string | undefined {
  const full = join(folder, path);
  let at = path === "" || !existsSync(full) ? "" : statSync(full).isDirectory() ? path : posix.dirname(path);
  if (at === ".") at = "";
  for (;;) {
    const license = readdirSync(join(folder, at)).find((name) => /^(LICEN[CS]E|COPYING)(\.(md|txt))?$/i.test(name));
    if (license !== undefined) return at === "" ? license : `${at}/${license}`;
    if (at === "") return undefined;
    const up = posix.dirname(at);
    at = up === "." ? "" : up;
  }
}

/** The work's name, without the description after its colon. */
const shortWhat = (credit: Credit): string => credit.what.split(":")[0]?.trim() ?? credit.what;

/** The license the code is under: the credit's first clause, without the file it names. */
const codeLicense = (credit: Credit): string => (credit.license.split(";")[0] ?? credit.license).replace(/\s*\(`[^`]+`\)/g, "").trim();

const brief = (module: StudiedModule) => ({
  path: module.path,
  role: module.role,
  lines: module.lines,
  techniques: module.techniques,
  exports: module.exports.slice(0, 12),
  packages: module.packages,
  closure: module.closure.length,
  selfContained: module.selfContained,
});

export interface StudyOptions {
  readonly limit?: number;
}

/** What a vendored folder (or one module in it) holds, and what in it could be ported. */
export function study(target: string, options: StudyOptions, paths: { readonly vendorDir: string }): Envelope {
  const found = locate("study", target, paths.vendorDir);
  if (isEnvelope(found)) return found;
  const where = studyRoot(found.folder, found.path);
  if (where === undefined) return fail("study", "not_found", `assets/vendor/${target} does not exist`);
  const files = readSources(where.dir);
  if (files.length === 0) return fail("study", "empty", `no TypeScript or JavaScript sources under assets/vendor/${target}`);
  const result = studyFiles(files);
  const limit = options.limit ?? 25;
  const prefix = posix.join(found.path === "" ? "" : where.file === undefined ? found.path : posix.dirname(found.path)).replace(/^\.$/, "");
  const full = (path: string) => (prefix === "" ? path : `${prefix}/${path}`);
  const focus = where.file === undefined ? undefined : result.modules.find((module) => module.path === where.file);
  const modules = focus === undefined ? result.modules : result.modules.filter((module) => focus.closure.includes(module.path));
  return ok("study", {
    vendor: found.vendor,
    path: found.path,
    credit: { what: found.credit.what, by: found.credit.credit, license: found.credit.license, source: firstUrl(found.credit.source) ?? found.credit.source },
    files: files.length,
    packages: result.packages.slice(0, limit),
    techniques: result.techniques,
    candidates: (focus === undefined ? result.candidates : result.candidates.filter((c) => c.path === focus.path)).slice(0, limit).map((c) => ({ ...c, path: full(c.path) })),
    modules: modules.slice(0, focus === undefined ? limit : modules.length).map((module) => ({ ...brief(module), path: full(module.path) })),
    more: Math.max(0, modules.length - limit),
    next: "lumin adopt VENDOR/PATH --as KIND --id ID --name NAME --dry-run",
  });
}

/** The porting steps a module's techniques call for, on top of the ones every port takes. */
export function portingSteps(kind: AdoptKind, found: readonly Technique[]): readonly string[] {
  const has = (t: Technique) => found.includes(t);
  return [
    "Write it in TSL (three/tsl) for three's WebGPURenderer: LuminosiTS draws materials, surface shaders and screen effects on that one renderer.",
    ...(has("glsl")
      ? ["GLSL to TSL: gl_FragCoord.xy / resolution becomes screenUV (its origin is the top left, so flip y where the source assumed the bottom left); texture2D becomes TextureNode.sample(uv); uniforms become uniform(); assign and toVar only inside Fn."]
      : []),
    ...(has("raw-webgl") ? ["Leave the context, program, buffer and resize code behind: the renderer and RenderPipeline own them."] : []),
    ...(kind === "effect" ? ["As a screen effect: a node over the previous pass's texture in nodes.ts, a schema and info in effects.ts, and a case in three.ts. Output premultiplied alpha."] : []),
    ...(kind === "shader" ? ["As a surface shader: a schema and info in effects.ts and a create function returning a NodeMaterial, added to createEffectMaterial."] : []),
    ...(has("canvas-2d") ? ["Canvas-drawn textures are built in the package (as postfx's glyph atlas is), with a blank fallback when there is no document."] : []),
    ...(has("r3f") || has("react") ? ["The library packages are pure TypeScript: React and R3F stay in @hedronite/lts-adapters."] : []),
    ...(has("animation") ? ["Time comes from TSL's time node or the effect's own clock; mark the asset animated."] : []),
    ...(has("noise") ? ["Use mx_noise_float or the package's own hash instead of copying a noise library."] : []),
    ...(has("dom-ui") ? ["Leave the UI behind: the catalog builds its controls from the schema."] : []),
    "Parameters are a zod schema with defaults and ranges. Colors default to the look's palette (ScenePalette), not the source's hex values.",
    "No brand names, logos, product or film text or other third-party marks from the source: take the technique, not the dressing.",
    "Put the header above the port, and the origin on the asset's info so its manifest carries it.",
    "Test it (the material or node graph builds, the parameters parse), then run lumin-check.",
  ];
}

export interface AdoptOptions {
  readonly as?: string;
  readonly id?: string;
  readonly name?: string;
  readonly dryRun: boolean;
}

/** Plans porting a vendored module into the library and, unless dry-run, opens its workspace in .adopt/ID. */
export function adopt(target: string, options: AdoptOptions, context: { readonly root: string; readonly vendorDir: string; readonly registry: Registry }): Envelope {
  const kind = options.as ?? "";
  if (!isAdoptKind(kind)) return fail("adopt", "usage", `--as must be one of ${Object.keys(adoptTargets).join(", ")}`);
  const id = options.id ?? "";
  if (!slug.test(id)) return fail("adopt", "usage", "--id must be a lowercase slug, such as crt-screen");
  if (context.registry.get(id) !== undefined) return fail("adopt", "exists", `the id "${id}" is taken`);
  const found = locate("adopt", target, context.vendorDir);
  if (isEnvelope(found)) return found;
  if (found.path === "") return fail("adopt", "usage", "adopt needs a path inside the folder: the module (or folder) the port starts from");
  const where = studyRoot(found.folder, found.path);
  if (where === undefined) return fail("adopt", "not_found", `assets/vendor/${target} does not exist`);
  const files = readSources(where.dir);
  const result = studyFiles(files);
  const base = where.file === undefined ? found.path : posix.dirname(found.path) === "." ? "" : posix.dirname(found.path);
  const start = where.file === undefined ? undefined : result.modules.find((module) => module.path === where.file);
  const modules = start === undefined ? result.modules : result.modules.filter((module) => start.closure.includes(module.path));
  const upstream = modules.map((module) => (base === "" ? module.path : `${base}/${module.path}`));
  const used = [...new Set(modules.flatMap((module) => module.techniques))];
  const license = licenseFor(found.folder, found.path);
  if (license === undefined) return fail("adopt", "no_license", `no LICENSE file governs assets/vendor/${target}; porting needs one`);
  const source = firstUrl(found.credit.source) ?? found.credit.source;
  const name = options.name ?? id;
  const origin = { vendor: found.vendor, path: found.path, note: "What was taken and what changed, in a sentence." };
  const header = [
    `// ${name}: adopted from ${shortWhat(found.credit)} by ${found.credit.credit} (${source}),`,
    `// ${found.path}, under ${codeLicense(found.credit)}. The upstream notice: assets/vendor/${found.vendor}/${license}.`,
  ];
  const workspace = `.adopt/${id}`;
  const plan = {
    id,
    name,
    kind,
    package: adoptTargets[kind].package,
    files: adoptTargets[kind].files,
    origin,
    header,
    license: `assets/vendor/${found.vendor}/${license}`,
    upstream,
    techniques: used,
    steps: portingSteps(kind, used),
    workspace,
  };
  if (options.dryRun) return ok("adopt", { dryRun: true, ...plan, next: `run again without --dry-run to copy the upstream files into ${workspace}` });
  const dir = join(context.root, workspace);
  if (existsSync(dir)) return fail("adopt", "exists", `${workspace} already exists; finish or remove it first`);
  for (const path of upstream) {
    const to = join(dir, "upstream", path);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(found.folder, path), to);
  }
  mkdirSync(join(dir, "upstream"), { recursive: true });
  copyFileSync(join(found.folder, license), join(dir, "upstream", posix.basename(license)));
  copyFileSync(join(found.folder, "CREDIT.md"), join(dir, "upstream", "CREDIT.md"));
  writeFileSync(join(dir, "PLAN.json"), `${JSON.stringify(plan, null, 2)}\n`);
  return ok("adopt", { dryRun: false, ...plan, next: `port it into ${plan.files.join(", ")} following steps; ${workspace} is gitignored scratch` });
}

/** Every file under `dir`, relative to it. */
function filesUnder(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path).map((file) => `${entry.name}/${file}`) : entry.isFile() ? [entry.name] : [];
  });
}

/** The CREDIT.md an adopted skill carries beside its upstream files. */
function skillCredit(vendor: string, path: string, credit: Credit, license: string): string {
  return [
    "# Credit",
    "",
    `- **Adopted from:** assets/vendor/${vendor}/${path}`,
    `- **What:** ${credit.what}`,
    `- **Source:** ${credit.source}`,
    `- **License:** ${codeLicense(credit)} (\`${posix.basename(license)}\`, beside this file)`,
    `- **Credit:** ${credit.credit}`,
    "",
    "Adopted into LuminosiTS's agent skills as published, by `lumin adopt-skill`. The license above applies to this skill, not LuminosiTS's own. To update it, update the vendored folder and adopt it again.",
    "",
  ].join("\n");
}

/** The upstream files of a skill adopted from assets/vendor: everything but its CREDIT.md and license. */
export const upstreamSkillFiles = (dir: string): readonly string[] => filesUnder(dir).filter((file) => file !== "CREDIT.md" && !/^(LICEN[CS]E|COPYING)(\.(md|txt))?$/i.test(file)).sort();

/**
 * Adopts a vendored agent skill into .agents/skills, as published, with its license and a CREDIT.md, so
 * agents working on LuminosiTS can use it. Run `bun run skills:sync` after, to copy it to each harness.
 */
export function adoptSkill(target: string, options: { readonly dryRun: boolean; readonly force?: boolean }, context: { readonly root: string; readonly vendorDir: string }): Envelope {
  const found = locate("adopt-skill", target, context.vendorDir);
  if (isEnvelope(found)) return found;
  const dir = join(found.folder, found.path);
  const skillFile = join(dir, "SKILL.md");
  if (found.path === "" || !existsSync(skillFile)) return fail("adopt-skill", "not_a_skill", `assets/vendor/${target} has no SKILL.md`);
  const name = parseFrontMatter(readFileSync(skillFile, "utf8")).fields.get("name") ?? "";
  if (!slug.test(name)) return fail("adopt-skill", "invalid", `the skill's front matter needs a slug name, got "${name}"`);
  const license = licenseFor(found.folder, found.path);
  if (license === undefined) return fail("adopt-skill", "no_license", `no LICENSE file governs assets/vendor/${target}`);
  const dest = join(context.root, ".agents/skills", name);
  const files = upstreamSkillFiles(dir);
  const plan = { name, from: `assets/vendor/${found.vendor}/${found.path}`, to: relative(context.root, dest), files, license: `assets/vendor/${found.vendor}/${license}`, next: "bun run skills:sync, to copy it into .claude, .cursor and .grok" };
  if (existsSync(dest)) {
    const credit = join(dest, "CREDIT.md");
    const ours = !existsSync(credit) || !readFileSync(credit, "utf8").includes(`- **Adopted from:** ${plan.from}`);
    if (ours) return fail("adopt-skill", "exists", `.agents/skills/${name} exists and was not adopted from ${plan.from}`);
    if (options.force !== true) return fail("adopt-skill", "exists", `.agents/skills/${name} is already adopted; pass --force to replace it with the vendored copy`);
  }
  if (options.dryRun) return ok("adopt-skill", { dryRun: true, ...plan });
  for (const file of files) {
    mkdirSync(dirname(join(dest, file)), { recursive: true });
    copyFileSync(join(dir, file), join(dest, file));
  }
  copyFileSync(join(found.folder, license), join(dest, posix.basename(license)));
  writeFileSync(join(dest, "CREDIT.md"), skillCredit(found.vendor, found.path, found.credit, license));
  return ok("adopt-skill", { dryRun: false, ...plan });
}
