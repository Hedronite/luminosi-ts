import { effectIds, effectInfo } from "./effects.js";

/** The shaders' manifest for the LuminosiTS registry (`registerManifest`). */
export const manifest = {
  package: "@hedronite/lts-shaders",
  assets: effectIds.map((id) => ({ id, kind: "shader", version: "0.1.0", added: "2026-11-15", ...effectInfo[id] })),
} as const;
