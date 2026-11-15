import { materialIds, materialPreset } from "./presets.js";

/** The materials' manifest for the LuminosiTS registry (`registerManifest`). */
export const manifest = {
  package: "@hedronite/lts-materials",
  assets: materialIds.map((id) => {
    const { name, tags } = materialPreset(id);
    return { id, kind: "material", name, tags, version: "0.1.0", added: "2026-11-15" };
  }),
} as const;
