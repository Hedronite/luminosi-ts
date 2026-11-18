import type { IconData } from "@hedronite/lts-icons";
import { allIcons } from "@hedronite/lts-icons/manifest";
import type { ProceduralObjectId } from "@hedronite/lts-objects/manifest";
import { bipyramid, isPrimitiveId, platonic, primitive, type Polyhedron } from "@hedronite/lts-primitives";
import { loadRegistry } from "@hedronite/lts-registry";

/** Every asset the catalog shows: the same registry the lumin CLI and validate use. */
export const registry = loadRegistry();

const icons = new Map<string, IconData>(allIcons.map((icon) => [icon.id, icon]));

export function iconFor(id: string): IconData | undefined {
  return icons.get(id);
}

const shapes = new Map<string, Polyhedron>();

/**
 * Thumbnail stand-ins for objects, which have no single polyhedron. Keyed by the id type of the objects defined in
 * code, so a stale or misspelled id does not compile. Not exhaustive on purpose: an object with no line here (every
 * object stored as data, and any new one) gets the generic stand-in, so adding an object takes only its descriptor.
 */
const objectShapes: Partial<Record<ProceduralObjectId, () => Polyhedron>> = {
  "crystal-cluster": () => bipyramid(6, { radius: 0.4, height: 2 }),
  "crystal-cluster-glb": () => bipyramid(5, { radius: 0.4, height: 2 }),
  "instanced-lattice": () => platonic("cube"),
  "framed-solid": () => platonic("dodecahedron"),
};

const standIns = new Map<string, () => Polyhedron>(Object.entries(objectShapes));

/** What stands for an object that has no stand-in of its own: a plain solid, so every object has a thumbnail. */
const genericObjectShape = (): Polyhedron => platonic("icosahedron");

/**
 * The polyhedron that stands for an asset in thumbnails, built once: a primitive is itself, an object is its stand-in or
 * the generic one.
 */
export function shapeFor(id: string, kind: "primitive" | "object"): Polyhedron | undefined {
  const known = shapes.get(id);
  if (known !== undefined) return known;
  const build = kind === "primitive" ? (isPrimitiveId(id) ? () => primitive(id) : undefined) : (standIns.get(id) ?? genericObjectShape);
  if (build === undefined) return undefined;
  const shape = build();
  shapes.set(id, shape);
  return shape;
}
