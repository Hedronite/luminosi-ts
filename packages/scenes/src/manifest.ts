import { sceneKit, sceneKitIds } from "./kits.js";

/** The scene kits' manifest for the LuminosiTS registry (`registerManifest`). */
export const manifest = {
  package: "@hedronite/lts-scenes",
  assets: sceneKitIds.map((id) => {
    const { name, tags } = sceneKit(id);
    return { id: `scene-${id}`, kind: "scene", name, tags, version: "0.1.0", added: "2026-11-15" };
  }),
} as const;
