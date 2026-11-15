import { primitiveIds, primitiveInfo } from "./catalog.js";

/** The primitives' manifest for the LuminosiTS registry (`registerManifest`). */
export const manifest = {
  package: "@hedronite/lts-primitives",
  assets: primitiveIds.map((id) => ({ id, kind: "primitive", version: "0.1.0", added: "2026-11-15", ...primitiveInfo(id) })),
} as const;
