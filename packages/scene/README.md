# @hedronite/lts-scene

One composition as one document: `lts-scene`, version 1. The root and `./emit` are pure data (zod and `@hedronite/lts-core`, no three.js, no React).

```ts
import { checkRefs, migrate, parseScene } from "@hedronite/lts-scene";
import { toCanonicalJson } from "@hedronite/lts-scene/emit";

const result = migrate(text); // any version, from text or a value: { ok: true, scene } or { ok: false, issues }
if (result.ok) {
  const problems = checkRefs(result.scene, (kind, id) => descriptors.get(id)); // ids and parameters, from your registry
  const out = toCanonicalJson(result.scene);
}
```

Edit a document, undo and redo, and share it as a link (all pure, all in the root):

```ts
import { createHistory, decodeScene, encodeScene, push, setInk, undo } from "@hedronite/lts-scene";

const edited = setInk(scene, "glass"); // a new document, or { ok: false, issues }; the input is never written to
if (edited.ok) {
  const history = push(createHistory(scene), edited.scene); // undo(history).present is `scene` again
  const link = await encodeScene(edited.scene); // "s1." and base64url of deflated canonical JSON
  const opened = await decodeScene(link); // the same result as parseScene; never throws
}
```

The shape, the migration from the playground's old JSON, the issue codes, the canonical text, the edits, the history and the link format are in [STACK.md](../../STACK.md#scene-document).

## The element: `@hedronite/lts-scene/element`

`<lts-scene>` draws a document on a page with no React: a poster at once, three and the builder loaded only when the element is about to be seen, reduced motion honoured, everything freed when it is removed.

```html
<lts-scene src="/scene.json" poster="/scene.webp" alt="Three solids on a studio floor"></lts-scene>
<script type="module">
  import { defineSceneElement } from "@hedronite/lts-scene/element";
  defineSceneElement();
</script>
```

- Attributes: `src` (a document URL) or one child `<script type="application/json">`; `poster`; `alt` (the accessible name, the element has `role="img"`); `look` (a look id, a change recolours in place); `loading` (`lazy`, the default, or `eager`).
- `data-state` goes `poster`, `loading`, `ready`, or `error`. On an error the poster stays and an `error` event carries `{ ok: false, issues }` as its `detail`.
- It publishes `data-frames`, `data-builds`, `data-geometries`, `data-textures`, `data-targets` and `data-programs`, and its canvas carries `data-renderer`.
- `./renderer` holds the backend readout it shares with the adapters' `WebGPUCanvas`: `rendererReadout`, `backendOf` and `whenDrawn`. It imports nothing.

The states, the events, the counters and the size lines are in [STACK.md](../../STACK.md#scene-element).
