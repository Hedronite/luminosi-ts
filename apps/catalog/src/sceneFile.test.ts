import type { DescriptorRegistry } from "@hedronite/lts-core";
import { decodeScene, encodeScene, type Resolve, type Scene, type SceneNode } from "@hedronite/lts-scene";
import { toCanonicalJson } from "@hedronite/lts-scene/emit";
import { describe, expect, it } from "vitest";
import { accept, describeIssue, fileNameFor, linkFor, MAX_FILE_BYTES, openText, refuseFile, resolveFrom, sceneParam, stemOf, type Opened } from "./sceneFile";

const node = (id: string, primitive = "platonic-cube"): SceneNode => ({ id, parent: null, position: [0, 0, 0], rotation: [0.3, 0.5, 0], scale: [0.5, 0.5, 0.5], asset: { kind: "primitive", id: primitive }, surface: { material: "satin" } });

const scene = (count: number): Scene => ({
  format: "lts-scene",
  version: 1,
  look: "neutral",
  seed: 0,
  nodes: Array.from({ length: count }, (_, index) => node(`node-${String(index + 1)}`)),
  lights: { rig: "studio", intensity: 1 },
  environment: { kind: "studio" },
  camera: { position: [0, 2.2, 5.5], target: [0, 0, 0], fov: 40 },
  effects: [],
  ink: "look",
});

/** What an opened document is, said so a test can compare it: its canonical JSON when it opened, or the title and the issues when it did not. */
const outcome = (opened: Opened | undefined): { readonly json?: string; readonly title?: string; readonly codes?: readonly string[]; readonly issues?: readonly string[] } =>
  opened === undefined ? {} : opened.ok ? { json: toCanonicalJson(opened.scene) } : { title: opened.title, codes: opened.issues.map((issue) => issue.code), issues: opened.issues.map(describeIssue) };

/** A library that knows every id, and one that does not know a primitive called "ghost". */
const knowsAll: Resolve = () => ({});
const noGhost: Resolve = (kind, id) => (kind === "primitive" && id === "ghost" ? undefined : {});

describe("openText", () => {
  it("opens what the playground saved, equal to it", () => {
    const saved = toCanonicalJson(scene(3));
    expect(outcome(openText(saved, knowsAll, 8))).toEqual({ json: saved });
  });

  it("takes a scene up to the cap and refuses one over it, by name, without cutting it down", () => {
    expect(outcome(openText(toCanonicalJson(scene(8)), knowsAll, 8))).toEqual({ json: toCanonicalJson(scene(8)) });
    const refused = openText(toCanonicalJson(scene(9)), knowsAll, 8);
    expect(outcome(refused)).toEqual({ title: "This scene is too big for the playground", codes: ["too-many-nodes"], issues: ["nodes: the playground holds at most 8 things, and this scene has 9"] });
    expect("scene" in refused).toBe(false);
  });

  it("lists what is wrong with a file that is not a document, and with one that names what the library lacks, each with its path", () => {
    expect(outcome(openText("{ this is not json", knowsAll, 8)).title).toBe("This is not a scene document");
    const ghost: Scene = { ...scene(2), nodes: [node("node-1"), node("node-2", "ghost")] };
    expect(outcome(openText(toCanonicalJson(ghost), noGhost, 8))).toEqual({ title: "This scene does not match the library", codes: ["unknown-primitive"], issues: ['nodes.1.asset.id: no primitive named "ghost"'] });
  });

  it("opens a version 0 document as one of the current version", () => {
    const old = JSON.stringify({ lightIntensity: 1.2, placements: [{ kind: "primitive", primitive: "platonic-cube", material: "satin" }] });
    const parsed: unknown = JSON.parse(outcome(openText(old, knowsAll, 8)).json ?? "null");
    expect(parsed).toMatchObject({ version: 1, nodes: [expect.anything()], lights: { intensity: 1.2 } });
  });
});

describe("accept", () => {
  it("takes a document a link was read as, by the same rules as a file", async () => {
    const link = await decodeScene(await encodeScene(scene(3)));
    expect(outcome(accept(link, knowsAll, 8))).toEqual({ json: toCanonicalJson(scene(3)) });
    expect(outcome(accept(await decodeScene("s1.@@@"), knowsAll, 8)).codes).toEqual(["bad-encoding"]);
    expect(outcome(accept(await decodeScene(await encodeScene(scene(9))), knowsAll, 8)).codes).toEqual(["too-many-nodes"]);
  });
});

describe("refuseFile", () => {
  it("reads a file up to the size a link's document may be, and refuses a larger one by size, unread", () => {
    expect(refuseFile(MAX_FILE_BYTES)).toBeUndefined();
    expect(outcome(refuseFile(MAX_FILE_BYTES + 1)).codes).toEqual(["file-too-large"]);
  });
});

describe("names and addresses", () => {
  it("names a saved file from the file that was opened, with the suffix of a scene file", () => {
    expect(stemOf("kitchen.lts-scene.json")).toBe("kitchen");
    expect(stemOf("kitchen.json")).toBe("kitchen");
    expect(stemOf("Kitchen.LTS-SCENE.JSON")).toBe("Kitchen");
    expect(stemOf(".json")).toBe("scene");
    expect(fileNameFor("kitchen")).toBe("kitchen.lts-scene.json");
  });

  it("makes the link's address and reads it back", () => {
    const address = linkFor({ origin: "https://example.test", pathname: "/catalog/" }, "s1.abc_-");
    expect(address).toBe("https://example.test/catalog/?view=playground&scene=s1.abc_-");
    expect(sceneParam(new URL(address).search)).toBe("s1.abc_-");
    expect(sceneParam("?view=playground")).toBeUndefined();
  });
});

describe("resolveFrom", () => {
  const descriptor = (kind: string): unknown => ({ meta: { kind }, parameters: undefined });
  const registry: unknown = { get: (id: string) => (id === "platonic-cube" ? descriptor("primitive") : id === "satin" ? descriptor("material") : undefined) };
  const isRegistry = (value: unknown): value is DescriptorRegistry => typeof value === "object" && value !== null && "get" in value;

  it("knows an id as the kind its descriptor has, and a look by its id", () => {
    if (!isRegistry(registry)) throw new Error("no registry");
    const resolve = resolveFrom(registry, ["neutral", "hedronite"]);
    expect(resolve("primitive", "platonic-cube")).toBeDefined();
    expect(resolve("material", "platonic-cube")).toBeUndefined();
    expect(resolve("material", "satin")).toBeDefined();
    expect(resolve("primitive", "ghost")).toBeUndefined();
    expect(resolve("look", "hedronite")).toBeDefined();
    expect(resolve("look", "nowhere")).toBeUndefined();
  });
});
