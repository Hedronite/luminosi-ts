# @hedronite/lts-shaders

TSL effects: fresnel glow, height gradient, pulse, toon outline, refraction (screen-space), dissolve and hologram. `effectInfo` says which animate and which need a scene behind them. Parameters are validated; colors default to the token preset. TSL materials need three's `WebGPURenderer`, which falls back to WebGL 2.

```ts
import { createFresnelGlowMaterial } from "@hedronite/lts-shaders";
import { WebGPURenderer } from "three/webgpu";
const renderer = new WebGPURenderer({ antialias: true });
await renderer.init();
const material = createFresnelGlowMaterial({ power: 3 });
```
