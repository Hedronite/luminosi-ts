import type { DescriptorRegistry } from "@hedronite/lts-core";

let loaded: Promise<DescriptorRegistry> | undefined;

/**
 * Every asset's descriptor, loaded on first use and kept. The descriptors (their parameter schemas, templates and
 * builders) arrive in a chunk of their own, so the asset list and the search, which read light data, never pay for them.
 */
export function loadDescriptors(): Promise<DescriptorRegistry> {
  loaded ??= import("./descriptors.js")
    .then((module) => module.buildDescriptors())
    .catch((error: unknown) => {
      loaded = undefined;
      throw error;
    });
  return loaded;
}
