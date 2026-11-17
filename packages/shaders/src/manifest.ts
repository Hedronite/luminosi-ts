import { effectIds, effectInfo } from "./info.js";

/** The shaders' manifest for the LuminosiTS registry (`registerManifest`). */
export const manifest = {
  package: "@hedronite/lts-shaders",
  assets: effectIds.map((id) => {
    const { name, tags, added, origin } = effectInfo[id];
    return { id, kind: "shader", name, tags, version: "0.1.0", added: added ?? "2026-11-15", ...(origin === undefined ? {} : { origin }) };
  }),
} as const;
