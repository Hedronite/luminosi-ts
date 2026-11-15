import type { Polyhedron } from "./polyhedron.js";
import { antiprism, bipyramid, geodesicSphere, platonic, prism } from "./solids.js";

interface PrimitiveEntry {
  readonly name: string;
  readonly tags: readonly string[];
  readonly build: () => Polyhedron;
}

/** Every primitive the library ships, by id. Each is about one unit across. */
const entries = {
  "geodesic-sphere": { name: "Geodesic sphere", tags: ["sphere", "geodesic"], build: () => geodesicSphere(3) },
  "hexagonal-bipyramid": { name: "Hexagonal bipyramid", tags: ["crystal"], build: () => bipyramid(6, { radius: 0.6, height: 1.9 }) },
  "hexagonal-prism": { name: "Hexagonal prism", tags: ["prism", "tile"], build: () => prism(6, { radius: 0.9, height: 0.5 }) },
  "pentagonal-antiprism": { name: "Pentagonal antiprism", tags: ["antiprism"], build: () => antiprism(5, { radius: 0.88, height: 0.9 }) },
  "platonic-cube": { name: "Cube", tags: ["platonic", "solid"], build: () => platonic("cube") },
  "platonic-dodecahedron": { name: "Dodecahedron", tags: ["platonic", "solid"], build: () => platonic("dodecahedron") },
  "platonic-icosahedron": { name: "Icosahedron", tags: ["platonic", "solid"], build: () => platonic("icosahedron") },
  "platonic-octahedron": { name: "Octahedron", tags: ["platonic", "solid"], build: () => platonic("octahedron") },
  "platonic-tetrahedron": { name: "Tetrahedron", tags: ["platonic", "solid"], build: () => platonic("tetrahedron") },
} as const satisfies Record<string, PrimitiveEntry>;

export type PrimitiveId = keyof typeof entries;

/** True if `id` names a shipped primitive. */
export function isPrimitiveId(id: string): id is PrimitiveId {
  return Object.hasOwn(entries, id);
}

/** Every primitive id, sorted. */
export const primitiveIds: readonly PrimitiveId[] = Object.keys(entries).filter(isPrimitiveId).sort();

/** The polyhedron for a primitive id. */
export function primitive(id: PrimitiveId): Polyhedron {
  return entries[id].build();
}

/** Display name and tags for a primitive id. */
export function primitiveInfo(id: PrimitiveId): { readonly name: string; readonly tags: readonly string[] } {
  return { name: entries[id].name, tags: entries[id].tags };
}
