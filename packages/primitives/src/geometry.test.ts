import { createRegistry, registerManifest } from "@hedronite/lts-core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { primitive, primitiveIds } from "./catalog.js";
import { manifest } from "./manifest.js";
import { convexHull, edges, triangulate, type Polyhedron } from "./polyhedron.js";
import { antiprism, bipyramid, geodesicSphere, platonic, platonicSolids, prism } from "./solids.js";
import { add, cross, dot, length, scale, sub, type Vec3 } from "./vec.js";

const origin: Vec3 = [0, 0, 0];

const centroid = (p: Polyhedron, face: readonly number[]): Vec3 =>
  scale(face.reduce<Vec3>((sum, i) => add(sum, p.vertices[i] ?? origin), origin), 1 / face.length);

/** Everything a well-formed convex polyhedron must satisfy. */
function expectWellFormed(p: Polyhedron): void {
  const v = p.vertices.length;
  const e = edges(p).length;
  const f = p.faces.length;
  expect(v - e + f).toBe(2); // Euler
  for (const face of p.faces) {
    expect(face.length).toBeGreaterThanOrEqual(3);
    const [a, b, c] = face.map((i) => p.vertices[i] ?? origin);
    if (a === undefined || b === undefined || c === undefined) throw new Error("face too small");
    const normal = cross(sub(b, a), sub(c, a));
    expect(dot(normal, centroid(p, face))).toBeGreaterThan(0); // counter-clockwise from outside
  }
  const { positions, normals } = triangulate(p);
  expect(positions.length).toBe(normals.length);
  expect(positions.every(Number.isFinite)).toBe(true);
  for (let i = 0; i < normals.length; i += 3) {
    expect(Math.hypot(normals[i] ?? 0, normals[i + 1] ?? 0, normals[i + 2] ?? 0)).toBeCloseTo(1, 5);
  }
}

describe("Platonic solids", () => {
  it.each([
    ["tetrahedron", 4, 6, 4, 3],
    ["cube", 8, 12, 6, 4],
    ["octahedron", 6, 12, 8, 3],
    ["dodecahedron", 20, 30, 12, 5],
    ["icosahedron", 12, 30, 20, 3],
  ] as const)("%s has %i vertices, %i edges, %i faces of %i sides", (solid, v, e, f, sides) => {
    const p = platonic(solid);
    expect(p.vertices.length).toBe(v);
    expect(edges(p).length).toBe(e);
    expect(p.faces.length).toBe(f);
    expect(p.faces.every((face) => face.length === sides)).toBe(true);
    expectWellFormed(p);
  });

  it("puts every vertex on the circumsphere and makes every edge the same length", () => {
    fc.assert(
      fc.property(fc.constantFrom(...platonicSolids), fc.double({ min: 0.1, max: 10, noNaN: true }), (solid, radius) => {
        const p = platonic(solid, radius);
        for (const vertex of p.vertices) expect(length(vertex)).toBeCloseTo(radius, 6);
        const lengths = edges(p).map(([i, j]) => length(sub(p.vertices[i] ?? origin, p.vertices[j] ?? origin)));
        for (const l of lengths) expect(l).toBeCloseTo(lengths[0] ?? 0, 6);
      }),
      { numRuns: 25 },
    );
  });
});

describe("prisms, antiprisms and bipyramids", () => {
  const sides = fc.integer({ min: 3, max: 24 });

  it("prisms have 2n vertices, 3n edges and n + 2 faces", () => {
    fc.assert(
      fc.property(sides, (n) => {
        const p = prism(n);
        expect([p.vertices.length, edges(p).length, p.faces.length]).toEqual([2 * n, 3 * n, n + 2]);
        expectWellFormed(p);
      }),
      { numRuns: 15 },
    );
  });

  it("antiprisms have 2n vertices, 4n edges and 2n + 2 faces", () => {
    fc.assert(
      fc.property(sides, (n) => {
        const p = antiprism(n);
        expect([p.vertices.length, edges(p).length, p.faces.length]).toEqual([2 * n, 4 * n, 2 * n + 2]);
        expectWellFormed(p);
      }),
      { numRuns: 15 },
    );
  });

  it("bipyramids have n + 2 vertices, 3n edges and 2n faces", () => {
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 24 }), (n) => {
        const p = bipyramid(n);
        expect([p.vertices.length, edges(p).length, p.faces.length]).toEqual([n + 2, 3 * n, 2 * n]);
        expectWellFormed(p);
      }),
      { numRuns: 15 },
    );
  });

  it("rejects side counts outside 3 to 64", () => {
    expect(() => antiprism(2)).toThrow(RangeError);
    expect(() => bipyramid(3.5)).toThrow(RangeError);
  });
});

describe("geodesic spheres", () => {
  it.each([1, 2, 3, 4])("frequency %i has 10f² + 2 vertices and 20f² faces on the sphere", (f) => {
    const p = geodesicSphere(f, 2);
    expect(p.vertices.length).toBe(10 * f * f + 2);
    expect(p.faces.length).toBe(20 * f * f);
    for (const vertex of p.vertices) expect(length(vertex)).toBeCloseTo(2, 6);
    expectWellFormed(p);
  });

  it("rejects frequencies outside 1 to 16", () => {
    expect(() => geodesicSphere(0)).toThrow(RangeError);
  });
});

describe("convexHull", () => {
  it("rejects coplanar points", () => {
    expect(() =>
      convexHull([
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
      ]),
    ).toThrow();
  });
});

describe("primitive catalog", () => {
  it("builds a well-formed shape for every id, about one unit across", () => {
    for (const id of primitiveIds) {
      const p = primitive(id);
      expectWellFormed(p);
      const extent = Math.max(...p.vertices.map(length));
      expect(extent).toBeGreaterThan(0.5);
      expect(extent).toBeLessThanOrEqual(1.000001);
    }
  });

  it("registers one primitive asset per id", () => {
    const registry = createRegistry();
    registerManifest(registry, manifest);
    expect(registry.list({ kind: "primitive" }).map((a) => a.id)).toEqual([...primitiveIds]);
  });
});
