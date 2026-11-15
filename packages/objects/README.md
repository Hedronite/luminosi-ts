# @hedronite/lts-objects

Composed objects: seeded procedural generators (crystal clusters, instanced lattices) and a glTF loader that decodes meshopt with the decoder bundled in three, so nothing is fetched from a CDN.

```ts
import { createCrystalCluster, crystalCluster, loadGltf } from "@hedronite/lts-objects";
const cluster = createCrystalCluster(crystalCluster({ count: 14, seed: 11 }), material); // same seed, same cluster
const scene = await loadGltf("/models/crystal-cluster-glb.glb", { signal });
```
