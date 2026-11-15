# @hedronite/lts-materials

Physically based material presets as data (matte, satin, ceramic, metal, brushed metal, glass, emissive). Colors come from a token preset, so swapping presets swaps the look.

```ts
import { createMaterial } from "@hedronite/lts-materials";
import { hedronite } from "@hedronite/lts-tokens";
const glass = createMaterial("glass");                    // neutral colors
const branded = createMaterial("metal", hedronite.scene); // you own it: material.dispose()
```
