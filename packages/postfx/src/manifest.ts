import { screenEffectIds, screenEffectInfo } from "./effects.js";

/** The screen effects' manifest for the LuminosiTS registry (`registerManifest`). */
export const manifest = {
  package: "@hedronite/lts-postfx",
  assets: screenEffectIds.map((id) => {
    const { name, tags, added, origin } = screenEffectInfo[id];
    return { id, kind: "effect", name, tags, version: "0.1.0", added: added ?? "2026-11-15", ...(origin === undefined ? {} : { origin }) };
  }),
} as const;
