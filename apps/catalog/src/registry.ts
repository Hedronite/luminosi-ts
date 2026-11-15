import type { IconData } from "@hedronite/lts-icons";
import { allIcons } from "@hedronite/lts-icons/manifest";
import { bipyramid, isPrimitiveId, platonic, primitive, type Polyhedron } from "@hedronite/lts-primitives";
import { loadRegistry } from "lumin/registry";

/** Every asset the catalog shows: the same registry the lumin CLI and validate use. */
export const registry = loadRegistry();

const icons = new Map<string, IconData>(allIcons.map((icon) => [icon.id, icon]));

export function iconFor(id: string): IconData | undefined {
  return icons.get(id);
}

const shapes = new Map<string, Polyhedron>();

// Thumbnail stand-ins for objects, which have no single polyhedron.
const objectShapes: Record<string, () => Polyhedron> = {
  "crystal-cluster": () => bipyramid(6, { radius: 0.4, height: 2 }),
  "crystal-cluster-glb": () => bipyramid(5, { radius: 0.4, height: 2 }),
  "instanced-lattice": () => platonic("cube"),
};

/** The polyhedron that stands for an asset in thumbnails (primitives, and objects by stand-in), built once. */
export function shapeFor(id: string): Polyhedron | undefined {
  const known = shapes.get(id);
  if (known !== undefined) return known;
  const build = isPrimitiveId(id) ? () => primitive(id) : objectShapes[id];
  if (build === undefined) return undefined;
  const shape = build();
  shapes.set(id, shape);
  return shape;
}
