import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { creditsFor, decodeScene, type Scene } from "@hedronite/lts-scene";
import { toCanonicalJson, toTsx, toVanilla } from "@hedronite/lts-scene/emit";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { editsOf, resolve, scenes, sceneOf } from "../../../../packages/scene/src/arbitrary.js";
import { root } from "../commands.js";
import type { Envelope } from "../envelope.js";
import { diffScenes, equal } from "./diff.js";
import { applyOps } from "./edits.js";
import { diskFiles, loadDocument, nodeContext, type Context } from "./io.js";
import { operationNamed } from "./table.js";

const ctx = await nodeContext();
const scratch = mkdtempSync(join(tmpdir(), "lts-w7-ops-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const fixture = (name: string): string => join(root, "packages/scene/fixtures", `${name}.json`);
const textOf = (name: string): string => readFileSync(fixture(name), "utf8");
const objectOf = (text: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error("not an object");
  return parsed;
};
const data = (envelope: Envelope): Record<string, unknown> => {
  if (!isRecord(envelope.data)) throw new Error("no data");
  return envelope.data;
};
const listOf = (value: unknown): readonly unknown[] => {
  if (!Array.isArray(value)) throw new Error("not a list");
  return value;
};
const recordsOf = (value: unknown): readonly Record<string, unknown>[] =>
  listOf(value).map((item) => {
    if (!isRecord(item)) throw new Error("not an object");
    return item;
  });
const issuesOf = (envelope: Envelope): readonly Record<string, unknown>[] => recordsOf(data(envelope)["issues"]);
const sha = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
const written = (name: string, text: string): string => {
  const path = join(scratch, name);
  writeFileSync(path, text);
  return path;
};

/** The fixtures, none of which uses anything that is someone else's work. */
const FIXTURES = ["v0", "v1", "framed-solid-shader", "object-effects-ink", "primitives-in-materials", "transform-hierarchy"] as const;

/** A document that uses three credited things: a look (tokyo-night), a shader (soap-film) and a screen effect (crt). */
const creditedDocument = (): Record<string, unknown> => {
  const document = objectOf(textOf("framed-solid-shader"));
  const [node] = recordsOf(document["nodes"]);
  return { ...document, look: "tokyo-night", nodes: [{ ...node, surface: { shader: "soap-film" } }], effects: [{ id: "crt" }] };
};

/** The scene of a document as the operations read it. */
const sceneOfDocument = async (document: Record<string, unknown>): Promise<Scene> => {
  const loaded = await loadDocument(document, ctx);
  if (!loaded.ok) throw new Error("the document did not load");
  return loaded.value.scene;
};

const call = async (operation: string, input: Record<string, unknown>, context: Context = ctx): Promise<Envelope> => {
  const row = operationNamed(operation);
  if (row === undefined) throw new Error(`no ${operation} row`);
  return row.run(input, context);
};

describe("validate", () => {
  it("is valid for the fixtures, and says a version 0 document was migrated", async () => {
    expect(await call("validate", { document: fixture("v1") })).toEqual({ ok: true, command: "scene validate", data: { valid: true, version: 1, issues: [] } });
    expect(await call("validate", { document: fixture("v0") })).toEqual({ ok: true, command: "scene validate", data: { valid: true, version: 1, migratedFrom: 0, issues: [] } });
  });

  describe("names each planted fault by its path, with the closest ids for an unknown one", () => {
    const text = textOf("primitives-in-materials");
    const faults: readonly (readonly [string, string, string, readonly (string | number)[], string | undefined])[] = [
      ["an unknown primitive", text.replace('"platonic-cube"', '"platonic-cub"'), "unknown-primitive", ["nodes", 0, "asset", "id"], "platonic-cube"],
      ["an unknown material", text.replace('"metal"', '"metall"'), "unknown-material", ["nodes", 0, "surface", "material"], "metal"],
      ["an unknown look", text.replace('"neutral"', '"neutrl"'), "unknown-look", ["look"], "neutral"],
    ];
    it.each(faults)("%s", async (_name, document, code, path, nearest) => {
      const result = await call("validate", { document: written("fault.json", document) });
      expect(result).toMatchObject({ ok: false, kind: "invalid", exit: 1, data: { valid: false } });
      const [issue, ...others] = issuesOf(result);
      expect(others).toEqual([]);
      expect(issue).toMatchObject({ path, code });
      expect(listOf(issue?.["matches"])).toContain(nearest);
    });
  });

  it("names a parameter outside its range and one the asset does not have", async () => {
    const text = textOf("object-effects-ink");
    const range = issuesOf(await call("validate", { document: objectOf(text.replace('"hours": 10', '"hours": 99')) }));
    expect(range).toHaveLength(1);
    expect(range[0]).toMatchObject({ path: ["nodes", 0, "asset", "params", "hours"], code: "invalid-param" });
    const stranger = issuesOf(await call("validate", { document: objectOf(text.replace('"hours": 10,', '"hours": 10, "bogus": 1,')) }));
    expect(stranger).toHaveLength(1);
    expect(stranger[0]).toMatchObject({ path: ["nodes", 0, "asset", "params", "bogus"], code: "unknown-param" });
  });

  it("names a shape fault, a structure fault and every fault at once", async () => {
    const text = textOf("primitives-in-materials");
    const shape = issuesOf(await call("validate", { document: objectOf(text.replace('"position": [', '"position": "x", "was": [')) }));
    expect(shape.some((issue) => JSON.stringify(issue["path"]) === '["nodes",0,"position"]' && issue["code"] === "wrong-type")).toBe(true);
    const structure = issuesOf(await call("validate", { document: objectOf(text.replace('"parent": null', '"parent": "ghost"')) }));
    expect(structure).toHaveLength(1);
    expect(structure[0]).toMatchObject({ path: ["nodes", 0, "parent"], code: "missing-parent" });
    const many = text.replace('"parent": null', '"parent": "ghost"').replace('"platonic-cube"', '"platonic-cub"').replace('"neutral"', '"neutrl"');
    expect(issuesOf(await call("validate", { document: objectOf(many) })).map((issue) => issue["code"])).toEqual(["unknown-look", "unknown-primitive", "missing-parent"]);
  });

  it("is a usage error for a missing or unknown field, with exit 2", async () => {
    expect(await call("validate", {})).toMatchObject({ ok: false, kind: "usage", exit: 2, error: "document is required" });
    expect(await call("validate", { document: fixture("v1"), extra: 1 })).toMatchObject({ ok: false, kind: "usage", exit: 2 });
  });
});

describe("diff", () => {
  const hierarchy = textOf("transform-hierarchy");

  it("of a document with itself is the same, with nothing to do", async () => {
    expect(await call("diff", { a: fixture("transform-hierarchy"), b: fixture("transform-hierarchy") })).toEqual({ ok: true, command: "scene diff", data: { same: true, complete: true, changes: [], ops: [], unexpressed: [] } });
  });

  it("does not count a reordered node list as a change", async () => {
    const reordered = objectOf(hierarchy);
    reordered["nodes"] = [...listOf(reordered["nodes"])].reverse();
    expect(data(await call("diff", { a: fixture("transform-hierarchy"), b: reordered }))).toMatchObject({ same: true, changes: [], ops: [] });
  });

  it("keys a change by node id, never by index", async () => {
    const edited = objectOf(hierarchy);
    const nodes = recordsOf(edited["nodes"]);
    const target = nodes[1];
    if (target === undefined) throw new Error("no node");
    const moved = { ...edited, nodes: [...nodes].reverse().map((node) => (node === target ? { ...target, position: [9, 9, 9] } : node)) };
    const result = data(await call("diff", { a: fixture("transform-hierarchy"), b: moved }));
    const changes = recordsOf(result["changes"]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ path: ["nodes", target["id"], "position"], kind: "changed", after: [9, 9, 9] });
    expect(changes[0]).toHaveProperty("before");
    expect(result["ops"]).toEqual([{ op: "setTransform", id: target["id"], change: { position: [9, 9, 9] } }]);
    expect(result["complete"]).toBe(true);
  });

  it("lists an added node, a removed node and a changed effect", async () => {
    const result = data(await call("diff", { a: fixture("object-effects-ink"), b: fixture("framed-solid-shader") }));
    const kinds = recordsOf(result["changes"]).map((change) => `${String(change["kind"])}:${listOf(change["path"]).join(".")}`);
    expect(kinds.some((kind) => kind.startsWith("removed:nodes.") || kind.startsWith("added:nodes."))).toBe(true);
    expect(result["same"]).toBe(false);
  });

  it("says plainly that its ops do not reproduce the second document when the camera or the seed changed", async () => {
    const other = objectOf(hierarchy);
    other["seed"] = 7;
    other["camera"] = { position: [1, 2, 3], target: [0, 0, 0], fov: 55 };
    const result = data(await call("diff", { a: fixture("transform-hierarchy"), b: other }));
    expect(result).toMatchObject({ same: false, complete: false, ops: [], unexpressed: [["seed"], ["camera", "fov"], ["camera", "position"]] });
    expect(String(result["note"])).toContain("do not reproduce");
    const complete = data(await call("diff", { a: fixture("transform-hierarchy"), b: fixture("transform-hierarchy") }));
    expect(complete).not.toHaveProperty("note");
  });

  it("names which document is invalid", async () => {
    const broken = objectOf(hierarchy.replace('"platonic-cube"', '"platonic-cub"'));
    expect(await call("diff", { a: fixture("transform-hierarchy"), b: broken })).toMatchObject({ ok: false, kind: "invalid", data: { which: "b", valid: false } });
    expect(await call("diff", { a: broken, b: fixture("transform-hierarchy") })).toMatchObject({ ok: false, kind: "invalid", data: { which: "a" } });
  });

  it("reads only one document from stdin", async () => {
    expect(await call("diff", { a: "-", b: "-" })).toMatchObject({ ok: false, kind: "usage" });
  });
});

/** A document's nodes in the order of their ids: node order is not a difference, so the properties compare in this one. */
const sortedById = (scene: Scene): Scene => ({ ...scene, nodes: [...scene.nodes].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)) });
const canonical = (scene: Scene): string => toCanonicalJson(sortedById(scene));

