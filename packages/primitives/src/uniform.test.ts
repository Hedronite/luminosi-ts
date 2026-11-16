import { describe, expect, it } from "vitest";
import { isPrimitiveId, primitive, primitiveInfo } from "./catalog.js";
import { dual, edges, withRadius, type Polyhedron } from "./polyhedron.js";
import { archimedean, archimedeanSolids, catalan, catalanOf, platonic } from "./solids.js";
import { cross, dot, length, normalize, sub, type Vec3 } from "./vec.js";

const origin: Vec3 = [0, 0, 0];

/** Vertices, edges and faces of each Archimedean solid (the Catalan dual swaps vertices and faces). */
const counts = {
  "truncated-tetrahedron": [12, 18, 8],
  cuboctahedron: [12, 24, 14],
  "truncated-cube": [24, 36, 14],
  "truncated-octahedron": [24, 36, 14],
  rhombicuboctahedron: [24, 48, 26],
  "truncated-cuboctahedron": [48, 72, 26],
  "snub-cube": [24, 60, 38],
  icosidodecahedron: [30, 60, 32],
  "truncated-dodecahedron": [60, 90, 32],
  "truncated-icosahedron": [60, 90, 32],
  rhombicosidodecahedron: [60, 120, 62],
  "truncated-icosidodecahedron": [120, 180, 62],
  "snub-dodecahedron": [60, 150, 92],
} as const;

/** The largest distance of any face vertex from its face's plane. */
function worstPlanarity(p: Polyhedron): number {
  let worst = 0;
  for (const face of p.faces) {
    const [a, b, c] = face.map((i) => p.vertices[i] ?? origin);
    if (a === undefined || b === undefined || c === undefined) throw new Error("face too small");
    const normal = normalize(cross(sub(b, a), sub(c, a)));
    for (const i of face) worst = Math.max(worst, Math.abs(dot(normal, sub(p.vertices[i] ?? origin, a))));
  }
  return worst;
}

const edgeLengths = (p: Polyhedron): number[] => edges(p).map(([i, j]) => length(sub(p.vertices[i] ?? origin, p.vertices[j] ?? origin)));

describe("Archimedean solids", () => {
  it.each(archimedeanSolids)("%s has the right counts, one radius and one edge length", (solid) => {
    const p = archimedean(solid);
    const [v, e, f] = counts[solid];
    expect([p.vertices.length, edges(p).length, p.faces.length]).toEqual([v, e, f]);
    for (const vertex of p.vertices) expect(length(vertex)).toBeCloseTo(1, 6);
    const lengths = edgeLengths(p);
    for (const l of lengths) expect(l).toBeCloseTo(lengths[0] ?? 0, 6);
    expect(worstPlanarity(p)).toBeLessThan(1e-6);
  });

  it("scales to any radius", () => {
    for (const vertex of archimedean("snub-cube", 2.5).vertices) expect(length(vertex)).toBeCloseTo(2.5, 6);
  });
});

describe("Catalan solids", () => {
  it.each(archimedeanSolids)("the dual of %s swaps its vertices and faces, with planar faces all alike", (solid) => {
    const p = catalan(solid);
    const [v, e, f] = counts[solid];
    expect([p.vertices.length, edges(p).length, p.faces.length]).toEqual([f, e, v]);
    expect(worstPlanarity(p)).toBeLessThan(1e-9);
    // Face-uniform: every face has as many sides as the Archimedean vertex has edges.
    const sides = new Set(p.faces.map((face) => face.length));
    expect(sides.size).toBe(1);
    expect(Math.max(...p.vertices.map((vertex) => length(vertex)))).toBeCloseTo(1, 9);
    for (const face of p.faces) {
      const [a, b, c] = face.map((i) => p.vertices[i] ?? origin);
      if (a === undefined || b === undefined || c === undefined) throw new Error("face too small");
      expect(dot(cross(sub(b, a), sub(c, a)), a)).toBeGreaterThan(0); // counter-clockwise from outside
    }
  });
});

describe("dual", () => {
  it("turns a cube into an octahedron and back", () => {
    const octahedron = dual(platonic("cube"));
    expect([octahedron.vertices.length, octahedron.faces.length]).toEqual([6, 8]);
    const cube = withRadius(dual(octahedron), Math.sqrt(3));
    expect([cube.vertices.length, cube.faces.length]).toEqual([8, 6]);
    for (const vertex of cube.vertices) for (const c of vertex) expect(Math.abs(c)).toBeCloseTo(1, 9);
  });

  it("refuses a polyhedron that doesn't contain the origin", () => {
    const shifted: Polyhedron = { ...platonic("cube"), vertices: platonic("cube").vertices.map(([x, y, z]): Vec3 => [x + 5, y, z]) };
    expect(() => dual(shifted)).toThrow(RangeError);
  });
});

it("lists all 26 as primitives, named for people", () => {
  expect(isPrimitiveId("archimedean-snub-dodecahedron")).toBe(true);
  expect(isPrimitiveId(`catalan-${catalanOf["truncated-icosahedron"]}`)).toBe(true);
  expect(primitiveInfo("catalan-pentakis-dodecahedron")).toEqual({ name: "Pentakis dodecahedron", tags: ["catalan", "solid"] });
  expect(primitive("archimedean-truncated-icosahedron").faces).toHaveLength(32);
});
