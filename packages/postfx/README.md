# @hedronite/lts-postfx

Screen effects: passes over the rendered frame, ported from hedronite.com. Dither (8×8 Bayer dot matrix), ASCII (a glyph ramp tinted by the source), film grain, the scan sweep, the lens loupe, the crystallize intro (ASCII settling through dither into the clean render) and the smoke field. Inks come from the token preset: the Hedronite look prints lapis and copper; pass `monochrome` for a one-ink print.

```ts
import { ScreenEffects } from "@hedronite/lts-postfx/three";
import { WebGPURenderer } from "three/webgpu";
import { hedronite } from "@hedronite/lts-tokens";

const renderer = new WebGPURenderer({ antialias: true, alpha: true });
await renderer.init();
const effects = new ScreenEffects(renderer, scene, camera, [{ id: "smoke" }, { id: "scan" }, { id: "lens" }], { palette: hedronite.scene });
// Each frame, instead of renderer.render(scene, camera):
effects.render(delta);
// On a pixel-ratio change: effects.setSize(). For the lens: effects.setPointer({ x, y }) (0 to 1) or null.
// When done: effects.dispose();
```

It runs on three's `WebGPURenderer` (WebGPU, or WebGL 2 where WebGPU is missing), the renderer TSL surface shaders need, so both share one scene. In React Three Fiber, use `<ScreenEffectsPass>` inside `<WebGPUCanvas>`, both from `@hedronite/lts-adapters/webgpu`.
