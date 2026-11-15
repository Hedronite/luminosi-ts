import { describe, expect, it } from "vitest";
import { arrange, MAX_PLACEMENTS, PLACEMENT_SCALE, toJson, toTsx, type Composition } from "./composition.js";

const composition: Composition = {
  lightIntensity: 1.2,
  placements: [
    { key: "a", primitive: "platonic-cube", material: "satin" },
    { key: "b", primitive: "platonic-icosahedron", material: "glass" },
  ],
};

describe("arrange", () => {
  it("gives one position per placement", () => {
    for (let n = 0; n <= MAX_PLACEMENTS; n++) expect(arrange(n)).toHaveLength(n);
  });

  it("keeps neighbours far enough apart that scaled shapes never touch", () => {
    for (let n = 2; n <= MAX_PLACEMENTS; n++) {
      const points = arrange(n);
      points.forEach((p, i) => {
        const q = points[(i + 1) % n] ?? p;
        expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])).toBeGreaterThan(2 * PLACEMENT_SCALE + 0.1);
      });
    }
  });
});

describe("export", () => {
  it("writes JSON with primitives, materials and lighting, without internal keys", () => {
    const parsed: unknown = JSON.parse(toJson(composition));
    expect(parsed).toEqual({
      lightIntensity: 1.2,
      placements: [
        { primitive: "platonic-cube", material: "satin" },
        { primitive: "platonic-icosahedron", material: "glass" },
      ],
    });
  });

  it("writes TSX that renders each placement with the adapters", () => {
    const code = toTsx(composition);
    expect(code).toContain('import { PrimitiveMesh, StudioLights } from "@hedronite/lts-adapters";');
    expect(code).toContain("<StudioLights intensity={1.2} />");
    expect(code).toContain('<PrimitiveMesh primitive="platonic-icosahedron" material="glass"');
  });
});
