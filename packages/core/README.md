# @hedronite/lts-core

The shared foundation: the asset registry, manifests, loaders, disposal and seeded randomness. Pure TypeScript, no three.js.

```ts
import { createRegistry, registerManifest, createLoader, createDisposalScope, createRandom } from "@hedronite/lts-core";

const registry = createRegistry();
registerManifest(registry, manifest);               // all or nothing; ids are unique
const loader = createLoader(registry, (meta, signal) => fetchModel(meta, signal)); // loads once, abortable
const scope = createDisposalScope();                 // frees resources newest first
const random = createRandom(42);                     // same seed, same sequence
```
