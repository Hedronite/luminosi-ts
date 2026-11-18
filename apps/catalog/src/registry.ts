import type { IconData } from "@hedronite/lts-icons";
import { allIcons } from "@hedronite/lts-icons/manifest";
import type { Thumbnail } from "@hedronite/lts-core";
import { objectThumbnails } from "@hedronite/lts-objects/manifest";
import { bipyramid, isPrimitiveId, platonic, platonicSolids, primitive, type Polyhedron } from "@hedronite/lts-primitives";
import { loadRegistry } from "@hedronite/lts-registry";

/** Every asset the catalog shows: the same registry the lumin CLI and validate use. */
export const registry = loadRegistry();

const icons = new Map<string, IconData>(allIcons.map((icon) => [icon.id, icon]));

export function iconFor(id: string): IconData | undefined {
  return icons.get(id);
}

const shapes = new Map<string, Polyhedron>();

/** What an object's descriptor says stands for it, drawn. The descriptors name the shapes; the light list carries them to the gallery. */
function standIn(thumbnail: Thumbnail): Polyhedron | undefined {
  if (thumbnail.shape === "bipyramid") {
    return bipyramid(thumbnail.sides, { ...(thumbnail.radius === undefined ? {} : { radius: thumbnail.radius }), ...(thumbnail.height === undefined ? {} : { height: thumbnail.height }) });
  }
  const solid = platonicSolids.find((name) => name === thumbnail.solid);
  return solid === undefined ? undefined : platonic(solid);
}

const thumbnails: Readonly<Record<string, Thumbnail | undefined>> = objectThumbnails;

/** What stands for an object that names no shape of its own: a plain solid, so every object has a thumbnail. */
const genericObjectShape = (): Polyhedron => platonic("icosahedron");

/** An object's stand-in: the shape its descriptor names (any object stored as data, and any new one, names none and gets the generic one). */
function objectShape(id: string): Polyhedron {
  const named = thumbnails[id];
  return (named === undefined ? undefined : standIn(named)) ?? genericObjectShape();
}

/**
 * The polyhedron that stands for an asset in thumbnails, built once: a primitive is itself, an object is its stand-in or
 * the generic one.
 */
export function shapeFor(id: string, kind: "primitive" | "object"): Polyhedron | undefined {
  const known = shapes.get(id);
  if (known !== undefined) return known;
  const build = kind === "primitive" ? (isPrimitiveId(id) ? () => primitive(id) : undefined) : () => objectShape(id);
  if (build === undefined) return undefined;
  const shape = build();
  shapes.set(id, shape);
  return shape;
}
