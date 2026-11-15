import { createRegistry, registerManifest } from "@hedronite/lts-core";
import type { IconData } from "@hedronite/lts-icons";
import { allIcons, manifest as iconsManifest } from "@hedronite/lts-icons/manifest";
import { manifest as materialsManifest } from "@hedronite/lts-materials/manifest";
import { isPrimitiveId, primitive, type Polyhedron } from "@hedronite/lts-primitives";
import { manifest as primitivesManifest } from "@hedronite/lts-primitives/manifest";

/** Every asset the catalog shows. New packages register their manifests here. */
export const registry = createRegistry();
registerManifest(registry, iconsManifest);
registerManifest(registry, primitivesManifest);
registerManifest(registry, materialsManifest);

const icons = new Map<string, IconData>(allIcons.map((icon) => [icon.id, icon]));

export function iconFor(id: string): IconData | undefined {
  return icons.get(id);
}

const shapes = new Map<string, Polyhedron>();

/** The polyhedron for a primitive id, built once. */
export function shapeFor(id: string): Polyhedron | undefined {
  if (!isPrimitiveId(id)) return undefined;
  const known = shapes.get(id);
  if (known !== undefined) return known;
  const shape = primitive(id);
  shapes.set(id, shape);
  return shape;
}
