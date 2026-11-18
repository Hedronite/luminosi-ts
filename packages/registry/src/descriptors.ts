import { createDescriptorRegistry, type DescriptorRegistry } from "@hedronite/lts-core";
import { descriptors as icons } from "@hedronite/lts-icons/descriptors";
import { descriptors as materials } from "@hedronite/lts-materials/descriptors";
import { descriptors as objects } from "@hedronite/lts-objects/descriptors";
import { descriptors as postfx } from "@hedronite/lts-postfx/descriptors";
import { descriptors as primitives } from "@hedronite/lts-primitives/descriptors";
import { descriptors as scenes } from "@hedronite/lts-scenes/descriptors";
import { descriptors as shaders } from "@hedronite/lts-shaders/descriptors";

/** Every package's descriptors, in the order its manifest is registered. */
const lists = [icons, primitives, materials, objects, shaders, scenes, postfx] as const;

/**
 * A registry of every asset's descriptor, which says what it is, what it takes and how to use it. Nothing but `lazy.ts`
 * imports this module, and only dynamically: the descriptors carry their parameter schemas and templates, which a
 * program that lists assets does not need. The modules import no three.js (`build` loads it when called).
 */
export function buildDescriptors(): DescriptorRegistry {
  const registry = createDescriptorRegistry();
  for (const list of lists) registry.register(...list);
  return registry;
}
