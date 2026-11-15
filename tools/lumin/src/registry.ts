import { createRegistry, registerManifest, type Registry } from "@hedronite/lts-core";
import { manifest as icons } from "@hedronite/lts-icons/manifest";
import { manifest as materials } from "@hedronite/lts-materials/manifest";
import { manifest as objects } from "@hedronite/lts-objects/manifest";
import { manifest as primitives } from "@hedronite/lts-primitives/manifest";
import { manifest as scenes } from "@hedronite/lts-scenes/manifest";
import { manifest as shaders } from "@hedronite/lts-shaders/manifest";

/** Every package's manifest, in the order an app registers them. */
export const manifests = [icons, primitives, materials, objects, shaders, scenes] as const;

/** Registers every manifest, collecting problems (such as an id two packages use) instead of throwing. */
export function buildRegistry(): { readonly registry: Registry; readonly problems: readonly string[] } {
  const registry = createRegistry();
  const problems: string[] = [];
  for (const manifest of manifests) {
    try {
      registerManifest(registry, manifest);
    } catch (error: unknown) {
      problems.push(`${manifest.package}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { registry, problems };
}

/** The registry every consumer shares. Throws if the manifests do not register cleanly. */
export function loadRegistry(): Registry {
  const { registry, problems } = buildRegistry();
  if (problems.length > 0) throw new Error(`manifests do not register cleanly:\n  ${problems.join("\n  ")}`);
  return registry;
}
