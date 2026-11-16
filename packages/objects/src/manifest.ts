import { generatedObjects } from "./generated/objects.js";

/** Objects stored as data (assets/src/objects, through `bun run objects`), as manifest entries. */
const objectsAsData = generatedObjects.map(({ id, name, tags, added }) => ({ id, kind: "object" as const, name, tags, version: "0.1.0", added }));

/** The objects' manifest for the LuminosiTS registry (`registerManifest`). */
export const manifest = {
  package: "@hedronite/lts-objects",
  assets: [
    { id: "crystal-cluster", kind: "object", name: "Crystal cluster", tags: ["procedural", "crystal"], version: "0.1.0", added: "2026-11-15" },
    { id: "framed-solid", kind: "object", name: "Framed solid", tags: ["procedural", "glass", "polyhedron"], version: "0.1.0", added: "2026-11-15" },
    { id: "instanced-lattice", kind: "object", name: "Instanced lattice", tags: ["procedural", "instanced"], version: "0.1.0", added: "2026-11-15" },
    { id: "dress-watch", kind: "object", name: "Your dress watch", tags: ["object-spec", "image-reconstruction", "watch"], version: "0.1.0", added: "2026-11-15" },
    { id: "crystal-cluster-glb", kind: "object", name: "Crystal cluster (glTF)", tags: ["gltf", "meshopt", "pipeline"], version: "0.1.0", added: "2026-11-15" },
    ...objectsAsData,
  ],
} as const;
