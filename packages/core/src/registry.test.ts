import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createRegistry, DuplicateAssetError } from "./registry.js";

const cube = { id: "cube", kind: "primitive", name: "Cube", version: "0.1.0", tags: ["platonic"] };
const glass = { id: "glass", kind: "material", name: "Glass", version: "0.1.0", tags: ["pbr"] };
const arrow = { id: "arrow-right", kind: "icon", name: "Arrow right", version: "0.1.0", tags: ["ui"] };

describe("createRegistry", () => {
  it("returns the parsed metadata and finds it by id", () => {
    const registry = createRegistry();
    const meta = registry.register(cube);
    expect(meta).toEqual(cube);
    expect(registry.get("cube")).toEqual(cube);
  });

  it("defaults tags to an empty list", () => {
    const registry = createRegistry();
    const { tags: _tags, ...untagged } = cube;
    expect(registry.register(untagged).tags).toEqual([]);
  });

  it("rejects an id that is not a lowercase slug", () => {
    const registry = createRegistry();
    expect(() => registry.register({ ...cube, id: "Cube 1" })).toThrow(z.ZodError);
  });

  it("rejects an unknown kind", () => {
    const registry = createRegistry();
    expect(() => registry.register({ ...cube, kind: "sound" })).toThrow(z.ZodError);
  });

  it("rejects a version that is not major.minor.patch", () => {
    const registry = createRegistry();
    expect(() => registry.register({ ...cube, version: "1.0" })).toThrow(z.ZodError);
  });

  it("rejects a second asset with the same id", () => {
    const registry = createRegistry();
    registry.register(cube);
    expect(() => registry.register({ ...cube, name: "Other cube" })).toThrow(DuplicateAssetError);
    expect(registry.get("cube")?.name).toBe("Cube");
  });

  it("returns undefined for an unknown id", () => {
    expect(createRegistry().get("missing")).toBeUndefined();
  });

  it("lists every asset sorted by id", () => {
    const registry = createRegistry();
    for (const asset of [glass, cube, arrow]) registry.register(asset);
    expect(registry.list().map((a) => a.id)).toEqual(["arrow-right", "cube", "glass"]);
  });

  it("filters by kind and by tag", () => {
    const registry = createRegistry();
    for (const asset of [glass, cube, arrow]) registry.register(asset);
    expect(registry.list({ kind: "material" }).map((a) => a.id)).toEqual(["glass"]);
    expect(registry.list({ tag: "ui" }).map((a) => a.id)).toEqual(["arrow-right"]);
    expect(registry.list({ kind: "icon", tag: "pbr" })).toEqual([]);
  });

  it("returns metadata that cannot be changed after registration", () => {
    const meta = createRegistry().register(cube);
    expect(Object.isFrozen(meta)).toBe(true);
    expect(Object.isFrozen(meta.tags)).toBe(true);
  });
});
