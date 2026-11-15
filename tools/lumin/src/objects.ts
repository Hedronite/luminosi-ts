// lumin new-object and review-object: image to library object, through the forge.
//
//   new-object ID --from-image IMG       start a forge workspace for a reference photo
//   new-object ID --from-workspace DIR   once the forge says action-ready: emit the ObjectSpec,
//                                        review it against the photo, add it to assets/src/objects
//   review-object --spec FILE --reference IMG [--out DIR --look --yaw --pitch]
//
// Writes only when not --dry-run. A dry run of --from-workspace still emits and reviews inside the
// workspace (scratch, gitignored); it never touches the repository's assets.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { parseObjectSpec } from "@hedronite/lts-objects";
import { reviewObject } from "img-to-object/review";
import { fail, ok, type Envelope } from "./envelope.js";
import { loadRegistry } from "./registry.js";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE = new Set([".png", ".jpg", ".jpeg"]);

export interface ObjectPaths {
  /** The repository root: assets and the default workspace root live under it. */
  readonly root: string;
  /** Where forge workspaces go. Default <root>/.img-to-object. */
  readonly workspaces?: string;
}

export interface NewObjectOptions {
  readonly fromImage?: string;
  readonly fromWorkspace?: string;
  readonly name?: string;
  readonly tags?: readonly string[];
  readonly dryRun?: boolean;
  readonly today?: string;
}

const registry = loadRegistry();

