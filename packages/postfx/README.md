# @hedronite/lts-postfx

Screen effects: passes over the rendered frame, ported from hedronite.com. Dither (8×8 Bayer dot matrix), ASCII (a glyph ramp tinted by the source), film grain, the scan sweep, the lens loupe, the crystallize intro (ASCII settling through dither into the clean render) and the smoke field. Inks come from the token preset: the Hedronite look prints lapis and copper; pass `monochrome` for a one-ink print.

```ts
import { ScreenEffects } from "@hedronite/lts-postfx";
import { hedronite } from "@hedronite/lts-tokens";

const effects = new ScreenEffects(renderer, scene, camera, [{ id: "smoke" }, { id: "scan" }, { id: "lens" }], { palette: hedronite.scene });
// Each frame, instead of renderer.render(scene, camera):
effects.render(delta);
// On resize: effects.setSize(width, height). For the lens: effects.setPointer({ x, y }) (0 to 1) or null.
// When done: effects.dispose();
```

In React Three Fiber, use `<ScreenEffectsPass>` from `@hedronite/lts-adapters`.
