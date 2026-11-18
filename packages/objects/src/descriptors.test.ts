import { compareDescriptors } from "@hedronite/lts-core";
import { describe, expect, it, vi } from "vitest";
import { descriptors } from "./descriptors.js";
import { manifest } from "./manifest.js";

const loaded = vi.hoisted(() => ({ three: 0 }));
vi.mock("three", () => {
  loaded.three += 1;
  return {};
});
vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => {
  loaded.three += 1;
  return {};
});
vi.mock("three/examples/jsm/libs/meshopt_decoder.module.js", () => {
  loaded.three += 1;
  return {};
});

describe("object descriptors", () => {
  it("describe every object in the manifest exactly once", () => {
    expect(compareDescriptors(manifest, descriptors)).toEqual({ missing: [], extra: [], duplicate: [], mismatched: [] });
    expect(descriptors).toHaveLength(manifest.assets.length);
  });

  it("load no three.js until a descriptor builds", async () => {
    expect(loaded.three).toBe(0);
    await descriptors.find((descriptor) => descriptor.meta.id === "dress-watch")?.build().catch(() => undefined);
    expect(loaded.three).toBeGreaterThan(0);
  });
});