function run(command: string, args: readonly string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(command, [...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error !== undefined) return { code: 127, stdout: "", stderr: result.error.message };
  return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

/** A short summary of the Divine Eye's verdict, for the envelope. The full report is in the workspace. */
function verdict(scores: unknown): Record<string, unknown> {
  if (typeof scores !== "object" || scores === null) return {};
  const pick = (key: string): unknown => Object.entries(scores).find(([k]) => k === key)?.[1];
  const signals = pick("signals");
  const iou: unknown = typeof signals === "object" && signals !== null ? Object.entries(signals).find(([k]) => k === "silhouetteIoU")?.[1] : undefined;
  return { verdict: pick("verdict"), fidelity: pick("fidelity"), fidelityTarget: pick("fidelityTarget"), silhouetteIoU: iou, hardGateFailures: pick("hardGateFailures") };
}

const referenceIn = (workspace: string): string | undefined => {
  const file = readdirSync(workspace).find((name) => name.startsWith("reference.") && IMAGE.has(extname(name).toLowerCase()));
  return file === undefined ? undefined : join(workspace, file);
};

/** Starts a forge workspace for a reference photo, or brings a finished one into the library. */
export async function newObject(id: string, options: NewObjectOptions, paths: ObjectPaths): Promise<Envelope> {
  const command = "new-object";
  if (!SLUG.test(id)) return fail(command, "usage", `id "${id}" must be a lowercase slug like "your-desk-lamp"`);
  if ((options.fromImage === undefined) === (options.fromWorkspace === undefined)) return fail(command, "usage", "pass exactly one of --from-image IMG or --from-workspace DIR");
  const specPath = join("assets/src/objects", `${id}.json`);
  if (registry.get(id) !== undefined || existsSync(join(paths.root, specPath))) return fail(command, "exists", `an asset or object source "${id}" already exists`);
  const tool = join(paths.root, "tools/img-to-object");
  const workspaces = paths.workspaces ?? join(paths.root, ".img-to-object");

  if (options.fromImage !== undefined) {
    const image = resolve(options.fromImage);
    const ext = extname(image).toLowerCase();
    if (!IMAGE.has(ext)) return fail(command, "invalid", "the reference must be a .png, .jpg or .jpeg file");
    if (!existsSync(image)) return fail(command, "invalid", `no image at ${image}`);
    const workspace = join(workspaces, id);
    if (existsSync(workspace)) return fail(command, "exists", `a workspace for "${id}" already exists at ${workspace}; continue it, then run --from-workspace`);
    const reference = join(workspace, `reference${ext}`);
    const state = join(workspace, ".img2threejs", "state.json");
    const sculptSpec = join(workspace, "object-sculpt-spec.json");
    const plan = {
      workspace,
      reference,
      state,
      sculptSpec,
      skill: relative(paths.root, join(tool, "upstream/SKILL.md")),
      then: `lumin new-object ${id} --from-workspace ${workspace}`,
    };
    if (options.dryRun === true) return ok(command, { ...plan, next: "python3 forge/next.py (after the workspace exists)", dryRun: true });
    mkdirSync(workspace, { recursive: true });
    copyFileSync(image, reference);
    const init = run("python3", ["-I", join(tool, "upstream/forge/state.py"), "init", "--state", state, "--reference", reference, "--spec", sculptSpec]);
    if (init.code !== 0) return fail(command, "failed", `forge state init failed: ${init.stderr.trim() || init.stdout.trim()}`, { data: plan });
    const next = run("python3", ["-I", join(tool, "upstream/forge/next.py"), "--state", state]);
    return ok(command, { ...plan, next: (next.stdout.trim() || next.stderr.trim()).slice(0, 2000), dryRun: false });
  }

  const workspace = resolve(options.fromWorkspace ?? "");
  const sculptSpec = join(workspace, "object-sculpt-spec.json");
  if (!existsSync(sculptSpec)) return fail(command, "invalid", `no object-sculpt-spec.json in ${workspace}`);
  const tags = options.tags ?? ["object-spec", "image-reconstruction"];
  if (tags.length === 0 || !tags.every((t) => SLUG.test(t))) return fail(command, "usage", "--tags needs one or more slugs, comma-separated");

  // Emit through the forge's own socket, with the plugin installed in a workspace-local home.
  const home = join(workspace, ".img2-home");
  const install = run("python3", ["-I", join(tool, "plugin/install.py"), "--home", home]);
  if (install.code !== 0) return fail(command, "failed", `could not install the lts-object-spec target: ${install.stderr.trim()}`);
  const emit = run("python3", ["-I", join(tool, "upstream/forge/stage3_build/emit_target.py"), "--spec", sculptSpec, "--target", "lts-object-spec", "--workspace", workspace], {
    cwd: workspace,
    env: { ...process.env, IMG2_HOME: home },
  });
  if (emit.code !== 0) {
    const message = emit.stderr.trim() || emit.stdout.trim();
    return fail(command, message.includes("action-ready") ? "not_ready" : "failed", message.slice(0, 2000));
  }
  const artifact = join(workspace, ".img2/artifacts/lts-object-spec/object-spec.json");
  const emitted: unknown = JSON.parse(readFileSync(artifact, "utf8"));
  const base = parseObjectSpec(emitted);
  const name = (options.name ?? base.name).trim();
  if (name === "" || name.length > 80) return fail(command, "usage", "--name must be 1 to 80 characters");
  // Keep the emitted JSON as written (no parse defaults), with the library's id and name.
  const source = typeof emitted === "object" && emitted !== null ? Object.fromEntries(Object.entries(emitted)) : {};
  const spec = { ...source, id, name };
  const parts = parseObjectSpec(spec).parts.length;

  let review: Record<string, unknown> = { skipped: "no reference.png or reference.jpg in the workspace" };
  const reference = referenceIn(workspace);
  if (reference !== undefined) {
    const reviewDir = join(workspace, "review");
    mkdirSync(reviewDir, { recursive: true });
    const reviewSpec = join(reviewDir, "spec.json");
    writeFileSync(reviewSpec, `${JSON.stringify(spec, null, 2)}\n`);
    try {
      const result = await reviewObject({ spec: reviewSpec, reference, out: reviewDir });
      review = { ...verdict(result.scores), sheet: result.files.sheet, render: result.files.render, threeQuarter: result.files.threeQuarter };
    } catch (error: unknown) {
      review = { skipped: error instanceof Error ? error.message : String(error) };
    }
  }

  const added = options.today ?? new Date().toISOString().slice(0, 10);
  const metaPath = "assets/src/objects/objects.json";
  const entry = { name, tags, added, source: `Forge workspace for ${id}, emitted by the lts-object-spec target` };
  const plan = { specPath, metaPath, entry, parts, workspace, review, next: "bun run objects" };
  if (options.dryRun === true) return ok(command, { ...plan, dryRun: true });

  const metaFile = join(paths.root, metaPath);
  const meta: unknown = JSON.parse(readFileSync(metaFile, "utf8"));
  const entries: [string, unknown][] = typeof meta === "object" && meta !== null ? Object.entries(meta) : [];
  entries.push([id, entry]);
  const next = Object.fromEntries(entries.sort((a, b) => a[0].localeCompare(b[0])));
  writeFileSync(join(paths.root, specPath), `${JSON.stringify(spec, null, 2)}\n`);
  writeFileSync(metaFile, `${JSON.stringify(next, null, 2)}\n`);
  return ok(command, { ...plan, dryRun: false });
}

export interface ReviewObjectOptions {
  readonly spec: string;
  readonly reference: string;
  readonly out?: string;
  readonly look?: string;
  readonly yaw?: number;
  readonly pitch?: number;
}

/** Renders a spec framed like a reference photo and scores it with the forge's review tools. */
export async function reviewObjectCommand(options: ReviewObjectOptions, paths: ObjectPaths): Promise<Envelope> {
  const command = "review-object";
  if (!existsSync(options.spec)) return fail(command, "invalid", `no spec at ${options.spec}`);
  if (!existsSync(options.reference)) return fail(command, "invalid", `no reference image at ${options.reference}`);
  if (!existsSync(join(paths.root, "apps/catalog/dist/embed.html"))) return fail(command, "not_built", "the catalog is not built (it holds the embed page): run bun run build");
  try {
    const result = await reviewObject({
      spec: options.spec,
      reference: options.reference,
      out: options.out ?? join(paths.workspaces ?? join(paths.root, ".img-to-object"), "reviews", new Date().toISOString().replace(/[:.]/g, "-")),
      ...(options.look === undefined ? {} : { look: options.look }),
      ...(options.yaw === undefined ? {} : { yaw: options.yaw }),
      ...(options.pitch === undefined ? {} : { pitch: options.pitch }),
    });
    return ok(command, { spec: result.spec, look: result.look, view: result.view, files: result.files, ...verdict(result.scores) });
  } catch (error: unknown) {
    return fail(command, "failed", error instanceof Error ? error.message : String(error));
  }
}
