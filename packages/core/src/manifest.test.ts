import { describe, expect, it } from "vitest";
import { z } from "zod";
import { registerManifest } from "./manifest.js";
import { createRegistry, DuplicateAssetError } from "./registry.js";

const manifest = {
  package: "@hedronite/lts-icons",
  assets: [
    { id: "arrow-right", kind: "icon", name: "Arrow right", version: "0.1.0", tags: ["navigation"], added: "2026-11-15" },
    { id: "check", kind: "icon", name: "Check", version: "0.1.0" },
  ],
};

describe("registerManifest", () => {
  it("registers every asset under the manifest's package", () => {
    const registry = createRegistry();
    const registered = registerManifest(registry, manifest);
    expect(registered.map((a) => a.id)).toEqual(["arrow-right", "check"]);
    expect(registry.get("check")?.package).toBe("@hedronite/lts-icons");
    expect(registry.get("arrow-right")?.added).toBe("2026-11-15");
  });

  it("rejects a package name that is not scoped", () => {
    expect(() => registerManifest(createRegistry(), { ...manifest, package: "icons" })).toThrow(z.ZodError);
  });

  it("ignores a package set on an asset and uses the manifest's", () => {
    const sneaky = { ...manifest, assets: [{ ...manifest.assets[1], package: "@other/pkg" }] };
    const registered = registerManifest(createRegistry(), sneaky);
    expect(registered[0]?.package).toBe("@hedronite/lts-icons");
  });

  it("rejects an added date that is not YYYY-MM-DD", () => {
    const bad = { ...manifest, assets: [{ ...manifest.assets[1], added: "15/11/2026" }] };
    expect(() => registerManifest(createRegistry(), bad)).toThrow(z.ZodError);
  });

  it("registers nothing when an id repeats inside the manifest", () => {
    const registry = createRegistry();
    const repeated = { ...manifest, assets: [...manifest.assets, manifest.assets[1]] };
    expect(() => registerManifest(registry, repeated)).toThrow(DuplicateAssetError);
    expect(registry.list()).toEqual([]);
  });

  it("registers nothing when an id is already taken", () => {
    const registry = createRegistry();
    registry.register({ id: "check", kind: "icon", name: "Check", version: "0.0.1" });
    expect(() => registerManifest(registry, manifest)).toThrow(DuplicateAssetError);
    expect(registry.list().map((a) => a.id)).toEqual(["check"]);
  });
});
