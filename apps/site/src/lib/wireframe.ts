import { edges, type Polyhedron, type Vec3 } from "@hedronite/lts-primitives";

export interface Segment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /** False for edges on the far side, which are drawn fainter. */
  readonly front: boolean;
}

const rotate = ([x, y, z]: Vec3, ry: number, rx: number): Vec3 => {
  const x1 = x * Math.cos(ry) + z * Math.sin(ry);
  const z1 = -x * Math.sin(ry) + z * Math.cos(ry);
  return [x1, y * Math.cos(rx) - z1 * Math.sin(rx), y * Math.sin(rx) + z1 * Math.cos(rx)];
};

/** A polyhedron's edges projected for an SVG, with hidden edges marked. Runs at build time; ships no JavaScript. */
export function wireframe(shape: Polyhedron, ry = 0.7, rx = -0.45): readonly Segment[] {
  const points = shape.vertices.map((v) => rotate(v, ry, rx));
  const at = (i: number): Vec3 => points[i] ?? [0, 0, 0];
  const front = new Map<string, boolean>();
  for (const face of shape.faces) {
    const [a, b, c] = [at(face[0] ?? 0), at(face[1] ?? 0), at(face[2] ?? 0)];
    const facing = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
    face.forEach((from, i) => {
      const to = face[(i + 1) % face.length] ?? from;
      const key = from < to ? `${String(from)}-${String(to)}` : `${String(to)}-${String(from)}`;
      front.set(key, (front.get(key) ?? false) || facing);
    });
  }
  return edges(shape).map(([i, j]) => {
    const [a, b] = [at(i), at(j)];
    return { x1: a[0], y1: -a[1], x2: b[0], y2: -b[1], front: front.get(`${String(i)}-${String(j)}`) ?? true };
  });
}
