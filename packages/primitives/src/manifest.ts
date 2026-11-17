import { primitiveIds, primitiveInfo, type PrimitiveId } from "./catalog.js";

/**
 * The UTC day a primitive joined the library: the nine hand-placed ones came with the first primitives,
 * the 13 Archimedean solids and their 13 Catalan duals a day later.
 */
const added = (id: PrimitiveId): string => (id.startsWith("archimedean-") || id.startsWith("catalan-") ? "2026-11-16" : "2026-11-15");

/** The primitives' manifest for the LuminosiTS registry (`registerManifest`). */
export const manifest = {
  package: "@hedronite/lts-primitives",
  assets: primitiveIds.map((id) => ({ id, kind: "primitive", version: "0.1.0", added: added(id), ...primitiveInfo(id) })),
} as const;
