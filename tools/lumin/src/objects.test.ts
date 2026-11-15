import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseObjectSpec } from "@hedronite/lts-objects";
import { afterEach, describe, expect, it } from "vitest";
import { root } from "./commands.js";
import { newObject, reviewObjectCommand } from "./objects.js";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "lumin-object-"));
  temps.push(dir);
  return dir;
};

const tool = join(root, "tools/img-to-object");
const lamp = join(tool, "fixtures/your-desk-lamp.sculpt.json");

/** A fake repository root holding just the objects index, so a real run writes nowhere that matters. */
const fakeRoot = (): string => {
  const dir = temp();
  mkdirSync(join(dir, "assets/src/objects"), { recursive: true });
  writeFileSync(join(dir, "assets/src/objects/objects.json"), "{}\n");
  // The tool is read from the real tree.
  cpSync(tool, join(dir, "tools/img-to-object"), { recursive: true, filter: (src) => !src.includes("node_modules") && !src.includes("__pycache__") });
  return dir;
};

/** A forge workspace holding the lamp's sculpt spec, marked action-ready the way the forge's own tests do. */
const readyWorkspace = (ready = true): string => {
  const workspace = temp();
  cpSync(lamp, join(workspace, "object-sculpt-spec.json"));
  if (ready) {
    const script = [
      "import sys",
      `sys.path.insert(0, ${JSON.stringify(join(tool, "upstream/forge/_shared"))})`,
      "from workflow_state import new_state, save_state",
      "from pathlib import Path",
      `ws = Path(${JSON.stringify(workspace)})`,
      "s = new_state('reference.png', spec=str(ws / 'object-sculpt-spec.json'))",
      "for e in s['checklist']:",
      "    e['status'] = 'done'; e['evidence'] = ['fixture']",
      "s['currentPass'] = s['status'] = s['currentStep'] = 'complete'",
      "save_state(ws / '.img2threejs' / 'state.json', s)",
    ].join("\n");
    const result = spawnSync("python3", ["-I", "-c", script], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
  }
  return workspace;
};

describe("new-object", () => {
  it("refuses bad ids, both or neither source, and ids already taken", async () => {
    expect(await newObject("Your Lamp", { fromImage: "x.png" }, { root })).toMatchObject({ ok: false, kind: "usage" });
    expect(await newObject("your-lamp", {}, { root })).toMatchObject({ ok: false, kind: "usage" });
    expect(await newObject("your-lamp", { fromImage: "a.png", fromWorkspace: "b" }, { root })).toMatchObject({ ok: false, kind: "usage" });
    expect(await newObject("dress-watch", { fromImage: "a.png" }, { root })).toMatchObject({ ok: false, kind: "exists" });
    expect(await newObject("your-desk-lamp", { fromImage: "a.png" }, { root })).toMatchObject({ ok: false, kind: "exists" });
  });

  it("only takes PNG or JPEG references that exist", async () => {
    expect(await newObject("your-lamp", { fromImage: "lamp.gif" }, { root })).toMatchObject({ ok: false, kind: "invalid" });
    expect(await newObject("your-lamp", { fromImage: join(temp(), "missing.png") }, { root })).toMatchObject({ ok: false, kind: "invalid" });
  });

  it("plans a forge workspace on a dry run, and writes nothing", async () => {
    const workspaces = temp();
    const image = join(temp(), "lamp.png");
    writeFileSync(image, "not really a png");
    const result = await newObject("your-lamp", { fromImage: image, dryRun: true }, { root, workspaces });
    expect(result).toMatchObject({ ok: true, data: { workspace: join(workspaces, "your-lamp"), reference: join(workspaces, "your-lamp", "reference.png"), dryRun: true } });
    expect(existsSync(join(workspaces, "your-lamp"))).toBe(false);
  });

  it("starts a forge workspace: the photo, the forge's state and its next step", async () => {
    const workspaces = temp();
    const image = join(temp(), "lamp.png");
    writeFileSync(image, "not really a png");
    const result = await newObject("your-lamp", { fromImage: image }, { root, workspaces });
    expect(result.ok).toBe(true);
    const state: unknown = JSON.parse(readFileSync(join(workspaces, "your-lamp/.img2threejs/state.json"), "utf8"));
    expect(JSON.stringify(state)).toContain("action-ready");
    expect(readFileSync(join(workspaces, "your-lamp/reference.png"), "utf8")).toBe("not really a png");
    expect(JSON.stringify(result)).toContain('"next":"');
    expect(await newObject("your-lamp", { fromImage: image }, { root, workspaces })).toMatchObject({ ok: false, kind: "exists" });
  });

  it("refuses a workspace the forge hasn't finished", async () => {
    const result = await newObject("your-lamp", { fromWorkspace: readyWorkspace(false) }, { root });
    expect(result).toMatchObject({ ok: false, kind: "not_ready" });
  });

  it("emits through the forge's socket and plans the asset on a dry run, without writing it", async () => {
    const dir = fakeRoot();
    const workspace = readyWorkspace();
    const result = await newObject("your-test-lamp", { fromWorkspace: workspace, name: "Your test lamp", dryRun: true, today: "2026-11-15" }, { root: dir });
    expect(result).toMatchObject({
      ok: true,
      data: { specPath: "assets/src/objects/your-test-lamp.json", entry: { name: "Your test lamp", tags: ["object-spec", "image-reconstruction"], added: "2026-11-15" }, dryRun: true },
    });
    expect(JSON.stringify(result)).toContain("no reference");
    expect(existsSync(join(dir, "assets/src/objects/your-test-lamp.json"))).toBe(false);
    expect(existsSync(join(workspace, ".img2/artifacts/lts-object-spec/object-spec.json"))).toBe(true);
  });

  it("writes the spec under the library's id and name, and its index entry", async () => {
    const dir = fakeRoot();
    const result = await newObject("your-test-lamp", { fromWorkspace: readyWorkspace(), name: "Your test lamp", tags: ["object-spec", "lamp"], today: "2026-11-15" }, { root: dir });
    expect(result.ok).toBe(true);
    const spec = parseObjectSpec(JSON.parse(readFileSync(join(dir, "assets/src/objects/your-test-lamp.json"), "utf8")));
    expect([spec.id, spec.name]).toEqual(["your-test-lamp", "Your test lamp"]);
    expect(spec.parts.length).toBeGreaterThan(5);
    const meta: unknown = JSON.parse(readFileSync(join(dir, "assets/src/objects/objects.json"), "utf8"));
    expect(meta).toMatchObject({ "your-test-lamp": { name: "Your test lamp", tags: ["object-spec", "lamp"], added: "2026-11-15" } });
  });
});

describe("review-object", () => {
  it("refuses missing files before doing any work", async () => {
    expect(await reviewObjectCommand({ spec: join(temp(), "none.json"), reference: "x.png" }, { root })).toMatchObject({ ok: false, kind: "invalid" });
    const spec = join(temp(), "spec.json");
    writeFileSync(spec, "{}");
    expect(await reviewObjectCommand({ spec, reference: join(temp(), "none.png") }, { root })).toMatchObject({ ok: false, kind: "invalid" });
  });
});
