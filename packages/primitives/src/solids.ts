import { convexHull, type Polyhedron } from "./polyhedron.js";
import { length, normalize, scale, type Vec3 } from "./vec.js";

const PHI = (1 + Math.sqrt(5)) / 2;

export const platonicSolids = ["tetrahedron", "cube", "octahedron", "dodecahedron", "icosahedron"] as const;
export type PlatonicSolid = (typeof platonicSolids)[number];

const signs = (v: Vec3): Vec3[] => {
  const out: Vec3[] = [];
  for (const x of v[0] === 0 ? [0] : [v[0], -v[0]])
    for (const y of v[1] === 0 ? [0] : [v[1], -v[1]]) for (const z of v[2] === 0 ? [0] : [v[2], -v[2]]) out.push([x, y, z]);
  return out;
};
const cycles = ([a, b, c]: Vec3): Vec3[] => [
  [a, b, c],
  [b, c, a],
  [c, a, b],
];

const seeds: Record<PlatonicSolid, () => Vec3[]> = {
  tetrahedron: () => [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ],
  cube: () => signs([1, 1, 1]),
  octahedron: () => cycles([1, 0, 0]).flatMap(signs),
  dodecahedron: () => [...signs([1, 1, 1]), ...cycles([0, 1 / PHI, PHI]).flatMap(signs)],
  icosahedron: () => cycles([0, 1, PHI]).flatMap(signs),
};

const toRadius = (points: readonly Vec3[], radius: number): Vec3[] => points.map((p) => scale(p, radius / length(p)));

/** A Platonic solid with every vertex at `radius` from the origin. */
export function platonic(solid: PlatonicSolid, radius = 1): Polyhedron {
  return convexHull(toRadius(seeds[solid](), radius));
}

export interface RingOptions {
  /** Distance from the axis to each ring vertex. Default 1. */
  readonly radius?: number;
  /** Total height along y. Default 1. */
  readonly height?: number;
}

const ring = (sides: number, radius: number, y: number, twist = 0): Vec3[] =>
  Array.from({ length: sides }, (_, i) => {
    const angle = twist + (i * 2 * Math.PI) / sides;
    return [radius * Math.cos(angle), y, radius * Math.sin(angle)];
  });

const checkSides = (sides: number): void => {
  if (!Number.isInteger(sides) || sides < 3 || sides > 64) {
    throw new RangeError(`sides must be an integer from 3 to 64, got ${String(sides)}`);
  }
};

/** Two parallel regular n-gons joined by rectangles. */
export function prism(sides: number, { radius = 1, height = 1 }: RingOptions = {}): Polyhedron {
  checkSides(sides);
  return convexHull([...ring(sides, radius, height / 2), ...ring(sides, radius, -height / 2)]);
}

/** Two parallel regular n-gons, one turned half a step, joined by triangles. */
export function antiprism(sides: number, { radius = 1, height = 1 }: RingOptions = {}): Polyhedron {
  checkSides(sides);
  return convexHull([...ring(sides, radius, height / 2), ...ring(sides, radius, -height / 2, Math.PI / sides)]);
}

/** A regular n-gon with a point above and below: the classic crystal shape. */
export function bipyramid(sides: number, { radius = 1, height = 2 }: RingOptions = {}): Polyhedron {
  checkSides(sides);
  return convexHull([[0, height / 2, 0], [0, -height / 2, 0], ...ring(sides, radius, 0)]);
}

/** A sphere from an icosahedron, each face split `frequency²` ways and pushed out to `radius`. */
export function geodesicSphere(frequency: number, radius = 1): Polyhedron {
  if (!Number.isInteger(frequency) || frequency < 1 || frequency > 16) {
    throw new RangeError(`frequency must be an integer from 1 to 16, got ${String(frequency)}`);
  }
  const base = platonic("icosahedron");
  const vertices: Vec3[] = [];
  const index = new Map<string, number>();
  const vertexFor = (p: Vec3): number => {
    const unit = normalize(p);
    const key = unit.map((c) => c.toFixed(6)).join(",");
    const known = index.get(key);
    if (known !== undefined) return known;
    vertices.push(scale(unit, radius));
    index.set(key, vertices.length - 1);
    return vertices.length - 1;
  };
  const faces: number[][] = [];
  const at = (i: number): Vec3 => base.vertices[i] ?? [0, 0, 0];
  for (const [ia = 0, ib = 0, ic = 0] of base.faces) {
    const [a, b, c] = [at(ia), at(ib), at(ic)];
    const point = (i: number, j: number): number => {
      const k = frequency - i - j;
      return vertexFor([
        (a[0] * k + b[0] * i + c[0] * j) / frequency,
        (a[1] * k + b[1] * i + c[1] * j) / frequency,
        (a[2] * k + b[2] * i + c[2] * j) / frequency,
      ]);
    };
    for (let i = 0; i < frequency; i++) {
      for (let j = 0; j < frequency - i; j++) {
        faces.push([point(i, j), point(i + 1, j), point(i, j + 1)]);
        if (i + j + 1 < frequency) faces.push([point(i + 1, j), point(i + 1, j + 1), point(i, j + 1)]);
      }
    }
  }
  return { vertices, faces };
}
