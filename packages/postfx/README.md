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

## One print pass, values that move in place

The print effects (crystallize, dither, ASCII, scan, lens) share **one** full-screen pass, which prints the highest level each pixel asks for: dither or ASCII over the whole frame, ASCII during the intro, inside the scan band, under the lens. A stack that has both dither and ASCII on the whole frame keeps a second pass, the ASCII reading the dithered frame. (Before, each print was a pass of its own over the one before, so a lens over a scan printed a print of a print; now a lens that asks for dither over an ASCII frame shows ASCII.) The smoke is drawn into a half-size target and upsampled. `effects.passes` lists the passes the stack runs.

```ts
// Parameters and inks are uniforms: writing them rebuilds nothing.
effects.setParams({ lens: { radius: 80 }, dither: { cell: 5 } }); // any parameter of an effect in the stack; others keep their values
effects.setInks(inksFor(hedronite.scene, { monochrome: "#22c55e" }));
```

What is *structural* is the list of effects, each ASCII `ramp` and reduced motion: `stackStructure(stack, reducedMotion)` returns a string that is equal for two stacks that only `setParams` and `setInks` can tell apart. `stackValues(stack)` is every parameter with its defaults, for bringing a built stack to a new `effects` array. `<ScreenEffectsPass>` rebuilds only when the structure changes.
