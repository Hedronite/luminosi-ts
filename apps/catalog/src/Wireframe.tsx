import { edges, type Polyhedron, type Vec3 } from "@hedronite/lts-primitives";

const ROTATE_Y = 0.7;
const ROTATE_X = -0.45;

const rotate = ([x, y, z]: Vec3): Vec3 => {
  const [cy, sy, cx, sx] = [Math.cos(ROTATE_Y), Math.sin(ROTATE_Y), Math.cos(ROTATE_X), Math.sin(ROTATE_X)];
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  return [x1, y * cx - z1 * sx, y * sx + z1 * cx];
};

/** A cheap static view of a polyhedron: edges projected to SVG, hidden ones dimmed. No WebGL. */
export function Wireframe({ shape, size }: { readonly shape: Polyhedron; readonly size: number }) {
  const points = shape.vertices.map(rotate);
  const at = (i: number): Vec3 => points[i] ?? [0, 0, 0];
  const facing = new Map<string, boolean>();
  for (const face of shape.faces) {
    const [a, b, c] = [at(face[0] ?? 0), at(face[1] ?? 0), at(face[2] ?? 0)];
    const front = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
    face.forEach((from, index) => {
      const to = face[(index + 1) % face.length] ?? from;
      const key = from < to ? `${String(from)}-${String(to)}` : `${String(to)}-${String(from)}`;
      facing.set(key, (facing.get(key) ?? false) || front);
    });
  }
  return (
    <svg width={size} height={size} viewBox="-1.2 -1.2 2.4 2.4" aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round">
      {edges(shape).map(([i, j]) => {
        const [a, b] = [at(i), at(j)];
        const visible = facing.get(`${String(i)}-${String(j)}`) ?? true;
        return (
          <line
            key={`${String(i)}-${String(j)}`}
            x1={a[0]}
            y1={-a[1]}
            x2={b[0]}
            y2={-b[1]}
            strokeWidth={visible ? 0.045 : 0.025}
            strokeOpacity={visible ? 1 : 0.3}
          />
        );
      })}
    </svg>
  );
}
