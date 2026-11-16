import type { Polyhedron } from "./polyhedron.js";
import { antiprism, archimedean, archimedeanSolids, bipyramid, catalan, catalanOf, geodesicSphere, platonic, prism, type ArchimedeanSolid, type CatalanSolid } from "./solids.js";

interface PrimitiveEntry {
  readonly name: string;
  readonly tags: readonly string[];
  readonly build: () => Polyhedron;
}

/** Hand-placed primitives, by id. Each is about one unit across. */
const fixed = {
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

type FixedId = keyof typeof fixed;
type UniformId = `archimedean-${ArchimedeanSolid}` | `catalan-${CatalanSolid}`;
export type PrimitiveId = FixedId | UniformId;

const title = (id: string): string => id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

/** The 13 Archimedean solids and their 13 Catalan duals, from hedronite.com's vertex data, at unit circumradius. */
const uniform = new Map<UniformId, PrimitiveEntry>(
  archimedeanSolids.flatMap((solid) => [
    [`archimedean-${solid}` as const, { name: title(solid), tags: ["archimedean", "solid"], build: () => archimedean(solid) }] as const,
    [`catalan-${catalanOf[solid]}` as const, { name: title(catalanOf[solid]), tags: ["catalan", "solid"], build: () => catalan(solid) }] as const,
  ]),
);
const uniformIds: ReadonlySet<string> = new Set(uniform.keys());

const isFixed = (id: string): id is FixedId => Object.hasOwn(fixed, id);

/** True if `id` names a shipped primitive. */
export function isPrimitiveId(id: string): id is PrimitiveId {
  return isFixed(id) || uniformIds.has(id);
}

/** Every primitive id, sorted. */
export const primitiveIds: readonly PrimitiveId[] = [...Object.keys(fixed), ...uniform.keys()].filter(isPrimitiveId).sort();

function entry(id: PrimitiveId): PrimitiveEntry {
  if (isFixed(id)) return fixed[id];
  const found = uniform.get(id);
  if (found === undefined) throw new RangeError(`unknown primitive "${id}"`);
  return found;
}

/** The polyhedron for a primitive id. */
export function primitive(id: PrimitiveId): Polyhedron {
  return entry(id).build();
}

/** Display name and tags for a primitive id. */
export function primitiveInfo(id: PrimitiveId): { readonly name: string; readonly tags: readonly string[] } {
  const { name, tags } = entry(id);
  return { name, tags };
}
