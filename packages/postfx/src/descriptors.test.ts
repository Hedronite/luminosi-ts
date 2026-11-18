import { compareDescriptors } from "@hedronite/lts-core";
import { describe, expect, it, vi } from "vitest";
import { descriptors } from "./descriptors.js";
import { manifest } from "./manifest.js";

const loaded = vi.hoisted(() => ({ three: 0 }));
vi.mock("three", () => {
  loaded.three += 1;
  return {};
});
vi.mock("three/webgpu", () => {
  loaded.three += 1;
  return {};
});
vi.mock("three/tsl", () => {
  loaded.three += 1;
  return {};
});

describe("screen effect descriptors", () => {
  it("describe every screen effect in the manifest exactly once", () => {
    expect(compareDescriptors(manifest, descriptors)).toEqual({ missing: [], extra: [], duplicate: [], mismatched: [] });
    expect(descriptors).toHaveLength(manifest.assets.length);
  });

  it("load no three.js until a descriptor builds", async () => {
    expect(loaded.three).toBe(0);
    await descriptors[0]?.build().catch(() => undefined);
    expect(loaded.three).toBeGreaterThan(0);
  });
});

describe("screen effect previews", () => {
  it("name only parameters the effect has, and the scan is shown with a shorter period than its default", () => {
    const shown = descriptors.filter((descriptor) => descriptor.preview?.stage !== undefined);
    expect(shown.map((descriptor) => descriptor.meta.id)).toContain("scan");
    for (const descriptor of shown) {
      const keys = descriptor.fields.map((field) => field.key);
      expect(Object.keys(descriptor.preview?.stage ?? {}).filter((key) => !keys.includes(key))).toEqual([]);
    }
    const scan = descriptors.find((descriptor) => descriptor.meta.id === "scan");
    expect(Number(scan?.preview?.stage?.["period"])).toBeLessThan(Number(scan?.defaults["period"]));
  });
});
