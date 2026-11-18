import { generatedObjects } from "./generated/objects.js";
import { proceduralObjects } from "./generated/manifest.js";

/** Objects defined in code (descriptors.ts), as manifest entries. The list is generated, so reading it loads no descriptor. */
const objectsInCode = proceduralObjects.map((info) => ({ ...info, kind: "object" as const, version: "0.1.0" }));

/** Objects stored as data (assets/src/objects, through `bun run objects`), as manifest entries. */
const objectsAsData = generatedObjects.map(({ id, name, tags, added }) => ({ id, kind: "object" as const, name, tags, version: "0.1.0", added }));

/** The objects' manifest for the LuminosiTS registry (`registerManifest`). */
export const manifest = {
  package: "@hedronite/lts-objects",
  assets: [...objectsInCode, ...objectsAsData],
} as const;
