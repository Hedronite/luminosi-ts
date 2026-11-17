# @hedronite/lts-scenes

Scene kits: a lighting mood plus a small composition (studio, gallery, dusk, noir). Colors come from the token preset.

```ts
import { createSceneKit } from "@hedronite/lts-scenes/three";
import { disposeObject } from "@hedronite/lts-primitives/three";
const kit = createSceneKit("dusk"); // lights and shapes; use it instead of other lights
scene.add(kit);
// Later: disposeObject(kit);
```
