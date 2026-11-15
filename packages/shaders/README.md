# @hedronite/lts-shaders

TSL effects: fresnel glow, height gradient, pulse. Parameters are validated; colors default to the token preset. TSL materials need three's `WebGPURenderer`, which falls back to WebGL 2.

```ts
import { createFresnelGlowMaterial } from "@hedronite/lts-shaders";
import { WebGPURenderer } from "three/webgpu";
const renderer = new WebGPURenderer({ antialias: true });
await renderer.init();
const material = createFresnelGlowMaterial({ power: 3 });
```
