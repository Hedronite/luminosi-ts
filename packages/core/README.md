# @hedronite/lts-core

The shared foundation: the asset registry, manifests and seeded randomness. Pure TypeScript, no three.js.

```ts
import { createRegistry, registerManifest, createRandom } from "@hedronite/lts-core";

const registry = createRegistry();
registerManifest(registry, manifest);               // all or nothing; ids are unique
const random = createRandom(42);                     // same seed, same sequence
```
