import { createRegistry, registerManifest } from "@hedronite/lts-core";
import type { IconData } from "@hedronite/lts-icons";
import { allIcons, manifest as iconsManifest } from "@hedronite/lts-icons/manifest";

/** Every asset the catalog shows. New packages register their manifests here. */
export const registry = createRegistry();
registerManifest(registry, iconsManifest);

const icons = new Map<string, IconData>(allIcons.map((icon) => [icon.id, icon]));

export function iconFor(id: string): IconData | undefined {
  return icons.get(id);
}