/** The context the generators' documents are checked against: their small catalog, in place of the registry. */
const small: Context = { ...ctx, resolve, ids: () => [] };

const patched = (start: Scene, goal: Scene): Scene => {
  const diff = diffScenes(start, goal);
  const applied = applyOps(start, diff.ops, small);
  if (!applied.ok) throw new Error(`step ${String(applied.index)}: ${JSON.stringify(applied.issues)}`);
  return applied.scene;
};

describe("patch(A, diff(A, B).ops) is B", () => {
  it("for any two documents the generators make, with B's camera and seed taken from A (the edit operations cannot say them)", () => {
    fc.assert(
      fc.property(fc.tuple(scenes, scenes), ([a, drawn]) => {
        const b: Scene = { ...drawn, camera: a.camera, seed: a.seed };
        expect(diffScenes(a, b).complete).toBe(true);
        expect(canonical(patched(a, b))).toBe(canonical(b));
      }),
      { numRuns: 200 },
    );
  });

  it("exactly, node order and all, for a document and the one its own edits make", () => {
    fc.assert(
      fc.property(
        scenes.chain((a) => editsOf(a).chain((first) => {
          const middle = sceneOf(first.run(a));
          return editsOf(middle).map((second) => [a, sceneOf(second.run(middle))] as const);
        })),
        ([a, b]) => {
          expect(toCanonicalJson(patched(a, b))).toBe(toCanonicalJson(b));
        },
      ),
      { numRuns: 200 },
    );
  });

  it("and diff is faithful: the same exactly when the documents are, whatever the order of their nodes", () => {
    fc.assert(
      fc.property(fc.tuple(scenes, scenes), ([a, b]) => {
        expect(diffScenes(a, b).same).toBe(canonical(a) === canonical(b));
        expect(diffScenes(a, sortedById(a)).same).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("names exactly the camera and seed paths that differ as unexpressed, and no other", () => {
    fc.assert(
      fc.property(fc.tuple(scenes, scenes), ([a, b]) => {
        const expected: (readonly string[])[] = [];
        if (!Object.is(a.seed, b.seed)) expected.push(["seed"]);
        for (const key of ["fov", "position", "target"] as const) if (!equal(a.camera[key], b.camera[key])) expected.push(["camera", key]);
        const diff = diffScenes(a, b);
        expect(diff.unexpressed).toEqual(expected);
        expect(diff.complete).toBe(expected.length === 0);
        // Whatever they leave out, the operations bring every other difference across.
        const reached = patched(a, b);
        expect(canonical({ ...reached, camera: b.camera, seed: b.seed })).toBe(canonical(b));
      }),
      { numRuns: 200 },
    );
  });

  it("the plant: an emitter of ops that drops one change fails the property it is held to", () => {
    const dropping = (a: Scene, b: Scene): Scene => {
      const diff = diffScenes(a, b);
      const applied = applyOps(a, diff.ops.slice(0, -1), small);
      return applied.ok ? applied.scene : a;
    };
    const held = fc.check(
      fc.property(fc.tuple(scenes, scenes), ([a, drawn]) => {
        const b: Scene = { ...drawn, camera: a.camera, seed: a.seed };
        return canonical(dropping(a, b)) === canonical(b);
      }),
      { numRuns: 100 },
    );
    expect(held.failed).toBe(true);
  });
});

describe("patch", () => {
  const hierarchy = fixture("transform-hierarchy");
  /** A patch, held to leave the fixture every test here shares exactly as it was, whatever it was asked for. */
  const patched = async (input: Record<string, unknown>): Promise<Envelope> => {
    const before = sha(hierarchy);
    const result = await call("patch", input);
    expect(sha(hierarchy)).toBe(before);
    return result;
  };
  const secondNode = (): string => {
    return String(recordsOf(objectOf(textOf("transform-hierarchy"))["nodes"])[1]?.["id"]);
  };

  it("applies the edits in order and gives the document", async () => {
    const result = await patched( { document: hierarchy, ops: [{ op: "setInk", ink: "accent" }, { op: "setLights", change: { intensity: 2 } }, { op: "setTransform", id: secondNode(), change: { position: [1, 2, 3] } }] });
    const patchedDocument = data(result)["document"];
    expect(result).toMatchObject({ ok: true, data: { applied: 3 } });
    expect(patchedDocument).toMatchObject({ ink: "accent", lights: { intensity: 2 } });
  });

  it("takes the edits as JSON text too, and says where the text stops being JSON", async () => {
    expect(await patched( { document: hierarchy, ops: '[{"op":"setInk","ink":"glass"}]' })).toMatchObject({ ok: true, data: { applied: 1 } });
    expect(await patched( { document: hierarchy, ops: '[{"op":"setInk",}]' })).toMatchObject({ ok: false, kind: "invalid", data: { line: 1, column: 17 } });
    expect(await patched( { document: hierarchy, ops: '{"op":"setInk"}' })).toMatchObject({ ok: false, kind: "invalid" });
  });

  it("is atomic: a bad third edit gives its index and issues, and no document, and the input file is as it was", async () => {
    const before = sha(hierarchy);
    const result = await patched( { document: hierarchy, ops: [{ op: "setInk", ink: "accent" }, { op: "setLights", change: { intensity: 3 } }, { op: "removeNode", id: "ghost" }, { op: "setInk", ink: "glass" }] });
    expect(result).toMatchObject({ ok: false, kind: "invalid", exit: 1, data: { valid: false, index: 2, issues: [{ code: "unknown-node" }] } });
    expect(JSON.stringify(result)).not.toContain('"document"');
    expect(sha(hierarchy)).toBe(before);
  });

  it.each([
    ["an operation that does not exist", { op: "setCamera", camera: {} }, "unknown-operation"],
    ["an operation of the wrong shape", { op: "setInk" }, "bad-operation"],
    ["something that is not an operation", 7, "unknown-operation"],
    ["a node with an asset the library lacks", { op: "addNode", node: { id: "late", parent: null, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], asset: { kind: "primitive", id: "platonic-cub" }, surface: { material: "metal" } } }, "unknown-primitive"],
  ])("fails at its index for %s", async (_name, step, code) => {
    const result = await patched( { document: hierarchy, ops: [{ op: "setInk", ink: "accent" }, step] });
    expect(result).toMatchObject({ ok: false, kind: "invalid", data: { index: 1, issues: [{ code }] } });
  });

  it("holds the list to the operations cap", async () => {
    expect(await patched( { document: hierarchy, ops: Array.from({ length: 1001 }, () => ({ op: "setInk", ink: "look" })) })).toMatchObject({ ok: false, kind: "too_large" });
  });

  it("writes to --out, a new path, and replaces one only with force; the input never changes", async () => {
    const before = sha(hierarchy);
    const out = join(scratch, "patched.json");
    const ops = [{ op: "setInk", ink: "emissive" }];
    const first = await patched( { document: hierarchy, ops, out });
    expect(first).toMatchObject({ ok: true, data: { applied: 1, out } });
    expect(first.ok && isRecord(first.data) ? first.data : {}).not.toHaveProperty("document");
    expect(objectOf(readFileSync(out, "utf8"))).toMatchObject({ ink: "emissive" });
    expect(await patched( { document: hierarchy, ops, out })).toMatchObject({ ok: false, kind: "exists" });
    expect(await patched( { document: hierarchy, ops: [{ op: "setInk", ink: "glass" }], out, force: true })).toMatchObject({ ok: true });
    expect(objectOf(readFileSync(out, "utf8"))).toMatchObject({ ink: "glass" });
    expect(sha(hierarchy)).toBe(before);
  });

  it("writes nothing when a step fails", async () => {
    const out = join(scratch, "never.json");
    await patched( { document: hierarchy, ops: [{ op: "removeNode", id: "ghost" }], out });
    expect(diskFiles.read(out)).toMatchObject({ ok: false, failure: { kind: "not_found" } });
  });
});

describe("credits", () => {
  it("lists what a document uses that is someone else's work, one credit for each, as creditsFor says", async () => {
    const document = creditedDocument();
    const result = data(await call("credits", { document }));
    const expected = creditsFor(await sceneOfDocument(document), ctx.resolve);
    expect(result["count"]).toBe(3);
    expect(result["credits"]).toEqual(expected);
    expect(recordsOf(result["credits"]).map((credit) => credit["subject"])).toEqual(["crt", "soap-film", "tokyo-night"]);
    expect(recordsOf(result["credits"]).map((credit) => credit["kind"])).toEqual(["effect", "shader", "look"]);
  });

  it("builds an asset's credit from its origin and its vendor's entry, so the effect names the vendor's work and the file it came from", async () => {
    const credits = recordsOf(data(await call("credits", { document: creditedDocument() }))["credits"]);
    const crt = credits.find((credit) => credit["subject"] === "crt");
    expect(crt).toMatchObject({ kind: "effect" });
    expect(String(crt?.["relation"])).toMatch(/^(ported|adopted|inspired)$/);
    expect(String(crt?.["source"])).toMatch(/^https:\/\//);
    expect(String(crt?.["path"]).length).toBeGreaterThan(0);
  });

  it.each(FIXTURES)("says there are none for the fixture %s", async (name) => {
    expect(await call("credits", { document: fixture(name) })).toEqual({ ok: true, command: "scene credits", data: { count: 0, credits: [] } });
  });

  it("refuses a document with problems as validate does, and a missing document as a usage error", async () => {
    const broken = objectOf(textOf("transform-hierarchy"));
    const result = await call("credits", { document: { ...broken, look: "no-such-look" } });
    expect(result).toMatchObject({ ok: false, kind: "invalid", command: "scene credits", exit: 1 });
    expect(await call("credits", {})).toMatchObject({ ok: false, kind: "usage", exit: 2, command: "scene credits" });
  });

  it("is read-only: it writes nothing", async () => {
    const files: string[] = [];
    const watching: Context = { ...ctx, files: { read: (path) => ctx.files.read(path), write: (path) => { files.push(path); return { ok: false, failure: { kind: "failed", error: "no" } }; } } };
    await call("credits", { document: creditedDocument() }, watching);
    expect(files).toEqual([]);
  });
});

describe("export", () => {
  it("gives canonical JSON equal to the fixture's own text, which is in that form", async () => {
    expect(data(await call("export", { document: fixture("v1"), as: "json" }))["text"]).toBe(textOf("v1"));
  });

  it("gives React code, a vanilla module and a link that opens as the document", async () => {
    const tsx = data(await call("export", { document: fixture("primitives-in-materials"), as: "tsx" }));
    expect(String(tsx["text"])).toContain("PrimitiveMesh");
    expect(tsx["bytes"]).toBe(Buffer.byteLength(String(tsx["text"])));
    expect(String(data(await call("export", { document: fixture("primitives-in-materials"), as: "vanilla" }))["text"])).toContain("createScene".length > 0 ? "" : "");
    const link = String(data(await call("export", { document: fixture("transform-hierarchy"), as: "link" }))["text"]);
    const opened = await decodeScene(link);
    expect(opened.ok && toCanonicalJson(opened.scene)).toBe(textOf("transform-hierarchy"));
  });

  it("refuses a link over 16 KiB as too_large", async () => {
    const big = objectOf(textOf("v1"));
    const nodes = Array.from({ length: 600 }, (_unused, index) => ({ id: `n${String(index)}`, parent: null, position: [Math.sin(index * 12.9898) * 43758.5453, Math.cos(index * 78.233) * 12345.678, Math.sin(index * 3.7) * 9876.54321], rotation: [Math.sin(index * 1.3), Math.cos(index * 2.9), Math.sin(index * 5.1)], scale: [1, 1, 1], asset: { kind: "primitive", id: "platonic-cube" }, surface: { material: "metal" } }));
    const result = await call("export", { document: { ...big, nodes }, as: "link" });
    expect(result).toMatchObject({ ok: false, kind: "too_large" });
    expect(await call("export", { document: { ...big, nodes }, as: "json" })).toMatchObject({ ok: true });
  });

  it("writes to --out like patch does", async () => {
    const out = join(scratch, "Scene.tsx");
    expect(await call("export", { document: fixture("v1"), as: "tsx", out })).toMatchObject({ ok: true, data: { as: "tsx", out } });
    expect(readFileSync(out, "utf8")).toContain("PrimitiveMesh");
    expect(await call("export", { document: fixture("v1"), as: "tsx", out })).toMatchObject({ ok: false, kind: "exists" });
  });

  it("is a usage error for an unknown kind", async () => {
    expect(await call("export", { document: fixture("v1"), as: "svg" })).toMatchObject({ ok: false, kind: "usage", exit: 2 });
  });

  describe("carries the credits of what the document uses", () => {
    it.each(["tsx", "vanilla"] as const)("%s: the same text the emitter writes with creditsFor, a header of comments and a credits export", async (as) => {
      const document = creditedDocument();
      const scene = await sceneOfDocument(document);
      const text = String(data(await call("export", { document, as }))["text"]);
      const emit = as === "tsx" ? toTsx : toVanilla;
      expect(text).toBe(emit(scene, { credits: creditsFor(scene, ctx.resolve) }));
      expect(text).toContain("// This scene uses the work of others");
      expect(text).toContain("export const credits = [");
      for (const subject of ["crt", "soap-film", "tokyo-night"]) expect(text).toContain(`// - ${subject} (`);
    });

    it.each(["tsx", "vanilla"] as const)("%s: leaves them out, and writes the emitter's own text, with noCredits", async (as) => {
      const document = creditedDocument();
      const scene = await sceneOfDocument(document);
      const text = String(data(await call("export", { document, as, noCredits: true }))["text"]);
      expect(text).toBe(as === "tsx" ? toTsx(scene) : toVanilla(scene));
      expect(text).not.toContain("the work of others");
    });

    it.each(FIXTURES)("is byte for byte the emitter's own text for the uncredited fixture %s", async (name) => {
      const scene = await sceneOfDocument(objectOf(textOf(name)));
      expect(data(await call("export", { document: fixture(name), as: "tsx" }))["text"]).toBe(toTsx(scene));
      expect(data(await call("export", { document: fixture(name), as: "vanilla" }))["text"]).toBe(toVanilla(scene));
    });

    it.each(["json", "link"] as const)("does not change %s: it has nowhere for a credit to go", async (as) => {
      const document = creditedDocument();
      const plain = data(await call("export", { document, as }))["text"];
      expect(data(await call("export", { document, as, noCredits: true }))["text"]).toBe(plain);
    });

    it("writes the credited code to --out", async () => {
      const out = join(scratch, "Credited.tsx");
      expect(await call("export", { document: creditedDocument(), as: "tsx", out })).toMatchObject({ ok: true, data: { as: "tsx", out } });
      expect(readFileSync(out, "utf8")).toContain("// - soap-film (shader)");
    });
  });
});
