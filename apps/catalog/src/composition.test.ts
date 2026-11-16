import { describe, expect, it } from "vitest";
import { arrange, isPlaceableObject, MAX_PLACEMENTS, OBJECT_SCALE, PLACEMENT_SCALE, toJson, toTsx, type Composition } from "./composition.js";

const composition: Composition = {
  lightIntensity: 1.2,
  effects: [],
  ink: "look",
  placements: [
    { key: "a", kind: "primitive", primitive: "platonic-cube", material: "satin" },
    { key: "b", kind: "primitive", primitive: "platonic-icosahedron", material: "glass" },
  ],
};

const mixed: Composition = {
  lightIntensity: 1,
  effects: ["lens", "smoke", "scan"],
  ink: "accent",
  placements: [
    { key: "a", kind: "framed", primitive: "archimedean-truncated-icosahedron", faces: "glass", edges: "metal" },
    { key: "b", kind: "object", object: "dress-watch", material: "satin" },
    { key: "c", kind: "object", object: "crystal-cluster", material: "glass" },
  ],
};

describe("arrange", () => {
  it("gives one position per placement", () => {
    for (let n = 0; n <= MAX_PLACEMENTS; n++) expect(arrange(n)).toHaveLength(n);
  });

  it("keeps neighbours far enough apart that scaled shapes never touch", () => {
    const largest = Math.max(PLACEMENT_SCALE, OBJECT_SCALE);
    for (let n = 2; n <= MAX_PLACEMENTS; n++) {
      const points = arrange(n);
      points.forEach((p, i) => {
        const q = points[(i + 1) % n] ?? p;
        expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])).toBeGreaterThan(2 * largest - 0.05);
      });
    }
  });
});

describe("export", () => {
  it("writes JSON with each placement, without internal keys, and no effects when there are none", () => {
    const parsed: unknown = JSON.parse(toJson(composition));
    expect(parsed).toEqual({
      lightIntensity: 1.2,
      placements: [
        { kind: "primitive", primitive: "platonic-cube", material: "satin" },
        { kind: "primitive", primitive: "platonic-icosahedron", material: "glass" },
      ],
    });
  });

  it("writes the effect stack in the order it runs, with the ink", () => {
    const parsed: unknown = JSON.parse(toJson(mixed));
    expect(parsed).toMatchObject({ effects: ["smoke", "scan", "lens"], ink: "accent" });
  });

  it("writes TSX that renders each placement with the adapters", () => {
    const code = toTsx(composition);
    expect(code).toContain('import { PrimitiveMesh, StudioEnvironment, StudioLights } from "@hedronite/lts-adapters";');
    expect(code).toContain("<StudioLights intensity={1.2} />");
    expect(code).toContain('<PrimitiveMesh primitive="platonic-icosahedron" material="glass"');
    expect(code).not.toContain("ScreenEffectsPass");
  });

  it("writes framed solids, objects and the screen effects", () => {
    const code = toTsx(mixed);
    expect(code).toContain('import { CrystalCluster, FramedSolid, LibraryObject, ScreenEffectsPass, StudioEnvironment, StudioLights } from "@hedronite/lts-adapters";');
    expect(code).toContain('<FramedSolid primitive="archimedean-truncated-icosahedron" faces="glass" edges="metal"');
    expect(code).toContain('<LibraryObject object="dress-watch"');
    expect(code).toContain('<CrystalCluster count={14} spread={0.7} seed={11} material="glass"');
    expect(code).toContain('const stack = [{ id: "smoke" }, { id: "scan" }, { id: "lens" }] as const;');
    expect(code).toContain("<ScreenEffectsPass effects={stack} monochrome={palette.accent} />");
  });

  it("knows which objects it can place", () => {
    expect(isPlaceableObject("dress-watch")).toBe(true);
    expect(isPlaceableObject("crystal-cluster-glb")).toBe(false);
  });
});
