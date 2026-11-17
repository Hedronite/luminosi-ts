import { describe, expect, it } from "vitest";
import { manifest } from "./manifest.js";

const byDay = (day: string): string[] => manifest.assets.filter((asset) => asset.added === day).map((asset) => asset.id);

describe("primitive added dates", () => {
  it("dates the 26 Archimedean and Catalan solids 2026-11-16", () => {
    const solids = manifest.assets.filter((asset) => asset.id.startsWith("archimedean-") || asset.id.startsWith("catalan-")).map((asset) => asset.id);
    expect(solids).toHaveLength(26);
    expect(byDay("2026-11-16").sort()).toEqual(solids.sort());
  });

  it("dates the nine hand-placed primitives 2026-11-15", () => {
    expect(byDay("2026-11-15")).toHaveLength(9);
    expect(byDay("2026-11-15")).toContain("platonic-icosahedron");
  });

  it("leaves no primitive on another day", () => {
    expect(byDay("2026-11-15").length + byDay("2026-11-16").length).toBe(manifest.assets.length);
  });
});
