# @hedronite/lts-materials

Physically based material presets as data: matte, satin, ceramic, clearcoat, rubber, fabric (sheen), metal, brushed metal (anisotropic), anodized metal, iridescent (thin film), glass, frosted glass and emissive. All procedural, with no texture files. Colors come from a token preset, so swapping presets swaps the look.

```ts
import { createMaterial } from "@hedronite/lts-materials/three";
import { hedronite } from "@hedronite/lts-tokens";
const glass = createMaterial("glass");                    // neutral colors
const branded = createMaterial("metal", hedronite.scene); // you own it: material.dispose()
```
