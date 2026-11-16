import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from "./vec.js";

/** A convex polyhedron: vertices, and faces as vertex indices counter-clockwise seen from outside. */
export interface Polyhedron {
  readonly vertices: readonly Vec3[];
  readonly faces: readonly (readonly number[])[];
}

const EPSILON = 1e-7;

/** Builds the convex hull of `points` (at most a few dozen; the search is brute force). */
export function convexHull(points: readonly Vec3[]): Polyhedron {
  const faces = new Map<string, number[]>();
  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const face = hullFace(points, i, j, k);
        if (face !== undefined) faces.set([...face].sort((a, b) => a - b).join(","), face);
      }
    }
  }
  if (faces.size < 4) {
    throw new Error("points are coplanar or too few for a polyhedron");
  }
  return { vertices: points, faces: [...faces.values()] };
}

/** The face through points i, j, k if every other point lies behind its plane, ordered outward. */
function hullFace(points: readonly Vec3[], i: number, j: number, k: number): number[] | undefined {
  const [a, b, c] = [points[i], points[j], points[k]];
  if (a === undefined || b === undefined || c === undefined) return undefined;
  const raw = cross(sub(b, a), sub(c, a));
  if (length(raw) < EPSILON) return undefined;
  let normal = normalize(raw);
  let offset = dot(normal, a);
  let ahead = 0;
  let behind = 0;
  for (const p of points) {
    const side = dot(normal, p) - offset;
    if (side > EPSILON) ahead++;
    else if (side < -EPSILON) behind++;
  }
  if (ahead > 0 && behind > 0) return undefined;
  if (ahead > 0) {
    normal = scale(normal, -1);
    offset = -offset;
  }
  const onPlane = points.flatMap((p, index) => (Math.abs(dot(normal, p) - offset) <= EPSILON ? [index] : []));
  return orderAround(points, onPlane, normal);
}

/** Sorts a face's vertex indices counter-clockwise around its outward normal. */
function orderAround(points: readonly Vec3[], indices: readonly number[], normal: Vec3): number[] {
  const at = (index: number): Vec3 => points[index] ?? [0, 0, 0];
  const centre = scale(indices.reduce<Vec3>((sum, index) => add(sum, at(index)), [0, 0, 0]), 1 / indices.length);
  const u = normalize(sub(at(indices[0] ?? 0), centre));
  const w = cross(normal, u);
  const angle = (index: number): number => {
    const d = sub(at(index), centre);
    return Math.atan2(dot(d, w), dot(d, u));
  };
  return [...indices].sort((x, y) => angle(x) - angle(y));
}

/**
 * The polar dual: one vertex per face (its plane reciprocated about the origin) and one face per vertex.
 * Every face of the dual is exactly planar. The dual of an Archimedean solid is its Catalan solid; of a
 * cube, an octahedron. The origin must be inside the polyhedron.
 */
export function dual(polyhedron: Polyhedron): Polyhedron {
  const at = (index: number): Vec3 => polyhedron.vertices[index] ?? [0, 0, 0];
  const vertices = polyhedron.faces.map((face): Vec3 => {
    const first = at(face[0] ?? 0);
    const normal = normalize(cross(sub(at(face[1] ?? 0), first), sub(at(face[2] ?? 0), first)));
    const offset = dot(normal, first);
    if (offset <= EPSILON) throw new RangeError("the origin must be inside the polyhedron to take its dual");
    return scale(normal, 1 / offset);
  });
  const faces = polyhedron.vertices.map((vertex, index) => {
    const around = polyhedron.faces.flatMap((face, faceIndex) => (face.includes(index) ? [faceIndex] : []));
    return orderAround(vertices, around, normalize(vertex));
  });
  return { vertices, faces };
}

/** The same shape scaled so its farthest vertex is `radius` from the origin. */
export function withRadius(polyhedron: Polyhedron, radius: number): Polyhedron {
  const farthest = Math.max(...polyhedron.vertices.map((v) => length(v)));
  return { vertices: polyhedron.vertices.map((v) => scale(v, radius / farthest)), faces: polyhedron.faces };
}

/** Each edge once, as an ordered pair of vertex indices. */
export function edges(polyhedron: Polyhedron): readonly (readonly [number, number])[] {
  const seen = new Map<string, readonly [number, number]>();
  for (const face of polyhedron.faces) {
    face.forEach((from, index) => {
      const to = face[(index + 1) % face.length] ?? from;
      const pair: readonly [number, number] = from < to ? [from, to] : [to, from];
      seen.set(`${String(pair[0])}-${String(pair[1])}`, pair);
    });
  }
  return [...seen.values()];
}

export interface TriangleData {
  /** x, y, z for every triangle corner. */
  readonly positions: Float32Array<ArrayBuffer>;
  /** The face normal at every corner: flat shading, for crisp facets. */
  readonly normals: Float32Array<ArrayBuffer>;
}

/** Fan-triangulates every face, with one normal per face. */
export function triangulate(polyhedron: Polyhedron): TriangleData {
  const positions: number[] = [];
  const normals: number[] = [];
  const at = (index: number): Vec3 => polyhedron.vertices[index] ?? [0, 0, 0];
  for (const face of polyhedron.faces) {
    const first = at(face[0] ?? 0);
    const normal = normalize(cross(sub(at(face[1] ?? 0), first), sub(at(face[2] ?? 0), first)));
    for (let i = 1; i + 1 < face.length; i++) {
      for (const corner of [first, at(face[i] ?? 0), at(face[i + 1] ?? 0)]) {
        positions.push(...corner);
        normals.push(...normal);
      }
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals) };
}
