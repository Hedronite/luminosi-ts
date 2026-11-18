# @hedronite/lts-shaders

TSL effects: fresnel glow, height gradient, pulse, toon outline, refraction (screen-space), dissolve, hologram and soap film. `effectInfo` says which animate and which need a scene behind them. Parameters are validated; colors default to the token preset. TSL materials need three's `WebGPURenderer`, which falls back to WebGL 2.

Every numeric and color parameter is a uniform, so a builder returns a handle: the `material`, a `set` that writes parameters in place (no new material, no recompile) and a `dispose`. A structural parameter (a toon shader's `bands`, whether a dissolve has a fixed `progress`) is baked into the graph: `set` returns `false`, writing nothing, and the effect is built again.

```ts
import { createFresnelGlowEffect } from "@hedronite/lts-shaders/three";
import { WebGPURenderer } from "three/webgpu";
const renderer = new WebGPURenderer({ antialias: true });
await renderer.init();
const effect = createFresnelGlowEffect({ power: 3 });
// effect.material draws; later, from a slider:
effect.set({ power: 5, glow: "#ff8800" });
```

Animated effects read time from a clock. By default that is three's wall clock; pass `{ clock: createEffectClock() }` to give a stage its own, and write seconds to the clock's `value` while the stage runs, so a paused stage holds its shaders still.
