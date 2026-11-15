/** The objects' manifest for the LuminosiTS registry (`registerManifest`). */
export const manifest = {
  package: "@hedronite/lts-objects",
  assets: [
    { id: "crystal-cluster", kind: "object", name: "Crystal cluster", tags: ["procedural", "crystal"], version: "0.1.0", added: "2026-11-15" },
    { id: "instanced-lattice", kind: "object", name: "Instanced lattice", tags: ["procedural", "instanced"], version: "0.1.0", added: "2026-11-15" },
    { id: "crystal-cluster-glb", kind: "object", name: "Crystal cluster (glTF)", tags: ["gltf", "meshopt", "pipeline"], version: "0.1.0", added: "2026-11-15" },
  ],
} as const;
