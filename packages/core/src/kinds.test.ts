import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assetKinds, isAssetKind, registeredKinds, registerKind } from "./asset.js";
import { createRegistry } from "./registry.js";

// A package adds a kind by declaring its id here; the id then type-checks wherever a kind is taken.
declare module "./asset.js" {
  interface AssetKindMap {
    readonly sound: true;
  }
}

const chime = { id: "chime", kind: "sound", name: "Chime", version: "0.1.0", tags: ["ui"] };

describe("kinds", () => {
  it("registers the seven shipped kinds by default, in catalog order", () => {
    expect(registeredKinds().slice(0, assetKinds.length)).toEqual([...assetKinds]);
    for (const kind of assetKinds) expect(isAssetKind(kind)).toBe(true);
  });

  it("rejects an asset of a kind nobody has registered", () => {
    expect(isAssetKind("sound")).toBe(false);
    expect(() => createRegistry().register(chime)).toThrow(z.ZodError);
  });

  it("accepts, stores and lists an asset of a registered kind", () => {
    registerKind("sound");
    expect(isAssetKind("sound")).toBe(true);
    const registry = createRegistry();
    const meta = registry.register(chime);
    expect(meta.kind).toBe("sound");
    expect(registry.list({ kind: "sound" }).map((asset) => asset.id)).toEqual(["chime"]);
    expect(registry.list({ kind: "icon" })).toEqual([]);
    expect(registeredKinds()).toContain("sound");
  });

  it("does nothing when a kind is registered twice", () => {
    registerKind("sound");
    const before = registeredKinds();
    registerKind("sound");
    registerKind("icon");
    expect(registeredKinds()).toEqual(before);
  });

  it("type-checks kind ids: one nobody declared is a compile error, one that is not a slug a runtime error", () => {
    const undeclared = (): void => {
      // @ts-expect-error "video" is not in AssetKindMap
      registerKind("video");
    };
    expect(undeclared).toBeTypeOf("function");
    expect(() => {
      // @ts-expect-error not declared, and not a slug
      registerKind("Not A Slug");
    }).toThrow(RangeError);
  });

  it("names the registered kinds when it rejects one", () => {
    expect(() => createRegistry().register({ ...chime, kind: "nonsense" })).toThrow(/expected one of icon, primitive/);
  });
});
